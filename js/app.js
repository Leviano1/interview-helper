// app.js — runs the practice session.
//
// The app moves between four modes:
//
//   idle ──"next question"──► asking ──(question read out)──► answering
//    ▲                                                            │
//    │                                     "I'm done" or 5s of silence
//    │                                                            ▼
//    └──────────────"next question" / "follow up"─────────────  review
//
// Two things listen to the microphone at the same time:
//   1. SpeechRecognition (Chrome)  → the WORDS you said  → fillers, pace, "I" vs "we", result
//   2. Web Audio analyser          → the SOUND level     → long pauses, speaking time
//
// While the app is talking, the mic is paused so it doesn't score its own voice.

(function () {
  'use strict';

  const A = window.Analysis;
  const QUESTIONS = window.QUESTIONS;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Settings you might want to tweak
  // ---------------------------------------------------------------------------
  const END_SILENCE_MS = 5000;          // stop recording after this much silence
  const MAX_ANSWER_MS = 4 * 60 * 1000;  // hard cap on one answer
  const LONG_PAUSE_MS = 3000;           // a gap this long counts as a "long pause"
  const VOICE_MIN_LEVEL = 0.012;        // quietest sound that can count as voice
  const VOICE_NOISE_MULTIPLIER = 3;     // voice must be this many times louder than background

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    mode: 'idle',          // 'idle' | 'asking' | 'answering' | 'review'
    question: null,        // { category, text, hint }
    questionNumber: 0,
    category: 'Mixed',
    asked: new Set(),
    finals: '',            // confirmed words of the current answer
    interim: '',           // words still being recognised
    tracker: null,         // voice activity tracker (analysis.js)
    recogFirstAt: null,
    recogLastAt: null,
    answerStartedAt: null,
    history: [],           // one entry per answered question
    lastEntry: null,
    lastFeedback: '',
    followUp: null,
    scriptIndex: 0,        // which script question comes next
  };

  const AI = window.AI; // ai.js: Chrome built-in AI, Gemini or OpenAI

  // ---------------------------------------------------------------------------
  // Saved model answers ("My answers"), stored in this browser
  // ---------------------------------------------------------------------------
  // library = {
  //   "Tell me about yourself.": {
  //     question:    { category, text, hint },
  //     modelAnswer: "I'm a third-year software engineering student...",
  //     keyPoints:   ["Third-year software engineering at Glasgow", "Won the AI hackathon", ...],
  //     attempts:    [ { date, durationSec, wpm, fillers, covered, total }, ... ],
  //     updatedAt:   "2026-11-19T12:30:00Z"
  //   }
  // }
  const LIBRARY_KEY = 'rehearse-library';
  let library = {};
  try { library = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{}'); } catch (e) { library = {}; }

  function saveLibrary() {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); } catch (e) { console.warn('Could not save answers', e); }
    renderLibrary();
  }
  const savedFor = (q) => (q ? library[q.text] || null : null);

  // The model-answer editor shown under the feedback
  const editor = { open: false, text: '', points: '', loading: false, error: '' };
  function resetEditor() { Object.assign(editor, { open: false, text: '', points: '', loading: false, error: '' }); }

  // ---------------------------------------------------------------------------
  // Speaking (text → speech), with a queue so messages don't cut each other off
  // ---------------------------------------------------------------------------
  const synth = window.speechSynthesis;
  let voice = null;
  let isSpeaking = false;
  let speechToken = 0;
  const speechQueue = [];

  function pickVoice() {
    const voices = synth.getVoices();
    voice = voices.find((v) => v.lang === 'en-GB') || voices.find((v) => v.lang.startsWith('en')) || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }

  // Long text is split into sentences: Chrome sometimes stops speaking after ~15 seconds.
  function speak(text, onDone) {
    const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    sentences.forEach((s, i) => speechQueue.push({ text: s.trim(), onDone: i === sentences.length - 1 ? onDone : null }));
    if (!isSpeaking) speakNext();
  }

  function speakNext() {
    const item = speechQueue.shift();
    if (!item) {
      isSpeaking = false;
      startRecognition(); // finished talking, so listen again
      updateUI();
      return;
    }
    if (!synth || !item.text) {
      if (item.onDone) item.onDone();
      return speakNext();
    }
    isSpeaking = true;
    pauseRecognition();
    updateUI();

    const myToken = ++speechToken;
    const u = new SpeechSynthesisUtterance(item.text);
    if (voice) u.voice = voice;
    u.lang = 'en-GB';
    const finished = () => {
      if (myToken !== speechToken) return;
      speechToken++;
      if (item.onDone) item.onDone();
      speakNext();
    };
    u.onend = finished;
    u.onerror = finished;
    setTimeout(finished, 3000 + item.text.length * 90); // safety net if onend never fires
    synth.speak(u);
  }

  function stopSpeaking() {
    speechQueue.length = 0;
    speechToken++;
    if (synth) synth.cancel();
    isSpeaking = false;
    updateUI();
  }

  // ---------------------------------------------------------------------------
  // Listening (speech → text)
  // ---------------------------------------------------------------------------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let wantListening = false;
  let recognitionRunning = false;

  function setupRecognition() {
    if (!SpeechRecognition) {
      $('unsupported').classList.remove('hidden');
      $('startBtn').disabled = true;
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => { recognitionRunning = true; updateUI(); };
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) onFinalText(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      onInterimText(interim);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantListening = false;
        setStatus('Microphone blocked. Allow mic access in the address bar, then try again.');
      } else if (event.error === 'network') {
        setStatus('Speech recognition needs an internet connection.');
      }
    };
    recognition.onend = () => {
      recognitionRunning = false;
      if (wantListening && !isSpeaking) setTimeout(startRecognition, 250); // Chrome stops after silence
      updateUI();
    };
  }

  function startRecognition() {
    if (!recognition || recognitionRunning || isSpeaking || !wantListening) return;
    try { recognition.start(); } catch (e) { /* already starting */ }
  }
  function pauseRecognition() {
    if (recognition && recognitionRunning) recognition.abort();
  }

  function onInterimText(text) {
    if (state.mode === 'answering') {
      state.interim = text;
      if (text.trim()) markSpeechActivity();
      renderLiveTranscript();
    } else {
      $('heard').textContent = text ? `Hearing: “${text}”` : '';
    }
  }

  function onFinalText(text) {
    if (!text) return;
    if (state.mode === 'answering') {
      state.finals = (state.finals + ' ' + text).trim();
      state.interim = '';
      markSpeechActivity();
      const end = A.checkEndPhrase(state.finals);
      if (end.ended) { state.finals = end.transcript; return finishAnswer(); }
      renderLiveTranscript();
    } else {
      $('heard').textContent = '';
      handleCommand(text);
    }
  }

  function markSpeechActivity() {
    const now = Date.now();
    if (!state.recogFirstAt) state.recogFirstAt = now;
    state.recogLastAt = now;
  }

  // ---------------------------------------------------------------------------
  // Audio level meter (Web Audio): measures pauses
  // ---------------------------------------------------------------------------
  let analyser = null;
  let meterBuffer = null;
  let audioOk = false;
  let noiseFloor = 0.01;

  async function setupAudioMeter() {
    if (analyser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      meterBuffer = new Float32Array(analyser.fftSize);
      audioOk = true;
    } catch (e) {
      console.warn('Audio meter unavailable, pauses will not be measured.', e);
      audioOk = false;
    }
  }

  function tickMeter() {
    if (!audioOk) return;
    analyser.getFloatTimeDomainData(meterBuffer);
    let sum = 0;
    for (const v of meterBuffer) sum += v * v;
    const level = Math.sqrt(sum / meterBuffer.length); // RMS loudness, 0..1

    // Slowly learn how loud the room is when you're NOT talking
    if (level < noiseFloor * 1.5) noiseFloor = noiseFloor * 0.95 + level * 0.05;
    else noiseFloor *= 1.0005;
    const isVoice = level > Math.max(VOICE_MIN_LEVEL, noiseFloor * VOICE_NOISE_MULTIPLIER);

    const fill = $('meterFill');
    fill.style.width = `${Math.min(100, level * 400)}%`;
    fill.classList.toggle('voice', isVoice && !isSpeaking);

    if (state.mode === 'answering' && !isSpeaking) state.tracker.update(Date.now(), isVoice);
  }

  // Ends the answer after silence, and updates the timer on screen
  function tickAnswer() {
    if (state.mode !== 'answering' || isSpeaking) return;
    const now = Date.now();
    $('answerTimer').textContent = A.formatDuration((now - state.answerStartedAt) / 1000, true);

    if (now - state.answerStartedAt > MAX_ANSWER_MS) return finishAnswer();
    if (!state.recogLastAt) { setStatus('Your turn. Start answering whenever you are ready.'); return; }

    const silentFor = now - state.recogLastAt;
    if (silentFor >= END_SILENCE_MS) return finishAnswer();
    if (silentFor > 2000) setStatus(`Finishing in ${Math.ceil((END_SILENCE_MS - silentFor) / 1000)}… keep talking to continue`);
    else setStatus('Listening to your answer… say "I\'m done" when finished');
  }

  setInterval(() => { tickMeter(); tickAnswer(); }, 50);

  // Shows what the AI is doing and how long it has been waiting, e.g. "Asking Google Gemini… 12s"
  function updateLoadingText() {
    const entry = state.lastEntry;
    const secs = (t) => (t ? ` ${Math.floor((Date.now() - t) / 1000)}s` : '');
    const ai = document.getElementById('aiLoading');
    if (ai && entry) ai.textContent = `${entry.aiMsg || 'Getting feedback on your content…'}${secs(entry.aiStartedAt)}`;
    const model = document.getElementById('modelLoading');
    if (model) model.textContent = `${editor.loadingMsg || 'Writing your model answer…'}${secs(editor.startedAt)}`;
  }
  setInterval(updateLoadingText, 500);

  // ---------------------------------------------------------------------------
  // The practice flow
  // ---------------------------------------------------------------------------
  const HELP_TEXT =
    "During an answer, just talk. Say I'm done, or pause for 5 seconds, when you finish. " +
    'Between questions you can say: next question, repeat, how did I do, follow up, ' +
    'how did I do overall, or stop listening.';

  function handleCommand(text) {
    const cmd = A.parseCommand(text);
    if (cmd === 'unknown') return; // ignore chatter
    switch (cmd) {
      case 'next': return nextQuestion();
      case 'repeat': return state.question ? askQuestion(state.question, true) : speak('There is no question yet. Say next question.');
      case 'followUp': return askFollowUp();
      case 'feedback': return speak(state.lastFeedback || "You haven't answered a question yet. Say next question.");
      case 'summary': return speakSummary();
      case 'readModel': {
        const saved = savedFor(state.question);
        return speak(saved ? `Here's your model answer. ${saved.modelAnswer}` : "You haven't saved a model answer for this question yet.");
      }
      case 'practiseAgain': return state.question ? askQuestion(state.question) : speak('There is no question yet. Say next question.');
      case 'help': return speak(HELP_TEXT);
      case 'stopListening':
        wantListening = false;
        pauseRecognition();
        return speak("Okay, I've stopped listening. Press Start practice to carry on.");
    }
  }

  // Script items in the order they appeared in your file
  const scriptItems = () => Object.values(library).filter((i) => i.source === 'script').sort((a, b) => a.order - b.order);

  function nextQuestion() {
    if (state.category === 'Script') return nextScriptQuestion();
    let pool;
    if (state.category === 'Saved') {
      pool = Object.values(library).map((item) => item.question);
      if (!pool.length) {
        speak("You haven't saved any model answers yet, so here's a random question.");
        pool = QUESTIONS;
      }
    } else {
      pool = QUESTIONS.filter((q) => state.category === 'Mixed' || q.category === state.category);
    }
    let fresh = pool.filter((q) => !state.asked.has(q.text));
    if (!fresh.length) { pool.forEach((q) => state.asked.delete(q.text)); fresh = pool; }
    const q = fresh[Math.floor(Math.random() * fresh.length)];
    state.asked.add(q.text);
    state.followUp = null;
    askQuestion(q);
  }

  // ---------------------------------------------------------------------------
  // Script mode: go through your own questions in order, like flashcards
  // ---------------------------------------------------------------------------
  function nextScriptQuestion() {
    const items = scriptItems();
    if (!items.length) {
      return speak('You have not loaded a script yet. Paste one into the Load a script box first.');
    }
    if (state.scriptIndex >= items.length) {
      state.scriptIndex = 0;
      return speakScriptSummary(items);
    }
    const item = items[state.scriptIndex++];
    state.followUp = null;
    askQuestion(item.question);
  }

  function speakScriptSummary(items) {
    // Use each question's most recent attempt from this run through the script
    const scored = items.map((i) => ({ q: i.question.text, last: i.attempts[i.attempts.length - 1] }))
      .filter((x) => x.last && typeof x.last.percent === 'number');
    if (!scored.length) return speak("That's the end of your script. Say next question to start again.");
    const avg = Math.round(scored.reduce((sum, x) => sum + x.last.percent, 0) / scored.length);
    const weakest = scored.slice().sort((a, b) => a.last.percent - b.last.percent)[0];
    speak(`That's the end of your script. On average you hit ${avg} percent of your key points. ` +
      `The one to practise most is: ${weakest.q} Say next question to go through the script again.`);
    $('scriptMsg').textContent = `Script finished: ${avg}% of key points on average. Practise most: “${weakest.q}”`;
  }

  const EXAMPLE_SCRIPT = `# Interview Helper script
# Write each question after "Q:" and your answer after "A:".
# Answers can go over several lines. Lines starting with "-" are optional key points.
# Lines starting with # are ignored.

Q: Tell me about yourself.
A: I'm a third-year software engineering student. Recently I've been building
projects with voice and AI, and I enjoy hackathons because you go from an idea
to a working prototype in a day. Now I want to see how real products are built at scale.
- Third-year software engineering student
- Building projects with voice and AI
- Enjoy hackathons
- Want to learn how products are built at scale

Q: Tell me about a time you worked in a team.
A: In second year I was in a team of five building a Django web app in three weeks.
At first nobody had split the work, so I set up GitHub issues so everyone had clear
tasks, and I wrote the booking backend myself. We delivered two days early.
- Team of five building a Django app
- Set up GitHub issues
- Wrote the booking backend
- Delivered two days early

Q: Why do you want this internship?
A: Write your own answer here.
`;

  function loadScript(text) {
    const items = A.parseScript(text);
    if (!items.length) {
      $('scriptMsg').textContent = 'No questions found. Each question needs a line starting with "Q:" and an answer starting with "A:".';
      return;
    }
    // Replace any previous script, but keep practice history for questions that are still there
    const old = {};
    for (const [key, item] of Object.entries(library)) {
      if (item.source === 'script') { old[key] = item; delete library[key]; }
    }
    items.forEach((it, i) => {
      library[it.question] = {
        question: { category: 'Script', text: it.question, hint: '' },
        modelAnswer: it.answer,
        keyPoints: it.keyPoints,
        attempts: old[it.question] ? old[it.question].attempts : [],
        source: 'script',
        order: i,
        updatedAt: new Date().toISOString(),
      };
    });
    saveLibrary();
    state.category = 'Script';
    state.scriptIndex = 0;
    $('category').value = 'Script';
    $('scriptMsg').textContent = `✓ Loaded ${items.length} question${items.length === 1 ? '' : 's'}. Press "Practise my script" to start.`;
  }

  async function startScript() {
    if (!scriptItems().length) { $('scriptMsg').textContent = 'Load a script first.'; return; }
    stopSpeaking();
    state.category = 'Script';
    state.scriptIndex = 0;
    $('category').value = 'Script';
    await ensureStarted();
    nextScriptQuestion();
  }

  function downloadText(filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function askQuestion(q, isRepeat) {
    if ($('view-practise').classList.contains('hidden')) showView('practise');
    state.question = q;
    if (!isRepeat) state.questionNumber++;
    state.mode = 'asking';
    state.peek = false;
    render();
    speak(`${isRepeat ? '' : `Question ${state.questionNumber}. `}${q.text}`, beginAnswer);
  }

  function askFollowUp() {
    if (!state.followUp) {
      return speak(AI.isReady()
        ? 'There is no follow-up question yet. Answer a question first.'
        : 'Follow-up questions need AI. Switch it on in AI settings.');
    }
    askQuestion({ category: 'Follow-up', text: state.followUp, hint: 'Keep it short and specific. Follow-ups check that your story holds up.' });
    state.followUp = null;
  }

  function beginAnswer() {
    state.mode = 'answering';
    state.finals = '';
    state.interim = '';
    state.tracker = A.createVoiceTracker({ longPauseMs: LONG_PAUSE_MS });
    state.recogFirstAt = null;
    state.recogLastAt = null;
    state.answerStartedAt = Date.now();
    render();
    $('liveQuestion').textContent = state.question ? state.question.text : '';
    scrollToEl('livePanel'); // keep the timer and your words in view while you talk
  }

  // Smooth scroll, unless the user has asked their system for reduced motion
  function scrollToEl(id) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => $(id).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
  }

  function finishAnswer() {
    if (state.mode !== 'answering') return;
    state.mode = 'review';
    const raw = (state.finals + ' ' + state.interim).trim();
    state.interim = '';
    const transcript = A.checkEndPhrase(raw).transcript;

    if (A.tokenize(transcript).length < 3) {
      state.mode = 'idle';
      render();
      return speak("I didn't catch an answer there. Say repeat to hear the question again, or next question for a new one.");
    }

    // How long did they talk? Use the audio meter if it agrees with the speech
    // recogniser, otherwise fall back to the recogniser's timings.
    const recogSec = Math.max(1, (state.recogLastAt - state.recogFirstAt) / 1000 + 1);
    const voice = state.tracker.summary();
    const audioPlausible = audioOk && voice.heardVoice && voice.durationSec > recogSec * 0.5 && voice.durationSec < recogSec * 1.5 + 3;
    const durationSec = audioPlausible ? voice.durationSec : recogSec;
    const longPauses = audioPlausible ? voice.longPauses : null;

    const result = A.analyseAnswer({ transcript, durationSec, longPauses });
    // In script mode the comparison with your script IS the feedback, so skip the (slower) AI call
    const fromScript = savedFor(state.question)?.source === 'script';
    const useAI = AI.isReady() && !fromScript;
    const entry = { n: state.questionNumber, question: state.question, transcript, result, ai: null, aiStatus: useAI ? 'loading' : (fromScript ? 'script' : 'off') };

    // Compare against the saved model answer, if there is one
    let spoken = result.spoken;
    const saved = savedFor(state.question);
    if (saved) {
      const cov = A.keyPointCoverage(saved.keyPoints, transcript);
      const words = A.answerCoverage(saved.modelAnswer, transcript);
      // Headline score = key points hit (buzzwords), so you don't have to use the script's exact wording
      const keyPercent = cov.total ? Math.round((cov.covered / cov.total) * 100) : words.percent;
      entry.coverage = cov;
      entry.wordCoverage = words;
      entry.keyPercent = keyPercent;
      entry.previous = saved.attempts[saved.attempts.length - 1] || null;
      saved.attempts.push({
        date: new Date().toISOString(), durationSec: Math.round(durationSec), wpm: result.wpm,
        fillers: result.fillers.total, covered: cov.covered, total: cov.total, percent: keyPercent, wordPercent: words.percent,
      });
      saved.attempts = saved.attempts.slice(-20);
      saveLibrary();
      const missed = cov.points.filter((p) => !p.covered);
      spoken += ` You hit ${cov.covered} of ${cov.total} key points from your ${saved.source === 'script' ? 'script' : 'model answer'}. That's ${keyPercent} percent.`;
      if (missed.length) spoken += ` You missed: ${missed[0].point.replace(/[.!?]+$/, '')}.`;
    }

    state.history.push(entry);
    state.lastEntry = entry;
    state.lastFeedback = spoken;
    resetEditor();

    render();
    scrollToEl('feedback'); // jump straight to the results
    speak(spoken + (useAI
      ? ' Give me a moment for feedback on the content.'
      : fromScript && state.category === 'Script' ? ' Say next question for the next one in your script.' : ' Say next question when you are ready.'));
    if (useAI) getAIFeedback(entry);
  }

  function speakSummary() {
    const h = state.history;
    if (!h.length) return speak("You haven't answered any questions yet. Say next question to start.");
    const avg = (f) => h.reduce((s, e) => s + f(e), 0) / h.length;
    const fillerTotals = {};
    h.forEach((e) => Object.entries(e.result.fillers.byWord).forEach(([w, n]) => { fillerTotals[w] = (fillerTotals[w] || 0) + n; }));
    const topFiller = Object.entries(fillerTotals).sort((a, b) => b[1] - a[1])[0];

    // Which area most often wasn't green?
    const weak = {};
    h.forEach((e) => e.result.metrics.forEach((m) => { if (m.rating !== 'good') weak[m.label] = (weak[m.label] || 0) + 1; }));
    const weakest = Object.entries(weak).sort((a, b) => b[1] - a[1])[0];

    let s = `You've answered ${h.length} question${h.length === 1 ? '' : 's'}. `;
    s += `Your average answer was ${A.formatDuration(avg((e) => e.result.durationSec))} at ${Math.round(avg((e) => e.result.wpm))} words per minute. `;
    s += topFiller ? `Your most common filler was "${topFiller[0]}", ${topFiller[1]} times. ` : 'You used almost no filler words. ';
    s += weakest ? `The area to work on most is ${weakest[0].replace(/"/g, '')}.` : 'Every area looked strong. Great work!';
    speak(s);
  }

  // ---------------------------------------------------------------------------
  // AI feedback on the CONTENT (optional: see ai.js for the providers)
  // ---------------------------------------------------------------------------
  const SYSTEM_PROMPT =
    'You are a friendly but honest interview coach for university students applying to software ' +
    'engineering internships. Delivery (pace, filler words, pauses) is already measured, so judge the ' +
    'CONTENT of the answer. The answer comes from speech-to-text: it has no punctuation and may contain ' +
    'recognition mistakes, so do not comment on spelling or grammar. Reply with JSON only, with keys: ' +
    '"star": an object with keys situation, task, action, result, each "strong", "weak" or "missing" ' +
    '(use "n/a" for all four if the question is not a behavioural one); ' +
    '"strengths": array of 1-2 short specific strings; ' +
    '"improvements": array of 1-2 short specific, actionable strings; ' +
    '"spoken": at most 2 short sentences of feedback to read aloud, no lists; ' +
    '"followUp": one realistic follow-up question an interviewer would ask about this answer.';

  // JSON schemas describe the exact shape of reply we want. Chrome's built-in AI uses
  // them to force valid JSON; the cloud providers get the same shape described in the prompt.
  const STAR_VALUE = { type: 'string', enum: ['strong', 'weak', 'missing', 'n/a'] };
  const FEEDBACK_SCHEMA = {
    type: 'object',
    properties: {
      star: {
        type: 'object',
        properties: { situation: STAR_VALUE, task: STAR_VALUE, action: STAR_VALUE, result: STAR_VALUE },
        required: ['situation', 'task', 'action', 'result'],
      },
      strengths: { type: 'array', items: { type: 'string' } },
      improvements: { type: 'array', items: { type: 'string' } },
      spoken: { type: 'string' },
      followUp: { type: 'string' },
    },
    required: ['star', 'strengths', 'improvements', 'spoken', 'followUp'],
  };
  const MODEL_SCHEMA = {
    type: 'object',
    properties: {
      modelAnswer: { type: 'string' },
      keyPoints: { type: 'array', items: { type: 'string' } },
    },
    required: ['modelAnswer', 'keyPoints'],
  };

  // Writes (or improves) a model answer from YOUR attempt, without inventing anything.
  const MODEL_PROMPT =
    'You help a university student prepare a model answer for a software engineering internship interview. ' +
    'Rewrite their spoken attempt into a strong answer they can say out loud in 60 to 90 seconds (about 150 to 220 words). ' +
    'RULES: Use ONLY facts, projects, people and events the student actually mentioned. Never invent achievements, ' +
    'numbers, company names, technologies or results. Where a specific detail would make the answer stronger but is ' +
    'missing, insert a short placeholder in square brackets, e.g. [how many users?] or [what was the result?]. ' +
    'For behavioural questions use STAR (situation, task, action, result) and make clear what the student did ' +
    'personally ("I", not only "we"). Write in the first person, in natural spoken British English, with no bullet ' +
    'points or headings. The attempt comes from speech-to-text, so ignore filler words and recognition mistakes. ' +
    'If a current model answer is given, improve it: keep its content and add anything new and useful from the latest attempt. ' +
    'Reply with JSON only: {"modelAnswer": string, "keyPoints": array of 3 to 5 short phrases (3 to 7 words each) ' +
    'that use concrete keywords from the answer and together cover the situation, the actions and the result}.';

  async function buildModelAnswer() {
    const entry = state.lastEntry;
    if (!entry) return;
    syncEditorFromInputs();
    if (!AI.isReady()) {
      editor.error = 'Building with AI needs AI switched on (see AI settings). You can still write your own.';
      return renderModelSection(true);
    }
    const saved = savedFor(entry.question);
    const current = editor.open ? editor.text : (saved ? saved.modelAnswer : '');
    editor.loading = true;
    editor.loadingMsg = 'Writing your model answer from what you said…';
    editor.startedAt = Date.now();
    editor.error = '';
    renderModelSection(true);
    try {
      const userMsg =
        `Interview question: "${entry.question.text}"\n\n` +
        (current ? `Current model answer:\n"""${current}"""\n\n` : '') +
        `Latest spoken attempt:\n"""${entry.transcript}"""`;
      const out = await AI.ask({
        system: MODEL_PROMPT, user: userMsg, schema: MODEL_SCHEMA, maxTokens: 900,
        onStatus: (msg) => { editor.loadingMsg = msg; },
      });
      if (!out.modelAnswer) throw new Error('The AI returned no answer.');
      editor.open = true;
      editor.text = out.modelAnswer.trim();
      editor.points = (out.keyPoints || []).join('\n');
    } catch (err) {
      console.error(err);
      editor.error = `Couldn't build the answer. ${err.message}`;
    }
    editor.loading = false;
    renderModelSection(true);
  }

  async function getAIFeedback(entry) {
    const r = entry.result;
    const userMsg =
      `Interview question: "${entry.question.text}"\n\n` +
      `Candidate's spoken answer:\n"""${entry.transcript}"""\n\n` +
      `Measured delivery: ${A.formatDuration(r.durationSec)}, ${r.wpm} words per minute, ${r.fillers.total} filler words.`;
    try {
      entry.aiMsg = 'Getting feedback on your content…';
      entry.aiStartedAt = Date.now();
      const ai = await AI.ask({
        system: SYSTEM_PROMPT, user: userMsg, schema: FEEDBACK_SCHEMA, maxTokens: 600,
        onStatus: (msg) => { entry.aiMsg = msg; },
      });
      entry.ai = ai;
      entry.aiStatus = 'done';
      if (state.lastEntry === entry) {
        state.followUp = ai.followUp || null;
        if (ai.spoken) state.lastFeedback += ' ' + ai.spoken;
        if (state.mode === 'review') {
          speak((ai.spoken || '') + (ai.followUp
            ? ' I have a follow-up question. Say follow up to hear it, or next question.'
            : ' Say next question when you are ready.'));
        }
      }
    } catch (err) {
      console.error(err);
      entry.aiStatus = 'error';
      entry.aiError = err.message;
      if (state.lastEntry === entry && state.mode === 'review') speak("I couldn't get AI feedback this time. Say next question to carry on.");
    }
    render();
  }

  // ---------------------------------------------------------------------------
  // Pages: Practise / My answers / Settings (switched with the URL hash, e.g. #answers)
  // ---------------------------------------------------------------------------
  const VIEWS = ['practise', 'answers', 'settings'];

  function showView(name) {
    if (!VIEWS.includes(name)) name = 'practise';
    VIEWS.forEach((v) => $(`view-${v}`).classList.toggle('hidden', v !== name));
    document.querySelectorAll('[data-view]').forEach((link) => {
      const on = link.dataset.view === name;
      link.classList.toggle('active', on);
      if (on) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (name === 'settings') renderSettings();
    if (name === 'answers') { renderHistory(); renderLibrary(); renderStats(); }
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

  // ---------------------------------------------------------------------------
  // Small helpers for building the screen
  // ---------------------------------------------------------------------------
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(label, onClick, className, iconName) {
    const b = el('button', `btn ${className || 'btn-secondary'}`);
    b.type = 'button';
    if (iconName) b.insertAdjacentHTML('beforeend', icon(iconName, 16));
    if (label) b.appendChild(el('span', '', label));
    b.onclick = onClick;
    return b;
  }
  const tag = (text, tone) => el('span', `tag ${tone}`, text);
  const toneOf = (rating) => (rating === 'good' ? 'good' : rating === 'ok' ? 'warn' : 'bad');
  const percentTone = (pct) => (pct >= 75 ? 'good' : pct >= 50 ? 'ok' : 'bad');

  function progressBar(pct, thin) {
    const bar = el('div', `progress${thin ? ' thin' : ''}`);
    const fill = el('div');
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    bar.appendChild(fill);
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Screen: Practise page
  // ---------------------------------------------------------------------------
  function setStatus(text) { $('status').textContent = text; }

  function updateUI() {
    const btn = $('startBtn');
    btn.classList.toggle('running', wantListening);
    btn.innerHTML = wantListening ? `${icon('stop')}<span>Stop</span>` : `${icon('play')}<span>Start practice</span>`;
    if (!wantListening) setStatus(state.question ? 'Paused. Press Start practice to carry on.' : 'Press Start practice. You will need your microphone.');
    else if (isSpeaking) setStatus('Talking (mic paused)');
    else if (state.mode !== 'answering') setStatus('Listening for commands, e.g. "next question"');
    $('doneBtn').classList.toggle('hidden', state.mode !== 'answering');
    $('followUpBtn').classList.toggle('hidden', !state.followUp);
  }

  function render() {
    renderQuestion();
    $('livePanel').classList.toggle('hidden', state.mode !== 'answering');
    if (state.mode === 'answering') renderLiveTranscript();
    renderFeedback();
    renderModelSection(false);
    renderHistory();
    renderLibrary();
    renderStats();
    updateUI();
  }

  function renderQuestion() {
    const q = state.question;
    $('qCategory').classList.toggle('hidden', !q);
    $('qHint').classList.toggle('hidden', !q || !q.hint);
    if (!q) {
      $('qText').textContent = "Press Start practice and I'll ask you a question.";
      $('qNumber').textContent = '';
      $('savedRow').classList.add('hidden');
      $('peekList').classList.add('hidden');
      $('peekBtn').disabled = true;
      return;
    }
    const saved = savedFor(q);
    const inScript = state.category === 'Script' && saved?.source === 'script';
    $('qNumber').textContent = inScript ? `Q ${Math.max(state.scriptIndex, 1)} / ${scriptItems().length}` : `Q ${state.questionNumber}`;
    $('qText').textContent = q.text;
    $('qCategory').textContent = q.category.toUpperCase();
    $('qHint').textContent = q.hint || '';
    $('savedRow').classList.toggle('hidden', !saved);
    $('savedRow').textContent = saved?.source === 'script' ? 'IN YOUR SCRIPT' : 'MODEL ANSWER SAVED';
    $('peekBtn').disabled = !saved;
    $('peekBtn').innerHTML = `${icon(state.peek ? 'eyeOff' : 'eye')}<span>${state.peek ? 'Hide points' : 'Peek points'}</span>`;
    const ul = $('peekList');
    ul.classList.toggle('hidden', !saved || !state.peek);
    ul.innerHTML = '';
    if (saved) saved.keyPoints.forEach((p) => ul.appendChild(el('li', '', p)));
  }

  function renderLiveTranscript() {
    const box = $('liveTranscript');
    box.textContent = state.finals + ' ';
    box.appendChild(el('span', 'interim', state.interim));
    if (!state.finals && !state.interim) box.textContent = '…';
  }

  // The transcript with filler words highlighted
  function highlightedTranscript(transcript) {
    const frag = document.createDocumentFragment();
    const flagged = A.countFillers(transcript).flagged;
    A.tokenize(transcript).forEach((word, i) => {
      frag.appendChild(flagged.has(i) ? el('mark', '', word) : document.createTextNode(word));
      frag.appendChild(document.createTextNode(' '));
    });
    return frag;
  }

  // Status tags are always a word plus a colour (never colour alone)
  function tagWord(m, r) {
    if (m.rating === 'good') return 'GOOD';
    if (m.id === 'length') return r.durationSec < A.LIMITS.length.short ? 'SHORT' : 'LONG';
    if (m.id === 'pace') return r.wpm > A.LIMITS.pace.fast ? 'FAST' : 'SLOW';
    if (m.id === 'result') return 'ADD ONE';
    return m.rating === 'ok' ? 'IMPROVE' : 'FIX';
  }

  function renderFeedback() {
    const entry = state.lastEntry;
    const show = !!entry && state.mode !== 'answering' && state.mode !== 'asking';
    $('fbEmpty').classList.toggle('hidden', show);
    $('fbBody').classList.toggle('hidden', !show);
    $('scorePill').classList.toggle('hidden', !show);
    if (!show) { $('fbQuestion').textContent = ''; return; }
    const r = entry.result;
    $('fbQuestion').textContent = entry.question.text;
    const greens = r.metrics.filter((m) => m.rating === 'good').length;
    $('scorePill').textContent = `Score ${greens} / ${r.metrics.length}`;

    const tiles = $('tiles');
    tiles.innerHTML = '';
    for (const m of r.metrics) {
      const tile = el('div', `tile ${m.rating}`);
      const top = el('div', 'tile-top');
      top.appendChild(el('span', 'tile-label', m.label));
      top.appendChild(tag(tagWord(m, r), toneOf(m.rating)));
      tile.appendChild(top);
      tile.appendChild(el('div', 'tile-value', m.value));
      tile.appendChild(el('div', 'tile-tip', m.tip));
      tiles.appendChild(tile);
    }

    const chips = $('fillerChips');
    chips.innerHTML = '';
    const fillers = Object.entries(r.fillers.byWord).sort((a, b) => b[1] - a[1]);
    if (!fillers.length) chips.appendChild(el('span', 'muted small', 'No filler words detected.'));
    fillers.forEach(([w, n]) => chips.appendChild(el('span', 'chip', `${w} ×${n}`)));

    const tr = $('fbTranscript');
    tr.innerHTML = '';
    tr.appendChild(highlightedTranscript(entry.transcript));

    renderKeyCard(entry);
    renderCoach(entry);
  }

  function renderKeyCard(entry) {
    const box = $('keyCard');
    box.innerHTML = '';
    box.appendChild(el('h3', '', 'Key points hit'));
    if (!entry.coverage) {
      const saved = savedFor(entry.question);
      box.appendChild(el('p', 'muted', saved
        ? "Model answer saved. Practise this question again and I'll check which key points you hit."
        : "No model answer for this question yet. Load a script, or save a model answer below, and next time I'll check which key points you hit."));
      return;
    }
    const c = entry.coverage;
    const pct = entry.keyPercent;
    const big = el('div', 'big-num');
    big.appendChild(el('b', percentTone(pct), `${pct}%`));
    big.appendChild(el('span', 'muted', `${c.covered} of ${c.total} key points`));
    box.appendChild(big);
    box.appendChild(progressBar(pct));
    const grid = el('div', 'point-grid');
    c.points.forEach((p) => {
      const chip = el('div', `point ${p.covered ? 'hit' : 'miss'}`);
      chip.appendChild(el('span', 'mark', p.covered ? '✓' : '✗'));
      chip.appendChild(el('span', '', p.point));
      grid.appendChild(chip);
    });
    box.appendChild(grid);
    box.appendChild(el('p', 'muted small', `You also used ${entry.wordCoverage.percent}% of the exact words. You don't have to say it word for word.`));
    if (entry.previous) {
      const prev = entry.previous;
      const r = entry.result;
      box.appendChild(el('div', 'compare',
        `LAST TIME → NOW · key points ${prev.covered}/${prev.total} → ${c.covered}/${c.total} · ` +
        `fillers ${prev.fillers} → ${r.fillers.total} · pace ${prev.wpm} → ${r.wpm} wpm`));
    }
  }

  function renderCoach(entry) {
    const card = $('coachCard');
    const box = $('aiSection');
    box.innerHTML = '';
    card.classList.toggle('hidden', entry.aiStatus === 'script'); // the script comparison is the feedback
    if (entry.aiStatus === 'off') {
      const p = el('p', 'muted', 'Switch on AI in ');
      const link = el('a', '', 'Settings');
      link.href = '#settings';
      p.appendChild(link);
      p.appendChild(document.createTextNode(' (free options available) for feedback on what you said: STAR structure, strengths and a follow-up question.'));
      box.appendChild(p);
    } else if (entry.aiStatus === 'loading') {
      box.appendChild(el('p', 'muted', '')).id = 'aiLoading';
      updateLoadingText();
    } else if (entry.aiStatus === 'error') {
      box.appendChild(el('p', 'error', `Couldn't get AI feedback. ${entry.aiError || 'Check Settings.'}`));
    } else if (entry.ai) {
      const { star, strengths = [], improvements = [], followUp } = entry.ai;
      if (star && typeof star === 'object' && Object.values(star).some((v) => v && v !== 'n/a')) {
        const row = el('div', 'star-row');
        const tones = { strong: 'good', weak: 'warn', missing: 'bad' };
        for (const k of ['situation', 'task', 'action', 'result']) {
          const v = star[k] || 'missing';
          row.appendChild(tag(`${k.toUpperCase()} · ${v.toUpperCase()}`, tones[v] || 'muted-tag'));
        }
        box.appendChild(row);
      }
      const cols = el('div', 'coach-cols');
      const list = (title, items, cls) => {
        const b = el('div', 'coach-box');
        b.appendChild(el('h4', cls, title));
        const ul = el('ul');
        (items.length ? items : ['—']).forEach((t) => ul.appendChild(el('li', '', t)));
        b.appendChild(ul);
        cols.appendChild(b);
      };
      list('STRENGTHS', strengths, 'good-text');
      list('TO IMPROVE', improvements, 'warn-text');
      box.appendChild(cols);
      if (followUp) {
        const f = el('div', 'followup');
        f.insertAdjacentHTML('beforeend', icon('message', 18));
        f.appendChild(el('span', '', `Follow-up: “${followUp}”`));
        box.appendChild(f);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Model answer card (under the feedback)
  // ---------------------------------------------------------------------------
  function withPlaceholders(text) {
    const frag = document.createDocumentFragment();
    text.split(/(\[[^\]]+\])/).forEach((part) => {
      frag.appendChild(/^\[[^\]]+\]$/.test(part) ? el('mark', 'placeholder', part) : document.createTextNode(part));
    });
    return frag;
  }

  const parsePoints = (text) => (text || '').split('\n').map((p) => p.replace(/^\s*([-•*]|\d+[.)])\s+/, '').trim()).filter(Boolean);

  function syncEditorFromInputs() {
    if (!editor.open) return;
    if ($('modelText')) editor.text = $('modelText').value;
    if ($('keyPointsText')) editor.points = $('keyPointsText').value;
  }

  function openEditor() {
    const entry = state.lastEntry;
    const saved = savedFor(entry.question);
    editor.open = true;
    editor.error = '';
    editor.text = saved ? saved.modelAnswer : entry.transcript; // start from what you said
    editor.points = saved ? saved.keyPoints.join('\n') : '';
    renderModelSection(true);
  }

  function saveModelAnswer() {
    syncEditorFromInputs();
    const entry = state.lastEntry;
    const text = editor.text.trim();
    if (!text) { editor.error = 'Write or build an answer first.'; return renderModelSection(true); }
    let points = parsePoints(editor.points);
    if (!points.length) points = A.fallbackKeyPoints(text);
    const existing = library[entry.question.text];
    library[entry.question.text] = {
      ...(existing || {}),
      question: entry.question,
      modelAnswer: text,
      keyPoints: points,
      attempts: existing ? existing.attempts : [],
      source: existing?.source || 'manual',
      updatedAt: new Date().toISOString(),
    };
    saveLibrary();
    editor.open = false;
    editor.error = '';
    editor.justSaved = true;
    render();
  }

  function updateEditorInfo() {
    const text = $('modelText').value;
    const words = A.tokenize(text).length;
    const holes = A.findPlaceholders(text);
    $('editorInfo').textContent =
      `≈ ${words} words · about ${A.formatDuration((words / 140) * 60)} spoken` +
      (holes.length ? ` · ${holes.length} placeholder${holes.length === 1 ? '' : 's'} to fill in: ${holes.join(', ')}` : '');
  }

  function renderModelSection(force) {
    const box = $('modelSection');
    const entry = state.lastEntry;
    if (!entry) return;
    if (editor.open && !force) return; // don't wipe what you're typing
    syncEditorFromInputs();
    box.innerHTML = '';
    const saved = savedFor(entry.question);
    const foot = () => { const f = el('div', 'card-foot'); box.appendChild(f); return f; };

    if (editor.loading) {
      box.appendChild(el('p', 'muted', '')).id = 'modelLoading';
      updateLoadingText();
      return; // no buttons while waiting, so it can't be clicked twice
    }
    if (editor.error) box.appendChild(el('p', 'error', editor.error));

    // 1. Editing
    if (editor.open) {
      box.appendChild(el('p', 'muted small', "Edit anything so it sounds like you. Replace any [placeholders] with real details. Never claim something you didn't do."));
      const ta = el('textarea', 'field dashed');
      ta.id = 'modelText';
      ta.rows = 9;
      ta.value = editor.text;
      ta.oninput = updateEditorInfo;
      box.appendChild(ta);
      box.appendChild(el('p', 'editor-info', '')).id = 'editorInfo';
      const label = el('label', 'field-label', 'Key points, one per line (used to check your next attempts)');
      const kp = el('textarea', 'field mono');
      kp.id = 'keyPointsText';
      kp.rows = 4;
      kp.value = editor.points;
      kp.placeholder = 'Leave empty to use the sentences of your answer';
      label.appendChild(kp);
      box.appendChild(label);
      const f = foot();
      f.appendChild(button('Cancel', () => { editor.open = false; editor.error = ''; renderModelSection(true); }));
      if (AI.isReady()) f.appendChild(button('Improve with AI', buildModelAnswer, 'btn-secondary', 'sparkles'));
      f.appendChild(button('Save model answer', saveModelAnswer, 'btn-primary', 'save'));
      updateEditorInfo();
      return;
    }

    // 2. A model answer is saved for this question
    if (saved) {
      if (!entry.wordCoverage) {
        box.appendChild(el('p', 'saved-note', editor.justSaved
          ? 'Saved. Practise this question again to see how close you get.'
          : 'You have a saved model answer for this question. Practise again to compare.'));
      }
      editor.justSaved = false;
      const p = el('p', 'model-text');
      if (entry.wordCoverage) {
        const legend = el('div', 'legend');
        const item = (cls, sample, text) => { const s = el('span'); s.appendChild(el('span', cls, sample)); s.appendChild(document.createTextNode(text)); legend.appendChild(s); };
        item('w-said', 'underlined', ' = you said it');
        item('w-missed', 'crossed out', ' = you missed it');
        box.appendChild(legend);
        A.markModelAnswer(saved.modelAnswer, entry.transcript).forEach((m) => {
          p.appendChild(m.status === 'plain' ? document.createTextNode(m.text) : el('span', `w-${m.status}`, m.text));
        });
      } else {
        p.appendChild(withPlaceholders(saved.modelAnswer));
      }
      box.appendChild(p);

      const f = foot();
      const again = async () => { stopSpeaking(); await ensureStarted(); askQuestion(entry.question); };
      if (state.category === 'Script' && saved.source === 'script') {
        f.appendChild(button('Try this one again', again, 'btn-secondary', 'repeat'));
      }
      f.appendChild(button('Read it to me', () => { stopSpeaking(); speak(saved.modelAnswer); }, 'btn-secondary', 'volume'));
      f.appendChild(button('Edit', openEditor, 'btn-secondary', 'pencil'));
      if (AI.isReady()) f.appendChild(button('Improve with this attempt', buildModelAnswer, 'btn-secondary', 'sparkles'));
      if (state.category === 'Script' && saved.source === 'script') {
        f.appendChild(button('Next script question', async () => { stopSpeaking(); await ensureStarted(); nextScriptQuestion(); }, 'btn-primary', 'next'));
      } else {
        f.appendChild(button('Practise again', again, 'btn-primary', 'repeat'));
      }
      return;
    }

    // 3. Nothing saved yet
    box.appendChild(el('p', 'muted', 'Turn this answer into a model answer you can practise against next time.'));
    if (!AI.isReady()) box.appendChild(el('p', 'muted small', 'Building with AI needs AI switched on in Settings (free options available). "Write my own" starts from your transcript.'));
    const f = foot();
    f.appendChild(button('Write my own', openEditor, 'btn-secondary', 'pencil'));
    f.appendChild(button('Build it with AI', buildModelAnswer, AI.isReady() ? 'btn-primary' : 'btn-secondary', 'sparkles'));
  }

  // ---------------------------------------------------------------------------
  // Screen: My answers page
  // ---------------------------------------------------------------------------
  function renderStats() {
    const h = state.history;
    const delivery = h.length
      ? `${Math.round((h.reduce((s, e) => s + e.result.metrics.filter((m) => m.rating === 'good').length / e.result.metrics.length, 0) / h.length) * 100)}%`
      : '—';
    const scored = h.filter((e) => typeof e.keyPercent === 'number');
    const keys = scored.length ? `${Math.round(scored.reduce((s, e) => s + e.keyPercent, 0) / scored.length)}%` : '—';
    const box = $('statTiles');
    box.innerHTML = '';
    [['Saved answers', Object.keys(library).length], ['Attempts this session', h.length], ['Avg delivery score', delivery], ['Avg key points hit', keys]]
      .forEach(([label, value]) => {
        const s = el('div', 'stat');
        s.appendChild(el('div', 'tile-label', label));
        s.appendChild(el('div', 'tile-value', String(value)));
        box.appendChild(s);
      });
  }

  function renderHistory() {
    const body = $('historyBody');
    body.innerHTML = '';
    if (!state.history.length) {
      const tr = el('tr', 'empty-row');
      const td = el('td', '', 'No answers yet this session. Go to Practise and press Start practice.');
      td.colSpan = 7;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (const e of state.history.slice().reverse()) {
      const tr = el('tr');
      const greens = e.result.metrics.filter((m) => m.rating === 'good').length;
      const total = e.result.metrics.length;
      [e.n, e.question.text, A.formatDuration(e.result.durationSec, true), e.result.wpm, e.result.fillers.total,
        e.coverage ? `${e.coverage.covered}/${e.coverage.total}` : '—']
        .forEach((c, i) => tr.appendChild(el('td', i === 1 ? '' : 'num', String(c))));
      const td = el('td');
      td.appendChild(tag(`${greens} / ${total}`, greens / total >= 0.75 ? 'good' : greens / total >= 0.5 ? 'warn' : 'bad'));
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  function bestPercent(item) {
    return item.attempts.reduce((m, a) => Math.max(m, typeof a.percent === 'number' ? a.percent : (a.total ? Math.round((a.covered / a.total) * 100) : 0)), 0);
  }

  function renderLibrary() {
    const list = $('libraryList');
    // Script questions first, in script order; then other saved answers, newest first
    const items = Object.values(library).sort((a, b) => {
      const sa = a.source === 'script' ? 0 : 1;
      const sb = b.source === 'script' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (sa === 0) return a.order - b.order;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    list.innerHTML = '';
    if (!items.length) {
      const empty = el('div', 'card dashed-card empty lib-empty');
      empty.appendChild(el('p', 'muted', 'No saved answers yet. Load a script on the Practise page, click New answer, or save a model answer after you answer a question.'));
      list.appendChild(empty);
      return;
    }
    for (const item of items) {
      const card = el('div', 'lib-card');
      const a = item.attempts;
      const top = el('div', 'lib-top');
      const tags = el('div', 'chips');
      tags.style.marginTop = '0';
      tags.appendChild(a.length ? tag('PRACTISED', 'good') : tag('NEW', 'warn'));
      if (item.source === 'script') tags.appendChild(tag('SCRIPT', 'accent'));
      top.appendChild(tags);
      top.appendChild(el('span', 'lib-meta', `${item.keyPoints.length} key point${item.keyPoints.length === 1 ? '' : 's'}`));
      card.appendChild(top);
      card.appendChild(el('div', 'lib-q', item.question.text));

      const best = bestPercent(item);
      const score = el('div');
      const label = el('div', 'lib-score');
      label.appendChild(el('span', '', 'Best key points'));
      label.appendChild(el('span', 'mono', a.length ? `${best}%` : '—'));
      score.appendChild(label);
      score.appendChild(progressBar(a.length ? best : 0, true));
      card.appendChild(score);

      const last = a[a.length - 1];
      card.appendChild(el('div', 'lib-meta', a.length
        ? `${a.length} attempt${a.length === 1 ? '' : 's'} · last ${typeof last.percent === 'number' ? `${last.percent}%` : `${last.covered}/${last.total}`}`
        : 'Not practised yet'));

      const actions = el('div', 'lib-actions');
      actions.appendChild(button('Practise', async () => { stopSpeaking(); await ensureStarted(); askQuestion(item.question); }, 'btn-white', 'play'));
      const edit = button('', () => openAnswerForm(item), 'btn-secondary btn-icon', 'pencil');
      edit.setAttribute('aria-label', `Edit "${item.question.text}"`);
      edit.title = 'Edit';
      actions.appendChild(edit);
      const del = button('', () => {
        if (window.confirm(`Delete your saved answer for "${item.question.text}"?`)) {
          delete library[item.question.text];
          saveLibrary();
          render();
        }
      }, 'btn-secondary btn-icon btn-danger', 'trash');
      del.setAttribute('aria-label', `Delete "${item.question.text}"`);
      del.title = 'Delete';
      actions.appendChild(del);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  // New / edit answer form on the My answers page
  let editingKey = null;
  function openAnswerForm(item) {
    editingKey = item ? item.question.text : null;
    $('afLabel').textContent = item ? 'EDIT ANSWER' : 'NEW ANSWER';
    $('afQuestion').value = item ? item.question.text : '';
    $('afAnswer').value = item ? item.modelAnswer : '';
    $('afPoints').value = item ? item.keyPoints.join('\n') : '';
    $('afMsg').textContent = '';
    $('answerForm').classList.remove('hidden');
    $('answerForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('afQuestion').focus({ preventScroll: true });
  }

  function saveAnswerForm() {
    const q = $('afQuestion').value.trim();
    const answer = $('afAnswer').value.trim();
    if (!q || !answer) { $('afMsg').textContent = 'Add a question and an answer.'; return; }
    let points = parsePoints($('afPoints').value);
    if (!points.length) points = A.fallbackKeyPoints(answer);
    const old = (editingKey && library[editingKey]) || library[q];
    if (editingKey && editingKey !== q) delete library[editingKey];
    library[q] = {
      question: { category: old?.question.category || 'My answers', text: q, hint: old?.question.hint || '' },
      modelAnswer: answer,
      keyPoints: points,
      attempts: old ? old.attempts : [],
      source: old?.source || 'manual',
      order: old?.order ?? 0,
      updatedAt: new Date().toISOString(),
    };
    saveLibrary();
    $('answerForm').classList.add('hidden');
    $('libraryMsg').textContent = `Saved “${q}”.`;
    render();
  }

  function exportLibrary() {
    const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'interview-helper-answers.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importLibrary(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let count = 0;
        for (const [key, item] of Object.entries(data)) {
          if (item && item.question && item.modelAnswer && Array.isArray(item.keyPoints)) {
            library[key] = { attempts: [], ...item };
            count++;
          }
        }
        saveLibrary();
        render();
        $('libraryMsg').textContent = `Imported ${count} answer${count === 1 ? '' : 's'}.`;
      } catch (e) {
        $('libraryMsg').textContent = "That file doesn't look like an Interview Helper export.";
      }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Screen: Settings page
  // ---------------------------------------------------------------------------
  const CHROME_STATUS_TEXT = {
    available: 'Ready. Runs on this computer: free, no key, and your answers never leave your laptop.',
    downloadable: 'Supported on this computer. Click below for a one-time model download (a few GB).',
    downloading: 'Downloading the on-device model…',
    unavailable: "This computer can't run it (needs 16 GB RAM or a GPU with 4 GB+ VRAM, and 22 GB free disk). Try Google Gemini instead: it's free too.",
    unsupported: "Not available in this browser. It needs Chrome 148 or newer on a desktop. Try Google Gemini instead: it's free too.",
    unknown: 'Checking…',
  };

  function selectedProvider() {
    const r = document.querySelector('input[name="provider"]:checked');
    return r ? r.value : AI.provider();
  }

  function renderSettings(chosen) {
    const p = chosen || AI.provider();
    document.querySelectorAll('input[name="provider"]').forEach((r) => {
      r.checked = r.value === p;
      r.closest('.radio-card').classList.toggle('selected', r.value === p);
    });
    const info = AI.PROVIDERS[p];
    $('chromeBox').classList.toggle('hidden', p !== 'chrome');
    $('keyBox').classList.toggle('hidden', !info.needsKey);
    $('offBox').classList.toggle('hidden', p !== 'none');
    if (p === 'chrome') {
      $('chromeStatus').textContent = CHROME_STATUS_TEXT[AI.chromeStatus] || AI.chromeStatus;
      $('chromeEnable').classList.toggle('hidden', !['downloadable', 'downloading'].includes(AI.chromeStatus));
    }
    if (info.needsKey) {
      $('keyHelp').textContent = info.keyHelp;
      $('apiKey').value = AI.settings.keys[p] || '';
      $('model').value = AI.settings.models[p] || '';
      $('model').placeholder = info.defaultModel;
    }
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------
  async function ensureStarted() {
    await setupAudioMeter();
    if (!wantListening) {
      wantListening = true;
      startRecognition();
    }
    updateUI();
  }

  function wireUpButtons() {
    $('startBtn').onclick = async () => {
      if (wantListening) {
        wantListening = false;
        stopSpeaking();
        pauseRecognition();
        if (state.mode === 'answering' || state.mode === 'asking') { state.mode = 'idle'; render(); }
        updateUI();
        return;
      }
      await ensureStarted();
      if (!state.question) {
        speak("Hi! Let's practise. Answer out loud, and say I'm done when you finish.");
        nextQuestion();
      } else if (state.mode === 'idle') {
        speak('Welcome back. Say next question, or repeat.');
      }
    };
    $('nextBtn').onclick = async () => { stopSpeaking(); await ensureStarted(); nextQuestion(); };
    $('repeatBtn').onclick = async () => { stopSpeaking(); await ensureStarted(); if (state.question) askQuestion(state.question, true); else nextQuestion(); };
    $('doneBtn').onclick = () => finishAnswer();
    $('followUpBtn').onclick = async () => { stopSpeaking(); await ensureStarted(); askFollowUp(); };
    $('peekBtn').onclick = () => { state.peek = !state.peek; renderQuestion(); };

    $('category').onchange = (e) => { state.category = e.target.value; state.scriptIndex = 0; };
    $('scriptLoadBtn').onclick = () => loadScript($('scriptText').value);
    $('scriptFileBtn').onclick = () => $('scriptFile').click();
    $('scriptFile').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { $('scriptText').value = reader.result; loadScript(reader.result); };
      reader.readAsText(file);
      e.target.value = '';
    };
    $('scriptExampleBtn').onclick = () => { $('scriptText').value = EXAMPLE_SCRIPT; $('scriptMsg').textContent = 'Example pasted below. Edit it, then press Load script.'; };
    $('scriptDownloadBtn').onclick = () => downloadText('interview-script.txt', $('scriptText').value.trim() ? $('scriptText').value : EXAMPLE_SCRIPT);
    $('scriptStartBtn').onclick = startScript;
    $('customForm').onsubmit = async (e) => {
      e.preventDefault();
      const text = $('customInput').value.trim();
      if (!text) return;
      $('customInput').value = '';
      stopSpeaking();
      await ensureStarted();
      askQuestion({ category: 'Your question', text, hint: '' });
    };

    // My answers
    $('exportBtn').onclick = exportLibrary;
    $('importBtn').onclick = () => $('importFile').click();
    $('importFile').onchange = (e) => { if (e.target.files[0]) importLibrary(e.target.files[0]); e.target.value = ''; };
    $('newAnswerBtn').onclick = () => openAnswerForm(null);
    $('afSave').onclick = saveAnswerForm;
    $('afCancel').onclick = () => $('answerForm').classList.add('hidden');

    // Settings
    document.querySelectorAll('input[name="provider"]').forEach((r) => {
      r.onchange = () => { $('settingsMsg').textContent = ''; renderSettings(r.value); };
    });
    $('cancelSettings').onclick = () => { renderSettings(); $('settingsMsg').textContent = 'Changes discarded.'; };
    $('chromeEnable').onclick = async () => {
      $('chromeEnable').disabled = true;
      try {
        await AI.enableChrome((loaded) => { $('chromeStatus').textContent = `Downloading the on-device model… ${Math.round(loaded * 100)}%`; });
        AI.settings.provider = 'chrome';
        AI.save();
        $('settingsMsg').textContent = 'On-device AI is ready.';
      } catch (e) {
        console.error(e);
        $('settingsMsg').textContent = `Couldn't enable on-device AI: ${e.message}`;
      }
      $('chromeEnable').disabled = false;
      renderSettings();
      render();
    };
    $('saveSettings').onclick = () => {
      const p = selectedProvider();
      AI.settings.provider = p;
      if (AI.PROVIDERS[p].needsKey) {
        AI.settings.keys[p] = $('apiKey').value.trim();
        AI.settings.models[p] = $('model').value.trim();
      }
      AI.save();
      $('settingsMsg').textContent = AI.isReady() ? `Saved · ${AI.describe()}` : 'Saved. AI is off: delivery feedback still works.';
      renderSettings();
      render();
    };
  }

  // For automated testing only: pretend an answer was spoken.
  window.__rehearseTest = {
    simulateAnswer(text, seconds) {
      if (!state.question) { state.question = QUESTIONS[3]; state.questionNumber = 1; }
      beginAnswer();
      state.finals = text;
      state.recogFirstAt = Date.now() - seconds * 1000;
      state.recogLastAt = Date.now() - 1000;
      finishAnswer();
    },
    command: handleCommand,
    begin() { if (!state.question) { state.question = QUESTIONS[0]; state.questionNumber = 1; } beginAnswer(); },
    say(text, seconds) { state.finals = text; state.recogFirstAt = Date.now() - seconds * 1000; state.recogLastAt = Date.now(); },
  };

  setupRecognition();
  wireUpButtons();
  renderSettings();
  render();
  showView(location.hash.slice(1) || 'practise');
  AI.checkChrome().then(() => { renderSettings(); render(); });
})();
