# Interview Helper: a voice interview coach (Hiya Voice AI Challenge)

**Track:** Real-Time Assistance (coaching) · **Author:** Lev Khyzhnychenko

## What I built
Interview Helper is a browser app that runs a mock interview by voice. It reads a real internship interview question aloud ("Tell me about a time you worked in a team"), listens to your spoken answer, and gives instant feedback, both read aloud and as a colour-coded scorecard: answer length, speaking pace, filler words (highlighted in your transcript), long pauses, whether you said "I" or hid behind "we", and whether you finished with a result. With an optional LLM key it also rates your STAR structure, lists strengths and improvements, and asks a realistic follow-up question about your own answer, the part of interviews most people never practise. Say "how did I do overall?" for a session summary.

There's also a **script mode** that works with no AI at all: you paste your own prepared questions and answers, and Interview Helper runs through them like spoken flashcards. It tells you what percentage of your key points you hit, matching by keywords rather than exact wording, and shows your script with what you said in green and what you forgot in red. I added this after finding free cloud AI too slow and unreliable at busy times: the most useful feedback, "did I remember my points?", doesn't need a language model at all.

Interview Helper can also **build and remember your best answer**. After an attempt, the AI rewrites *your own story* into a 60–90 second STAR answer, using only facts you mentioned and leaving `[placeholders]` where a detail is missing. You edit and save it, and the next time you practise that question the app shows which key points you hit ("3 of 4, you missed the result") and how you compare with last time.

## Who it's for and why voice
It's for students preparing for internship and graduate interviews. I'm applying to internships myself this year. The usual ways to prepare are writing answers down or reading lists of tips, but **an interview is a spoken skill**. A perfectly written answer can still come out at 200 words a minute, full of "like" and "you know", with a long pause in the middle. Those are things you only find out by speaking, and things a keyboard literally cannot capture: pace, hesitation, pauses and delivery live in the voice. Practising out loud with a friend is awkward and depends on their availability. Interview Helper gives you the same feedback on demand, and the follow-up question makes it feel like a conversation rather than a quiz.

## Key design decisions
- **Measure with code, judge with AI.** Length, pace, fillers, pauses and "I" vs "we" are computed deterministically: instant, free, consistent between attempts, and unit-tested. The LLM only does what code can't: judging content and asking a follow-up.
- **Two listeners on one mic.** Speech recognition gives the words; a Web Audio volume meter gives timing, which is how long pauses are detected even when the recogniser outputs nothing.
- **Fillers in context.** "Like" in "I like Java" or "what kind of role" isn't a filler, so simple rules check the surrounding words to avoid false alarms.
- **Works without AI.** Delivery scoring and script mode are plain code: instant, free, offline and explainable. AI is an optional extra, not a dependency.
- **AI writes, code checks.** The LLM drafts the model answer under a strict no-invention rule. Comparing later attempts with its key points is done by simple word matching, so it's instant, free and explainable.
- **Free and private by default.** The AI runs on-device through Chrome's built-in model (no key, no cost, and interview answers never leave the laptop), with the free Gemini API or OpenAI as alternatives behind one interface. Delivery feedback needs no AI at all.
- **Hands-free flow.** Answers end with "I'm done" or 5 seconds of silence, and the mic pauses while the coach speaks so it never scores itself.

## What I'd do next with more time
1. **Verbatim speech-to-text** (e.g. Whisper) so every "um" and "uh" is caught. Chrome's recogniser sometimes drops them.
2. **Smarter matching and progress:** compare key points by meaning (embeddings) rather than words, sync saved answers to an account, and chart progress across a week of practice.
3. **Role-specific questions:** paste a job description and generate likely questions for that company.
4. **Voice tone:** use pitch and energy to flag a flat or nervous delivery.
5. **Full mock-interview mode:** a 20-minute interview with several follow-ups and a final report.
