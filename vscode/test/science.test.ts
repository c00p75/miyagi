/**
 * The learning-science features: recall with confidence, the extra review a
 * confident miss earns, mixed review, fading support, the transfer gate before
 * black belt, the unaided check, questions the learner writes, and the weekly
 * goal. Scratch MIYAGI_HOME, removed afterwards.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearRegisteredConcepts, conceptById, detectConcepts, questionsForConcept } from "../../src/concepts.js";
import { questionById } from "../../src/quiz.js";
import * as engine from "../src/engine.js";
import {
  calibration,
  calibrationVerdict,
  checkIsDue,
  emptyJournal,
  journalPath,
  mistakesForReview,
  normaliseJournal,
  recordAnswer,
  type Graded,
} from "../src/journal.js";
import { loadOwnCards, ownCardsPath, registerOwnQuestion } from "../src/ideas.js";
import { parseContrast, parseYourTurn, hintPrompt, transferQuestionPrompt } from "../src/prompts.js";
import { weekProgress } from "../src/reports.js";

let root = "";
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-science-"));
  process.env.MIYAGI_HOME = path.join(root, "home");
  engine.forgetSession();
  engine.resetReviewMix();
});
after(async () => {
  clearRegisteredConcepts();
  await fs.rm(root, { recursive: true, force: true });
});

const profile = async () => JSON.parse(await fs.readFile(path.join(process.env.MIYAGI_HOME!, "profile.json"), "utf8"));
const saveProfile = async (p: unknown) => fs.writeFile(path.join(process.env.MIYAGI_HOME!, "profile.json"), JSON.stringify(p));
/** Makes every scheduled question due now, optionally setting its box. */
async function rewind(box?: (ref: string) => number | undefined) {
  const p = await profile();
  for (const item of p.review) {
    item.dueAt = new Date(Date.now() - 60_000).toISOString();
    const b = box?.(item.ref);
    if (b !== undefined) item.box = b;
  }
  await saveProfile(p);
}
const rightIndex = (quiz: engine.QuizView) => quiz.choices.indexOf(questionById(engine.questionIdFor(quiz.token)!)!.answer);

/* ---- the journal, on its own ------------------------------------ */

const graded = (over: Partial<Graded>): Graded => ({
  question: "q1",
  concept: "password-hashing",
  about: "Storing passwords as hashes",
  prompt: "Why slow?",
  chosen: "To save disk",
  truth: "To make guessing expensive",
  why: "Each guess costs time.",
  confidence: "sure",
  correct: false,
  ...over,
});

test("a confident miss is owed one extra correct answer", () => {
  const miss = recordAnswer(emptyJournal(), graded({}));
  assert.equal(miss.confidentMiss, true);
  assert.deepEqual(miss.journal.owedReview, ["q1"]);
  assert.equal(miss.journal.mistakes[0].believed, "To save disk");
  assert.equal(miss.journal.mistakes[0].confident, true);

  const right = recordAnswer(miss.journal, graded({ correct: true, confidence: "think" }));
  assert.equal(right.repaysMiss, true, "the first correct answer pays the debt and does not advance");
  assert.deepEqual(right.journal.owedReview, []);
  const again = recordAnswer(right.journal, graded({ correct: true }));
  assert.equal(again.repaysMiss, false, "the second one moves on");

  const unsure = recordAnswer(emptyJournal(), graded({ confidence: "guess" }));
  assert.equal(unsure.confidentMiss, false, "a guess that misses is just a miss");
  assert.deepEqual(unsure.journal.owedReview, []);
  assert.equal(recordAnswer(emptyJournal(), graded({ confidence: null })).confidentMiss, false);
});

