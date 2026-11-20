/**
 * The features that sit between the engine and the panel: the assistant's own
 * words, ideas a model found, focus, own-code questions, and the weekly report.
 * All against a scratch MIYAGI_HOME and a scratch home directory.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearRegisteredConcepts, conceptById, detectConcepts } from "../../src/concepts.js";
import { questionById } from "../../src/quiz.js";
import * as engine from "../src/engine.js";
import { aiIdeasPath, loadAiIdeas, registerFound, slug } from "../src/ideas.js";
import type { FoundIdea } from "../src/prompts.js";
import { assistantReasoning, projectFolderName, reasoningFrom } from "../src/transcript.js";
import { weeklyReport } from "../src/reports.js";
import { describeMeter, emptyMeter } from "../src/meter.js";

let root = "";
let work = "";
const realHome = process.env.HOME;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-learning-"));
  work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  process.env.MIYAGI_HOME = path.join(root, "miyagi");
  process.env.HOME = path.join(root, "home");
  engine.forgetSession();
});
after(async () => {
  process.env.HOME = realHome;
  clearRegisteredConcepts();
  await fs.rm(root, { recursive: true, force: true });
});

/* ---- the assistant's own words ---------------------------------- */

const line = (o: object) => JSON.stringify(o);
const said = (text: string) => line({ type: "assistant", timestamp: "2026-11-18T10:00:00Z", message: { content: [{ type: "text", text }] } });
const edited = (file: string, tool = "Edit") =>
  line({ type: "assistant", timestamp: "2026-11-18T10:00:05Z", message: { content: [{ type: "tool_use", name: tool, input: { file_path: file } }] } });
const toolResult = line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } });
const human = (text: string) => line({ type: "user", message: { content: [{ type: "text", text }] } });

test("what the assistant said before an edit is found, and stops at the learner's message", () => {
  const transcript = [
    human("add login"),
    said("An unrelated earlier thought."),
    human("now hash the passwords"),
    said("I will use bcrypt with a cost of 12 so each guess is slow."),
    edited("/repo/src/auth.ts"),
    toolResult,
    said("Next I will add the route."),
    edited("/repo/src/routes.ts", "Write"),
    '{"type": "assistant", "message": {"content": [{"type": "text"', // a half-written last line
  ].join("\n");

  const auth = reasoningFrom(transcript, "/repo/src/auth.ts");
  assert.equal(auth?.text, "I will use bcrypt with a cost of 12 so each guess is slow.");
  assert.equal(auth?.at, "2026-11-18T10:00:05Z");
  const routes = reasoningFrom(transcript, "src/routes.ts");
  assert.match(routes?.text ?? "", /Next I will add the route\.$/, "a relative path matches by its end");
  assert.match(routes?.text ?? "", /bcrypt/, "earlier words from the same request are included");
  assert.doesNotMatch(routes?.text ?? "", /unrelated earlier/, "words from before the learner's message are not");
  assert.equal(reasoningFrom(transcript, "/repo/src/other.ts"), null);
  assert.equal(reasoningFrom("not json at all\n{}", "/repo/src/auth.ts"), null);
  assert.equal(reasoningFrom([human("x"), edited("/repo/a.ts")].join("\n"), "/repo/a.ts"), null, "an edit with nothing said first");
});

test("the transcript is looked up by session id, then by project folder", async () => {
  const home = process.env.HOME!;
  const folder = path.join(home, ".claude", "projects", projectFolderName(work));
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "abcdef12-0000.jsonl"), [said("Because the input comes from a form."), edited(path.join(work, "form.ts"))].join("\n"));

  const bySession = await assistantReasoning({ session: "abcdef12-0000", cwds: [], file: path.join(work, "form.ts") }, home);
  assert.equal(bySession?.text, "Because the input comes from a form.");
  const byFolder = await assistantReasoning({ session: null, cwds: [work], file: path.join(work, "form.ts") }, home);
  assert.equal(byFolder?.text, "Because the input comes from a form.");
  assert.equal(await assistantReasoning({ session: "../../etc/passwd", cwds: [], file: "x" }, home), null, "a session id is not a path");
  assert.equal(await assistantReasoning({ cwds: [path.join(root, "nowhere")], file: "x" }, home), null);
});

