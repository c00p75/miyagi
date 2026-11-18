/**
 * Concepts registered at runtime.
 *
 * A registered concept comes from a hand-edited file or from a model, and once
 * it is in, it is treated exactly like a built-in: detected, taught, quizzed
 * and scheduled for review. So the tests that matter are the ones about what
 * is turned away, that turning it away never throws, and that nothing a pack
 * says can replace a lesson the built-in rubric vouches for.
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CONCEPTS,
  CONCEPT_QUESTIONS,
  clearRegisteredConcepts,
  conceptBin,
  conceptById,
  conceptOrigin,
  detectConcepts,
  isBuiltInConcept,
  questionsForConcept,
  registerConcepts,
} from "../src/concepts.js";
import { allQuestions, ask, grade, questionById } from "../src/quiz.js";
import { UNSEEN, dojoRows, pickConceptQuestion } from "../src/teach.js";

const BUILT_IN_COUNT = CONCEPTS.length;
const BUILT_IN_QUESTIONS = CONCEPT_QUESTIONS.length;

afterEach(() => clearRegisteredConcepts());

const flag = (over: Record<string, unknown> = {}) => ({
  id: "feature-flag",
  title: "Feature flags",
  emoji: "🚩",
  weight: 65,
  files: "\\.(ts|tsx|py)$",
  patterns: ["\\bisEnabled\\(\\s*[\"']", "\\bflags\\.get\\("],
  hook: "A light switch for code that is already deployed.",
  what: "A setting checked while the program runs that decides whether a piece of new behaviour is on.",
  lens: {
    Junior: "The new code ships switched off, and a setting turns it on later without another deploy.",
    Mid: "A flag is a branch in production. Both sides have to keep working until the flag is removed.",
    Senior: "Every flag is debt with an owner and a removal date, or it becomes a permanent second code path.",
  },
  pitfall: "The flag is left in for a year. Nobody remembers which side is live, and a clean-up deletes the wrong one.",
  askTheAi: "What turns this flag on, and what happens to requests that are halfway through when it flips?",
  docs: { label: "Feature Toggles", url: "https://martinfowler.com/articles/feature-toggles.html" },
  questions: [
    {
      question: "A feature has been fully rolled out behind a flag for six months. What should happen to the flag?",
      answer: "It is removed, along with the old path",
      distractors: [
        "It stays for good, in case the feature ever needs to be switched off again",
        "It is renamed, so that newer flags do not collide with it later on",
      ],
      explanation: "A finished flag is a dead branch that still has to be read, tested and reasoned about.",
    },
    {
      question: "Why is a flag check in the browser not enough to hide an unfinished admin feature?",
      answer: "The endpoint behind it still answers",
      distractors: [
        "Browsers cache flag values for a full day before they check again",
        "Flags only work in server components and are ignored in client ones",
        "The check runs after the page has already been drawn on the screen",
      ],
      explanation: "Hiding a button hides nothing. The server has to check the same flag before doing the work.",
      level: "Mid",
    },
  ],
  ...over,
});

const reasonFor = (def: unknown): string => {
  const res = registerConcepts([def], "test");
  assert.deepEqual(res.added, [], "a definition that should be rejected was registered");
  assert.equal(res.rejected.length, 1);
  return res.rejected[0].reason;
};

/* ---- the happy path, end to end ---- */