test("calibration needs enough answers before it says anything", () => {
  let j = emptyJournal();
  for (let i = 0; i < 4; i++) j = recordAnswer(j, graded({ question: `s${i}`, correct: true })).journal;
  assert.equal(calibration(j).find((r) => r.confidence === "sure")?.accuracy, null);
  assert.equal(calibrationVerdict(calibration(j)), null);
  for (let i = 4; i < 10; i++) j = recordAnswer(j, graded({ question: `s${i}`, correct: i < 6 })).journal;
  const sure = calibration(j).find((r) => r.confidence === "sure")!;
  assert.deepEqual([sure.answers, sure.correct, sure.accuracy], [10, 6, 0.6]);
  assert.match(calibrationVerdict(calibration(j)) ?? "", /right 60% of the time\. Feeling certain is not telling you much yet/);
  let good = emptyJournal();
  for (let i = 0; i < 10; i++) good = recordAnswer(good, graded({ question: `g${i}`, correct: i !== 0 })).journal;
  assert.match(calibrationVerdict(calibration(good)) ?? "", /can be trusted/);
});

test("the journal survives being hand-edited or truncated", () => {
  const j = normaliseJournal({
    answers: [{ at: "t", question: "q", correct: true, confidence: "certain" }, { nope: 1 }, "x"],
    owedReview: ["q", 4],
    mistakes: [{ at: "t", believed: "a", truth: "b" }, { at: "t" }],
    transfer: ["sql-interpolation", null],
    checks: [{ at: "t", asked: 10, correct: 12 }, { at: "t", asked: 0, correct: 0 }],
  });
  assert.equal(j.answers.length, 1);
  assert.equal(j.answers[0].confidence, null, "an unknown confidence is dropped, not kept");
  assert.deepEqual(j.owedReview, ["q"]);
  assert.equal(j.mistakes.length, 1);
  assert.deepEqual(j.transfer, ["sql-interpolation"]);
  assert.deepEqual(j.checks, [{ at: "t", asked: 10, correct: 10 }]);
  assert.deepEqual(normaliseJournal("garbage"), emptyJournal());
  assert.equal(checkIsDue(emptyJournal()), true);
  assert.equal(checkIsDue({ ...emptyJournal(), checks: [{ at: new Date().toISOString(), asked: 10, correct: 8 }] }), false);
  const sorted = mistakesForReview({
    ...emptyJournal(),
    mistakes: [
      { at: "2026-01-02", concept: null, about: "", question: "new", believed: "", truth: "", why: "", confident: false },
      { at: "2026-01-01", concept: null, about: "", question: "sure", believed: "", truth: "", why: "", confident: true },
    ],
  });
  assert.equal(sorted[0].question, "sure", "confident misses lead");
});

/* ---- through the engine ----------------------------------------- */

const SOURCE = [
  "const hash = await bcrypt.hash(password, 12);",
  "const [open, setOpen] = useState(false);",
  "useEffect(() => { load(); }, []);",
  "app.get('/users', handler);",
  "const key = process.env.API_KEY;",
].join("\n");

test("sure and wrong holds the belt on the next correct answer, and is written down", async () => {
  await engine.teach({ changes: [{ file: "app.tsx", concepts: detectConcepts("app.tsx", SOURCE) }], root, source: "app.tsx", limit: 9 });
  const first = (await engine.quizForConcept("password-hashing"))!;
  const right = rightIndex(first);
  const miss = await engine.answer(first.token, (right + 1) % first.choices.length, "sure");
  assert.equal(miss?.correct, false);
  assert.equal(miss?.confidentMiss, true);

  await rewind();
  const second = (await engine.quizForConcept("password-hashing"))!;
  const repaid = await engine.answer(second.token, rightIndex(second), "think");
  assert.equal(repaid?.correct, true);
  assert.equal(repaid?.repaysMiss, true);
  assert.equal(repaid?.belt, "White", "right once after sure-and-wrong does not move the belt");

  await rewind();
  const third = (await engine.quizForConcept("password-hashing"))!;
  const moved = await engine.answer(third.token, rightIndex(third), "sure");
  assert.equal(moved?.repaysMiss, false);
  assert.equal(moved?.belt, "Yellow");

  const saved = JSON.parse(await fs.readFile(journalPath(), "utf8"));
  assert.equal(saved.answers.length, 3);
  assert.deepEqual(saved.answers.map((a: { confidence: string }) => a.confidence), ["sure", "think", "sure"]);
  const insight = await engine.insight();
  assert.equal(insight.mistakes.length, 1);
  assert.equal(insight.mistakes[0].confident, true);
  assert.equal(insight.mistakes[0].about, "Storing passwords as hashes");
});

