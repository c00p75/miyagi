/**
 * The coach's pure parts: tool detection and vocabulary, predictions, error
 * reading, the growth store and its trend, the skill map, the new prompts'
 * parsers, and the engine's answers in the learner's own words.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { conceptById, questionsForConcept } from "../../src/concepts.js";
import * as S from "../../src/state.js";
import * as engine from "../src/engine.js";
import {
  TOOL_CATALOG,
  detectTools,
  findTool,
  packagesInCommand,
  packagesInLine,
  registerTool,
  specFromModel,
  specOf,
  termDefinitions,
  unknownPackages,
} from "../src/tools.js";
import {
  addStory,
  clueLine,
  count,
  emptyGrowth,
  errorSignature,
  forgetGrowth,
  loadGrowth,
  namesFile,
  normaliseGrowth,
  scorePrediction,
  trend,
  updateGrowth,
  worthCoaching,
} from "../src/growth.js";
import { SKILLS, skillMap } from "../src/skills.js";
import {
  parseDecisions,
  parseDiagnosis,
  parseIncident,
  parseStoryQuestion,
  parseToolPrimer,
  toolPrimerPrompt,
  diagnosePrompt,
} from "../src/prompts.js";
import { errorExcerpt, parseHookPayload } from "../../src/observe.js";
import { mergeClaude } from "../../src/setup.js";

let home = "";

before(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-growth-"));
  home = path.join(root, "home");
  process.env.MIYAGI_HOME = home;
});

after(() => fs.rm(path.dirname(home), { recursive: true, force: true }));

/* ---- the tool catalogue ------------------------------------------- */

test("every catalogued tool's vocabulary registers, and its questions pass the quality bar", () => {
  const ids = new Set<string>();
  let terms = 0;
  let both = 0;
  for (const tool of TOOL_CATALOG) {
    assert.ok(!ids.has(tool.id), `duplicate tool id ${tool.id}`);
    ids.add(tool.id);
    const spec = specOf(tool);
    const defs = termDefinitions(spec);
    const live = registerTool(spec);
    assert.equal(live.length, defs.length, `${tool.name}: only ${live.length} of ${defs.length} terms registered`);
    for (const id of live) {
      terms++;
      assert.ok(conceptById(id), `${id} is not registered`);
      const n = questionsForConcept(id).length;
      // The meaning question must always survive; the reverse one may be refused
      // when one term's name is much longer than all its siblings' (it would give itself away).
      assert.ok(n >= 1, `${id} has no question`);
      if (n === 2) both++;
    }
  }
  assert.ok(both / terms >= 0.95, `only ${both} of ${terms} terms kept both questions`);
});

test("term ids are stable, distinct and inside the id rules", () => {
  const all = TOOL_CATALOG.flatMap((t) => termDefinitions(specOf(t)).map((d) => d.id));
  assert.equal(new Set(all).size, all.length, "two terms share an id");
  for (const id of all) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  for (const id of all) assert.ok(id.length >= 3 && id.length <= 60, id);
});

test("a package line, a config file and a setup command each name the tool", () => {
  const sentry = detectTools([{ file: "package.json", added: '    "@sentry/nextjs": "^8.20.0",' }]);
  assert.deepEqual(sentry.map((h) => h.id), ["sentry"]);
  assert.match(sentry[0].evidence, /@sentry\/nextjs/);

  assert.deepEqual(detectTools([{ file: "sentry.client.config.ts", added: "init({})" }]).map((h) => h.id), ["sentry"]);
  assert.deepEqual(detectTools([], ["npx @sentry/wizard@latest -i nextjs"]).map((h) => h.id), ["sentry"]);

  const many = detectTools([], ["npm install stripe zod --save"]).map((h) => h.id).sort();
  assert.deepEqual(many, ["stripe", "zod"]);
});

test("detection does not claim things the project did not adopt", () => {
  assert.deepEqual(detectTools([{ file: "package.json", added: '  "version": "1.0.0",\n  "name": "shop"' }]), []);
  assert.deepEqual(detectTools([{ file: "README.md", added: "We use Sentry and Stripe in production." }]), []);
  assert.deepEqual(detectTools([], ["npm test", "git status", "grep -r sentry ."]), []);
  // Mentioning a package in code is not adopting it: only manifests and installs count.
  assert.deepEqual(detectTools([{ file: "src/a.ts", added: 'const x = "@sentry/nextjs";' }]), []);
});

