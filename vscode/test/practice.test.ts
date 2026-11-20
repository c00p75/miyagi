/**
 * The detectors behind the daily practice: guardrails on a staged diff,
 * major version upgrades, functions worth reading cold, and the mock
 * interview's questions. Each one must fire on what it is for and stay quiet
 * on ordinary code, because a guardrail that cries wolf gets ignored.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GUARDRAILS,
  checkGuardrails,
  diffLines,
  findFunctions,
  isBreaking,
  majorOf,
  pickFunction,
  planInterview,
  readableFile,
  upgradesIn,
  type DiffLine,
} from "../src/practice.js";
import { emptyGrowth, normaliseGrowth } from "../src/growth.js";
import { skillMap } from "../src/skills.js";
import { parseReading, parseUpgrade } from "../src/prompts.js";

let home = "";
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-practice-"));
  process.env.MIYAGI_HOME = home;
});
after(() => fs.rm(home, { recursive: true, force: true }));

const added = (file: string, ...lines: string[]): DiffLine[] => lines.map((text, i) => ({ file, line: i + 1, text, sign: "+" as const }));
const ids = (lines: DiffLine[]) => checkGuardrails(lines).map((f) => f.id);

/* ---- reading a diff ---------------------------------------------- */

test("a unified diff gives added and removed lines with their real line numbers", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -10,2 +10,3 @@",
    " unchanged",
    "-old line",
    "+new line",
    "+another",
    "@@ -40 +41 @@",
    "+later",
  ].join("\n");
  const lines = diffLines(diff);
  assert.deepEqual(
    lines.map((l) => [l.sign, l.line, l.text]),
    [
      ["-", 11, "old line"],
      ["+", 11, "new line"],
      ["+", 12, "another"],
      ["+", 41, "later"],
    ],
  );
  assert.ok(lines.every((l) => l.file === "src/a.ts"));
});

/* ---- guardrails ---------------------------------------------------- */

test("each guardrail fires on the thing it is for", () => {
  const fake = ["sk", "live", "x".repeat(24)].join("_");
  assert.deepEqual(ids(added(".env.local", `STRIPE_SECRET_KEY=${fake}`)), ["env-file"]);
  assert.deepEqual(ids(added("src/lib/pay.ts", "const k = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;")), ["public-secret"]);
  assert.deepEqual(ids(added("components/Admin.tsx", "createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)")), ["service-role-client"]);
  assert.deepEqual(ids(added("firestore.rules", "      allow read, write: if true;")), ["open-rules"]);
  assert.deepEqual(ids(added("src/server.ts", "app.use(cors({ origin: '*', credentials: true }));")), ["cors-any"]);
  assert.deepEqual(ids(added("app/post.tsx", "<div dangerouslySetInnerHTML={{ __html: body }} />")), ["raw-html"]);
  assert.deepEqual(ids(added("app/api/webhooks/stripe/route.ts", "const event = await req.json();", "if (event.type === 'checkout.session.completed') {")), ["webhook-unsigned"]);
  assert.deepEqual(ids(added("src/auth.ts", "console.log('login', email, password);")), ["log-secret"]);
  assert.deepEqual(ids(added("sentry.server.config.ts", "  tracesSampleRate: 1.0,")), ["sample-rate-full"]);
  assert.deepEqual(ids(added("src/api/users.ts", "const users = await prisma.user.findMany();")), ["unbounded-query"]);
  assert.deepEqual(ids(added("src/ai.ts", "const r = await client.messages.create({ model, messages });")), ["llm-no-cap"]);
  assert.deepEqual(ids(added("vercel.json", '  "crons": [{ "path": "/api/sync", "schedule": "* * * * *" }]')), ["tight-cron"]);
});