test("with a topic chosen, about one review question in four comes from elsewhere and says so", async () => {
  await rewind();
  engine.resetReviewMix();
  const asked: Array<{ about: string; other: boolean }> = [];
  const skip: string[] = [];
  for (let i = 0; i < 3; i++) {
    const quiz = await engine.nextReview(skip, "Frontend");
    if (!quiz) break;
    asked.push({ about: quiz.about, other: Boolean(quiz.otherTopic) });
    skip.push(engine.questionIdFor(quiz.token)!);
  }
  assert.deepEqual(asked.slice(0, 2).map((a) => a.other), [false, false], "the topic's own questions come first");
  assert.ok(asked.slice(0, 2).every((a) => /React/.test(a.about)));
  // Frontend has only two questions due, so the pass ends rather than drifting into other topics.
  assert.equal(asked.length, 2);

  engine.resetReviewMix();
  for (let n = 0; n < 3; n++) engine.bumpReviewMixForTest();
  const mixed = await engine.nextReview([], "Frontend");
  assert.equal(mixed?.otherTopic, true, "the fourth question is taken from another topic");
  assert.doesNotMatch(mixed?.about ?? "", /React/);

  engine.resetReviewMix();
  for (let n = 0; n < 3; n++) engine.bumpReviewMixForTest();
  const unmixed = await engine.nextReview([], "Frontend", false);
  assert.equal(unmixed?.otherTopic, undefined, "mixing can be turned off");
});

test("support fades as the belt rises, and the hardest question is asked at the top", async () => {
  const ids = questionsForConcept("react-state").map((q) => q.id);
  await rewind((ref) => (ids.includes(ref) ? 3 : undefined));
  assert.equal((await engine.ideaCard("react-state"))?.support, "question-first");
  await rewind((ref) => (ids.includes(ref) ? 4 : undefined));
  const brown = await engine.ideaCard("react-state");
  assert.equal(brown?.support, "minimal");
  assert.equal(brown?.needsTransfer, true);
  assert.equal((await engine.ideaCard("env-vars"))?.support, "full");
  const hardest = questionsForConcept("react-state").some((q) => q.level !== "Junior");
  const quiz = (await engine.quizForConcept("react-state"))!;
  if (hardest) assert.notEqual(questionById(engine.questionIdFor(quiz.token)!)?.level, "Junior");
});

