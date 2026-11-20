/**
 * The lesson: what an open card teaches.
 *
 * Every card, whether an idea found in a change or a tool the project
 * adopted, opens as the same eight sections (docs/TEACHING.md): the problem,
 * the concept, how it works, architecture, implementation, practical
 * considerations, application, knowledge check. The structure never changes;
 * the depth (Junior, Mid, Senior) changes what each section says.
 *
 * A lesson is written by the learner's AI from their own project, once per
 * card and depth, and kept. Without an AI, or while one is writing, a shorter
 * lesson is built from Miyagi's own text, in the same order.
 *
 * A model's reply is untrusted: `parseLesson` keeps what is well formed,
 * drops the rest, and fills any missing section from the built-in lesson, so
 * the card never shows a hole.
 *
 * No `vscode` import.
 */

import type { Prompt } from "./ai.js";
import { DEPTH_NOTE, JSON_ONLY, buildPrompt, changeBlock, extractJsonObject, type ChangedFile, type Depth } from "./prompts.js";
import { DEPTH_GOAL, LESSON_SECTIONS, LESSON_STANDARD, type SectionId } from "./standards.js";

export type Visual =
  | { type: "compare"; cols: Array<{ title: string; good: boolean; rows: string[]; diff: number; result: string }> }
  | { type: "flow"; steps: Array<{ label: string; note: string }> }
  | { type: "parts"; items: Array<{ name: string; role: string }> }
  | { type: "code"; lines: Array<{ code: string; why: string }> }
  | { type: "terms"; items: Array<{ term: string; meaning: string }> }
  | { type: "signal"; text: string; notes: Array<{ part: string; meaning: string }> };

export interface Predict {
  question: string;
  options: string[];
  answer: number;
  why: string;
}

export interface Task {
  goal: string;
  where: string;
  doneWhen: string;
  hint: string;
  experiments: string[];
}

export interface Section {
  /** The opening: something familiar, a short story, or the answer to the last section's question. */
  hook: string;
  /** Shown before the learner predicts. */
  show?: Visual;
  predict?: Predict;
  /** Shown once they have predicted (or at once, when there is nothing to predict). */
  explain: string;
  reveal?: Visual;
  oneLine: string;
  sayIt: string;
  bridge: string;
  task?: Task;
  remember?: string[];
}

export interface Resource {
  kind: "video" | "article" | "book" | "docs";
  title: string;
  by: string;
  url: string;
}

export interface Lesson {
  depth: Depth;
  sections: Record<SectionId, Section>;
  /** Related concepts worth a card of their own. */
  concepts: string[];
  deeper: Resource[];
  /** The model that wrote it, or "" for Miyagi's built-in lesson. */
  by: string;
}

/** What a lesson is about: an idea card or a tool, reduced to what both have. */
export interface Subject {
  kind: "idea" | "tool";
  name: string;
  what: string;
  hook: string;
  /** The built-in explanation at this depth. */
  know: string;
  pitfall: string;
  analogy?: string;
  flow?: string[];
  terms?: Array<{ term: string; meaning: string }>;
  risks?: string[];
  verify?: string;
  docs?: { label: string; url: string };
  file?: string;
  evidence?: string;
}

/** What the project is for, written once per repository and given to every lesson. */
export interface ProjectProfile {
  summary: string;
  users: string;
  parts: Array<{ name: string; role: string }>;
  terms: string[];
}

/* ------------------------------------------------------------------ *
 * Reading values out of a reply
 * ------------------------------------------------------------------ */

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown, max: number, each: number): string[] => list(v).map((x) => str(x, each)).filter(Boolean).slice(0, max);

