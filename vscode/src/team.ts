/**
 * Team mode without a server.
 *
 * A team wants to know two things: which ideas the team as a whole is thin
 * on, and who to ask about each. Answering that needs every member's belts in
 * one place, and Miyagi has no place: no account, no backend, nothing leaves
 * the machine.
 *
 * So the place is the team's own repository. Each member exports a small
 * summary file into a shared folder and commits it like any other file; the
 * report is computed by reading the folder. Sharing is an explicit act, the
 * file is plain JSON a person can read before committing it, and it holds
 * ideas and belts only: no code, no file names, no answers, no history.
 *
 * The codebase tour is the other half, for someone new: every idea this
 * repository relies on, where it lives, in the order worth learning them.
 *
 * No `vscode` import, so all of it can be tested from the command line.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { CONCEPTS, conceptById, detectConcepts } from "../../src/concepts.js";
import { orderByPrerequisite, topicOf } from "./topics.js";
import type { DojoRowView, StatusView } from "./engine.js";

export interface TeamSummary {
  version: 1;
  name: string;
  at: string;
  level: number;
  /** Days practised this week, and the weekly goal. */
  week: { days: number; goal: number } | null;
  /** The last unaided check, as correct out of asked. */
  unaided: { asked: number; correct: number; at: string } | null;
  ideas: Array<{ id: string; title: string; box: number; lapses: number }>;
}

