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
  const question = str(o.question, 1_200);
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
  /** A general idea, or a specific tool the change brought in (taught as a tool track instead). */
  kind: "idea" | "tool";
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
    "- A specific library, framework or service this change newly brings in also counts (for example: Sentry, Stripe, Zod). Mark it kind \"tool\" and use its real name as the title. A general idea below does not cover a specific tool: \"Handling failure\" is not \"Sentry\".",
    "- Skip anything trivial, and skip these exact ideas, which I am already being taught: " +
      (alreadyKnown.length ? alreadyKnown.slice(0, 40).join("; ") : "(none)") +
      ".",
    "- If nothing here is worth a lesson, return an empty list. That is a good answer.",
    "- For each idea: kind (\"idea\" or \"tool\"), title (at most 6 words), topic (one of: " + TOPICS.join(", ") + "),",
    "  hook (one memorable line), what (one plain sentence saying what it is),",
    "  know (at most 60 words: the thing to understand, at my level),",
    "  pitfall (at most 45 words: how it goes wrong, told as what actually happens),",
    "  file and evidence (the one line of my code, copied exactly, that uses it),",
    "  question: one multiple-choice question about the IDEA (not about my code, so it still makes sense next month), with one answer, three wrong answers of similar length, and a short explanation.",
    `- ${DEPTH_NOTE[depth]}`,
    "",
    JSON_ONLY,
    '{"ideas": [{"kind": "idea", "title": "...", "topic": "...", "hook": "...", "what": "...", "know": "...", "pitfall": "...", "file": "path", "evidence": "...", "question": {"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "..."}}]}',
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
      kind: str(i.kind, 10).toLowerCase() === "tool" ? "tool" : "idea",
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

/**
 * The same idea somewhere it was not learned. Recognising a thing in the file
 * where you first met it is memory of the file; recognising it in another
 * language is understanding of the idea.
 */
