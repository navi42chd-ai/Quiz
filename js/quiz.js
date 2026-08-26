// QUIZ ENGINE — Free Navigation + Go To Question + Randomised Options

let state = {
  screen: 'subject',
  subject: null,
  chapter: null,
  questions: [],
  chapterQuestions: [],  // the full, unfiltered question set for the current
                          // chapter/session — used as the reference range for
                          // the "revise a range" feature, independent of any
                          // slicing/looping currently applied to `questions`
  current: 0,
  answered: [],   // chosen answer index after options are shuffled
  startTime: null,
  isReattempt: false,
  reviseInfo: null, // { from, to, loops, rangeSize } when in a custom revise session
  bgImageCache: new Map(), // question index -> resolved background image URL (or null)
  bgPrefetchInFlight: new Set() // question indices currently being prefetched
};

const WRONG_QUESTIONS_KEY = 'ssc-quiz-wrong-questions-v1';
const THEME_KEY = 'quizhub-theme';

// ── THEME (light / dark) ─────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  });

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', theme === 'dark' ? '#0b0f1a' : '#4f46e5');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';

  applyTheme(next);

  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) {
    // localStorage unavailable (private browsing, etc.) — theme just won't persist
  }
}

function getWrongQuestions() {
  try {
    const saved = JSON.parse(localStorage.getItem(WRONG_QUESTIONS_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    return [];
  }
}

function saveWrongQuestion(question) {
  const wrongQuestions = getWrongQuestions();
  const alreadySaved = wrongQuestions.some(item =>
    item.subjectId === question.sourceSubjectId &&
    item.chapterId === question.sourceChapterId &&
    item.questionIndex === question.sourceQuestionIndex
  );

  if (!alreadySaved) {
    wrongQuestions.push({
      subjectId: question.sourceSubjectId,
      chapterId: question.sourceChapterId,
      questionIndex: question.sourceQuestionIndex
    });
    localStorage.setItem(WRONG_QUESTIONS_KEY, JSON.stringify(wrongQuestions));
  }

  updateReattemptButton();
}

function clearWrongQuestions() {
  localStorage.removeItem(WRONG_QUESTIONS_KEY);
  updateReattemptButton();
}

function updateReattemptButton() {
  const count = getWrongQuestions().length;
  const button = document.getElementById('btn-reattempt');
  if (!button) return;

  button.style.display = count > 0 ? 'inline-flex' : 'none';
  document.getElementById('reattempt-count').textContent = count;
  document.body.classList.toggle('reattempt-available', count > 0);
}

function findSavedQuestion(savedQuestion) {
  const subject = SUBJECTS.find(item => item.id === savedQuestion.subjectId);
  const chapter = subject && subject.chapters.find(item => item.id === savedQuestion.chapterId);
  const data = chapter && window[chapter.dataVar];
  const question = data && data.questions[savedQuestion.questionIndex];

  if (!subject || !chapter || !question) return null;

  return {
    ...question,
    sourceSubjectId: subject.id,
    sourceChapterId: chapter.id,
    sourceQuestionIndex: savedQuestion.questionIndex
  };
}

function startReattempt() {
  const questions = getWrongQuestions().map(findSavedQuestion).filter(Boolean);
  if (!questions.length) {
    clearWrongQuestions();
    return;
  }

  const firstSaved = getWrongQuestions()[0];
  state.subject = SUBJECTS.find(item => item.id === firstSaved.subjectId) || SUBJECTS[0];
  state.chapter = { id: 'reattempt', label: 'Wrong Questions' };
  state.questions = prepareQuestions(questions);
  state.chapterQuestions = state.questions;
  state.current = 0;
  state.answered = new Array(state.questions.length).fill(null);
  state.startTime = Date.now();
  state.isReattempt = true;
  state.reviseInfo = null;
  state.bgImageCache = new Map();
  state.bgPrefetchInFlight = new Set();

  // This attempt starts with a clean bank. Any new mistake is saved again.
  clearWrongQuestions();
  renderQuestion();
  goTo('quiz');
}

// ── OPTION RANDOMISATION ─────────────────────────────────────

/**
 * Creates a shuffled copy of a question.
 * The original chapter data is not modified.
 */
function randomiseQuestionOptions(question) {
  const optionObjects = question.opts.map((text, originalIndex) => ({
    text,
    originalIndex
  }));

  // Fisher-Yates shuffle
  for (let i = optionObjects.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));

    [optionObjects[i], optionObjects[randomIndex]] =
      [optionObjects[randomIndex], optionObjects[i]];
  }

  // Find where the original correct answer moved after shuffling
  const shuffledCorrectIndex = optionObjects.findIndex(
    option => option.originalIndex === question.ans
  );

  return {
    ...question,
    opts: optionObjects.map(option => option.text),
    ans: shuffledCorrectIndex
  };
}

/**
 * Randomises the options of every question.
 */
