/**
 * Durable practice history.
 *
 * The session log used to live in an array, which meant a note export after a
 * restart described a level 12 player who had practised nothing. History is
 * append-only JSONL next to the profile: one line per event, so a crash costs
 * at most the line being written, and a corrupt line costs only itself rather
 * than the whole file.
 *
 * Writes are serialised through a promise chain. `fs.appendFile` on a single
 * file from a single process is effectively atomic for lines this small, but
 * two concurrent appends can still interleave their own await points, and an
 * interleaved JSONL line is a permanently unreadable record.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { profileDir } from "./profile.js";
import { dayKey } from "./days.js";

export type HistoryKind = "command" | "concept" | "quiz" | "config" | "review" | "checkpoint";

export interface HistoryEntry {
  at: string;
  day: string;
  kind: HistoryKind;
  label: string;
  detail: string;
  xpAwarded: number;
  /** Binary the event was about, when there was one. Drives mastery reporting. */
  bin?: string;
  correct?: boolean;
}

export function historyPath(): string {
  return path.join(profileDir(), "history.jsonl");
}

/**
 * Lines are trimmed by rewriting the file once it grows past the cap. Checked
 * on a counter rather than by stat-ing on every append, so the common path
 * stays one write.
 */
const MAX_LINES = 5_000;
const TRIM_TO = 4_000;
const APPENDS_BETWEEN_TRIM_CHECKS = 200;

let appendsSinceCheck = APPENDS_BETWEEN_TRIM_CHECKS; // force a check on first write
let chain: Promise<void> = Promise.resolve();

/** Serialise onto the write chain, swallowing failures so history never breaks a lesson. */
function enqueue(work: () => Promise<void>): Promise<void> {
  chain = chain.then(work).catch(() => {});
  return chain;
}

export function appendHistory(entry: Omit<HistoryEntry, "at" | "day">): HistoryEntry {
  const full: HistoryEntry = { at: new Date().toISOString(), day: dayKey(), ...entry };
  void enqueue(async () => {
    const file = historyPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify(full) + "\n", "utf8");
    if (++appendsSinceCheck >= APPENDS_BETWEEN_TRIM_CHECKS) {
      appendsSinceCheck = 0;
      await trim(file);
    }
  });
  return full;
}

/** Drops the oldest lines once the log outgrows the cap. Best effort. */
async function trim(file: string): Promise<void> {
  try {
    const text = await fs.readFile(file, "utf8");
    const lines = text.split("\n").filter(Boolean);
    if (lines.length <= MAX_LINES) return;
    const kept = lines.slice(lines.length - TRIM_TO).join("\n") + "\n";
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, kept, "utf8");
    await fs.rename(tmp, file);
  } catch {
    // A log we cannot trim is still a log we can append to.
  }
}

/** Flush pending appends. Used by tests and by note export, which reads what it wrote. */
export function flushHistory(): Promise<void> {
  return chain;
}

/**
 * Reads the log back. A line that will not parse is skipped rather than
 * failing the read: one bad line from a half-written append should not hide
 * six months of practice.
 */
export async function readHistory(options: { since?: string; limit?: number } = {}): Promise<
  HistoryEntry[]
> {
  await flushHistory();
  let text: string;
  try {
    text = await fs.readFile(historyPath(), "utf8");
  } catch {
    return [];
  }
  const out: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as HistoryEntry;
      if (!o || typeof o.at !== "string" || typeof o.kind !== "string") continue;
      if (options.since && o.at < options.since) continue;
      out.push({ ...o, day: typeof o.day === "string" ? o.day : o.at.slice(0, 10) });
    } catch {
      continue;
    }
  }
  return options.limit ? out.slice(-options.limit) : out;
}

export interface HistoryStats {
  total: number;
  commands: number;
  concepts: number;
  quizzes: number;
  quizzesCorrect: number;
  reviews: number;
  checkpoints: number;
  checkpointsPassed: number;
  xp: number;
  days: number;
  firstAt: string | null;
  lastAt: string | null;
}

export function summarise(entries: readonly HistoryEntry[]): HistoryStats {
  const days = new Set<string>();
  let commands = 0;
  let concepts = 0;
  let quizzes = 0;
  let quizzesCorrect = 0;
  let reviews = 0;
  let checkpoints = 0;
  let checkpointsPassed = 0;
  let xp = 0;
  for (const e of entries) {
    days.add(e.day);
    xp += e.xpAwarded || 0;
    if (e.kind === "command") commands++;
    else if (e.kind === "concept") concepts++;
    else if (e.kind === "review") {
      // Session-start lines have no verdict. Graded reviews are quiz attempts
      // that happened later, and they count toward accuracy.
      if (typeof e.correct === "boolean") {
        quizzes++;
        if (e.correct) quizzesCorrect++;
      } else {
        reviews++;
      }
    } else if (e.kind === "checkpoint") {
      checkpoints++;
      if (e.correct) checkpointsPassed++;
    } else if (e.kind === "quiz") {
      quizzes++;
      if (e.correct) quizzesCorrect++;
    }
  }
  return {
    total: entries.length,
    commands,
    concepts,
    quizzes,
    quizzesCorrect,
    reviews,
    checkpoints,
    checkpointsPassed,
    xp,
    days: days.size,
    firstAt: entries.length ? entries[0].at : null,
    lastAt: entries.length ? entries[entries.length - 1].at : null,
  };
}
