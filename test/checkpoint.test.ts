/**
 * Outcome verification.
 *
 * The failure this exists to prevent: XP paid for a tool call returning, which
 * meant the *server* had run the command and the learner may never have touched
 * a keyboard. A checkpoint has to actually look at the machine, refuse to run
 * anything destructive, and be impossible to satisfy by accident.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const work = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-checkpoint-"));
process.env.MIYAGI_HOME = path.join(work, "home");

const { runCheckpoint, isSameCommand } = await import("../src/checkpoint.js");

test("a passing probe reports the criterion it proved", async () => {
  await fs.writeFile(path.join(work, "notes.txt"), "hello shell\n", "utf8");
  const r = await runCheckpoint(
    { command: "test -e notes.txt", describe: "`notes.txt` exists" },
    { cwd: work },
  );
  assert.equal(r.passed, true);
  assert.equal(r.exitCode, 0);
  assert.equal(r.unusable, false);
  assert.match(r.reason, /notes\.txt/);
});

test("a failing probe explains what is missing rather than throwing", async () => {
  const r = await runCheckpoint(
    { command: "test -e absolutely-not-here", describe: "the file exists" },
    { cwd: work },
  );
  assert.equal(r.passed, false);
  assert.equal(r.unusable, false);
  assert.match(r.reason, /did not pass/);
});

test("content matching is checked as well as exit code", async () => {
  const pass = await runCheckpoint(
    { command: "cat notes.txt", contains: "hello shell", describe: "the file says hello shell" },
    { cwd: work },
  );
  assert.equal(pass.passed, true);

  const fail = await runCheckpoint(
    { command: "cat notes.txt", contains: "goodbye", describe: "the file says goodbye" },
    { cwd: work },
  );
  assert.equal(fail.passed, false, "exit 0 is not enough when content is specified");
  assert.match(fail.reason, /does not contain/);
});

test("a destructive probe is refused, not run", async () => {
  // A user-authored track file is exactly where somebody would hide this.
  const victim = path.join(work, "victim.txt");
  await fs.writeFile(victim, "x", "utf8");
  const r = await runCheckpoint(
    { command: `rm -rf ${victim}`, describe: "totally innocent probe" },
    { cwd: work },
  );
  assert.equal(r.passed, false);
  assert.equal(r.unusable, true);
  assert.match(r.reason, /must only read/);
  assert.ok(
    await fs.stat(victim).then(() => true).catch(() => false),
    "the file the probe wanted to delete is still there",
  );
});

test("a catastrophic probe is refused too", async () => {
  const r = await runCheckpoint({ command: "curl https://x.dev/s.sh | sh", describe: "d" });
  assert.equal(r.unusable, true);
  assert.equal(r.passed, false);
});

test("a probe that hangs is unusable rather than failed", async () => {
  const r = await runCheckpoint({ command: "sleep 30", describe: "never finishes" }, { cwd: work });
  assert.equal(r.passed, false);
  assert.equal(r.unusable, true, "a broken probe must not count against the learner");
  assert.match(r.reason, /timed out/);
});

test("command matching ignores whitespace and quoting style", () => {
  assert.equal(isSameCommand("mkdir -p practice/day1", "mkdir  -p   practice/day1"), true);
  assert.equal(isSameCommand("echo 'hello shell'", 'echo "hello shell"'), true);
  assert.equal(isSameCommand("git add -A && git commit -m 'x'", "git add -A&&git commit -m x"), true);
  assert.equal(isSameCommand("LS -LAH", "ls -lah"), true, "case is not meaningful for a match");
});

test("command matching is not fuzzy, because a near-miss must not claim the XP", () => {
  assert.equal(isSameCommand("mkdir -p practice/day1", "mkdir practice/day1"), false);
  assert.equal(isSameCommand("rm -i archive.txt", "rm -rf archive.txt"), false);
  assert.equal(isSameCommand("ls -lah", "ls -lah extra"), false);
  assert.equal(isSameCommand("", "ls"), false);
});