function prepareQuestions(questions) {
  return questions.map(question => randomiseQuestionOptions(question));
}

// ── SCREEN NAVIGATION ────────────────────────────────────────

function goTo(screen) {
  document.querySelectorAll('.screen').forEach(screenElement => {
    screenElement.classList.remove('active');
  });

  document.getElementById('screen-' + screen).classList.add('active');
  state.screen = screen;
  window.scrollTo(0, 0);
}

function goSubjects() {
  state.subject = null;
  state.chapter = null;
  renderSubjects();
  goTo('subject');
}

function goChapters() {
  state.chapter = null;
  renderChapters(state.subject);
  goTo('chapter');
}

// ── SUBJECT SCREEN ───────────────────────────────────────────

function renderSubjects() {
  const grid = document.getElementById('subject-grid');
  grid.innerHTML = '';

  SUBJECTS.forEach(subject => {
    const card = document.createElement('div');

    card.className = 'card';
    card.style.setProperty('--accent', subject.color);
    card.style.setProperty('--accent-light', subject.colorLight);

    card.innerHTML = `
      <div class="card-icon">${subject.icon}</div>
      <div class="card-title">${subject.label}</div>
      <div class="card-meta">
        ${subject.chapters.length}
        chapter${subject.chapters.length > 1 ? 's' : ''}
      </div>
      <div class="card-arrow">→</div>
    `;

    card.addEventListener('click', () => selectSubject(subject.id));
    grid.appendChild(card);
  });
}

function selectSubject(subjectId) {
  state.subject = SUBJECTS.find(subject => subject.id === subjectId);

  renderChapters(state.subject);
  goTo('chapter');
}

// ── CHAPTER SCREEN ───────────────────────────────────────────

function renderChapters(subject) {
  document.getElementById('chapter-subject-title').textContent =
    subject.label;

  document.getElementById('chapter-subject-icon').textContent =
    subject.icon;

  const grid = document.getElementById('chapter-grid');
  grid.innerHTML = '';

  subject.chapters.forEach(chapter => {
    const data = window[chapter.dataVar];
    const card = document.createElement('div');

    card.className = 'card';
    card.style.setProperty('--accent', subject.color);
    card.style.setProperty('--accent-light', subject.colorLight);

    card.innerHTML = `
      <div class="card-icon">${subject.icon}</div>
      <div class="card-title">${chapter.label}</div>
      <div class="card-meta">
        ${data ? data.questions.length + ' questions' : 'No data'}
      </div>
      <div class="card-arrow">→</div>
    `;

    card.addEventListener('click', () => selectChapter(chapter));
    grid.appendChild(card);
  });
}

function selectChapter(chapter) {
  const data = window[chapter.dataVar];

  if (!data) {
    alert('Chapter data not found.');
    return;
  }

  state.chapter = chapter;

  // Randomise every question's options when the quiz starts
  state.questions = prepareQuestions(data.questions.map((question, questionIndex) => ({
    ...question,
    sourceSubjectId: state.subject.id,
    sourceChapterId: chapter.id,
    sourceQuestionIndex: questionIndex
  })));
  state.chapterQuestions = state.questions;

  state.current = 0;
  state.answered = new Array(state.questions.length).fill(null);
  state.startTime = Date.now();
  state.isReattempt = false;
  state.reviseInfo = null;
  state.bgImageCache = new Map();
  state.bgPrefetchInFlight = new Set();

  renderQuestion();
  goTo('quiz');
}

// ── QUIZ SCREEN ──────────────────────────────────────────────

function renderQuestion() {
  const question = state.questions[state.current];
  const total = state.questions.length;
  const index = state.current;

  const chapterLabelText = state.reviseInfo
    ? `${state.chapter.label} · Revise ${state.reviseInfo.from}-${state.reviseInfo.to}` +
      (state.reviseInfo.loops > 1 ? ` ×${state.reviseInfo.loops}` : '')
    : state.chapter.label;

  // Breadcrumb
  document.getElementById('quiz-breadcrumb').innerHTML = `
    <span class="bc-link" onclick="goSubjects()">Subjects</span>
    <span class="bc-sep">/</span>
    <span class="bc-link" onclick="goChapters()">
      ${state.subject.label}
    </span>
    <span class="bc-sep">/</span>
    <span class="bc-current">${escapeHtml(chapterLabelText)}</span>
  `;

  // Progress
  const attempted = state.answered.filter(answer => answer !== null).length;

  document.getElementById('prog-bar').style.width =
    Math.round(((index + 1) / total) * 100) + '%';

  document.getElementById('prog-text').textContent =
    `Q ${index + 1} / ${total}`;

  document.getElementById('prog-attempted').textContent =
    `${attempted} attempted`;

  // Question
  document.getElementById('q-kicker').textContent = `${state.chapter.label} MCQ`;
  document.getElementById('q-text').textContent = question.q;

  // Options
  const labels = ['A', 'B', 'C', 'D'];
  const optionsElement = document.getElementById('options');

  optionsElement.innerHTML = '';

  question.opts.forEach((option, optionIndex) => {
    const button = document.createElement('button');

    button.className = 'option-btn';

    button.innerHTML = `
      <span class="opt-label">${labels[optionIndex]}</span>
      <span class="opt-text">${option}</span>
    `;

    button.addEventListener('click', () => answer(optionIndex));
    optionsElement.appendChild(button);
  });

  // Restore an answer when returning to an attempted question
  const previousAnswer = state.answered[index];
  if (previousAnswer !== null) {
    showAnswer(previousAnswer, question.ans);
  }

  updateNavButtons();
  applyQuestionBackground(question, index);
}

