// Temple Explorer — end-of-session questionnaire
//
// Reviewed with Provat's co-author, 26 Sep 2026. This replaces the earlier
// 9-question draft with the instrument actually used for data collection —
// four sections, matching the printed document:
//   A. Background
//   B. Spatial Knowledge Check (optional)
//   C. Experience with the Interactive Walkthrough
//   D. Open-Ended Feedback
//
// The printed document also has "Full Name" and "Student ID" fields at the
// top. Full Name is left out here on purpose (Provat, 26 Sep) — it conflicts
// with this project's no-names privacy design. Student ID, plus a new
// Institution field, are instead collected once, up front, on the sign-in
// screen (see main.js) — every session is already tagged with role +
// student ID there, so the questionnaire below only asks the study
// questions themselves.
//
// Types:
//   choice       — one option from a short list. An option equal to
//                  `otherOption` reveals a one-line text field, saved
//                  under `${id}_detail`.
//   multi        — any number of checkbox-style options, saved as an array.
//   yesno_detail — Yes/No; picking "Yes" reveals a one-line text field
//                  (labelled `detailLabel`), saved under `${id}_detail`.
//   text         — free writing.
//
// `id` is what the answer is stored under, and what the spreadsheet column
// (server.js's CSV_COLUMNS) is named. Changing an id after data collection
// has started orphans the earlier answers, so pick them now and leave them
// alone.

