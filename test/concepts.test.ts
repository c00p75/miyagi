/**
 * The code-concept pack: what it claims to see, and the questions it asks.
 *
 * Detection is a set of regular expressions, so the tests that matter are the
 * ones about what it must NOT do: fire on prose, keep a secret, or teach from
 * a lock file. The question rubric is the same one the command bank is held
 * to, because a concept question that can be won by picking the longest
 * choice teaches test-taking, not the concept.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BELTS,
  CONCEPTS,
  CONCEPT_QUESTIONS,
  beltForBox,
  conceptBin,
  conceptById,
  detectConcepts,
  parseUnifiedDiff,
  questionsForConcept,
  scrub,
} from "../src/concepts.js";
import { QUIZ_BANK, allQuestions, ask, grade, pickQuestion, questionById } from "../src/quiz.js";
import {
  UNSEEN,
  dojoRows,
  mergeSightings,
  pickConceptQuestion,
  rankSightings,
  renderConceptCard,
  renderDojo,
} from "../src/teach.js";

const ids = (file: string, code: string) => detectConcepts(file, code).map((h) => h.id);

/* ---- the pack ---- */

test("every concept is complete at every depth and has a way to be recalled", () => {
  assert.ok(CONCEPTS.length >= 20, "a pack this small has nothing to say about most changes");
  const seen = new Set<string>();
  for (const c of CONCEPTS) {
    assert.ok(!seen.has(c.id), `duplicate concept id ${c.id}`);
    seen.add(c.id);
    assert.ok(c.patterns.length, `${c.id} can never be detected`);
    assert.ok(c.hook.length >= 20 && c.hook.length <= 130, `${c.id} needs a one-line hook, not an essay`);
    assert.ok(c.what.length > 40, `${c.id} does not say what it is`);
    assert.ok(c.pitfall.length > 60, `${c.id}'s pitfall has no consequence`);
    assert.ok(c.askTheAi.endsWith("?") || c.askTheAi.endsWith("."), `${c.id} has no question for the assistant`);
    assert.match(c.docs.url, /^https:\/\//, `${c.id} has no docs link`);
    const lenses = [c.lens.Junior, c.lens.Mid, c.lens.Senior];
    for (const l of lenses) assert.ok(l.length > 80, `${c.id} has a stub lens`);
    assert.equal(new Set(lenses).size, 3, `${c.id} says the same thing at every depth`);
    assert.ok(questionsForConcept(c.id).length >= 1, `${c.id} has no recall question`);
  }
});

test("no hook or pitfall falls back on boilerplate", () => {
  const hooks = CONCEPTS.map((c) => c.hook);
  assert.equal(new Set(hooks).size, hooks.length, "two concepts share a hook");
  for (const c of CONCEPTS) {
    assert.ok(!/it is important to|best practice|in conclusion/i.test(c.hook + c.pitfall), `${c.id} reads like a manual`);
  }
});

/* ---- detection ---- */

test("it sees the techniques an assistant typically writes", () => {
  assert.deepEqual(ids("src/App.tsx", "const [n, setN] = useState(0);"), ["react-state"]);
  assert.ok(ids("src/App.tsx", "useEffect(() => { load(); }, []);").includes("react-effect"));
  assert.ok(ids("lib/db.ts", "const url = process.env.DATABASE_URL;").includes("env-vars"));
  assert.ok(ids("app/api/users/route.ts", "export async function POST(req: Request) {").includes("api-route"));
  assert.ok(ids("lib/q.ts", "db.query(`SELECT * FROM users WHERE id = ${id}`)").includes("sql-interpolation"));
  assert.ok(ids("app.py", 'cur.execute(f"SELECT * FROM users WHERE id = {uid}")').includes("sql-interpolation"));
  // A value wrapped in SQL quotes is the most common shape of all, and still an injection.
  assert.ok(
    ids("lib/q.ts", "db.query(`INSERT INTO users (email) VALUES ('${email}')`)").includes("sql-interpolation"),
  );
  assert.ok(
    ids("app.py", "cur.execute(f\"SELECT * FROM users WHERE name = '{name}'\")").includes("sql-interpolation"),
  );
  assert.ok(ids("auth.ts", "const ok = await bcrypt.compare(pw, hash);").includes("password-hashing"));
  assert.ok(ids("auth.ts", "const payload = jwt.verify(token, key);").includes("auth-token"));
  assert.ok(ids("schema.prisma", "model User {").includes("db-schema"));
  assert.ok(ids("package.json", '    "zod": "^3.23.8",').includes("dependency-added"));
  assert.ok(ids("Dockerfile", "FROM node:22-alpine").includes("container-image"));
  assert.ok(ids("x.ts", "const data = res as any;").includes("type-escape"));
  assert.ok(ids("page.tsx", '"use client";').includes("client-server-boundary"));
});

test("it does not claim what is not there", () => {
  assert.deepEqual(ids("README.md", "We use state and effects, and await the results of a fetch."), []);
  assert.deepEqual(ids("notes.txt", "select a table from the menu and update it"), []);
  // A parameterised query is the fix, not the problem.
  assert.ok(!ids("q.ts", 'db.query("SELECT * FROM users WHERE id = $1", [id])').includes("sql-interpolation"));
  // An env reference is not a hard-coded secret.
  assert.ok(!ids("a.ts", "const apiKey = process.env.STRIPE_KEY;").includes("hardcoded-secret"));
  // React patterns do not fire in a Python file.
  assert.ok(!ids("a.py", "useState(0)").includes("react-state"));
});

/* ---- the newer ideas: what each sees, and the look-alike it must leave alone ---- */

const sees = (id: string, file: string, code: string) =>
  assert.ok(ids(file, code).includes(id), `${id} was not seen in: ${code}`);
const ignores = (id: string, file: string, code: string) =>
  assert.ok(!ids(file, code).includes(id), `${id} was claimed from: ${code}`);

test("raw HTML is noticed where it is injected, not where it is cleared or read", () => {
  const id = "xss-html-injection";
  sees(id, "Post.tsx", "<div dangerouslySetInnerHTML={{ __html: post.body }} />");
  sees(id, "list.js", "el.innerHTML = `<li>${comment.text}</li>`;");
  sees(id, "list.js", "out.innerHTML += row;");
  sees(id, "Comment.vue", '<p v-html="comment.body"></p>');
  sees(id, "templates/bio.html", "{{ user.bio|safe }}");
  sees(id, "legacy.js", "document.write(banner);");
  ignores(id, "list.js", 'el.innerHTML = "";');
  ignores(id, "list.js", "if (el.innerHTML === expected) return;");
  ignores(id, "list.js", "el.textContent = comment.text;");
  ignores(id, "notes.md", "Never use dangerouslySetInnerHTML with user input.");
  ignores(id, "templates/bio.html", "<p>Keep your account safe by using a long password.</p>");
});

test("rate limiting is seen as a call or a library, never as the word", () => {
  const id = "rate-limiting";
  sees(id, "server.js", "app.use(rateLimit({ windowMs: 60_000, max: 20 }));");
  sees(id, "server.js", 'import rateLimit from "express-rate-limit";');
  sees(id, "limit.ts", 'import { Ratelimit } from "@upstash/ratelimit";');
  sees(id, "main.py", "from slowapi import Limiter");
  sees(id, "search.js", "const onType = throttle(runSearch, 300);");
  ignores(id, "server.js", "// TODO: rate limit this endpoint and throttle the bots");
  ignores(id, "trim.ts", "const limit = Math.min(items.length, 10);");
  ignores(id, "engine.js", "const throttle = pedal.position * 0.8;");
  ignores(id, "README.md", "We rateLimit( every route.");
});

test("a transaction is seen as a boundary in code, not as a noun or a git verb", () => {
  const id = "db-transaction";
  sees(id, "transfer.ts", "await prisma.$transaction([debit, credit]);");
  sees(id, "transfer.ts", "await db.transaction(async (tx) => {");
  sees(id, "services.py", "    with transaction.atomic():");
  sees(id, "transfer.sql", "BEGIN;");
  sees(id, "transfer.js", 'await client.query("COMMIT");');
  ignores(id, "pay.ts", "const transaction = await stripe.charges.retrieve(id);");
  ignores(id, "pay.py", 'transaction_id = payment["id"]');
  ignores(id, "release.js", 'await run("git", ["commit", "-m", message]);');
  ignores(id, "import.rb", "begin");
  ignores(id, "notes.ts", "// begin transaction here once the schema is ready");
});

test("caching is seen where something is stored or given a lifetime, not in a name", () => {
  const id = "caching";
  sees(id, "users.ts", "const hit = await redis.get(`user:${id}`);");
  sees(id, "users.ts", "userCache.set(id, user);");
  sees(id, "page.tsx", "export const revalidate = 60;");
  sees(id, "data.ts", "const getPosts = unstable_cache(loadPosts);");
  sees(id, "rates.py", "@lru_cache(maxsize=None)");
  sees(id, "assets.js", 'res.setHeader("Cache-Control", "no-store");');
  ignores(id, "totals.ts", "const cached = computeTotals(orders);");
  ignores(id, "totals.ts", "if (cached) return cached;");
  ignores(id, "totals.ts", "let cacheHits = 0;");
  ignores(id, "form.ts", "await form.revalidate();");
  ignores(id, "list.ts", "// cache this later");
});

test("pagination is seen in the mechanics of paging, not in the word page", () => {
  const id = "pagination";
  sees(id, "posts.ts", 'sql("SELECT * FROM posts LIMIT 20 OFFSET 40")');
  sees(id, "posts.ts", "const rows = await db.select().from(posts).offset(skip).limit(take);");
  sees(id, "posts.ts", "skip: (page - 1) * size,");
  sees(id, "posts.ts", "cursor: { id: lastId },");
  sees(id, "views.py", 'page_size = int(request.GET.get("page_size", 20))');
  sees(id, "route.ts", 'const page = Number(searchParams.get("page") ?? 1);');
  ignores(id, "list.ts", "// show the first page of results");
  ignores(id, "Footer.tsx", "<p>Next page</p>");
  ignores(id, "scrape.ts", "const page = await browser.newPage();");
  ignores(id, "db.py", "cursor = conn.cursor()");
  ignores(id, "Save.tsx", 'style={{ cursor: "pointer" }}');
  ignores(id, "styles.css", "  cursor: pointer;");
  ignores(id, "trim.ts", "const limit = 10;");
});

test("a file upload is seen where a file arrives, not wherever a file is mentioned", () => {
  const id = "file-upload";
  sees(id, "upload.js", 'const upload = multer({ dest: "uploads/" });');
  sees(id, "upload.js", 'app.post("/avatar", upload.single("avatar"), save);');
  sees(id, "actions.ts", 'const file = formData.get("avatar") as File;');
  sees(id, "main.py", "async def create(file: UploadFile):");
  sees(id, "Form.tsx", '<input type="file" name="avatar" />');
  sees(id, "presign.ts", "const { url, fields } = await createPresignedPost(s3, params);");
  ignores(id, "config.ts", 'const text = await fs.readFile(file, "utf8");');
  ignores(id, "Form.tsx", '<input type="text" name="file" />');
  ignores(id, "actions.ts", 'const name = formData.get("name");');
  ignores(id, "notes.ts", "// the upload file goes here");
  ignores(id, "download.ts", "const url = await getSignedUrl(s3, new GetObjectCommand(params));");
});

test("a webhook is seen where one is received and verified, not where one is sent or mentioned", () => {
  const id = "webhook";
  sees(id, "route.ts", "const event = stripe.webhooks.constructEvent(body, sig, secret);");
  sees(id, "route.ts", 'const sig = req.headers.get("stripe-signature");');
  sees(id, "clerk.ts", 'import { Webhook } from "svix";');
  sees(id, "server.js", 'app.post("/api/webhooks/github", handler);');
  sees(id, "views.py", "def handle_webhook(request):");
  sees(id, "env.ts", "const secret = process.env.STRIPE_WEBHOOK_SECRET;");
  ignores(id, "notify.js", 'const webhookUrl = "https://hooks.slack.com/services/T000/B000/XXXX";');
  ignores(id, "notify.js", "await fetch(webhookUrl, { method: \"POST\", body });");
  ignores(id, "todo.ts", "// TODO: add a webhook for refunds");
  ignores(id, "README.md", "Stripe calls constructEvent( on our webhook.");
});

test("props are seen on components, not on every function that takes an object", () => {
  const id = "react-props";
  sees(id, "Button.tsx", "interface ButtonProps {");
  sees(id, "Button.tsx", "export function Button({ label, onClick }: ButtonProps) {");
  sees(id, "Avatar.jsx", "const Avatar = ({ src }) => <img src={src} />;");
  sees(id, "Title.jsx", "return <h1>{props.title}</h1>;");
  sees(id, "Layout.tsx", "  children: React.ReactNode;");
  sees(id, "Card.tsx", "      {children}");
  ignores(id, "users.ts", "function createUser({ name, email }: NewUser) {");
  ignores(id, "users.ts", "export async function sendEmail({ to, subject }) {");
  ignores(id, "retry.ts", "const retry = ({ times = 3 }) => times;");
  ignores(id, "tree.ts", "const { children } = node;");
  ignores(id, "Button.py", "interface ButtonProps {");
  ignores(id, "Button.go", "props.title");
});

test("a background job is seen as a schedule or a queue, not as any timer or list", () => {
  const id = "background-job";
  sees(id, "jobs.js", 'cron.schedule("*/5 * * * *", syncInventory);');
  sees(id, "signup.ts", 'await emailQueue.add("welcome", { userId });');
  sees(id, "worker.ts", 'import { Queue, Worker } from "bullmq";');
  sees(id, "tasks.py", "from celery import shared_task");
  sees(id, "digest.ts", 'export default inngest.createFunction({ id: "digest" }, { cron: "0 9 * * *" }, run);');
  sees(id, "Reports.java", "    @Scheduled(fixedRate = 60000)");
  sees(id, "poll.js", "setInterval(poll, 5000);");
  ignores(id, "Toast.tsx", "setTimeout(() => setOpen(false), 3000);");
  ignores(id, "bfs.js", "queue.push(node);");
  ignores(id, "plan.py", "schedule = load_schedule(path)");
  ignores(id, "notes.ts", "// runs from cron every night");
  ignores(id, "grid.ts", 'const cells = "1 2 3 4 5";');
  ignores(id, "README.md", "setInterval( is how we poll.");
});

test("generated and vendored files are never taught from", () => {
  assert.deepEqual(ids("package-lock.json", '"zod": "^3.23.8",'), []);
  assert.deepEqual(ids("node_modules/x/index.js", "useEffect(() => {}, [])"), []);
  assert.deepEqual(ids("dist/app.min.js", "await fetch('/x')"), []);
});

test("a detected secret is never kept as evidence", () => {
  const key = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0";
  const hits = detectConcepts("lib/pay.ts", `const apiKey = "${key}";`);
  const hit = hits.find((h) => h.id === "hardcoded-secret");
  assert.ok(hit, "the secret was not noticed");
  assert.ok(!JSON.stringify(hits).includes(key), "the credential leaked into the evidence");
});

test("scrubbing removes tokens, passwords and URL credentials", () => {
  assert.ok(!scrub('password = "hunter2hunter2"').includes("hunter2"));
  assert.ok(!scrub("curl -H 'Authorization: Bearer abcdef1234567890abcdef'").includes("abcdef1234567890"));
  assert.ok(!scrub("postgres://admin:s3cretpw@db.example.com/app").includes("s3cretpw"));
  assert.ok(!scrub("x=" + "A".repeat(40)).includes("A".repeat(40)));
  assert.equal(scrub("const total = items.length;"), "const total = items.length;");
});

test("pathological input is handled quickly and without throwing", () => {
  const started = Date.now();
  detectConcepts("a.ts", "x".repeat(500_000));
  detectConcepts("a.ts", ("await ".repeat(60) + "\n").repeat(3000));
  detectConcepts("", "");
  assert.ok(Date.now() - started < 3000, "detection is too slow to run in a hook");
});

test("a unified diff is split into per-file added lines", () => {
  const diff = [
    "diff --git a/src/a.tsx b/src/a.tsx",
    "--- a/src/a.tsx",
    "+++ b/src/a.tsx",
    "@@ -1,0 +2,2 @@",
    "+const [open, setOpen] = useState(false);",
    "-const old = 1;",
    "diff --git a/gone.ts b/gone.ts",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-await fetch('/x')",
  ].join("\n");
  const files = parseUnifiedDiff(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0].file, "src/a.tsx");
  assert.equal(files[0].addedLines, 1);
  assert.deepEqual(parseUnifiedDiff("not a diff at all"), []);
});

