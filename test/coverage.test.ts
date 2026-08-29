/**
 * Coverage parity.
 *
 * A track can teach a command the content pack has never heard of, and the
 * failure is invisible: the card falls back to the generic shell model and
 * nobody notices until a learner reads it. This suite makes that a build
 * failure instead, and forces every exclusion to be a deliberate, named one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-coverage-"));

const { allTracks, verifiableSteps } = await import("../src/roadmaps.js");
const { binOf, contentFor, CONTENT } = await import("../src/content.js");
const { QUIZ_BANK } = await import("../src/quiz.js");
const { screenDanger, screenCommand } = await import("../src/safety.js");

/**
 * Commands a built-in track teaches that deliberately have no authored lesson.
 * These are third-party one-shots run through `npx`: the tutor brief is the
 * honest path for them, and pretending to have a lesson would be worse.
 */
const ALLOWED_UNCOVERED = new Set(["serve", "lighthouse"]);

function trackBins(): Map<string, string[]> {
  const bins = new Map<string, string[]>();
  for (const track of allTracks()) {
    for (const step of track.steps) {
      for (const command of [step.command, step.windows, step.verify?.command]) {
        if (!command) continue;
        const bin = binOf(command);
        const where = bins.get(bin) ?? [];
        where.push(`${track.name}: ${command}`);
        bins.set(bin, where);
      }
    }
  }
  return bins;
}

test("every command a track teaches has an authored lesson, or a named exclusion", () => {
  const uncovered: string[] = [];
  for (const [bin, uses] of trackBins()) {
    if (contentFor(bin).content) continue;
    if (ALLOWED_UNCOVERED.has(bin)) continue;
    // PowerShell variants resolve to cmdlets, which the POSIX pack does not and
    // should not claim to teach; the substitution note on the card says so.
    if (/^(get|set|new|remove|copy|move|select)-/i.test(bin)) continue;
    uncovered.push(`${bin} (${uses[0]})`);
  }
  assert.deepEqual(
    uncovered,
    [],
    `tracks teach commands with no lesson:\n  ${uncovered.join("\n  ")}`,
  );
});

test("the exclusion list does not outlive its reason", () => {
  const bins = trackBins();
  for (const excluded of ALLOWED_UNCOVERED) {
    assert.ok(bins.has(excluded), `${excluded} is excluded but no track teaches it any more`);
    assert.equal(
      contentFor(excluded).content,
      null,
      `${excluded} now has a lesson, so remove it from the exclusion list`,
    );
  }
});

test("the quiz bank has something topical for the commands tracks lean on", () => {
  const covered = new Set(QUIZ_BANK.flatMap((q) => q.bins));
  const core = ["git", "docker", "npm", "curl", "rm", "chmod", "kubectl", "terraform"];
  for (const bin of core) {
    assert.ok(covered.has(bin), `no topical question for ${bin}`);
  }
});

test("no built-in step is something the safety screen would block", () => {
  for (const track of allTracks()) {
    for (const step of track.steps) {
      const screening = screenCommand(step.command);
      assert.equal(
        screening.blocked,
        false,
        `${track.name} teaches a command the tutor will never run: ${step.command}`,
      );
      if (step.windows) {
        assert.equal(
          screenCommand(step.windows).blocked,
          false,
          `${track.name} teaches a Windows command the tutor will never run: ${step.windows}`,
        );
      }
    }
  }
});

test("every built-in checkpoint is read-only", () => {
  // A checkpoint that mutates state would be doing the learner's work, or
  // undoing it. Both are worse than having no checkpoint.
  for (const track of allTracks()) {
    for (const step of track.steps) {
      if (!step.verify) continue;
      assert.deepEqual(
        screenDanger(step.verify.command),
        [],
        `${track.name} has a checkpoint the screen objects to: ${step.verify.command}`,
      );
      if (step.verify.windows) {
        assert.deepEqual(
          screenDanger(step.verify.windows),
          [],
          `${track.name} has a Windows checkpoint the screen objects to: ${step.verify.windows}`,
        );
      }
      assert.ok(
        step.verify.describe.length > 10,
        `${track.name} checkpoint needs a readable criterion: ${step.verify.command}`,
      );
    }
  }
});

test("checkpoints exist where an outcome is checkable", () => {
  // Not every step can be verified (`git status` changes nothing), but a track
  // with no checkpoints at all is a list of suggestions, not a course.
  for (const track of allTracks()) {
    assert.ok(
      verifiableSteps(track) >= 1,
      `${track.name} has no checkpoints, so nothing in it can be earned`,
    );
  }
  const beginner = allTracks().find((t) => t.name === "Command Line Basics")!;
  assert.ok(
    verifiableSteps(beginner) >= 6,
    "the beginner track is where verification matters most",
  );
});

test("the pack does not carry entries nothing can reach", () => {
  // Every entry should be reachable from a command line, directly or by alias.
  for (const bin of Object.keys(CONTENT)) {
    assert.ok(
      contentFor(bin).content,
      `${bin} is in the pack but binOf/aliases cannot resolve to it`,
    );
  }
});
