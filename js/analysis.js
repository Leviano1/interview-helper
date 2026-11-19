// analysis.js — scores a spoken answer. No browser code in here, just plain
// functions, so everything can be unit-tested with Node (tests/analysis.test.js).
//
//   analyseAnswer({ transcript, durationSec, longPauses })
//     -> { words, wpm, fillers, metrics: [ {id, label, value, rating, tip} ], spoken }
//
// rating is 'good' | 'ok' | 'bad' (shown on screen as green / amber / red).

(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Tunable thresholds: change these to make the coach stricter or kinder
  // ---------------------------------------------------------------------------
  const LIMITS = {
    length: { tooShort: 30, short: 60, long: 150, tooLong: 180 },  // seconds
    pace: { slow: 100, fast: 170, tooFast: 200 },                  // words per minute
    fillerRate: { good: 2, ok: 5 },                                // fillers per minute
    longPauses: { good: 1, ok: 3 },                                // pauses of 3s+
  };

  // ---------------------------------------------------------------------------
  // Words
  // ---------------------------------------------------------------------------
  const norm = (w) => w.toLowerCase().replace(/[^a-z0-9'%]/g, '');

  function tokenize(transcript) {
    return (transcript || '').split(/\s+/).filter(Boolean);
  }

  const HESITATIONS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'err', 'ah', 'hmm', 'mm']);
  const SINGLE_FILLERS = new Set(['basically', 'literally', 'actually']);

  // "like" is only a filler when it isn't being used as a verb/comparison.
  //   "I like Java"          -> not a filler (after "I")
  //   "I would like to"      -> not a filler (before "to")
  //   "it was like really hard" -> filler
  const LIKE_REAL_BEFORE = new Set([
    'i', "i'd", 'we', "we'd", 'you', "you'd", 'they', "they'd", 'he', 'she', 'would',
    'look', 'looks', 'looked', 'looking', 'feel', 'feels', 'felt', 'seem', 'seems',
    'seemed', 'sound', 'sounds', 'sounded', 'something', 'anything', 'nothing',
    'things', 'stuff', "didn't", "don't", "doesn't", 'really', 'also', 'more', 'most',
  ]);
  // "what kind of", "this sort of" are real uses
  const KIND_REAL_BEFORE = new Set([
    'what', 'this', 'that', 'the', 'a', 'any', 'some', 'which', 'every', 'each',
    'same', 'different', 'one', 'another', 'those', 'these', 'all',
  ]);
  // "do you know", "if you know" are real uses
  const YOU_KNOW_REAL_BEFORE = new Set([
    'do', 'did', 'if', 'would', 'will', "don't", "didn't", 'might', 'could', 'should', 'as',
  ]);

  // Returns { total, byWord: { like: 3, um: 1 }, flagged: Set of token indexes }
  function countFillers(transcript) {
    const tokens = tokenize(transcript).map(norm);
    const byWord = {};
    const flagged = new Set();
    const add = (label, ...idx) => {
      byWord[label] = (byWord[label] || 0) + 1;
      idx.forEach((i) => flagged.add(i));
    };

    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i];
      const prev = tokens[i - 1];
      const next = tokens[i + 1];

      if (HESITATIONS.has(w)) add('um / uh', i);
      else if (SINGLE_FILLERS.has(w)) add(w, i);
      else if (w === 'like' && !LIKE_REAL_BEFORE.has(prev) && next !== 'to') add('like', i);
      else if ((w === 'kind' || w === 'sort') && next === 'of' && !KIND_REAL_BEFORE.has(prev)) { add(`${w} of`, i, i + 1); i++; }
      else if (w === 'you' && next === 'know' && !YOU_KNOW_REAL_BEFORE.has(prev)) { add('you know', i, i + 1); i++; }
      else if (w === 'i' && next === 'mean' && !['it', 'that', 'to', 'the', 'what'].includes(tokens[i + 2])) { add('I mean', i, i + 1); i++; }
    }
    const total = Object.values(byWord).reduce((a, b) => a + b, 0);
    return { total, byWord, flagged };
  }

  // Interviewers want to hear what YOU did, not just the team.
  function ownership(transcript) {
    const tokens = tokenize(transcript).map(norm);
    let i = 0;
    let we = 0;
    for (const w of tokens) {
      if (['i', "i'm", "i've", "i'd", "i'll", 'me', 'my', 'myself'].includes(w)) i++;
      else if (['we', "we're", "we've", "we'd", "we'll", 'us', 'our', 'ourselves'].includes(w)) we++;
    }
    return { i, we };
  }

  // Did they finish with an outcome? Numbers and result words are good signs.
  const RESULT_CUES = /\b(result|results|outcome|in the end|ended up|which meant|that meant|so that|achieved|improved|reduced|increased|saved|won|delivered|launched|finished|completed|learned|learnt|feedback|grade|award|placed|first place|got an a)\b/i;
  const NUMBER_CUE = /\b\d+(\.\d+)?\s?(%|percent|hours?|days?|weeks?|people|users|times|x)?\b|\b(twice|double|half|first|second|third)\b/i;

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  function formatDuration(totalSeconds, short) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (short) return m ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
    const part = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (!m) return part(sec, 'second');
    return sec ? `${part(m, 'minute')} ${part(sec, 'second')}` : part(m, 'minute');
  }

  // ---------------------------------------------------------------------------
  // The main scorer
  // ---------------------------------------------------------------------------
  function analyseAnswer({ transcript, durationSec, longPauses = null }) {
    const words = tokenize(transcript).length;
    const minutes = Math.max(durationSec, 1) / 60;
    const wpm = Math.round(words / minutes);
    const fillers = countFillers(transcript);
    const fillerRate = fillers.total / minutes;
    const own = ownership(transcript);
    const L = LIMITS;
    const metrics = [];

    // 1. Length
    let rating = 'good';
    let tip = 'Good length: enough detail without rambling.';
    if (durationSec < L.length.tooShort) { rating = 'bad'; tip = 'Too short. Aim for 1 to 2 minutes with a specific example.'; }
    else if (durationSec < L.length.short) { rating = 'ok'; tip = 'A bit short. Add more detail about what you did.'; }
    else if (durationSec > L.length.tooLong) { rating = 'bad'; tip = 'Too long. Try to finish within 2 and a half minutes.'; }
    else if (durationSec > L.length.long) { rating = 'ok'; tip = 'Getting long. Cut the background and get to your actions sooner.'; }
    metrics.push({ id: 'length', label: 'Length', value: formatDuration(durationSec, true), rating, tip });

    // 2. Pace
    rating = 'good'; tip = 'Nice, clear pace.';
    if (wpm > L.pace.tooFast) { rating = 'bad'; tip = 'Much too fast. Slow down and pause between points.'; }
    else if (wpm > L.pace.fast) { rating = 'ok'; tip = 'A bit fast. Take a breath between sentences.'; }
    else if (wpm < L.pace.slow) { rating = 'ok'; tip = 'Quite slow. It can sound unsure, so try to keep moving.'; }
    metrics.push({ id: 'pace', label: 'Pace', value: `${wpm} wpm`, rating, tip });

    // 3. Fillers
    let top = Object.entries(fillers.byWord).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] < 2) top = null; // only call out a filler that was repeated
    rating = 'good'; tip = 'Very few filler words. Sounds confident.';
    if (fillerRate > L.fillerRate.ok) { rating = 'bad'; tip = `Lots of filler words${top ? `, especially "${top[0]}"` : ''}. Try pausing silently instead.`; }
    else if (fillerRate > L.fillerRate.good) { rating = 'ok'; tip = `Some filler words${top ? ` ("${top[0]}" ${top[1]} times)` : ''}. A silent pause sounds better.`; }
    metrics.push({ id: 'fillers', label: 'Filler words', value: String(fillers.total), rating, tip });

    // 4. Long pauses (only if we could measure the audio)
    if (longPauses !== null) {
      rating = 'good';
      tip = longPauses === 0 ? 'Smooth delivery with no long gaps.' : 'Only one long pause. That\'s fine.';
      if (longPauses > L.longPauses.ok) { rating = 'bad'; tip = 'Several long pauses. Plan your example before you start speaking.'; }
      else if (longPauses > L.longPauses.good) { rating = 'ok'; tip = 'A couple of long pauses. A short pause is fine, but a long one loses the thread.'; }
      metrics.push({ id: 'pauses', label: 'Long pauses', value: String(longPauses), rating, tip });
    }

    // 5. "I" vs "we"
    if (words >= 20) {
      rating = 'good'; tip = 'Good: you made clear what you did yourself.';
      if (own.i === 0 && own.we === 0) { rating = 'ok'; tip = 'Say who did what. Use "I" for your own actions.'; }
      else if (own.we > own.i) { rating = 'ok'; tip = `You said "we" ${own.we} times and "I" ${own.i}. Interviewers want to hear what YOU did.`; }
      metrics.push({ id: 'ownership', label: '"I" vs "we"', value: `${own.i} : ${own.we}`, rating, tip });
    }

    // 6. Result
    const hasResult = RESULT_CUES.test(transcript);
    const hasNumber = NUMBER_CUE.test(transcript);
    rating = hasResult ? 'good' : 'ok';
    tip = hasResult
      ? (hasNumber ? 'Great: you ended with a result and a number.' : 'Good: you mentioned an outcome. A number would make it stronger.')
      : 'End with the result. What changed because of you? Numbers help.';
    metrics.push({ id: 'result', label: 'Result', value: hasResult ? '✓' : '✗', rating, tip });

    return { words, wpm, durationSec, fillers, ownership: own, metrics, spoken: spokenSummary(durationSec, metrics) };
  }

  // A short summary to read aloud: one positive point and up to two fixes.
  function spokenSummary(durationSec, metrics) {
    const order = { bad: 0, ok: 1, good: 2 };
    const fixes = metrics.filter((m) => m.rating !== 'good').sort((a, b) => order[a.rating] - order[b.rating]).slice(0, 2);
    const praise = metrics.find((m) => m.rating === 'good');
    let s = `That was ${formatDuration(durationSec)}. `;
    if (praise) s += praise.tip + ' ';
    if (fixes.length) s += 'To improve: ' + fixes.map((m) => m.tip).join(' ');
    else s += 'Everything looked strong. Nice answer!';
    return s.trim();
  }

  // ---------------------------------------------------------------------------
  // Voice activity: tracks when you were actually making sound
  // ---------------------------------------------------------------------------
  // Call update(timeMs, isVoice) ~20 times a second from the audio meter.
  //
  //   voice:  ███████░░░░░░░░░░██████░░██████
  //                   └─ 3.5s ─┘        = 1 long pause
  function createVoiceTracker({ longPauseMs = 3000 } = {}) {
    let first = null;
    let last = null;
    let voicedMs = 0;
    const pauses = [];
    return {
      update(t, isVoice) {
        if (!isVoice) return;
        if (first === null) first = t;
        else {
          const gap = t - last;
          if (gap >= longPauseMs) pauses.push(gap);
          else if (gap < 250) voicedMs += gap;
        }
        last = t;
      },
      get lastVoiceAt() { return last; },
      summary() {
        return {
          heardVoice: first !== null,
          durationSec: first === null ? 0 : (last - first) / 1000,
          voicedSec: voicedMs / 1000,
          longPauses: pauses.length,
          longestPauseSec: pauses.length ? Math.max(...pauses) / 1000 : 0,
        };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Voice commands (used when you're NOT in the middle of an answer)
  // ---------------------------------------------------------------------------
  function parseCommand(raw) {
    const t = (raw || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    const has = (re) => re.test(t);
    if (!t) return 'unknown';
    if (has(/\b(stop|pause) listening\b/)) return 'stopListening';
    if (has(/\bhelp\b|\bwhat can i say\b/)) return 'help';
    if (has(/\bfollow[ -]?up\b/)) return 'followUp';
    if (has(/\b(how did i do overall|overall|summary|my score|session)\b/)) return 'summary';
    if (has(/\b(read|hear|play|say)\b.*\b(model|saved|ideal|best|perfect)\b/)) return 'readModel';
    if (has(/\b(try|practi[sc]e|do) (it |this |that |this one |that one )?again\b|\bsame question\b/)) return 'practiseAgain';
    if (has(/\b(repeat|say (it|that) again|what was the question|again)\b/)) return 'repeat';
    if (has(/\b(feedback|how did i do|how was that|how was it)\b/)) return 'feedback';
    if (has(/\b(next|new|another|different) question\b|\bask me\b|\bskip\b|\bnext\b|\bready\b|\b(let's )?(start|go|begin)\b/)) return 'next';
    return 'unknown';
  }

  // "...and that's how we fixed it. I'm done" -> ended, transcript without "I'm done"
  const END_PHRASE = /\b(i'm done|i am done|i'm finished|i am finished|that's my answer|that is my answer|end answer|end of answer)\s*$/i;
  function checkEndPhrase(transcript) {
    const t = (transcript || '').trim();
    if (END_PHRASE.test(t)) return { ended: true, transcript: t.replace(END_PHRASE, '').trim() };
    return { ended: false, transcript: t };
  }

  // ---------------------------------------------------------------------------
  // Comparing an attempt against your saved model answer
  // ---------------------------------------------------------------------------
  // Each key point is a short phrase, e.g. "set up GitHub issues for tasks".
  // A point counts as covered if you said at least half of its important words.
  //
  //   key point:  "set up GitHub issues for tasks"  → important words: set, github, issue, task
  //   you said:   "...so I made GitHub issues for every task..."   → github ✓ issue ✓ task ✓ set ✗
  //   3 of 4 = 75%  → covered ✓
  const STOP = new Set(('a an the and or but so if then than that this these those of to in on at by for with from ' +
    'as into about over after before during while because was were is are be been being am it its it\'s i me my we us our ' +
    'you your he she they them their his her what which who whom when where why how all any some each every very really ' +
    'just also too can could would should will shall may might must do does did done have has had having not no yes ' +
    'there here up out down off again once more most other such only own same well um uh like basically actually ' +
    'literally kind sort know mean get got make made thing things lot lots now im ive id ill youre weve theyre ' +
    'dont didnt cant wont isnt wasnt yeah okay ok really quite maybe').split(' '));
  // Short words that still matter in tech answers
  const SHORT_KEEP = new Set(['ai', 'ml', 'ui', 'ux', 'qa', 'js', 'db', 'os', 'ci', 'cd', 'uk', 'hr', 'vr', 'ar', 'c', 'r']);
  const NUMBERS = {
    one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twenty: '20', hundred: '100',
    // "third" and "3rd" count as the same word (speech recognition writes either)
    first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
  };

  // Very small stemmer so "issue/issues", "create/created/creating" match:
  //   issues → issu, issue → issu, created → creat, creating → creat
  function stem(w) {
    if (/^\d/.test(w)) return w; // numbers and 3rd/2nd stay as they are
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
    return w;
  }

  function contentWords(text) {
    return (text || '').toLowerCase().replace(/%/g, ' percent ').split(/[^a-z0-9']+/)
      .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
      .map((w) => NUMBERS[w] || w)
      .filter((w) => w && !STOP.has(w) && (w.length >= 3 || /^\d/.test(w) || SHORT_KEEP.has(w)))
      .map(stem);
  }

  function keyPointCoverage(keyPoints, transcript) {
    const said = new Set(contentWords(transcript));
    const points = (keyPoints || []).map((point) => {
      const words = [...new Set(contentWords(point))];
      if (!words.length) {
        // e.g. "got the A": only small words, so look for the exact phrase instead
        const norm = (t) => ` ${(t || '').toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim()} `;
        const found = norm(transcript).includes(norm(point));
        return { point, covered: found, ratio: found ? 1 : 0 };
      }
      const hits = words.filter((w) => said.has(w));
      const ratio = hits.length / words.length;
      return { point, covered: ratio >= 0.5, ratio };
    });
    const covered = points.filter((p) => p.covered).length;
    return { points, covered, total: points.length };
  }

  // If you write your own model answer without key points, use its sentences.
  function fallbackKeyPoints(modelAnswer) {
    return (modelAnswer.match(/[^.!?]+[.!?]?/g) || [])
      .map((s) => s.trim())
      .filter((s) => contentWords(s).length >= 2)
      .slice(0, 5);
  }

  // "[how many users?]" placeholders the AI leaves for details you need to add
  function findPlaceholders(text) {
    return (text || '').match(/\[[^\]]+\]/g) || [];
  }

  // ---------------------------------------------------------------------------
  // Scripts: your own questions and answers, written in a text file
  // ---------------------------------------------------------------------------
  //   Q: Tell me about yourself.
  //   A: I'm a third-year software engineering student at Glasgow...
  //      (an answer can continue over several lines)
  //   - Third-year software engineering        ← optional key points
  //   - Won the AI hackathon
  //
  //   Q: Why do you want this internship?
  //   A: ...
  function parseScript(text) {
    const items = [];
    let cur = null;
    let mode = null; // 'q' | 'a' | 'k'
    for (const raw of (text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue; // blank lines and # comments
      let m;
      if ((m = line.match(/^(?:q|question)\s*\d*\s*[:.)]\s*(.*)$/i))) {
        cur = { question: m[1], answer: '', keyPoints: [] };
        items.push(cur);
        mode = 'q';
      } else if (!cur) {
        continue; // text before the first question is ignored
      } else if ((m = line.match(/^(?:a|answer)\s*[:.)]\s*(.*)$/i))) {
        cur.answer = m[1];
        mode = 'a';
      } else if ((m = line.match(/^(?:[-•*]|key ?points?\s*:)\s*(.*)$/i))) {
        if (m[1].trim()) cur.keyPoints.push(m[1].trim());
        mode = 'k';
      } else if (mode === 'q') {
        cur.question += ' ' + line;
      } else if (mode === 'a') {
        cur.answer += ' ' + line;
      }
    }
    return items
      .map((i) => ({ question: i.question.trim(), answer: i.answer.trim(), keyPoints: i.keyPoints }))
      .filter((i) => i.question && i.answer)
      .map((i) => ({ ...i, keyPoints: i.keyPoints.length ? i.keyPoints : fallbackKeyPoints(i.answer) }));
  }

  // "You mentioned 80% of your answer": what share of the script's important words you said
  function answerCoverage(modelAnswer, transcript) {
    const important = [...new Set(contentWords(modelAnswer))];
    const said = new Set(contentWords(transcript));
    const hits = important.filter((w) => said.has(w));
    return {
      percent: important.length ? Math.round((hits.length / important.length) * 100) : 0,
      said: hits.length,
      total: important.length,
    };
  }

  // Splits the script answer into pieces marked 'said', 'missed' or 'plain' (unimportant words),
  // so the screen can colour what you remembered and what you forgot.
  function markModelAnswer(modelAnswer, transcript) {
    const said = new Set(contentWords(transcript));
    return (modelAnswer || '').split(/(\s+)/).filter((part) => part !== '').map((part) => {
      const word = part.trim() ? contentWords(part)[0] : null;
      return { text: part, status: !word ? 'plain' : said.has(word) ? 'said' : 'missed' };
    });
  }

  const api = { analyseAnswer, contentWords, parseScript, answerCoverage, markModelAnswer, keyPointCoverage, fallbackKeyPoints, findPlaceholders, countFillers, ownership, formatDuration, createVoiceTracker, parseCommand, checkEndPhrase, tokenize, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
