/**
 * Roadmap lookup.
 *
 * The bug this replaces: `set_active_roadmap` accepted any string, then
 * suggestions silently came from Command Line Basics, so a learner who asked
 * for a frontend track was taught `pwd` and told nothing. A lookup now has to
 * report whether it matched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-roadmaps-"));
process.env.MIYAGI_HOME = home;

const {
  allTracks,
  findTrack,
  loadUserTracks,
  roadmapsDir,
  stepAt,
  trackNames,
  exampleTrackJson,
} = await import("../src/roadmaps.js");

test("every built-in track is usable", () => {
  for (const t of allTracks()) {
    assert.ok(t.steps.length >= 5, `${t.name} is too short to be a track`);
    for (const s of t.steps) {
      assert.ok(s.command.trim(), `${t.name} has an empty command`);
      assert.ok(s.topic.trim(), `${t.name} step "${s.command}" has no topic`);
    }
  }
});

test("an exact name matches", () => {
  const l = findTrack("Git and GitHub");
  assert.equal(l.matched, true);
  assert.equal(l.track.name, "Git and GitHub");
});

test("case and partial names match without inventing a track", () => {
  assert.equal(findTrack("git and github").matched, true);
  assert.equal(findTrack("DevOps").matched, true);
});

test("an unknown name reports itself and offers suggestions", () => {
  const l = findTrack("Rust Systems Programming", "Role Based");
  assert.equal(l.matched, false, "the whole point: it says so");
  assert.equal(l.requested, "Rust Systems Programming");
  assert.ok(l.track.steps.length, "a fallback is still returned so the tool works");
  assert.ok(l.suggestions.length, "and it names what does exist");
});

test("the category default is the fallback", () => {
  assert.equal(findTrack("nonsense", "Role Based").track.name, "Backend Developer");
  assert.equal(findTrack("nonsense", "Absolute Beginners").track.name, "Command Line Basics");
});

test("step lookup is clamped to the track", () => {
  const t = findTrack("Command Line Basics").track;
  assert.equal(stepAt(t, 1).command, t.steps[0].command);
  assert.equal(stepAt(t, 9999).command, t.steps[t.steps.length - 1].command);
  assert.equal(stepAt(t, -5).command, t.steps[0].command);
});

test("git checkpoints inspect demo-repo, not the parent workspace", () => {
  const track = findTrack("Git and GitHub").track;
  const probes = track.steps.map((s) => s.verify?.command).filter(Boolean) as string[];
  assert.ok(probes.some((c) => c.includes("git -C demo-repo")));
  assert.ok(
    !probes.some((c) => /^git rev-parse/.test(c)),
    "a bare git rev-parse would pass inside any clone, including this repo",
  );
});

test("the beginner mkdir step does not cd, so later probes share a cwd", () => {
  const mkdir = findTrack("Command Line Basics").track.steps.find((s) => s.command.includes("mkdir"));
  assert.ok(mkdir);
  assert.equal(mkdir.command.includes("cd "), false);
});

test("a user track is loaded and shadows a built-in of the same name", async () => {
  await fs.mkdir(roadmapsDir(), { recursive: true });
  await fs.writeFile(
    path.join(roadmapsDir(), "mine.json"),
    JSON.stringify({
      name: "My Python Track",
      category: "Skill Based",
      description: "Mine.",
      steps: ["python3 --version", { command: "python3 -m venv .venv", topic: "Virtualenvs", note: "n" }],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(roadmapsDir(), "shadow.json"),
    JSON.stringify({ name: "DevOps", category: "Best Practices", steps: ["echo mine"] }),
    "utf8",
  );

  const report = await loadUserTracks();
  assert.equal(report.loaded, 2);
  assert.ok(trackNames().includes("My Python Track"));

  const mine = findTrack("My Python Track");
  assert.equal(mine.matched, true);
  assert.equal(mine.track.source, "user");
  assert.equal(mine.track.steps[0].command, "python3 --version");
  assert.equal(mine.track.steps[0].topic, "My Python Track", "a bare string step inherits the track name");
  assert.equal(mine.track.steps[1].note, "n");

  const shadowed = findTrack("DevOps");
  assert.equal(shadowed.track.source, "user", "a user track wins");
  assert.equal(shadowed.track.steps[0].command, "echo mine");
});

test("an unparseable track file is reported, not fatal", async () => {
  await fs.writeFile(path.join(roadmapsDir(), "broken.json"), "{ not json", "utf8");
  await fs.writeFile(path.join(roadmapsDir(), "empty.json"), JSON.stringify({ name: "X", steps: [] }), "utf8");
  const report = await loadUserTracks();
  assert.equal(report.skipped.length, 2, "both bad files named");
  assert.ok(report.skipped.some((s) => s.startsWith("broken.json")));
  assert.ok(report.skipped.some((s) => s.includes("no usable steps")));
  assert.ok(report.loaded >= 2, "the good files still loaded");
});

test("a missing roadmaps directory is not an error", async () => {
  const original = process.env.MIYAGI_HOME;
  process.env.MIYAGI_HOME = path.join(home, "does-not-exist");
  const report = await loadUserTracks();
  assert.equal(report.loaded, 0);
  assert.deepEqual(report.skipped, []);
  process.env.MIYAGI_HOME = original;
  await loadUserTracks();
});

test("the documented example is itself valid", () => {
  const parsed = JSON.parse(exampleTrackJson());
  assert.ok(parsed.name && Array.isArray(parsed.steps) && parsed.steps.length);
});