/* ---- ideas a model found ---------------------------------------- */

const debounce: FoundIdea = {
  title: "Debouncing",
  topic: "Frontend",
  hook: "Wait for the typing to stop before you do the expensive thing.",
  what: "Delaying a function until calls to it have paused for a moment.",
  know: "Each keystroke restarts a timer. Only when the timer finishes does the search run, so ten keystrokes cost one request.",
  pitfall: "The timer is created inside the component, so every render makes a new one and nothing is ever cancelled.",
  file: "src/Search.tsx",
  evidence: "const run = debounce(search, 300);",
  question: {
    question: "A search box debounced at 300 ms gets five keystrokes 100 ms apart. How many searches run?",
    answer: "One, 300 ms after the last key",
    distractors: ["Five, one per keystroke", "Two, one per 300 ms window", "None until the box loses focus"],
    explanation: "Each keystroke restarts the wait, so only the pause after the last one lets it fire.",
  },
};

test("a found idea becomes a real idea: a card, a dojo row, a question that survives a restart", async () => {
  assert.equal(slug("Debouncing"), "ai-debouncing");
  assert.equal(slug("?!"), "");

  const [registered] = await registerFound([debounce]);
  assert.equal(registered.id, "ai-debouncing");
  assert.equal(registered.fresh, true);
  assert.equal(conceptById("ai-debouncing")?.title, "Debouncing");

  const lesson = await engine.teach({
    changes: [{ file: debounce.file, concepts: [{ id: registered.id, count: 1, evidence: debounce.evidence }] }],
    root: work,
    source: "src/Search.tsx, found by Test Model",
    limit: 2,
  });
  const card = lesson?.cards[0];
  assert.ok(card);
  assert.equal(card.origin, "ai");
  assert.equal(card.topic, "Frontend");
  assert.equal(card.risk, false);
  assert.equal(card.hasQuiz, true);
  assert.equal(card.lens.Junior, debounce.know, "one text serves every depth");
  assert.ok((await engine.dojo()).some((r) => r.id === "ai-debouncing" && r.seen));

  const quiz = await engine.quizForConcept("ai-debouncing");
  assert.ok(quiz);
  assert.equal(questionById(engine.questionIdFor(quiz.token)!)?.answer, debounce.question!.answer);

  // Found again under the same name: the same idea, not a second one.
  const [again] = await registerFound([{ ...debounce, title: "debouncing" }]);
  assert.deepEqual({ id: again.id, fresh: again.fresh }, { id: "ai-debouncing", fresh: false });
  // A model "finding" something the pack already teaches maps to the pack's idea.
  const [builtIn] = await registerFound([{ ...debounce, title: "React state" }]);
  assert.deepEqual({ id: builtIn.id, fresh: builtIn.fresh }, { id: "react-state", fresh: false });

  // A restart: nothing in memory, everything on disk.
  clearRegisteredConcepts();
  assert.equal(conceptById("ai-debouncing"), undefined);
  assert.equal(await loadAiIdeas(), 1);
  assert.equal(conceptById("ai-debouncing")?.title, "Debouncing");
  assert.equal(JSON.parse(await fs.readFile(aiIdeasPath(), "utf8")).ideas.length, 1);
});

test("a found idea whose question fails the quality bar is kept as a lesson without one", async () => {
  const bad = {
    ...debounce,
    title: "Throttling",
    question: { question: "Q?", answer: "Same", distractors: ["Same", "Same"], explanation: "x" },
  };
  const [registered] = await registerFound([bad]);
  assert.equal(registered?.id, "ai-throttling");
  assert.ok(conceptById("ai-throttling"));
  const card = await engine.ideaCard("ai-throttling");
  assert.equal(card?.hasQuiz, false);
});

