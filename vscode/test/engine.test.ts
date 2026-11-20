/**
 * The panel's engine against a scratch profile: a change becomes a card, the
 * card's question is graded with the server's numbers, and what is written to
 * disk is the same profile the MCP server reads.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectConcepts } from "../../src/concepts.js";
import * as engine from "../src/engine.js";

let home = "";
let work = "";

const SOURCE = [
  'import bcrypt from "bcrypt";',
  "export async function register(password: string) {",
  "  const hash = await bcrypt.hash(password, 12);",
  "  return hash;",
  "}",
].join("\n");

before(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-vscode-"));
  home = path.join(root, "home");
  work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(path.join(work, "auth.ts"), SOURCE);
  process.env.MIYAGI_HOME = home;
});

after(() => fs.rm(path.dirname(home), { recursive: true, force: true }));

const changes = () => [{ file: "auth.ts", concepts: detectConcepts("auth.ts", SOURCE) }];

test("a change that uses an idea becomes one card, and seeing it pays nothing", async () => {
  const lesson = await engine.teach({ changes: changes(), root: work, source: "auth.ts", limit: 2 });
  assert.ok(lesson, "expected a lesson");
  const card = lesson.cards.find((c) => c.conceptId === "password-hashing");
  assert.ok(card, "expected the password hashing card");
  assert.equal(card.status, "new");
  assert.equal(card.file, "auth.ts");
  assert.equal(card.hasQuiz, true);
  assert.ok(lesson.discovered >= 1);
  assert.equal(lesson.xpAwarded, 0, "XP is for recall, not for an idea appearing");

  const status = await engine.status();
  assert.equal(status.xp, lesson.xpAwarded);
  assert.ok(status.discovered >= 1);
});

test("the same idea is not carded twice in one sitting, unless asked for", async () => {
  assert.equal(await engine.teach({ changes: changes(), root: work, source: "auth.ts", limit: 2 }), null);
  const again = await engine.teach({ changes: changes(), root: work, source: "auth.ts", limit: 2, repeat: true });
  assert.ok(again);
  assert.equal(again.cards[0].status, "learning");
  assert.equal(again.xpAwarded, 0, "an idea already seen pays nothing for being seen again");
});

test("a correct answer pays 25 XP, moves the belt and is saved to the shared profile", async () => {
  const before = (await engine.status()).xp;
  const quiz = await engine.quizForConcept("password-hashing");
  assert.ok(quiz);
  assert.equal(quiz.review, false);
  // The engine never sends the answer to the panel; find it the way a learner cannot.
  const { questionById } = await import("../../src/quiz.js");
  const id = engine.questionIdFor(quiz.token);
  assert.ok(id);
  const right = quiz.choices.indexOf(questionById(id)!.answer);
  const result = await engine.answer(quiz.token, right);
  assert.ok(result);
  assert.equal(result.correct, true);
  assert.equal(result.answerIndex, right);
  assert.equal(result.xpAwarded, 25);
  assert.equal(result.belt, "Yellow");
  assert.ok(result.nextDueAt && Date.parse(result.nextDueAt) > Date.now());
  assert.equal((await engine.status()).xp, before + 25);

  const saved = JSON.parse(await fs.readFile(path.join(home, "profile.json"), "utf8"));
  const item = saved.review.find((r: { id: string }) => r.id === `quiz:${id}`);
  assert.equal(item.box, 1);
  assert.equal(saved.player.xp, before + 25);

  // A token is single use.
  assert.equal(await engine.answer(quiz.token, right), null);
});

test("a wrong answer resets the streak, pays 5 and brings the question back", async () => {
  const quiz = await engine.quizForConcept("password-hashing");
  assert.ok(quiz);
  const { questionById } = await import("../../src/quiz.js");
  const right = quiz.choices.indexOf(questionById(engine.questionIdFor(quiz.token)!)!.answer);
  const wrong = (right + 1) % quiz.choices.length;
  const result = await engine.answer(quiz.token, wrong);
  assert.ok(result);
  assert.equal(result.correct, false);
  assert.equal(result.xpAwarded, 5);
  assert.equal(result.quizStreak, 0);
  assert.equal(result.belt, "White");
});

test("the dojo lists every concept and marks what has been found", async () => {
  const rows = await engine.dojo();
  const hashing = rows.find((r) => r.id === "password-hashing");
  assert.ok(hashing?.seen);
  assert.ok(rows.some((r) => !r.seen));
  assert.equal(rows[0].seen, true, "found ideas sort first");
});

test("depth is shared with the server through the profile", async () => {
  await engine.setDepth("Senior");
  assert.equal((await engine.status()).depth, "Senior");
  const saved = JSON.parse(await fs.readFile(path.join(home, "profile.json"), "utf8"));
  assert.equal(saved.settings.skillLevel, "Senior");
});

test("the excerpt carries real line numbers around the matching lines", async () => {
  const excerpt = await engine.excerptFor("password-hashing", work, "auth.ts");
  assert.ok(excerpt);
  assert.match(excerpt, /^1: import bcrypt/m);
  assert.match(excerpt, /^3: {3}const hash = await bcrypt\.hash/m);
  assert.equal(await engine.excerptFor("password-hashing", work, "missing.ts"), null);
});

test("a secret never reaches the excerpt", async () => {
  const leaked = 'const apiKey = "sk_live_abcdefghijklmnop1234";\nfetch(url, { headers: { key: apiKey } });';
  await fs.writeFile(path.join(work, "pay.ts"), leaked);
  const excerpt = await engine.excerptFor("hardcoded-secret", work, "pay.ts");
  assert.ok(excerpt);
  assert.doesNotMatch(excerpt, /sk_live_abcdefghijklmnop1234/);
  assert.match(excerpt, /line withheld/);
});

test("known commands come with their built-in lesson", () => {
  const info = engine.commandInfo("git status", "Junior");
  assert.ok(info);
  assert.equal(info.bin, "git");
  assert.equal(engine.commandInfo("some-unknown-tool --flag", "Junior"), null);
});