export function transferQuestionPrompt(req: { title: string; what: string; file: string; depth: Depth }): Prompt {
  const ext = (req.file.split(".").pop() || "").toLowerCase();
  return prompt([
    `I learned the idea "${req.title}" (${req.what}) from a .${ext || "code"} file in my own project.`,
    "Write one multiple-choice question that tests whether I can recognise or apply the same idea in a DIFFERENT language or framework.",
    "",
    "Rules:",
    "- Put a snippet of 3 to 8 lines in the question, inside a code fence, in a language that is not the one above.",
    "- Ask what is wrong with it, what it does, or what should change, such that only someone who understands the idea (not the syntax) can answer.",
    "- One correct answer and three wrong answers of similar length. The correct answer must not be the longest.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"question": "text with a ``` fenced snippet", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "one or two sentences"}',
  ]);
}

/* ------------------------------------------------------------------ *
 * Tools: a primer tied to this project
 * ------------------------------------------------------------------ */

export type RiskKind = "security" | "cost" | "reliability" | "setup";
const RISK_KINDS: readonly RiskKind[] = ["security", "cost", "reliability", "setup"];

export interface ToolPrimer {
  /** What it does in this project, in a few plain sentences. */
  summary: string;
  wired: Array<{ file: string; line: number | null; what: string }>;
  flow: string[];
  risks: Array<{ title: string; why: string; kind: RiskKind }>;
  /** What this project would be like without the tool, for the before-and-after at the top of its page. */
  without: string;
  verify: string;
  /** Said about the learner's guess, when they made one. */
  guessFeedback: string;
  /** Only for tools the catalogue does not know: the model describes the tool too. */
  spec?: {
    name: string;
    emoji: string;
    job: string;
    oneLiner: string;
    terms: Array<{ term: string; meaning: string }>;
    topic: string;
  };
}

export function toolPrimerPrompt(req: {
  name: string;
  /** Known from the catalogue; absent when the model must describe the tool from scratch. */
  job?: string;
  terms?: readonly string[];
  files: readonly ChangedFile[];
  guess?: string;
  depth: Depth;
}): Prompt {
  const describe = !req.job;
  return prompt([
    `My project uses ${req.name}${req.job ? ` (${req.job})` : ""}. My AI assistant set it up; I want to become conversant in it, not just have it.`,
    "",
    req.files.length ? "Where it appears in my project:" : "I could not find where it appears in my project.",
    req.files.length ? changeBlock(req.files) : "",
    req.guess ? `\nBefore reading anything, I guessed it is for: "${req.guess.slice(0, 300)}"` : "",
    "",
    "Rules:",
    `- summary: at most 60 words. What ${req.name} does for THIS project specifically, and what would be missing without it.`,
    "- wired: up to 5 places in the lines above where it is set up or used: file, line number, and what that line does in at most 15 words. Only lines that exist above. Empty if none.",
    "- flow: 3 to 5 short steps (at most 15 words each) of what happens at runtime, in order, in this project.",
    `- without: at most 30 words. What this project would have to do, or would suffer, without ${req.name}. Concrete to this project, no "you would need to".`,
    '- risks: up to 3 ways this particular setup could hurt me, each a title of at most 8 words, why in at most 35 words, and kind: "security" (leaked data, someone gets in), "cost" (money or quota), "reliability" (fails or breaks in use) or "setup" (fails to start or configure). Only real ones.',
    "- verify: one concrete way to prove it works in this project, in at most 35 words.",
    req.guess
      ? "- guessFeedback: at most 35 words. Say plainly what my guess got right and what it missed. No praise words."
      : '- guessFeedback: "".',
    describe
      ? '- Also describe the tool: name, emoji (one), job (2-4 words, e.g. "Error monitoring"), oneLiner (at most 20 words), topic (one of: ' +
          TOPICS.join(", ") +
          "), and terms: the 5 or 6 words someone must know to be conversant, each with a meaning of one plain sentence (60-120 characters) that does not repeat the term itself."
      : `- Do not redefine its vocabulary (${(req.terms ?? []).slice(0, 8).join(", ")}); that is taught separately.`,
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    describe
      ? '{"summary": "...", "without": "...", "wired": [{"file": "path", "line": 12, "what": "..."}], "flow": ["..."], "risks": [{"title": "...", "why": "...", "kind": "security" | "cost" | "reliability" | "setup"}], "verify": "...", "guessFeedback": "...", "name": "...", "emoji": "...", "job": "...", "oneLiner": "...", "topic": "...", "terms": [{"term": "...", "meaning": "..."}]}'
      : '{"summary": "...", "without": "...", "wired": [{"file": "path", "line": 12, "what": "..."}], "flow": ["..."], "risks": [{"title": "...", "why": "...", "kind": "security" | "cost" | "reliability" | "setup"}], "verify": "...", "guessFeedback": "..."}',
  ]);
}

export function parseToolPrimer(text: string, known: readonly string[], describe: boolean): ToolPrimer | null {
  const o = obj(extractJson(text));
  const summary = str(o.summary, 700);
  if (!summary) return null;
  const wired = (Array.isArray(o.wired) ? o.wired : [])
    .map(obj)
    .map((w) => ({ file: matchFile(str(w.file, 300), known), line: int(w.line), what: str(w.what, 200) }))
    .filter((w) => w.file && w.what)
    .slice(0, 5);
  const flow = (Array.isArray(o.flow) ? o.flow : []).map((s) => str(s, 160)).filter(Boolean).slice(0, 5);
  const risks = (Array.isArray(o.risks) ? o.risks : [])
    .map(obj)
    .map((r) => {
      const kind = str(r.kind, 20).toLowerCase();
      return { title: str(r.title, 100), why: str(r.why, 300), kind: (RISK_KINDS.find((k) => k === kind) ?? "reliability") as RiskKind };
    })
    .filter((r) => r.title && r.why)
    .slice(0, 3);
  const primer: ToolPrimer = { summary, wired, flow, risks, without: str(o.without, 300), verify: str(o.verify, 300), guessFeedback: str(o.guessFeedback, 300) };
  if (describe) {
    const terms = (Array.isArray(o.terms) ? o.terms : [])
      .map(obj)
      .map((t) => ({ term: str(t.term, 40), meaning: str(t.meaning, 200) }))
      .filter((t) => t.term && t.meaning.length >= 20)
      .slice(0, 6);
    const oneLiner = str(o.oneLiner, 200);
    if (terms.length < 3 || !oneLiner) return null;
    primer.spec = {
      name: str(o.name, 60),
      emoji: str(o.emoji, 8),
      job: str(o.job, 60),
      oneLiner,
      terms,
      topic: str(o.topic, 40),
    };
  }
  return primer;
}

/* ------------------------------------------------------------------ *
 * Debugging: reading an error before the assistant fixes it
 * ------------------------------------------------------------------ */

export interface Diagnosis {
  /** Absent when the learner skipped straight to the answer. */
  verdict?: Verdict;
  feedback: string;
  cause: string;
  where: { file: string; line: number | null } | null;
  fix: string;
  /** 1-based line of the error excerpt that gives it away. */
  clue: number | null;
  /** The transferable habit: how to read the next error like this one. */
  habit: string;
}

function errorBlock(error: string): string {
  return error
    .split("\n")
    .map((l, i) => `${i + 1}: ${l}`)
    .join("\n");
}

export function diagnosePrompt(req: {
  command: string;
  error: string;
  guess: string;
  /** The line of the error the learner picked as the clue, 1-based. */
  picked: number | null;
  code: readonly ChangedFile[];
  depth: Depth;
}): Prompt {
  const tried = Boolean(req.guess.trim() || req.picked);
  return prompt([
    `This command failed in my project: \`${req.command.slice(0, 200)}\``,
    "The error lines (numbered):",
    fenced(errorBlock(req.error)),
    req.code.length ? "\nCode it may be about:\n" + changeBlock(req.code) : "",
    "",
    tried
      ? `Before asking, I tried to read it myself.${req.picked ? ` I thought line ${req.picked} of the error was the clue.` : ""}${req.guess.trim() ? ` My read: "${req.guess.slice(0, 600)}"` : ""}`
      : "I did not try to read it; show me how.",
    "",
    "Rules:",
    tried
      ? '- verdict: "right" if my read has the actual cause, "partly" if I was close or found the place but not the reason, "wrong" otherwise. feedback: at most 50 words, what I read correctly, then what I missed. No praise words.'
      : '- verdict: omit it. feedback: "".',
    "- cause: at most 40 words, what actually went wrong, in plain words.",
    "- where: the file and line in my code to look at, if the error or the code shows it; otherwise null.",
    "- fix: one sentence, the change to make. Do not write the code.",
    "- clue: the number of the error line above that gives it away most directly.",
    "- habit: at most 25 words, a reading habit that would find this kind of error fast next time.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"verdict": "right" | "partly" | "wrong", "feedback": "...", "cause": "...", "where": {"file": "path", "line": 12} | null, "fix": "...", "clue": 2, "habit": "..."}',
  ]);
}