export function fileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "member"}.json`;
}

/** What one member shares. Only ideas they have met, and how firmly. */
export function buildSummary(input: {
  name: string;
  status: StatusView;
  dojo: readonly DojoRowView[];
  week: { days: number; goal: number } | null;
  now?: Date;
}): TeamSummary {
  return {
    version: 1,
    name: input.name.trim().slice(0, 60) || "Someone",
    at: (input.now ?? new Date()).toISOString(),
    level: input.status.level,
    week: input.week ? { days: input.week.days, goal: input.week.goal } : null,
    unaided: input.status.independence
      ? { asked: input.status.independence.asked, correct: input.status.independence.correct, at: input.status.independence.at }
      : null,
    ideas: input.dojo.filter((r) => r.seen).map((r) => ({ id: r.id, title: r.title, box: r.box, lapses: r.lapses })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** A summary file is something a teammate wrote and committed. Validate it like any other input. */
export function parseSummary(raw: unknown): TeamSummary | null {
  if (!isObj(raw) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.at !== "string") return null;
  if (!Number.isFinite(Date.parse(raw.at)) || !Array.isArray(raw.ideas)) return null;
  const ideas: TeamSummary["ideas"] = [];
  for (const item of raw.ideas.slice(0, 500)) {
    if (!isObj(item) || typeof item.id !== "string" || typeof item.title !== "string") continue;
    const box = whole(item.box, 0, 5);
    if (box === null) continue;
    ideas.push({ id: item.id.slice(0, 80), title: item.title.slice(0, 100), box, lapses: whole(item.lapses, 0, 9_999) ?? 0 });
  }
  const week = isObj(raw.week) && whole(raw.week.days, 0, 7) !== null && whole(raw.week.goal, 1, 7) !== null
    ? { days: raw.week.days as number, goal: raw.week.goal as number }
    : null;
  const u = raw.unaided;
  const unaided =
    isObj(u) && whole(u.asked, 1, 1_000) !== null && whole(u.correct, 0, u.asked as number) !== null && typeof u.at === "string"
      ? { asked: u.asked as number, correct: u.correct as number, at: u.at }
      : null;
  return { version: 1, name: raw.name.trim().slice(0, 60), at: raw.at, level: whole(raw.level, 1, 100_000) ?? 1, week, unaided, ideas };
}

export async function readSummaries(folder: string): Promise<{ summaries: TeamSummary[]; skipped: string[] }> {
  const summaries: TeamSummary[] = [];
  const skipped: string[] = [];
  let names: string[];
  try {
    names = (await fs.readdir(folder)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { summaries, skipped };
  }
  for (const name of names.slice(0, 200)) {
    try {
      const stat = await fs.stat(path.join(folder, name));
      if (stat.size > 200_000) throw new Error("too large");
      const parsed = parseSummary(JSON.parse(await fs.readFile(path.join(folder, name), "utf8")));
      if (parsed) summaries.push(parsed);
      else skipped.push(name);
    } catch {
      skipped.push(name);
    }
  }
  return { summaries, skipped };
}

const BELT = ["White", "Yellow", "Orange", "Green", "Brown", "Black"];
/** Green and above: answered correctly after a week's gap. Firm enough to ask. */
const FIRM = 3;

/** A report that is stale by this many days says so beside the name. */
const STALE_DAYS = 21;

export function teamReport(summaries: readonly TeamSummary[], skipped: readonly string[] = [], now: Date = new Date()): string {
  if (!summaries.length) {
    return [
      "# Miyagi: team report",
      "",
      "No summaries were found in the team folder.",
      "",
      "Each person runs **Miyagi: Share My Progress with My Team**, which writes one small file here, and commits it. The file holds ideas and belts only: no code, no file names, no answers.",
      "",
    ].join("\n");
  }
  const people = [...summaries].sort((a, b) => a.name.localeCompare(b.name));
  const days = (iso: string) => Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);

  // Per idea: who holds it, and how firmly.
  const ideas = new Map<string, { title: string; holders: Array<{ name: string; box: number; lapses: number }> }>();
  for (const p of people) {
    for (const idea of p.ideas) {
      const row = ideas.get(idea.id) ?? { title: conceptById(idea.id)?.title ?? idea.title, holders: [] };
      row.holders.push({ name: p.name, box: idea.box, lapses: idea.lapses });
      ideas.set(idea.id, row);
    }
  }
  const rows = [...ideas.entries()].map(([id, r]) => ({
    id,
    title: r.title,
    met: r.holders.length,
    firm: r.holders.filter((h) => h.box >= FIRM).sort((a, b) => b.box - a.box),
    lapses: r.holders.reduce((n, h) => n + h.lapses, 0),
    weight: conceptById(id)?.weight ?? 50,
  }));

  // Thin: several people have met it and nobody holds it firmly, or it keeps being missed.
  const thin = rows
    .filter((r) => r.firm.length === 0 || r.lapses >= r.met * 2)
    .sort((a, b) => b.weight - a.weight || b.lapses - a.lapses)
    .slice(0, 10);
  const askable = rows.filter((r) => r.firm.length > 0).sort((a, b) => b.weight - a.weight).slice(0, 20);
  // Built-in ideas that matter and that nobody on the team has met at all.
  const unmet = CONCEPTS.filter((c) => c.weight >= 75 && !ideas.has(c.id))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  const lines = [
    "# Miyagi: team report",
    "",
    `_${people.length} ${people.length === 1 ? "person" : "people"}, from the summaries they chose to share. Belts measure recall of ideas, not seniority or output: use this to decide what to teach and who to ask, not to rank anyone._`,
    "",
    "## Who has shared",
    "",
    "| Name | Shared | Ideas met | Held firmly | This week | Without help |",
    "| --- | --- | --- | --- | --- | --- |",
    ...people.map((p) => {
      const age = days(p.at);
      const shared = age <= 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago${age > STALE_DAYS ? " (stale)" : ""}`;
      return `| ${p.name} | ${shared} | ${p.ideas.length} | ${p.ideas.filter((i) => i.box >= FIRM).length} | ${p.week ? `${p.week.days} of ${p.week.goal} days` : "-"} | ${p.unaided ? `${p.unaided.correct} of ${p.unaided.asked}` : "-"} |`;
    }),
    "",
    "## Where the team is thin",
    "",
    thin.length
      ? "Ideas in your code that nobody holds firmly yet, or that keep being missed. Most consequential first.\n\n" +
        thin
          .map((r) => `- **${r.title}**: met by ${r.met}, held firmly by ${r.firm.length}${r.lapses ? `, missed ${r.lapses} time${r.lapses === 1 ? "" : "s"} in review` : ""}`)
          .join("\n")
      : "_Every idea the team has met is held firmly by at least one person._",
    "",
    "## Who to ask",
    "",
    askable.length
      ? askable.map((r) => `- **${r.title}**: ${r.firm.slice(0, 3).map((h) => `${h.name} (${BELT[h.box]})`).join(", ")}`).join("\n")
      : "_Nobody has reached green belt in anything yet. That takes answering an idea's question correctly after 1, 3 and 7 days._",
    "",
    "## Not met by anyone",
    "",
    unmet.length
      ? "Ideas that tend to matter and have not come up in anyone's work. Either the codebase does not use them, or nobody has been taught them.\n\n" +
        unmet.map((c) => `- ${c.emoji} ${c.title}`).join("\n")
      : "_Every high-consequence idea in the built-in list has been met by someone._",
    "",
    skipped.length ? `_Could not read: ${skipped.join(", ")}._\n` : "",
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * The codebase tour
 * ------------------------------------------------------------------ */

