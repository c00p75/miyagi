/**
 * The lesson: its eight sections are always whole, a model's reply is never
 * trusted with structure or addresses, and every prompt carries the teaching
 * standard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtInLesson, hookPrompt, lessonPrompt, parseHook, parseLesson, parseProfile, profilePrompt, type Subject } from "../src/lesson.js";
import { explainPrompt, riskPrompt } from "../src/prompts.js";
import { DEPTH_GOAL, HOUSE_STYLE, LESSON_SECTIONS } from "../src/standards.js";

const subject: Subject = {
  kind: "tool",
  name: "Docker",
  what: "Packages your app with everything it needs to run.",
  hook: "A shipping container for your code.",
  know: "Images are built once and run anywhere.",
  pitfall: "A missing setting only shows up at runtime. Then emails silently fail.",
  terms: [{ term: "Image", meaning: "A packed recipe for one program." }, { term: "Container", meaning: "One running copy of an image." }],
  flow: ["You run one command.", "Each part starts in its own box."],
  risks: ["A wrong port could expose staging data."],
  verify: "Run docker compose up.",
  docs: { label: "Docker docs", url: "https://docs.docker.com/" },
  file: "docker-compose.yml",
};

const ids = LESSON_SECTIONS.map((s) => s.id);
const sec = (extra: object = {}) => ({ hook: "A story.", explain: "Why it happened.", oneLine: "The point.", bridge: "What next?", ...extra });

test("the standard defines eight sections in the agreed order, and three depths", () => {
  assert.deepEqual(ids, ["problem", "concept", "how", "architecture", "implementation", "practical", "application", "check"]);
  assert.deepEqual(Object.keys(DEPTH_GOAL), ["Junior", "Mid", "Senior"]);
});

test("the built-in lesson always has all eight sections and somewhere to go deeper", () => {
  for (const depth of ["Junior", "Mid", "Senior"] as const) {
    const l = builtInLesson(subject, depth);
    assert.deepEqual(Object.keys(l.sections), ids);
    assert.equal(l.by, "");
    assert.ok(l.sections.application.task?.goal);
    assert.ok(l.sections.check.sayIt.includes("Docker"));
    assert.ok(l.deeper.length >= 2);
    assert.equal(l.deeper[0].url, "https://docs.docker.com/");
  }
});

test("a model's lesson is kept section by section, and holes are filled from the built-in one", () => {
  const reply = JSON.stringify({
    sections: {
      problem: sec({ predict: { question: "What happens?", options: ["It works", "It crashes", "It is slow"], answer: 1, why: "It crashes." } }),
      concept: sec(),
      how: sec({ show: { type: "flow", steps: [{ label: "Dockerfile", note: "written" }, { label: "Image", note: "built" }] } }),
      architecture: sec(),
      implementation: "not an object",
      practical: sec(),
      application: { hook: "no task here" },
      check: { sayIt: "Explain it.", remember: ["One", "Two"] },
    },
    concepts: ["Volume", "Docker", "Port"],
  });
  const l = parseLesson(reply, subject, "Junior", "Test AI");
  assert.ok(l);
  assert.equal(l.by, "Test AI");
  assert.equal(l.sections.problem.predict?.answer, 1);
  assert.equal(l.sections.how.show?.type, "flow");
  assert.equal(l.sections.implementation.hook, builtInLesson(subject, "Junior").sections.implementation.hook, "a malformed section was not replaced");
  assert.ok(l.sections.application.task, "a task-less application section replaced the built-in task");
  assert.deepEqual(l.concepts, ["Volume", "Port"], "the subject itself is not one of its related concepts");
});

test("a reply with too little in it is not that model's lesson", () => {
  assert.equal(parseLesson('{"sections": {"problem": {"hook": "x"}}}', subject, "Mid", "AI"), null);
  assert.equal(parseLesson("Sorry, I cannot.", subject, "Mid", "AI"), null);
});

test("a prediction must be answerable, and an explained error must quote what is shown", () => {
  const reply = (problem: object) => JSON.stringify({ sections: { problem, concept: sec(), how: sec(), architecture: sec(), practical: sec() } });
  const bad = parseLesson(reply(sec({ predict: { question: "Q?", options: ["A", "a"], answer: 0 } })), subject, "Junior", "AI");
  assert.equal(bad?.sections.problem.predict, undefined, "two identical options were accepted");
  const out = parseLesson(reply(sec({ predict: { question: "Q?", options: ["A", "B", "C"], answer: 7 } })), subject, "Junior", "AI");
  assert.equal(out?.sections.problem.predict, undefined, "an answer outside the options was accepted");
  const sig = parseLesson(reply(sec({ reveal: { type: "signal", text: "Error: ECONNREFUSED 5432", notes: [{ part: "ECONNREFUSED", meaning: "refused" }, { part: "ENOENT", meaning: "made up" }] } })), subject, "Junior", "AI");
  const v = sig?.sections.problem.reveal;
  assert.ok(v && v.type === "signal" && v.notes.length === 1, "a note about text that is not shown was kept");
});

test("further reading never uses an address a model wrote", () => {
  const reply = JSON.stringify({
    sections: Object.fromEntries(ids.slice(0, 6).map((i) => [i, sec()])),
    deeper: [{ kind: "video", title: "Docker in 100 Seconds", by: "Fireship", url: "https://evil.example/x" }, { kind: "podcast", title: "nope" }, { kind: "book", title: "Docker Deep Dive", by: "Nigel Poulton" }, { kind: "site", title: "Play with Docker", by: "Docker" }],
  });
  const l = parseLesson(reply, subject, "Junior", "AI");
  assert.ok(l);
  assert.equal(l.deeper.length, 4);
  assert.deepEqual(l.deeper.map((r) => r.kind), ["docs", "video", "book", "site"]);
  assert.ok(l.deeper.every((r) => !r.url.includes("evil.example")));
  assert.ok(l.deeper[1].url.startsWith("https://www.youtube.com/results?search_query=Docker%20in%20100%20Seconds"));
  assert.ok(l.deeper[2].url.startsWith("https://duckduckgo.com/?q=Docker%20Deep%20Dive"));
  assert.ok(l.deeper.every((r) => r.url.startsWith("https://")));
});

test("the lesson prompt carries the standard, the depth's goal and the project", () => {
  const p = lessonPrompt({ subject, depth: "Senior", profile: { summary: "An order-management app.", users: "shop staff", parts: [{ name: "API", role: "saves orders" }], terms: ["order", "invoice"] }, files: [] });
  assert.ok(p.user.includes(HOUSE_STYLE));
  assert.match(p.user, /does NOT name the thing being taught/);
  assert.match(p.user, /evaluate and architect/);
  assert.match(p.user, /An order-management app\./);
  for (const id of ids) assert.ok(p.user.includes(`${id}:`), `section ${id} is not briefed`);
  const none = lessonPrompt({ subject, depth: "Junior", profile: null, files: [] });
  assert.match(none.user, /rather than inventing a product/);
});

test("every prompt carries the house style", () => {
  const a = explainPrompt({ title: "T", what: "W", depth: "Junior", file: "a.ts", excerpt: "1: x", evidence: "x" });
  const b = riskPrompt([{ file: "a.ts", excerpt: "1: x" }], "Mid");
  const c = profilePrompt({ name: "shop", tree: ["a.ts"], heads: [] });
  for (const p of [a, b, c]) assert.ok(p.user.startsWith(HOUSE_STYLE));
});

test("a project profile needs a summary", () => {
  assert.equal(parseProfile('{"users": "staff"}'), null);
  const p = parseProfile('{"summary": "Takes orders.", "parts": [{"name": "API", "role": "saves orders"}, {"role": "nameless"}], "terms": ["order"]}');
  assert.equal(p?.parts.length, 1);
});

test("a hook is held to the style that was asked for", () => {
  const q = parseHook('{"lead": "Your app recommends a video. Next month it is deleted. What does your reader see?", "tease": "Your code has an answer, one line long.", "button": "Find out ›"}', "question");
  assert.deepEqual(q, { style: "question", lead: "Your app recommends a video. Next month it is deleted. What does your reader see?", tease: "Your code has an answer, one line long.", button: "Find out" });
  assert.equal(parseHook('{"lead": "Links can break when pages move around the web."}', "question"), null, "a question hook that asks nothing was kept");
  assert.equal(parseHook('{"lead": "What happens when a link in your app dies?"}', "stake"), null, "a stake that asks instead of saying was kept");
  assert.equal(parseHook('{"lead": "Too short?"}', "question"), null);
  const s = parseHook('{"lead": "One dead link, and your reader stops trusting every other link you give them.", "button": "Open"}', "stake");
  assert.equal(s?.button, "See how to avoid it", "a button that only says Open was kept");
});

test("the hook prompt asks for the style the rule chose, and forbids clickbait", () => {
  const stake = hookPrompt({ subject, style: "stake", profile: null, files: [] });
  assert.match(stake.user, /what goes wrong for a real user/);
  assert.match(stake.user, /No clickbait/);
  assert.match(hookPrompt({ subject, style: "question", profile: null, files: [] }).user, /must end with a question mark/);
});