/* ---- questions: the same rubric as the command bank ---- */

test("concept questions are well formed and reachable by id", () => {
  const seen = new Set<string>();
  for (const q of CONCEPT_QUESTIONS) {
    assert.ok(!seen.has(q.id), `duplicate question id ${q.id}`);
    seen.add(q.id);
    assert.equal(q.choices.length, 4, `${q.id} does not have four choices`);
    assert.equal(q.choices[0], q.answer);
    assert.equal(new Set(q.choices.map((c) => c.toLowerCase().trim())).size, 4, `${q.id} has duplicate choices`);
    assert.ok(q.explanation.length > 40, `${q.id}'s explanation is too thin to teach`);
    assert.ok(conceptById(q.bins[0].replace("concept:", "")), `${q.id} belongs to no concept`);
    assert.equal(questionById(q.id)?.id, q.id, `${q.id} cannot be found for review`);
    assert.ok(!QUIZ_BANK.some((b) => b.id === q.id), `${q.id} collides with the command bank`);
  }
  assert.equal(allQuestions().filter((q) => q.id.startsWith("c-")).length, CONCEPT_QUESTIONS.length);
});

test("no concept question can be won by picking the longest choice", () => {
  const longest = CONCEPT_QUESTIONS.filter(
    (q) => Math.max(...q.choices.map((c) => c.length)) === q.answer.length,
  ).length;
  const share = longest / CONCEPT_QUESTIONS.length;
  assert.ok(share < 0.35, `the answer is the longest choice in ${Math.round(share * 100)}% of questions`);
});

