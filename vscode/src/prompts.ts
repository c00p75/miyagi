/**
 * Every question Miyagi asks a model, and how each answer is checked.
 *
 * A model's reply is untrusted input. It may be prose where JSON was asked
 * for, JSON with fields missing, a line number past the end of the file, or
 * four "different" choices that are the same sentence. So each prompt here is
 * paired with a parser that returns a typed value or null, and the panel
 * shows "could not read the answer" rather than rendering something wrong.
 *
 * No `vscode` and no I/O: these are strings in, values out.
 */

import type { Prompt } from "./ai.js";
import { TOPICS, parseTopic, type Topic } from "./topics.js";

export type Depth = "Junior" | "Mid" | "Senior";

/** Passed as a command-line argument on some providers: one plain line, no quotes. */
const SYSTEM =
  "You are Miyagi, a coding tutor. You explain the code a learner shows you in plain language. Do not use tools. Do not offer to do anything else.";
const JSON_ONLY = "Reply with one JSON object and nothing else: no prose before or after it, no code fence.";

const DEPTH_NOTE: Record<Depth, string> = {
  Junior: "The learner is new to programming. Use everyday words and define any term you cannot avoid.",
  Mid: "The learner can read code but did not write this. Skip the basics and explain the mechanism.",
  Senior: "The learner is experienced. Go straight to the design choice, its cost, and what to verify.",
};

const prompt = (lines: Array<string | null | false | undefined>): Prompt => ({
  system: SYSTEM,
  user: lines.filter((l): l is string => typeof l === "string").join("\n"),
});

const fenced = (code: string) => "```\n" + code + "\n```";

/* ------------------------------------------------------------------ *
 * Reading JSON out of a reply
 * ------------------------------------------------------------------ */

/** The first balanced JSON object in a reply, however the model wrapped it. */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
};

/* ------------------------------------------------------------------ *
 * Explain, and follow-up
 * ------------------------------------------------------------------ */

export interface ExplainRequest {
  title: string;
  what: string;
  depth: Depth;
  file: string;
  /** Numbered lines from the learner's file. Null when the file could not be read. */
  excerpt: string | null;
  evidence: string;
}

export function explainPrompt(req: ExplainRequest): Prompt {
  return prompt([
    "An AI assistant wrote the code below while I watched. Teach me one idea in it.",
    "",
    `Idea: ${req.title}`,
    `In general: ${req.what}`,
    `File: ${req.file}`,
    "",
    req.excerpt
      ? "The relevant lines, with line numbers:\n" + fenced(req.excerpt)
      : `The line that uses it: ${req.evidence || "(not available)"}`,
    "",
    "Rules:",
    "- At most 110 words, in two short paragraphs. No headings, no lists, no greeting, no praise.",
    "- Paragraph one: what these specific lines do. Quote a short fragment in backticks and give its line number.",
    "- Paragraph two: why it is written this way, and the one thing I should check or could get wrong here.",
    "- Talk about this code, not the idea in general. If the lines do not actually use the idea, say so in one sentence.",
    `- ${DEPTH_NOTE[req.depth]}`,
  ]);
}

export function followUpPrompt(req: {
  title: string;
  file: string;
  excerpt: string | null;
  explanation: string;
  earlier: ReadonlyArray<{ question: string; answer: string }>;
  question: string;
  depth: Depth;
}): Prompt {
  return prompt([
    `I am learning about "${req.title}" from my own code in ${req.file}.`,
    req.excerpt ? "The lines, with line numbers:\n" + fenced(req.excerpt) : null,
    req.explanation ? `You already told me:\n${req.explanation}` : null,
    ...req.earlier.slice(-3).map((e) => `I asked: ${e.question}\nYou answered: ${e.answer}`),
    "",
    `My question: ${req.question.slice(0, 600)}`,
    "",
    "Rules:",
    "- Answer the question I asked, about this code, in at most 120 words. No headings, no greeting, no praise.",
    "- If the answer is not in the code shown, say what you would need to see.",
    `- ${DEPTH_NOTE[req.depth]}`,
  ]);
}