test("black belt waits for the idea to be recognised somewhere else", async () => {
  const stateQuestion = questionsForConcept("react-state")[0];
  // Exactly one question due: this idea's, at brown belt.
  const onlyDue = async () => {
    const p = await profile();
    p.review = p.review.filter((r: { ref: string }) => !questionsForConcept("react-state").some((q) => q.id === r.ref));
    for (const item of p.review) item.dueAt = new Date(Date.now() + 86_400_000).toISOString();
    p.review.push({ id: `quiz:${stateQuestion.id}`, kind: "quiz", ref: stateQuestion.id, label: "x", box: 4, dueAt: new Date(Date.now() - 1000).toISOString(), reps: 4, lapses: 0, lastAt: null });
    p.recentQuizIds = [];
    await saveProfile(p);
  };
  await onlyDue();

  const ask = async () => {
    const quiz = (await engine.nextReview([], "Frontend", false))!;
    assert.equal(engine.questionIdFor(quiz.token), stateQuestion.id);
    return quiz;
  };
  let quiz = await ask();
  const held = await engine.answer(quiz.token, rightIndex(quiz), "sure", { blackBeltNeedsTransfer: true });
  assert.equal(held?.correct, true);
  assert.equal(held?.needsTransfer, true);
  assert.equal(held?.belt, "Brown", "correct, but not black yet");

  const transfer = engine.quizFromOwnCode(
    "react-state",
    { question: "In this Vue snippet…", answer: "It is reactive state", distractors: ["A constant", "A prop", "A ref to the DOM"], explanation: "Same idea." },
    { transfer: true },
  )!;
  const passed = await engine.answer(transfer.token, transfer.choices.indexOf("It is reactive state"), "think", { blackBeltNeedsTransfer: true });
  assert.equal(passed?.transferPassed, true);
  assert.equal((await engine.ideaCard("react-state"))?.needsTransfer, false);

  await onlyDue();
  quiz = await ask();
  const black = await engine.answer(quiz.token, rightIndex(quiz), "sure", { blackBeltNeedsTransfer: true });
  assert.equal(black?.needsTransfer, false);
  assert.equal(black?.belt, "Black");

  // With no AI to write a transfer question, nothing may wait on one.
  const p = await profile();
  p.review = p.review.filter((r: { ref: string }) => r.ref !== stateQuestion.id);
  await saveProfile(p);
  const j = JSON.parse(await fs.readFile(journalPath(), "utf8"));
  j.transfer = [];
  await fs.writeFile(journalPath(), JSON.stringify(j));
  await onlyDue();
  quiz = await ask();
  const noAi = await engine.answer(quiz.token, rightIndex(quiz), "sure", { blackBeltNeedsTransfer: false });
  assert.equal(noAi?.belt, "Black");
});

test("an unaided check asks about belts held, weakest first, and records the plain result", async () => {
  const plan = await engine.checkPlan(10);
  assert.ok(plan.length >= 2, `expected some ideas with a belt, got ${plan.join()}`);
  assert.ok(plan.includes("react-state"));
  assert.ok(!plan.includes("cors"), "an idea never met is not checked");
  const quiz = await engine.quizForCheck(plan[0]);
  assert.ok(quiz);
  await engine.answer(quiz.token, rightIndex(quiz));
  assert.equal(await engine.quizForCheck("not-an-idea"), null);

  assert.equal(await engine.recordCheck(0, 0), null);
  const result = await engine.recordCheck(10, 8);
  assert.deepEqual([result?.asked, result?.correct], [10, 8]);
  const status = await engine.status();
  assert.deepEqual([status.independence?.asked, status.independence?.correct], [10, 8]);
  assert.equal(status.checkDue, false, "not offered again the same month");
});

test("a question the learner wrote is checked, saved, scheduled, and survives a restart", async () => {
  const from = { conceptId: "password-hashing", title: "Storing passwords as hashes", topic: "Security" as const };
  assert.deepEqual(await registerOwnQuestion(from, { question: "Why?", answer: "x", wrong: ["a", "b"], why: "" }), {
    problem: "Write the question out in full.",
  });
  const few = await registerOwnQuestion(from, { question: "What does the 12 in our register() control?", answer: "Cost", wrong: ["Salt"], why: "" });
  assert.match("problem" in few ? few.problem : "", /at least two wrong answers/);
  const same = await registerOwnQuestion(from, { question: "What does the 12 in our register() control?", answer: "Cost", wrong: ["Cost", "Salt"], why: "" });
  assert.ok("problem" in same, "an answer repeated among the wrong ones is refused");

  const saved = await registerOwnQuestion(from, {
    question: "What does the 12 in our register() control?",
    answer: "How slow each hash is",
    wrong: ["The length of the salt", "The size of the output"],
    why: "It is the cost factor.",
  });
  assert.ok("id" in saved, JSON.stringify(saved));
  assert.equal(await engine.adopt(saved.id), true);
  const card = await engine.ideaCard(saved.id);
  assert.equal(card?.origin, "own");
  assert.equal(card?.topic, "Security");
  assert.equal(card?.status, "learning", "it is on the schedule straight away");
  assert.ok((await engine.dojo()).some((r) => r.id === saved.id && r.seen));

  clearRegisteredConcepts();
  assert.equal(conceptById(saved.id), undefined);
  assert.equal(await loadOwnCards(), 1);
  assert.match(conceptById(saved.id)?.title ?? "", /^Your question: Storing passwords/);
  assert.equal(JSON.parse(await fs.readFile(ownCardsPath(), "utf8")).cards.length, 1);
});