function parseVisual(raw: unknown): Visual | undefined {
  const v = o(raw);
  switch (str(v.type, 20)) {
    case "compare": {
      const cols = list(v.cols)
        .map(o)
        .map((c) => {
          const rows = strs(c.rows, 4, 80);
          const diff = typeof c.diff === "number" && Number.isInteger(c.diff) && c.diff >= 0 && c.diff < rows.length ? c.diff : -1;
          return { title: str(c.title, 40), good: c.good === true, rows, diff, result: str(c.result, 40) };
        })
        .filter((c) => c.title && c.rows.length)
        .slice(0, 3);
      return cols.length >= 2 ? { type: "compare", cols } : undefined;
    }
    case "flow": {
      const steps = list(v.steps).map(o).map((s) => ({ label: str(s.label, 40), note: str(s.note, 60) })).filter((s) => s.label).slice(0, 5);
      return steps.length >= 2 ? { type: "flow", steps } : undefined;
    }
    case "parts": {
      const items = list(v.items).map(o).map((s) => ({ name: str(s.name, 40), role: str(s.role, 70) })).filter((s) => s.name).slice(0, 6);
      return items.length >= 2 ? { type: "parts", items } : undefined;
    }
    case "code": {
      const lines = list(v.lines).map(o).map((s) => ({ code: typeof s.code === "string" ? s.code.replace(/\s+$/, "").slice(0, 160) : "", why: str(s.why, 240) })).filter((s) => s.code.trim() && s.why).slice(0, 6);
      return lines.length ? { type: "code", lines } : undefined;
    }
    case "terms": {
      const items = list(v.items).map(o).map((s) => ({ term: str(s.term, 40), meaning: str(s.meaning, 160) })).filter((s) => s.term && s.meaning).slice(0, 4);
      return items.length >= 2 ? { type: "terms", items } : undefined;
    }
    case "signal": {
      const text = typeof v.text === "string" ? v.text.trim().slice(0, 300) : "";
      const notes = list(v.notes).map(o).map((s) => ({ part: str(s.part, 60), meaning: str(s.meaning, 160) })).filter((s) => s.part && s.meaning && text.includes(s.part)).slice(0, 3);
      return text ? { type: "signal", text, notes } : undefined;
    }
  }
  return undefined;
}