/* ---- focus, own-code questions, excerpts ------------------------ */

test("the chosen topic is taught first, and an idea comes after the one it builds on", async () => {
  engine.forgetSession();
  const source = [
    "const hash = await bcrypt.hash(password, 12);",
    "const [open, setOpen] = useState(false);",
    "useEffect(() => { load(); }, []);",
  ].join("\n");
  const changes = [{ file: "app.tsx", concepts: detectConcepts("app.tsx", source) }];
  const unfocused = await engine.teach({ changes, root: work, source: "app.tsx", limit: 1, repeat: true });
  assert.equal(unfocused?.cards[0].conceptId, "password-hashing", "by weight, security leads");
  const focused = await engine.teach({ changes, root: work, source: "app.tsx", limit: 2, repeat: true, focus: "Frontend" });
  assert.deepEqual(focused?.cards.map((c) => c.conceptId), ["react-state", "react-effect"]);
  assert.equal(focused?.later.some((c) => c.id === "password-hashing"), true, "the rest is named, not dropped");
  assert.deepEqual(focused?.files, ["app.tsx"]);
  assert.equal(focused?.root, work);
});

test("a question about the learner's own lines is graded and paid but never scheduled", async () => {
  const before = await engine.status();
  const quiz = engine.quizFromOwnCode("password-hashing", {
    question: "What does the 12 on line 3 control?",
    answer: "How slow each hash is",
    distractors: ["The salt length", "The output size", "The retry count"],
    explanation: "It is the cost factor.",
  });
  assert.ok(quiz);
  assert.equal(quiz.choices.length, 4);
  assert.equal(quiz.review, false);
  const result = await engine.answer(quiz.token, quiz.choices.indexOf("How slow each hash is"));
  assert.equal(result?.correct, true);
  assert.equal(result?.nextDueAt, null, "it does not enter the review queue");
  assert.ok((await engine.status()).xp > before.xp);
  assert.equal(engine.quizFromOwnCode("no-such-idea", { question: "q", answer: "a", distractors: ["b"], explanation: "" }), null);
});

test("the lines of a change are found in the file as it is now, with real numbers", async () => {
  const file = [
    "import express from 'express';",
    "",
    "const app = express();",
    "app.get('/users', async (req, res) => {",
    "  const apiKey = \"sk_live_abcdefghijklmnop1234\";",
    "  res.json(await db.users.all());",
    "});",
  ].join("\n");
  await fs.writeFile(path.join(work, "server.ts"), file);
  const added = "app.get('/users', async (req, res) => {\n  res.json(await db.users.all());\n  const apiKey = \"sk_live_abcdefghijklmnop1234\";";
  const excerpt = await engine.excerptOfChange(work, "server.ts", added);
  assert.ok(excerpt);
  assert.match(excerpt, /^4: app\.get/m);
  assert.match(excerpt, /^6: {3}res\.json/m);
  assert.doesNotMatch(excerpt, /sk_live_abcdefghijklmnop1234/, "a credential is never sent to a model");
  assert.equal(await engine.excerptOfChange(work, "gone.ts", added), null);
  assert.match((await engine.headOf(work, "server.ts", 3)) ?? "", /^import express/);
});

/* ---- the weekly report ------------------------------------------ */

test("the weekly report says what was met, what is slipping, and never needs a model", async () => {
  const [status, dojo] = await Promise.all([engine.status(), engine.dojo()]);
  const report = await weeklyReport({ status, dojo, meterLine: describeMeter(emptyMeter()) });
  assert.match(report, /^# Miyagi: your week/);
  assert.match(report, /\*\*New:\*\* Debouncing \(src\/Search\.tsx\)/);
  assert.match(report, /Storing passwords as hashes/);
  assert.match(report, /## Is it sticking/);
  assert.match(report, /## One thing to practise/);
  assert.match(report, /No AI calls this week\./);
  assert.match(report, /Nothing in this report left your machine/);
});