test("package names are read from manifests and install commands", () => {
  assert.deepEqual(packagesInLine("package.json", '"@tanstack/react-query": "^5.0.0",'), ["@tanstack/react-query"]);
  assert.deepEqual(packagesInLine("package.json", '"version": "2.0.0",'), []);
  assert.deepEqual(packagesInLine("requirements.txt", "fastapi==0.110.0"), ["fastapi"]);
  assert.deepEqual(packagesInLine("pyproject.toml", '  "pydantic>=2.0",'), ["pydantic"]);
  assert.deepEqual(packagesInCommand("pnpm add @clerk/nextjs@latest -D"), ["@clerk/nextjs"]);
  assert.deepEqual(packagesInCommand("pip install 'celery[redis]>=5'"), []);
  assert.deepEqual(packagesInCommand("pip install celery==5.3"), ["celery"]);
});

test("unknown packages are offered, never taught, and type packages are left out", () => {
  const found = unknownPackages([{ file: "package.json", added: '"left-pad": "^1.3.0",\n"@types/node": "^22.0.0",\n"@sentry/node": "^8.0.0"' }]);
  assert.deepEqual(found, ["left-pad"]);
});

test("a learner's name for a tool finds it", () => {
  assert.equal(findTool("sentry")?.id, "sentry");
  assert.equal(findTool("Sentry ")?.id, "sentry");
  assert.equal(findTool("@sentry/nextjs")?.id ?? findTool("sentry-sdk")?.id, "sentry");
  assert.equal(findTool("xy"), null);
});

test("a tool a model describes is validated before it becomes a lesson", () => {
  assert.equal(specFromModel({ name: "Thing", oneLiner: "x", terms: [{ term: "A", meaning: "short" }] }), null);
  const ok = specFromModel({
    name: "Inngest",
    oneLiner: "Runs background functions triggered by events.",
    topic: "Backend and APIs",
    terms: [
      { term: "Event", meaning: "A named message your app sends that can trigger one or more functions to run." },
      { term: "Function", meaning: "A piece of your code that runs in the background when a matching event arrives." },
      { term: "Step", meaning: "One retriable unit inside a function whose result is saved so it never runs twice." },
    ],
  });
  assert.ok(ok);
  assert.equal(ok.id, "inngest");
  assert.equal(ok.builtIn, false);
  assert.equal(registerTool(ok).length, 3);
});

/* ---- predictions ------------------------------------------------- */

test("a prediction names files by path, by end of path, by folder or by bare name", () => {
  assert.ok(namesFile("src/api/pay.ts", "src/api/pay.ts"));
  assert.ok(namesFile("api/pay.ts", "src/api/pay.ts"));
  assert.ok(namesFile("src/api", "src/api/pay.ts"));
  assert.ok(namesFile("checkout", "app/checkout.tsx"));
  assert.ok(!namesFile("pay", "src/api/payment.ts"));
  assert.ok(!namesFile("src/ap", "src/api/pay.ts"));
});

test("scoring counts hits, misses and surprises, and surprises lower the score", () => {
  const r = scorePrediction(["src/api", "README.md"], ["src/api/pay.ts", "src/api/refund.ts", "src/db/schema.ts"]);
  assert.deepEqual(r.hits, ["src/api"]);
  assert.deepEqual(r.misses, ["README.md"]);
  assert.deepEqual(r.surprises, ["src/db/schema.ts"]);
  assert.equal(r.score, 1 / 3);
  assert.equal(scorePrediction(["a.ts"], ["a.ts"]).score, 1);
  assert.equal(scorePrediction([], ["a.ts"]).score, 0);
});

/* ---- reading errors ------------------------------------------------ */

