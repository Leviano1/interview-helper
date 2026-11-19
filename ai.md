# AI tools used

## While building

**Claude (Anthropic, via claude.ai)**
- I chose the idea (a spoken interview coach in the Real-Time Assistance track), which came from my own experience applying for internships this year, and decided what it should measure.
- Claude generated the first version of the code: the page and styling, the scoring module (`analysis.js`), the session logic with speech recognition and the audio meter (`app.js`), the question bank and the unit tests.
- I ran it in Chrome, tested it by answering questions myself, and went through the code with Claude to understand each part (the mode state machine, how the two microphone listeners work together, how filler words are told apart from real uses of "like", how pauses are detected).
- Claude also drafted the README, this file and the first draft of the write-up, which I edited.

<!-- TODO (Lev): add what you changed yourself after testing, e.g. "I lowered the silence timeout because...", "I added questions about...". Specific is good. -->

## Inside the product

- **Web Speech API (Chrome)**: `SpeechRecognition` for speech-to-text and `speechSynthesis` for the interviewer's voice. Built into the browser, so free and with no key.
- **Web Audio API**: reads the microphone volume to detect long pauses. No AI involved.
- **AI for content (optional), behind one function in `js/ai.js`**, with three interchangeable providers:
  - **Chrome built-in AI** (Gemini Nano via the Prompt API): runs on the user's own computer, free, no key, private. It's the default when supported, and a JSON schema forces a valid reply.
  - **Google Gemini API**: free tier with a key from AI Studio.
  - **OpenAI** (`gpt-4o-mini`): for anyone with a paid key.

  The AI is used for two things:
  1. **Feedback:** judges the content (STAR structure, strengths, improvements) and writes a follow-up question.
  2. **Model answers:** rewrites my own attempt into a 60–90 second STAR answer plus 3–5 key points. The prompt forbids inventing facts, and missing details become `[placeholders]` that I fill in myself.

I made the AI optional and free on purpose: reviewers and users shouldn't need to pay for credits for the app to be useful.

## Script mode uses no AI

After testing, the free AI providers were sometimes slow or overloaded, so I added a script mode: I write my own answers, and the app checks my spoken attempts against them with keyword matching in `analysis.js` (`parseScript`, `keyPointCoverage`, `answerCoverage`, `markModelAnswer`). It's instant, works offline, and I can explain exactly why each key point counted.

## Design choice: measure with code, judge with AI

Things that can be measured exactly (time, words per minute, filler words, pauses, "I" vs "we") are calculated by plain code: instant, free, testable and consistent between answers. The LLM is only used for what code can't do well: judging whether the story makes sense, asking a good follow-up, and rewriting an answer. Checking whether a new attempt hits the saved key points is done by code too, so it's instant and I can explain exactly why a point counted or not.

## Guardrail: the AI must not make things up

A model answer that invents achievements would be useless (and dishonest) in a real interview, so the AI is told to use only what I actually said, and to leave `[placeholders]` instead of guessing. The editor counts the remaining placeholders so I don't save an answer with gaps.
