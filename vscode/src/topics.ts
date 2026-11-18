/**
 * Topics: the shelf an idea sits on.
 *
 * The concept pack is a flat list ordered by how much each idea matters. That
 * is the right order for choosing what to teach and the wrong one for someone
 * who has decided "this week I want to understand security". A topic is only
 * a filter over the same ideas: it changes what the panel shows and which
 * questions a review draws from, never what is recorded.
 *
 * Kept here rather than in the pack because it is a presentation choice. A
 * test fails if a concept is added without being given a topic.
 */

export const TOPICS = ["Security", "Backend and APIs", "Data", "Frontend", "Tooling"] as const;
export type Topic = (typeof TOPICS)[number];

const BY_CONCEPT: Record<string, Topic> = {
  "hardcoded-secret": "Security",
  "sql-interpolation": "Security",
  "password-hashing": "Security",
  "auth-token": "Security",
  "input-validation": "Security",
  cors: "Security",

  "api-route": "Backend and APIs",
  "http-fetch": "Backend and APIs",
  "client-server-boundary": "Backend and APIs",
  "env-vars": "Backend and APIs",
  "error-handling": "Backend and APIs",
  "async-await": "Backend and APIs",

  "db-schema": "Data",
  "orm-query": "Data",
  "browser-storage": "Data",

  "react-effect": "Frontend",
  "react-state": "Frontend",
  "css-layout": "Frontend",

  "dependency-added": "Tooling",
  tests: "Tooling",
  gitignore: "Tooling",
  "type-escape": "Tooling",
  "container-image": "Tooling",

  "xss-html-injection": "Security",
  "rate-limiting": "Backend and APIs",
  "db-transaction": "Data",
  caching: "Backend and APIs",
  pagination: "Backend and APIs",
  "file-upload": "Backend and APIs",
  webhook: "Backend and APIs",
  "react-props": "Frontend",
  "background-job": "Backend and APIs",
};

/**
 * Topics for ideas that arrive at runtime: from a pack file, or found by a
 * model. They are not in the table above because nobody could have written
 * them there.
 */
const ASSIGNED = new Map<string, Topic>();

export function assignTopic(conceptId: string, topic: Topic): void {
  ASSIGNED.set(conceptId, topic);
}

/** An idea nobody has shelved yet still has to appear somewhere. */
export const FALLBACK_TOPIC: Topic = "Tooling";

export function hasTopic(conceptId: string): boolean {
  return conceptId in BY_CONCEPT || ASSIGNED.has(conceptId);
}

export function topicOf(conceptId: string): Topic {
  return BY_CONCEPT[conceptId] ?? ASSIGNED.get(conceptId) ?? FALLBACK_TOPIC;
}

export function parseTopic(raw: unknown): Topic | null {
  return TOPICS.find((t) => t === raw) ?? null;
}

/* ------------------------------------------------------------------ *
 * What builds on what
 * ------------------------------------------------------------------ */

/**
 * The idea each idea leans on most directly. One level only, and only where
 * the dependency is real: explaining an effect to someone who has not met
 * state is explaining the second half of a sentence. It is used to order the
 * cards of one lesson and to offer a link back, never to hide anything.
 */
const BUILDS_ON: Record<string, string> = {
  "react-state": "react-props",
  "react-effect": "react-state",
  "orm-query": "db-schema",
  "db-transaction": "orm-query",
  "http-fetch": "async-await",
  "input-validation": "api-route",
  cors: "api-route",
  "rate-limiting": "api-route",
  pagination: "api-route",
  "file-upload": "api-route",
  webhook: "api-route",
};

export function prerequisiteOf(conceptId: string): string | null {
  return BUILDS_ON[conceptId] ?? null;
}

/** Puts an idea after the idea it builds on, when both are present. Stable otherwise. */
export function orderByPrerequisite<T extends { id: string }>(items: readonly T[]): T[] {
  const out = [...items];
  // A handful of items and a one-level relation: a few passes settle it.
  for (let pass = 0; pass < out.length; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      const needs = prerequisiteOf(out[i].id);
      const at = needs ? out.findIndex((o) => o.id === needs) : -1;
      if (at > i) {
        const [prerequisite] = out.splice(at, 1);
        out.splice(i, 0, prerequisite);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
