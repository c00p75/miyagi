/**
 * Live session state, and the rules for changing it.
 *
 * Everything durable lives in the profile; this module is the in-memory view
 * plus the write-through. Kept out of the server file so the tool handlers can
 * stay thin and the progression rules can be tested without a transport.
 */

import {
  loadProfile,
  saveProfile,
  dueItems,
  dueAtForBox,
  isDue,
  scheduleReview,
  emptyMastery,
  emptyStreak,
  levelForXp,
  titleForLevel,
  titleLadder,
  touchStreak,
  streakStatus,
  PROFILE_VERSION,
  type PersistedMastery,
  type PersistedProfile,
  type PersistedReviewItem,
  type PersistedStreak,
} from "./profile.js";
import { appendHistory, type HistoryKind } from "./history.js";
import { type Category, findTrack } from "./roadmaps.js";
import type { SkillLevel } from "./content.js";
import { DEFAULT_MODE, resolveMode, type SessionMode } from "./modes.js";

const log = (...a: unknown[]) => console.error("[miyagi]", ...a);

export interface Player {
  xp: number;
  level: number;
  title: string;
  quizStreak: number;
  bestStreak: number;
  badges: string[];
}

export interface Roadmap {
  category: Category;
  roadmap_name: string;
  current_topic: string;
  step_index: number;
  total_steps: number;
}

export const player: Player = {
  xp: 0,
  level: 1,
  title: titleForLevel(1),
  quizStreak: 0,
  bestStreak: 0,
  badges: [],
};

export const activeRoadmap: Roadmap = {
  category: "Absolute Beginners",
  roadmap_name: "Command Line Basics",
  current_topic: "Navigating the filesystem",
  step_index: 1,
  total_steps: 10,
};

export const voice = { enabled: true, words_per_minute: 180 };

export const session = {
  skillLevel: "Junior" as SkillLevel,
  startedAt: new Date().toISOString(),
  /** Ids of quizzes asked this process, newest last. Persisted as recentQuizIds. */
  recentQuizIds: [] as string[],
  mode: DEFAULT_MODE as SessionMode,
};

export let streak: PersistedStreak = emptyStreak();
export const mastery = new Map<string, PersistedMastery>();
export let review: PersistedReviewItem[] = [];

/**
 * Checkpoints that have actually passed, keyed `track#stepIndex`.
 *
 * The honest ledger. XP for a verified step is awarded once, on the first pass,
 * because paying again for re-running a probe would recreate exactly the
 * problem this replaces: a number that goes up without anything being learned.
 */
export const verified = new Map<string, string>();

export function verificationKey(track: string, stepIndex: number): string {
  return `${track}#${stepIndex}`;
}

export function isVerified(track: string, stepIndex: number): boolean {
  return verified.has(verificationKey(track, stepIndex));
}

export function verifiedAt(track: string, stepIndex: number): string | null {
  return verified.get(verificationKey(track, stepIndex)) ?? null;
}

/** Records a pass. Returns false when this step had already been verified. */
export function markVerified(track: string, stepIndex: number): boolean {
  const key = verificationKey(track, stepIndex);
  if (verified.has(key)) return false;
  verified.set(key, new Date().toISOString());
  schedulePersist();
  return true;
}

/** How much of a track has been proved, for progress that is not just a counter. */
export function verifiedCount(track: string): number {
  const prefix = `${track}#`;
  let n = 0;
  for (const key of verified.keys()) if (key.startsWith(prefix)) n++;
  return n;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

export function snapshot(): PersistedProfile {
  return {
    version: PROFILE_VERSION,
    updatedAt: new Date().toISOString(),
    player: { ...player, badges: [...player.badges] },
    settings: {
      skillLevel: session.skillLevel,
      voiceEnabled: voice.enabled,
      wordsPerMinute: voice.words_per_minute,
      mode: session.mode,
    },
    roadmap: { ...activeRoadmap },
    streak: { ...streak },
    mastery: Object.fromEntries(mastery),
    review: review.map((r) => ({ ...r })),
    recentQuizIds: session.recentQuizIds.slice(-40),
    verified: Object.fromEntries(verified),
  };
}

let persistTimer: NodeJS.Timeout | null = null;

/**
 * Called after every successful write, so the server can tell subscribed
 * clients that the profile resource moved. Without this a sidebar reading
 * `miyagi://profile` shows a level the learner passed twenty minutes ago.
 */
type PersistListener = () => void;
const persistListeners: PersistListener[] = [];

export function onPersist(listener: PersistListener): void {
  persistListeners.push(listener);
}

function announcePersist(): void {
  for (const listener of persistListeners) {
    try {
      listener();
    } catch {
      // A notification failure must never cost a save.
    }
  }
}

/**
 * Debounced write-through. A learner should never wait on a disk write to see
 * their teaching card, and a failed write should cost the streak rather than
 * the session.
 */
export function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void saveProfile(snapshot()).then((ok) => {
      if (ok) announcePersist();
      else log("could not write profile; progress is session-only");
    });
  }, 250);
  // A pending write must not hold the process open on shutdown.
  persistTimer.unref?.();
}

