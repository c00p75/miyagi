/**
 * Ideas a model found.
 *
 * The built-in pack recognises a fixed list of ideas by pattern. Most of what
 * an assistant writes matches none of them, so the panel stays silent on
 * exactly the changes a learner understands least. With the learner's
 * permission, their own AI is asked what in a change is worth a lesson.
 *
 * What comes back is registered through the same `registerConcepts` door as a
 * hand-written pack file, so it is validated by the same rules and from then
 * on behaves like any other idea: it has a card, a belt, a place in the dojo
 * and a question on the review schedule. It is saved to
 * `~/.miyagi/ai-ideas.json`, because a question that is due next week has to
 * still exist next week.
 *
 * A found idea has no detection pattern. It was recognised by reading, and a
 * regular expression guessed from one example would fire on the wrong code.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isBuiltInConcept, registerConcepts, CONCEPTS, type ConceptDefinition } from "../../src/concepts.js";
import { profileDir } from "../../src/profile.js";
import { assignTopic, parseTopic, type Topic } from "./topics.js";
import type { FoundIdea } from "./prompts.js";

const MAX_SAVED = 150;
const ORIGIN = "ai";

interface Saved {
  definition: ConceptDefinition;
  topic: Topic;
  foundAt: string;
}

export function aiIdeasPath(): string {
  return path.join(profileDir(), "ai-ideas.json");
}

let saved: Saved[] = [];

export function slug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s.length >= 2 ? `ai-${s}` : "";
}

function toDefinition(idea: FoundIdea, id: string): ConceptDefinition {
  return {
    id,
    title: idea.title,
    emoji: "✨",
    weight: 45,
    patterns: [],
    hook: idea.hook,
    what: idea.what,
    lens: idea.know,
    pitfall: idea.pitfall,
    questions: idea.question
      ? [
          {
            question: idea.question.question,
            answer: idea.question.answer,
            distractors: idea.question.distractors,
            explanation: idea.question.explanation,
          },
        ]
      : [],
  };
}

async function write(): Promise<void> {
  try {
    const file = aiIdeasPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, ideas: saved }, null, 2), "utf8");
    await fs.rename(tmp, file);
  } catch {
    // Unsaved ideas still work for this sitting; their questions just will not survive a restart.
  }
}

/** Registers what was saved in earlier sittings. Returns how many are live. */
export async function loadAiIdeas(): Promise<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(aiIdeasPath(), "utf8"));
  } catch {
    saved = [];
    return 0;
  }
  const list = Array.isArray((raw as { ideas?: unknown })?.ideas) ? ((raw as { ideas: unknown[] }).ideas as Saved[]) : [];
  const usable = list.filter((s) => s && typeof s === "object" && s.definition && typeof s.definition.id === "string");
  const result = registerConcepts(usable.map((s) => s.definition), ORIGIN);
  const live = new Set(result.added);
  saved = usable.filter((s) => live.has(s.definition.id)).slice(-MAX_SAVED);
  for (const s of saved) assignTopic(s.definition.id, parseTopic(s.topic) ?? "Tooling");
  return saved.length;
}

export interface Registered {
  id: string;
  idea: FoundIdea;
  /** False when this idea was already known and nothing new was registered. */
  fresh: boolean;
}

/**
 * Registers ideas a model just named. One that matches an idea already known
 * by title (built-in, from a pack, or found before) is mapped to that idea
 * rather than duplicated: "debouncing" found twice is one lesson, not two.
 */
export async function registerFound(ideas: readonly FoundIdea[]): Promise<Registered[]> {
  const out: Registered[] = [];
  let changed = false;
  for (const idea of ideas) {
    const existing = CONCEPTS.find((c) => c.title.toLowerCase() === idea.title.toLowerCase());
    if (existing) {
      out.push({ id: existing.id, idea, fresh: false });
      continue;
    }
    const id = slug(idea.title);
    if (!id || isBuiltInConcept(id)) continue;
    const definition = toDefinition(idea, id);
    const result = registerConcepts([definition], ORIGIN);
    if (!result.added.includes(id)) {
      // Most often the question failed the quality bar. The lesson is still worth having.
      const withoutQuestion = { ...definition, questions: [] };
      if (!registerConcepts([withoutQuestion], ORIGIN).added.includes(id)) continue;
      definition.questions = [];
    }
    assignTopic(id, idea.topic);
    saved = [...saved.filter((s) => s.definition.id !== id), { definition, topic: idea.topic, foundAt: new Date().toISOString() }].slice(
      -MAX_SAVED,
    );
    changed = true;
    out.push({ id, idea, fresh: true });
  }
  if (changed) await write();
  return out;
}

