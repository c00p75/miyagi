/**
 * How firmly one idea is held, read from the review queue.
 *
 * An idea has several questions and each is scheduled on its own, so "the
 * belt" is the best box any of them has reached, and the lapses are summed.
 * The server, the editor panel and the terminal all need this and must agree,
 * so it has one home.
 */

import { questionsForConcept } from "./concepts.js";
import { findReviewItem } from "./state.js";
import { UNSEEN, type Familiarity } from "./teach.js";

export function conceptFamiliarity(id: string): Familiarity {
  const items = questionsForConcept(id)
    .map((q) => findReviewItem("quiz", q.id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  if (!items.length) return UNSEEN;
  return {
    seen: true,
    box: Math.max(...items.map((i) => i.box)),
    lapses: items.reduce((n, i) => n + i.lapses, 0),
  };
}