test("guardrails stay quiet when the safeguard is there, or the code is ordinary", () => {
  assert.deepEqual(ids(added(".env.example", "STRIPE_SECRET_KEY=")), [], "an example env file is meant to be committed");
  assert.deepEqual(ids(added("src/lib/pay.ts", "const k = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;")), []);
  assert.deepEqual(ids(added("app/api/admin/route.ts", "createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)")), [], "server code may hold the service key");
  assert.deepEqual(ids(added("app/api/webhooks/stripe/route.ts", "const body = await req.text();", "const event = stripe.webhooks.constructEvent(body, sig, secret);", "const data = await req.json();")), []);
  assert.deepEqual(ids(added("sentry.server.config.ts", "  tracesSampleRate: 0.1,")), []);
  assert.deepEqual(ids(added("src/api/users.ts", "const users = await prisma.user.findMany({ take: 20 });")), []);
  assert.deepEqual(ids(added("src/api/users.ts", "const users = await prisma.user.findMany();", "  // later: take")), [], "a limit word nearby counts as handled");
  assert.deepEqual(ids(added("src/ai.ts", "await client.messages.create({ model, max_tokens: 1024, messages });")), []);
  assert.deepEqual(ids(added("src/auth.test.ts", "console.log('login', email, password);")), [], "tests are left alone");
  assert.deepEqual(ids(added("README.md", "Set tracesSampleRate: 1.0 in development.")), [], "docs are left alone");
  assert.deepEqual(ids(added("src/a.ts", "const total = items.reduce((a, b) => a + b, 0);", "return <div>{text}</div>;")), []);
});

