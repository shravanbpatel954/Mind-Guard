function includesAny(t, phrases) {
  return phrases.some((p) => t.includes(p));
}

export function classify(textRaw) {
  const t = String(textRaw || '').toLowerCase().trim();

  const selfHarmHigh = [
    'kill myself',
    'end my life',
    'suicide',
    'suicidal',
    'want to die',
    'i want to die',
    'i will kill myself',
    'i will end my life',
    'self harm',
    'self-harm',
    'cut myself',
    'cutting myself',
    'overdose',
    'hang myself',
    'jump off',
    'die tonight',
    'die today',
    'marna chahta',
    'marna chahti',
    'marne ka mann',
    'jeene ka mann nahi',
    'jeene ki iccha nahi',
    'khatam karna',
  ];

  const distress = [
    'depress',
    'sad',
    'lonely',
    'hopeless',
    'worthless',
    'numb',
    'empty',
    'overwhelmed',
    'panic',
    'anxious',
    'scared',
    'cry',
    'tired',
    'give up',
    'done with everything',
    'no one cares',
    'akela',
    'akelapan',
    'udas',
    'udaas',
    'pareshan',
    'tension',
    'ghabarahat',
    'bura lag raha',
    'zindagi bekar',
  ];

  const greeting = /^(hi|hey|hello|hii+|namaste|kaise ho)(\s|$)/i.test(t);

  if (includesAny(t, selfHarmHigh)) return { intent: 'self_harm', severity: 'high' };
  if (includesAny(t, ['need help', 'crisis'])) return { intent: 'help', severity: 'high' };
  if (includesAny(t, distress)) return { intent: 'distress', severity: 'moderate' };
  if (greeting) return { intent: 'greeting', severity: 'low' };
  if (includesAny(t, ["i'm okay", 'im okay', 'okay', 'fine', 'doing good', 'doing well'])) return { intent: 'okay', severity: 'low' };

  return { intent: 'default', severity: 'low' };
}

export function nextBotState(prevState, classification) {
  const s = prevState || 'normal';
  if (classification.intent === 'self_harm') return 'crisis_check';
  if (classification.intent === 'help' && classification.severity === 'high') return 'crisis_check';
  if (classification.intent === 'distress') return s === 'crisis_check' ? 'crisis_check' : 'supportive';
  return 'normal';
}

export function buildReply({ text, classification, state }) {
  const t = String(text || '').toLowerCase().trim();

  if (state === 'crisis_check') {
    // Ask a direct, safety-focused question. Keep it short.
    return (
      "I'm really sorry you're feeling this way. I want to help you stay safe.\n\n" +
      "Are you thinking about hurting yourself right now, or do you feel in immediate danger?"
    );
  }

  if (classification.intent === 'greeting') {
    return "Hi — I'm here with you. How are you feeling right now?";
  }

  if (classification.intent === 'okay') {
    return "I'm glad you're here. Want to talk about what's been on your mind today, or would you rather do a quick calm-down exercise?";
  }

  if (classification.intent === 'distress') {
    return (
      "That sounds really heavy. Thanks for telling me.\n\n" +
      "If you're up for it, try this 60‑second reset:\n" +
      "1) Put both feet on the floor\n" +
      "2) Inhale 4 seconds\n" +
      "3) Exhale 6 seconds (repeat 5 times)\n\n" +
      "What’s the hardest part of this moment — thoughts, feelings, or something that happened?"
    );
  }

  if (includesAny(t, ['breath', 'breathing', 'panic'])) {
    return (
      "Let’s do it together.\n\n" +
      "Breathe in through your nose for 4… hold 2… out slowly for 6.\n" +
      "Repeat 5 times.\n\n" +
      "While you do that, can you name 3 things you can see around you?"
    );
  }

  return "I’m here with you. Tell me what’s going on in your day or what you’re feeling right now.";
}

export function buildCrisisFollowup(userAnswerRaw) {
  const t = String(userAnswerRaw || '').toLowerCase();
  const yes = ['yes', 'yep', 'yeah', 'haan', 'ha', 'yes i am', 'i am', 'right now'];
  const no = ['no', 'nope', 'nah', 'nahi', 'na'];
  const isYes = yes.some((p) => t.includes(p));
  const isNo = no.some((p) => t.includes(p));

  if (isYes) {
    return {
      severity: 'high',
      message:
        "Thank you for telling me. You deserve real support right now.\n\n" +
        "If you can, please contact your local emergency number right now. If you’re not alone, tell someone nearby what’s happening.\n\n" +
        "While you reach out: can you move anything you could use to hurt yourself out of reach and stay in a more public/safer space?",
    };
  }

  if (isNo) {
    return {
      severity: 'moderate',
      message:
        "Thank you — I’m relieved you’re not in immediate danger.\n\n" +
        "Even so, you don’t have to handle this alone. Would you like to message/call a trusted person now, or would you like a short plan for getting through the next hour safely?",
    };
  }

  return {
    severity: 'high',
    message:
      "Thanks — I want to make sure I understand.\n\n" +
      "Are you in immediate danger right now? You can reply with “yes” or “no”.",
  };
}

