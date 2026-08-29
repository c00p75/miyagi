/**
 * Model assistance.
 *
 * Sampling touches two dangerous places: it can change a learner's grade, and
 * it can put model-authored text into a card, into an id, and into a file on
 * disk. So these tests are mostly about what it is *not* allowed to do.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-sampling-"));

const {
  validateGenerated,
  firstJsonObject,
  loadGeneratedCache,
  generatedCachePath,
  bankCovers,
  samplingAvailable,
  gradeProse,
  generateQuestion,
  clearCache,
} = await import("../src/sampling.js");
const { clearGenerated, generatedCount, questionById, pickQuestion } = await import("../src/quiz.js");

const good = {
  question: "What does `git push --force-with-lease` refuse to do that `--force` will?",
  choices: [
    "Overwrite commits pushed since your last fetch",
    "Push tags along with commits",
    "Rewrite your local history",
    "Sign the push",
  ],
  answer: "Overwrite commits pushed since your last fetch",
  explanation: "It compares the remote ref against what you last saw, so it refuses when someone else has pushed.",
  level: "Mid",
};

test("JSON is found inside prose and code fences", () => {
  assert.deepEqual(firstJsonObject('Sure! ```json\n{"correct": true}\n``` hope that helps'), {
    correct: true,
  });
  assert.deepEqual(firstJsonObject('{"a": {"b": 1}} trailing text'), { a: { b: 1 } });
  assert.deepEqual(firstJsonObject('{"text": "a } brace inside a string"}'), {
    text: "a } brace inside a string",
  });
  assert.equal(firstJsonObject("no json at all"), null);
  assert.equal(firstJsonObject('{"unclosed": '), null);
});

test("a well-formed generated question is accepted and namespaced", () => {
  const q = validateGenerated(good, "git");
  assert.ok(q);
  assert.match(q.id, /^gen:git:/, "generated ids can never collide with the bank's");
  assert.deepEqual(q.bins, ["git"]);
  assert.equal(q.level, "Mid");
  assert.ok(q.choices.includes(q.answer));
});

test("the same question yields the same id, so cache and schedule stay stable", () => {
  assert.equal(validateGenerated(good, "git")?.id, validateGenerated(good, "git")?.id);
});

test("a question whose answer is not among the choices is rejected", () => {
  assert.equal(validateGenerated({ ...good, answer: "Something else entirely" }, "git"), null);
});

test("malformed, thin and self-answering questions are rejected", () => {
  const cases: Record<string, unknown> = {
    "too few choices": { ...good, choices: ["a", "b"] },
    "too many choices": { ...good, choices: ["a", "b", "c", "d", "e", "f", "g"] },
    "no explanation": { ...good, explanation: "because" },
    "stub question": { ...good, question: "What?" },
    "gives itself away": {
      ...good,
      question: "Which of these is it? The correct answer is the first one.",
    },
    "not an object": "just a string",
    "null": null,
    "duplicates collapse below the minimum": { ...good, choices: ["a", "a", "a"], answer: "a" },
  };
  for (const [label, bad] of Object.entries(cases)) {
    assert.equal(validateGenerated(bad, "git"), null, `should reject: ${label}`);
  }
});

test("control characters and path-shaped names are stripped, not stored", () => {
  // Built from char codes rather than written literally, so the test file
  // itself stays readable. An ANSI escape reaching a card would let
  // model-authored text repaint the reader's terminal.
  const ESC = String.fromCharCode(27);
  const controlChars = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]");

  const q = validateGenerated(
    {
      ...good,
      question: `What does ${ESC}[31mgit push --force-with-lease${ESC}[0m refuse to do?`,
    },
    "../../etc/passwd",
  );
  assert.ok(q);
  assert.ok(!controlChars.test(q.question), "no control characters reach a card");
  assert.equal(q.bins[0], "etcpasswd", "a path-shaped bin name cannot escape the id");
  assert.ok(!q.id.includes("/"), "and cannot become a path in the id");
});

test("a hand-edited cache file is re-validated on load", async () => {
  clearCache();
  clearGenerated();
  await fs.mkdir(path.dirname(generatedCachePath()), { recursive: true });
  await fs.writeFile(
    generatedCachePath(),
    JSON.stringify([
      { ...good, bins: ["git"] },
      { question: "junk", choices: [], answer: "", explanation: "" },
    ]),
    "utf8",
  );
  const loaded = await loadGeneratedCache();
  assert.equal(loaded, 1, "the junk entry is dropped and the good one kept");
  assert.equal(generatedCount(), 1);
});

test("a corrupt cache file loads as empty rather than failing", async () => {
  clearCache();
  clearGenerated();
  await fs.writeFile(generatedCachePath(), "{ not json", "utf8");
  assert.equal(await loadGeneratedCache(), 0);
  assert.equal(generatedCount(), 0);
});

test("generated questions join selection and are answerable like any other", async () => {
  clearCache();
  clearGenerated();
  await fs.writeFile(generatedCachePath(), JSON.stringify([{ ...good, bins: ["jq"] }]), "utf8");
  await loadGeneratedCache();

  const picked = pickQuestion({ bin: "jq", skillLevel: "Senior", recentIds: [] });
  assert.match(picked.id, /^gen:jq:/, "a generated question is preferred for its own command");
  assert.ok(questionById(picked.id), "and can be looked up when the answer comes back");
});

test("without a sampling-capable client, both helpers decline quietly", async () => {
  // No server attached here, which is the same shape as a client that does not
  // offer sampling: the deterministic path has to keep working regardless.
  assert.equal(samplingAvailable(), false);
  assert.equal(
    await gradeProse({
      question: "q",
      expected: "a",
      explanation: "e",
      given: "a long prose answer that would otherwise be judged",
    }),
    null,
  );
  assert.equal(
    await generateQuestion({ bin: "jq", command: "jq .", level: "Mid", topic: "t", avoid: [] }),
    null,
  );
});

test("the bank knows what it already covers, so generation is not asked for twice", () => {
  assert.equal(bankCovers("git"), true);
  assert.equal(bankCovers("GIT"), true);
  assert.equal(bankCovers("jq"), false, "generated questions do not count as bank coverage");
});
