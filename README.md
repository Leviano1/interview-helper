# Interview Helper: practise interview answers out loud

Interview Helper is a voice interview coach. It asks you a real interview question out loud, listens to your spoken answer, and immediately tells you how you came across: length, pace, filler words, long pauses, whether you said what *you* did, and whether you ended with a result. With an optional AI key it also judges your content (STAR structure) and asks a realistic follow-up question, like a real interviewer would.

It also **remembers your best answers**. After an attempt, the AI turns *your own story* into a polished model answer (it never invents achievements, and leaves `[placeholders]` for missing details). You edit it, save it, and next time you practise that question Interview Helper checks which **key points** you hit:

```
1st attempt ──► ✨ AI model answer (from YOUR facts) ──► ✏️ edit ──► 💾 save
                                                                       │
next attempt ──► 🎯 "You covered 3 of 4 key points. You missed: the result." ◄┘
                    Last time → now: points 2/4 → 3/4 ✅ · fillers 6 → 2 ✅
```

Track: **Real-Time Assistance** (coaching)

## Pages

| Page | What's on it |
|---|---|
| **Practise** (home) | Start practice, your script, the current question, live answer, feedback tiles, key points hit, and your model answer |
| **My answers** | Session summary tiles, the "This session" table, and your saved model answers (practise, edit, delete, import/export, add new) |
| **Settings** (cog icon) | AI provider (Chrome built-in, Gemini, OpenAI or off), API key, and the list of voice commands |

The look (dark navy, Space Grotesk / Inter / JetBrains Mono, inline line icons) follows `DESIGN.md`.

## Requirements

- **Google Chrome** or **Microsoft Edge** (desktop). Firefox and Safari don't support the speech recognition API.
- A microphone and speakers (headphones are best).
- An internet connection. Chrome's speech recognition runs on Google's servers.
- Python 3 to run a small local web server. Node.js is optional, for the tests.

Nothing to install: no npm packages and no build step.

## Run it

```bash
cd interview-helper
python3 -m http.server 8000
```

Open **http://localhost:8000** in Chrome (on Windows, don't use the `http://[::]:8000` link it prints), click **▶ Start practice**, and allow microphone access.

1. Interview Helper reads a question aloud.
2. Answer out loud. Say **"I'm done"** or stay quiet for 5 seconds when you finish.
3. Get your feedback on screen and read aloud, then say **"next question"**.

### Optional: AI (free options available)

Delivery feedback works with no AI at all. AI adds content feedback (STAR), follow-up questions and model answers. Open **Settings** (the cog, top right) and pick a provider:

| Provider | Cost | Setup |
|---|---|---|
| **Chrome built-in AI** (Gemini Nano, on-device) | Free, no key | Chrome 148+ on desktop, 16 GB RAM or a GPU with 4 GB+ VRAM, 22 GB free disk. Click **Enable on-device AI** once to download the model. Answers never leave your computer. |
| **Google Gemini API** | Free tier, no credit card | Get a key at [aistudio.google.com](https://aistudio.google.com) → *Get API key*, paste it in. Default model `gemini-flash-lite-latest` (fast); falls back to `gemini-flash-latest` if busy. |
| **OpenAI** | Paid | Paste a key from platform.openai.com. Default model `gpt-4o-mini`. |

If you haven't chosen, Interview Helper uses Chrome's built-in AI automatically when your computer supports it. The badge in the top bar shows which AI is active. Keys are stored only in your browser's localStorage: **never commit a key to the repo.**

## Script mode: practise your own answers like flashcards (no AI needed)

Write the questions you expect and the answers you want to give, in a plain text file or straight into the box:

```
Q: Tell me about yourself.
A: I'm a third-year software engineering student at Glasgow.
   I won first place at the AI start-ups hackathon...
- 3rd year software engineering        ← optional key points / buzzwords
- won the AI hackathon

Q: Why do you want this internship?
A: ...
```

Click **Load script**, then **▶ Practise my script**. Interview Helper asks each question in order, listens, and shows:

- **% of key points hit**, e.g. *75%: 3 of 4*. Matching is by keywords, so you don't have to say it word for word ("third" = "3rd", word order doesn't matter).
- Your script answer as a **flashcard**: words you said in green, words you missed in red.
- At the end, your average and **which question to practise most**.

If an answer has no `-` key points, each sentence becomes a key point. Click **Show example** for a template, and **Save .txt** to keep your script.

