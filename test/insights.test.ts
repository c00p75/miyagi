/**
 * The retention report.
 *
 * The README asked "does XP actually keep anyone on a roadmap" rhetorically for
 * two versions. These tests are about the answer being honest: the verdict has
 * to refuse to claim anything on thin evidence, and review accuracy has to be
 * measured separately from first-sight accuracy or it means nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-insights-"));

const { analyse, weekStart } = await import("../src/insights.js");
type Entry = Parameters<typeof analyse>[0][number];

const at = (day: string, hour = 12) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const entry = (over: Partial<Entry> & { day: string }): Entry => ({
  at: at(over.day),
  kind: "command",
  label: "ls",
  detail: "executed successfully (exit 0, 3 ms)",
  xpAwarded: 10,
  ...over,
});

test("weeks bucket to their Monday", () => {
  assert.equal(weekStart("2026-03-04T10:00:00Z"), "2026-03-02"); // Wednesday
  assert.equal(weekStart("2026-03-02T10:00:00Z"), "2026-03-02"); // Monday itself
  assert.equal(weekStart("2026-03-08T10:00:00Z"), "2026-03-02"); // Sunday
  assert.equal(weekStart("not a date"), "unknown");
});

test("an empty history claims nothing", () => {
  const i = analyse([]);
  assert.equal(i.totalDays, 0);
  assert.equal(i.freshAccuracy, null);
  assert.equal(i.reviewAccuracy, null);
  assert.equal(i.checkpointPassRate, null);
  assert.match(i.verdict, /Too early/);
});

test("first-sight and review accuracy are measured separately", () => {
  const entries: Entry[] = [];
  // 8 of 10 first sights correct, 6 of 10 reviews correct.
  for (let n = 0; n < 10; n++) {
    entries.push(entry({ day: "2026-03-02", kind: "quiz", correct: n < 8, xpAwarded: 25 }));
    entries.push(entry({ day: "2026-03-03", kind: "review", correct: n < 6, xpAwarded: 30 }));
  }
  entries.push(entry({ day: "2026-03-04" }));

  const i = analyse(entries);
  assert.equal(i.freshAccuracy, 0.8);
  assert.equal(i.reviewAccuracy, 0.6);
  assert.match(i.verdict, /60%/, "the verdict quotes the retention number, not the easy one");
});

test("a review session's own start line is not counted as an answer", () => {
  // review_due_items logs a `review` entry with no verdict when it opens.
  const i = analyse([
    entry({ day: "2026-03-02", kind: "review", detail: "3 questions asked", xpAwarded: 0 }),
    entry({ day: "2026-03-03", kind: "review", correct: true, xpAwarded: 30 }),
    entry({ day: "2026-03-04", kind: "review", correct: false, xpAwarded: 5 }),
  ]);
  assert.equal(i.reviewAccuracy, 0.5, "two graded answers, not three");
});

test("checkpoint pass rate is reported from checkpoint entries only", () => {
  const i = analyse([
    entry({ day: "2026-03-02", kind: "checkpoint", correct: true, xpAwarded: 30 }),
    entry({ day: "2026-03-02", kind: "checkpoint", correct: false, xpAwarded: 0 }),
    entry({ day: "2026-03-02", kind: "checkpoint", correct: true, xpAwarded: 30 }),
    entry({ day: "2026-03-02", kind: "quiz", correct: false, xpAwarded: 5 }),
  ]);
  assert.equal(i.checkpointPassRate, 2 / 3);
});

test("weekly buckets count distinct days, not events", () => {
  const i = analyse([
    entry({ day: "2026-03-02" }),
    entry({ day: "2026-03-02", at: at("2026-03-02", 18) }),
    entry({ day: "2026-03-05" }),
    entry({ day: "2026-03-16" }),
  ]);
  const first = i.weeks.find((w) => w.week === "2026-03-02");
  assert.equal(first?.days, 2, "two calendar days, three events");
  assert.equal(first?.commands, 3);
  assert.equal(i.totalDays, 3);
  assert.equal(i.weeks.length, 2, "a gap week is absent rather than invented");
});

test("the active-week streak stops at a gap", () => {
  const consecutive = analyse([
    entry({ day: "2026-03-02" }),
    entry({ day: "2026-03-09" }),
    entry({ day: "2026-03-16" }),
  ]);
  assert.equal(consecutive.activeStreakWeeks, 3);

  const gapped = analyse([
    entry({ day: "2026-03-02" }),
    entry({ day: "2026-04-06" }),
    entry({ day: "2026-04-13" }),
  ]);
  assert.equal(gapped.activeStreakWeeks, 2, "the March week does not count towards April's run");
});

test("top commands rank by practice and report a success rate", () => {
  const entries: Entry[] = [];
  for (let n = 0; n < 5; n++) {
    entries.push(entry({ day: "2026-03-02", bin: "git", detail: n < 4 ? "executed successfully (exit 0)" : "failed (exit 1)" }));
  }
  entries.push(entry({ day: "2026-03-02", bin: "docker" }));
  const i = analyse(entries);
  assert.equal(i.topCommands[0].bin, "git");
  assert.equal(i.topCommands[0].runs, 5);
  assert.equal(i.topCommands[0].rate, 0.8);
});

test("the verdict refuses to draw conclusions from too little review data", () => {
  const thin: Entry[] = [];
  for (const day of ["2026-03-02", "2026-03-03", "2026-03-04"]) thin.push(entry({ day }));
  thin.push(entry({ day: "2026-03-04", kind: "review", correct: true }));
  const i = analyse(thin);
  assert.match(i.verdict, /becomes measurable/, "one review is not retention");
  assert.ok(!/works|proven/i.test(i.verdict));
});

test("strong retention is described as retention, not as a score", () => {
  const entries: Entry[] = [];
  for (const day of ["2026-03-02", "2026-03-09", "2026-03-16"]) {
    for (let n = 0; n < 5; n++) {
      entries.push(entry({ day, kind: "review", correct: true, xpAwarded: 30 }));
    }
  }
  const i = analyse(entries);
  assert.equal(i.reviewAccuracy, 1);
  assert.match(i.verdict, /surviving the gap/);
});
