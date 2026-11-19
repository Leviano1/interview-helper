// Run with:  node tests/analysis.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const A = require(path.join(__dirname, '..', 'js', 'analysis.js'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}
const fillers = (s) => A.countFillers(s).byWord;
const metric = (result, id) => result.metrics.find((m) => m.id === id);

console.log('countFillers');
test('um and uh', () => assert.deepEqual(fillers('um so uh I built it'), { 'um / uh': 2 }));
test('filler "like"', () => assert.deepEqual(fillers('it was like really hard'), { like: 1 }));
test('"I like" is not a filler', () => assert.deepEqual(fillers('I like Java'), {}));
test('"would like to" is not a filler', () => assert.deepEqual(fillers('I would like to join'), {}));
test('"looks like" is not a filler', () => assert.deepEqual(fillers('it looks like rain'), {}));
test('filler "you know"', () => assert.deepEqual(fillers('and you know the deadline was close'), { 'you know': 1 }));
test('"do you know" is not a filler', () => assert.deepEqual(fillers('do you know Python'), {}));
test('filler "kind of"', () => assert.deepEqual(fillers('it was kind of messy'), { 'kind of': 1 }));
test('"what kind of" is not a filler', () => assert.deepEqual(fillers('what kind of role'), {}));
test('basically / literally', () => assert.deepEqual(fillers('basically it literally broke'), { basically: 1, literally: 1 }));
test('punctuation and capitals', () => assert.equal(A.countFillers('Um, LIKE, basically.').total, 3));
test('flagged indexes for highlighting', () => assert.deepEqual([...A.countFillers('so you know it worked').flagged], [1, 2]));

console.log('ownership');
test('counts I vs we', () => assert.deepEqual(A.ownership("I built it and we tested it, then I fixed our bug"), { i: 2, we: 2 }));

console.log('analyseAnswer');
const strong = 'In my second year I led a team of four building a Django web app. ' +
  'The task was to deliver it in three weeks. I split the work, set up GitHub issues, and I wrote the booking backend myself. ' +
  'As a result we delivered two days early and got an A for the project, and I learned how to plan work for a team. ' +
  'I also set up automated tests, which reduced bugs a lot before the final demo, and the client said it was the best one they had seen this year.';
const r1 = A.analyseAnswer({ transcript: strong, durationSec: 40, longPauses: 0 });
test('pace computed', () => assert.equal(r1.wpm, Math.round(r1.words / (40 / 60))));
test('result detected', () => assert.equal(metric(r1, 'result').rating, 'good'));
test('ownership good', () => assert.equal(metric(r1, 'ownership').rating, 'good'));
test('no fillers', () => assert.equal(metric(r1, 'fillers').rating, 'good'));
test('40s is a bit short', () => assert.equal(metric(r1, 'length').rating, 'ok'));

const weak = 'um so basically we like had a project and we kind of did it and um we finished it you know';
const r2 = A.analyseAnswer({ transcript: weak, durationSec: 12, longPauses: 4 });
test('too short', () => assert.equal(metric(r2, 'length').rating, 'bad'));
test('too many fillers', () => assert.equal(metric(r2, 'fillers').rating, 'bad'));
test('too many pauses', () => assert.equal(metric(r2, 'pauses').rating, 'bad'));
test('spoken summary mentions length', () => assert.match(r2.spoken, /^That was 12 seconds\./));
test('pauses hidden if not measured', () => assert.equal(metric(A.analyseAnswer({ transcript: weak, durationSec: 12 }), 'pauses'), undefined));
test('fast pace flagged', () => {
  const words = Array(130).fill('word').join(' ');
  assert.equal(metric(A.analyseAnswer({ transcript: words, durationSec: 30 }), 'pace').rating, 'bad'); // 260 wpm
});

test('one long pause tip is honest', () => assert.match(metric(A.analyseAnswer({ transcript: strong, durationSec: 60, longPauses: 1 }), 'pauses').tip, /one long pause/));

console.log('createVoiceTracker');
test('counts a long pause', () => {
  const v = A.createVoiceTracker({ longPauseMs: 3000 });
  for (let t = 0; t <= 2000; t += 50) v.update(t, true);   // speak 2s
  for (let t = 2050; t < 6000; t += 50) v.update(t, false); // silent ~4s
  for (let t = 6000; t <= 8000; t += 50) v.update(t, true); // speak 2s
  const s = v.summary();
  assert.equal(s.longPauses, 1);
  assert.equal(s.durationSec, 8);
  assert.ok(s.voicedSec > 3.5 && s.voicedSec <= 4.1);
});
test('short gaps are not long pauses', () => {
  const v = A.createVoiceTracker();
  [0, 500, 1500, 2500].forEach((t) => v.update(t, true));
  assert.equal(v.summary().longPauses, 0);
});

