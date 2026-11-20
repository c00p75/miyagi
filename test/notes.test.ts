/**
 * The lessons in the notes export.
 *
 * The export promises the whole explanation for everything on record. These
 * tests hold it to that, and to the two ways it could go wrong quietly:
 * repeating a lesson once per run of a command, and inventing a lesson for a
 * command the pack knows nothing about.
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { commandLessons, conceptLessons, lessonSections } from "../src/notes.js";
import { clearRegisteredConcepts, conceptById, registerConcepts } from "../src/concepts.js";
import { contentFor, lensFor } from "../src/content.js";
import type { HistoryEntry, HistoryKind } from "../src/history.js";

afterEach(() => clearRegisteredConcepts());

const entry = (kind: HistoryKind, label: string, bin?: string): HistoryEntry => ({
  at: "2026-01-01T00:00:00.000Z",
  day: "2026-01-01",
  kind,
  label,
  detail: "",
  xpAwarded: 0,
  bin,
});

test("each distinct command is explained once, at the learner's depth", () => {
  const entries = [
    entry("command", "git status", "git"),
    entry("command", "ls -la", "ls"),
    entry("command", "git commit -m 'x'", "git"),
    entry("command", "git push", "git"),
  ];
  const junior = commandLessons(entries, "Junior").join("\n");
  assert.match(junior, /^## What each command does$/m);
  assert.equal(junior.match(/^### `git`/gm)?.length, 1, "git was practised three times and explained other than once");
  assert.ok(junior.indexOf("### `git`") < junior.indexOf("### `ls`"), "lessons are not in the order they were met");

  assert.ok(junior.includes(contentFor("git").content!.summary));
  assert.ok(junior.includes(lensFor("git", "Junior").what));
  assert.ok(junior.includes(lensFor("git", "Junior").tradeoffs));
  for (const pitfall of contentFor("ls").content!.pitfalls) assert.ok(junior.includes(pitfall));
  assert.match(junior, /Read more: \[.+\]\(https:\/\//);

  const senior = commandLessons(entries, "Senior").join("\n");
  assert.ok(senior.includes(lensFor("git", "Senior").what));
  assert.ok(!senior.includes(lensFor("git", "Junior").what), "the Junior lesson was exported to a Senior learner");
});

test("a command with no lesson in the pack is named and nothing is invented for it", () => {
  const entries = [entry("command", "frobnicate --all", "frobnicate"), entry("command", "ls", "ls")];
  assert.equal(contentFor("frobnicate").content, null, "the test needs a command the pack does not cover");

  const text = commandLessons(entries, "Mid").join("\n");
  assert.match(text, /Also practised, with no lesson in the pack: `frobnicate`\./);
  assert.ok(!/### `frobnicate`/.test(text), "an uncovered command was given a heading");
  // The generic lens is what a card falls back on. It must not be passed off as a lesson here.
  assert.ok(!text.includes(lensFor("frobnicate", "Mid").what), "the generic shell lens was exported as a lesson");
});

test("the binary is worked out from the command when the log did not record one", () => {
  const text = commandLessons([entry("command", "sudo ls -la /var")], "Junior").join("\n");
  assert.match(text, /^### `ls`/m);
});

test("only commands count as practised", () => {
  const text = commandLessons(
    [entry("quiz", "What does ls do?", "ls"), entry("concept", "Suggested command", "git"), entry("config", "mode")],
    "Junior",
  ).join("\n");
  assert.match(text, /No commands recorded/);
  assert.ok(!/###/.test(text));
});

test("each idea met in code is explained once, with what it is, the lens and how it bites", () => {
  const entries = [
    entry("concept", "React state", "concept:react-state"),
    entry("concept", "SQL built by gluing strings together", "concept:sql-interpolation"),
    entry("concept", "React state", "concept:react-state"),
    // Roadmap events share the kind and are not ideas.
    entry("concept", "Roadmap set: Git and GitHub"),
    entry("concept", "Suggested command", "git"),
    // A quiz about an idea is not a sighting of it.
    entry("quiz", "Why is this dangerous?", "concept:cors"),
  ];
  const state = conceptById("react-state")!;
  const sql = conceptById("sql-interpolation")!;

  const mid = conceptLessons(entries, "Mid").join("\n");
  assert.match(mid, /^## Ideas met in your code$/m);
  assert.equal(mid.match(/^### /gm)?.length, 2);
  for (const c of [state, sql]) {
    assert.ok(mid.includes(`### ${c.emoji} ${c.title}`));
    assert.ok(mid.includes(c.what));
    assert.ok(mid.includes(c.lens.Mid));
    assert.ok(mid.includes(`**How it bites.** ${c.pitfall}`));
    assert.ok(mid.includes(c.docs.url));
    assert.ok(!mid.includes(c.lens.Senior), "more than one depth was exported");
  }
  assert.ok(!/Roadmap set|Suggested command|CORS/.test(mid));

  assert.ok(conceptLessons(entries, "Senior").join("\n").includes(sql.lens.Senior));
});

test("an idea from a pack is exported like a built-in, and named plainly once its pack is gone", () => {
  registerConcepts(
    [
      {
        id: "money-rule",
        title: "Money is whole pence",
        hook: "Money is never a float here.",
        what: "Amounts are whole numbers of the smallest unit, never decimals.",
        lens: "Store pence, not pounds. Decimals drift, and the drift lands on an invoice.",
        pitfall: "0.1 + 0.2 is not 0.3, and the total is a penny out.",
      },
    ],
    "pack:team.json",
  );
  const entries = [entry("concept", "Money is whole pence", "concept:money-rule")];

  const loaded = conceptLessons(entries, "Junior").join("\n");
  assert.match(loaded, /### 💡 Money is whole pence/);
  assert.match(loaded, /Store pence, not pounds/);

  clearRegisteredConcepts();
  const gone = conceptLessons(entries, "Junior").join("\n");
  assert.ok(!/###/.test(gone), "a lesson was written for an idea that is no longer loaded");
  assert.match(gone, /no longer loaded: Money is whole pence\./);
});

test("an empty history still yields both sections, each saying so", () => {
  const text = lessonSections([], "Junior").join("\n");
  assert.match(text, /## What each command does\n\n_No commands recorded/);
  assert.match(text, /## Ideas met in your code\n\n_No ideas recorded/);
  assert.ok(text.endsWith("\n") || lessonSections([], "Junior").at(-1) === "", "the next section would run into this one");
});
