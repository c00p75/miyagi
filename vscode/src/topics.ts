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
};

/** An idea nobody has shelved yet still has to appear somewhere. */
export const FALLBACK_TOPIC: Topic = "Tooling";

export function hasTopic(conceptId: string): boolean {
  return conceptId in BY_CONCEPT;
}

export function topicOf(conceptId: string): Topic {
  return BY_CONCEPT[conceptId] ?? FALLBACK_TOPIC;
}

export function parseTopic(raw: unknown): Topic | null {
  return TOPICS.find((t) => t === raw) ?? null;
}
