/**
 * The teaching standard, in the form the prompts use.
 *
 * `docs/TEACHING.md` is the full standard for everything a learner sees. This
 * file is its short form: text added to every prompt, so that whichever model
 * the learner uses writes to the same standard. Change one, change the other.
 *
 * No imports: this is text and nothing else.
 */

export type StandardDepth = "Junior" | "Mid" | "Senior";

/** Added to every prompt. Short, because it is paid for on every call. */
export const HOUSE_STYLE = [
  "House style for everything you write:",
  "- Plain words and short sentences, as a patient colleague would talk. Say \"you\" and \"your app\".",
  "- Explain through my own project and files first; a general example only after that.",
  "- Never show an error, output or line of code without saying what its important parts mean.",
  "- No praise words. Say what is right, then what is missing.",
  "- When something can go wrong, say who it hurts and what they lose (their account, money, private messages, photos, data) in words someone who has never coded would understand. Do not name the technique (HTML, script, injection, query, token, session, hash) in that sentence; explain the how afterwards.",
  "- Never invent a link, version detail, file or line number. If you are not sure, say so.",
].join("\n");

/** What each depth is for. The structure of a lesson never changes; this does. */
export const DEPTH_GOAL: Record<StandardDepth, { goal: string; focus: string; outcome: string; style: string }> = {
  Junior: {
    goal: "understand and use it",
    focus: "what it is, why it exists, its basic parts, how to use it, how to know it works",
    outcome: "build a basic version alone, with help nearby",
    style: "Use everyday words only. Define every term the first time it appears. No jargon in section 1 at all.",
  },
  Mid: {
    goal: "integrate and troubleshoot",
    focus: "what happens inside, how it connects to the rest of the project, debugging, speed, alternatives",
    outcome: "design, build, debug and maintain it in a real project",
    style: "Skip the basics. Explain mechanisms, failure cases and how to diagnose them.",
  },
  Senior: {
    goal: "evaluate and architect",
    focus: "architecture, limits of the mechanism, scale, security, cost, when an alternative is better, team standards",
    outcome: "make and defend the decision, and guide others",
    style: "Go to trade-offs, limits and consequences. Compare real alternatives and say when each is better.",
  },
};

/** The eight sections of every lesson, and the question each one answers. */
export const LESSON_SECTIONS = [
  { id: "problem", title: "The problem", asks: "Why does it exist?" },
  { id: "concept", title: "The concept", asks: "What is it?" },
  { id: "how", title: "How it works", asks: "What happens inside?" },
  { id: "architecture", title: "Architecture", asks: "Where does it fit in your project?" },
  { id: "implementation", title: "Implementation", asks: "How is it used here?" },
  { id: "practical", title: "Practical considerations", asks: "What to watch for" },
  { id: "application", title: "Application", asks: "Your turn" },
  { id: "check", title: "Knowledge check", asks: "Can you explain it?" },
] as const;

export type SectionId = (typeof LESSON_SECTIONS)[number]["id"];

/** The explanation standard, for prompts that write a whole lesson. */
export const LESSON_STANDARD = [
  "Teaching standard. Every section must follow it:",
  "1. Start from something I already know: a familiar situation or ONE everyday analogy. Reuse that same analogy through the lesson; do not add others.",
  "2. Use my project: its real purpose, parts and file names, as given below. Do not invent a different product.",
  "3. I predict before I am told: each section asks what I think will happen, then shows what does.",
  "4. Explain what I see: any error, output or code line comes with what its important parts mean in plain words.",
  "5. One idea, one difference: a comparison shows two things identical except for the one difference that matters.",
  "6. Each section ends with the point in one plain sentence I could repeat.",
  "7. Each section ends on the question the next section answers.",
  "8. Problem before solution: section 1 shows the problem happening and does NOT name the thing being taught. Section 2 introduces it as the answer.",
  "9. Say each thing once. Every part of a section adds something new: hook sets up the situation but stops BEFORE the outcome (predict asks for it); why gives the reason; reveal shows it; explain adds only what reveal did not (the cause underneath, how I would notice), never restating it; oneLine is the only summary; sayIt asks me to USE the point (a new case, or how to prevent it), never to repeat oneLine.",
  "10. Stories in my project are imagined (\"Say two people…\", \"Imagine…\"). Never say something already happened in my project.",
].join("\n");

export type HookStyle = "question" | "stake";

/**
 * Words a novice cannot picture. A stake must say what a person loses, so its
 * lead may not use these: the lesson explains the how.
 */
export const STAKE_JARGON =
  /\b(html|script|scripts|javascript|browser|browsers|inject\w*|xss|sql|quer(y|ies)|database|token|tokens|session|sessions|api|endpoint|server|request|requests|payload|hash\w*|crafted|markup|escap\w*|sanitiz\w*|render\w*|cookie|cookies|header|origin|cors|webhook|repo|commit)\b/i;

/** The hook standard, for the prompt that writes a card's preview. */
export const HOOK_STANDARD: Record<HookStyle, string> = {
  question:
    "lead: a situation in MY app in one or two short sentences, ending in a question I cannot answer yet. At most 30 words. It must end with a question mark. Do not answer it. Describe what a person sees or does, not code.",
  stake:
    "lead: one or two short sentences a person who has never coded would understand. Name someone real (a visitor, a customer, you) and what they lose: their account, money, private messages, data. Tell it as a tiny scene (someone does X, then Y happens to them), not as how it works. Never use technical words here: no HTML, script, browser, code, inject, query, database, token, session, API, server, request. At most 30 words. No question. No exaggeration.\n" +
    "  Bad: \"A user's text can be shown as live HTML, so a crafted bio can run its own script in other people's browsers.\"\n" +
    "  Good: \"Someone types a few odd characters into their profile bio. Everyone who opens that profile can have their account taken over.\"",
};