test("only the error lines of a failure are kept, scrubbed and capped", () => {
  // Assembled at run time so the source holds nothing a secret scanner mistakes for a real key.
  const fakeKey = ["sk", "live", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
  const output = [
    "\u001b[32m> shop@1.0.0 test\u001b[0m",
    "  running 12 tests",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "    at getUser (src/api/users.ts:14:22)",
    "    at node:internal/process/task_queues:95:5",
    `token=${fakeKey} failed`,
    "All good otherwise",
  ].join("\n");
  const excerpt = errorExcerpt(output)!;
  assert.ok(excerpt.includes("TypeError"));
  assert.ok(excerpt.includes("src/api/users.ts:14"));
  assert.ok(!excerpt.includes("running 12 tests"));
  assert.ok(!excerpt.includes(fakeKey), "a secret survived");
  assert.ok(!excerpt.includes("\u001b"), "colour codes survived");
  assert.ok(excerpt.split("\n").length <= 6);
  assert.equal(errorExcerpt("all 12 tests passed"), null);
});

test("the clue is the first frame in the learner's own files", () => {
  const lines = ["TypeError: x is undefined", "    at node:internal/foo:1:1", "    at handler (node_modules/lib/index.js:3:1)", "    at getUser (src/api/users.ts:14:22)"];
  assert.equal(clueLine(lines), 4);
  assert.equal(clueLine(["Error: ENOENT: no such file", "more"]), 1);
});

test("the same failure has the same signature across runs, and routine failures are not coached", () => {
  const a = errorSignature("npm test", "Error: expected 3 to equal 4 (12ms)\n at /Users/a/x.ts:3");
  const b = errorSignature("npm test", "Error: expected 5 to equal 9 (40ms)\n at /Users/b/y.ts:9");
  assert.equal(a, b);
  assert.ok(!worthCoaching("grep -r foo .", "grep: no match found anywhere"));
  assert.ok(!worthCoaching("npm test", ""));
  assert.ok(worthCoaching("npm run build", "Error: Cannot find module './db'"));
});

test("the hook records a failed command's error lines, and a prompt without its text", () => {
  const failed = parseHookPayload({
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    error: "Exit code 1\nError: Cannot find module './db'\n    at src/api/users.ts:3:1\nlots of other output",
    cwd: "/w",
  });
  assert.equal(failed.length, 1);
  const o = failed[0];
  assert.equal(o.kind, "command");
  assert.ok(o.kind === "command" && o.failed && o.error?.includes("Cannot find module"));

  const ok = parseHookPayload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: { stdout: "a\nb", stderr: "" } });
  assert.ok(ok[0].kind === "command" && !ok[0].failed);

  const prompt = parseHookPayload({ hook_event_name: "UserPromptSubmit", prompt: "add stripe checkout with my secret sk_live_x", cwd: "/w", session_id: "s" });
  assert.equal(prompt.length, 1);
  assert.equal(prompt[0].kind, "prompt");
  assert.ok(!JSON.stringify(prompt).includes("stripe"), "the prompt's text was recorded");
});

test("installing the hook adds the failure and new-task events, and removing it takes all three", () => {
  const once = mergeClaude({}, "node x.js # miyagi-observe");
  const hooks = once.hooks as Record<string, unknown[]>;
  assert.deepEqual(Object.keys(hooks).sort(), ["PostToolUse", "PostToolUseFailure", "UserPromptSubmit"]);
  assert.deepEqual(mergeClaude(once, "node x.js # miyagi-observe"), once);
  assert.deepEqual(mergeClaude(once, null), {});
});

/* ---- the store and the trend -------------------------------------- */

test("growth counts moves by week and says the trend in one sentence", () => {
  const g = emptyGrowth();
  const now = new Date("2026-11-20T12:00:00Z");
  const earlier = new Date("2026-10-23T12:00:00Z");
  for (let i = 0; i < 2; i++) count(g, { kind: "first" }, earlier);
  for (let i = 0; i < 3; i++) count(g, { kind: "aiFirst" }, earlier);
  count(g, { kind: "explained", verdict: "right" }, now);
  count(g, { kind: "debug", verdict: "partly" }, now);
  count(g, { kind: "prediction", score: 0.5 }, now);
  count(g, { kind: "aiFirst" }, now);
  const t = trend(g, now);
  assert.equal(t.weeks.length, 8);
  const last = t.weeks[t.weeks.length - 1];
  assert.equal(last.moves, 4);
  assert.equal(last.wentFirst, 0.75);
  assert.match(t.sentence ?? "", /75%/);
  assert.match(t.sentence ?? "", /Up from 40%/);
  assert.equal(t.thisWeek.explainedRight, 1);
  assert.equal(t.thisWeek.debugReads, 1);
  assert.equal(t.thisWeek.debugRight, 0);
});

