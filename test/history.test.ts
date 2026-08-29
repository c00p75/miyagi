/**
 * Durable history.
 *
 * The bug this fixes: the log lived in an array, so a note export after a
 * restart described a level 12 player who had practised nothing. What matters
 * here is that a write survives the process and that one corrupt line costs
 * only itself.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-history-"));

const { appendHistory, readHistory, flushHistory, summarise, historyPath } = await import(
  "../src/history.js"
);

test("appended events come back", async () => {
  appendHistory({ kind: "command", label: "ls -lah", detail: "exit 0", xpAwarded: 15, bin: "ls" });
  appendHistory({ kind: "quiz", label: "which var", detail: "Correct", xpAwarded: 25, correct: true });
  await flushHistory();

  const entries = await readHistory();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].label, "ls -lah");
  assert.equal(entries[0].bin, "ls");
  assert.ok(entries[0].at && entries[0].day, "every entry is dated and day-stamped");
  assert.equal(entries[1].correct, true);
});

test("concurrent appends do not interleave into an unreadable line", async () => {
  const before = (await readHistory()).length;
  for (let i = 0; i < 50; i++) {
    appendHistory({ kind: "command", label: `cmd-${i}`, detail: "x".repeat(200), xpAwarded: 1 });
  }
  await flushHistory();
  const after = await readHistory();
  assert.equal(after.length, before + 50, "every line parsed");
});

test("a corrupt line costs only itself", async () => {
  await fs.appendFile(historyPath(), "{ half a line\n", "utf8");
  appendHistory({ kind: "concept", label: "after the damage", detail: "still readable", xpAwarded: 0 });
  await flushHistory();
  const entries = await readHistory();
  assert.ok(entries.some((e) => e.label === "after the damage"));
  assert.ok(entries.some((e) => e.label === "ls -lah"), "history before the bad line survives");
});

test("history survives a fresh import, which is the whole point", async () => {
  // A second module instance is the closest thing to a restart without a
  // subprocess: state in a module-level array would not be visible here.
  const fresh = await import(`../src/history.js?reload=${Date.now()}`);
  const entries = await fresh.readHistory();
  assert.ok(entries.length > 50);
  assert.ok(entries.some((e: { label: string }) => e.label === "ls -lah"));
});

test("summarising counts by kind and by day", async () => {
  const stats = summarise(await readHistory());
  assert.ok(stats.commands > 50);
  assert.equal(stats.quizzes, 1);
  assert.equal(stats.quizzesCorrect, 1);
  assert.equal(stats.days, 1, "all written today");
  assert.ok(stats.xp > 0);
  assert.ok(stats.firstAt && stats.lastAt);
});

test("graded reviews count toward quiz accuracy, session starts do not", () => {
  const stats = summarise([
    { at: "t", day: "2026-01-01", kind: "review", label: "session", detail: "started", xpAwarded: 0 },
    { at: "t", day: "2026-01-01", kind: "review", label: "q", detail: "ok", xpAwarded: 30, correct: true },
    { at: "t", day: "2026-01-01", kind: "review", label: "q2", detail: "miss", xpAwarded: 5, correct: false },
    { at: "t", day: "2026-01-01", kind: "quiz", label: "fresh", detail: "ok", xpAwarded: 25, correct: true },
  ]);
  assert.equal(stats.reviews, 1, "only the start line is a session");
  assert.equal(stats.quizzes, 3, "two reviews plus one first-sight");
  assert.equal(stats.quizzesCorrect, 2);
});

test("a since filter narrows to a session", async () => {
  const boundary = new Date().toISOString();
  appendHistory({ kind: "command", label: "after-boundary", detail: "x", xpAwarded: 1 });
  await flushHistory();
  const scoped = await readHistory({ since: boundary });
  assert.deepEqual(scoped.map((e) => e.label), ["after-boundary"]);
});

test("an unwritable history directory does not throw", async () => {
  const original = process.env.MIYAGI_HOME;
  const blocker = path.join(path.dirname(historyPath()), "blocker");
  await fs.writeFile(blocker, "x", "utf8");
  process.env.MIYAGI_HOME = path.join(blocker, "nested");
  appendHistory({ kind: "command", label: "into the void", detail: "x", xpAwarded: 0 });
  await flushHistory(); // must resolve, not reject
  assert.deepEqual(await readHistory(), [], "an unreadable log reads as empty");
  process.env.MIYAGI_HOME = original;
});