test("no concept question leaks its answer through its own wording", () => {
  for (const q of CONCEPT_QUESTIONS) {
    const question = q.question.toLowerCase();
    const leaked = q.answer
      .toLowerCase()
      .split(/[^a-z0-9$?]+/)
      .filter((w) => w.length > 5 && question.includes(w));
    assert.ok(leaked.length <= 1, `${q.id} leaks its answer: ${leaked.join(", ")}`);
  }
});

test("every concept question grades its own answer and rejects the others", () => {
  for (const q of CONCEPT_QUESTIONS) {
    const asked = ask(q, q.bins[0], { salt: q.id });
    assert.equal(grade(asked, q.answer).correct, true, `${q.id} rejects its own answer`);
    const letter = String.fromCharCode(65 + asked.choices.indexOf(asked.answer));
    assert.equal(grade(asked, letter).correct, true, `${q.id} rejects its own letter`);
    for (const wrong of asked.choices.filter((c) => c !== asked.answer)) {
      assert.equal(grade(asked, wrong).correct, false, `${q.id} accepts a wrong choice: ${wrong}`);
    }
  }
});

test("a command quiz never draws a question about code concepts", () => {
  const everyCommandQuestion = QUIZ_BANK.map((q) => q.id);
  for (let i = 0; i < 40; i++) {
    const q = pickQuestion({ bin: "ls", skillLevel: "Senior", recentIds: everyCommandQuestion, salt: String(i) });
    assert.ok(!q.id.startsWith("c-"), "a React question was asked about ls");
  }
});

