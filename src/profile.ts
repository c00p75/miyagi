/**
 * Durable player progress.
 *
 * XP that vanishes when the editor restarts is not progress, it is a score in
 * an arcade cabinet nobody plugged in. So the profile lives on disk, and the
 * whole file is treated as untrusted input on the way back in: it is
 * hand-editable, it can be truncated by a crash mid-write, and a future version
 * of this server may have written it. Anything that fails to parse or validate
 * is discarded in favour of a fresh profile rather than surfaced as an error,
 * because losing a streak is a smaller harm than refusing to start.
 *
 * Version 2 adds the state that makes the gamification mean something: a
 * calendar-day practice streak, per-command mastery counts, and the spaced
 * repetition queue. A version 1 file is migrated rather than discarded, since
 * a learner's XP predates those fields and should survive the upgrade.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dayKey, daysBetween, isDayKey } from "./days.js";
import { resolveMode } from "./modes.js";

export const PROFILE_VERSION = 3;

/**
 * Versions this build knows how to read. Anything else is not trusted.
 * Old versions are migrated rather than discarded: losing a learner's XP on
 * upgrade would be a worse bug than any missing field.
 */
const READABLE_VERSIONS = new Set([1, 2, 3]);

/** Bounds exist so a hand-edited or hostile file cannot grow memory without limit. */
const MAX_MASTERY_KEYS = 300;
const MAX_REVIEW_ITEMS = 500;
const MAX_RECENT_QUIZZES = 40;
const MAX_VERIFIED_STEPS = 2_000;

export interface PersistedPlayer {
  xp: number;
  level: number;
  title: string;
  quizStreak: number;
  bestStreak: number;
  badges: string[];
}

export interface PersistedRoadmap {
  category: string;
  roadmap_name: string;
  current_topic: string;
  step_index: number;
  total_steps: number;
}

/** Consecutive-calendar-day practice, the habit hook a quiz streak cannot be. */
export interface PersistedStreak {
  lastActiveDay: string | null;
  dayStreak: number;
  bestDayStreak: number;
  totalDays: number;
}

/** Per-binary competence, the input to both honest reporting and review scheduling. */
export interface PersistedMastery {
  attempts: number;
  successes: number;
  quizAttempts: number;
  quizCorrect: number;
  lastAt: string | null;
}

/**
 * One spaced-repetition item. `box` is a Leitner box index into REVIEW_INTERVALS_DAYS;
 * a correct answer promotes, a miss demotes to the front rather than to zero so a
 * single slip does not erase weeks of spacing.
 */
export interface PersistedReviewItem {
  id: string;
  kind: "quiz" | "command";
  ref: string;
  label: string;
  box: number;
  dueAt: string;
  reps: number;
  lapses: number;
  lastAt: string | null;
}

/**
 * Steps whose checkpoint has actually passed, keyed `track#stepIndex`.
 *
 * This is the record that makes XP mean something: it is written only when a
 * read-only probe confirmed the intended outcome exists on disk, not when a
 * tool call returned successfully.
 */
export type PersistedVerified = Record<string, string>;

export interface PersistedProfile {
  version: number;
  updatedAt: string;
  player: PersistedPlayer;
  settings: { skillLevel: string; voiceEnabled: boolean; wordsPerMinute: number; mode: string };
  roadmap: PersistedRoadmap;
  streak: PersistedStreak;
  mastery: Record<string, PersistedMastery>;
  review: PersistedReviewItem[];
  recentQuizIds: string[];
  verified: PersistedVerified;
}

/** `MIYAGI_HOME` exists so tests and sandboxes never touch a real profile. */
export function profileDir(): string {
  return process.env.MIYAGI_HOME ?? path.join(os.homedir(), ".miyagi");
}

export function profilePath(): string {
  return path.join(profileDir(), "profile.json");
}

const int = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v: unknown, fallback: string, max = 80): string =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;

const iso = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const SKILL_LEVELS = new Set(["Junior", "Mid", "Senior"]);
const CATEGORIES = new Set([
  "Role Based",
  "Skill Based",
  "Absolute Beginners",
  "Best Practices",
]);

const TITLE_LADDER: Array<{ minLevel: number; title: string }> = [
  { minLevel: 1, title: "Terminal Novice" },
  { minLevel: 3, title: "Shell Apprentice" },
  { minLevel: 6, title: "CLI Artisan" },
  { minLevel: 10, title: "Terminal Wizard" },
];

export function levelForXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / 100) + 1;
}

export function titleForLevel(level: number): string {
  let title = TITLE_LADDER[0].title;
  for (const t of TITLE_LADDER) if (level >= t.minLevel) title = t.title;
  return title;
}

export function titleLadder(): ReadonlyArray<{ minLevel: number; title: string }> {
  return TITLE_LADDER;
}

