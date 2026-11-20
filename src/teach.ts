/**
 * Turning what was seen into something worth reading.
 *
 * A diff can touch a dozen ideas. Teaching all twelve is how a tutor becomes
 * wallpaper, so this module's real job is choosing: what is new to this
 * person, what they keep getting wrong, what would hurt most to misunderstand
 * — and then saying it in a few lines someone will read between prompts.
 *
 * Pure functions over plain data. The server supplies what the learner already
 * knows; nothing here touches saved state, which is what makes it testable.
 */

import {
  BELTS,
  CONCEPTS,
  beltForBox,
  conceptById,
  questionsForConcept,
  type CodeConcept,
  type ConceptHit,
  type ConceptLevel,
} from "./concepts.js";
import type { QuizQuestion } from "./quiz.js";
import type { Observation } from "./observe.js";

/** One concept, as it showed up across a set of changes. */
export interface Sighting {
  id: string;
  /** The first file it appeared in. */
  file: string;
  /** How many files it appeared in. */
  files: number;
  count: number;
  evidence: string;
}

export function mergeSightings(
  changes: ReadonlyArray<{ file: string; concepts: readonly ConceptHit[] }>,
): Sighting[] {
  const merged = new Map<string, Sighting & { seenFiles: Set<string> }>();
  for (const change of changes) {
    for (const hit of change.concepts) {
      const existing = merged.get(hit.id);
      if (existing) {
        existing.count += hit.count;
        existing.seenFiles.add(change.file);
        existing.files = existing.seenFiles.size;
      } else {
        merged.set(hit.id, {
          id: hit.id,
          file: change.file,
          files: 1,
          count: hit.count,
          evidence: hit.evidence,
          seenFiles: new Set([change.file]),
        });
      }
    }
  }
  return [...merged.values()].map(({ seenFiles: _seen, ...s }) => s);
}

/** What the review queue says about one concept. */
export interface Familiarity {
  /** Has this concept ever been taught to this learner? */
  seen: boolean;
  /** Best review box across its questions, 0-5. */
  box: number;
  lapses: number;
}

export const UNSEEN: Familiarity = { seen: false, box: 0, lapses: 0 };

/** A concept held this firmly is not re-taught; it is acknowledged. */
export const SOLID_BOX = 3;

export interface Ranked {
  /** Worth a card now, most valuable first. */
  teach: Sighting[];
  /** Also present, but there is a limit to what anyone reads at once. */
  later: Sighting[];
  /** Present and already known. Named, not explained. */
  solid: Sighting[];
}

function score(concept: CodeConcept, f: Familiarity): number {
  // New beats known, shaky beats steady, and dangerous beats cosmetic.
  return concept.weight + (f.seen ? 0 : 40) + f.lapses * 10 - f.box * 15;
}

export function rankSightings(
  sightings: readonly Sighting[],
  familiarity: (id: string) => Familiarity,
  limit: number,
): Ranked {
  const known = sightings.filter((s) => conceptById(s.id));
  const solid = known.filter((s) => familiarity(s.id).box >= SOLID_BOX);
  const open = known
    .filter((s) => familiarity(s.id).box < SOLID_BOX)
    .sort(
      (a, b) =>
        score(conceptById(b.id)!, familiarity(b.id)) - score(conceptById(a.id)!, familiarity(a.id)),
    );
  return { teach: open.slice(0, limit), later: open.slice(limit), solid };
}

/**
 * The question for a concept: one at the learner's depth that was not asked
 * recently, falling back to any of the concept's own. Never a question about
 * something else — a recall check on a different idea teaches the wrong link.
 */
export function pickConceptQuestion(
  id: string,
  level: ConceptLevel,
  recentIds: readonly string[],
): QuizQuestion | null {
  const order: Record<ConceptLevel, number> = { Junior: 0, Mid: 1, Senior: 2 };
  const all = questionsForConcept(id);
  if (!all.length) return null;
  const recent = new Set(recentIds);
  const atLevel = all.filter((q) => order[q.level] <= order[level]);
  const fresh = (pool: QuizQuestion[]) => pool.filter((q) => !recent.has(q.id));
  // Highest eligible level first: a Senior should get the Senior question.
  const best = (pool: QuizQuestion[]) => [...pool].sort((a, b) => order[b.level] - order[a.level])[0];
  return best(fresh(atLevel)) ?? best(fresh(all)) ?? best(atLevel) ?? all[0];
}

function statusTag(f: Familiarity): string {
  if (!f.seen) return "🆕 new technique";
  const belt = beltForBox(f.box);
  return f.lapses ? `${belt.emoji} ${belt.name} belt · slipped ${f.lapses}×` : `${belt.emoji} ${belt.name} belt`;
}