export function parseDiagnosis(text: string, known: readonly string[], errorLines: number): Diagnosis | null {
  const o = obj(extractJson(text));
  const cause = str(o.cause, 500);
  if (!cause) return null;
  const v = str(o.verdict, 10).toLowerCase();
  const w = o.where && typeof o.where === "object" ? obj(o.where) : null;
  const whereFile = w ? str(w.file, 300) : "";
  const clue = int(o.clue);
  return {
    ...(v === "right" || v === "partly" || v === "wrong" ? { verdict: v as Verdict } : {}),
    feedback: str(o.feedback, 600),
    cause,
    // A path the error names may not be one we sent; keep it if it looks like a path.
    where: whereFile ? { file: matchFile(whereFile, known) || whereFile.replace(/^\.?\//, ""), line: w ? int(w.line) : null } : null,
    fix: str(o.fix, 400),
    clue: clue && clue <= errorLines ? clue : null,
    habit: str(o.habit, 300),
  };
}

export function debugHintPrompt(req: { command: string; error: string; step: Hint; depth: Depth }): Prompt {
  return prompt([
    `This command failed: \`${req.command.slice(0, 200)}\``,
    fenced(errorBlock(req.error)),
    "",
    req.step === "nudge"
      ? "I am trying to read this error myself. Give me a nudge: one question (at most 25 words) that makes me look at the right part. Do NOT say what is wrong."
      : "I am still stuck. Point me at the error line that matters and say what kind of problem it signals (at most 35 words). Do NOT give the fix.",
    `${DEPTH_NOTE[req.depth]}`,
    "Reply with the text only.",
  ]);
}

/* ------------------------------------------------------------------ *
 * Decisions: what was chosen, over what, and why
 * ------------------------------------------------------------------ */

export interface FoundDecision {
  title: string;
  chose: string;
  over: string[];
  because: string;
  tradeoff: string;
  revisit: string;
  question: OwnQuestion | null;
}

export function decisionsPrompt(req: { files: readonly ChangedFile[]; tool?: string; depth: Depth }): Prompt {
  return prompt([
    req.tool
      ? `My project just adopted ${req.tool}. Help me record why, so I can still explain the choice in six months.`
      : "An AI assistant just made this change in my project. Name the design decisions in it, so I can explain them later.",
    "",
    req.files.length ? changeBlock(req.files) : "",
    "",
    "Rules:",
    `- At most ${req.tool ? 1 : 3} decisions. A decision is a real choice between alternatives a developer could reasonably have picked (a library, a data shape, where logic runs, sync vs background). Not style, not naming.`,
    "- If nothing here was a real choice, return an empty list. That is a good answer.",
    "- For each: title (at most 8 words), chose (at most 10 words), over (1 to 3 real alternatives, at most 8 words each), because (at most 40 words, the reason that applies to THIS project), tradeoff (at most 30 words, what was given up), revisit (at most 20 words, the sign it should be reconsidered).",
    "- question: one multiple-choice question asking why this project chose it, with the real reason as the answer and three plausible but wrong reasons of similar length, and a one-sentence explanation.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"decisions": [{"title": "...", "chose": "...", "over": ["..."], "because": "...", "tradeoff": "...", "revisit": "...", "question": {"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "..."}}]}',
  ]);
}

