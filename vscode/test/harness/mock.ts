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
import { checkGuardrails, planInterview } from "../../src/practice.js";
import { builtInLesson, parseLesson, type Subject } from "../../src/lesson.js";

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
    findIdeas: "whenNothingFound",
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
  const gate = { kind: "gate", key: "gate:1", at: new Date(now - 10_000).toISOString(), root, files: ["src/api/pay.ts", "src/lib/stripe.ts", "src/db/schema.ts"], lines: 142, signature: "s" };
  const added = (file: string, ...lines: string[]) => lines.map((text, i) => ({ file, line: 10 + i, text, sign: "+" as const }));
  const findings = checkGuardrails([
    ...added("app/api/webhooks/stripe/route.ts", "const event = await req.json();"),
    ...added("sentry.server.config.ts", "  tracesSampleRate: 1.0,"),
    ...added("src/api/orders.ts", "const orders = await prisma.order.findMany();"),
  ]);
  const gateFind = { kind: "gate", key: "gate:2", at: new Date(now - 5_000).toISOString(), root, files: ["app/api/webhooks/stripe/route.ts", "sentry.server.config.ts", "src/api/orders.ts"], lines: 38, signature: "f", findings, shown: [1], kept: [], noQuestion: true };
  const code = ["14: export async function chargeCustomer(id: string, cents: number) {", "15:   const user = await db.users.find(id);", '16:   if (!user) throw new Error("no user");', "17:   if (cents <= 0) return null;", "18:   const charge = await stripe.charges.create({ amount: cents, customer: user.stripeId });", "19:   await db.payments.insert({ userId: id, chargeId: charge.id });", "20:   return charge;", "21: }"].join("\n");
  const read = { kind: "read", key: "read:1", at: new Date(now - 3_000).toISOString(), root, file: "src/lib/billing.ts", name: "chargeCustomer", signature: "export async function chargeCustomer(id: string, cents: number)", start: 14, end: 21, code: "", revealed: false };
  const readDone = { ...read, key: "read:2", code, revealed: true, guess: "Charges the customer the amount through Stripe and returns the charge", result: { verdict: "partly", feedback: "You read the name right: it charges through Stripe. The name hid two things: it records the payment in your database, and it quietly returns null for zero or negative amounts instead of failing.", summary: "Looks up the user, refuses unknown ids, skips non-positive amounts, charges their Stripe customer, records the payment, and returns the charge.", notice: "Line 17 returns null for a zero amount, so a caller that expects a charge object will crash later, not here.", by: "Claude Code (haiku)" } };
  const upgrade = { kind: "upgrade", key: "upgrade:1", at: new Date(now - 90_000).toISOString(), root, name: "next", from: "^14.2.3", to: "^15.0.1", file: "package.json", guessDone: true, guess: "Maybe the router or images", conceptId: "upgrade-next-15", adopted: false,
    lesson: { summary: "Next.js 15 stops caching fetch requests and GET route handlers by default, and request APIs like cookies() and headers() became async.", changes: [{ title: "cookies() and headers() are now async", why: "Code that reads them without await gets a Promise, not the value, and logic that checks the session quietly misbehaves.", file: "app/dashboard/page.tsx", line: 8 }, { title: "fetch is no longer cached by default", why: "Pages that relied on caching now hit your API on every request, which is slower and can cost more.", file: "", line: null }], checklist: ["Run next build and fix every new type error", "Search for cookies( and headers( and add await", "Load the pages that fetch data and compare their speed"], guessFeedback: "The router is involved, but the bigger changes are caching defaults and async request APIs.", question: null, by: "Claude Code (haiku)" } };
  const today = { due: 4, minutes: 2, missed: ["SQL built by gluing strings together"], next: { id: "testing", title: "Write a test that would catch it", sentence: "14 ideas met so far, and nothing yet on \"write a test that would catch it\". A test is how you change code next month without fear." }, canRead: true, readToday: false, open: { debug: 1, gates: 1, upgrades: 1, tools: 0 } };
  // Docker, with the project-specific text from the screenshot that started the design comparison.
  const dockerSpec = specOf(TOOL_CATALOG.find((t) => t.id === "docker")!);
  const docker = {
    ...tool, key: "tool:docker", toolId: "docker", name: dockerSpec.name, emoji: dockerSpec.emoji, job: dockerSpec.job, spec: dockerSpec,
    evidence: "docker-compose.yml", file: "docker-compose.yml", guess: "", guessDone: true, adopted: false, terms: [], termIds: [], held: 0,
    primer: {
      summary: "Docker starts the web app, the API, Postgres and Redis together on any machine, so a clean copy runs with one command.",
      without: "Everyone installs Node, Postgres and Redis by hand at matching versions, and staging drifts from laptops until something works in one place only.",
      wired: [{ file: "docker-compose.yml", line: 3, what: "defines the four services and their network" }],
      flow: ["Developer runs one command to start the whole stack.", "Each service starts in its own sealed environment with its own software.", "The four services reach each other over an internal network.", "Sample data loads so the app has something to show.", "The staging server runs the backend API the same way."],
      risks: [
        { title: "Production fallback never proven", why: "Production hosting is still undecided, and the risk register relies on this setup as the fallback, so it may fail when needed.", kind: "reliability" },
        { title: "Clean-copy setup failing unnoticed", why: "Missing values in the sample settings file may only show up at runtime, so a fresh copy could fail without a clear warning.", kind: "setup" },
        { title: "Staging database exposed", why: "Postgres runs on a shared server reached over SSH, so a mistake in ports or credentials could expose staging data.", kind: "security" },
      ],
      verify: "On a clean copy with internet off, run `docker compose up` and time it. Confirm the sample data loads in under five minutes, as TC-104 requires.",
      guessFeedback: "", by: "Claude Code (haiku)",
    },
  };

  // A lesson as a model would return it, read by the real parser, so the preview shows what the panel would.
  const dockerSubject: Subject = { kind: "tool", name: "Docker", what: dockerSpec.oneLiner, hook: dockerSpec.analogy ?? "", know: dockerSpec.oneLiner, pitfall: dockerSpec.risks[0], analogy: dockerSpec.analogy, flow: dockerSpec.flow, terms: dockerSpec.terms, risks: dockerSpec.risks, verify: dockerSpec.verify, docs: { label: "Docker docs", url: dockerSpec.docs }, file: "docker-compose.yml" };
  const P = (question: string, options: string[], answer: number, why: string) => ({ question, options, answer, why });
  const reply = JSON.stringify({
    sections: {
      problem: {
        hook: "You bake a cake at home and it comes out perfect. You give a friend the same recipe. Their oven runs hotter and their flour is different. Same recipe, different cake.\n\nYou finish the order screen. It works on your laptop. A new teammate downloads the project and runs it.",
        predict: P("What do you think happens?", ["It works the same", "It crashes", "It runs, but slowly"], 1, "It crashes."),
        reveal: { type: "signal", text: "connect ECONNREFUSED 127.0.0.1:5432", notes: [{ part: "ECONNREFUSED", meaning: "“I knocked and nobody answered.”" }, { part: "5432", meaning: "the door your database normally sits behind." }] },
        explain: "The app went looking for its database, and there was none. Your code is fine. Their laptop is missing something yours has.",
        oneLine: "your code is the recipe. It also needs the right kitchen, and every computer's kitchen is different.",
        sayIt: "Say it yourself: why did it crash on their laptop?",
        bridge: "What if you could hand them your whole kitchen, not just the recipe?",
      },
      concept: {
        hook: "**Docker lets you hand over the whole kitchen.** It packs a program together with everything it needs, so it runs the same on any computer.",
        show: { type: "terms", items: [{ term: "Dockerfile", meaning: "The instructions for building the kitchen." }, { term: "Image", meaning: "The finished kitchen, packed in a box." }, { term: "Container", meaning: "The kitchen unpacked and cooking." }] },
        predict: P("Your teammate starts the app with Docker. What is now running on their laptop?", ["A Dockerfile", "An image", "A container"], 2, "A container."),
        explain: "The image is the packed box. Once it is opened and running, it is a container. Many containers can start from one image, and each is identical.",
        oneLine: "an image is the app packed up with everything it needs; a container is that image running.",
        bridge: "How does a text file turn into a running app?",
      },
      how: {
        hook: "From a file to a running app:",
        show: { type: "flow", steps: [{ label: "Dockerfile", note: "you write it" }, { label: "Image", note: "built once" }, { label: "Container", note: "run anywhere" }] },
        predict: P("You run the same image on your laptop and your teammate's. Are the two containers the same?", ["Yes, identical", "No, each laptop changes it", "Only if both have Node installed"], 0, "Yes, identical."),
        explain: "Everything the app needs is already inside the image, including Node itself. Neither laptop adds or changes anything.",
        oneLine: "build once, run anywhere: the image never changes, so every container behaves the same.",
        sayIt: "Explain the difference between an image and a container to a friend.",
        bridge: "That is one program. Your app is more than one. Where does Docker fit?",
      },
      architecture: {
        hook: "Your app is not one program. It is several, working together.",
        predict: P("How many containers do you think your app needs?", ["One", "Two", "Four"], 2, "Four."),
        reveal: { type: "parts", items: [{ name: "Website", role: "what staff click" }, { name: "API", role: "saves orders" }, { name: "Database", role: "keeps orders" }, { name: "Email queue", role: "sends invoices" }] },
        explain: "Each part runs in its own container. One file lists all four and how they connect: `docker-compose.yml`. One command, `docker compose up`, starts them all.",
        oneLine: "one container per part of your app, described together in one file.",
        bridge: "Open that file. What is actually written in it?",
      },
      implementation: {
        hook: "Your `docker-compose.yml`.",
        predict: P("The API needs the database. What do you think `depends_on: [db]` does?", ["Installs a database inside the API", "Starts the database before the API", "Copies the database's data"], 1, "It starts the database first."),
        reveal: { type: "code", lines: [{ code: "api:", why: "A name you chose. This is the part that saves orders." }, { code: "  build: ./api", why: "Build this container's image from your `api` folder." }, { code: "  depends_on: [db]", why: "Start the database before the API, so the API has something to connect to." }, { code: "  image: postgres:16", why: "Download a ready-made image: Postgres 16, the same for everyone." }] },
        explain: "",
        oneLine: "the file is a list of your app's parts, and for each one, where its image comes from and what it needs.",
        bridge: "You run it. How do you know it actually worked?",
      },
      practical: {
        hook: "Run `docker compose ps`. Four parts, four times “running”: that is a healthy app.\n\nNow the mistake almost everyone makes. Someone adds a new setting for invoice emails, but forgets to add it to the sample settings file. A new developer starts the app.",
        predict: P("What happens?", ["The app refuses to start", "Everything starts and looks fine", "The database is deleted"], 1, "Everything starts and looks fine."),
        explain: "That is the trap. All four say “running”. But the first invoice email silently never sends, and nobody notices for days.",
        oneLine: "when you add a setting, add it to the sample file in the same commit.",
        bridge: "Enough reading. Time to change something yourself.",
      },
      application: { task: { goal: "make the website open on port 3001 instead of 3000.", where: "`docker-compose.yml`, in the `web` part.", doneWhen: "`localhost:3001` shows the order screen.", hint: "Look for the line with two numbers and a colon. The left number is the door on your laptop.", experiments: ["you open the old address, `localhost:3000`?", "you stop only the database container, then place an order?", "you change `postgres:16` to `postgres:15`?"] } },
      check: { sayIt: "Without looking back: a friend asks “what is Docker for?” What do you tell them?", predict: P("“It works on my machine but not on yours.” With Docker, why should that stop?", ["Docker makes laptops faster", "Both run the same image", "Docker fixes bugs in the code"], 1, "Both run the same image."), remember: ["Code needs an environment. Docker packs both together.", "Image = packed. Container = running.", "Your app is four containers, listed in one file."] },
    },
    concepts: ["Image", "Container", "Dockerfile", "Volume"],
    deeper: [{ kind: "video", title: "Docker in 100 Seconds", by: "Fireship" }, { kind: "video", title: "Docker Tutorial for Beginners", by: "TechWorld with Nana" }, { kind: "book", title: "Docker Deep Dive", by: "Nigel Poulton" }],
  });
  const lessonSample = { Junior: parseLesson(reply, dockerSubject, "Junior", "Claude Code (haiku)"), builtIn: builtInLesson(dockerSubject, "Mid") };
  Object.assign(state, {
    coach: { items: [docker, gateFind, read, readDone, upgrade, gate, debug], tools: [tool], packages: { [lesson.id]: ["left-pad"] }, offerAi: false, ownWords: {}, today },
    lessonDecisions: {},
    lessonTerms: {},
    tailored: {},
    tailorMode: "off",
    explainBack: true,
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
  const ivPlan = planInterview({ ideas: await engine.ideaStates(), tools: [], story: [{ kind: "debug", title: "Diagnosed a failing npm test before the AI", detail: "getUser read .id from an undefined lookup." }], seed: 1 });
  const interview = {
    questions: ivPlan.map((q) => ({ kind: q.kind, prompt: q.prompt || "Tell me about a time you had to debug something you did not write. What did you do first?", about: q.about })),
    at: 0, shownAt: Date.now() - 95_000, seconds: 150, answers: [], done: false,
  };
  const growData = {
    interviews: [{ at: new Date().toISOString(), asked: 4, right: 2, partly: 1 }],
    reads: 3,
    interview: null as unknown,
    interviewActive: interview,
    trend: trend(g),
    map: skillMap({ ideas: await engine.ideaStates(), growth: g, changesSeen: 14 }),
    tools: [tool],
    decisions: g.decisions,
    incidents: g.incidents,
    story: [...g.story].reverse(),
    storyCount: g.story.length,
    gates: { asked: 3, right: 2 },
    exercise: {},
    practice: {},
    incidentDraft: {},
  };

  const out = {
    state,
    grow: growData,
    lessonSample,
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