function parsePredict(raw: unknown): Predict | undefined {
  const p = o(raw);
  const question = str(p.question, 300);
  const options = strs(p.options, 4, 120);
  const answer = typeof p.answer === "number" ? p.answer : Number.NaN;
  // A prediction with one option, or an answer that is not one of them, is not a question.
  if (!question || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return undefined;
  if (new Set(options.map((x) => x.toLowerCase())).size !== options.length) return undefined;
  return { question, options, answer, why: str(p.why, 200) };
}

function parseSection(raw: unknown): Section | null {
  const s = o(raw);
  const hook = str(s.hook, 700);
  const explain = str(s.explain, 900);
  const t = o(s.task);
  const task: Task | undefined =
    str(t.goal, 300) && str(t.doneWhen, 300)
      ? { goal: str(t.goal, 300), where: str(t.where, 200), doneWhen: str(t.doneWhen, 300), hint: str(t.hint, 300), experiments: strs(t.experiments, 3, 200) }
      : undefined;
  const remember = strs(s.remember, 4, 200);
  if (!hook && !explain && !task && !remember.length) return null;
  return {
    hook,
    ...(parseVisual(s.show) ? { show: parseVisual(s.show) } : {}),
    ...(parsePredict(s.predict) ? { predict: parsePredict(s.predict) } : {}),
    explain,
    ...(parseVisual(s.reveal) ? { reveal: parseVisual(s.reveal) } : {}),
    oneLine: str(s.oneLine, 300),
    sayIt: str(s.sayIt, 240),
    bridge: str(s.bridge, 240),
    ...(task ? { task } : {}),
    ...(remember.length ? { remember } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Further reading
 * ------------------------------------------------------------------ */

const search = (kind: Resource["kind"], query: string): string =>
  kind === "video"
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    : `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

/**
 * A model names a resource; Miyagi never trusts it with the address. Each link
 * opens a search for that exact title and author, which always lands somewhere
 * real. Only the official documentation, whose address Miyagi already holds, is
 * linked directly.
 */
function resources(raw: unknown, subject: Subject, depth: Depth): Resource[] {
  const out: Resource[] = [];
  if (subject.docs && /^https:\/\//.test(subject.docs.url)) out.push({ kind: "docs", title: subject.docs.label, by: "Official documentation", url: subject.docs.url });
  for (const r of list(raw).map(o)) {
    const kind = (["video", "article", "book"] as const).find((k) => k === str(r.kind, 10));
    const title = str(r.title, 100);
    const by = str(r.by, 60);
    if (!kind || !title) continue;
    out.push({ kind, title, by, url: search(kind, `${title} ${by}`.trim()) });
  }
  if (out.length <= 1) {
    const level = depth === "Junior" ? "for beginners" : depth === "Mid" ? "in depth" : "architecture and trade-offs";
    out.push({ kind: "video", title: `Videos: ${subject.name} ${level}`, by: "YouTube search", url: search("video", `${subject.name} ${level}`) });
    out.push({ kind: "article", title: `Articles: ${subject.name} ${level}`, by: "Web search", url: search("article", `${subject.name} ${level} explained`) });
  }
  return out.slice(0, 6);
}

/* ------------------------------------------------------------------ *
 * The built-in lesson
 * ------------------------------------------------------------------ */

const empty = (): Section => ({ hook: "", explain: "", oneLine: "", sayIt: "", bridge: "" });

/**
 * A lesson from Miyagi's own text: the same eight sections, shorter, with no
 * project detail beyond where the idea was seen. It is what shows without an
 * AI, and what fills a section a model left out.
 */
export function builtInLesson(subject: Subject, depth: Depth): Lesson {
  const n = subject.name;
  const sections = Object.fromEntries(LESSON_SECTIONS.map((s) => [s.id, empty()])) as Record<SectionId, Section>;
  sections.problem = { ...empty(), hook: subject.hook, explain: subject.pitfall, bridge: "What is the idea that deals with this?" };
  sections.concept = {
    ...empty(),
    hook: subject.what,
    ...(subject.terms && subject.terms.length >= 2 ? { show: { type: "terms", items: subject.terms.slice(0, 4) } as Visual } : {}),
    explain: subject.analogy ?? "",
    oneLine: subject.what,
    bridge: "How does it actually work?",
  };
  sections.how = {
    ...empty(),
    hook: "",
    ...(subject.flow && subject.flow.length >= 2 ? { show: { type: "flow", steps: subject.flow.slice(0, 5).map((f, i) => ({ label: `Step ${i + 1}`, note: f.slice(0, 60) })) } as Visual } : {}),
    explain: subject.flow?.length ? subject.flow.map((f, i) => `${i + 1}. ${f}`).join("\n") : subject.know,
    bridge: "Where is it in your project?",
  };
  sections.architecture = {
    ...empty(),
    hook: subject.file ? `In your project it was seen in \`${subject.file}\`.` : `It has not been seen in a file of your project yet.`,
    explain: subject.kind === "tool" ? subject.know : "",
  };
  sections.implementation = {
    ...empty(),
    hook: subject.evidence ? "The line it was seen in:" : "",
    ...(subject.evidence ? { show: { type: "code", lines: [{ code: subject.evidence, why: subject.what }] } as Visual } : {}),
    explain: subject.kind === "idea" ? subject.know : "",
  };
  sections.practical = {
    ...empty(),
    hook: "How it goes wrong:",
    explain: (subject.risks?.length ? subject.risks.map((r) => `- ${r}`).join("\n") : subject.pitfall) + (subject.verify ? `\n\nTo check it works: ${subject.verify}` : ""),
  };
  sections.application = {
    ...empty(),
    hook: "",
    task: {
      goal: `find where ${n} is used in your project and make one small, safe change to it.`,
      where: subject.file ? `\`${subject.file}\`` : "the file that uses it",
      doneWhen: "the app still runs, and you can say what your change did.",
      hint: "Change one value, run it, and compare with before.",
      experiments: [],
    },
  };
  sections.check = {
    ...empty(),
    sayIt: `Without looking back: what is ${n} for, and what goes wrong without it?`,
    remember: [subject.what, firstSentence(subject.pitfall)].filter(Boolean),
  };
  return { depth, sections, concepts: (subject.terms ?? []).map((t) => t.term).slice(0, 6), deeper: resources([], subject, depth), by: "" };
}

function firstSentence(text: string): string {
  const m = /^(.{10,240}?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1] : text.trim().slice(0, 240);
}

/* ------------------------------------------------------------------ *
 * Asking for a lesson
 * ------------------------------------------------------------------ */

const SECTION_BRIEF: Record<SectionId, string> = {
  problem:
    "the problem. hook: one everyday analogy (2 sentences), then 2 sentences of a small story in MY app where the problem happens. predict: what happens next. reveal: usually a \"signal\" (the error or symptom I would see, with its parts explained) or a \"compare\" (works vs fails, one difference). explain: why it happened. Do not name the subject here.",
  concept:
    "the concept, as the answer to that problem. hook: one sentence saying what it is, using the same analogy. show: \"compare\" (without it vs with it) or \"terms\" (its 2-4 basic parts, each in one plain line). predict: a question that checks I can tell the parts apart.",
  how: "how it works. show: a \"flow\" of 3-5 steps. predict: what happens in a specific case. explain: why, in terms of the mechanism.",
  architecture:
    "where it fits in MY project. predict: a question about my own project's shape. reveal: \"parts\" naming my project's real parts and the role of each. explain: how they connect.",
  implementation:
    "how it is used in my files. predict: what one real line probably does. reveal: \"code\" with 3-5 lines copied EXACTLY from the code shown below, each with why it is there. If no code is shown below, use lines typical for my stack and say so in explain.",
  practical:
    "what to watch for. hook: how to tell it is working (a command or a check). predict: a realistic mistake in my project and what happens. explain: the consequence, told as what a user sees. oneLine: the habit that prevents it.",
  application:
    "my turn. Only \"task\": goal (one small change I make by hand, sized to my depth), where (the file), doneWhen (how I will know), hint (does not give the answer), experiments (3 \"what happens if…\" things to try). No code in the task.",
  check:
    "knowledge check. sayIt: ask me to explain it to someone in my own words. predict: one scenario question. remember: 3-4 short lines to keep.",
};

const SHAPE = [
  '{"sections": {',
  '  "problem": {"hook": "...", "show": VISUAL?, "predict": {"question": "...", "options": ["...", "...", "..."], "answer": 0, "why": "..."}, "reveal": VISUAL?, "explain": "...", "oneLine": "...", "sayIt": "...", "bridge": "..."},',
  '  "concept": {…same fields…}, "how": {…}, "architecture": {…}, "implementation": {…}, "practical": {…},',
  '  "application": {"task": {"goal": "...", "where": "...", "doneWhen": "...", "hint": "...", "experiments": ["...", "...", "..."]}},',
  '  "check": {"sayIt": "...", "predict": {…}, "remember": ["...", "...", "..."]}',
  '}, "concepts": ["...", "..."], "deeper": [{"kind": "video" | "article" | "book", "title": "...", "by": "..."}]}',
  "VISUAL is one of:",
  '  {"type": "compare", "cols": [{"title": "...", "good": true, "rows": ["...", "..."], "diff": 1, "result": "..."}, {…}]}   (diff = index of the one row that differs)',
  '  {"type": "flow", "steps": [{"label": "...", "note": "..."}]}',
  '  {"type": "parts", "items": [{"name": "...", "role": "..."}]}',
  '  {"type": "code", "lines": [{"code": "...", "why": "..."}]}',
  '  {"type": "terms", "items": [{"term": "...", "meaning": "..."}]}',
  '  {"type": "signal", "text": "the error or output", "notes": [{"part": "exact substring of text", "meaning": "..."}]}',
].join("\n");

export function lessonPrompt(req: { subject: Subject; depth: Depth; profile: ProjectProfile | null; files: readonly ChangedFile[] }): Prompt {
  const { subject, depth, profile } = req;
  const d = DEPTH_GOAL[depth];
  return buildPrompt([
    `Write me a lesson on ${subject.kind === "tool" ? "the tool" : "the idea"} "${subject.name}": ${subject.what}`,
    "",
    profile
      ? `My project: ${profile.summary}${profile.users ? ` Used by: ${profile.users}.` : ""}${profile.parts.length ? ` Its parts: ${profile.parts.map((p) => `${p.name} (${p.role})`).join("; ")}.` : ""}${profile.terms.length ? ` Its own words: ${profile.terms.join(", ")}.` : ""}`
      : "I could not describe my project to you. Use only what the code below shows, and keep stories general rather than inventing a product.",
    "",
    req.files.length ? "Where it appears in my code:\n" + changeBlock(req.files) : "No code of mine is available for this.",
    "",
    LESSON_STANDARD,
    "",
    `My depth is ${depth}: I need to ${d.goal}. Focus on ${d.focus}. Afterwards I should be able to ${d.outcome}. ${d.style}`,
    DEPTH_NOTE[depth],
    "",
    "The eight sections, in order:",
    ...LESSON_SECTIONS.map((s, i) => `${i + 1}. ${s.id}: ${SECTION_BRIEF[s.id]}`),
    "",
    "Limits: hook at most 70 words; explain at most 70 words; oneLine one sentence; bridge one question; each predict has exactly 3 options of similar length, with the right one not always first; why at most 15 words.",
    "concepts: 3-4 related concepts at my depth, each worth its own lesson (names only, 1-3 words).",
    "deeper: up to 4 well-known resources at my depth that really exist (a short video, a longer one, an article, a book). Title and author only; do not write addresses.",
    "",
    JSON_ONLY,
    SHAPE,
  ]);
}

/**
 * Reads a lesson out of a reply. Sections that are missing or malformed come
 * from the built-in lesson, so the card is always whole. Null when fewer than
 * five sections were usable: at that point it is not this model's lesson.
 */
export function parseLesson(text: string, subject: Subject, depth: Depth, by: string): Lesson | null {
  const root = extractJsonObject(text);
  const raw = o(root.sections);
  const base = builtInLesson(subject, depth);
  let good = 0;
  const sections = { ...base.sections };
  for (const s of LESSON_SECTIONS) {
    const parsed = parseSection(raw[s.id]);
    if (!parsed) continue;
    // The application section is a task, the check a recall prompt; without them, keep the built-in.
    if (s.id === "application" && !parsed.task) continue;
    if (s.id === "check" && !parsed.sayIt && !parsed.predict) continue;
    sections[s.id] = parsed;
    good++;
  }
  if (good < 5) return null;
  const concepts = strs(root.concepts, 5, 40).filter((c) => c.toLowerCase() !== subject.name.toLowerCase());
  return { depth, sections, concepts: concepts.length ? concepts : base.concepts, deeper: resources(root.deeper, subject, depth), by };
}

/* ------------------------------------------------------------------ *
 * What the project is for
 * ------------------------------------------------------------------ */

export function profilePrompt(ctx: { name: string; tree: readonly string[]; heads: ReadonlyArray<{ file: string; head: string }> }): Prompt {
  const heads: string[] = [];
  let size = 0;
  for (const h of ctx.heads) {
    const part = `File: ${h.file}\n\`\`\`\n${h.head}\n\`\`\``;
    if (size + part.length > 9_000) break;
    heads.push(part);
    size += part.length;
  }
  return buildPrompt([
    `This is my project "${ctx.name}". Describe what it is for, so lessons can use it for examples.`,
    "",
    "Files:",
    ctx.tree.slice(0, 160).join("\n"),
    "",
    heads.join("\n\n"),
    "",
    "Rules:",
    "- summary: at most 35 words, in plain words: what the app does and the main thing a user does with it. Only what the files show; if unclear, say what is most likely and start with \"Probably\".",
    "- users: who uses it, at most 8 words.",
    "- parts: its 2-6 running parts (for example website, API, database, queue), each with its role in at most 8 words.",
    "- terms: up to 6 words from the project's own domain (for example order, invoice).",
    "",
    JSON_ONLY,
    '{"summary": "...", "users": "...", "parts": [{"name": "...", "role": "..."}], "terms": ["..."]}',
  ]);
}

export function parseProfile(text: string): ProjectProfile | null {
  const r = extractJsonObject(text);
  const summary = str(r.summary, 300);
  if (!summary) return null;
  return {
    summary,
    users: str(r.users, 80),
    parts: list(r.parts).map(o).map((p) => ({ name: str(p.name, 40), role: str(p.role, 80) })).filter((p) => p.name).slice(0, 6),
    terms: strs(r.terms, 6, 30),
  };
}