export function parseDecisions(text: string): FoundDecision[] | null {
  const o = obj(extractJson(text));
  if (!Array.isArray(o.decisions)) return null;
  return o.decisions
    .map(obj)
    .map((d) => ({
      title: str(d.title, 120),
      chose: str(d.chose, 120),
      over: (Array.isArray(d.over) ? d.over : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 3),
      because: str(d.because, 500),
      tradeoff: str(d.tradeoff, 400),
      revisit: str(d.revisit, 300),
      question: d.question ? parseOwnQuestion(JSON.stringify(d.question)) : null,
    }))
    .filter((d) => d.title && d.chose && d.because)
    .slice(0, 3);
}

/* ------------------------------------------------------------------ *
 * Incidents: something broke for real
 * ------------------------------------------------------------------ */

export interface IncidentLesson {
  title: string;
  whatBroke: string;
  cause: string;
  prevention: string;
  /** The id of a known idea this was an instance of, or "". */
  related: string;
  question: OwnQuestion | null;
}

export function incidentPrompt(req: { report: string; ideas: ReadonlyArray<{ id: string; title: string }>; depth: Depth }): Prompt {
  return prompt([
    "Something broke in my project for real. Here is what I have: an error, a bug report, or my notes.",
    fenced(req.report.slice(0, 4_000)),
    "",
    "Turn it into a lesson I will remember. Rules:",
    "- title: at most 8 words, what happened.",
    "- whatBroke: at most 40 words, what users or I saw.",
    "- cause: at most 50 words, the root cause in plain words. If the report is not enough to know, say what is most likely and what to check.",
    "- prevention: at most 40 words, the habit or check that would have caught it before it shipped.",
    "- related: the id of the idea below this was most an instance of, or \"\" if none fits.",
    req.ideas.map((i) => `  ${i.id}: ${i.title}`).join("\n"),
    "- question: one multiple-choice question that tests the lesson (not the specific error text), with one answer, three plausible wrong answers of similar length, and a one-sentence explanation.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"title": "...", "whatBroke": "...", "cause": "...", "prevention": "...", "related": "id or empty", "question": {"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "..."}}',
  ]);
}

