/**
 * The profile is the one part of this server that reads state it did not write:
 * the file is hand-editable, a crash can truncate it, and an older or newer
 * version of the server may have produced it. These tests are about what
 * happens on the way back in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-test-"));
process.env.MIYAGI_HOME = home;

const {
  loadProfile,
  saveProfile,
  normaliseProfile,
  profilePath,
  PROFILE_VERSION,
  scheduleReview,
  dueItems,
  touchStreak,
  streakStatus,
  dueAtForBox,
} = await import("../src/profile.js");

const valid = (): any => ({
  version: PROFILE_VERSION,
  updatedAt: new Date().toISOString(),
  player: {
    xp: 340,
    level: 4,
    title: "Shell Apprentice",
    quizStreak: 3,
    bestStreak: 7,
    badges: ["Sharpshooter 🔥"],
  },
  settings: { skillLevel: "Senior", voiceEnabled: false, wordsPerMinute: 220 },
  roadmap: {
    category: "Role Based",
    roadmap_name: "Backend Developer",
    current_topic: "Containers",
    step_index: 3,
    total_steps: 10,
  },
  streak: { lastActiveDay: null, dayStreak: 0, bestDayStreak: 4, totalDays: 9 },
  mastery: { git: { attempts: 6, successes: 5, quizAttempts: 2, quizCorrect: 1, lastAt: new Date().toISOString() } },
  review: [],
  recentQuizIds: ["git-force-lease"],
});

test("a saved profile round-trips", async () => {
  assert.equal(await saveProfile(valid()), true);
  const back = await loadProfile();
  assert.ok(back);
  assert.equal(back.player.xp, 340);
  assert.equal(back.player.bestStreak, 7);
  assert.equal(back.settings.skillLevel, "Senior");
  assert.equal(back.settings.voiceEnabled, false);
  assert.equal(back.settings.mode, "ride-along", "a file with no mode is the quiet default");
  assert.equal(back.roadmap.roadmap_name, "Backend Developer");
});

test("no profile on disk is not an error", async () => {
  await fs.rm(profilePath(), { force: true });
  assert.equal(await loadProfile(), null);
});

test("a truncated file is discarded rather than thrown", async () => {
  await fs.writeFile(profilePath(), '{"version":1,"player":{"xp":3', "utf8");
  assert.equal(await loadProfile(), null);
});

test("a profile from another version is not trusted", () => {
  assert.equal(normaliseProfile({ ...valid(), version: 99 }), null);
  assert.equal(normaliseProfile({ ...valid(), version: 0 }), null);
});

test("a version 1 profile is migrated, not discarded", () => {
  // v1 had no streak, mastery, review or recentQuizIds. Losing a learner's XP
  // on upgrade would be a worse bug than any of those fields being empty.
  const v1 = {
    version: 1,
    updatedAt: new Date().toISOString(),
    player: { xp: 620, level: 7, title: "CLI Artisan", quizStreak: 2, bestStreak: 9, badges: ["Grinder 💪"] },
    settings: { skillLevel: "Mid", voiceEnabled: false, wordsPerMinute: 200 },
    roadmap: {
      category: "Skill Based",
      roadmap_name: "Git and GitHub",
      current_topic: "Branching",
      step_index: 6,
      total_steps: 10,
    },
  };
  const p = normaliseProfile(v1);
  assert.ok(p);
  assert.equal(p.version, PROFILE_VERSION, "the migrated profile is stamped with the current version");
  assert.equal(p.player.xp, 620, "XP survives the upgrade");
  assert.equal(p.player.bestStreak, 9);
  assert.equal(p.settings.skillLevel, "Mid");
  assert.equal(p.settings.mode, "ride-along", "v1 had no mode field");
  assert.equal(p.streak.dayStreak, 0, "no day streak is knowable from a v1 file");
  assert.deepEqual(p.mastery, {});
  assert.deepEqual(p.review, []);
  assert.deepEqual(p.recentQuizIds, []);
});

test("mastery counts cannot claim more successes than attempts", () => {
  const p = normaliseProfile({
    ...valid(),
    mastery: { git: { attempts: 2, successes: 99, quizAttempts: 1, quizCorrect: 50 } },
  });
  assert.equal(p?.mastery.git.successes, 2);
  assert.equal(p?.mastery.git.quizCorrect, 1);
});

test("a review item with an unreadable due date is treated as due now", () => {
  const p = normaliseProfile({
    ...valid(),
    review: [{ id: "quiz:x", kind: "quiz", ref: "x", label: "x", dueAt: "not-a-date", box: 99 }],
  });
  assert.ok(p);
  assert.equal(p.review.length, 1);
  assert.ok(Date.parse(p.review[0].dueAt) <= Date.now(), "fails safe towards revision");
  assert.ok(p.review[0].box <= 5, "box is clamped to the ladder");
});

test("duplicate review ids are collapsed", () => {
  const item = { id: "quiz:x", kind: "quiz", ref: "x", label: "x", dueAt: new Date().toISOString() };
  const p = normaliseProfile({ ...valid(), review: [item, { ...item }] });
  assert.equal(p?.review.length, 1);
});

test("a day streak in the file cannot exceed its own best", () => {
  const p = normaliseProfile({
    ...valid(),
    streak: { lastActiveDay: "2026-01-01", dayStreak: 40, bestDayStreak: 2, totalDays: 1 },
  });
  assert.equal(p?.streak.bestDayStreak, 40, "best is raised to match, not the other way round");
  assert.ok((p?.streak.totalDays ?? 0) >= 1);
});

test("a streak with no last active day has no length", () => {
  const p = normaliseProfile({
    ...valid(),
    streak: { lastActiveDay: "not-a-day", dayStreak: 12, bestDayStreak: 12, totalDays: 30 },
  });
  assert.equal(p?.streak.dayStreak, 0, "a streak nobody can date is not a streak");
});

test("level is derived from XP, never read from the file", () => {
  // A file claiming level 99 at 40 XP is corrected, not believed.
  const p = normaliseProfile({ ...valid(), player: { ...valid().player, xp: 40, level: 99 } });
  assert.ok(p);
  assert.equal(p.player.level, 1);

  const q = normaliseProfile({ ...valid(), player: { ...valid().player, xp: 950, level: 1 } });
  assert.equal(q?.player.level, 10);
});

test("out-of-range and wrong-typed values are clamped, not rejected", () => {
  const p = normaliseProfile({
    version: PROFILE_VERSION,
    player: { xp: -5000, quizStreak: "nonsense", badges: "not-an-array" },
    settings: { skillLevel: "Emperor", voiceEnabled: "yes", wordsPerMinute: 99999 },
    roadmap: { step_index: 500, total_steps: 4 },
  });
  assert.ok(p);
  assert.equal(p.player.xp, 0, "negative XP floors at zero");
  assert.equal(p.player.quizStreak, 0);
  assert.deepEqual(p.player.badges, []);
  assert.equal(p.settings.skillLevel, "Junior", "an unknown skill level falls back");
  assert.equal(p.settings.voiceEnabled, true, "a non-boolean falls back to the default");
  assert.equal(p.settings.wordsPerMinute, 400, "wpm clamps to the ceiling");
  assert.equal(p.roadmap.step_index, 4, "step cannot exceed total_steps");
});

test("duplicate badges are collapsed", () => {
  const p = normaliseProfile({
    ...valid(),
    player: { ...valid().player, badges: ["A", "A", "B", "", "  "] },
  });
  assert.deepEqual(p?.player.badges, ["A", "B"]);
});

test("junk input is rejected without throwing", () => {
  for (const junk of [null, undefined, 42, "string", [], true]) {
    assert.equal(normaliseProfile(junk), null);
  }
});

test("a failed write reports false instead of throwing", async () => {
  const original = process.env.MIYAGI_HOME;
  // A path whose parent is a file, so mkdir cannot succeed.
  const blocker = path.join(home, "blocker");
  await fs.writeFile(blocker, "x", "utf8");
  process.env.MIYAGI_HOME = path.join(blocker, "nested");
  assert.equal(await saveProfile(valid()), false);
  process.env.MIYAGI_HOME = original;
});