test("a registered concept is detected, found, quizzed and shown in the dojo", () => {
  const res = registerConcepts([flag()], "pack:flags.json");
  assert.deepEqual(res, { added: ["feature-flag"], rejected: [] });

  const concept = conceptById("feature-flag");
  assert.equal(concept?.title, "Feature flags");
  assert.equal(concept?.weight, 65);
  assert.equal(conceptOrigin("feature-flag"), "pack:flags.json");
  assert.equal(isBuiltInConcept("feature-flag"), false);
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT + 1);

  const hits = detectConcepts("src/checkout.ts", 'if (isEnabled("new-checkout")) {');
  assert.deepEqual(hits.map((h) => h.id), ["feature-flag"]);
  // The `files` filter is honoured, and it is case-insensitive like the patterns.
  assert.deepEqual(detectConcepts("notes.md", 'isEnabled("x")'), []);
  assert.ok(detectConcepts("SRC/A.TS", 'ISENABLED("x")').some((h) => h.id === "feature-flag"));

  const questions = questionsForConcept("feature-flag");
  assert.deepEqual(questions.map((q) => q.id), ["c-feature-flag-1", "c-feature-flag-2"]);
  assert.deepEqual(questions[0].bins, [conceptBin("feature-flag")]);
  assert.equal(questions[0].level, "Junior", "a question with no level is a Junior one");
  assert.equal(questions[1].level, "Mid");
  assert.equal(questions[0].choices[0], questions[0].answer);
  assert.equal(questions[1].choices.length, 4);

  assert.equal(questionById("c-feature-flag-2")?.answer, "The endpoint behind it still answers");
  assert.ok(allQuestions().some((q) => q.id === "c-feature-flag-1"));
  assert.equal(pickConceptQuestion("feature-flag", "Mid", [])?.id, "c-feature-flag-2");

  const asked = ask(questions[0], questions[0].bins[0], { salt: "s" });
  assert.equal(grade(asked, questions[0].answer).correct, true);

  assert.ok(dojoRows(() => UNSEEN).some((r) => JSON.stringify(r).includes("Feature flags")));
});

test("optional fields fall back to sensible defaults", () => {
  const res = registerConcepts(
    [
      {
        id: "house-rule",
        title: "Our money rule",
        hook: "Money is never a float here.",
        what: "Amounts are whole numbers of the smallest unit, never decimals.",
        lens: "Store pence, not pounds. Decimals drift, and a penny lost per order adds up to an audit.",
        pitfall: "0.1 + 0.2 is not 0.3, and the invoice total is a penny out.",
      },
    ],
    "ai",
  );
  assert.deepEqual(res.added, ["house-rule"]);
  const c = conceptById("house-rule")!;
  assert.equal(c.emoji, "💡");
  assert.equal(c.weight, 50);
  assert.equal(c.files, null);
  assert.deepEqual(c.patterns, []);
  assert.equal(c.lens.Junior, c.lens.Senior, "one lens text serves every depth");
  assert.ok(c.askTheAi.endsWith("?"));
  assert.equal(c.docs.label, "Search the docs");
  assert.match(c.docs.url, /^https:\/\/.+Our%20money%20rule$/);
  assert.deepEqual(questionsForConcept("house-rule"), []);
  // No patterns means it is never claimed from a diff, whatever the diff says.
  assert.ok(!detectConcepts("a.ts", "Our money rule: store pence").some((h) => h.id === "house-rule"));
  assert.equal(conceptOrigin("house-rule"), "ai");
});

test("weight is clamped rather than refused", () => {
  registerConcepts([flag({ id: "too-heavy", weight: 900 }), flag({ id: "too-light", weight: -5 })], "test");
  assert.equal(conceptById("too-heavy")?.weight, 100);
  assert.equal(conceptById("too-light")?.weight, 0);
});

/* ---- replacement and protection ---- */

test("registering the same id again replaces the concept and its questions", () => {
  registerConcepts([flag()], "pack:a.json");
  const res = registerConcepts(
    [flag({ title: "Feature flags, revised", questions: [flag().questions[0]] })],
    "pack:b.json",
  );
  assert.deepEqual(res.added, ["feature-flag"]);
  assert.equal(conceptById("feature-flag")?.title, "Feature flags, revised");
  assert.equal(conceptOrigin("feature-flag"), "pack:b.json");
  assert.equal(CONCEPTS.filter((c) => c.id === "feature-flag").length, 1, "the old concept is still listed");
  assert.deepEqual(questionsForConcept("feature-flag").map((q) => q.id), ["c-feature-flag-1"]);
  assert.equal(questionById("c-feature-flag-2"), undefined, "a question from the replaced version survived");
});

test("the same id twice in one call registers once, with the later definition", () => {
  const res = registerConcepts([flag(), flag({ title: "Second" })], "test");
  assert.deepEqual(res.added, ["feature-flag"]);
  assert.equal(conceptById("feature-flag")?.title, "Second");
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT + 1);
});

