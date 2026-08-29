/**
 * Shell awareness.
 *
 * Every built-in track is written for a POSIX shell. On Windows the tutor
 * substitutes a PowerShell line and runs it through powershell.exe. A Windows
 * learner's first lesson used to be a Hotfix Diagnostic for the tutor's own
 * suggestion. Silence was the bug.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-platform-"));

const { hostShell, shellCompatible, posixEscapeHatch, execShellName } = await import(
  "../src/platform.js"
);
const { allTracks, findTrack, resolveStep, stepAt, trackShellWarning } = await import(
  "../src/roadmaps.js"
);

test("the host shell is derived from the platform", () => {
  assert.equal(hostShell("win32"), "powershell");
  assert.equal(hostShell("darwin"), "posix");
  assert.equal(hostShell("linux"), "posix");
});

test("compatibility is exact, except for tracks that claim any", () => {
  assert.equal(shellCompatible("posix", "posix"), true);
  assert.equal(shellCompatible("posix", "powershell"), false);
  assert.equal(shellCompatible("any", "powershell"), true);
});

test("execution shell names the thing that will actually parse the command", () => {
  assert.equal(execShellName("win32"), "powershell.exe");
  assert.equal(execShellName("linux"), "/bin/sh");
});

test("a POSIX step on Windows is substituted where a variant exists", () => {
  const track = findTrack("Command Line Basics").track;
  const step = stepAt(track, 1); // pwd
  const resolved = resolveStep(track, step, "powershell");
  assert.equal(resolved.substituted, true);
  assert.equal(resolved.command, "Get-Location");
  assert.equal(resolved.warning, null);
});

test("a POSIX step with no variant warns instead of offering a line that fails", () => {
  const track = findTrack("DevOps").track;
  const step = stepAt(track, 1); // uname -a, no PowerShell variant
  const resolved = resolveStep(track, step, "powershell");
  assert.equal(resolved.substituted, false);
  assert.equal(resolved.command, step.command);
  assert.ok(resolved.warning, "the learner is told, rather than handed a failure");
  assert.match(resolved.warning, /WSL|Git Bash/);
});

test("on a matching host nothing is substituted or warned about", () => {
  const track = findTrack("DevOps").track;
  const resolved = resolveStep(track, stepAt(track, 1), "posix");
  assert.equal(resolved.warning, null);
  assert.equal(resolved.substituted, false);
});

test("the track-level warning counts how much of the track is covered", () => {
  const cli = findTrack("Command Line Basics").track;
  const warning = trackShellWarning(cli, "powershell");
  assert.ok(warning);
  assert.match(warning, /10 of 10 steps have a PowerShell equivalent/);

  const devops = findTrack("DevOps").track;
  assert.match(trackShellWarning(devops, "powershell") ?? "", /None of its steps/);
  assert.equal(trackShellWarning(devops, "posix"), null);
});

test("every built-in track declares the shell it was written for", () => {
  for (const t of allTracks()) {
    assert.ok(["posix", "powershell", "any"].includes(t.shell), `${t.name} has no usable shell`);
  }
});

test("the Windows escape hatch is advice, and only on Windows", () => {
  assert.equal(posixEscapeHatch("darwin"), "");
  assert.match(posixEscapeHatch("win32"), /WSL/);
});