export function parseIncident(text: string, ideas: readonly string[]): IncidentLesson | null {
  const o = obj(extractJson(text));
  const title = str(o.title, 120);
  const cause = str(o.cause, 500);
  if (!title || !cause) return null;
  const related = str(o.related, 60);
  return {
    title,
    whatBroke: str(o.whatBroke, 500),
    cause,
    prevention: str(o.prevention, 500),
    related: ideas.includes(related) ? related : "",
    question: o.question ? parseOwnQuestion(JSON.stringify(o.question)) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Before you commit: one question about the change
 * ------------------------------------------------------------------ */

export function commitQuestionPrompt(files: readonly ChangedFile[], depth: Depth): Prompt {
  return prompt([
    "I am about to commit this change. Ask me one question that checks I know what I am committing.",
    "",
    changeBlock(files),
    "",
    "Rules:",
    "- One multiple-choice question about what this change does or what happens in a case it handles (or fails to handle). Something I should be able to answer if I read it; not trivia about names.",
    "- One correct answer and three wrong answers of similar length. The correct answer must not be the longest.",
    "- explanation: one or two sentences pointing at the line that decides it.",
    `- ${DEPTH_NOTE[depth]}`,
    "",
    JSON_ONLY,
    '{"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "..."}',
  ]);
}

/* ------------------------------------------------------------------ *
 * Explain it in your own words (free recall, graded)
 * ------------------------------------------------------------------ */

export function recallGradePrompt(req: { idea: string; question: string; truth: string; why: string; answer: string; depth: Depth }): Prompt {
  return prompt([
    `A review question about "${req.idea}", which I answered in my own words without seeing any choices.`,
    `Question: ${req.question.slice(0, 600)}`,
    `The expected answer: ${req.truth.slice(0, 300)}`,
    `Why: ${req.why.slice(0, 500)}`,
    "",
    `What I wrote: ${req.answer.slice(0, 800)}`,
    "",
    "Judge the meaning, not the wording. Rules:",
    '- verdict is "right" if I have the expected answer\'s main point, "partly" if I have part of it or something vague that could be it, "wrong" otherwise.',
    "- feedback: at most 45 words. What I got right, then the one thing missing. No praise words.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"verdict": "right" | "partly" | "wrong", "feedback": "..."}',
  ]);
}

/* ------------------------------------------------------------------ *
 * Blind spots: one exercise for a skill not met yet
 * ------------------------------------------------------------------ */

export function skillExercisePrompt(req: { skill: string; why: string; tree: readonly string[]; heads: readonly ChangedFile[]; depth: Depth }): Prompt {
  return prompt([
    `I am building a project with an AI assistant, and I have not practised this yet: "${req.skill}" (${req.why}).`,
    "Suggest one small exercise I can do by hand, in my own project, to practise it.",
    "",
    "Files in the project:",
    req.tree.slice(0, 150).join("\n"),
    req.heads.length ? "\n" + changeBlock(req.heads) : "",
    "",
    "Rules:",
    "- task: at most 45 words, something real this project would be better for, about 10 to 30 minutes of work. Describe what to achieve; do NOT write the code.",
    "- file: the one file above to start in.",
    "- done: one sentence saying how I will know it works.",
    "- hint: one sentence I can ask for if stuck, which still does not give the code.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"task": "...", "file": "path", "done": "...", "hint": "..."}',
  ]);
}

/* ------------------------------------------------------------------ *
 * Your story: interview practice from real work
 * ------------------------------------------------------------------ */

export function storyQuestionPrompt(entries: ReadonlyArray<{ kind: string; title: string; detail: string }>): Prompt {
  return prompt([
    "These are things I really did while building my projects:",
    entries.map((e, i) => `${i + 1}. [${e.kind}] ${e.title}: ${e.detail}`).join("\n"),
    "",
    'Ask me one behavioural interview question ("Tell me about a time…") that one of these would be a strong answer to.',
    "Rules: the question at most 30 words; entry is the number of the item it fits best.",
    "",
    JSON_ONLY,
    '{"question": "...", "entry": 1}',
  ]);
}

export function parseStoryQuestion(text: string, count: number): { question: string; entry: number } | null {
  const o = obj(extractJson(text));
  const question = str(o.question, 300);
  const entry = int(o.entry);
  if (!question) return null;
  return { question, entry: entry && entry <= count ? entry : 1 };
}

export function storyFeedbackPrompt(req: { question: string; answer: string; entry: { title: string; detail: string } }): Prompt {
  return prompt([
    `Interview question: ${req.question}`,
    `What really happened (from my notes): ${req.entry.title}: ${req.entry.detail}`,
    "",
    `My spoken answer, typed: ${req.answer.slice(0, 1_500)}`,
    "",
    "Coach my answer like a kind, direct interviewer. Rules:",
    '- verdict: "right" if it would land well, "partly" if it has the bones but is missing something, "wrong" if it does not answer the question.',
    "- feedback: at most 80 words. Check it has the situation, what I did (not what the AI did), the result, and what I learned. Name the one thing to add or cut.",
    "",
    JSON_ONLY,
    '{"verdict": "right" | "partly" | "wrong", "feedback": "..."}',
  ]);
}

/* ------------------------------------------------------------------ *
 * Why not another way? The road not taken, for one idea in one place
 * ------------------------------------------------------------------ */

export interface Alternative {
  name: string;
  /** A few lines showing the other way, or "" when words say it better. */
  sketch: string;
  /** What this way would have done better here. */
  wins: string;
  /** What it would have cost here. */
  costs: string;
  /** When this would be the better choice. */
  when: string;
}

export interface Alternatives {
  /** The approach the code took, in a few words. */
  chosen: string;
  /** Why it fits this code. */
  why: string;
  alternatives: Alternative[];
  /** One sentence: was the choice right for this project? */
  verdict: string;
  /** Feedback on the learner's own idea, or "" when they skipped. */
  onGuess: string;
}

export function alternativesPrompt(req: { title: string; file: string; excerpt: string; guess: string; depth: Depth }): Prompt {
  const guess = req.guess.trim().slice(0, 600);
  return prompt([
    `This code from ${req.file} uses "${req.title}". An AI assistant wrote it for my project. Show me the other ways it could have been done, and why this one was picked.`,
    fenced(req.excerpt),
    "",
    guess ? `Before asking, I guessed another way myself: "${guess}"` : "",
    "",
    "Rules:",
    "- chosen: at most 10 words naming the approach this code takes.",
    "- why: at most 40 words on why it suits THIS code, citing a line number or a fragment.",
    "- alternatives: exactly 2 real alternatives a competent developer might have picked here. Not straw men, not the same thing renamed.",
    "- For each: name (at most 8 words); sketch (at most 8 lines of code in the same language showing the other way, or an empty string if code would not help); wins (at most 30 words, what it does better here); costs (at most 30 words, what it would cost in this project); when (at most 20 words, the situation where it would be the better pick).",
    "- verdict: one sentence, at most 30 words, on whether the chosen way was the right call for this project, and what would change that.",
    guess
      ? "- onGuess: at most 40 words on my guess. Say plainly whether it would work here and what it would trade, as one of the real options or not. No praise words."
      : '- onGuess: "".',
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"chosen": "...", "why": "...", "alternatives": [{"name": "...", "sketch": "...", "wins": "...", "costs": "...", "when": "..."}], "verdict": "...", "onGuess": "..."}',
  ]);
}

/** Null unless there is a chosen way, a reason, and at least one usable alternative. */
export function parseAlternatives(text: string): Alternatives | null {
  const o = obj(extractJson(text));
  const chosen = str(o.chosen, 120);
  const why = str(o.why, 500);
  const seen = new Set<string>([chosen.toLowerCase()]);
  const alternatives: Alternative[] = [];
  for (const raw of Array.isArray(o.alternatives) ? o.alternatives : []) {
    const a = obj(raw);
    const name = str(a.name, 100);
    const costs = str(a.costs, 400);
    if (!name || !costs || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const sketch = str(a.sketch, 1_200)
      .replace(/^```[a-zA-Z0-9]*\n?/, "")
      .replace(/\n?```$/, "")
      .split("\n")
      .slice(0, 10)
      .join("\n");
    alternatives.push({ name, sketch, wins: str(a.wins, 400), costs, when: str(a.when, 300) });
  }
  if (!chosen || !why || !alternatives.length) return null;
  return { chosen, why, alternatives: alternatives.slice(0, 2), verdict: str(o.verdict, 400), onGuess: str(o.onGuess, 500) };
}

/* ------------------------------------------------------------------ *
 * The project's own glossary
 * ------------------------------------------------------------------ */

export interface GlossaryTerm {
  term: string;
  /** What the word means, in plain language. */
  meaning: string;
  /** How this codebase uses it: the type, table or function it lives in. */
  inProject: string;
  /** Files it appears in, from the files shown. */
  where: string[];
  /** Other terms it connects to. */
  related: string[];
  question: OwnQuestion | null;
}

export function glossaryPrompt(req: { files: readonly ChangedFile[]; tree: readonly string[]; known: readonly string[]; depth: Depth }): Prompt {
  return prompt([
    "I am building a project with an AI assistant. Find the words that belong to THIS project's world, the ones a new person on the team would have to learn, and explain each as it is used here.",
    "",
    req.tree.length ? "Files in the project:\n" + req.tree.slice(0, 120).join("\n") : "",
    "",
    changeBlock(req.files),
    "",
    req.known.length ? `Terms already in my glossary (do not repeat them): ${req.known.slice(0, 80).join(", ")}` : "",
    "",
    "Rules:",
    "- A term is a word from the project's domain or a name this project coined: a business concept (an invoice, a tenant, a settlement), a role, a status, or a project-specific type or table name.",
    "- Not programming concepts (async, state, endpoint, middleware), not library or tool names (React, Prisma, Stripe), not file names, not generic words like user or data unless this project gives them a special meaning.",
    "- At most 8 terms, most important first. If the code shows none, return an empty list. That is a good answer.",
    "- For each: term (at most 4 words, as written in the code or as people would say it); meaning (at most 30 words, plain language, what it is in the real world of this product); inProject (at most 40 words, how the code represents it: the type, table, field or function, and what it holds); where (1 to 3 file paths, copied exactly from the files shown); related (0 to 3 other terms from your list or my glossary).",
    "- question: one multiple-choice question about what the term means in this project, with the right answer and three wrong ones a newcomer might believe, all of similar length, and a one-sentence explanation.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"terms": [{"term": "...", "meaning": "...", "inProject": "...", "where": ["..."], "related": ["..."], "question": {"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "..."}}]}',
  ]);
}