console.log('parseCommand / checkEndPhrase');
test('next question', () => assert.equal(A.parseCommand('next question please'), 'next'));
test('repeat', () => assert.equal(A.parseCommand('what was the question'), 'repeat'));
test('follow up', () => assert.equal(A.parseCommand('give me a follow up'), 'followUp'));
test('summary', () => assert.equal(A.parseCommand('how did I do overall'), 'summary'));
test('feedback', () => assert.equal(A.parseCommand('how did I do'), 'feedback'));
test('chatter ignored', () => assert.equal(A.parseCommand('the weather is nice today'), 'unknown'));
test("end phrase stripped", () => assert.deepEqual(A.checkEndPhrase('and we shipped it I\'m done'), { ended: true, transcript: 'and we shipped it' }));
test("no end phrase mid-answer", () => assert.equal(A.checkEndPhrase("I'm done with the setup so then I").ended, false));
test('formatDuration', () => assert.equal(A.formatDuration(80), '1 minute 20 seconds'));

console.log('model answers');
test('content words drop stop words and stem', () => assert.deepEqual(A.contentWords('I set up the GitHub issues for tasks'), ['set', 'github', 'issu', 'task']));
test('issue and issues match', () => assert.deepEqual(A.contentWords('issue issues created creating'), ['issu', 'issu', 'creat', 'creat']));
test('number words become digits', () => assert.deepEqual(A.contentWords('team of four'), ['team', '4']));
const points = ['Led a team of four students', 'Set up GitHub issues for tasks', 'Delivered two days early'];
test('coverage', () => {
  const c = A.keyPointCoverage(points, 'so I was leading a team of 4 and I made GitHub issues for every task');
  assert.deepEqual(c.points.map((p) => p.covered), [true, true, false]);
  assert.equal(c.covered, 2);
  assert.equal(c.total, 3);
});
test('coverage with nothing said', () => assert.equal(A.keyPointCoverage(points, '').covered, 0));
test('fallback key points from sentences', () => assert.deepEqual(
  A.fallbackKeyPoints('I led the team. I wrote the backend in Django! Done.'),
  ['I led the team.', 'I wrote the backend in Django!']));
test('placeholders', () => assert.deepEqual(A.findPlaceholders('We had [how many?] users and [result]'), ['[how many?]', '[result]']));
test('read model command', () => assert.equal(A.parseCommand('read my model answer'), 'readModel'));
test('practise again command', () => assert.equal(A.parseCommand("let's try that again"), 'practiseAgain'));
test('plain repeat still works', () => assert.equal(A.parseCommand('repeat'), 'repeat'));

console.log('scripts');
const SCRIPT = `# My interview script
Q: Tell me about yourself.
A: I'm a third-year software engineering student at Glasgow.
I won first place at the AI start-ups hackathon.
- Third-year software engineering at Glasgow
- Won the AI hackathon

Question 2: Why do you want this internship?
Answer: I want to learn how voice products are built at scale. Hiya works on security, which interests me.

Q: A question with no answer
`;
const parsed = A.parseScript(SCRIPT);
test('parses questions with answers only', () => assert.equal(parsed.length, 2));
test('multi-line answers are joined', () => assert.equal(parsed[0].answer, "I'm a third-year software engineering student at Glasgow. I won first place at the AI start-ups hackathon."));
test('key points are read', () => assert.deepEqual(parsed[0].keyPoints, ['Third-year software engineering at Glasgow', 'Won the AI hackathon']));
test('"Question 2:" / "Answer:" also work', () => assert.equal(parsed[1].question, 'Why do you want this internship?'));
test('missing key points come from sentences', () => assert.equal(parsed[1].keyPoints.length, 2));
test('answer coverage percent', () => {
  const c = A.answerCoverage('I built a snake game in Java using Swing', 'so I made a snake game in Java');
  // important words: built, snake, game, java, using, swing -> said: snake, game, java = 3/6
  assert.equal(c.percent, 50);
});
test('mark said and missed words', () => {
  const marks = A.markModelAnswer('I built a Snake game', 'snake').filter((m) => m.text.trim());
  assert.deepEqual(marks.map((m) => m.status), ['plain', 'missed', 'plain', 'said', 'missed']);
});

test('"third" matches "3rd"', () => assert.equal(A.answerCoverage("I'm a third-year student", "I'm in 3rd year").said, 2));
test('different word order still scores', () => assert.equal(
  A.answerCoverage("I'm a third-year software engineering student at Glasgow", "so I study software engineering at Glasgow I'm in third year").percent, 83));
test('buzzword key points', () => assert.equal(
  A.keyPointCoverage(['3rd year', 'software engineering', 'hackathon win'], 'third year software engineering student and I won a hackathon').covered, 3));

test('AI counts as a keyword', () => assert.deepEqual(A.contentWords('voice and AI'), ['voic', 'ai']));
test("I've and now are ignored", () => assert.deepEqual(A.contentWords("Now I've built it"), ['built']));

test('key point of only small words uses exact phrase', () => {
  assert.equal(A.keyPointCoverage(['got the A'], 'and in the end I got the A').covered, 1);
  assert.equal(A.keyPointCoverage(['got the A'], 'I got a B').covered, 0);
});

console.log(`\n${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);