/** Force a write now. Used before note export, which reports what it saved. */
export async function persistNow(): Promise<boolean> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const ok = await saveProfile(snapshot());
  if (ok) announcePersist();
  return ok;
}

/** True when this process started with no saved profile: a genuinely new user. */
export let firstRun = true;

export function markReturning(): void {
  firstRun = false;
}

export async function hydrate(): Promise<boolean> {
  const saved = await loadProfile();
  if (!saved) return false;

  player.xp = saved.player.xp;
  player.level = saved.player.level;
  player.title = saved.player.title;
  player.quizStreak = saved.player.quizStreak;
  player.bestStreak = saved.player.bestStreak;
  player.badges.splice(0, player.badges.length, ...saved.player.badges);

  session.skillLevel = saved.settings.skillLevel as SkillLevel;
  session.recentQuizIds = [...saved.recentQuizIds];
  session.mode = resolveMode(saved.settings.mode);
  voice.enabled = saved.settings.voiceEnabled;
  voice.words_per_minute = saved.settings.wordsPerMinute;

  activeRoadmap.category = saved.roadmap.category as Category;
  activeRoadmap.roadmap_name = saved.roadmap.roadmap_name;
  activeRoadmap.current_topic = saved.roadmap.current_topic;
  const lookup = findTrack(saved.roadmap.roadmap_name, saved.roadmap.category as Category);
  activeRoadmap.total_steps = lookup.track.steps.length;
  activeRoadmap.step_index = Math.min(saved.roadmap.step_index, activeRoadmap.total_steps);

  streak = saved.streak;
  mastery.clear();
  for (const [k, v] of Object.entries(saved.mastery)) mastery.set(k, v);
  review = saved.review;
  verified.clear();
  for (const [k, v] of Object.entries(saved.verified)) verified.set(k, v);
  firstRun = false;
  return true;
}

/**
 * Wipes progress back to first-run state. The roadmap step goes with it: a
 * reset player left on step 9 of a track they have never walked is not a
 * first-run state, it is a confusing one.
 */
export function resetProgress(): void {
  player.xp = 0;
  player.level = 1;
  player.title = titleForLevel(1);
  player.quizStreak = 0;
  player.bestStreak = 0;
  player.badges.length = 0;
  activeRoadmap.step_index = 1;
  streak = emptyStreak();
  mastery.clear();
  review = [];
  verified.clear();
  session.recentQuizIds = [];
  schedulePersist();
}

/* ------------------------------------------------------------------ *
 * Progression
 * ------------------------------------------------------------------ */

export interface XpResult {
  awarded: number;
  leveledUp: boolean;
  newLevel: number;
  newTitle: string;
  titleChanged: boolean;
  newBadges: string[];
}

function addBadge(badge: string): boolean {
  if (player.badges.includes(badge)) return false;
  player.badges.push(badge);
  return true;
}

const DAY_STREAK_BADGES: Array<{ days: number; badge: string }> = [
  { days: 3, badge: "Three Days Running 📅" },
  { days: 7, badge: "Week of Practice 🗓️" },
  { days: 30, badge: "Thirty Days ⛩️" },
];

export function awardXp(amount: number): XpResult {
  const beforeLevel = player.level;
  const beforeTitle = player.title;
  const beforeBadges = player.badges.length;

  player.xp = Math.max(0, player.xp + amount);
  player.level = levelForXp(player.xp);
  player.title = titleForLevel(player.level);

  if (player.level >= 10) addBadge("Archwizard 🧙");
  if (player.xp >= 500) addBadge("Grinder 💪");

  schedulePersist();

  return {
    awarded: amount,
    leveledUp: player.level > beforeLevel,
    newLevel: player.level,
    newTitle: player.title,
    titleChanged: player.title !== beforeTitle,
    newBadges: player.badges.slice(beforeBadges),
  };
}

export interface DayResult {
  newDay: boolean;
  extended: boolean;
  /** The streak length that was lost, when a gap broke one. */
  broken: number;
  dayStreak: number;
  bestDayStreak: number;
  newBadges: string[];
}

/**
 * Called on every event that counts as practice. Idempotent within a day, so
 * tool handlers can call it freely rather than deciding who owns the streak.
 */
export function touchDay(): DayResult {
  const before = streak;
  const result = touchStreak(before);
  streak = result.streak;
  const newBadges: string[] = [];
  if (result.newDay) {
    for (const { days, badge } of DAY_STREAK_BADGES) {
      if (streak.dayStreak >= days && addBadge(badge)) newBadges.push(badge);
    }
    schedulePersist();
  }
  return {
    newDay: result.newDay,
    extended: result.extended,
    broken: result.broken,
    dayStreak: streak.dayStreak,
    bestDayStreak: streak.bestDayStreak,
    newBadges,
  };
}

export function streakState(): "fresh" | "at-risk" | "broken" | "none" {
  return streakStatus(streak);
}

/* ------------------------------------------------------------------ *
 * Mastery
 * ------------------------------------------------------------------ */