export function aiIdeaCount(): number {
  return saved.length;
}

/* ------------------------------------------------------------------ *
 * Questions the learner wrote
 *
 * Writing a question is itself a way of learning the answer, and a card in
 * someone's own words about their own project is one no pack can supply. Each
 * is registered as a small idea of its own, tied to the idea it came from, and
 * saved to `~/.miyagi/own-cards.json`.
 * ------------------------------------------------------------------ */

interface OwnSaved {
  definition: ConceptDefinition;
  topic: Topic;
  from: string;
  writtenAt: string;
}

let own: OwnSaved[] = [];

export function ownCardsPath(): string {
  return path.join(profileDir(), "own-cards.json");
}

async function writeOwn(): Promise<void> {
  try {
    const file = ownCardsPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, cards: own }, null, 2), "utf8");
    await fs.rename(tmp, file);
  } catch {
    // The card still works until the editor restarts.
  }
}

export async function loadOwnCards(): Promise<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(ownCardsPath(), "utf8"));
  } catch {
    own = [];
    return 0;
  }
  const list = Array.isArray((raw as { cards?: unknown })?.cards) ? ((raw as { cards: OwnSaved[] }).cards as OwnSaved[]) : [];
  const usable = list.filter((c) => c && typeof c === "object" && c.definition && typeof c.definition.id === "string");
  const live = new Set(registerConcepts(usable.map((c) => c.definition), "own").added);
  own = usable.filter((c) => live.has(c.definition.id)).slice(-300);
  for (const c of own) assignTopic(c.definition.id, parseTopic(c.topic) ?? "Tooling");
  return own.length;
}

export interface OwnQuestionInput {
  question: string;
  answer: string;
  wrong: string[];
  why: string;
}

/**
 * Registers a learner's question. Returns the new idea's id, or the reason it
 * was refused in words the learner can act on.
 */
export async function registerOwnQuestion(
  from: { conceptId: string; title: string; topic: Topic },
  input: OwnQuestionInput,
): Promise<{ id: string } | { problem: string }> {
  const question = input.question.trim();
  const answer = input.answer.trim();
  const wrong = input.wrong.map((w) => w.trim()).filter(Boolean);
  if (question.length < 8) return { problem: "Write the question out in full." };
  if (!answer) return { problem: "Give the correct answer." };
  if (wrong.length < 2) return { problem: "Give at least two wrong answers. Good ones are what you might have believed before." };

  const id = `own-${Date.now().toString(36)}`;
  const definition: ConceptDefinition = {
    id,
    title: `Your question: ${from.title}`.slice(0, 80),
    emoji: "✍️",
    weight: 50,
    patterns: [],
    hook: question.slice(0, 200),
    what: `A question you wrote yourself about ${from.title}.`.slice(0, 400),
    lens: (input.why.trim() || `The answer is: ${answer}`).slice(0, 700),
    pitfall: `Wrong answers you thought were worth listing: ${wrong.join("; ")}`.slice(0, 500),
    questions: [{ question, answer, distractors: wrong.slice(0, 4), explanation: input.why.trim() || answer }],
  };
  const result = registerConcepts([definition], "own");
  if (!result.added.includes(id)) {
    const reason = result.rejected[0]?.reason ?? "it could not be saved";
    // The mechanical checks are written for pack authors; say the common ones plainly.
    if (/longest|longer/i.test(reason)) {
      return { problem: "The correct answer is much longer than the wrong ones, which gives it away. Shorten it or lengthen the others." };
    }
    if (/duplicate|same|equal/i.test(reason)) return { problem: "Two of the answers are the same." };
    return { problem: `That question was not accepted: ${reason}.` };
  }
  assignTopic(id, from.topic);
  own = [...own, { definition, topic: from.topic, from: from.conceptId, writtenAt: new Date().toISOString() }].slice(-300);
  await writeOwn();
  return { id };
}
