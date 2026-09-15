// Temple Explorer — end-of-session questionnaire
//
// DRAFT WORDING. These questions are a starting point aimed squarely at the
// paper's argument (does walking through teach something a plan cannot?) and
// are meant to be revised with Prof. Joarder before the real session. Editing
// this list is all it takes — the screen builds itself from it, and every
// answer is saved with the session record under `questionnaire`.
//
// Types:
//   choice — one option from a short list
//   scale  — 1 to 5, with words at each end
//   text   — free writing
//
// `id` is what the answer is stored under, and what the spreadsheet column is
// named. Changing an id after data collection has started orphans the earlier
// answers, so pick them now and leave them alone.

export const QUESTIONS = [
  {
    id: 'seen_plan_before',
    type: 'choice',
    text: 'Before today, had you seen a plan drawing of the Temple of Horus?',
    options: ['Yes', 'No', 'Not sure'],
  },
  {
    id: 'visited_temple',
    type: 'choice',
    text: 'Have you ever visited an Egyptian temple in person?',
    options: ['Yes', 'No'],
  },
  {
    id: 'understands_sequence',
    type: 'scale',
    text:
      'How clearly do you now understand the way the temple is arranged, ' +
      'from the entrance through to the sanctuary?',
    low: 'Not at all',
    high: 'Very clearly',
  },
  {
    id: 'light_mattered',
    type: 'scale',
    text:
      'How much did the change in light — from the open court to the dark ' +
      'inner rooms — shape your sense of the building?',
    low: 'Not at all',
    high: 'A great deal',
  },
  {
    id: 'torch_mattered',
    type: 'scale',
    text: 'Did having to carry a torch change how the inner rooms felt to you?',
    low: 'Not at all',
    high: 'A great deal',
  },
  {
    id: 'plan_vs_walking',
    type: 'choice',
    text: 'Which told you more about this building?',
    options: ['A plan drawing', 'Walking through it', 'Both about equally'],
  },
  {
    id: 'movement_ease',
    type: 'scale',
    text: 'How easy was it to move around and find your way?',
    low: 'Difficult',
    high: 'Easy',
  },
  {
    id: 'beyond_the_plan',
    type: 'text',
    text:
      'Was there anything you noticed while walking that a plan drawing ' +
      'could not have shown you?',
    placeholder: 'Anything at all, in a sentence or two',
  },
  {
    id: 'comments',
    type: 'text',
    text: 'Anything else you would like to say?',
    placeholder: 'Optional',
  },
];

// Builds the questionnaire into `container`. Returns a function that reads the
// current answers back out, so main.js does not need to know the markup.
export function renderQuestionnaire(container) {
  container.innerHTML = '';
  const state = {};

  QUESTIONS.forEach((question, index) => {
    const block = document.createElement('div');
    block.className = 'q-block';

    const prompt = document.createElement('p');
    prompt.className = 'q-text';
    prompt.textContent = `${index + 1}. ${question.text}`;
    block.appendChild(prompt);

    if (question.type === 'choice') {
      const row = document.createElement('div');
      row.className = 'q-choices';
      for (const option of question.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'q-choice';
        button.textContent = option;
        button.addEventListener('click', () => {
          state[question.id] = option;
          for (const sibling of row.children) {
            sibling.classList.toggle('selected', sibling === button);
          }
        });
        row.appendChild(button);
      }
      block.appendChild(row);
    }

    if (question.type === 'scale') {
      const row = document.createElement('div');
      row.className = 'q-scale';

      const low = document.createElement('span');
      low.className = 'q-scale-end';
      low.textContent = question.low;
      row.appendChild(low);

      const buttons = document.createElement('div');
      buttons.className = 'q-scale-buttons';
      for (let value = 1; value <= 5; value++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'q-scale-btn';
        button.textContent = String(value);
        button.addEventListener('click', () => {
          state[question.id] = value;
          for (const sibling of buttons.children) {
            sibling.classList.toggle('selected', sibling === button);
          }
        });
        buttons.appendChild(button);
      }
      row.appendChild(buttons);

      const high = document.createElement('span');
      high.className = 'q-scale-end';
      high.textContent = question.high;
      row.appendChild(high);

      block.appendChild(row);
    }

    if (question.type === 'text') {
      const field = document.createElement('textarea');
      field.className = 'q-textarea';
      field.rows = 3;
      field.placeholder = question.placeholder || '';
      field.addEventListener('input', () => {
        state[question.id] = field.value.trim();
      });
      block.appendChild(field);
    }

    container.appendChild(block);
  });

  // Every question is left optional on purpose: a participant who would
  // rather not answer one should be able to move on, and a blank is honest
  // data where a forced answer is not.
  return function collectAnswers() {
    const answers = {};
    for (const question of QUESTIONS) {
      answers[question.id] =
        state[question.id] === undefined || state[question.id] === ''
          ? null
          : state[question.id];
    }
    return answers;
  };
}
