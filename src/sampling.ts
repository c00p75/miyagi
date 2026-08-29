/**
 * Model assistance, via MCP sampling.
 *
 * Two jobs the host model is genuinely better at than any code in this
 * repository: judging whether a prose answer means the right thing, and
 * inventing a topical question for a command the bank has never heard of.
 *
 * Both are strictly optional and strictly additive:
 *
 *   - Grading only ever *upgrades* a wrong verdict to right. A learner who
 *     explains `--force-with-lease` correctly in their own words should not be
 *     marked wrong by a string comparison; but a model must never be able to
 *     take away a correct answer, because that is the worse failure and it
 *     would be invisible to the learner.
 *   - Generated questions are validated as hard as a hand-written one and
 *     cached to disk, so the bank grows towards whatever this user actually
 *     practises instead of asking the model twice for the same thing.
 *
 * A client without sampling, a timeout, a refusal, or anything unparseable all
 * mean "fall back to the deterministic path". None of them are errors.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { profileDir } from "./profile.js";
import { QUIZ_BANK, registerGenerated, type QuizQuestion } from "./quiz.js";

const log = (...a: unknown[]) => console.error("[miyagi]", ...a);

/** Sampling sits on the critical path of a learner's turn, so it gets a short leash. */
const GRADE_TIMEOUT_MS = 20_000;
const GENERATE_TIMEOUT_MS = 30_000;

let server: McpServer | null = null;

export function attachSampling(s: McpServer): void {
  server = s;
}

export function samplingAvailable(): boolean {
  return Boolean(server?.server.getClientCapabilities()?.sampling);
}

/** Pull the text out of a sampling result, whatever content shape came back. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string } })?.content;
  return content?.type === "text" && typeof content.text === "string" ? content.text : "";
}

/**
 * Finds the first JSON object in a model reply. Models wrap JSON in prose and
 * code fences more often than not, and refusing to read that is refusing the
 * feature.
 */
