/**
 * Learning from what the assistant built, end to end over real MCP.
 *
 * The claim is that someone can build with an assistant, never route a single
 * command through the tutor, and still be taught: the change is read, a few
 * ideas are chosen, a question is asked, and it comes back for review. Each of
 * those is asserted here against the running server.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TestClient } from "./harness.js";
import { parseHookPayload, appendObservations } from "../src/observe.js";

async function scratch(name: string): Promise<{ home: string; work: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `miyagi-${name}-`));
  const work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  return { home: path.join(root, "home"), work };
}

async function open(name: string, mode = "ride-along") {
  const { home, work } = await scratch(name);
  const client = new TestClient({ home, cwd: work });
  await client.initialize();
  await client.call("quick_config", { mode, voice_enabled: false, skill_level: "Mid" });
  return { client, home, work };
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    stdio: "pipe",
  });

const ROUTE = [
  "export async function POST(req: Request) {",
  "  const { id } = await req.json();",
  "  const rows = await db.query(`SELECT * FROM users WHERE id = ${id}`);",
  "  return Response.json(rows);",
  "}",
].join("\n");

const DIFF = [
  "diff --git a/app/api/users/route.ts b/app/api/users/route.ts",
  "--- /dev/null",
  "+++ b/app/api/users/route.ts",
  "@@ -0,0 +1,5 @@",
  ...ROUTE.split("\n").map((l) => "+" + l),
].join("\n");

test("the server tells the assistant when to bring the tutor in", async () => {
  const { home, work } = await scratch("instructions");
  const client = new TestClient({ home, cwd: work });
  try {
    const init = await client.initialize();
    assert.match(init.result.instructions, /explain_change/);
    assert.match(init.result.instructions, /debrief/);
    const tools = await client.send("tools/list");
    const names = tools.result.tools.map((t: { name: string }) => t.name);
    assert.ok(names.includes("explain_change") && names.includes("debrief"));
    const prompts = await client.send("prompts/list");
    const promptNames = prompts.result.prompts.map((p: { name: string }) => p.name);
    assert.ok(promptNames.includes("debrief") && promptNames.includes("teach-me-this-change"));
  } finally {
    client.close();
  }
});

test("a diff becomes a short lesson with the dangerous idea first", async () => {
  const { client } = await open("diff");
  try {
    const res = await client.call("explain_change", { diff: DIFF, limit: 2 });
    const text: string = res.result.content[0].text;
    const data = res.result.structuredContent;

    assert.equal(data.concepts[0].id, "sql-interpolation");
    assert.equal(data.concepts[0].status, "new");
    assert.equal(data.concepts[0].file, "app/api/users/route.ts");
    assert.equal(data.concepts.filter((c: any) => c.status === "new").length, 2, "limit was not respected");
    assert.ok(data.concepts.some((c: any) => c.status === "later"), "the overflow was dropped silently");
    assert.equal(data.new_concepts, 2);
    assert.equal(data.xp_awarded, 0, "an idea appearing in code is exposure, and exposure pays nothing");
    assert.ok(data.quiz_id.startsWith("c-sql-interpolation-"), "the question is not about the top idea");

    assert.match(text, /2 ideas worth owning/);
    assert.match(text, /app\/api\/users\/route\.ts/);
    assert.match(text, /How it bites/);
    assert.match(text, /Tutor brief/);
    assert.match(text, /Active Recall Quiz/);
    assert.match(text, /new techniques discovered/);
    assert.match(text, /Dojo: \*\*2\//);
  } finally {
    client.close();
  }
});

test("answering promotes the belt, and a known idea is not taught twice", async () => {
  const { client } = await open("belt");
  try {
    const first = await client.data("explain_change", { diff: DIFF, limit: 1 });
    const stats1 = await client.data("get_user_stats");
    const graded = await client.call("verify_quiz_answer", {
      quiz_id: first.quiz_id,
      answer: first.quiz_id.includes("-2#")
        ? "Table and column names chosen from user input"
        : "The database may run the input as part of the command",
    });
    assert.match(graded.result.content[0].text, /Correct|✅/);
    assert.ok(graded.result.structuredContent.player.xp > stats1.player.xp, "a correct answer paid nothing");

    // Seen again: no discovery XP the second time, and the status says so.
    const second = await client.data("explain_change", { diff: DIFF, limit: 1 });
    assert.equal(second.new_concepts, 1, "the next unseen idea should take the slot");
    assert.notEqual(second.concepts[0].id, "__none__");
    const sql = second.concepts.find((c: any) => c.id === "sql-interpolation");
    assert.notEqual(sql.status, "new", "an idea already taught was called new");

    const dojo = await client.send("resources/read", { uri: "miyagi://dojo" });
    const board: string = dojo.result.contents[0].text;
    assert.match(board, /SQL built by gluing strings together/);
    assert.match(board, /undiscovered/);

    const review = await client.send("resources/read", { uri: "miyagi://review" });
    assert.match(JSON.stringify(review.result), /c-sql-interpolation-/, "the question never reached the review queue");
  } finally {
    client.close();
  }
});

test("with no arguments it reads uncommitted work, including brand-new files", async () => {
  const { client, work } = await open("git");
  try {
    git(work, "init", "-q");
    await fs.writeFile(path.join(work, "README.md"), "# app\n");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "init");
    await fs.mkdir(path.join(work, "src"));
    await fs.writeFile(path.join(work, "src", "Counter.tsx"), "const [n, setN] = useState(0);\nuseEffect(() => { document.title = String(n); }, [n]);\n");

    const res = await client.call("explain_change", { cwd: work });
    const data = res.result.structuredContent;
    assert.match(res.result.content[0].text, /uncommitted changes/);
    assert.deepEqual(data.files, ["src/Counter.tsx"]);
    assert.deepEqual(data.concepts.map((c: any) => c.id).sort(), ["react-effect", "react-state"]);

    // Once committed, the last commit is what "just happened".
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "counter");
    const after = await client.call("explain_change", { cwd: work });
    assert.match(after.result.content[0].text, /last commit/);
    assert.equal(after.result.structuredContent.new_concepts, 0, "discovery XP was paid twice for the same ideas");
  } finally {
    client.close();
  }
});

test("a single file or a bare snippet can be taught from, and bad input is explained", async () => {
  const { client, work } = await open("file");
  try {
    await fs.writeFile(path.join(work, "auth.ts"), "const payload = jwt.verify(token, process.env.JWT_SECRET);\n");
    const byPath = await client.data("explain_change", { cwd: work, path: "auth.ts" });
    assert.deepEqual(byPath.concepts.map((c: any) => c.id).sort(), ["auth-token", "env-vars"]);

    const snippet = await client.data("explain_change", { diff: "const r = await fetch('/api/x');" });
    assert.ok(snippet.concepts.some((c: any) => c.id === "http-fetch"));

    const missing = await client.call("explain_change", { cwd: work, path: "nope.ts" });
    assert.match(missing.result.content[0].text, /Could not read/);
    assert.equal(missing.result.isError ?? false, false, "a missing file should be explained, not thrown");

    const nothing = await client.call("explain_change", { cwd: work });
    assert.match(nothing.result.content[0].text, /not a git repository|No change to read/);
  } finally {
    client.close();
  }
});

test("a debrief teaches from the capture log, once", async () => {
  const { client, home, work } = await open("debrief");
  try {
    process.env.MIYAGI_HOME = home;
    await appendObservations([
      ...parseHookPayload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git status" } }),
      ...parseHookPayload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm install zod" } }),
      ...parseHookPayload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git add -A" } }),
      ...parseHookPayload({
        hook_event_name: "PostToolUse",
        cwd: work,
        tool_name: "Write",
        tool_input: { file_path: path.join(work, "lib", "env.ts"), content: "export const url = process.env.DATABASE_URL;\n" },
      }),
    ]);

    const res = await client.call("debrief", { cwd: work });
    const text: string = res.result.content[0].text;
    const data = res.result.structuredContent;
    assert.equal(data.commands_observed, 3);
    assert.match(text, /ran \*\*3\*\* commands and edited \*\*1\*\* file/);
    assert.match(text, /`git` ×2/);
    assert.match(text, /lib\/env\.ts/);
    assert.equal(data.concepts[0].id, "env-vars");
    assert.ok(data.quiz_id.startsWith("c-env-vars-"));

    // The same session is not replayed on the next call...
    const again = await client.call("debrief", { cwd: work });
    assert.equal(again.result.structuredContent.commands_observed, 0);
    assert.match(again.result.content[0].text, /Nothing to debrief yet|Nothing new/);
    // ...unless asked for.
    const replay = await client.data("debrief", { cwd: work, replay: true });
    assert.equal(replay.commands_observed, 3);
    assert.equal(replay.new_concepts, 0, "a replay paid discovery XP again");
  } finally {
    delete process.env.MIYAGI_HOME;
    client.close();
  }
});

test("a debrief without capture still works from git and says how to turn capture on", async () => {
  const { client, work } = await open("debrief-git");
  try {
    git(work, "init", "-q");
    await fs.writeFile(path.join(work, "api.ts"), "try { await save(); } catch (e) { console.log(e); }\n");
    const res = await client.call("debrief", { cwd: work });
    const text: string = res.result.content[0].text;
    assert.equal(res.result.structuredContent.capture_installed, false);
    assert.match(text, /capture is off/i);
    assert.match(text, /--setup/);
    assert.ok(res.result.structuredContent.concepts.some((c: any) => c.id === "error-handling"));
  } finally {
    client.close();
  }
});

test("focus mode queues the ideas and stays out of the way", async () => {
  const { client } = await open("focus", "focus");
  try {
    const res = await client.call("explain_change", { diff: DIFF });
    const text: string = res.result.content[0].text;
    assert.match(text, /Focus mode/);
    assert.ok(!/How it bites/.test(text), "a lesson was shown to someone who asked for quiet");
    assert.equal(res.result.structuredContent.quiz_id, "", "a question was asked in focus mode");
    assert.ok(res.result.structuredContent.new_concepts > 0, "nothing was queued");

    const review = await client.send("resources/read", { uri: "miyagi://review" });
    assert.match(JSON.stringify(review.result), /c-sql-interpolation-/, "quiet should defer recall, not delete it");
  } finally {
    client.close();
  }
});

test("drill mode asks without being told to, and ride-along can decline the quiz", async () => {
  const { client } = await open("noquiz");
  try {
    const quiet = await client.call("explain_change", { diff: DIFF, quiz: false });
    assert.equal(quiet.result.structuredContent.quiz_id, "");
    assert.match(quiet.result.content[0].text, /review queue/);
    assert.ok(!/Active Recall Quiz/.test(quiet.result.content[0].text));
  } finally {
    client.close();
  }
});
