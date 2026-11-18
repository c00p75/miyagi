/**
 * The lessons in the notes export.
 *
 * The quiet modes show two lines at the time and promise the rest later (see
 * `ARCHIVE_IS_ALWAYS_FULL` in `modes.ts`). The export is that later. It used to
 * list each command with a status line, which kept the promise for the log and
 * broke it for the explanation.
 *
 * The history log is not the place to fix that. It deliberately holds no file
 * contents and no output, and a full card per event would turn a small log
 * into a large one that repeats itself. Nothing needs storing anyway: the
 * lesson for `grep` is the same whenever it was practised, so the log only has
 * to say *which* commands and ideas came up, and the lessons are looked up
 * from the packs when the export is written, at the depth the learner is at
 * now.
 *
 * One rule carries over from the cards: no invented lessons. A command the
 * content pack has no entry for is listed by name and nothing more. The
 * generic shell lens under twenty different headings would look like twenty
 * lessons and be one, about none of them.
 *
 * Pure functions over history entries, so the sections can be tested without
 * a server.
 */

import type { HistoryEntry } from "./history.js";
import { binOf, contentFor, docsFor, lensFor, type SkillLevel } from "./content.js";
import { conceptById, isConceptBin } from "./concepts.js";

/** Each distinct value once, in the order first met, so the notes read in the order things were learned. */
function distinct(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

/** "What each command does": one lesson per distinct binary practised. */
export function commandLessons(entries: readonly HistoryEntry[], level: SkillLevel): string[] {
  const bins = distinct(
    entries
      .filter((e) => e.kind === "command")
      .map((e) => e.bin || binOf(e.label))
      .filter(Boolean),
  );
  const lines = ["## What each command does", ""];
  if (!bins.length) {
    lines.push("_No commands recorded in this scope._", "");
    return lines;
  }

  const unknown: string[] = [];
  for (const bin of bins) {
    const { content } = contentFor(bin);
    if (!content) {
      unknown.push(bin);
      continue;
    }
    const lens = lensFor(bin, level);
    lines.push(`### \`${bin}\`: ${content.summary}`, "", `**What it is.** ${lens.what}`, "", `**How to use it.** ${lens.how}`, "", `**Trade-offs.** ${lens.tradeoffs}`, "");
    // The pack's own pitfalls only. `pitfallsFor` pads with advice about the
    // shell in general, which is right on one card and noise when repeated
    // under every heading of a review sheet.
    if (content.pitfalls.length) {
      lines.push("**How it bites.**", "", ...content.pitfalls.map((p) => `- ${p}`), "");
    }
    const docs = docsFor(bin).slice(0, 2);
    lines.push(`Read more: ${docs.map((d) => `[${d.label}](${d.url})`).join(" · ")}`, "");
  }

  if (unknown.length) {
    lines.push(
      `Also practised, with no lesson in the pack: ${unknown.map((b) => `\`${b}\``).join(", ")}.`,
      "",
    );
  }
  return lines;
}

/** "Ideas met in your code": one entry per distinct concept the history mentions. */
export function conceptLessons(entries: readonly HistoryEntry[], level: SkillLevel): string[] {
  // Keyed by bin, keeping the first label seen: the label is all there is to
  // show for an idea whose pack has since been removed.
  const met = new Map<string, string>();
  for (const e of entries) {
    if (e.kind !== "concept" || !e.bin || !isConceptBin(e.bin)) continue;
    if (!met.has(e.bin)) met.set(e.bin, e.label);
  }

  const lines = ["## Ideas met in your code", ""];
  if (!met.size) {
    lines.push("_No ideas recorded in this scope. They are added when a change is explained or debriefed._", "");
    return lines;
  }

  const unknown: string[] = [];
  for (const [bin, label] of met) {
    const concept = conceptById(bin.slice("concept:".length));
    if (!concept) {
      unknown.push(label);
      continue;
    }
    lines.push(
      `### ${concept.emoji} ${concept.title}`,
      "",
      concept.what,
      "",
      concept.lens[level],
      "",
      `**How it bites.** ${concept.pitfall}`,
      "",
      `Read more: [${concept.docs.label}](${concept.docs.url})`,
      "",
    );
  }

  if (unknown.length) {
    lines.push(`Also met, from an idea pack that is no longer loaded: ${unknown.join(", ")}.`, "");
  }
  return lines;
}

/** Both lesson sections, ready to splice into the export. */
export function lessonSections(entries: readonly HistoryEntry[], level: SkillLevel): string[] {
  return [...commandLessons(entries, level), ...conceptLessons(entries, level)];
}