/* ------------------------------------------------------------------ *
 * A question about the learner's own lines
 * ------------------------------------------------------------------ */

export interface OwnQuestion {
  question: string;
  answer: string;
  distractors: string[];
  explanation: string;
}

export function ownQuestionPrompt(req: { title: string; file: string; excerpt: string; depth: Depth }): Prompt {
  return prompt([
    `Write one multiple-choice question that tests whether I understand how "${req.title}" is used in this code from ${req.file}.`,
    fenced(req.excerpt),
    "",
    "Rules:",
    "- Ask about what THIS code does or what would happen if something specific about it changed. Refer to a line number or quote a fragment.",
    "- One correct answer and exactly three wrong answers that someone with a real misunderstanding would pick.",
    "- All four about the same length. The correct answer must not be the longest. Do not repeat the question's wording in the correct answer.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "one or two sentences on why"}',
  ]);
}

/** Null unless there is a question, an answer and at least two distinct wrong answers. */
export function parseOwnQuestion(text: string): OwnQuestion | null {
  const o = obj(extractJson(text));
  const question = str(o.question, 400);
  const answer = str(o.answer, 240);
  const explanation = str(o.explanation, 600);
  const seen = new Set([answer.toLowerCase()]);
  const distractors: string[] = [];
  for (const raw of Array.isArray(o.distractors) ? o.distractors : []) {
    const d = str(raw, 240);
    if (!d || seen.has(d.toLowerCase())) continue;
    seen.add(d.toLowerCase());
    distractors.push(d);
  }
  if (!question || !answer || distractors.length < 2) return null;
  return { question, answer, distractors: distractors.slice(0, 4), explanation: explanation || answer };
}

/* ------------------------------------------------------------------ *
 * Explain it yourself first
 * ------------------------------------------------------------------ */

export type Verdict = "right" | "partly" | "wrong";

export interface AttemptFeedback {
  verdict: Verdict;
  feedback: string;
}

export function gradeAttemptPrompt(req: { title: string; excerpt: string; attempt: string; depth: Depth }): Prompt {
  return prompt([
    `Before reading any explanation, I tried to say in my own words what this code does. It relates to "${req.title}".`,
    fenced(req.excerpt),
    "",
    `What I wrote: ${req.attempt.slice(0, 800)}`,
    "",
    "Judge the meaning, not the wording. Rules:",
    '- verdict is "right" if I have the main point, "partly" if I have some of it or missed something that matters, "wrong" otherwise.',
    "- feedback is at most 70 words: say what I got right, then the one thing I missed or got wrong, pointing at a line. No praise beyond a plain statement of what was correct.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"verdict": "right" | "partly" | "wrong", "feedback": "..."}',
  ]);
}

export function parseAttemptFeedback(text: string): AttemptFeedback | null {
  const o = obj(extractJson(text));
  const verdict = str(o.verdict, 10).toLowerCase();
  const feedback = str(o.feedback, 700);
  if (!feedback || (verdict !== "right" && verdict !== "partly" && verdict !== "wrong")) return null;
  return { verdict, feedback };
}

/* ------------------------------------------------------------------ *
 * Find the bug
 * ------------------------------------------------------------------ */

export interface BugDrill {
  /** The learner's code with exactly one bug introduced. Never written to disk. */
  lines: string[];
  /** 1-based index into `lines`. */
  bugLine: number;
  hint: string;
  explanation: string;
}

export function bugDrillPrompt(req: { title: string; excerpt: string; depth: Depth }): Prompt {
  return prompt([
    `Here is working code of mine that uses "${req.title}". Make me a find-the-bug exercise from it.`,
    fenced(req.excerpt),
    "",
    "Rules:",
    "- Copy at most 25 consecutive lines of it WITHOUT the line-number prefixes, and change exactly one line so the code has a real bug connected to this idea.",
    "- The bug must be the kind that passes a quick look: a wrong condition, a missing await, an unchecked value, the wrong variable. Not a typo and not a syntax error.",
    "- Do not add comments that give it away. Keep every other line identical.",
    "- bugLine is the 1-based line number, within your copy, of the line you changed.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"code": "the copy, with the bug, lines separated by \\n", "bugLine": 7, "hint": "a nudge that does not name the line", "explanation": "what is wrong and what it would do at runtime"}',
  ]);
}

