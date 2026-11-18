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