test("a failed replacement leaves the earlier registration alone", () => {
  registerConcepts([flag()], "pack:a.json");
  const res = registerConcepts([flag({ title: "" })], "pack:b.json");
  assert.equal(res.rejected.length, 1);
  assert.equal(conceptById("feature-flag")?.title, "Feature flags");
  assert.equal(conceptOrigin("feature-flag"), "pack:a.json");
  assert.equal(questionsForConcept("feature-flag").length, 2);
});

test("a built-in can never be shadowed", () => {
  const before = conceptById("hardcoded-secret")!;
  const reason = reasonFor(flag({ id: "hardcoded-secret", title: "Secrets are fine, actually" }));
  assert.match(reason, /built-in/);
  assert.equal(conceptById("hardcoded-secret"), before);
  assert.equal(isBuiltInConcept("hardcoded-secret"), true);
  assert.equal(conceptOrigin("hardcoded-secret"), null);
  assert.equal(conceptOrigin("no-such-thing"), null);
  assert.equal(isBuiltInConcept("no-such-thing"), false);
});

test("clearing removes every registered concept and question, and nothing built in", () => {
  registerConcepts([flag(), flag({ id: "second-flag" })], "test");
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT + 2);
  assert.equal(CONCEPT_QUESTIONS.length, BUILT_IN_QUESTIONS + 4);

  clearRegisteredConcepts();
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT);
  assert.equal(CONCEPT_QUESTIONS.length, BUILT_IN_QUESTIONS);
  assert.equal(conceptById("feature-flag"), undefined);
  assert.equal(conceptOrigin("second-flag"), null);
  assert.equal(questionById("c-feature-flag-1"), undefined);
  assert.deepEqual(detectConcepts("a.ts", 'isEnabled("x")'), []);
  assert.ok(conceptById("react-state"), "a built-in was cleared");
});

/* ---- each way a definition is refused ---- */

test("a missing or malformed id is rejected as unknown", () => {
  for (const id of [undefined, "", "ab", "Has-Capitals", "has space", "trailing-", "double--hyphen", "x".repeat(61), 42]) {
    const res = registerConcepts([flag({ id })], "test");
    assert.deepEqual(res.added, [], `accepted id ${String(id)}`);
    assert.equal(res.rejected[0].id, "(unknown)");
    assert.match(res.rejected[0].reason, /id must be/);
  }
});

test("required text is rejected when missing, empty or over its cap", () => {
  const caps: Array<[string, number]> = [
    ["title", 80],
    ["hook", 200],
    ["what", 400],
    ["pitfall", 500],
  ];
  for (const [field, max] of caps) {
    assert.match(reasonFor(flag({ [field]: undefined })), new RegExp(`${field} is missing`));
    assert.match(reasonFor(flag({ [field]: "   " })), new RegExp(`${field} is empty`));
    assert.match(reasonFor(flag({ [field]: "x".repeat(max + 1) })), new RegExp(`${field} is longer than ${max}`));
    assert.deepEqual(registerConcepts([flag({ [field]: "x".repeat(max) })], "test").added, ["feature-flag"]);
  }
});

test("a lens must be one text or all three depths, each within its cap", () => {
  assert.match(reasonFor(flag({ lens: undefined })), /lens is missing/);
  assert.match(reasonFor(flag({ lens: ["a", "b", "c"] })), /lens is missing/);
  assert.match(reasonFor(flag({ lens: { Junior: "only this one" } })), /lens\.Mid is missing/);
  assert.match(reasonFor(flag({ lens: "x".repeat(701) })), /lens is longer than 700/);
  assert.match(
    reasonFor(flag({ lens: { Junior: "a", Mid: "b", Senior: "x".repeat(701) } })),
    /lens\.Senior is longer than 700/,
  );
});

