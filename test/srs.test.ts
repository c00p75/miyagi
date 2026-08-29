/**
 * Scheduling and streaks.
 *
 * These are the rules that decide whether the gamification means anything, so
 * they are tested against clocks rather than through the server: a streak that
 * silently breaks, or an interval that resets to zero on one slip, would be
 * invisible in a smoke test and obvious here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-srs-"));

const {
  scheduleReview,
  dueItems,
  isDue,
  touchStreak,
  streakStatus,
  dueAtForBox,
  REVIEW_INTERVALS_DAYS,
} = await import("../src/profile.js");
const { dayKey, daysBetween } = await import("../src/days.js");

const item = (over: Partial<Parameters<typeof scheduleReview>[0]> = {}) => ({
  id: "quiz:sh-exit-var",
  kind: "quiz" as const,
  ref: "sh-exit-var",
  label: "which variable holds the exit code",
  box: 0,
  dueAt: new Date(0).toISOString(),
  reps: 0,
  lapses: 0,
  lastAt: null,
  ...over,
});

test("a correct answer promotes one box and pushes the due date out", () => {
  const now = new Date("2026-03-01T09:00:00Z");
  const first = scheduleReview(item(), true, now);
  assert.equal(first.box, 1);
  assert.equal(first.reps, 1);
  assert.equal(first.lapses, 0);
  assert.equal(Date.parse(first.dueAt) - now.getTime(), 86_400_000, "box 1 is tomorrow");

  const second = scheduleReview(first, true, now);
  assert.equal(second.box, 2);
  assert.equal(Date.parse(second.dueAt) - now.getTime(), 3 * 86_400_000);
});

test("the top box does not overflow", () => {
  const top = REVIEW_INTERVALS_DAYS.length - 1;
  const held = scheduleReview(item({ box: top }), true);
  assert.equal(held.box, top);
});

test("a miss drops to box 0 and comes back the same session", () => {
  const now = new Date("2026-03-01T09:00:00Z");
  const missed = scheduleReview(item({ box: 4, reps: 8 }), false, now);
  assert.equal(missed.box, 0, "back to the front of the ladder");
  assert.equal(missed.lapses, 1);
  assert.equal(missed.reps, 9, "a miss is still a repetition");
  const minutes = (Date.parse(missed.dueAt) - now.getTime()) / 60_000;
  assert.ok(minutes > 0 && minutes <= 15, `box 0 returns within the session, got ${minutes}m`);
});

test("only elapsed items are due, most overdue first", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  const items = [
    item({ id: "a", dueAt: "2026-03-09T12:00:00Z" }),
    item({ id: "b", dueAt: "2026-03-01T12:00:00Z" }),
    item({ id: "c", dueAt: "2026-03-20T12:00:00Z" }),
  ];
  const dueNow = dueItems(items, now);
  assert.deepEqual(dueNow.map((i) => i.id), ["b", "a"]);
  assert.equal(isDue(items[2], now), false);
});

test("box 0 is minutes and every other box is whole days", () => {
  const from = new Date("2026-03-01T00:00:00Z");
  assert.ok(Date.parse(dueAtForBox(0, from)) - from.getTime() < 3_600_000);
  for (let box = 1; box < REVIEW_INTERVALS_DAYS.length; box++) {
    const days = (Date.parse(dueAtForBox(box, from)) - from.getTime()) / 86_400_000;
    assert.equal(days, REVIEW_INTERVALS_DAYS[box]);
  }
});

/* ---- calendar-day streak ---- */

const midday = (day: string) => new Date(`${day}T12:00:00`);

test("practising twice in one day does not double the streak", () => {
  const start = { lastActiveDay: null, dayStreak: 0, bestDayStreak: 0, totalDays: 0 };
  const first = touchStreak(start, midday("2026-03-01"));
  assert.equal(first.newDay, true);
  assert.equal(first.streak.dayStreak, 1);

  const again = touchStreak(first.streak, new Date("2026-03-01T23:30:00"));
  assert.equal(again.newDay, false, "same calendar day is a no-op");
  assert.equal(again.streak.dayStreak, 1);
  assert.equal(again.streak.totalDays, 1);
});

test("consecutive days extend the streak and raise the best", () => {
  let s = touchStreak({ lastActiveDay: null, dayStreak: 0, bestDayStreak: 0, totalDays: 0 }, midday("2026-03-01")).streak;
  for (const day of ["2026-03-02", "2026-03-03", "2026-03-04"]) {
    const r = touchStreak(s, midday(day));
    assert.equal(r.extended, true, `${day} extends`);
    s = r.streak;
  }
  assert.equal(s.dayStreak, 4);
  assert.equal(s.bestDayStreak, 4);
  assert.equal(s.totalDays, 4);
});

test("a gap restarts the streak at one and reports what was lost", () => {
  const built = { lastActiveDay: "2026-03-04", dayStreak: 4, bestDayStreak: 4, totalDays: 4 };
  const after = touchStreak(built, midday("2026-03-07"));
  assert.equal(after.extended, false);
  assert.equal(after.broken, 4, "the lost run is reported so the card can say so");
  assert.equal(after.streak.dayStreak, 1);
  assert.equal(after.streak.bestDayStreak, 4, "the record survives the lapse");
  assert.equal(after.streak.totalDays, 5);
});

test("a month boundary is still one day", () => {
  const r = touchStreak(
    { lastActiveDay: "2026-03-31", dayStreak: 3, bestDayStreak: 3, totalDays: 3 },
    midday("2026-04-01"),
  );
  assert.equal(r.extended, true);
  assert.equal(r.streak.dayStreak, 4);
});

test("streak status names the at-risk day", () => {
  const built = (day: string) => ({ lastActiveDay: day, dayStreak: 3, bestDayStreak: 3, totalDays: 3 });
  const today = dayKey(new Date());
  assert.equal(streakStatus(built(today)), "fresh");
  const yesterday = new Date(Date.now() - 86_400_000);
  assert.equal(streakStatus(built(dayKey(yesterday))), "at-risk");
  const lastWeek = new Date(Date.now() - 7 * 86_400_000);
  assert.equal(streakStatus(built(dayKey(lastWeek))), "broken");
  assert.equal(streakStatus({ lastActiveDay: null, dayStreak: 0, bestDayStreak: 0, totalDays: 0 }), "none");
});

test("day keys are local and differences are whole days", () => {
  assert.equal(daysBetween("2026-03-01", "2026-03-02"), 1);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1, "2026 is not a leap year");
  assert.equal(daysBetween("2026-03-02", "2026-03-01"), -1);
  assert.equal(daysBetween("nope", "2026-03-01"), null);
});