// ── DYNAMIC QUESTION-CARD BACKGROUND IMAGE ───────────────────

/**
 * Tries several search candidates for a question IN PARALLEL (rather than
 * one-by-one) and returns the first successful thumbnail URL, preferring
 * the most relevant candidate if more than one succeeds. This is the main
 * speed win — a sequential search of N candidates takes roughly N times
 * as long as the slowest single lookup; doing them together takes about
 * as long as just one.
 */
async function resolveBackgroundImageUrl(question, maxCandidates = 8) {
  const allCandidates = buildImageQueryCandidates(question);
  if (allCandidates.length === 0) return null;

  // The chapter/subject name (always the last 1-2 entries) is a
  // near-guaranteed fallback — it's a real, well-known topic that almost
  // certainly has a Wikipedia page. Text-heavy questions can produce many
  // extracted-entity candidates ahead of it, so naively taking just the
  // first N would cut it off before it's ever tried. Reserve it a spot.
  const fallbackLabels = [state.chapter && state.chapter.label, state.subject && state.subject.label]
    .filter(Boolean);
  const guaranteed = allCandidates.filter(c => fallbackLabels.includes(c));
  const specific = allCandidates.filter(c => !fallbackLabels.includes(c));

  const specificSlots = Math.max(0, maxCandidates - guaranteed.length);
  const batch = [...specific.slice(0, specificSlots), ...guaranteed].slice(0, maxCandidates);

  const results = await Promise.allSettled(
    batch.map(query => fetchImageFromAnySource(query))
  );

  // Prefer results in priority order, not fetch-completion order.
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value && result.value.thumbnail) {
      return result.value.thumbnail.source;
    }
  }

  // Both free, unlimited sources came up empty for every candidate —
  // genuinely rare given the guaranteed chapter/subject fallback above,
  // but as a final safety net, try Openverse once with the single best
  // candidate (its anonymous quota is limited, so it's used sparingly).
  if (batch.length > 0) {
    try {
      const openversePage = await fetchOpenverseThumbnail(batch[0]);
      if (openversePage && openversePage.thumbnail) {
        return openversePage.thumbnail.source;
      }
    } catch (error) {
      // Openverse unreachable/rate-limited — fine, we simply show no image.
    }
  }

  return null;
}

/**
 * Gives the question card an ambient background photo related to the
 * question's main keyword (reusing the same entity-extraction + Wikipedia
 * lookup used by the "Image" button), with a dark scrim so the question
 * text stays readable over any photo. Results are cached per question
 * index for the current session so navigating back and forth doesn't
 * re-fetch, and a stale response can never apply itself to the wrong
 * question if the user has already moved on by the time it resolves.
 * Also prefetches the next question's image in the background, so
 * hitting "Next" usually shows the photo instantly instead of loading.
 */
function applyQuestionBackground(question, index) {
  const shell = document.querySelector('.question-shell');
  if (!shell) return;

  const cached = state.bgImageCache.get(index);

  if (cached === undefined) {
    // Not yet looked up — clear any previous image while we fetch, then
    // kick off the lookup in the background.
    shell.style.backgroundImage = '';
    shell.classList.remove('has-bg-image');

    resolveBackgroundImageUrl(question).then(foundUrl => {
      state.bgImageCache.set(index, foundUrl);

      // Only apply if the person is still looking at this same question —
      // otherwise this result is stale and should be silently discarded.
      if (state.current === index) {
        setQuestionShellBackground(foundUrl);
      }
    });
  } else {
    setQuestionShellBackground(cached);
  }

  prefetchAdjacentBackgrounds(index);
}

function prefetchAdjacentBackgrounds(index) {
  [index + 1, index - 1].forEach(neighborIndex => {
    const neighborQuestion = state.questions[neighborIndex];
    if (!neighborQuestion) return;
    if (state.bgImageCache.has(neighborIndex)) return;
    if (state.bgPrefetchInFlight.has(neighborIndex)) return;

    state.bgPrefetchInFlight.add(neighborIndex);

    resolveBackgroundImageUrl(neighborQuestion).then(foundUrl => {
      state.bgImageCache.set(neighborIndex, foundUrl);
      state.bgPrefetchInFlight.delete(neighborIndex);

      // Preload the actual image bytes too, so if the person navigates
      // there next, the browser already has it cached and paints instantly.
      if (foundUrl) {
        const preload = new Image();
        preload.src = foundUrl;
      }
    });
  });
}