test("a week with too few moves says nothing rather than a misleading percentage", () => {
  const g = emptyGrowth();
  count(g, { kind: "first" });
  assert.equal(trend(g).sentence, null);
});

test("the story keeps one entry per achievement", () => {
  const g = emptyGrowth();
  addStory(g, { kind: "tool", title: "Started learning Sentry", detail: "x" });
  addStory(g, { kind: "tool", title: "Started learning Sentry", detail: "y" });
  assert.equal(g.story.length, 1);
});

test("a damaged growth file costs its bad entries, not the rest", () => {
  const g = normaliseGrowth({
    tools: [{ id: "sentry", name: "Sentry", termIds: ["a"], adopted: true }, { nope: 1 }, "x"],
    decisions: [{ id: "d1", chose: "Postgres", over: "not a list", because: "relational" }],
    weeks: [{ week: "2026-11-16", first: "three" }],
    gates: { asked: 2, right: 1 },
  });
  assert.equal(g.tools.length, 1);
  assert.equal(g.tools[0].source, "detected");
  assert.deepEqual(g.decisions[0].over, []);
  assert.equal(g.weeks[0].first, 0);
  assert.deepEqual(g.gates, { asked: 2, right: 1 });
  assert.deepEqual(normaliseGrowth("garbage"), emptyGrowth());
});

test("the store writes to the profile and reads it back", async () => {
  forgetGrowth();
  await updateGrowth((g) => {
    g.decisions.push({ id: "d1", at: new Date().toISOString(), root: "/w", title: "Database", chose: "Postgres", over: ["MongoDB"], because: "Orders are relational." });
  });
  forgetGrowth();
  const back = await loadGrowth();
  assert.equal(back.decisions[0].chose, "Postgres");
  const raw = JSON.parse(await fs.readFile(path.join(home, "growth.json"), "utf8"));
  assert.equal(raw.decisions.length, 1);
});

/* ---- the skill map ------------------------------------------------- */

test("the map says what is held, started and not met, and picks the lowest open skill next", () => {
  const ideas = new Map<string, { seen: boolean; box: number }>([
    ["hardcoded-secret", { seen: true, box: 3 }],
    ["env-vars", { seen: true, box: 4 }],
    ["gitignore", { seen: true, box: 3 }],
    ["error-handling", { seen: true, box: 1 }],
  ]);
  const g = emptyGrowth();
  const map = skillMap({ ideas, growth: g, changesSeen: 30 });
  const byId = Object.fromEntries(map.skills.map((s) => [s.id, s]));
  assert.equal(byId.secrets.status, "held");
  assert.equal(byId.failure.status, "started");
  assert.equal(byId.testing.status, "untouched");
  assert.equal(map.skills.length, SKILLS.length);
  assert.equal(map.next?.id, "failure", "a started Junior skill comes before untouched ones");

  for (let i = 0; i < 3; i++) count(g, { kind: "debug", verdict: "right" });
  assert.equal(skillMap({ ideas, growth: g, changesSeen: 30 }).skills.find((s) => s.id === "read-errors")?.status, "held");
});

test("every skill that names ideas names ones that exist", () => {
  for (const skill of SKILLS) {
    if (skill.signal.kind !== "ideas") continue;
    for (const id of skill.signal.ids) assert.ok(conceptById(id), `${skill.id} names unknown idea ${id}`);
  }
});

/* ---- the new prompts' parsers --------------------------------------- */

test("a diagnosis is read, its clue kept in range, and its file matched", () => {
  const d = parseDiagnosis(
    'Sure: {"verdict": "partly", "feedback": "You found the file.", "cause": "db is not exported", "where": {"file": "./src/db.ts", "line": 3}, "fix": "Export it.", "clue": 9, "habit": "Read the first frame in your code."}',
    ["src/db.ts"],
    4,
  );
  assert.ok(d);
  assert.equal(d.verdict, "partly");
  assert.deepEqual(d.where, { file: "src/db.ts", line: 3 });
  assert.equal(d.clue, null, "a clue past the end was kept");
  assert.equal(parseDiagnosis('{"verdict": "right"}', [], 3), null);
  const p = diagnosePrompt({ command: "npm test", error: "Error: x\nat a.ts:1", guess: "", picked: null, code: [], depth: "Junior" });
  assert.match(p.user, /did not try/);
});