test("patterns are capped, must compile, and must not fire on everything", () => {
  assert.match(reasonFor(flag({ patterns: "not-a-list" })), /patterns must be a list/);
  assert.match(reasonFor(flag({ patterns: Array(9).fill("\\bfoo\\(") })), /more than 8 patterns/);
  assert.match(reasonFor(flag({ patterns: ["\\bok\\(", "x".repeat(301)] })), /pattern 2 is longer than 300/);
  assert.match(reasonFor(flag({ patterns: ["(unclosed"] })), /pattern 1 does not compile/);
  assert.match(reasonFor(flag({ patterns: [42] })), /pattern 1 is not a regular expression/);
  assert.match(reasonFor(flag({ patterns: [".*"] })), /pattern 1 matches an empty line/);
  assert.match(reasonFor(flag({ patterns: ["(a+)+$"] })), /pattern 1 repeats a group/);
  assert.match(reasonFor(flag({ files: "[" })), /files does not compile/);
  assert.deepEqual(registerConcepts([flag({ patterns: Array(8).fill("\\bfoo\\(") })], "test").added, ["feature-flag"]);
});

test("patterns are compiled case-insensitively and never statefully", () => {
  registerConcepts([flag({ patterns: ["\\bflagon\\("] })], "test");
  const c = conceptById("feature-flag")!;
  assert.equal(c.patterns[0].flags, "i");
  assert.equal(c.files?.flags, "i");
  // A sticky or global pattern would match every other line.
  const hits = detectConcepts("a.ts", "flagOn(1)\nflagOn(2)\nflagOn(3)");
  assert.equal(hits[0].count, 3);
});

test("a docs link must be https", () => {
  assert.match(reasonFor(flag({ docs: { label: "x", url: "http://example.com" } })), /https/);
  assert.match(reasonFor(flag({ docs: { label: "x", url: "javascript:alert(1)" } })), /https/);
  assert.match(reasonFor(flag({ docs: { label: "x", url: "not a url" } })), /not a URL/);
  assert.match(reasonFor(flag({ docs: "https://example.com" })), /docs must be an object/);
  registerConcepts([flag({ docs: { url: "https://example.com/flags" } })], "test");
  assert.equal(conceptById("feature-flag")?.docs.label, "Search the docs");
});

test("emoji and weight are refused when they are the wrong kind of thing", () => {
  assert.match(reasonFor(flag({ weight: "heavy" })), /weight is not a number/);
  assert.match(reasonFor(flag({ weight: Number.NaN })), /weight is not a number/);
  assert.match(reasonFor(flag({ emoji: 7 })), /emoji is not text/);
  assert.match(reasonFor(flag({ emoji: "not an emoji at all" })), /emoji is longer/);
});

const question = (over: Record<string, unknown> = {}) => ({ ...flag().questions[0], ...over });

test("questions are held to the mechanical parts of the bank's rubric", () => {
  const withQ = (q: unknown) => flag({ questions: [flag().questions[1], q] });

  assert.match(reasonFor(withQ("what?")), /question 2 is not an object/);
  assert.match(reasonFor(withQ(question({ question: "Why?" }))), /question 2: question is too short/);
  assert.match(reasonFor(withQ(question({ question: "x".repeat(301) }))), /question 2: question is longer than 300/);
  assert.match(reasonFor(withQ(question({ answer: "x".repeat(201) }))), /question 2: answer is longer than 200/);
  assert.match(reasonFor(withQ(question({ explanation: "Because." }))), /explanation is too short/);
  assert.match(reasonFor(withQ(question({ explanation: "x".repeat(501) }))), /explanation is longer than 500/);
  assert.match(reasonFor(withQ(question({ level: "Wizard" }))), /level must be/);
  assert.match(reasonFor(withQ(question({ distractors: "one" }))), /distractors must be a list/);
  assert.match(reasonFor(withQ(question({ distractors: ["only one wrong choice"] }))), /needs 2 to 4 distractors/);
  assert.match(reasonFor(withQ(question({ distractors: ["a1", "b2", "c3", "d4", "e5"] }))), /needs 2 to 4 distractors/);
  assert.match(
    reasonFor(withQ(question({ distractors: ["fine", "x".repeat(201)] }))),
    /question 2: distractor 2 is longer than 200/,
  );
  assert.match(
    reasonFor(withQ(question({ question: "The correct answer is B. Which letter comes after A?" }))),
    /gives its own answer away/,
  );

  // The answer hiding among the wrong choices, in any letter case.
  assert.match(
    reasonFor(withQ(question({ answer: "Remove it", distractors: ["Keep it forever", "remove it "] }))),
    /also listed as a distractor/,
  );
  assert.match(
    reasonFor(withQ(question({ distractors: ["Keep it for good", "keep it for good", "Rename the flag"] }))),
    /two choices are the same/,
  );
});

