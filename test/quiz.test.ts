/**
 * The quiz engine.
 *
 * The failure this suite exists to prevent is the old one: a learner who sees
 * the same question every time and starts answering by remembering the letter
 * rather than the concept. So: no duplicate ids, choices that move between
 * askings, and selection that respects both topic and recency.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { QUIZ_BANK, pickQuestion, ask, grade, shuffleChoices, questionById } = await import(
  "../src/quiz.js"
);

test("the bank is well formed", () => {
  const ids = new Set<string>();
  for (const q of QUIZ_BANK) {
    assert.ok(q.id && !ids.has(q.id), `duplicate or missing id: ${q.id}`);
    ids.add(q.id);
    assert.ok(q.question.trim().length > 10, `question too short: ${q.id}`);
    assert.ok(q.explanation.trim().length > 10, `explanation too short: ${q.id}`);
    assert.equal(new Set(q.choices).size, q.choices.length, `duplicate choices: ${q.id}`);
    assert.ok(q.choices.includes(q.answer), `answer is not among the choices: ${q.id}`);
    assert.ok(q.choices.length >= 3, `too few choices: ${q.id}`);
    assert.ok(["Junior", "Mid", "Senior"].includes(q.level));
  }
  assert.ok(QUIZ_BANK.length >= 30, "a bank small enough to memorise is not a bank");
});

test("the bank covers the commands the roadmaps teach", () => {
  const covered = new Set(QUIZ_BANK.flatMap((q) => q.bins));
  for (const bin of ["git", "docker", "npm", "curl", "rm", "chmod", "kubectl", "terraform"]) {
    assert.ok(covered.has(bin), `nothing topical to ask about ${bin}`);
  }
});

test("a command with topical questions gets one of them", () => {
  for (const bin of ["git", "docker", "npm"]) {
    const q = pickQuestion({ bin, skillLevel: "Senior", recentIds: [] });
    assert.ok(q.bins.includes(bin), `${bin} got an unrelated question: ${q.id}`);
  }
});

test("a Junior is not asked Senior questions while Junior ones remain", () => {
  const q = pickQuestion({ bin: "git", skillLevel: "Junior", recentIds: [] });
  assert.notEqual(q.level, "Senior");
});

test("recently asked questions are avoided", () => {
  const seen: string[] = [];
  // Twelve consecutive pulls for the same command must not repeat while the
  // bank still has anything unasked.
  for (let i = 0; i < 12; i++) {
    const q = pickQuestion({ bin: "git", skillLevel: "Senior", recentIds: seen, salt: String(i) });
    assert.ok(!seen.includes(q.id), `repeated ${q.id} after ${seen.length} questions`);
    seen.push(q.id);
  }
});

test("selection still returns something once everything has been asked", () => {
  const all = QUIZ_BANK.map((q) => q.id);
  const q = pickQuestion({ bin: "git", skillLevel: "Junior", recentIds: all });
  assert.ok(questionById(q.id), "a repeat beats no question at all");
});

test("choice order moves between askings, and holds within one", () => {
  const q = questionById("sh-exit-var")!;
  const a = shuffleChoices(q.choices, "salt-a");
  const b = shuffleChoices(q.choices, "salt-b");
  assert.deepEqual([...a].sort(), [...q.choices].sort(), "shuffling loses nothing");
  assert.notDeepEqual(a, b, "a different salt gives a different order");
  assert.deepEqual(shuffleChoices(q.choices, "salt-a"), a, "the same salt is stable");
});

test("the answer is not always in the same slot", () => {
  const q = questionById("git-force-lease")!;
  const positions = new Set(
    Array.from({ length: 20 }, (_, i) => shuffleChoices(q.choices, `s${i}`).indexOf(q.answer)),
  );
  assert.ok(positions.size >= 3, `answer landed in only ${positions.size} distinct slots`);
});

test("grading accepts the letter as shuffled, not as authored", () => {
  const asked = ask(questionById("sh-exit-var")!, "git", { salt: "x" });
  const idx = asked.choices.indexOf(asked.answer);
  const letter = String.fromCharCode(65 + idx);
  assert.equal(grade(asked, letter).correct, true, "the correct letter for this asking");
  const wrong = String.fromCharCode(65 + ((idx + 1) % asked.choices.length));
  assert.equal(grade(asked, wrong).correct, false);
});

test("grading accepts the answer text, punctuation and case aside", () => {
  const asked = ask(questionById("sh-exit-var")!, "shell", { salt: "y" });
  assert.equal(grade(asked, "$?").correct, true);
  assert.equal(grade(asked, " $? ").correct, true);
  assert.equal(grade(asked, "$!").correct, false);
});

test("grading a prose answer matches on the answer text", () => {
  const asked = ask(questionById("git-force-lease")!, "git", { salt: "z" });
  assert.equal(grade(asked, asked.answer.toUpperCase()).correct, true);
  assert.equal(grade(asked, "no idea").correct, false);
  assert.equal(
    grade(asked, `I think the idea is: ${asked.answer}, in other words`).correct,
    true,
    "extra words around the official answer still count",
  );
});

test("an asking records what it was about", () => {
  const asked = ask(questionById("docker-latest")!, "docker", { review: true, salt: "1" });
  assert.equal(asked.bin, "docker");
  assert.equal(asked.review, true);
  assert.ok(Date.parse(asked.askedAt) > 0);
});