export function recordMastery(
  bin: string,
  outcome: { attempt?: boolean; success?: boolean; quiz?: boolean; correct?: boolean },
): PersistedMastery {
  const key = bin.toLowerCase().slice(0, 60) || "shell";
  const m = mastery.get(key) ?? emptyMastery();
  if (outcome.attempt) {
    m.attempts += 1;
    if (outcome.success) m.successes += 1;
  }
  if (outcome.quiz) {
    m.quizAttempts += 1;
    if (outcome.correct) m.quizCorrect += 1;
  }
  m.lastAt = new Date().toISOString();
  mastery.set(key, m);
  schedulePersist();
  return m;
}

export interface MasteryRow {
  bin: string;
  attempts: number;
  successes: number;
  quizAttempts: number;
  quizCorrect: number;
  /** Blended command and quiz success rate, or null when there is nothing to rate. */
  rate: number | null;
  lastAt: string | null;
}

export function masteryRows(): MasteryRow[] {
  return [...mastery.entries()].map(([bin, m]) => {
    const total = m.attempts + m.quizAttempts;
    const good = m.successes + m.quizCorrect;
    return {
      bin,
      attempts: m.attempts,
      successes: m.successes,
      quizAttempts: m.quizAttempts,
      quizCorrect: m.quizCorrect,
      rate: total ? good / total : null,
      lastAt: m.lastAt,
    };
  });
}

/**
 * Weakest first, but only where there is enough evidence to say so. Two
 * attempts at 50% is noise; calling it a weakness would send a learner to
 * drill something they simply have not tried yet.
 */
export function weakSpots(minAttempts = 3, limit = 5): MasteryRow[] {
  return masteryRows()
    .filter((r) => r.attempts + r.quizAttempts >= minAttempts && r.rate !== null && r.rate < 0.8)
    .sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1))
    .slice(0, limit);
}

export function strongSpots(minAttempts = 3, limit = 5): MasteryRow[] {
  return masteryRows()
    .filter((r) => r.attempts + r.quizAttempts >= minAttempts && (r.rate ?? 0) >= 0.8)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Spaced repetition queue
 * ------------------------------------------------------------------ */

const MAX_REVIEW = 500;

function reviewId(kind: "quiz" | "command", ref: string): string {
  return `${kind}:${ref}`;
}

export function findReviewItem(kind: "quiz" | "command", ref: string): PersistedReviewItem | undefined {
  return review.find((r) => r.id === reviewId(kind, ref));
}

/**
 * Adds an item to the queue if it is not there. Existing items are left alone:
 * re-adding on every practice would reset the spacing and turn the schedule
 * into "everything, always".
 */
export function ensureReviewItem(
  kind: "quiz" | "command",
  ref: string,
  label: string,
): PersistedReviewItem {
  const id = reviewId(kind, ref);
  const existing = review.find((r) => r.id === id);
  if (existing) return existing;
  const item: PersistedReviewItem = {
    id,
    kind,
    ref,
    label: label.slice(0, 300),
    box: 0,
    dueAt: dueAtForBox(0),
    reps: 0,
    lapses: 0,
    lastAt: null,
  };
  review.push(item);
  // Oldest-scheduled items go first when the queue is full: an item nobody has
  // reviewed in months is the least useful thing to keep.
  if (review.length > MAX_REVIEW) {
    review.sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt));
    review = review.slice(0, MAX_REVIEW);
  }
  schedulePersist();
  return item;
}

export function gradeReviewItem(
  kind: "quiz" | "command",
  ref: string,
  correct: boolean,
  options: { hesitant?: boolean } = {},
): PersistedReviewItem | null {
  const id = reviewId(kind, ref);
  const idx = review.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  review[idx] = scheduleReview(review[idx], correct, new Date(), options);
  schedulePersist();
  return review[idx];
}

export function due(kind?: "quiz" | "command", limit = 20): PersistedReviewItem[] {
  const pool = kind ? review.filter((r) => r.kind === kind) : review;
  return dueItems(pool, new Date(), limit);
}

export function reviewCounts(): { total: number; due: number; dueQuiz: number; dueCommand: number } {
  const now = new Date();
  const dueAll = review.filter((r) => isDue(r, now));
  return {
    total: review.length,
    due: dueAll.length,
    dueQuiz: dueAll.filter((r) => r.kind === "quiz").length,
    dueCommand: dueAll.filter((r) => r.kind === "command").length,
  };
}

/** The next scheduled item, for a "nothing due, come back at" line. */
export function nextDueAt(): string | null {
  const upcoming = review
    .map((r) => Date.parse(r.dueAt))
    .filter((t) => Number.isFinite(t) && t > Date.now())
    .sort((a, b) => a - b);
  return upcoming.length ? new Date(upcoming[0]).toISOString() : null;
}

export function noteQuizAsked(id: string): void {
  session.recentQuizIds = [...session.recentQuizIds.filter((x) => x !== id), id].slice(-40);
  schedulePersist();
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export function record(entry: {
  kind: HistoryKind;
  label: string;
  detail: string;
  xpAwarded: number;
  bin?: string;
  correct?: boolean;
}): void {
  appendHistory(entry);
}

export { titleLadder, streakStatus };
