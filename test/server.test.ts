/**
 * The MCP surface, end to end over a real stdio transport.
 *
 * Unit tests over the helpers would happily pass with a tool unregistered, a
 * schema that does not validate, or an entry point that never connects. This
 * suite talks to the compiled server the way a client does.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, "..", "src", "miyagi.js");

let child: ChildProcessWithoutNullStreams;
let home: string;
let nextId = 0;
const waiters = new Map<number, (msg: any) => void>();

function send(method: string, params?: unknown): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
    waiters.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const call = (name: string, args: Record<string, unknown> = {}) =>
  send("tools/call", { name, arguments: args });

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-server-"));
  child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, MIYAGI_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const waiter = msg.id != null ? waiters.get(msg.id) : undefined;
      if (waiter) {
        waiters.delete(msg.id);
        waiter(msg);
      }
    }
  });
  // Diagnostics must go to stderr; anything on stdout that is not a frame
  // would have thrown in the parser above.
  child.stderr.resume();

  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.result.serverInfo.name, "miyagi");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await call("quick_config", { mode: "drill", voice_enabled: false });
});

after(() => {
  child?.kill();
});

test("the handshake advertises tools, resources, prompts and completions", async () => {
  const tools = await send("tools/list");
  const names = tools.result.tools.map((t: { name: string }) => t.name);
  for (const expected of [
    "quick_config",
    "list_roadmaps",
    "set_active_roadmap",
    "get_next_roadmap_command",
    "run_teaching_command",
    "verify_quiz_answer",
    "review_due_items",
    "get_user_stats",
    "export_roadmap_notes",
  ]) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
  // The duplicated voice tool is gone; quick_config owns configuration now.
  assert.ok(!names.includes("configure_voice"));

  const verify = tools.result.tools.find((t: { name: string }) => t.name === "verify_step");
  assert.equal(verify.annotations?.readOnlyHint, false, "verify_step mutates XP and the step index");
  assert.equal(verify.annotations?.idempotentHint, false);

  const resources = await send("resources/list");
  const uris = resources.result.resources.map((r: { uri: string }) => r.uri);
  for (const uri of ["miyagi://profile", "miyagi://roadmap", "miyagi://review", "miyagi://history"]) {
    assert.ok(uris.includes(uri), `missing resource: ${uri}`);
  }

  const prompts = await send("prompts/list");
  const promptNames = prompts.result.prompts.map((p: { name: string }) => p.name);
  assert.deepEqual(promptNames.sort(), ["drill", "explain-last-error", "progress", "review"]);
});

test("track names complete, so nobody has to guess one", async () => {
  const res = await send("completion/complete", {
    ref: { type: "ref/prompt", name: "drill" },
    argument: { name: "roadmap", value: "git" },
  });
  assert.ok(res.result.completion.values.includes("Git and GitHub"));
});

test("an unknown roadmap name is reported rather than silently substituted", async () => {
  const res = await call("quick_config", { roadmap_name: "Rust Wizardry" });
  const text = res.result.content[0].text as string;
  assert.match(text, /No track named/);
  assert.match(text, /list_roadmaps/);
  await call("quick_config", { roadmap_name: "Command Line Basics", category: "Absolute Beginners" });
});

test("set_active_roadmap uses the track length, not a caller-supplied total", async () => {
  const listed = await call("list_roadmaps");
  const beginner = listed.result.structuredContent.tracks.find(
    (t: { name: string }) => t.name === "Command Line Basics",
  );
  assert.ok(beginner);
  await call("set_active_roadmap", {
    category: "Absolute Beginners",
    roadmap_name: "Command Line Basics",
    step_index: 1,
    total_steps: 9999,
  });
  const next = await call("get_next_roadmap_command");
  assert.equal(next.result.structuredContent.total_steps, beginner.steps);
  assert.notEqual(next.result.structuredContent.total_steps, 9999);
});

test("a successful command returns a card and structured output together", async () => {
  const res = await call("run_teaching_command", { command: "printf 'hello miyagi\\n'" });
  const text = res.result.content[0].text as string;
  const data = res.result.structuredContent;

  assert.equal(data.executed, true);
  assert.equal(data.exit_code, 0);
  // Attempt XP only: this command is not a checkpointed step, so there is no
  // verified outcome to pay for.
  assert.equal(data.xp_awarded, 10);
  assert.equal(data.checkpoint, null);
  assert.match(data.quiz_id, /#\d+$/);
  assert.equal(data.player.day_streak, 1, "practising counts a day");

  assert.match(text, /hello miyagi/, "the real output is in the card");
  assert.match(text, /Tutor brief/, "the model is told what to teach");
  assert.match(text, /```mermaid/);
  assert.match(text, /Active Recall Quiz/);
});

test("a failing command teaches instead of throwing", async () => {
  const res = await call("run_teaching_command", { command: "ls /definitely/not/here" });
  assert.equal(res.result.isError ?? false, false, "a failed command is not a tool error");
  assert.equal(res.result.structuredContent.executed, true);
  assert.notEqual(res.result.structuredContent.exit_code, 0);
  assert.match(res.result.content[0].text, /Hotfix Diagnostic/);
});

test("a catastrophic command cannot be confirmed into running", async () => {
  const res = await call("run_teaching_command", {
    command: "rm -rf /",
    confirm_dangerous: true,
    is_dangerous: false,
  });
  const data = res.result.structuredContent;
  assert.equal(data.executed, false);
  assert.equal(data.blocked, true);
  assert.match(res.result.content[0].text, /not executable through this tool/);
});

test("a destructive command dry-runs, then runs once confirmed", async () => {
  const scratch = path.join(home, "scratch");
  await fs.mkdir(scratch, { recursive: true });

  const dry = await call("run_teaching_command", { command: `rm -rf ${scratch}` });
  assert.equal(dry.result.structuredContent.executed, false);
  assert.match(dry.result.content[0].text, /confirm_dangerous/);
  assert.ok(
    await fs.stat(scratch).then(() => true).catch(() => false),
    "the directory is still there",
  );

  const confirmed = await call("run_teaching_command", {
    command: `rm -rf ${scratch}`,
    confirm_dangerous: true,
  });
  assert.equal(confirmed.result.structuredContent.executed, true);
  assert.equal(
    await fs.stat(scratch).then(() => true).catch(() => false),
    false,
    "and now it is gone, because the learner said so",
  );
});

test("a command that would only hit the timeout is refused up front", async () => {
  const res = await call("run_teaching_command", { command: "npm run dev" });
  assert.equal(res.result.structuredContent.executed, false);
  assert.match(res.result.content[0].text, /never exits/);
});

test("the caller's danger flag can only ever prevent execution", async () => {
  const res = await call("run_teaching_command", { command: "printf 'x\\n'", is_dangerous: true });
  assert.equal(res.result.structuredContent.executed, false);
});

test("a quiz is graded once and then consumed", async () => {
  const run = await call("run_teaching_command", { command: "printf 'quiz\\n'" });
  const quizId = run.result.structuredContent.quiz_id;

  const first = await call("verify_quiz_answer", { answer: "A", quiz_id: quizId });
  assert.equal(typeof first.result.structuredContent.correct, "boolean");
  assert.ok(first.result.structuredContent.next_review_in, "graded answers get scheduled");

  const second = await call("verify_quiz_answer", { answer: "A", quiz_id: quizId });
  assert.equal(second.result.structuredContent.correct, false);
  assert.match(second.result.content[0].text, /No Active Quiz/);
});

test("answering with no quiz open says so instead of failing", async () => {
  const res = await call("verify_quiz_answer", { answer: "A", quiz_id: "quiz:not-a-thing#99" });
  assert.match(res.result.content[0].text, /No open question matches/);
});

test("two commands in a row leave both questions answerable", async () => {
  // The old single-slot pendingQuiz silently discarded the first one.
  const a = await call("run_teaching_command", { command: "printf 'a\\n'" });
  const b = await call("run_teaching_command", { command: "printf 'b\\n'" });
  const idA = a.result.structuredContent.quiz_id;
  const idB = b.result.structuredContent.quiz_id;
  assert.notEqual(idA, idB);

  const gradedA = await call("verify_quiz_answer", { answer: "A", quiz_id: idA });
  assert.match(gradedA.result.content[0].text, /Correct|Not Quite/);
  const gradedB = await call("verify_quiz_answer", { answer: "B", quiz_id: idB });
  assert.match(gradedB.result.content[0].text, /Correct|Not Quite/);
});

test("the review tool answers honestly when nothing is due", async () => {
  const res = await call("review_due_items", {});
  const data = res.result.structuredContent;
  assert.ok(data.queue_total > 0, "practice has been scheduled");
  if (data.due_total === 0) {
    assert.match(res.result.content[0].text, /Nothing Due/);
    assert.ok(data.next_due_at, "and says when to come back");
  }
});

test("stats report lifetime numbers and the practice streak", async () => {
  const res = await call("get_user_stats", {});
  const data = res.result.structuredContent;
  assert.ok(data.lifetime.commands >= 4, "read from the durable history");
  assert.equal(data.streak.day_streak, 1);
  assert.equal(data.streak.state, "fresh");
  assert.ok(data.review.total > 0);
  assert.match(res.result.content[0].text, /Per-command Mastery/);
});

test("resources are readable without a tool call", async () => {
  const profile = await send("resources/read", { uri: "miyagi://profile" });
  const parsed = JSON.parse(profile.result.contents[0].text);
  assert.ok(parsed.player.xp > 0);
  assert.equal(parsed.version, 3);

  const review = await send("resources/read", { uri: "miyagi://review" });
  assert.ok(JSON.parse(review.result.contents[0].text).items.length > 0);

  const history = await send("resources/read", { uri: "miyagi://history" });
  assert.ok(JSON.parse(history.result.contents[0].text).entries.length > 0);

  const track = await send("resources/read", { uri: "miyagi://roadmaps/Git%20and%20GitHub" });
  assert.match(track.result.contents[0].text, /# Git and GitHub/);

  const missing = await send("resources/read", { uri: "miyagi://roadmaps/Nope" });
  assert.match(missing.result.contents[0].text, /No track called/);
});

test("notes are written from the durable history, so a restart cannot empty them", async () => {
  const target = path.join(home, "NOTES.md");
  const res = await call("export_roadmap_notes", { output_path: target });
  assert.match(res.result.content[0].text, /Notes Exported/);
  const written = await fs.readFile(target, "utf8");
  assert.match(written, /Commands Practised/);
  assert.match(written, /printf/);
  assert.match(written, /Due for Review/);
  assert.match(written, /Weak Spots/);
});

test("prompts render usable instructions", async () => {
  const drill = await send("prompts/get", {
    name: "drill",
    arguments: { roadmap: "Git and GitHub", level: "Mid" },
  });
  const text = drill.result.messages[0].content.text as string;
  assert.match(text, /review_due_items/);
  assert.match(text, /I run the commands/);

  const explain = await send("prompts/get", {
    name: "explain-last-error",
    arguments: { command: "git push", error: "rejected" },
  });
  assert.match(explain.result.messages[0].content.text, /hotfix diagnostic/i);
});

test("progress is on disk in the current profile format", async () => {
  const saved = JSON.parse(await fs.readFile(path.join(home, "profile.json"), "utf8"));
  assert.equal(saved.version, 3);
  assert.ok(saved.player.xp > 0);
  assert.ok(Object.keys(saved.mastery).length > 0);
  assert.ok(saved.review.length > 0);
  assert.equal(saved.streak.dayStreak, 1);
  assert.ok(saved.recentQuizIds.length > 0);
  assert.equal(saved.settings.mode, "drill");
});