export function emptyStreak(): PersistedStreak {
  return { lastActiveDay: null, dayStreak: 0, bestDayStreak: 0, totalDays: 0 };
}

export function emptyMastery(): PersistedMastery {
  return { attempts: 0, successes: 0, quizAttempts: 0, quizCorrect: 0, lastAt: null };
}

function normaliseStreak(raw: unknown): PersistedStreak {
  const o = (raw ?? {}) as Record<string, unknown>;
  const lastActiveDay = isDayKey(o.lastActiveDay) ? o.lastActiveDay : null;
  const dayStreak = lastActiveDay ? int(o.dayStreak, 1, 0, 100_000) : 0;
  return {
    lastActiveDay,
    dayStreak,
    bestDayStreak: Math.max(dayStreak, int(o.bestDayStreak, 0, 0, 100_000)),
    totalDays: Math.max(dayStreak ? 1 : 0, int(o.totalDays, 0, 0, 100_000)),
  };
}

function normaliseMastery(raw: unknown): Record<string, PersistedMastery> {
  const out: Record<string, PersistedMastery> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_MASTERY_KEYS) break;
    const k = str(key, "", 60);
    if (!k) continue;
    const v = (value ?? {}) as Record<string, unknown>;
    const attempts = int(v.attempts, 0, 0, 1_000_000);
    const quizAttempts = int(v.quizAttempts, 0, 0, 1_000_000);
    out[k] = {
      attempts,
      // Successes can never exceed attempts, whatever the file says.
      successes: Math.min(attempts, int(v.successes, 0, 0, 1_000_000)),
      quizAttempts,
      quizCorrect: Math.min(quizAttempts, int(v.quizCorrect, 0, 0, 1_000_000)),
      lastAt: iso(v.lastAt),
    };
  }
  return out;
}

function normaliseReview(raw: unknown): PersistedReviewItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PersistedReviewItem[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_REVIEW_ITEMS) break;
    const o = (entry ?? {}) as Record<string, unknown>;
    const id = str(o.id, "", 120);
    if (!id || seen.has(id)) continue;
    const kind = o.kind === "command" ? "command" : "quiz";
    const ref = str(o.ref, id, 200);
    seen.add(id);
    out.push({
      id,
      kind,
      ref,
      label: str(o.label, ref, 300),
      box: int(o.box, 0, 0, REVIEW_INTERVALS_DAYS.length - 1),
      // An unparseable due date means due now, which fails safe towards revision.
      dueAt: iso(o.dueAt) ?? new Date(0).toISOString(),
      reps: int(o.reps, 0, 0, 100_000),
      lapses: int(o.lapses, 0, 0, 100_000),
      lastAt: iso(o.lastAt),
    });
  }
  return out;
}

function normaliseVerified(raw: unknown): PersistedVerified {
  const out: PersistedVerified = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_VERIFIED_STEPS) break;
    const k = str(key, "", 200);
    const at = iso(value);
    // A completion without a usable date is not evidence of anything.
    if (k && at) out[k] = at;
  }
  return out;
}

function normaliseRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const s = str(v, "", 120);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_RECENT_QUIZZES) break;
  }
  return out;
}

/**
 * Coerces whatever was on disk into a usable profile. Every field is clamped
 * or replaced rather than rejected, except the version and the overall shape:
 * a file from a version this build does not know could mean anything, and a
 * non-object is not a profile at all.
 */
export function normaliseProfile(raw: unknown): PersistedProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== "number" || !READABLE_VERSIONS.has(o.version)) return null;

  const p = (o.player ?? {}) as Record<string, unknown>;
  const s = (o.settings ?? {}) as Record<string, unknown>;
  const r = (o.roadmap ?? {}) as Record<string, unknown>;

  const xp = int(p.xp, 0, 0, 100_000_000);
  // Level and title are derived, never believed: a file claiming level 99 at
  // 40 XP is a typo or a cheat, and either way the XP is the source of truth.
  const level = levelForXp(xp);

  const badges: string[] = Array.isArray(p.badges)
    ? Array.from(
        new Set(
          p.badges
            .map((b) => (typeof b === "string" ? b.trim().slice(0, 60) : ""))
            .filter(Boolean),
        ),
      ).slice(0, 100)
    : [];

  const total_steps = int(r.total_steps, 10, 1, 10_000);
  const quizStreak = int(p.quizStreak, 0, 0, 1_000_000);

  return {
    version: PROFILE_VERSION,
    updatedAt: iso(o.updatedAt) ?? new Date().toISOString(),
    player: {
      xp,
      level,
      title: titleForLevel(level),
      quizStreak,
      bestStreak: Math.max(quizStreak, int(p.bestStreak, 0, 0, 1_000_000)),
      badges,
    },
    settings: {
      skillLevel: SKILL_LEVELS.has(String(s.skillLevel)) ? String(s.skillLevel) : "Junior",
      voiceEnabled: bool(s.voiceEnabled, true),
      wordsPerMinute: int(s.wordsPerMinute, 180, 80, 400),
      mode: resolveMode(s.mode),
    },
    roadmap: {
      category: CATEGORIES.has(String(r.category))
        ? String(r.category)
        : "Absolute Beginners",
      roadmap_name: str(r.roadmap_name, "Command Line Basics", 120),
      current_topic: str(r.current_topic, "Navigating the filesystem", 200),
      total_steps,
      step_index: int(r.step_index, 1, 1, total_steps),
    },
    // The v2 fields. A v1 file has none of them, so every one of these
    // normalisers has to treat `undefined` as "start from empty".
    streak: normaliseStreak(o.streak),
    mastery: normaliseMastery(o.mastery),
    review: normaliseReview(o.review),
    recentQuizIds: normaliseRecent(o.recentQuizIds),
    verified: normaliseVerified(o.verified),
  };
}