export function parseBugDrill(text: string): BugDrill | null {
  const o = obj(extractJson(text));
  const code = typeof o.code === "string" ? o.code.replace(/\r\n/g, "\n").replace(/\n+$/, "") : "";
  const lines = code.split("\n");
  const bugLine = int(o.bugLine);
  const explanation = str(o.explanation, 600);
  if (!code.trim() || lines.length < 3 || lines.length > 60 || !bugLine || bugLine > lines.length || !explanation) {
    return null;
  }
  // A "bug" on a blank line or a lone brace is a model that lost count.
  if (!/[A-Za-z0-9]/.test(lines[bugLine - 1])) return null;
  return { lines, bugLine, hint: str(o.hint, 300), explanation };
}

/* ------------------------------------------------------------------ *
 * A whole change: risks, walkthrough, ideas the pack does not know
 * ------------------------------------------------------------------ */

export interface ChangedFile {
  file: string;
  /** Numbered lines around what changed. */
  excerpt: string;
}

const MAX_CHANGE_CHARS = 9_000;

/** The files of a change as one block, cut off rather than sent in full. */
export function changeBlock(files: readonly ChangedFile[]): string {
  const parts: string[] = [];
  let size = 0;
  for (const f of files) {
    const part = `File: ${f.file}\n${fenced(f.excerpt)}`;
    if (size + part.length > MAX_CHANGE_CHARS) {
      if (!parts.length) parts.push(part.slice(0, MAX_CHANGE_CHARS));
      parts.push(`(${files.length - parts.length} more file(s) not shown)`);
      break;
    }
    parts.push(part);
    size += part.length;
  }
  return parts.join("\n\n");
}

export interface Risk {
  file: string;
  line: number | null;
  title: string;
  why: string;
  fix: string;
}

export function riskPrompt(files: readonly ChangedFile[], depth: Depth): Prompt {
  return prompt([
    "An AI assistant just made this change in my project. Tell me what in it could hurt me.",
    "",
    changeBlock(files),
    "",
    "Rules:",
    "- At most 3 risks, most serious first. Only real ones visible in these lines: lost or leaked data, a security hole, a crash on ordinary input, money spent by accident. Not style, not naming, not missing tests.",
    "- For each: the file, the line number, a title of at most 8 words, why it matters told as what would actually happen (at most 40 words), and the fix in one sentence.",
    "- If nothing here is risky, return an empty list. Do not invent a risk to have something to say.",
    `- ${DEPTH_NOTE[depth]}`,
    "",
    JSON_ONLY,
    '{"risks": [{"file": "path", "line": 12, "title": "...", "why": "...", "fix": "..."}]}',
  ]);
}

/** Null when the reply is not the expected shape; an empty list is a real answer. */
export function parseRisks(text: string, known: readonly string[]): Risk[] | null {
  const o = obj(extractJson(text));
  if (!Array.isArray(o.risks)) return null;
  const out: Risk[] = [];
  for (const raw of o.risks.slice(0, 3)) {
    const r = obj(raw);
    const title = str(r.title, 120);
    const why = str(r.why, 400);
    if (!title || !why) continue;
    out.push({ file: matchFile(str(r.file, 300), known), line: int(r.line), title, why, fix: str(r.fix, 300) });
  }
  return out;
}

export interface WalkStep {
  file: string;
  line: number | null;
  title: string;
  text: string;
}

export function walkthroughPrompt(files: readonly ChangedFile[], depth: Depth): Prompt {
  return prompt([
    "An AI assistant just made this change in my project. Walk me through it in the order that makes it understandable, which is usually the order the data flows, not the order of the files.",
    "",
    changeBlock(files),
    "",
    "Rules:",
    "- 3 to 7 steps. Each step points at one place: a file and a line number that exists in the lines above.",
    "- Each step has a title of at most 7 words and a text of at most 45 words saying what happens there and how it connects to the previous step.",
    "- The last step says what I would see as a user when all of it runs.",
    `- ${DEPTH_NOTE[depth]}`,
    "",
    JSON_ONLY,
    '{"steps": [{"file": "path", "line": 12, "title": "...", "text": "..."}]}',
  ]);
}