export function renderConceptCard(s: Sighting, level: ConceptLevel, f: Familiarity, index: number): string {
  const c = conceptById(s.id);
  if (!c) return "";
  const where =
    s.files > 1 ? `\`${s.file}\` and ${s.files - 1} other file${s.files === 2 ? "" : "s"}` : `\`${s.file}\``;
  return [
    `### ${index}. ${c.emoji} ${c.title} · ${statusTag(f)}`,
    `_${c.hook}_`,
    "",
    `📍 ${where}${s.evidence ? ` — \`${s.evidence.replace(/`/g, "'")}\`` : ""}`,
    "",
    `**What it is.** ${c.what}`,
    "",
    `**Know this.** ${c.lens[level]}`,
    "",
    `**💥 How it bites.** ${c.pitfall}`,
    "",
    `**🎤 Ask your AI:** “${c.askTheAi}”`,
    "",
    `[${c.docs.label}](${c.docs.url})`,
  ].join("\n");
}

/** What the host model is asked to do with the card. The card is data; this is the lesson plan. */
export function tutorBrief(teach: readonly Sighting[], hasQuiz: boolean): string {
  if (!teach.length) return "";
  return [
    "> **Tutor brief (for the assistant).** Do not read this card out. For each idea above, point at the",
    "> exact lines in *their* change and say in two or three plain sentences what they do and why it was",
    "> written that way. Use their project, not a textbook example. One idea at a time.",
    hasQuiz
      ? "> Then ask the question below, wait, and pass their answer to `verify_quiz_answer`. Their own words count."
      : "> Recall is queued for later; do not quiz now.",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * The dojo: what has been collected, and how firmly it is held
 * ------------------------------------------------------------------ */

export interface DojoRow {
  id: string;
  title: string;
  emoji: string;
  familiarity: Familiarity;
}

export function dojoRows(familiarity: (id: string) => Familiarity): DojoRow[] {
  return CONCEPTS.map((c) => ({ id: c.id, title: c.title, emoji: c.emoji, familiarity: familiarity(c.id) }));
}

export function dojoSummary(rows: readonly DojoRow[]): string {
  const seen = rows.filter((r) => r.familiarity.seen);
  const black = seen.filter((r) => r.familiarity.box >= BELTS.length - 1).length;
  return (
    `**${seen.length}/${rows.length}** techniques discovered` +
    (black ? ` · **${black}** at black belt` : "") +
    (seen.length === rows.length ? " · the full set 🏆" : "")
  );
}

export function renderDojo(rows: readonly DojoRow[]): string {
  const seen = rows
    .filter((r) => r.familiarity.seen)
    .sort((a, b) => b.familiarity.box - a.familiarity.box || a.title.localeCompare(b.title));
  const locked = rows.length - seen.length;
  const lines = ["## 🥋 The Dojo", dojoSummary(rows), ""];
  if (seen.length) {
    lines.push(
      "| Technique | Belt | |",
      "| --- | --- | --- |",
      ...seen.map((r) => {
        const belt = beltForBox(r.familiarity.box);
        const bar = BELTS.map((_, i) => (i <= r.familiarity.box ? "●" : "○")).join("");
        return `| ${r.emoji} ${r.title} | ${belt.emoji} ${belt.name} | ${bar} |`;
      }),
      "",
    );
  }
  if (locked) {
    lines.push(
      `🔒 **${locked}** still undiscovered. They unlock when your assistant writes code that uses them — you cannot grind these, you have to build something.`,
    );
  }
  lines.push(
    "",
    "_A belt goes up one colour each time you answer its question correctly after a longer gap, and drops when you miss. It measures what you can recall, not how long the tool was open._",
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Observations, summarised
 * ------------------------------------------------------------------ */

export interface ObservedSummary {
  commands: Array<{ command: string; count: number }>;
  commandTotal: number;
  files: string[];
  linesAdded: number;
  changes: Array<{ file: string; concepts: ConceptHit[] }>;
  newest: string | null;
}

export function summariseObservations(observations: readonly Observation[]): ObservedSummary {
  const commands = new Map<string, number>();
  const files = new Set<string>();
  const changes: ObservedSummary["changes"] = [];
  let linesAdded = 0;
  let commandTotal = 0;
  let newest: string | null = null;
  for (const o of observations) {
    if (!newest || o.at > newest) newest = o.at;
    if (o.kind === "command") {
      commandTotal++;
      commands.set(o.command, (commands.get(o.command) ?? 0) + 1);
    } else if (o.kind === "edit") {
      files.add(o.file);
      linesAdded += o.added;
      changes.push({ file: o.file, concepts: o.concepts });
    }
  }
  return {
    commands: [...commands.entries()]
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count),
    commandTotal,
    files: [...files],
    linesAdded,
    changes,
    newest,
  };
}