test("a primer for an unknown tool must describe its vocabulary", () => {
  const without = parseToolPrimer('{"summary": "It queues jobs."}', [], true);
  assert.equal(without, null);
  const withTerms = parseToolPrimer(
    JSON.stringify({
      summary: "It queues jobs.",
      wired: [{ file: "src/jobs.ts", line: 4, what: "creates the queue" }, { file: "nowhere.ts", line: 1, what: "x" }],
      oneLiner: "Background jobs on Redis.",
      terms: [
        { term: "Queue", meaning: "A named list of jobs waiting to run, stored in Redis." },
        { term: "Worker", meaning: "A process that takes jobs off a queue and runs them." },
        { term: "Job", meaning: "One unit of work with its own data, retries and result." },
      ],
    }),
    ["src/jobs.ts"],
    true,
  );
  assert.ok(withTerms?.spec);
  assert.equal(withTerms.wired.length, 1, "a line in a file that was never sent was kept");
  const p = toolPrimerPrompt({ name: "BullMQ", files: [], depth: "Mid" });
  assert.match(p.user, /terms/);
});

test("decisions, incidents and story questions parse, and junk is refused", () => {
  assert.deepEqual(parseDecisions('{"decisions": []}'), []);
  assert.equal(parseDecisions("no json"), null);
  const d = parseDecisions('{"decisions": [{"title": "Queue", "chose": "BullMQ", "over": ["cron"], "because": "retries"}, {"title": ""}]}');
  assert.equal(d?.length, 1);
  const i = parseIncident('{"title": "Blank page", "cause": "null user", "related": "made-up"}', ["error-handling"]);
  assert.equal(i?.related, "", "an idea that does not exist was linked");
  assert.deepEqual(parseStoryQuestion('{"question": "Tell me about a time…", "entry": 99}', 3), { question: "Tell me about a time…", entry: 1 });
});

/* ---- the engine: answers in the learner's own words ------------------ */

test("an answer in the learner's own words is graded by verdict; partly holds the belt", async () => {
  const lesson = await engine.teach({
    changes: [{ file: "a.ts", concepts: [{ id: "error-handling", count: 1, evidence: "try {" }] }],
    root: "/w",
    source: "a.ts",
    limit: 1,
  });
  assert.ok(lesson);
  const quiz = await engine.quizForConcept("error-handling");
  assert.ok(quiz);
  const q = engine.openQuestion(quiz.token);
  assert.ok(q && q.answer);
  const partly = await engine.answerInOwnWords(quiz.token, "something about errors", "partly");
  assert.ok(partly);
  assert.equal(partly.correct, true);
  await S.hydrate();
  const item = S.findReviewItem("quiz", questionsForConcept("error-handling").find((x) => x.question === quiz.question)?.id ?? "");
  assert.equal(item?.box ?? 0, 0, "a partly-right answer moved the belt");
});

test("from green belt up, review offers an answer in your own words", async () => {
  await engine.adoptIdeas(["async-await"], "a test");
  await S.hydrate();
  const qid = questionsForConcept("async-await")[0].id;
  const item = S.findReviewItem("quiz", qid);
  assert.ok(item);
  item.box = 4;
  item.dueAt = new Date(Date.now() - 1000).toISOString();
  await S.persistNow();
  let saw = false;
  for (let i = 0; i < 6 && !saw; i++) {
    const quiz = await engine.nextReview([], null, false, { explainBack: true });
    if (!quiz) break;
    if (quiz.conceptId === "async-await") saw = Boolean(quiz.explainBack);
    else await engine.answer(quiz.token, 0);
  }
  assert.ok(saw, "a brown-belt question was not offered in own words");
});

test("adopting a tool's vocabulary queues one question per term, once", async () => {
  const sentry = TOOL_CATALOG.find((t) => t.id === "sentry")!;
  const ids = registerTool(specOf(sentry));
  assert.equal(await engine.adoptIdeas(ids, "Sentry's vocabulary"), ids.length);
  assert.equal(await engine.adoptIdeas(ids, "Sentry's vocabulary"), 0, "adopting twice queued twice");
  const states = await engine.ideaStates();
  assert.ok(ids.every((id) => states.get(id)?.seen));
});
