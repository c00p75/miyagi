/**
 * Execution.
 *
 * Truncation and timeouts used to be silent, which reads to a learner as "that
 * is all the output there was" — the one interpretation guaranteed to mislead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { runCommand, forDisplay, looksInteractive, MAX_OUTPUT_BYTES, powershellScript } = await import("../src/run.js");

test("a successful command reports exit 0 and its output", async () => {
  const r = await runCommand("printf 'hello\\n'");
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "hello");
  assert.equal(r.truncated, false);
  assert.equal(r.timedOut, false);
  assert.ok(r.durationMs >= 0);
});

test("a failing command comes back as data, never as a throw", async () => {
  const r = await runCommand("sh -c 'echo boom >&2; exit 3'");
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /boom/);
});

test("a missing binary reports 127 so the diagnostic can name it", async () => {
  const r = await runCommand("miyagi-definitely-not-a-real-binary");
  assert.equal(r.ok, false);
  assert.equal(r.code, 127);
});

test("a timeout is reported as a timeout, not as an unexplained kill", async () => {
  const r = await runCommand("sleep 5", { timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.match(r.errorMessage ?? "", /timeout/i);
  assert.ok(r.durationMs < 5000, "it really was killed early");
});

test("output over the cap is reported as truncated", async () => {
  const r = await runCommand(`head -c ${MAX_OUTPUT_BYTES + 1024} /dev/zero | tr '\\0' 'a'`);
  assert.equal(r.truncated, true, "the learner is told the output is incomplete");
});

test("display trimming says when it trimmed", () => {
  assert.deepEqual(forDisplay("  short  ", 100), { text: "short", trimmed: false });
  const long = forDisplay("x".repeat(500), 100);
  assert.equal(long.text.length, 100);
  assert.equal(long.trimmed, true);
});

test("commands that never exit are recognised before they waste a timeout", () => {
  for (const c of [
    "vim notes.txt",
    "npm run dev",
    "docker compose logs -f",
    "tail -f app.log",
    "top",
    "kubectl port-forward svc/web 8080:80",
    "python3",
  ]) {
    assert.equal(looksInteractive(c), true, `should be recognised: ${c}`);
  }
});

test("ordinary teaching commands are not mistaken for interactive ones", () => {
  for (const c of [
    "ls -lah",
    "git status",
    "npm ci",
    "docker compose config",
    "python3 --version",
    "docker compose logs --tail=100",
    "node --version && npm --version",
  ]) {
    assert.equal(looksInteractive(c), false, `should run: ${c}`);
  }
});

test("the PowerShell wrapper propagates native exit codes", () => {
  const wrapped = powershellScript("Get-Location");
  assert.match(wrapped, /LASTEXITCODE/);
  assert.match(wrapped, /exit 1/);
  assert.ok(wrapped.startsWith("Get-Location;"), "the original command is kept");
});