test("an answer that can be picked by length alone is rejected, at the 40% line", () => {
  const withAnswer = (answer: string) =>
    flag({ questions: [question({ answer, distractors: ["x".repeat(20), "y".repeat(10)] })] });

  // 28 characters is exactly 40% over the longest distractor: allowed.
  assert.deepEqual(registerConcepts([withAnswer("a".repeat(28))], "test").added, ["feature-flag"]);
  assert.match(reasonFor(withAnswer("a".repeat(29))), /much longer than every other choice/);
  // A short answer among long distractors is the shape the built-in bank uses.
  assert.deepEqual(registerConcepts([withAnswer("short")], "test").added, ["feature-flag"]);
});

test("one bad question rejects the whole concept, so no lesson is half-registered", () => {
  const res = registerConcepts([flag({ questions: [flag().questions[0], question({ explanation: "" })] })], "test");
  assert.deepEqual(res.added, []);
  assert.equal(res.rejected[0].id, "feature-flag");
  assert.equal(conceptById("feature-flag"), undefined);
  assert.equal(CONCEPT_QUESTIONS.length, BUILT_IN_QUESTIONS);
});

/* ---- hostile input ---- */

test("input that is not a concept at all is rejected without throwing", () => {
  const junk: unknown[] = [null, undefined, 42, "a string", true, [], [flag()], () => flag(), Symbol("x"), 10n];
  const res = registerConcepts(junk, "test");
  assert.deepEqual(res.added, []);
  assert.equal(res.rejected.length, junk.length);
  for (const r of res.rejected) {
    assert.equal(r.id, "(unknown)");
    assert.ok(r.reason.length > 0);
  }
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT);

  // Not even a list.
  for (const notAList of [null, undefined, "x", { length: 3 }, 7]) {
    assert.deepEqual(registerConcepts(notAList as unknown as unknown[], "test"), { added: [], rejected: [] });
  }
});

test("an object that throws when read is rejected, not fatal", () => {
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error("boom");
      },
    },
  );
  const lazy = {
    ...flag(),
    get title(): string {
      throw new Error("boom");
    },
  };
  const res = registerConcepts([trap, lazy, flag({ id: "survivor" })], "test");
  assert.deepEqual(res.added, ["survivor"], "one hostile definition hid a good one");
  assert.equal(res.rejected.length, 2);
  assert.match(res.rejected[1].reason, /could not be read/);
});

test("huge strings and control characters do not get through", () => {
  const huge = "x".repeat(2_000_000);
  const started = Date.now();
  for (const field of ["id", "title", "hook", "what", "lens", "pitfall", "askTheAi", "files"]) {
    assert.deepEqual(registerConcepts([flag({ [field]: huge })], "test").added, [], `accepted a huge ${field}`);
  }
  assert.deepEqual(registerConcepts([flag({ patterns: [huge] })], "test").added, []);
  assert.deepEqual(registerConcepts([flag({ questions: Array(500).fill(flag().questions[0]) })], "test").added, []);
  assert.ok(Date.now() - started < 3000, "rejecting hostile input should be quick");

  registerConcepts([flag({ title: "Feature\u0000 flags\u001b[31m", hook: "line one\nline two" })], huge);
  const c = conceptById("feature-flag")!;
  assert.ok(!/[\u0000-\u001f]/.test(c.title + c.hook), "control characters reached a card");
  assert.ok((conceptOrigin("feature-flag") ?? "").length <= 120, "the origin label is unbounded");
});

test("a registered pattern cannot make detection claim a secret as evidence", () => {
  registerConcepts([flag({ files: null, patterns: ["\\bapi_key\\b"] })], "test");
  const key = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0";
  const hits = detectConcepts("config.py", `api_key = "${key}"`);
  assert.ok(hits.some((h) => h.id === "feature-flag"));
  assert.ok(!JSON.stringify(hits).includes(key), "evidence from a registered concept skipped the scrub");
});