export function parseWalkthrough(text: string, known: readonly string[]): WalkStep[] | null {
  const o = obj(extractJson(text));
  if (!Array.isArray(o.steps)) return null;
  const out: WalkStep[] = [];
  for (const raw of o.steps.slice(0, 8)) {
    const s = obj(raw);
    const title = str(s.title, 100);
    const body = str(s.text, 500);
    if (!title || !body) continue;
    out.push({ file: matchFile(str(s.file, 300), known), line: int(s.line), title, text: body });
  }
  return out.length >= 2 ? out : null;
}

/** Models shorten and re-root paths. Map what they said back to a file we sent, or keep nothing. */
function matchFile(said: string, known: readonly string[]): string {
  if (!said) return known.length === 1 ? known[0] : "";
  const clean = said.replace(/\\/g, "/").replace(/^\.?\//, "");
  return (
    known.find((k) => k === clean) ??
    known.find((k) => k.endsWith("/" + clean) || clean.endsWith("/" + k)) ??
    known.find((k) => k.split("/").pop() === clean.split("/").pop()) ??
    ""
  );
}

/** An idea a model found that the built-in pack has no pattern for. */
export interface FoundIdea {
  title: string;
  topic: Topic;
  hook: string;
  what: string;
  know: string;
  pitfall: string;
  file: string;
  evidence: string;
  question: OwnQuestion | null;
}

export function findIdeasPrompt(files: readonly ChangedFile[], alreadyKnown: readonly string[], depth: Depth): Prompt {
  return prompt([
    "An AI assistant just made this change in my project. I want to understand what I am shipping.",
    "",
    changeBlock(files),
    "",
    "Name the ideas in this change that are most worth my understanding. Rules:",
    "- At most 2. An idea is a concept I could meet again in other code (for example: debouncing, optimistic updates, database indexes, recursion), not a description of this change.",
    "- Skip anything trivial, and skip these, which I am already being taught: " +
      (alreadyKnown.length ? alreadyKnown.slice(0, 40).join("; ") : "(none)") +
      ".",
    "- If nothing here is worth a lesson, return an empty list. That is a good answer.",
    "- For each idea: title (at most 6 words), topic (one of: " + TOPICS.join(", ") + "),",
    "  hook (one memorable line), what (one plain sentence saying what it is),",
    "  know (at most 60 words: the thing to understand, at my level),",
    "  pitfall (at most 45 words: how it goes wrong, told as what actually happens),",
    "  file and evidence (the one line of my code, copied exactly, that uses it),",
    "  question: one multiple-choice question about the IDEA (not about my code, so it still makes sense next month), with one answer, three wrong answers of similar length, and a short explanation.",
    `- ${DEPTH_NOTE[depth]}`,
    "",
    JSON_ONLY,
    '{"ideas": [{"title": "...", "topic": "...", "hook": "...", "what": "...", "know": "...", "pitfall": "...", "file": "path", "evidence": "...", "question": {"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "..."}}]}',
  ]);
}

export function parseFoundIdeas(text: string, known: readonly string[]): FoundIdea[] | null {
  const o = obj(extractJson(text));
  if (!Array.isArray(o.ideas)) return null;
  const out: FoundIdea[] = [];
  for (const raw of o.ideas.slice(0, 2)) {
    const i = obj(raw);
    const title = str(i.title, 80);
    const what = str(i.what, 400);
    const know = str(i.know, 700);
    const pitfall = str(i.pitfall, 500);
    if (!title || !what || !know || !pitfall) continue;
    out.push({
      title,
      topic: parseTopic(str(i.topic, 40)) ?? "Tooling",
      hook: str(i.hook, 200) || what,
      what,
      know,
      pitfall,
      file: matchFile(str(i.file, 300), known),
      evidence: str(i.evidence, 140),
      question: i.question ? parseOwnQuestion(JSON.stringify(i.question)) : null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * How this project works
 * ------------------------------------------------------------------ */

export interface ProjectContext {
  name: string;
  /** File paths, already trimmed to a sensible number. */
  tree: string[];
  totalFiles: number;
  /** The start of the files most likely to explain the project. */
  heads: Array<{ file: string; head: string }>;
}

export function projectMapPrompt(ctx: ProjectContext, depth: Depth): Prompt {
  const heads: string[] = [];
  let size = 0;
  for (const h of ctx.heads) {
    const part = `File: ${h.file}\n${fenced(h.head)}`;
    if (size + part.length > 12_000) break;
    heads.push(part);
    size += part.length;
  }
  return prompt([
    `This is my project "${ctx.name}". Much of it was written by an AI assistant and I do not have the whole picture. Explain how it works.`,
    "",
    `Files (${ctx.tree.length} of ${ctx.totalFiles}):`,
    ctx.tree.join("\n"),
    "",
    heads.join("\n\n"),
    "",
    "Write a map in markdown, at most 450 words, with exactly these sections:",
    "## What it is — two sentences.",
    "## How a request travels — a numbered list following one typical user action from the screen to the data and back, naming the file at each step.",
    "## Where things live — a short table of folder or file, and what it is responsible for.",
    "## What to understand first — the three files to read first and why, in order.",
    "## What I could not tell — anything you are guessing at from names alone. Do not present a guess as a fact.",
    "",
    "Only name files that appear in the list above.",
    `${DEPTH_NOTE[depth]}`,
  ]);
}

/* ------------------------------------------------------------------ *
 * Help that stops short of the answer
 *
 * An assistant that hands over the explanation leaves the learner able to
 * recognise it and unable to produce it. So the first two rungs are built to
 * withhold: a nudge directs attention without saying what is there, a pointer
 * names the place without explaining it. The full explanation is the third
 * step, never the first.
 * ------------------------------------------------------------------ */

export type Hint = "nudge" | "pointer";

export function hintPrompt(req: { step: Hint; title: string; file: string; excerpt: string; depth: Depth }): Prompt {
  const rules =
    req.step === "nudge"
      ? [
          "Give me a nudge, not an answer: one question, at most 25 words, that makes me look at the right thing.",
          "Do not name the line, do not name the function, and do not say what the code does.",
        ]
      : [
          "Point me at it without explaining it: at most 35 words.",
          "Name the line number and the one thing on it to look at, then ask me what I think it is for.",
          "Do not say what it does or why.",
        ];
  return prompt([
    `I am trying to work out for myself how "${req.title}" is used in this code from ${req.file}.`,
    fenced(req.excerpt),
    "",
    ...rules,
    "No greeting, no praise, no preamble.",
    DEPTH_NOTE[req.depth],
  ]);
}

/* ------------------------------------------------------------------ *
 * Practice: three more kinds of question
 * ------------------------------------------------------------------ */

export type PracticeKind = "why" | "trace" | "contrast";

/** A question about the reason for a choice, which is what transfers to other code. */
export function whyQuestionPrompt(req: { title: string; file: string; excerpt: string; depth: Depth }): Prompt {
  return prompt([
    `Write one multiple-choice "why" question about how "${req.title}" is used in this code from ${req.file}.`,
    fenced(req.excerpt),
    "",
    "Rules:",
    '- Ask why it is done this way rather than an obvious alternative (for example: "why a slow hash and not a fast one?"). Not what the code does.',
    "- The correct answer gives the real reason. The three wrong answers are reasons a person might believe that are false or beside the point.",
    "- All four about the same length. The correct answer must not be the longest.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "one or two sentences"}',
  ]);
}

/** A question whose answer can only be found by running the code in your head. */
export function traceQuestionPrompt(req: { title: string; file: string; excerpt: string; depth: Depth }): Prompt {
  return prompt([
    `Write one multiple-choice question that makes me trace this code from ${req.file} by hand.`,
    fenced(req.excerpt),
    "",
    "Rules:",
    '- Ask for a concrete value or outcome for a specific input: "what is `x` after line 9?", "what does this return for an empty list?", "which line runs last when the request fails?".',
    "- Choose an input where a careless reading gives a different answer from a careful one.",
    "- The correct answer must be exactly what this code does. Work it through step by step yourself before answering; if the lines shown are not enough to be certain, pick a different question.",
    "- Three wrong answers that come from specific misreadings. All four short.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "the trace, step by step, in at most three sentences"}',
  ]);
}

export interface ContrastPair {
  question: string;
  /** Two near-identical snippets. */
  a: string;
  b: string;
  /** Which one has the problem. */
  flawed: "a" | "b";
  explanation: string;
}

export function contrastPrompt(req: { title: string; excerpt: string; depth: Depth }): Prompt {
  return prompt([
    `Make me a spot-the-difference exercise about "${req.title}", based on this code of mine.`,
    fenced(req.excerpt),
    "",
    "Rules:",
    "- Write two versions of the same short snippet, 4 to 10 lines each, without line-number prefixes. One is correct. The other differs in one small place and has a real problem connected to this idea.",
    "- They must look almost identical: same names, same layout, same length.",
    "- No comments that give it away.",
    '- Decide at random which of "a" and "b" is the flawed one.',
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"question": "Which one has the problem?", "a": "snippet", "b": "snippet", "flawed": "a" | "b", "explanation": "what the difference is and what it causes"}',
  ]);
}

export function parseContrast(text: string): ContrastPair | null {
  const o = obj(extractJson(text));
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "") : "");
  const a = clean(o.a);
  const b = clean(o.b);
  const flawed = str(o.flawed, 2).toLowerCase();
  const explanation = str(o.explanation, 600);
  const lines = (s: string) => s.split("\n").length;
  if (!a || !b || a === b || !explanation || (flawed !== "a" && flawed !== "b")) return null;
  if (lines(a) < 2 || lines(a) > 20 || lines(b) > 20 || a.length > 1_500 || b.length > 1_500) return null;
  // "Near-identical" is the exercise. Two different programs are a different, worse one.
  if (Math.abs(lines(a) - lines(b)) > 2) return null;
  return { question: str(o.question, 200) || "Which one has the problem?", a, b, flawed, explanation };
}

/* ------------------------------------------------------------------ *
 * Your turn: a small change to write without the assistant
 * ------------------------------------------------------------------ */

export interface YourTurn {
  task: string;
  file: string;
  /** What to look for afterwards, so the learner can tell they are done. */
  done: string;
  hint: string;
}

export function yourTurnPrompt(files: readonly ChangedFile[], depth: Depth): Prompt {
  return prompt([
    "An AI assistant just made this change in my project. I want to write the next small piece myself, without it, to check I understand.",
    "",
    changeBlock(files),
    "",
    "Propose one follow-up change for me to make by hand. Rules:",
    "- About 5 lines of code, in one of the files above, using the same idea the change uses. Small enough for ten minutes.",
    "- Something the code would genuinely be better for: a missing check, an edge case, a second case of the same pattern. Not a rename, not a comment, not a refactor.",
    "- Describe what to achieve, in at most 40 words. Do NOT write the code and do not name the exact functions to call.",
    "- done: one sentence saying how I will know it works.",
    "- hint: one sentence I can ask for if I am stuck, which still does not give the code.",
    `- ${DEPTH_NOTE[depth]}`,
    "",
    JSON_ONLY,
    '{"task": "...", "file": "path", "done": "...", "hint": "..."}',
  ]);
}

export function parseYourTurn(text: string, known: readonly string[]): YourTurn | null {
  const o = obj(extractJson(text));
  const task = str(o.task, 400);
  const file = matchFile(str(o.file, 300), known);
  if (!task || !file) return null;
  // A "task" that contains the code is the assistant doing it for them again.
  if (/```|;\s*\n|\n\s{2,}\S/.test(typeof o.task === "string" ? o.task : "")) return null;
  return { task, file, done: str(o.done, 300), hint: str(o.hint, 300) };
}