export const QUESTIONS = [
  // --- Section A. Background ----------------------------------------------
  {
    id: 'screen_time',
    section: 'A. Background',
    type: 'choice',
    text: 'What is your daily screen time?',
    options: ['2–4 hrs', '4–6 hrs', '6–8 hrs', '8–12 hrs', 'Other (specify)'],
    otherOption: 'Other (specify)',
  },
  {
    id: 'game_frequency',
    type: 'choice',
    text: 'How often do you play video games?',
    options: ['Daily', 'Weekly', 'Monthly', 'Rarely', 'Never'],
  },
  {
    id: 'used_vr',
    type: 'choice',
    text: 'Have you used VR (Virtual Reality) before?',
    options: ['Yes', 'No'],
  },
  {
    id: 'used_3d_tool',
    type: 'choice',
    text:
      'Have you used any interactive 3D or browser-based walkthrough tool ' +
      'before (e.g. Google Earth, a 3D model viewer, a game demo)?',
    options: ['Yes', 'No'],
  },
  {
    id: 'history_engagement',
    type: 'multi',
    text: 'How do you usually engage with historical topics in your studies?',
    note: 'Select all that apply.',
    options: ['Text Book', 'Videos & Documentaries', 'Articles', 'Historical video games'],
  },
  {
    id: 'interactive_effectiveness',
    type: 'choice',
    text:
      'How effective do you think interactive exploration (games/VR) can ' +
      'be as a learning tool for history?',
    options: ['Excellent', 'Good', 'Average', 'Poor', 'Very Poor'],
  },

  // --- Section B. Spatial Knowledge Check (Optional) -----------------------
  {
    id: 'spatial_sequence',
    section: 'B. Spatial Knowledge Check',
    sectionNote: 'Optional — a self-test, not a requirement. Skip anything you are unsure of.',
    type: 'choice',
    text:
      'Which of the following best describes the sequence of spaces from ' +
      'the entrance to the innermost part of the Temple of Horus?',
    options: [
      'Pylon → Forecourt → Outer Hypostyle Hall → Inner Hypostyle Hall → Sanctuary',
      'Forecourt → Pylon → Sanctuary → Outer Hypostyle Hall → Inner Hypostyle Hall',
      'Pylon → Sanctuary → Forecourt → Hypostyle Halls',
      'Sanctuary → Inner Hypostyle Hall → Outer Hypostyle Hall → Forecourt → Pylon',
      'Other (please specify)',
      'Not sure',
    ],
    otherOption: 'Other (please specify)',
  },
  {
    id: 'hypostyle_columns',
    type: 'choice',
    text: 'Approximately how many columns are in the outer hypostyle hall?',
    options: ['6', '12', '18', '24', 'Not sure'],
  },
  {
    id: 'light_change',
    type: 'choice',
    text:
      'As a visitor moves from the forecourt toward the sanctuary, what ' +
      'generally happens to the amount of natural light?',
    options: ['Increases', 'Stays the same', 'Decreases', 'Not sure'],
  },
  {
    id: 'capital_types',
    type: 'choice',
    text: 'Which capital types are found on the columns of the hypostyle halls?',
    options: [
      'Composite, palm and lotus capitals',
      'Ionic volutes',
      'Corinthian acanthus leaves',
      'Plain square capitals',
      'Not sure',
    ],
  },
  {
    id: 'sanctuary_function',
    type: 'choice',
    text: "What was the primary function of the temple's sanctuary?",
    options: [
      'An open public gathering space',
      'A restricted space that originally held the cult statue of the god',
      'A marketplace for offerings',
      'An outdoor courtyard for ceremonies',
      'Not sure',
    ],
  },

  // --- Section C. Experience with the Interactive Walkthrough --------------
  {
    id: 'engaging',
    section: 'C. Experience with the Interactive Walkthrough',
    type: 'choice',
    text: 'How engaging did you find the Temple of Horus interactive walkthrough?',
    options: ['Excellent', 'Good', 'Average', 'Poor', 'Very Poor'],
  },
  {
    id: 'historical_understanding',
    type: 'choice',
    text:
      'How did the walkthrough help you understand the historical and ' +
      'architectural significance of the Temple of Horus?',
    options: ['Excellent', 'Good', 'Average', 'Poor', 'Very Poor'],
  },
  {
    id: 'ease_of_navigation',
    type: 'choice',
    text: 'How easy did you find navigating/controlling the walkthrough?',
    options: ['Very Easy', 'Easy', 'Average', 'Difficult', 'Very Difficult'],
  },
  {
    id: 'pace_vs_video',
    type: 'choice',
    text:
      'How much did being able to move and explore at your own pace help ' +
      'you understand the spatial layout, compared to watching a fixed video?',
    options: ['Extremely', 'Highly', 'Moderately', 'Slightly', 'Not at all'],
  },
  {
    id: 'emotional_connection',
    type: 'choice',
    text: 'How did the walkthrough evoke an emotional connection with the historical content?',
    options: ['Excellent', 'Good', 'Average', 'Poor', 'Very Poor'],
  },
  {
    id: 'curiosity',
    type: 'choice',
    text: 'How did the walkthrough make you more curious about ancient history and architecture?',
    options: ['Extremely', 'Highly', 'Moderately', 'Slightly', 'Not at all'],
  },
  {
    id: 'retention_vs_traditional',
    type: 'choice',
    text:
      'How do you think interactive walkthroughs, compared to traditional ' +
      'methods, will help you retain historical information?',
    options: ['Extremely', 'Highly', 'Moderately', 'Slightly', 'Not at all'],
  },
  {
    id: 'favorite_feature',
    type: 'choice',
    text: 'Which feature did you like most about the Temple of Horus interactive walkthrough?',
    options: [
      'Historical content',
      'Architectural features',
      'Perception of space',
      'Freedom to navigate/explore',
      'Other (specify)',
    ],
    otherOption: 'Other (specify)',
  },
  {
    id: 'motivation_to_explore',
    type: 'choice',
    text: 'How motivated are you to explore more historical topics after this experience?',
    options: ['Extremely', 'Highly', 'Moderately', 'Slightly', 'Not at all'],
  },
  {
    id: 'technical_difficulties',
    type: 'yesno_detail',
    text:
      'Did you experience any technical difficulties while using the ' +
      'walkthrough (e.g. loading, controls, lag)?',
    options: ['Yes', 'No'],
    detailLabel: 'If yes, please describe',
  },
  {
    id: 'device_used',
    type: 'choice',
    text: 'Which device did you use?',
    options: ['Laptop', 'Desktop computer', 'Tablet', 'Other (specify)'],
    otherOption: 'Other (specify)',
  },

  // --- Section D. Open-Ended Feedback --------------------------------------
  {
    id: 'suggestions',
    section: 'D. Open-Ended Feedback',
    type: 'text',
    text: 'Do you have any suggestions for how we can improve the walkthrough experience?',
    placeholder: 'Optional',
  },
];