/* ---- choosing what to teach ---- */

test("a concept question matches its concept and the learner's depth", () => {
  const junior = pickConceptQuestion("react-effect", "Junior", []);
  assert.equal(junior?.level, "Junior");
  const mid = pickConceptQuestion("react-effect", "Mid", []);
  assert.equal(mid?.level, "Mid", "a Mid learner should get the harder question first");
  const next = pickConceptQuestion("react-effect", "Mid", [mid!.id]);
  assert.notEqual(next?.id, mid?.id, "the same question was asked twice running");
  assert.ok(next?.bins.includes(conceptBin("react-effect")));
  assert.equal(pickConceptQuestion("no-such-concept", "Mid", []), null);
});

test("new and dangerous ideas are taught first; known ones are only named", () => {
  const sightings = mergeSightings([
    { file: "a.tsx", concepts: detectConcepts("a.tsx", "const [a, setA] = useState(0);\nuseEffect(() => {}, []);") },
    { file: "b.ts", concepts: detectConcepts("b.ts", "db.query(`SELECT * FROM t WHERE id = ${id}`); await x();") },
    { file: "c.tsx", concepts: detectConcepts("c.tsx", "const [b, setB] = useState(1);") },
  ]);
  const state = sightings.find((s) => s.id === "react-state")!;
  assert.equal(state.files, 2, "the same idea in two files is one sighting");

  const fresh = rankSightings(sightings, () => UNSEEN, 2);
  assert.equal(fresh.teach[0].id, "sql-interpolation", "the injection risk should lead");
  assert.equal(fresh.teach.length, 2);
  assert.ok(fresh.later.length >= 1);

  const knowsSql = rankSightings(
    sightings,
    (id) => (id === "sql-interpolation" ? { seen: true, box: 4, lapses: 0 } : UNSEEN),
    2,
  );
  assert.ok(!knowsSql.teach.some((s) => s.id === "sql-interpolation"), "a solid concept was re-taught");
  assert.ok(knowsSql.solid.some((s) => s.id === "sql-interpolation"));
});