export interface TourStop {
  id: string;
  title: string;
  emoji: string;
  topic: string;
  what: string;
  pitfall: string;
  /** Files that use it, most uses first. */
  files: Array<{ file: string; count: number }>;
  total: number;
}

const MAX_TOUR_FILES = 600;
const MAX_TOUR_FILE_BYTES = 200_000;

/** Every idea a set of files relies on, in the order worth learning them. */
export async function tourStops(root: string, files: readonly string[]): Promise<{ stops: TourStop[]; read: number }> {
  const found = new Map<string, Map<string, number>>();
  let read = 0;
  for (const file of files.slice(0, MAX_TOUR_FILES)) {
    let text: string;
    try {
      const abs = path.join(root, file);
      if ((await fs.stat(abs)).size > MAX_TOUR_FILE_BYTES) continue;
      text = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    read++;
    for (const hit of detectConcepts(file, text)) {
      const byFile = found.get(hit.id) ?? new Map<string, number>();
      byFile.set(file, hit.count);
      found.set(hit.id, byFile);
    }
  }
  const stops: TourStop[] = [];
  for (const [id, byFile] of found) {
    const c = conceptById(id);
    if (!c) continue;
    const ranked = [...byFile.entries()].map(([file, count]) => ({ file, count })).sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
    stops.push({ id, title: c.title, emoji: c.emoji, topic: topicOf(id), what: c.what, pitfall: c.pitfall, files: ranked, total: ranked.length });
  }
  // Most consequential first, then each idea after the one it builds on.
  stops.sort((a, b) => (conceptById(b.id)?.weight ?? 0) - (conceptById(a.id)?.weight ?? 0) || b.total - a.total);
  return { stops: orderByPrerequisite(stops), read };
}

export function renderTour(name: string, tour: { stops: readonly TourStop[]; read: number }, totalFiles: number): string {
  const lines = [
    `# The ideas ${name} relies on`,
    "",
    `_Found by reading ${tour.read} of ${totalFiles} tracked files for the ideas Miyagi knows. It is a reading list for someone new to this code, in the order worth taking them: what can hurt first, and each idea after the one it builds on. No model was involved, and patterns miss things._`,
    "",
  ];
  if (!tour.stops.length) {
    lines.push("None of the ideas Miyagi knows were found in this repository.", "");
    return lines.join("\n");
  }
  tour.stops.forEach((stop, i) => {
    lines.push(
      `## ${i + 1}. ${stop.emoji} ${stop.title}`,
      "",
      `_${stop.topic} · used in ${stop.total} file${stop.total === 1 ? "" : "s"}_`,
      "",
      stop.what,
      "",
      `**How it goes wrong.** ${stop.pitfall}`,
      "",
      "**Start reading here:**",
      "",
      ...stop.files.slice(0, 4).map((f) => `- \`${f.file}\`${f.count > 1 ? ` (${f.count} places)` : ""}`),
      "",
    );
  });
  lines.push("---", "_Open the Miyagi panel's Dojo tab to read any of these as a full lesson and answer its question._", "");
  return lines.join("\n");
}