test("a finding about an env file never repeats the secret", () => {
  const fake = ["sk", "live", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
  const [f] = checkGuardrails(added(".env", `STRIPE_SECRET_KEY=${fake}`));
  assert.equal(f.code, "STRIPE_SECRET_KEY=…");
  assert.ok(!JSON.stringify(f).includes(fake));
});

test("findings come security first, one per rule per file, at most eight", () => {
  const lines = [
    ...added("sentry.server.config.ts", "tracesSampleRate: 1.0,"),
    ...added("app/x.tsx", "<p dangerouslySetInnerHTML={{ __html: a }} />", "<p dangerouslySetInnerHTML={{ __html: b }} />"),
  ];
  const found = checkGuardrails(lines);
  assert.deepEqual(found.map((f) => f.id), ["raw-html", "sample-rate-full"]);
  assert.equal(found[0].line, 1);
  for (const rule of GUARDRAILS) {
    assert.ok(rule.why.length > 40 && rule.fix.length > 10 && rule.ask.endsWith("?"), `${rule.id} is missing teaching text`);
  }
});

/* ---- upgrades ------------------------------------------------------ */

test("major versions and 0.x minors are breaking; patches and minors are not", () => {
  assert.deepEqual(majorOf("^14.2.3"), { major: 14, minor: 2 });
  assert.equal(majorOf("latest"), null);
  assert.ok(isBreaking("^14.2.0", "^15.0.0"));
  assert.ok(isBreaking("~0.3.1", "^0.4.0"));
  assert.ok(!isBreaking("^14.2.0", "^14.3.0"));
  assert.ok(!isBreaking("workspace:*", "^2.0.0"));
});

test("an upgrade is read from the removed and added lines of a manifest", () => {
  const lines: DiffLine[] = [
    { file: "package.json", line: 12, text: '    "next": "^14.2.3",', sign: "-" },
    { file: "package.json", line: 12, text: '    "next": "^15.0.1",', sign: "+" },
    { file: "package.json", line: 13, text: '    "react": "^18.2.0",', sign: "-" },
    { file: "package.json", line: 13, text: '    "react": "^18.3.1",', sign: "+" },
    { file: "package.json", line: 3, text: '  "version": "1.0.0",', sign: "-" },
    { file: "package.json", line: 3, text: '  "version": "2.0.0",', sign: "+" },
    { file: "requirements.txt", line: 1, text: "pydantic==1.10.13", sign: "-" },
    { file: "requirements.txt", line: 1, text: "pydantic==2.5.0", sign: "+" },
    { file: "package.json", line: 20, text: '    "zod": "^3.22.0",', sign: "+" },
  ];
  assert.deepEqual(
    upgradesIn(lines).map((u) => `${u.name} ${u.from} -> ${u.to}`),
    ["next ^14.2.3 -> ^15.0.1", "pydantic 1.10.13 -> 2.5.0"],
  );
});

/* ---- reading code cold --------------------------------------------- */

const TS = `import { db } from "./db";

export async function chargeCustomer(id: string, cents: number) {
  const user = await db.users.find(id);
  if (!user) throw new Error("no user");
  if (cents <= 0) return null;
  const charge = await stripe.charges.create({ amount: cents, customer: user.stripeId });
  await db.payments.insert({ userId: id, chargeId: charge.id });
  return charge;
}

const tiny = () => 1;

export const formatMoney = (cents: number) => {
  const units = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  const sign = cents < 0 ? "-" : "";
  const grouped = units.toLocaleString("en-US");
  return \`\${sign}$\${grouped}.\${rest}\`;
};
`;

test("functions worth reading are found with their span, and trivial ones are not", () => {
  const found = findFunctions("src/pay.ts", TS);
  assert.deepEqual(found.map((f) => f.name), ["chargeCustomer", "formatMoney"]);
  assert.equal(found[0].start, 3);
  assert.equal(found[0].end, 10);
  assert.match(found[0].signature, /^export async function chargeCustomer\(id: string, cents: number\)/);
});

test("Python functions are found by indentation", () => {
  const py = ["def short():", "    return 1", "", "def refund(order, amount):", "    if amount <= 0:", "        raise ValueError('amount')", "    payment = order.payment", "    if not payment:", "        return None", "    return gateway.refund(payment.id, amount)", "", "x = 1"].join("\n");
  const found = findFunctions("app/billing.py", py);
  assert.deepEqual(found.map((f) => [f.name, f.start, f.end]), [["refund", 4, 10]]);
});

test("tests, generated and vendored files are not offered for reading", () => {
  assert.ok(readableFile("src/pay.ts"));
  assert.ok(!readableFile("src/pay.test.ts"));
  assert.ok(!readableFile("node_modules/x/index.js"));
  assert.ok(!readableFile("dist/app.min.js"));
  assert.ok(!readableFile("prisma/migrations/001/migration.sql"));
  assert.ok(!readableFile("README.md"));
});

test("a function already read is not offered again", () => {
  const c = findFunctions("src/pay.ts", TS).map((f) => ({ ...f, file: "src/pay.ts" }));
  const picked = pickFunction(c, new Set(["src/pay.ts#chargeCustomer"]), 0);
  assert.equal(picked?.name, "formatMoney");
  assert.equal(pickFunction(c, new Set(["src/pay.ts#chargeCustomer", "src/pay.ts#formatMoney"])), null);
});

test("reading practice counts toward the map", () => {
  const g = emptyGrowth();
  g.reads.push({ at: "", file: "a", name: "x", verdict: "right" }, { at: "", file: "a", name: "y", verdict: "self-right" }, { at: "", file: "a", name: "z", verdict: "wrong" });
  const reading = skillMap({ ideas: new Map(), growth: g, changesSeen: 0 }).skills.find((s) => s.id === "reading");
  assert.equal(reading?.status, "started");
  assert.equal(reading?.progress, "2 of 3 functions read right");
  const back = normaliseGrowth(JSON.parse(JSON.stringify(g)));
  assert.equal(back.reads.length, 3);
  assert.deepEqual(normaliseGrowth({}).interviews, []);
});

/* ---- mock interview ------------------------------------------------- */

test("an interview mixes held ideas, a tool and a story, and asks fewer when there is less", () => {
  const ideas = new Map([
    ["sql-interpolation", { seen: true, box: 4 }],
    ["react-state", { seen: true, box: 2 }],
    ["cors", { seen: false, box: 0 }],
  ]);
  const plan = planInterview({
    ideas,
    tools: [],
    story: [{ kind: "debug", title: "Diagnosed a failing test", detail: "x" }, { kind: "belt", title: "Green belt", detail: "" }],
    seed: 0,
  });
  assert.deepEqual(plan.map((q) => q.kind), ["idea", "idea", "story"]);
  assert.ok(plan.filter((q) => q.kind === "idea").every((q) => q.truth && q.conceptId && /\?|Explain/.test(q.prompt)));
  assert.equal(plan[2].about, "Diagnosed a failing test", "a belt is not a story");
  assert.equal(planInterview({ ideas: new Map(), tools: [], story: [] }).length, 0);
});

/* ---- parsers ------------------------------------------------------- */

test("a reading verdict needs a summary; an upgrade lesson keeps only files that were sent", () => {
  assert.equal(parseReading('{"verdict": "right", "feedback": "ok"}'), null);
  const r = parseReading('{"verdict": "partly", "feedback": "You missed the insert.", "summary": "Charges and records a payment.", "notice": "Line 5 returns null for zero."}');
  assert.equal(r?.verdict, "partly");
  const u = parseUpgrade(
    JSON.stringify({ summary: "App Router caching defaults changed.", changes: [{ title: "fetch no longer cached", why: "Pages may get slower.", file: "app/page.tsx", line: 4 }, { title: "x", why: "y", file: "ghost.ts", line: 1 }], checklist: ["Run the build"] }),
    ["app/page.tsx"],
  );
  assert.equal(u?.changes[0].file, "app/page.tsx");
  assert.equal(u?.changes[1].file, "");
});