test("a concept card carries the hook, the line, the bite and a question to ask", () => {
  const [s] = mergeSightings([
    { file: "src/App.tsx", concepts: detectConcepts("src/App.tsx", "useEffect(() => { load(); }, [opts]);") },
  ]);
  const card = renderConceptCard(s, "Mid", UNSEEN, 1);
  assert.match(card, /new technique/);
  assert.match(card, /src\/App\.tsx/);
  assert.match(card, /useEffect/);
  assert.match(card, /How it bites/);
  assert.match(card, /Ask your AI/);
  assert.ok(card.includes(conceptById("react-effect")!.lens.Mid));
});

test("belts track the review box and the dojo shows what is still locked", () => {
  assert.equal(beltForBox(0).name, "White");
  assert.equal(beltForBox(5).name, "Black");
  assert.equal(beltForBox(99).name, "Black");
  assert.equal(beltForBox(-3).name, "White");
  assert.equal(BELTS.length, 6, "one belt per review box");

  const empty = renderDojo(dojoRows(() => UNSEEN));
  assert.match(empty, new RegExp(`0/${CONCEPTS.length}`));
  assert.match(empty, /undiscovered/);

  const some = renderDojo(
    dojoRows((id) => (id === "env-vars" ? { seen: true, box: 5, lapses: 0 } : UNSEEN)),
  );
  assert.match(some, /Environment variables \| ⬛ Black/);
  assert.match(some, /1\*\* at black belt/);
});