test("unaided work is paid and recorded as a verified outcome", async () => {
  const before = (await engine.status()).xp;
  assert.equal(await engine.creditUnaided("Add a length check to register()", 40), 40);
  assert.equal((await engine.status()).xp, before + 40);
});

/* ---- pure pieces ------------------------------------------------ */

test("a weekly goal counts days this week and forgives one day in past weeks", () => {
  // Wednesday 18 Nov 2026. Monday is the 16th.
  const now = new Date(2026, 10, 18, 12);
  const days = [
    "2026-11-16", "2026-11-18", // this week: 2
    "2026-11-09", "2026-11-10", "2026-11-12", // last week: 3 of 4, one short, still counts
    "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", // 4
    "2026-10-27", // 1: the run ends here
    "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
  ];
  assert.deepEqual(weekProgress(days, 4, now), { days: 2, goal: 4, weeksRunning: 2 });
  assert.deepEqual(weekProgress([], 4, now), { days: 0, goal: 4, weeksRunning: 0 });
  assert.equal(weekProgress(days, 99, now).goal, 7, "a goal is at most every day");
  assert.equal(weekProgress(["2026-11-22"], 1, now).days, 1, "Sunday belongs to the week that began on Monday");
});

test("a contrast pair must be two nearly identical snippets with one flawed", () => {
  const a = "const u = await db.user(id);\nif (!u) return null;\nreturn u.name;";
  const b = "const u = db.user(id);\nif (!u) return null;\nreturn u.name;";
  const pair = parseContrast(JSON.stringify({ question: "Which?", a, b, flawed: "B", explanation: "No await." }));
  assert.equal(pair?.flawed, "b");
  assert.equal(parseContrast(JSON.stringify({ a, b: a, flawed: "a", explanation: "x" })), null, "identical is not an exercise");
  assert.equal(parseContrast(JSON.stringify({ a, b, flawed: "both", explanation: "x" })), null);
  assert.equal(parseContrast(JSON.stringify({ a, b: b + "\n1\n2\n3\n4", flawed: "a", explanation: "x" })), null, "different programs");
  assert.equal(parseContrast(JSON.stringify({ a, b, flawed: "a" })), null, "no explanation");
});

test("a 'your turn' task that contains the code is refused", () => {
  const known = ["src/auth.ts"];
  const ok = parseYourTurn(
    JSON.stringify({ task: "Reject passwords shorter than eight characters before hashing.", file: "auth.ts", done: "A short password returns an error.", hint: "Check before line 3." }),
    known,
  );
  assert.equal(ok?.file, "src/auth.ts");
  assert.equal(parseYourTurn(JSON.stringify({ task: "Add:\n```ts\nif (p.length < 8) throw new Error();\n```", file: "auth.ts" }), known), null);
  assert.equal(parseYourTurn(JSON.stringify({ task: "Do a thing.", file: "other.ts" }), known), null, "a file that was not in the change");
});

test("a nudge and a pointer are told to withhold; a transfer question to change language", () => {
  const req = { title: "Asynchronous code", file: "a.ts", excerpt: "1: await x()", depth: "Junior" as const };
  assert.match(hintPrompt({ ...req, step: "nudge" }).user, /Do not name the line/);
  assert.match(hintPrompt({ ...req, step: "pointer" }).user, /Do not say what it does or why/);
  assert.match(transferQuestionPrompt({ title: "t", what: "w", file: "a.ts", depth: "Mid" }).user, /DIFFERENT language or framework/);
});
