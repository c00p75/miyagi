/**
 * Real engine data for the browser harness (`npm run harness`).
 *
 * The panel is a plain web page that draws whatever state it is sent, so it
 * can be looked at in a browser without an editor. This writes that state from
 * the real engine against a scratch profile, so what is on screen is what the
 * engine actually produces, not a hand-written imitation of it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONCEPTS, detectConcepts } from "../../../src/concepts.js";
import * as engine from "../../src/engine.js";
import { TOOL_CATALOG, registerTool, specOf } from "../../src/tools.js";
import { addStory, count, emptyGrowth, trend } from "../../src/growth.js";
import { skillMap } from "../../src/skills.js";

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-harness-"));
  process.env.MIYAGI_HOME = path.join(root, "home");
  const src = 'import bcrypt from "bcrypt";\nconst hash = await bcrypt.hash(password, 12);\nawait db.query(`INSERT INTO users (email) VALUES (\'${email}\')`);';
  const ui = "const [open, setOpen] = useState(false);\nuseEffect(() => { load(); }, []);";
  const lesson = (await engine.teach({
    changes: [
      { file: "src/api/auth.ts", concepts: detectConcepts("src/api/auth.ts", src) },
      { file: "src/ui/Menu.tsx", concepts: detectConcepts("src/ui/Menu.tsx", ui) },
    ],
    root,
    source: "src/api/auth.ts and 1 other file",
    limit: 2,
  }))!;
  lesson.by = "Claude Code";
  const first = lesson.cards[0];
  const state = {
    type: "state",
    status: await engine.status(),
    topics: engine.TOPICS,
    topic: null,
    lessons: [lesson],
    explanations: {},
    extras: {},
    lessonExtras: {},
    busy: {},
    errors: {},
    commands: [{ command: "git status", count: 3, info: engine.commandInfo("git status", "Junior") }],
    commandTotal: 3,
    ai: { label: "Claude Code (haiku)" },
    capture: { on: ["Claude Code"], available: [] },
    watching: true,
    repos: ["shop-api", "shop-web"],
    folders: [],
    heartbeat: { root: "shop-api", at: new Date().toISOString(), files: 2, taught: 2, held: false },
    skipped: 0,
    quiet: null,
    meter: "7 AI calls this week, about 9,400 tokens.",
    findIdeas: "off",
    recallFirst: true,
    explainFirst: true,
    fadeSupport: true,
    holding: false,
    week: { days: 3, goal: 4, weeksRunning: 2 },
    mirror: "You opened 6 of the 14 files your assistant changed this week.",
    check: null,
    turnsLeft: true,
  };
  // The coach's items, built from the real catalogue and growth code.
  const sentry = specOf(TOOL_CATALOG.find((t) => t.id === "sentry")!);
  const termIds = registerTool(sentry);
  await engine.adoptIdeas(termIds.slice(0, 2), "harness");
  const states = await engine.ideaStates();
  const terms = termIds.map((id) => ({
    id,
    term: CONCEPTS.find((c) => c.id === id)!.title.replace(/^[^:]+:\s*/, ""),
    meaning: CONCEPTS.find((c) => c.id === id)!.what,
    seen: states.get(id)?.seen ?? false,
    box: id === termIds[0] ? 3 : states.get(id)?.box ?? 0,
  }));
  const now = Date.now();
  const tool = {
    kind: "tool", key: "tool:sentry", at: new Date(now - 60_000).toISOString(), root, toolId: "sentry", name: "Sentry", emoji: sentry.emoji, job: sentry.job,
    evidence: '"@sentry/nextjs": "^8.20.0",', file: "package.json", source: "detected", spec: sentry, inFeed: true, guessDone: true,
    guess: "Logs errors somewhere so I can see them",
    primer: {
      summary: "Sentry reports crashes from both the Next.js pages and the API routes in this app, so you hear about a broken checkout from a dashboard instead of from a customer.",
      wired: [{ file: "sentry.client.config.ts", line: 4, what: "starts Sentry in the browser with your DSN" }, { file: "next.config.mjs", line: 12, what: "uploads source maps at build time" }],
      flow: [], risks: [{ title: "Every request is traced", why: "tracesSampleRate is 1.0 in sentry.server.config.ts, so production records every request and will use your quota fast." }],
      verify: "Visit /sentry-example-page and press the button, then look for the new issue in your Sentry project.",
      guessFeedback: "Close: it does collect errors, but it also groups them into issues and alerts you, which plain logs do not.", by: "Claude Code (haiku)",
    },
    termIds, adopted: true, terms, held: 1,
  };
  const debug = {
    kind: "debug", key: "debug:1", at: new Date(now - 30_000).toISOString(), root, command: "npm test", by: "Claude Code",
    lines: ["FAIL src/api/users.test.ts", "TypeError: Cannot read properties of undefined (reading 'id')", "    at getUser (src/api/users.ts:14:22)", "    at Object.<anonymous> (src/api/users.test.ts:9:18)", "    at node:internal/process/task_queues:95:5"],
    signature: "x", repeats: 1, picked: 3,
  };
  const debugDone = { ...debug, key: "debug:2", picked: 3, guess: "getUser gets no user back from the db so .id blows up", result: { verdict: "right", feedback: "You found the line and the reason: the lookup returns undefined for an unknown id. The test passes an id that was never inserted.", cause: "getUser reads `.id` from the result of `db.users.find`, which is undefined when no user matches.", where: { file: "src/api/users.ts", line: 14 }, fix: "Return a 404 when the lookup finds nothing, before reading its id.", clue: 3, habit: "Find the first frame in your own files, then ask what value that line assumed was there.", by: "Claude Code (haiku)" } };
  const prediction = { kind: "prediction", key: "pred:1", at: new Date(now - 120_000).toISOString(), root, predictionId: "p1", files: ["src/api/pay.ts", "src/lib/stripe.ts", "README.md"], approach: "A new route that creates a Checkout Session", hits: ["src/api/pay.ts", "src/lib/stripe.ts"], misses: ["README.md"], surprises: ["src/db/schema.ts"], score: 0.5, lessonId: lesson.id };
  const gate = { kind: "gate", key: "gate:1", at: new Date(now - 10_000).toISOString(), root, files: ["src/api/pay.ts", "src/lib/stripe.ts", "src/db/schema.ts"], lines: 142, signature: "s" };
  Object.assign(state, {
    coach: { items: [gate, debug, prediction], tools: [tool], predicting: null, packages: { [lesson.id]: ["left-pad"] }, offerFindIdeas: false, ownWords: {} },
    lessonDecisions: {},
    explainBack: true,
    predictions: "onNewTask",
  });

  const g = emptyGrowth();
  const week = (daysAgo: number) => new Date(now - daysAgo * 864e5);
  const plan: Array<[number, number, number]> = [[49, 2, 5], [42, 3, 4], [35, 3, 3], [21, 5, 3], [14, 6, 2], [7, 7, 2], [0, 8, 1]];
  for (const [ago, first, ai] of plan) {
    for (let i = 0; i < first; i++) count(g, { kind: "explained", verdict: i % 2 ? "right" : "partly" }, week(ago));
    for (let i = 0; i < ai; i++) count(g, { kind: "aiFirst" }, week(ago));
  }
  count(g, { kind: "debug", verdict: "right" }, week(0));
  count(g, { kind: "prediction", score: 0.5 }, week(0));
  g.decisions.push({ id: "d1", at: new Date().toISOString(), root, title: "Error monitoring", chose: "Sentry", over: ["console logs", "Datadog"], because: "Free tier covers us, and it maps minified stack traces back to our source.", revisit: "If we outgrow the free quota." });
  g.incidents.push({ id: "i1", at: new Date().toISOString(), title: "Checkout 500s for new users", whatBroke: "New users could not pay.", cause: "The user lookup returned undefined for accounts created in the last minute.", prevention: "Handle the not-found case explicitly." });
  addStory(g, { kind: "tool", title: "Started learning Sentry", detail: "Error monitoring. Added its 6 key terms to spaced review." });
  addStory(g, { kind: "debug", title: "Diagnosed a failing `npm test` before the AI", detail: "getUser read .id from an undefined lookup result." });
  addStory(g, { kind: "decision", title: "Chose Sentry over console logs", detail: "Free tier covers us, and it maps stack traces back to source." });
  const growData = {
    trend: trend(g),
    map: skillMap({ ideas: await engine.ideaStates(), growth: g, changesSeen: 14 }),
    tools: [tool],
    decisions: g.decisions,
    incidents: g.incidents,
    story: [...g.story].reverse(),
    storyCount: g.story.length,
    gates: { asked: 3, right: 2 },
    predictions: 4,
    exercise: {},
    practice: {},
    incidentDraft: {},
  };

  const out = {
    state,
    grow: growData,
    debugDone,
    quiz: await engine.quizForConcept(first.conceptId),
    dojo: await engine.dojo(),
    insight: await engine.insight(),
    belts: engine.BELT_NAMES,
    first: first.key,
    lessonId: lesson.id,
  };
  await fs.writeFile(process.argv[2], "window.MOCK = " + JSON.stringify(out) + ";");
  await fs.rm(root, { recursive: true, force: true });
})();