## What it measures

| Metric | How | Good range |
|---|---|---|
| Length | time from your first to last word | 1–2½ minutes |
| Pace | words ÷ minutes | 100–170 words per minute |
| Filler words | "um", "uh", "like", "you know", "basically", "kind of"… with rules to skip real uses ("I *like* Java", "what *kind of* role") | ≤ 2 per minute |
| Long pauses | microphone volume (Web Audio API): silent gaps of 3+ seconds | 0–1 |
| "I" vs "we" | counts I/me/my vs we/us/our | more "I" than "we" |
| Result | outcome words ("as a result", "delivered", "improved"…) and numbers | present |
| STAR, strengths, follow-up | LLM (optional) | |
| Key points hit (script / model answer) | words from each saved key point found in your new answer (stop words removed, simple stemming, "four" = "4"); a point counts if ≥ 50% of its important words appear | all of them |

All thresholds live in one place (`LIMITS` in `js/analysis.js`) so they're easy to tune.

## Voice commands

| Say | What happens |
|---|---|
| "Next question" / "Skip" | Asks a new question |
| "Repeat" / "What was the question?" | Reads it again |
| "I'm done" | Ends your answer |
| "How did I do?" | Repeats the feedback |
| "Follow up" | Asks the AI's follow-up question about your answer |
| "How did I do overall?" | Spoken summary of the whole session |
| "Read my model answer" | Reads your saved model answer aloud |
| "Try that again" | Re-asks the same question |
| "Help" / "Stop listening" | |

You can also type in your own question, e.g. one from a job description.

## My answers (saved model answers)

- After any answer, under **Model answer**: **Build it with AI** (needs a key) or **Write my own** (starts from your transcript).
- Edit the text and the key points (one per line), fill in any `[placeholders]`, then **Save**.
- Practise it again from the **My answers** list, or choose **My saved answers** as the question type. You can **peek** at your key points before answering.
- Saved answers are kept in your browser (localStorage). Use **Export / ⬆ Import** to back them up or move them to another computer.

## How it works

```
                 ┌─ SpeechRecognition (Chrome) ─► words  ─► fillers, pace, "I"/"we", result ─┐
🎙️ microphone ───┤                                                                            ├─► analyseAnswer() ─► tiles on screen
                 └─ Web Audio analyser ─────────► volume ─► long pauses, speaking time ─────┘          │
                                                                                                       ├─► 🔊 spoken summary
                                                                         (optional) OpenAI ◄──────────┘     + follow-up question
```

The app moves between four modes: **idle → asking → answering → review**. While it's talking, the microphone is paused so it doesn't score its own voice.

- **`js/analysis.js`** has all the scoring logic, including key-point coverage, as plain functions with no browser code, so it's unit-tested with Node.
- **`js/app.js`** runs the session: microphone, volume meter, speech, the flow and the screen.
- **`js/ai.js`** is one `AI.ask({ system, user, schema })` function in front of three providers (Chrome built-in, Gemini, OpenAI), so the rest of the app doesn't care which one is used. Replies are JSON, and Chrome's built-in model is forced to follow a JSON schema.
- **`js/questions.js`** is the question bank for software engineering internship interviews.

## Tests

```bash
node tests/analysis.test.js
```

## Known limitations

- Chrome's built-in model is small, so its feedback and model answers are simpler than a cloud model's.
- Chrome's speech recognition sometimes leaves out "um" and "uh", so hesitation counts may be lower than reality. "Like", "you know", "basically" etc. are recognised reliably. A verbatim speech-to-text model (e.g. Whisper) would fix this.
- Pause detection uses a simple volume threshold, so a very noisy room can hide pauses.
- Key-point matching works on words, not meaning, so a heavy paraphrase ("finished ahead of schedule" vs "delivered early") may not count. Embeddings or an LLM check would fix this.
- Saved answers live in one browser unless you export them.
- English (UK) only.

## Project structure

```
interview-helper/
├── index.html
├── style.css
├── js/
│   ├── questions.js   question bank
│   ├── analysis.js    scoring (pure, testable)
│   ├── ai.js          AI providers: Chrome built-in, Gemini, OpenAI
│   ├── icons.js       inline line icons (no emoji or icon font)
│   └── app.js         mic, audio meter, speech, flow, AI, UI
├── tests/analysis.test.js
├── README.md
├── ai.md
└── WRITEUP.md
```
