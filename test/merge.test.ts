/**
 * Concurrent sessions.
 *
 * Claude Desktop and Cursor each spawn their own stdio server against the same
 * `~/.miyagi/profile.json`. A plain overwrite means the second one to save
 * silently discards the first one's XP, streak and review scheduling — the
 * learner does the work and watches it disappear. Merging has to be additive,
 * and it has to be impossible for a merge to *lose* a verified checkpoint.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-merge-"));
process.env.MIYAGI_HOME = home;

const { mergeProfiles, normaliseProfile, saveProfile, loadProfile, PROFILE_VERSION } = await import(
  "../src/profile.js"
);

const profile = (over: Record<string, unknown> = {}): any =>
  normaliseProfile({
    version: PROFILE_VERSION,
    updatedAt: new Date().toISOString(),
    player: { xp: 100, quizStreak: 1, bestStreak: 3, badges: ["A"] },
    settings: { skillLevel: "Mid", voiceEnabled: true, wordsPerMinute: 180 },
    roadmap: {
      category: "Skill Based",
      roadmap_name: "Git and GitHub",
      current_topic: "Branching",
      step_index: 2,
      total_steps: 10,
    },
    streak: { lastActiveDay: "2026-03-01", dayStreak: 2, bestDayStreak: 2, totalDays: 2 },
    mastery: {},
    review: [],
    recentQuizIds: [],
    verified: {},
    ...over,
  });

test("XP takes the higher of the two, and level follows it", () => {
  const merged = mergeProfiles(
    profile({ player: { xp: 640, quizStreak: 0, bestStreak: 1, badges: [] } }),
    profile({ player: { xp: 220, quizStreak: 4, bestStreak: 9, badges: [] } }),
  );
  assert.equal(merged.player.xp, 640, "no session can lose XP to another's save");
  assert.equal(merged.player.level, 7);
  assert.equal(merged.player.bestStreak, 9, "records take the maximum");
  assert.equal(merged.player.quizStreak, 4, "the live streak belongs to this session");
});

test("badges union rather than replace", () => {
  const merged = mergeProfiles(
    profile({ player: { xp: 10, quizStreak: 0, bestStreak: 0, badges: ["Grinder", "Deadeye"] } }),
    profile({ player: { xp: 10, quizStreak: 0, bestStreak: 0, badges: ["Grinder", "Sharpshooter"] } }),
  );
  assert.deepEqual(merged.player.badges.sort(), ["Deadeye", "Grinder", "Sharpshooter"]);
});

test("mastery counts take the maximum and stay internally consistent", () => {
  const merged = mergeProfiles(
    profile({
      mastery: { git: { attempts: 10, successes: 9, quizAttempts: 4, quizCorrect: 4, lastAt: "2026-03-01T10:00:00.000Z" } },
    }),
    profile({
      mastery: {
        git: { attempts: 3, successes: 1, quizAttempts: 8, quizCorrect: 2, lastAt: "2026-03-02T10:00:00.000Z" },
        docker: { attempts: 2, successes: 2, quizAttempts: 0, quizCorrect: 0, lastAt: null },
      },
    }),
  );
  assert.equal(merged.mastery.git.attempts, 10);
  assert.equal(merged.mastery.git.quizAttempts, 8);
  assert.ok(merged.mastery.git.successes <= merged.mastery.git.attempts, "never more wins than tries");
  assert.equal(merged.mastery.git.lastAt, "2026-03-02T10:00:00.000Z", "the later touch wins");
  assert.ok(merged.mastery.docker, "a command only one session practised survives");
});

test("the review item with more repetitions wins, because it knows more", () => {
  const older = {
    id: "quiz:x",
    kind: "quiz",
    ref: "x",
    label: "x",
    box: 1,
    dueAt: "2026-03-02T00:00:00.000Z",
    reps: 1,
    lapses: 0,
    lastAt: "2026-03-01T00:00:00.000Z",
  };
  const newer = { ...older, box: 3, reps: 4, dueAt: "2026-03-20T00:00:00.000Z" };
  const merged = mergeProfiles(profile({ review: [older] }), profile({ review: [newer] }));
  assert.equal(merged.review.length, 1, "the same item is not duplicated");
  assert.equal(merged.review[0].box, 3);

  const reversed = mergeProfiles(profile({ review: [newer] }), profile({ review: [older] }));
  assert.equal(reversed.review[0].box, 3, "and the order of the merge does not change the answer");
});

test("a verified checkpoint keeps its earliest evidence and can never be dropped", () => {
  const merged = mergeProfiles(
    profile({ verified: { "Git and GitHub#2": "2026-03-01T09:00:00.000Z" } }),
    profile({
      verified: {
        "Git and GitHub#2": "2026-03-05T09:00:00.000Z",
        "Git and GitHub#4": "2026-03-05T10:00:00.000Z",
      },
    }),
  );
  assert.equal(merged.verified["Git and GitHub#2"], "2026-03-01T09:00:00.000Z");
  assert.ok(merged.verified["Git and GitHub#4"], "the other session's pass survives");
  assert.equal(Object.keys(merged.verified).length, 2);
});

test("the day streak comes from whichever copy owns the later day", () => {
  const merged = mergeProfiles(
    profile({ streak: { lastActiveDay: "2026-03-01", dayStreak: 9, bestDayStreak: 9, totalDays: 20 } }),
    profile({ streak: { lastActiveDay: "2026-03-05", dayStreak: 1, bestDayStreak: 1, totalDays: 3 } }),
  );
  assert.equal(merged.streak.lastActiveDay, "2026-03-05");
  assert.equal(merged.streak.dayStreak, 1, "a stale 9-day streak cannot be claimed today");
  assert.equal(merged.streak.bestDayStreak, 9, "but the record is not forgotten");
  assert.equal(merged.streak.totalDays, 20);
});

test("this session's settings and roadmap position win", () => {
  const merged = mergeProfiles(
    profile({
      settings: { skillLevel: "Junior", voiceEnabled: false, wordsPerMinute: 120 },
      roadmap: {
        category: "Role Based",
        roadmap_name: "Backend Developer",
        current_topic: "Containers",
        step_index: 9,
        total_steps: 10,
      },
    }),
    profile(),
  );
  assert.equal(merged.settings.skillLevel, "Mid");
  assert.equal(merged.roadmap.roadmap_name, "Git and GitHub");
  assert.equal(merged.roadmap.step_index, 2, "averaging two people's cursors would be meaningless");
});

test("a save merges with what is already on disk", async () => {
  await saveProfile(profile({ player: { xp: 500, quizStreak: 0, bestStreak: 0, badges: ["First"] } }));
  // A second process saving a lower XP total must not roll the first one back.
  await saveProfile(profile({ player: { xp: 120, quizStreak: 2, bestStreak: 2, badges: ["Second"] } }));

  const back = await loadProfile();
  assert.ok(back);
  assert.equal(back.player.xp, 500);
  assert.deepEqual(back.player.badges.sort(), ["First", "Second"]);
});
