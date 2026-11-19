// questions.js — the question bank, aimed at software engineering internship interviews.
// Each question has a "hint" shown on screen to remind you what a good answer covers.

window.QUESTIONS = [
  // About you
  { category: 'About you', text: 'Tell me about yourself.', hint: 'Present → past → future: what you study now, one or two highlights, and why this role is the next step.' },
  { category: 'About you', text: 'What are your greatest strengths?', hint: 'Pick one or two strengths and prove each with a short example.' },
  { category: 'About you', text: 'What is a weakness you are working on?', hint: 'A real but fixable weakness, plus what you are actively doing about it.' },

  // Behavioural (STAR: Situation, Task, Action, Result)
  { category: 'Behavioural', text: 'Tell me about a time you worked in a team to achieve something.', hint: 'STAR: what was the goal, what did YOU do, what was the result?' },
  { category: 'Behavioural', text: 'Describe a challenge you faced and how you overcame it.', hint: 'STAR: make the challenge concrete, then focus on your actions and the outcome.' },
  { category: 'Behavioural', text: 'Tell me about a time you had to learn something new quickly.', hint: 'What did you need to learn, how did you learn it, and what did you deliver?' },
  { category: 'Behavioural', text: 'Tell me about a time you disagreed with someone. What happened?', hint: 'Stay respectful: how you listened, how you resolved it, what you learned.' },
  { category: 'Behavioural', text: 'Tell me about a mistake you made and what you learned from it.', hint: 'Own it, explain how you fixed it, and what you do differently now.' },
  { category: 'Behavioural', text: 'Describe a time you worked under a tight deadline.', hint: 'How you prioritised, what you cut, and whether you delivered.' },

  // Technical story
  { category: 'Technical', text: 'Tell me about a project you are proud of.', hint: 'What it does, the hardest technical problem, your decision, and what you would improve.' },
  { category: 'Technical', text: 'Describe a difficult bug you found and how you fixed it.', hint: 'Symptoms → how you narrowed it down → root cause → fix → how you would prevent it.' },
  { category: 'Technical', text: 'How would you explain an API to someone who is not technical?', hint: 'Use a simple analogy (like a waiter taking orders) and keep it short.' },

  // Motivation
  { category: 'Motivation', text: 'Why do you want this internship?', hint: 'Something specific about the company, what you will bring, what you want to learn.' },
  { category: 'Motivation', text: 'Where do you see yourself in five years?', hint: 'Show ambition that fits the role: skills you want to grow, not a job title.' },
  { category: 'Motivation', text: 'Why did you choose to study software engineering?', hint: 'A genuine moment that got you interested, and what keeps you going.' },
];