function setQuestionShellBackground(url) {
  const shell = document.querySelector('.question-shell');
  if (!shell) return;

  if (url) {
    shell.style.backgroundImage = `url("${url}")`;
    shell.classList.add('has-bg-image');
  } else {
    shell.style.backgroundImage = '';
    shell.classList.remove('has-bg-image');
  }
}

function answer(chosenIndex) {
  const question = state.questions[state.current];
  const isCorrect = chosenIndex === question.ans;

  state.answered[state.current] = chosenIndex;

  if (!isCorrect) {
    saveWrongQuestion(question);
  }

  showAnswer(chosenIndex, question.ans, { fresh: true });

  updateNavButtons();

  const attempted = state.answered.filter(answer => answer !== null).length;

  document.getElementById('prog-attempted').textContent =
    `${attempted} attempted`;
}

function showAnswer(chosen, correct, { fresh = false } = {}) {
  const optionButtons = document.querySelectorAll('.option-btn');

  optionButtons.forEach(button => {
    button.disabled = true;
    button.classList.remove('correct', 'wrong', 'reveal', 'shake');
  });

  const isCorrect = chosen === correct;
  const chosenButton = optionButtons[chosen];
  chosenButton.classList.add(isCorrect ? 'correct' : 'wrong');

  if (!isCorrect) {
    optionButtons[correct].classList.add('reveal');
  }

  // Only celebrate/penalise on a fresh tap — not when the person is just
  // navigating back to review a question they already answered.
  if (fresh) {
    if (isCorrect) {
      playCorrectSound();
      spawnConfetti(chosenButton);
      if (navigator.vibrate) navigator.vibrate(15);
    } else {
      chosenButton.classList.add('shake');
      playWrongSound();
      if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    }
  }
}

// ── ANSWER FEEDBACK: SOUND, CONFETTI ──────────────────────────

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq, startOffset, duration, type, peakGain) {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const startTime = ctx.currentTime + startOffset;

  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.03);
}

function playCorrectSound() {
  // Bright ascending two-note chime
  playTone(880, 0, 0.12, 'sine', 0.18);
  playTone(1318.5, 0.08, 0.18, 'sine', 0.16);
}

function playWrongSound() {
  // Short, low, unobtrusive buzz
  playTone(180, 0, 0.15, 'sawtooth', 0.1);
  playTone(140, 0.05, 0.18, 'sawtooth', 0.08);
}

function spawnConfetti(originElement) {
  const rect = originElement.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const glyphs = ['✨', '⭐', '🎉', '💫'];

  for (let i = 0; i < 7; i++) {
    const particle = document.createElement('span');
    const angle = Math.random() * Math.PI * 2;
    const distance = 36 + Math.random() * 55;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 30; // bias upward

    particle.className = 'confetti-particle';
    particle.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    particle.style.left = centerX + 'px';
    particle.style.top = centerY + 'px';
    particle.style.setProperty('--dx', dx + 'px');
    particle.style.setProperty('--dy', dy + 'px');

    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 900);
  }
}

function updateNavButtons() {
  const index = state.current;
  const total = state.questions.length;

  document.getElementById('btn-prev').style.display =
    index > 0 ? 'inline-flex' : 'none';

  document.getElementById('btn-next').style.display =
    index < total - 1 ? 'inline-flex' : 'none';

  document.getElementById('btn-end').style.display =
    index === total - 1 ? 'inline-flex' : 'none';
}

function prevQuestion() {
  if (state.current > 0) {
    state.current--;
    renderQuestion();
  }
}

function nextQuestion() {
  if (state.current < state.questions.length - 1) {
    state.current++;
    renderQuestion();
  }
}

// ── GO TO QUESTION ───────────────────────────────────────────

function openGotoModal() {
  const total = state.questions.length;

  document.getElementById('goto-range').textContent =
    `Enter a number between 1 and ${total}`;

  document.getElementById('goto-modal').classList.add('open');
  document.getElementById('goto-input').value = '';
  document.getElementById('goto-input').focus();
  document.getElementById('goto-error').textContent = '';
}

function closeGotoModal() {
  document.getElementById('goto-modal').classList.remove('open');
}

function submitGoto() {
  const input = document.getElementById('goto-input');
  const error = document.getElementById('goto-error');
  const value = parseInt(input.value, 10);
  const total = state.questions.length;

  if (isNaN(value) || value < 1 || value > total) {
    error.textContent =
      `Enter a number between 1 and ${total}`;

    return;
  }

  state.current = value - 1;

  closeGotoModal();
  renderQuestion();
}

// ── REVISE A RANGE (custom looped revision session) ──────────

