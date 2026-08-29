/**
 * Progression: XP, mastery, the review queue, and reset.
 *
 * These rules decide what the numbers on the card mean, so they are tested
 * against the module directly rather than through a transport.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-state-"));

const state = await import("../src/state.js");
const { activeRoadmap, player } = state;

test("XP drives level and title together", () => {
  state.resetProgress();
  const r = state.awardXp(250);
  assert.equal(player.xp, 250);
  assert.equal(r.newLevel, 3);
  assert.equal(player.title, "Shell Apprentice");
  assert.equal(r.leveledUp, true);
  assert.equal(r.titleChanged, true);
});

test("XP cannot go negative", () => {
  state.resetProgress();
  state.awardXp(20);
  state.awardXp(-500);
  assert.equal(player.xp, 0);
  assert.equal(player.level, 1);
});

test("badges are awarded once", () => {
  state.resetProgress();
  state.awardXp(600);
  const first = player.badges.filter((b) => b.startsWith("Grinder")).length;
  state.awardXp(100);
  const second = player.badges.filter((b) => b.startsWith("Grinder")).length;
  assert.equal(first, 1);
  assert.equal(second, 1);
});

test("the first day of practice awards a streak, and the second call the same day does not", () => {
  state.resetProgress();
  const first = state.touchDay();
  assert.equal(first.newDay, true);
  assert.equal(first.dayStreak, 1);
  const second = state.touchDay();
  assert.equal(second.newDay, false);
  assert.equal(second.dayStreak, 1);
});

test("mastery counts runs and quizzes separately", () => {
  state.resetProgress();
  state.recordMastery("git", { attempt: true, success: true });
  state.recordMastery("git", { attempt: true, success: false });
  state.recordMastery("git", { quiz: true, correct: true });
  const row = state.masteryRows().find((r) => r.bin === "git");
  assert.ok(row);
  assert.equal(row.attempts, 2);
  assert.equal(row.successes, 1);
  assert.equal(row.quizAttempts, 1);
  assert.equal(row.quizCorrect, 1);
  assert.equal(row.rate, 2 / 3);
});

test("a weakness needs enough evidence to be called one", () => {
  state.resetProgress();
  // One failure out of two attempts is noise, not a weakness: calling it one
  // sends a learner to drill something they have barely tried.
  state.recordMastery("jq", { attempt: true, success: false });
  state.recordMastery("jq", { attempt: true, success: true });
  assert.deepEqual(state.weakSpots().map((w) => w.bin), []);

  for (let i = 0; i < 4; i++) state.recordMastery("awk", { attempt: true, success: false });
  assert.deepEqual(state.weakSpots().map((w) => w.bin), ["awk"]);
});

test("weak spots are ordered worst first and strong spots best first", () => {
  state.resetProgress();
  for (let i = 0; i < 5; i++) state.recordMastery("sed", { attempt: true, success: i < 3 }); // 60%
  for (let i = 0; i < 5; i++) state.recordMastery("awk", { attempt: true, success: i < 1 }); // 20%
  for (let i = 0; i < 5; i++) state.recordMastery("ls", { attempt: true, success: true }); // 100%
  assert.deepEqual(state.weakSpots().map((w) => w.bin), ["awk", "sed"]);
  assert.equal(state.strongSpots()[0].bin, "ls");
});

test("re-practising does not reset an item's spacing", () => {
  state.resetProgress();
  const first = state.ensureReviewItem("quiz", "sh-exit-var", "which variable");
  state.gradeReviewItem("quiz", "sh-exit-var", true);
  const promoted = state.findReviewItem("quiz", "sh-exit-var");
  assert.equal(promoted?.box, 1);

  // Adding it again must not knock it back to box 0, or the schedule becomes
  // "everything, always" and stops being a schedule.
  const again = state.ensureReviewItem("quiz", "sh-exit-var", "which variable");
  assert.equal(again.box, 1);
  assert.equal(again.id, first.id);
});

test("a graded miss drops the box and shows up as due", () => {
  state.resetProgress();
  state.ensureReviewItem("quiz", "git-force-lease", "force with lease");
  state.gradeReviewItem("quiz", "git-force-lease", true);
  state.gradeReviewItem("quiz", "git-force-lease", true);
  assert.equal(state.findReviewItem("quiz", "git-force-lease")?.box, 2);
  assert.equal(state.reviewCounts().due, 0, "a promoted item is not due yet");

  state.gradeReviewItem("quiz", "git-force-lease", false);
  const item = state.findReviewItem("quiz", "git-force-lease");
  assert.equal(item?.box, 0);
  assert.equal(item?.lapses, 1);
});

test("grading an item that is not queued is not an error", () => {
  assert.equal(state.gradeReviewItem("quiz", "never-added", false), null);
});

test("counts and next-due describe the queue honestly", () => {
  state.resetProgress();
  state.ensureReviewItem("quiz", "a", "a");
  state.ensureReviewItem("command", "ls", "ls -lah");
  const counts = state.reviewCounts();
  assert.equal(counts.total, 2);
  // A new item lands in box 0, which is ten minutes out, not now: re-asking a
  // question in the same breath as answering it is not spaced repetition.
  assert.equal(counts.due, 0);
  assert.ok(state.nextDueAt(), "and the queue can say when to come back");

  // Backdate one to prove the due filter is a clock comparison, not a guess.
  const item = state.findReviewItem("quiz", "a")!;
  item.dueAt = new Date(Date.now() - 60_000).toISOString();
  const later = state.reviewCounts();
  assert.equal(later.due, 1);
  assert.equal(later.dueQuiz, 1);
  assert.equal(later.dueCommand, 0);

  state.gradeReviewItem("quiz", "a", true);
  assert.equal(state.reviewCounts().due, 0, "answering it clears it");
});

test("reset clears progress, mastery, the queue and the roadmap step", () => {
  state.awardXp(400);
  state.recordMastery("git", { attempt: true, success: true });
  state.ensureReviewItem("quiz", "x", "x");
  activeRoadmap.step_index = 9;

  state.resetProgress();

  assert.equal(player.xp, 0);
  assert.equal(player.level, 1);
  assert.deepEqual(player.badges, []);
  assert.deepEqual(state.masteryRows(), []);
  assert.equal(state.reviewCounts().total, 0);
  assert.equal(activeRoadmap.step_index, 1, "a reset player on step 9 is not a first-run state");
});

test("a snapshot round-trips through the profile normaliser", async () => {
  state.resetProgress();
  state.awardXp(150);
  state.recordMastery("docker", { attempt: true, success: true });
  state.ensureReviewItem("quiz", "docker-latest", "latest is not a version");
  state.touchDay();

  assert.equal(await state.persistNow(), true);
  const { loadProfile } = await import("../src/profile.js");
  const back = await loadProfile();
  assert.ok(back);
  assert.equal(back.player.xp, 150);
  assert.equal(back.mastery.docker.attempts, 1);
  assert.equal(back.review.length, 1);
  assert.equal(back.streak.dayStreak, 1);
});

test("hydrate restores what was saved", async () => {
  state.resetProgress();
  assert.equal(player.xp, 0);
  assert.equal(await state.hydrate(), true);
  assert.equal(player.xp, 150, "the saved profile came back");
  assert.equal(state.reviewCounts().total, 1);
});
