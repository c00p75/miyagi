import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentPlacement,
  levelFromPlacement,
  pickPlacementQuestions,
  recommendTracks,
  recordPlacementResult,
  resetPlacementLog,
  suggestSkillLevel,
  type RecommendableTrack,
} from "../src/recommend.js";
import { QUIZ_BANK } from "../src/quiz.js";

const tracks: RecommendableTrack[] = [
  {
    name: "Command Line Basics",
    category: "Absolute Beginners",
    description: "Survive your first shell.",
    source: "builtin",
    steps: [{ topic: "Knowing where you are", command: "pwd" }],
  },
  {
    name: "Git and GitHub",
    category: "Skill Based",
    description: "Commit and branch.",
    source: "builtin",
    steps: [{ topic: "Staging", command: "git add" }],
  },
  {
    name: "Frontend Developer",
    category: "Role Based",
    description: "Package tooling and the browser.",
    source: "builtin",
    steps: [{ topic: "Dev server", command: "npm run" }],
  },
  {
    name: "Backend Developer",
    category: "Role Based",
    description: "Node and HTTP.",
    source: "builtin",
    steps: [{ topic: "Runtime", command: "node --version" }],
  },
  {
    name: "DevOps",
    category: "Best Practices",
    description: "Containers and planned change.",
    source: "builtin",
    steps: [{ topic: "Cluster", command: "kubectl get" }],
  },
  {
    name: "My Django Track",
    category: "Skill Based",
    description: "Ship the API.",
    source: "user",
    steps: [{ topic: "venv", command: "python3 -m venv" }],
  },
];

test("a Next.js project is not sent to Command Line Basics", () => {
  const recs = recommendTracks({
    tracks,
    xp: 0,
    project: "a Next.js portfolio with Tailwind",
  });
  assert.equal(recs[0]?.name, "Frontend Developer");
  assert.ok(
    recs.every((r) => r.name !== "Command Line Basics") || recs.findIndex((r) => r.name === "Command Line Basics") > 0,
    "CLI may appear, but it is not the lead when the project is a web app",
  );
});

test("k8s and terraform point at DevOps", () => {
  const recs = recommendTracks({ tracks, xp: 40, interests: "kubernetes terraform" });
  assert.equal(recs[0]?.name, "DevOps");
});

test("an authored track about the project outranks a generic match", () => {
  const recs = recommendTracks({ tracks, xp: 20, project: "django api" });
  assert.equal(recs[0]?.name, "My Django Track");
  assert.match(recs[0]?.reason ?? "", /authored|django|python|api/i);
});

test("with no signal and no XP, CLI is offered as one option, not the only one", () => {
  const recs = recommendTracks({ tracks, xp: 0 });
  assert.equal(recs.length, 3);
  assert.ok(recs.some((r) => r.name === "Command Line Basics"));
  assert.ok(recs.some((r) => r.name !== "Command Line Basics"));
});

test("high XP deprioritises the beginner track when nothing else is said", () => {
  const recs = recommendTracks({ tracks, xp: 200 });
  assert.notEqual(recs[0]?.name, "Command Line Basics");
});

test("an unfinished active track is a reason to continue", () => {
  const recs = recommendTracks({
    tracks,
    xp: 80,
    activeName: "Git and GitHub",
    remainingOnActive: 4,
  });
  assert.ok(recs.some((r) => r.name === "Git and GitHub" && /already started/i.test(r.reason)));
});

test("skill level is a suggestion: empty profile is Junior, not a lock", () => {
  const s = suggestSkillLevel({ xp: 0, playerLevel: 1 });
  assert.equal(s.level, "Junior");
  assert.match(s.reason, /not a requirement|You choose|pick/i);
});

test("XP and practised tools can suggest Mid or Senior", () => {
  assert.equal(suggestSkillLevel({ xp: 120, playerLevel: 3 }).level, "Mid");
  assert.equal(suggestSkillLevel({ xp: 420, playerLevel: 6 }).level, "Senior");
});

test("a finished placement overrides the XP heuristic", () => {
  const s = suggestSkillLevel({
    xp: 0,
    playerLevel: 1,
    placement: [
      { level: "Junior", correct: true },
      { level: "Mid", correct: true },
      { level: "Senior", correct: true },
    ],
  });
  assert.equal(s.level, "Senior");
});

test("missing Junior caps placement at Junior", () => {
  const s = levelFromPlacement([
    { level: "Junior", correct: false },
    { level: "Mid", correct: true },
    { level: "Senior", correct: true },
  ]);
  assert.equal(s.level, "Junior");
});

test("placement picks one question per depth from the generic bank", () => {
  const picked = pickPlacementQuestions(QUIZ_BANK, []);
  assert.equal(picked.length, 3);
  assert.deepEqual(
    picked.map((q) => q.level).sort(),
    ["Junior", "Mid", "Senior"],
  );
  assert.ok(picked.every((q) => q.bins.length === 0));
});

test("the placement log records in order and resets", () => {
  resetPlacementLog();
  recordPlacementResult("Junior", true);
  recordPlacementResult("Mid", false);
  assert.equal(currentPlacement().length, 2);
  resetPlacementLog();
  assert.equal(currentPlacement().length, 0);
});