function openReviseModal() {
  const total = (state.chapterQuestions.length || state.questions.length);

  document.getElementById('revise-range-hint').textContent =
    `This chapter has ${total} question${total === 1 ? '' : 's'}`;

  const fromInput = document.getElementById('revise-from');
  const toInput = document.getElementById('revise-to');
  const loopsInput = document.getElementById('revise-loops');

  fromInput.min = 1;
  fromInput.max = total;
  fromInput.value = 1;

  toInput.min = 1;
  toInput.max = total;
  toInput.value = total;

  loopsInput.min = 1;
  loopsInput.value = 1;

  document.getElementById('revise-error').textContent = '';
  document.getElementById('revise-modal').classList.add('open');
}

function closeReviseModal() {
  document.getElementById('revise-modal').classList.remove('open');
}

function submitRevise() {
  const base = state.chapterQuestions.length ? state.chapterQuestions : state.questions;
  const total = base.length;
  const errorEl = document.getElementById('revise-error');

  const from = parseInt(document.getElementById('revise-from').value, 10);
  const to = parseInt(document.getElementById('revise-to').value, 10);
  const loops = parseInt(document.getElementById('revise-loops').value, 10);

  if (
    !Number.isInteger(from) || !Number.isInteger(to) ||
    from < 1 || to < 1 || from > total || to > total
  ) {
    errorEl.textContent = `Enter question numbers between 1 and ${total}.`;
    return;
  }

  if (from > to) {
    errorEl.textContent = '"From" must be less than or equal to "To".';
    return;
  }

  if (!Number.isInteger(loops) || loops < 1) {
    errorEl.textContent = 'Loops must be a whole number of 1 or more.';
    return;
  }

  if (loops > 20) {
    errorEl.textContent = 'Please choose 20 loops or fewer.';
    return;
  }

  const rangeSlice = base.slice(from - 1, to);
  let combined = [];

  // Reshuffle option order fresh on every lap, so revising the same
  // questions repeatedly doesn't let you just memorise option positions.
  for (let lap = 0; lap < loops; lap++) {
    combined = combined.concat(prepareQuestions(rangeSlice));
  }

  state.questions = combined;
  state.current = 0;
  state.answered = new Array(combined.length).fill(null);
  state.startTime = Date.now();
  state.isReattempt = false;
  state.reviseInfo = { from, to, loops, rangeSize: rangeSlice.length };
  state.bgImageCache = new Map();
  state.bgPrefetchInFlight = new Set();

  closeReviseModal();
  renderQuestion();
  goTo('quiz');
}

// ── RELATED IMAGE LOOKUP (Wikipedia — free, no API key needed) ──

// Common words that get capitalised only because of sentence position
// (question starters, connectors, numbers-as-words) — never useful as a
// search term on their own, even when they show up as a single-word match.
const IMAGE_SEARCH_STOPWORDS = new Set([
  'who', 'whom', 'whose', 'what', 'when', 'where', 'which', 'why', 'how',
  'during', 'after', 'before', 'into', 'onto', 'from', 'to', 'in', 'by',
  'with', 'the', 'this', 'that', 'these', 'those', 'was', 'were', 'is',
  'are', 'did', 'does', 'do', 'and', 'or', 'but', 'of', 'at', 'on', 'as',
  'not', 'no', 'a', 'an', 'his', 'her', 'its', 'their', 'he', 'she', 'it',
  'they', 'you', 'your', 'our', 'we', 'i', 'both', 'all', 'each', 'other',
  'another', 'same', 'following', 'also', 'only', 'such', 'more', 'most',
  'many', 'several', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten'
]);

