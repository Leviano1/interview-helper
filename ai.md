# AI tools used

## Tools
- Claude (claude.ai): main coding assistant

## How I used it
- Generated the first version of the code from my idea and requirements
- Debugged problems I found while testing (e.g. API errors, slow AI responses, layout bugs)
- Explained each file to me so I understood it; I rewrote the code comments in my own words
- Talked through different ways to use AI for feedback, and how to make AI optional and free
- Built script mode, which lets you practise with your own script and needs no AI
- Iterated on the app many times: fixing errors, adding features and removing parts that weren't needed
- Restyled the app to match my own Figma design, and made UX changes I asked for after testing it

## How I checked the work
- Tested it myself by answering questions out loud in Chrome
- 59 automated tests for the scoring logic (`node tests/analysis.test.js`)
- Reviewed every file before submitting and removed redundant code

## AI inside the app
**Voice (built into Chrome):**
- **Web Speech API**: Chrome's built-in speech tools. It turns your voice into text (so the app knows what you said) and reads the questions and feedback out loud. Free, no key needed.
- **Web Audio API**: measures how loud the microphone is, to spot long pauses.

**Two ways to get feedback on what you said:**
- **Your own script:** you write the questions and answers you want to give, and the app checks which of your key points you mentioned, by matching keywords.
- **AI of your choice (optional):** it gives feedback on your answer (STAR structure, strengths, a follow-up question) and can turn your answer into a polished model answer. You can pick:
   - **Chrome built-in AI**: runs on your own laptop, free, no key (needs a one-time download of a few GB)
   - **Google Gemini**: free key from Google AI Studio
   - **OpenAI**: needs a paid key

Delivery feedback (length, pace, filler words, pauses, "I" vs "we") is always calculated by plain code, so it works without any AI.