export async function loadProfile(): Promise<PersistedProfile | null> {
  try {
    const text = await fs.readFile(profilePath(), "utf8");
    return normaliseProfile(JSON.parse(text));
  } catch {
    // Missing, unreadable, truncated or not JSON: all mean "start fresh".
    return null;
  }
}

/**
 * Atomic-ish write: a temp file in the same directory then a rename, so a
 * crash mid-write leaves the previous profile intact rather than a truncated
 * one. Returns false instead of throwing, because a session that cannot save
 * is still a session worth having.
 *
 * The write merges with whatever is on disk first. Two clients — Claude Desktop
 * and Cursor, say — each spawn their own stdio server against the same
 * `~/.miyagi/profile.json`, and a plain overwrite means the second one to save
 * silently discards the first one's XP, streak and review scheduling. Merging
 * makes concurrent sessions additive instead of last-writer-wins.
 */
export async function saveProfile(profile: PersistedProfile): Promise<boolean> {
  const target = profilePath();
  const tmp = `${target}.${process.pid}.${Math.floor(process.uptime() * 1000)}.tmp`;
  try {
    const onDisk = await loadProfile();
    const merged = onDisk ? mergeProfiles(onDisk, profile) : profile;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(merged, null, 2), "utf8");
    await fs.rename(tmp, target);
    return true;
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
    return false;
  }
}

/**
 * Combines a profile found on disk with this session's.
 *
 * The rules are chosen so a concurrent session can never *lose* progress:
 * counters take the maximum, sets union, and the review schedule keeps whichever
 * copy has seen more repetitions. Settings and roadmap position are the one
 * exception — this process knows what its own learner just chose, and averaging
 * two people's cursor positions would be meaningless.
 */