export function firstJsonObject(text: string): unknown | null {
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
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Grading prose answers
 * ------------------------------------------------------------------ */

export interface ModelVerdict {
  correct: boolean;
  reason: string;
}

/**
 * Asks the host model whether a free-text answer means the same thing as the
 * expected one. Returns null whenever the answer cannot be trusted, which the
 * caller treats as "keep the deterministic verdict".
 */
export async function gradeProse(args: {
  question: string;
  expected: string;
  explanation: string;
  given: string;
}): Promise<ModelVerdict | null> {
  if (!server || !samplingAvailable()) return null;
  // Nothing to judge: a letter or a one-word answer is exactly what string
  // comparison is already good at, and asking costs a round trip for no gain.
  if (args.given.trim().length < 8) return null;

  const prompt = [
    "You are grading one answer in a command-line tutoring session. Be strict about meaning and generous about wording.",
    "",
    `QUESTION: ${args.question}`,
    `EXPECTED ANSWER: ${args.expected}`,
    `WHY IT IS RIGHT: ${args.explanation}`,
    `LEARNER'S ANSWER: ${args.given}`,
    "",
    "Does the learner's answer demonstrate the same understanding as the expected answer?",
    "Different wording that means the same thing is correct. A vague answer that could equally describe a wrong option is not.",
    "An answer that names the right thing for the wrong reason is not correct.",
    "",
    'Reply with JSON only: {"correct": true|false, "reason": "<one short sentence addressed to the learner>"}',
  ].join("\n");

  try {
    const reply = await server.server.createMessage(
      {
        messages: [{ role: "user", content: { type: "text", text: prompt } }],
        maxTokens: 300,
        temperature: 0,
        systemPrompt: "You grade tutoring answers. You reply with a single JSON object and nothing else.",
        // Cheap and fast matters more than clever for a yes/no equivalence call.
        modelPreferences: { intelligencePriority: 0.3, speedPriority: 0.8, costPriority: 0.6 },
      },
      { timeout: GRADE_TIMEOUT_MS },
    );

    const parsed = firstJsonObject(textOf(reply)) as { correct?: unknown; reason?: unknown } | null;
    if (!parsed || typeof parsed.correct !== "boolean") return null;
    return {
      correct: parsed.correct,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim().slice(0, 400)
          : "Judged equivalent to the expected answer.",
    };
  } catch (err) {
    log("sampling grade failed (non-fatal):", (err as Error).message);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Generating questions
 * ------------------------------------------------------------------ */

export function generatedCachePath(): string {
  return path.join(profileDir(), "generated-quizzes.json");
}

/** Cap the cache so a long-lived install cannot grow it without limit. */
const MAX_CACHED = 300;

const cached = new Map<string, QuizQuestion>();

/** Control characters have no business in a card, an id, or a filename. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * Validates a model-authored question as hard as a hand-written one.
 *
 * This is the security boundary as much as the quality one: the text ends up in
 * a card, and the id ends up in the review queue and on disk.
 */
export function validateGenerated(raw: unknown, bin: string): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const clean = (v: unknown, max: number): string =>
    typeof v === "string" ? v.replace(CONTROL_CHARS, " ").trim().slice(0, max) : "";

  const question = clean(o.question, 300);
  const answer = clean(o.answer, 200);
  const explanation = clean(o.explanation, 500);
  const choices = Array.isArray(o.choices)
    ? Array.from(new Set(o.choices.map((c) => clean(c, 200)).filter(Boolean)))
    : [];

  if (question.length < 15 || answer.length < 1 || explanation.length < 20) return null;
  if (choices.length < 3 || choices.length > 6) return null;
  if (!choices.includes(answer)) return null;
  // A question that gives itself away, or that instructs rather than asks, is
  // not a question. Both are common failure modes of a generated one.
  if (/answer is|correct answer/i.test(question)) return null;

  const level = o.level === "Senior" || o.level === "Mid" ? o.level : "Junior";
  // Dots are excluded deliberately: the id is not a path, but `..` in an
  // identifier that gets written to disk is a shape worth never allowing.
  const safeBin = bin.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "shell";

  return {
    // The prefix keeps generated ids from ever colliding with the bank's, which
    // matters because ids key the review schedule.
    id: `gen:${safeBin}:${hash(question)}`,
    bins: [safeBin],
    level,
    question,
    choices,
    answer,
    explanation,
  };
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Loads the cache and registers it with the bank. Missing or corrupt: start empty. */
export async function loadGeneratedCache(): Promise<number> {
  try {
    const text = await fs.readFile(generatedCachePath(), "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return 0;
    const questions: QuizQuestion[] = [];
    for (const entry of parsed.slice(0, MAX_CACHED)) {
      const bin = typeof entry?.bins?.[0] === "string" ? entry.bins[0] : "shell";
      // Re-validating on load matters: the file is hand-editable, and once
      // registered a cached question is indistinguishable from a written one.
      const valid = validateGenerated(entry, bin);
      if (valid) {
        cached.set(valid.id, valid);
        questions.push(valid);
      }
    }
    registerGenerated(questions);
    return questions.length;
  } catch {
    return 0;
  }
}

async function saveGeneratedCache(): Promise<void> {
  const target = generatedCachePath();
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const all = [...cached.values()].slice(-MAX_CACHED);
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
    await fs.rename(tmp, target);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
    // A cache we cannot write is still a cache; the question works this session.
  }
}

/**
 * Asks the model for a question about a command the bank does not cover, then
 * validates, registers and caches it. Null means "use the generic bank".
 */
export async function generateQuestion(args: {
  bin: string;
  command: string;
  level: "Junior" | "Mid" | "Senior";
  topic: string;
  avoid: readonly string[];
}): Promise<QuizQuestion | null> {
  if (!server || !samplingAvailable()) return null;

  const existing = [...cached.values()].filter((q) => q.bins.includes(args.bin.toLowerCase()));
  if (existing.length >= 6) return null; // enough cached for this command already

  const prompt = [
    `Write one multiple-choice question that tests understanding of \`${args.bin}\`, as used in: \`${args.command}\`.`,
    `Audience: a ${args.level} engineer working on "${args.topic}".`,
    "",
    "Requirements:",
    "- Test a real operational consequence, trade-off or failure mode. Not trivia, not flag memorisation.",
    "- Exactly four choices. Distractors must be plausible to someone who half-knows the answer.",
    "- The question must not reveal or hint at which choice is correct.",
    "- The explanation must say *why*, in one or two sentences, so it teaches even when the learner got it right.",
    args.avoid.length ? `- Do not repeat these questions: ${args.avoid.slice(0, 8).join(" | ")}` : "",
    "",
    'Reply with JSON only: {"question": "...", "choices": ["...","...","...","..."], "answer": "<exactly one of the choices>", "explanation": "...", "level": "Junior|Mid|Senior"}',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const reply = await server.server.createMessage(
      {
        messages: [{ role: "user", content: { type: "text", text: prompt } }],
        maxTokens: 700,
        temperature: 0.7,
        systemPrompt:
          "You write precise technical quiz questions for a command-line tutor. You reply with a single JSON object and nothing else.",
        modelPreferences: { intelligencePriority: 0.7, speedPriority: 0.4, costPriority: 0.4 },
      },
      { timeout: GENERATE_TIMEOUT_MS },
    );

    const question = validateGenerated(firstJsonObject(textOf(reply)), args.bin);
    if (!question) return null;
    const already = cached.get(question.id);
    if (already) return already;

    cached.set(question.id, question);
    registerGenerated([question]);
    void saveGeneratedCache();
    return question;
  } catch (err) {
    log("sampling generate failed (non-fatal):", (err as Error).message);
    return null;
  }
}

/** True when the bank already has something topical, so generation is unnecessary. */
export function bankCovers(bin: string): boolean {
  return QUIZ_BANK.some((q) => q.bins.includes(bin.toLowerCase()));
}

export function cachedCount(): number {
  return cached.size;
}

/** Test seam: drop the in-memory cache. */
export function clearCache(): void {
  cached.clear();
}
