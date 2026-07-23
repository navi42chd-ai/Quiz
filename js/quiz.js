// QUIZ ENGINE — Free Navigation + Go To Question + Randomised Options

let state = {
  screen: 'subject',
  subject: null,
  chapter: null,
  questions: [],
  current: 0,
  answered: [],   // chosen answer index after options are shuffled
  startTime: null,
  isReattempt: false
};

const WRONG_QUESTIONS_KEY = 'ssc-quiz-wrong-questions-v1';

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
  state.current = 0;
  state.answered = new Array(state.questions.length).fill(null);
  state.startTime = Date.now();
  state.isReattempt = true;

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

  state.current = 0;
  state.answered = new Array(state.questions.length).fill(null);
  state.startTime = Date.now();
  state.isReattempt = false;

  renderQuestion();
  goTo('quiz');
}

// ── QUIZ SCREEN ──────────────────────────────────────────────

function renderQuestion() {
  const question = state.questions[state.current];
  const total = state.questions.length;
  const index = state.current;

  // Breadcrumb
  document.getElementById('quiz-breadcrumb').innerHTML = `
    <span class="bc-link" onclick="goSubjects()">Subjects</span>
    <span class="bc-sep">/</span>
    <span class="bc-link" onclick="goChapters()">
      ${state.subject.label}
    </span>
    <span class="bc-sep">/</span>
    <span class="bc-current">${state.chapter.label}</span>
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
}

function answer(chosenIndex) {
  const question = state.questions[state.current];

  state.answered[state.current] = chosenIndex;

  if (chosenIndex !== question.ans) {
    saveWrongQuestion(question);
  }

  showAnswer(chosenIndex, question.ans);

  updateNavButtons();

  const attempted = state.answered.filter(answer => answer !== null).length;

  document.getElementById('prog-attempted').textContent =
    `${attempted} attempted`;
}

function showAnswer(chosen, correct) {
  const optionButtons = document.querySelectorAll('.option-btn');

  optionButtons.forEach(button => {
    button.disabled = true;
    button.classList.remove('correct', 'wrong', 'reveal');
  });

  const isCorrect = chosen === correct;
  optionButtons[chosen].classList.add(isCorrect ? 'correct' : 'wrong');

  if (!isCorrect) {
    optionButtons[correct].classList.add('reveal');
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

// ── INITIALISATION ───────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
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

  document.getElementById('res-pct').textContent =
    percentage + '%';

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