// Builds the questionnaire into `container`. Returns a function that reads the
// current answers back out, so main.js does not need to know the markup.
export function renderQuestionnaire(container) {
  container.innerHTML = '';
  const state = {};

  QUESTIONS.forEach((question, index) => {
    if (question.section) {
      const header = document.createElement('div');
      header.className = 'q-section';
      const heading = document.createElement('div');
      heading.className = 'q-section-title';
      heading.textContent = question.section;
      header.appendChild(heading);
      if (question.sectionNote) {
        const note = document.createElement('div');
        note.className = 'q-section-note';
        note.textContent = question.sectionNote;
        header.appendChild(note);
      }
      container.appendChild(header);
    }

    const block = document.createElement('div');
    block.className = 'q-block';

    const prompt = document.createElement('p');
    prompt.className = 'q-text';
    prompt.textContent = `${index + 1}. ${question.text}`;
    block.appendChild(prompt);

    if (question.note) {
      const note = document.createElement('p');
      note.className = 'q-note';
      note.textContent = question.note;
      block.appendChild(note);
    }

    if (question.type === 'choice') {
      const row = document.createElement('div');
      row.className = 'q-choices';

      let otherInput = null;
      if (question.otherOption) {
        otherInput = document.createElement('input');
        otherInput.type = 'text';
        otherInput.className = 'q-other-input hidden';
        otherInput.placeholder = 'Please specify';
        otherInput.addEventListener('input', () => {
          state[`${question.id}_detail`] = otherInput.value.trim();
        });
      }

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
          if (otherInput) {
            const isOther = option === question.otherOption;
            otherInput.classList.toggle('hidden', !isOther);
            if (!isOther) {
              otherInput.value = '';
              state[`${question.id}_detail`] = undefined;
            }
          }
        });
        row.appendChild(button);
      }
      block.appendChild(row);
      if (otherInput) block.appendChild(otherInput);
    }

    if (question.type === 'multi') {
      const row = document.createElement('div');
      row.className = 'q-choices';
      const selected = new Set();
      for (const option of question.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'q-choice';
        button.textContent = option;
        button.addEventListener('click', () => {
          if (selected.has(option)) {
            selected.delete(option);
            button.classList.remove('selected');
          } else {
            selected.add(option);
            button.classList.add('selected');
          }
          state[question.id] = selected.size ? Array.from(selected) : undefined;
        });
        row.appendChild(button);
      }
      block.appendChild(row);
    }

    if (question.type === 'yesno_detail') {
      const row = document.createElement('div');
      row.className = 'q-choices';

      const detailInput = document.createElement('input');
      detailInput.type = 'text';
      detailInput.className = 'q-other-input hidden';
      detailInput.placeholder = question.detailLabel || 'Please describe';
      detailInput.addEventListener('input', () => {
        state[`${question.id}_detail`] = detailInput.value.trim();
      });

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
          const showDetail = option === 'Yes';
          detailInput.classList.toggle('hidden', !showDetail);
          if (!showDetail) {
            detailInput.value = '';
            state[`${question.id}_detail`] = undefined;
          }
        });
        row.appendChild(button);
      }
      block.appendChild(row);
      block.appendChild(detailInput);
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
      const value = state[question.id];
      answers[question.id] = value === undefined || value === '' ? null : value;
      if (question.otherOption || question.type === 'yesno_detail') {
        const detail = state[`${question.id}_detail`];
        answers[`${question.id}_detail`] = detail === undefined || detail === '' ? null : detail;
      }
    }
    return answers;
  };
}