export function mergeProfiles(
  disk: PersistedProfile,
  mine: PersistedProfile,
): PersistedProfile {
  const xp = Math.max(disk.player.xp, mine.player.xp);
  const level = levelForXp(xp);

  const mastery: Record<string, PersistedMastery> = { ...disk.mastery };
  for (const [bin, m] of Object.entries(mine.mastery)) {
    const other = mastery[bin];
    mastery[bin] = other
      ? {
          attempts: Math.max(other.attempts, m.attempts),
          successes: Math.min(
            Math.max(other.attempts, m.attempts),
            Math.max(other.successes, m.successes),
          ),
          quizAttempts: Math.max(other.quizAttempts, m.quizAttempts),
          quizCorrect: Math.min(
            Math.max(other.quizAttempts, m.quizAttempts),
            Math.max(other.quizCorrect, m.quizCorrect),
          ),
          lastAt: [other.lastAt, m.lastAt].filter(Boolean).sort().pop() ?? null,
        }
      : m;
  }

  const review = new Map<string, PersistedReviewItem>();
  for (const item of disk.review) review.set(item.id, item);
  for (const item of mine.review) {
    const other = review.get(item.id);
    // More repetitions means more information about this item, so that copy wins.
    if (!other || item.reps >= other.reps) review.set(item.id, item);
  }

  // The later active day is the truthful one; a streak length can only be
  // trusted from the copy that owns that day.
  const diskDay = disk.streak.lastActiveDay ?? "";
  const myDay = mine.streak.lastActiveDay ?? "";
  const freshest = myDay >= diskDay ? mine.streak : disk.streak;

  return {
    ...mine,
    version: PROFILE_VERSION,
    updatedAt: new Date().toISOString(),
    player: {
      xp,
      level,
      title: titleForLevel(level),
      quizStreak: mine.player.quizStreak,
      bestStreak: Math.max(disk.player.bestStreak, mine.player.bestStreak),
      badges: Array.from(new Set([...disk.player.badges, ...mine.player.badges])),
    },
    streak: {
      lastActiveDay: freshest.lastActiveDay,
      dayStreak: freshest.dayStreak,
      bestDayStreak: Math.max(disk.streak.bestDayStreak, mine.streak.bestDayStreak),
      totalDays: Math.max(disk.streak.totalDays, mine.streak.totalDays),
    },
    mastery,
    review: [...review.values()],
    recentQuizIds: Array.from(new Set([...disk.recentQuizIds, ...mine.recentQuizIds])).slice(-40),
    // A verified checkpoint is a fact. Keep the earliest evidence of it.
    verified: Object.fromEntries(
      [...Object.entries(disk.verified), ...Object.entries(mine.verified)].reduce(
        (acc, [key, at]) => {
          const existing = acc.get(key);
          if (!existing || at < existing) acc.set(key, at);
          return acc;
        },
        new Map<string, string>(),
      ),
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Spaced repetition
 *
 * A Leitner ladder rather than SM-2: no ease factors to tune, no floating
 * point to drift, and the whole schedule is legible in one array. Box 0 is
 * "later today", which is where a fresh miss goes.
 * ------------------------------------------------------------------ */

export const REVIEW_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35];

/** Box 0 comes back in ten minutes, not tomorrow, so a miss gets a same-session retry. */
const BOX_ZERO_MINUTES = 10;

export function dueAtForBox(box: number, from: Date = new Date()): string {
  const b = Math.min(REVIEW_INTERVALS_DAYS.length - 1, Math.max(0, box));
  const days = REVIEW_INTERVALS_DAYS[b];
  const ms = days === 0 ? BOX_ZERO_MINUTES * 60_000 : days * 86_400_000;
  return new Date(from.getTime() + ms).toISOString();
}

/**
 * Schedules an item after a graded attempt. Correct promotes, a miss drops to
 * box 0.
 *
 * `hesitant` is the cheap half of a real spacing algorithm: an answer that took
 * a long time is weaker recall than an instant one, so it holds its box rather
 * than advancing. Cheaper than SM-2's ease factors, and it captures the signal
 * that actually matters.
 */
export function scheduleReview(
  item: PersistedReviewItem,
  correct: boolean,
  now: Date = new Date(),
  options: { hesitant?: boolean } = {},
): PersistedReviewItem {
  const box = correct
    ? options.hesitant
      ? item.box
      : Math.min(REVIEW_INTERVALS_DAYS.length - 1, item.box + 1)
    : 0;
  return {
    ...item,
    box,
    reps: item.reps + 1,
    lapses: item.lapses + (correct ? 0 : 1),
    lastAt: now.toISOString(),
    dueAt: dueAtForBox(box, now),
  };
}

export function isDue(item: PersistedReviewItem, now: Date = new Date()): boolean {
  const t = Date.parse(item.dueAt);
  return !Number.isFinite(t) || t <= now.getTime();
}

/** Due items, most overdue first, so the weakest material surfaces before the rest. */
export function dueItems(
  review: readonly PersistedReviewItem[],
  now: Date = new Date(),
  limit = 20,
): PersistedReviewItem[] {
  return review
    .filter((i) => isDue(i, now))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .slice(0, limit);
}

/**
 * Records a day of practice. Same day is a no-op, the next day extends the
 * streak, and any longer gap restarts it at one, because "consecutive" has to
 * mean consecutive or the number is decoration.
 */
export function touchStreak(
  streak: PersistedStreak,
  now: Date = new Date(),
): { streak: PersistedStreak; newDay: boolean; extended: boolean; broken: number } {
  const today = dayKey(now);
  if (streak.lastActiveDay === today) {
    return { streak, newDay: false, extended: false, broken: 0 };
  }
  const gap = streak.lastActiveDay ? daysBetween(streak.lastActiveDay, today) : null;
  const extended = gap === 1;
  const broken = !extended && streak.dayStreak > 1 ? streak.dayStreak : 0;
  const dayStreak = extended ? streak.dayStreak + 1 : 1;
  return {
    streak: {
      lastActiveDay: today,
      dayStreak,
      bestDayStreak: Math.max(streak.bestDayStreak, dayStreak),
      totalDays: streak.totalDays + 1,
    },
    newDay: true,
    extended,
    broken,
  };
}

/** How stale the streak is, for the "you'll lose it today" nudge. */
export function streakStatus(
  streak: PersistedStreak,
  now: Date = new Date(),
): "fresh" | "at-risk" | "broken" | "none" {
  if (!streak.lastActiveDay || streak.dayStreak === 0) return "none";
  const gap = daysBetween(streak.lastActiveDay, dayKey(now));
  if (gap === null) return "none";
  if (gap === 0) return "fresh";
  if (gap === 1) return "at-risk";
  return "broken";
}
