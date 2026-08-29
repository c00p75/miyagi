/**
 * Does any of this work?
 *
 * The README has been asking that question rhetorically. With a durable history
 * and a review schedule, it is answerable, so this module answers it: practice
 * cadence over weeks, quiz accuracy over time, how *review* answers compare
 * with first-time ones, and checkpoint pass rates. Retention is the number that
 * matters, and it is the one a levelling bar cannot show.
 *
 * Everything here is derived. Nothing is stored twice, so a report can never
 * disagree with the log it came from.
 */

import { summarise, type HistoryEntry } from "./history.js";

export interface Bucket {
  /** ISO date of the Monday that starts this week. */
  week: string;
  days: number;
  commands: number;
  quizzes: number;
  quizzesCorrect: number;
  checkpoints: number;
  checkpointsPassed: number;
  xp: number;
}

export interface Insights {
  totalDays: number;
  activeStreakWeeks: number;
  firstAt: string | null;
  lastAt: string | null;
  weeks: Bucket[];
  /** Accuracy on questions seen for the first time. */
  freshAccuracy: number | null;
  /** Accuracy on spaced-repetition answers: the retention signal. */
  reviewAccuracy: number | null;
  checkpointPassRate: number | null;
  /** Commands practised most, with their success rate. */
  topCommands: Array<{ bin: string; runs: number; rate: number | null }>;
  /** Days between first and last activity, which contextualises everything else. */
  spanDays: number;
  verdict: string;
}

/** Monday of the week containing this date, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const ratio = (good: number, total: number): number | null => (total ? good / total : null);

export function analyse(entries: readonly HistoryEntry[]): Insights {
  const stats = summarise(entries);
  const byWeek = new Map<string, Bucket>();
  const daysByWeek = new Map<string, Set<string>>();
  const bins = new Map<string, { runs: number; ok: number }>();

  let fresh = 0;
  let freshOk = 0;
  let reviewed = 0;
  let reviewedOk = 0;

  for (const e of entries) {
    const week = weekStart(e.at);
    const bucket =
      byWeek.get(week) ??
      {
        week,
        days: 0,
        commands: 0,
        quizzes: 0,
        quizzesCorrect: 0,
        checkpoints: 0,
        checkpointsPassed: 0,
        xp: 0,
      };
    const seenDays = daysByWeek.get(week) ?? new Set<string>();
    seenDays.add(e.day);
    daysByWeek.set(week, seenDays);

    bucket.xp += e.xpAwarded || 0;
    if (e.kind === "command") {
      bucket.commands++;
      if (e.bin) {
        const row = bins.get(e.bin) ?? { runs: 0, ok: 0 };
        row.runs++;
        // "executed successfully" is the detail the command path writes on exit 0.
        if (e.detail.startsWith("executed successfully")) row.ok++;
        bins.set(e.bin, row);
      }
    } else if (e.kind === "quiz") {
      bucket.quizzes++;
      fresh++;
      if (e.correct) {
        bucket.quizzesCorrect++;
        freshOk++;
      }
    } else if (e.kind === "review") {
      // A review session's own start line has no verdict; only graded ones count.
      if (typeof e.correct === "boolean") {
        bucket.quizzes++;
        reviewed++;
        if (e.correct) {
          bucket.quizzesCorrect++;
          reviewedOk++;
        }
      }
    } else if (e.kind === "checkpoint") {
      bucket.checkpoints++;
      if (e.correct) bucket.checkpointsPassed++;
    }
    byWeek.set(week, bucket);
  }

  for (const [week, days] of daysByWeek) {
    const bucket = byWeek.get(week);
    if (bucket) bucket.days = days.size;
  }

  const weeks = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));

  // Consecutive most-recent weeks with any activity: the honest cadence measure,
  // since a day streak says nothing about whether someone came back in March.
  let activeStreakWeeks = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].days === 0) break;
    if (i < weeks.length - 1) {
      const gap =
        (Date.parse(weeks[i + 1].week) - Date.parse(weeks[i].week)) / (7 * 86_400_000);
      if (gap > 1) break;
    }
    activeStreakWeeks++;
  }

  const spanDays =
    stats.firstAt && stats.lastAt
      ? Math.max(1, Math.round((Date.parse(stats.lastAt) - Date.parse(stats.firstAt)) / 86_400_000))
      : 0;

  const freshAccuracy = ratio(freshOk, fresh);
  const reviewAccuracy = ratio(reviewedOk, reviewed);

  return {
    totalDays: stats.days,
    activeStreakWeeks,
    firstAt: stats.firstAt,
    lastAt: stats.lastAt,
    weeks,
    freshAccuracy,
    reviewAccuracy,
    checkpointPassRate: ratio(stats.checkpointsPassed, stats.checkpoints),
    topCommands: [...bins.entries()]
      .sort((a, b) => b[1].runs - a[1].runs)
      .slice(0, 10)
      .map(([bin, row]) => ({ bin, runs: row.runs, rate: ratio(row.ok, row.runs) })),
    spanDays,
    verdict: verdictFor({ reviewed, reviewAccuracy, freshAccuracy, days: stats.days, spanDays }),
  };
}

/**
 * A sentence about whether the practice is sticking, and refusal to claim one
 * where there is not enough evidence. Overclaiming here would be the same
 * mistake as calling two failed attempts a weakness.
 */
function verdictFor(args: {
  reviewed: number;
  reviewAccuracy: number | null;
  freshAccuracy: number | null;
  days: number;
  spanDays: number;
}): string {
  if (args.days < 3) {
    return "Too early to say anything. Retention needs at least a few separate days of practice before the numbers mean anything.";
  }
  if (args.reviewed < 10 || args.reviewAccuracy === null) {
    return `${args.reviewed} graded reviews so far. Retention becomes measurable at around 10; keep clearing what is due.`;
  }
  const review = Math.round(args.reviewAccuracy * 100);
  const first = args.freshAccuracy === null ? null : Math.round(args.freshAccuracy * 100);
  if (review >= 80) {
    return `Review accuracy is ${review}%${first === null ? "" : ` against ${first}% on first sight`}, which is what retention looks like: the material is surviving the gap, not just the session.`;
  }
  if (review >= 60) {
    return `Review accuracy is ${review}%${first === null ? "" : ` against ${first}% first time`}. Some of it is sticking. The intervals may be moving too fast for you — missing an item is the mechanism, not a penalty.`;
  }
  return `Review accuracy is ${review}%, which means most of this is not being retained yet. Shorter sessions more often beat long ones, and clearing what is due beats new ground.`;
}
