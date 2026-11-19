# Interview Helper: a voice interview coach

**Track:** Real-Time Assistance (coaching).

## What I built
Interview Helper is a browser app that runs a mock interview by voice. It picks an internship interview question from a built-in bank of 15 (stored in `js/questions.js`, so questions are easy to add or remove), reads it aloud, listens to your spoken answer, and gives instant feedback both read aloud and as a colour-coded scorecard: answer length, speaking pace, filler words (highlighted in your transcript), long pauses, whether you said "I" or hid behind "we", and whether you finished with a result. You can choose the type of question, e.g. behavioural, technical or motivation. With optional AI, it also rates your STAR structure, lists strengths and improvements, and asks a follow-up question about your own answer.

There's also a **script mode** that works with no AI. You paste your own prepared questions and answers into the input box, and Interview Helper runs through them like spoken flashcards. It tells you what percentage of your key points you hit, matching by keywords rather than exact wording, and shows your script with what you said in green and what you forgot in red. I added this after finding free cloud AI too slow and unreliable at busy times.

Interview Helper can also **build and remember your best answer**. After an attempt, the AI rewrites *your own story* into a 60–90 second STAR answer, using only facts you mentioned and leaving `[placeholders]` where a detail is missing. You edit and save it, and the next time you practise that question the app shows which key points you hit ("3 of 4, you missed the result").

## Who it's for and why voice
It's for students preparing for internship and graduate interviews. I'm applying to internships myself this year. The usual ways to prepare are writing answers down or reading lists of tips, but **an interview is a spoken skill**. A perfectly written answer can still come out at 200 words a minute, full of "like" and "you know", with a long pause in the middle. You only find that out by speaking: pace, hesitation and pauses live in the voice, and a keyboard can't capture them.

I tried practising with ChatGPT's voice mode, but it isn't built for interviews: it kept interrupting me mid-answer, and in longer conversations it lost track of my earlier answers. Interview Helper is built for the opposite kind of speech, a long, structured answer: it waits until you say "I'm done", measures your delivery, and saves your answers so each attempt can be compared with the last. Practising with a friend is awkward and depends on their availability; this gives you the same feedback on demand, and the follow-up question makes it feel like a conversation rather than a quiz.

## What I'd do next with more time
1. **Role-specific questions:** paste a job description and generate likely questions for that company.
2. **Full mock-interview mode:** a 20-minute interview with several follow-ups and a final report.
3. **Progress over time:** keep your practice history after a refresh and on any device (via an account), and chart your fillers, pace and key points across a week of practice.
4. **Smarter matching:** compare key points by meaning (embeddings) rather than exact words.
5. **Better voice analysis:** a verbatim speech-to-text model (e.g. Whisper) so every "um" is caught, since Chrome's recogniser sometimes drops them, and using pitch and energy to flag a flat or nervous delivery.