function stripLeadingStopwords(phrase) {
  let words = phrase.split(/\s+/);
  while (words.length > 1 && IMAGE_SEARCH_STOPWORDS.has(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  return words.join(' ');
}

function isUsableNamedEntity(phrase) {
  if (!phrase) return false;
  const words = phrase.split(/\s+/);
  if (words.length === 1 && IMAGE_SEARCH_STOPWORDS.has(words[0].toLowerCase())) {
    return false;
  }
  return phrase.replace(/[^a-zA-Z]/g, '').length >= 3;
}

/**
 * Pulls likely named entities (people, places, dynasties) out of a chunk
 * of text, most specific first:
 *   1. "Name Number" pairs like "Pulakeshin 2" or "Vikramaditya 1" —
 *      very precise and match regnal-numeral Wikipedia titles well.
 *   2. Multi-word capitalised phrases (e.g. "Ancient History"), allowing
 *      a few lowercase connector words inside them.
 *   3. Individual capitalised words — the broadest net, so a single
 *      named person (e.g. "Grahavarman", "Shashanka") is never missed
 *      just because they're mentioned alone rather than as part of a
 *      longer phrase.
 * Question-starter words ("Who", "Which", "During"...) are filtered out
 * throughout so they never get treated as search terms.
 */
function extractNamedEntities(text) {
  if (!text) return [];

  const nameWithNumber = text.match(/\b[A-Z][a-zA-Z'-]*\s+\d+\b/g) || [];
  const multiWordPhrases = text.match(/\b[A-Z][a-zA-Z''-]*(?:\s+(?:[A-Z][a-zA-Z''-]*|of|and|the))*\b/g) || [];
  const singleWords = text.match(/\b[A-Z][a-zA-Z'-]{2,}\b/g) || [];

  const seen = new Set();
  const results = [];

  [...nameWithNumber, ...multiWordPhrases, ...singleWords].forEach(raw => {
    const cleaned = stripLeadingStopwords(
      raw.replace(/[''`]s\b/gi, '').trim()
    );
    const key = cleaned.toLowerCase();

    if (isUsableNamedEntity(cleaned) && !seen.has(key)) {
      seen.add(key);
      results.push(cleaned);
    }
  });

  return results;
}

/**
 * Builds an ordered list of search queries to try for the current
 * question, from most to least specific:
 *   1. The correct answer text as a whole, when it's short enough to be
 *      usable directly (usually a proper noun on its own).
 *   2. Named entities mined out of the answer text — the answer is often
 *      more specific to what's actually being asked than the question
 *      itself (e.g. "Who defeated X?" → the answer names the person).
 *   3. Named entities mined out of the question text.
 *   4. The current chapter's title.
 *   5. The current subject's title — a last resort that should almost
 *      always turn up something on Wikipedia.
 * Each is tried in turn until one actually returns an image.
 */
function buildImageQueryCandidates(question) {
  const candidates = [];
  const addCandidate = value => {
    const trimmed = (value || '').trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !candidates.some(c => c.toLowerCase() === key)) {
      candidates.push(trimmed);
    }
  };

  const rawAnswer = (question.opts[question.ans] || '')
    .replace(/\(.*?\)/g, '')
    .trim();
  const looksSearchableAnswer =
    /[a-zA-Z]{3,}/.test(rawAnswer) &&
    !/^\d/.test(rawAnswer) &&
    rawAnswer.split(' ').length <= 6;

  if (looksSearchableAnswer) {
    addCandidate(rawAnswer);
  }

  extractNamedEntities(rawAnswer).forEach(addCandidate);
  extractNamedEntities(question.q).forEach(addCandidate);

  if (state.chapter) {
    addCandidate(state.chapter.label);
  }

  if (state.subject) {
    addCandidate(state.subject.label);
  }

  return candidates;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function fetchWikipediaThumbnail(query) {
  const apiUrl =
    'https://en.wikipedia.org/w/api.php' +
    '?action=query&generator=search' +
    `&gsrsearch=${encodeURIComponent(query)}` +
    '&gsrlimit=1&prop=pageimages|info&inprop=url' +
    '&piprop=thumbnail&pithumbsize=640&format=json&origin=*';

  const response = await fetch(apiUrl);
  const data = await response.json();
  const pages = data.query && data.query.pages;
  const page = pages ? Object.values(pages)[0] : null;

  if (!page || !page.thumbnail || !page.thumbnail.source) return null;

  return {
    title: page.title,
    thumbnail: { source: page.thumbnail.source },
    fullurl: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    sourceLabel: 'Wikipedia'
  };
}

/**
 * Wikipedia's "page image" is just the one photo editors picked for an
 * article's infobox — plenty of valid topics (temples, artifacts, minor
 * rulers) have a Wikipedia article with no such image, even though real
 * photos of them exist on Wikimedia. Commons indexes millions of
 * individual images directly (searching actual file titles/descriptions
 * in the File: namespace), so it catches a lot that Wikipedia's page
 * search misses.
 */
async function fetchCommonsThumbnail(query) {
  const apiUrl =
    'https://commons.wikimedia.org/w/api.php' +
    '?action=query&generator=search' +
    `&gsrsearch=${encodeURIComponent(query)}` +
    '&gsrnamespace=6&gsrlimit=1' +
    '&prop=imageinfo&iiprop=url' +
    '&iiurlwidth=640&format=json&origin=*';

  const response = await fetch(apiUrl);
  const data = await response.json();
  const pages = data.query && data.query.pages;
  const page = pages ? Object.values(pages)[0] : null;
  const info = page && page.imageinfo && page.imageinfo[0];

  if (!info || (!info.thumburl && !info.url)) return null;

  const cleanTitle = (page.title || '')
    .replace(/^File:/, '')
    .replace(/\.(jpg|jpeg|png|gif|svg|tiff?|webp)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  return {
    title: cleanTitle || query,
    thumbnail: { source: info.thumburl || info.url },
    fullurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    sourceLabel: 'Wikimedia Commons'
  };
}

/**
 * Searches Wikipedia and Wikimedia Commons for the same query IN PARALLEL
 * and returns whichever succeeds first (preferring Wikipedia when both
 * do, since an article thumbnail is usually more clearly "the" subject
 * than an arbitrary Commons file). This roughly doubles the hit rate
 * compared to Wikipedia alone, at no extra latency since both requests
 * fire together.
 */
/**
 * Last-resort third source. Openverse aggregates CC-licensed/public-domain
 * images from many providers (Flickr Commons, museums, Europeana, etc.),
 * needs no API key for anonymous use, but its anonymous tier is
 * rate-limited (~100 requests/hour) — so unlike Wikipedia/Commons this is
 * only touched when both of those come up completely empty, not fired on
 * every candidate.
 */
async function fetchOpenverseThumbnail(query) {
  const apiUrl =
    'https://api.openverse.org/v1/images/' +
    `?q=${encodeURIComponent(query)}&page_size=1`;

  const response = await fetch(apiUrl);
  const data = await response.json();
  const result = data.results && data.results[0];

  if (!result || (!result.thumbnail && !result.url)) return null;

  return {
    title: result.title || query,
    thumbnail: { source: result.thumbnail || result.url },
    fullurl: result.foreign_landing_url || result.url,
    sourceLabel: 'Openverse'
  };
}

async function fetchImageFromAnySource(query) {
  const [wiki, commons] = await Promise.allSettled([
    fetchWikipediaThumbnail(query),
    fetchCommonsThumbnail(query)
  ]);

  if (wiki.status === 'fulfilled' && wiki.value) return wiki.value;
  if (commons.status === 'fulfilled' && commons.value) return commons.value;
  return null;
}

async function openQuestionImage() {
  const modal = document.getElementById('image-modal');
  const body = document.getElementById('image-modal-body');
  const titleEl = document.getElementById('image-modal-title');
  const question = state.questions[state.current];
  const candidates = buildImageQueryCandidates(question);

  titleEl.textContent = 'Related images';
  body.innerHTML = `
    <div class="image-loading">
      <div class="image-spinner"></div>
      <p>Looking for images…</p>
    </div>
  `;
  modal.classList.add('open');

  try {
    const results = [];
    const seenTitles = new Set();
    const maxResults = 4;
    const maxAttempts = 10; // safety cap on total candidates tried

    for (let i = 0; i < candidates.length && i < maxAttempts && results.length < maxResults; i++) {
      const page = await fetchImageFromAnySource(candidates[i]);

      if (page) {
        const key = page.title.toLowerCase();
        if (!seenTitles.has(key)) {
          seenTitles.add(key);
          results.push(page);
        }
      }
    }

    // Both free, unlimited sources found nothing at all — try Openverse
    // once as a final safety net (its anonymous quota is limited, so it's
    // only touched when genuinely needed).
    if (results.length === 0 && candidates.length > 0) {
      try {
        const openversePage = await fetchOpenverseThumbnail(candidates[0]);
        if (openversePage) {
          results.push(openversePage);
        }
      } catch (error) {
        // Openverse unreachable/rate-limited — fine, we'll just show "no image".
      }
    }

    renderImageResults(results);
  } catch (error) {
    body.innerHTML = `
      <div class="image-empty">
        Couldn't load images right now.
        <br />Check your connection and try again.
      </div>
    `;
  }
}

function wikipediaPageUrl(page) {
  return page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`;
}

function renderImageResults(results) {
  const body = document.getElementById('image-modal-body');
  const titleEl = document.getElementById('image-modal-title');

  if (results.length === 0) {
    titleEl.textContent = 'Related images';
    body.innerHTML = `
      <div class="image-empty">
        🕵️ Couldn't find any images for this question.
        <br />Try a different one!
      </div>
    `;
    return;
  }

  if (results.length === 1) {
    const page = results[0];
    const sourceName = page.sourceLabel || 'Wikipedia';
    titleEl.textContent = page.title;
    body.innerHTML = `
      <img
        src="${page.thumbnail.source}"
        alt="${escapeHtml(page.title)}"
        class="image-modal-img"
      />
      <p class="image-modal-caption">${escapeHtml(page.title)}</p>
      <a
        href="${wikipediaPageUrl(page)}"
        target="_blank"
        rel="noopener noreferrer"
        class="image-modal-source"
      >View on ${escapeHtml(sourceName)} →</a>
      <p class="image-modal-attribution">Image via ${escapeHtml(sourceName)}</p>
    `;
    return;
  }

  titleEl.textContent = `${results.length} related images`;

  const itemsHtml = results
    .map(
      page => `
        <a
          class="image-grid-item"
          href="${wikipediaPageUrl(page)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="${page.thumbnail.source}"
            alt="${escapeHtml(page.title)}"
            class="image-grid-img"
          />
          <span class="image-grid-caption">${escapeHtml(page.title)}</span>
        </a>
      `

    )
    .join('');

  body.innerHTML = `
    <div class="image-grid">${itemsHtml}</div>
    <p class="image-modal-attribution">Images via Wikipedia & Wikimedia Commons</p>
  `;
}

function closeImageModal() {
  document.getElementById('image-modal').classList.remove('open');
}

// ── INITIALISATION ───────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

  const gotoInput = document.getElementById('goto-input');
  const gotoModal = document.getElementById('goto-modal');

  gotoInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      submitGoto();
    }

    if (event.key === 'Escape') {
      closeGotoModal();
    }
  });

  gotoModal.addEventListener('click', event => {
    if (event.target === gotoModal) {
      closeGotoModal();
    }
  });

  const imageModal = document.getElementById('image-modal');

  imageModal.addEventListener('click', event => {
    if (event.target === imageModal) {
      closeImageModal();
    }
  });

  const reviseModal = document.getElementById('revise-modal');

  reviseModal.addEventListener('click', event => {
    if (event.target === reviseModal) {
      closeReviseModal();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;

    if (imageModal.classList.contains('open')) {
      closeImageModal();
    }

    if (reviseModal.classList.contains('open')) {
      closeReviseModal();
    }
  });

  renderSubjects();
  updateReattemptButton();
  goTo('subject');
});

// ── RESULT SCREEN ────────────────────────────────────────────

function endQuiz() {
  const total = state.questions.length;

  const correct = state.answered.filter(
    (answer, index) => answer === state.questions[index].ans
  ).length;

  const attempted = state.answered.filter(
    answer => answer !== null
  ).length;

  const percentage =
    attempted > 0
      ? Math.round((correct / attempted) * 100)
      : 0;

  const elapsed =
    Math.round((Date.now() - state.startTime) / 1000);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const grade =
    percentage >= 90
      ? {
          label: 'Excellent!',
          color: '#0F6E56'
        }
      : percentage >= 75
        ? {
            label: 'Good work!',
            color: '#185FA5'
          }
        : percentage >= 50
          ? {
              label: 'Keep revising',
              color: '#BA7517'
            }
          : {
              label: 'Needs more practice',
              color: '#A32D2D'
            };

  document.getElementById('result-breadcrumb').innerHTML = `
    <span class="bc-link" onclick="goSubjects()">Subjects</span>
    <span class="bc-sep">/</span>
    <span class="bc-link" onclick="goChapters()">
      ${state.subject.label}
    </span>
    <span class="bc-sep">/</span>
    <span class="bc-current">Results</span>
  `;

  document.getElementById('res-grade').textContent =
    grade.label;

  document.getElementById('res-grade').style.color =
    grade.color;

  document.getElementById('res-chapter').textContent =
    state.isReattempt ? 'Reattempted wrong questions' : state.chapter.label;

  document.getElementById('res-correct').textContent =
    correct;

  document.getElementById('res-wrong').textContent =
    attempted - correct;

  document.getElementById('res-skipped').textContent =
    total - attempted;

  document.getElementById('res-attempted').textContent =
    attempted;

  document.getElementById('res-total').textContent =
    total;

  document.getElementById('res-time').textContent =
    minutes > 0
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`;

  goTo('result');
  playResultAnimations(percentage, grade.color);
}

// ── RESULT ANIMATIONS ────────────────────────────────────────

/**
 * Animates the score ring filling up (and the % counting up) to
 * match the actual score, then replays the card's entrance animation.
 */
function animateScoreRing(targetPercentage, color) {
  const ring = document.getElementById('res-ring');
  const pctText = document.getElementById('res-pct');
  const duration = 1100;
  const startTime = performance.now();

  // Read the theme-aware "empty segment" color live, so the ring looks
  // correct in both light and dark mode without hardcoding a hex value.
  const trackColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--opt-bg').trim() || '#f1f3f7';

  ring.style.background =
    `conic-gradient(${color} 0 0%, ${trackColor} 0%)`;
  pctText.textContent = '0%';

  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    const current = targetPercentage * eased;

    ring.style.background =
      `conic-gradient(${color} 0 ${current}%, ${trackColor} ${current}%)`;
    pctText.textContent = Math.round(current) + '%';

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      ring.style.background =
        `conic-gradient(${color} 0 ${targetPercentage}%, ${trackColor} ${targetPercentage}%)`;
      pctText.textContent = targetPercentage + '%';
    }
  }

  requestAnimationFrame(step);
}

function playResultAnimations(percentage, gradeColor) {
  const card = document.querySelector('.result-card');

  // Restart the CSS entrance animations even on repeat quizzes
  card.classList.remove('animate-in');
  void card.offsetWidth; // force reflow so the animation can replay
  card.classList.add('animate-in');

  animateScoreRing(percentage, gradeColor);
}

function retryQuiz() {
  if (state.isReattempt) {
    state.questions = prepareQuestions(state.questions);
    state.current = 0;
    state.answered = new Array(state.questions.length).fill(null);
    state.startTime = Date.now();
    clearWrongQuestions();
    renderQuestion();
    goTo('quiz');
    return;
  }

  // Starting a regular chapter again reshuffles all options.
  selectChapter(state.chapter);
}