/**
 * Terms with their claims checked: files must be ones that were shown, and a
 * term already in the glossary is dropped rather than duplicated.
 */
export function parseGlossary(text: string, knownFiles: readonly string[], existing: readonly string[]): GlossaryTerm[] | null {
  const o = obj(extractJson(text));
  if (!Array.isArray(o.terms)) return null;
  const files = new Set(knownFiles);
  const taken = new Set(existing.map((t) => t.toLowerCase()));
  const out: GlossaryTerm[] = [];
  for (const raw of o.terms) {
    const t = obj(raw);
    const term = str(t.term, 60);
    const meaning = str(t.meaning, 400);
    if (!term || !meaning || taken.has(term.toLowerCase())) continue;
    taken.add(term.toLowerCase());
    const where = (Array.isArray(t.where) ? t.where : []).map((w) => str(w, 300)).filter((w) => files.has(w)).slice(0, 3);
    const related = (Array.isArray(t.related) ? t.related : [])
      .map((r) => str(r, 60))
      .filter((r) => r && r.toLowerCase() !== term.toLowerCase())
      .slice(0, 3);
    out.push({
      term,
      meaning,
      inProject: str(t.inProject, 500),
      where,
      related,
      question: t.question ? parseOwnQuestion(JSON.stringify(t.question)) : null,
    });
    if (out.length >= 8) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Reading code you did not write
 * ------------------------------------------------------------------ */

export interface ReadingFeedback {
  verdict: Verdict;
  feedback: string;
  /** What the function really does, in plain words. */
  summary: string;
  /** The one thing in it most worth noticing: an edge case, a side effect, a hidden assumption. */
  notice: string;
}

export function readCodePrompt(req: { file: string; name: string; signature: string; code: string; guess: string; depth: Depth }): Prompt {
  return prompt([
    `I am practising reading code I did not write. From only the name and signature of \`${req.name}\` in ${req.file}, I predicted what it does:`,
    `Signature: ${req.signature.slice(0, 200)}`,
    `My prediction: "${req.guess.slice(0, 800)}"`,
    "",
    "Here is the whole function:",
    fenced(req.code),
    "",
    "Rules:",
    '- verdict: "right" if my prediction has what it does, "partly" if I have the gist but missed something that matters, "wrong" otherwise.',
    "- feedback: at most 45 words. What I read correctly from the name, then what the name hid.",
    "- summary: at most 40 words, what it actually does, including inputs, output and side effects.",
    "- notice: at most 30 words, the one thing in the body most worth noticing (an edge case, a side effect, an assumption that would break). Point at a line number.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"verdict": "right" | "partly" | "wrong", "feedback": "...", "summary": "...", "notice": "..."}',
  ]);
}

export function parseReading(text: string): ReadingFeedback | null {
  const graded = parseAttemptFeedback(text);
  const o = obj(extractJson(text));
  const summary = str(o.summary, 400);
  if (!graded || !summary) return null;
  return { ...graded, summary, notice: str(o.notice, 300) };
}

/* ------------------------------------------------------------------ *
 * A major version upgrade
 * ------------------------------------------------------------------ */

export interface UpgradeLesson {
  summary: string;
  changes: Array<{ title: string; why: string; file: string; line: number | null }>;
  checklist: string[];
  guessFeedback: string;
  question: OwnQuestion | null;
}

export function upgradePrompt(req: { name: string; from: string; to: string; files: readonly ChangedFile[]; guess: string; depth: Depth }): Prompt {
  return prompt([
    `My project just upgraded ${req.name} from ${req.from} to ${req.to}, a major version. I want to understand what that means for my code.`,
    "",
    req.files.length ? "Where my project uses it:\n" + changeBlock(req.files) : "I could not find where my project uses it.",
    req.guess ? `\nBefore reading anything, I guessed this might break: "${req.guess.slice(0, 400)}"` : "",
    "",
    "Rules:",
    `- summary: at most 50 words, what changed between these versions that a user of ${req.name} must know. If you are not sure of the details of these exact versions, say so plainly instead of inventing them.`,
    "- changes: up to 4 breaking or important changes, each a title (at most 8 words), why it matters (at most 35 words), and the file and line above it affects if any (else empty file and null line). Only lines that exist above.",
    "- checklist: 2 to 4 short things to check or run to know the upgrade is safe in this project.",
    req.guess ? "- guessFeedback: at most 30 words on my guess, plainly." : '- guessFeedback: "".',
    "- question: one multiple-choice question about the most important change, with one answer, three plausible wrong answers of similar length, and a one-sentence explanation.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"summary": "...", "changes": [{"title": "...", "why": "...", "file": "path or empty", "line": 12}], "checklist": ["..."], "guessFeedback": "...", "question": {"question": "...", "answer": "...", "distractors": ["...", "...", "..."], "explanation": "..."}}',
  ]);
}

export function parseUpgrade(text: string, known: readonly string[]): UpgradeLesson | null {
  const o = obj(extractJson(text));
  const summary = str(o.summary, 500);
  if (!summary) return null;
  return {
    summary,
    changes: (Array.isArray(o.changes) ? o.changes : [])
      .map(obj)
      .map((c) => ({ title: str(c.title, 100), why: str(c.why, 300), file: matchFile(str(c.file, 300), known), line: int(c.line) }))
      .filter((c) => c.title && c.why)
      .slice(0, 4),
    checklist: (Array.isArray(o.checklist) ? o.checklist : []).map((s) => str(s, 200)).filter(Boolean).slice(0, 4),
    guessFeedback: str(o.guessFeedback, 300),
    question: o.question ? parseOwnQuestion(JSON.stringify(o.question)) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Mock interview: one open answer, judged like an interviewer would
 * ------------------------------------------------------------------ */

export function interviewGradePrompt(req: { question: string; truth: string; why: string; answer: string; seconds: number; depth: Depth }): Prompt {
  return prompt([
    "This is a mock technical interview. Judge my answer the way a fair interviewer would.",
    `Question: ${req.question.slice(0, 600)}`,
    `A good answer covers: ${req.truth.slice(0, 300)}. ${req.why.slice(0, 400)}`,
    `I took ${Math.round(req.seconds)} seconds.`,
    "",
    `My answer: ${req.answer.slice(0, 1_500)}`,
    "",
    "Rules:",
    '- verdict: "right" if an interviewer would be satisfied, "partly" if it is on track but thin or partly wrong, "wrong" otherwise.',
    "- feedback: at most 60 words. What landed, the one thing a stronger answer would add, and whether it was clear and concrete. No praise words.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"verdict": "right" | "partly" | "wrong", "feedback": "..."}',
  ]);
}

/* ------------------------------------------------------------------ *
 * A card's lesson, fitted to the learner's own code
 * ------------------------------------------------------------------ */

/**
 * The three parts of a card a learner reads first, rewritten around their
 * own lines. Each field may be "" when the model's version failed a check;
 * the panel then shows Miyagi's general text for that part.
 */
export interface Tailored {
  hook: string;
  lens: string;
  pitfall: string;
}

export function tailorPrompt(req: {
  title: string;
  what: string;
  hook: string;
  lens: string;
  pitfall: string;
  file: string;
  excerpt: string;
  depth: Depth;
}): Prompt {
  return prompt([
    `An AI assistant wrote this code in ${req.file} for my project. It uses the idea "${req.title}": ${req.what}`,
    fenced(req.excerpt),
    "",
    "Here is Miyagi's general lesson on the idea, written for any project:",
    `- hook: ${req.hook}`,
    `- lens: ${req.lens}`,
    `- pitfall: ${req.pitfall}`,
    "",
    "Rewrite those three parts about THIS code, so I learn the idea from what is in front of me. Keep what the general lesson teaches; change the examples to mine.",
    "",
    "Rules:",
    "- hook: one sentence, at most 25 words, saying what this code does with the idea.",
    "- lens: at most 70 words on how the idea works in these lines. Name the real functions, variables or values.",
    "- pitfall: at most 50 words on the concrete way it could go wrong HERE: the input or situation, and what the user would see. If the code already guards against the general pitfall, say what guards it and what still could go wrong.",
    "- Put every name from the code in backticks, exactly as written in it, like `fetchUser`. Do not invent names that are not in the lines shown.",
    "- When you point at a line, write \"line N\" using the numbers shown. Only use numbers that appear above.",
    "- Plain language, no praise, no headings, no markdown other than backticks.",
    `- ${DEPTH_NOTE[req.depth]}`,
    "",
    JSON_ONLY,
    '{"hook": "...", "lens": "...", "pitfall": "..."}',
  ]);
}

/** Line numbers shown in an excerpt (`12: code`). */
function excerptLines(excerpt: string): Set<number> {
  const out = new Set<number>();
  for (const m of excerpt.matchAll(/^(\d+): /gm)) out.add(Number(m[1]));
  return out;
}

/**
 * Whether a sentence only claims things the excerpt can back: every
 * backticked name appears in the code, and every "line N" was shown.
 * A model that names a function that is not there would teach a fiction
 * about the learner's own project, which is worse than a general lesson.
 */
export function groundedIn(text: string, excerpt: string): boolean {
  const code = excerpt.replace(/^\d+: /gm, "");
  for (const m of text.matchAll(/`([^`\n]{1,120})`/g)) {
    const name = m[1].trim().replace(/\(\)$/, "");
    if (name && !code.includes(name)) return false;
  }
  const shown = excerptLines(excerpt);
  for (const m of text.matchAll(/\blines? (\d+)(?:\s*(?:-|–|to|and)\s*(\d+))?/gi)) {
    if (!shown.has(Number(m[1]))) return false;
    if (m[2] && !shown.has(Number(m[2]))) return false;
  }
  return true;
}

/** Null when no part survives; a part that is ungrounded is "" and falls back. */
export function parseTailored(text: string, excerpt: string): Tailored | null {
  const o = obj(extractJson(text));
  const keep = (v: unknown, max: number) => {
    const s = str(v, max * 2);
    if (!s || s.length > max) return "";
    return groundedIn(s, excerpt) ? s : "";
  };
  const out = { hook: keep(o.hook, 240), lens: keep(o.lens, 700), pitfall: keep(o.pitfall, 500) };
  return out.hook || out.lens || out.pitfall ? out : null;
}
