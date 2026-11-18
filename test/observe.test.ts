/**
 * The editor hook and the settings it is installed into.
 *
 * Both run inside someone else's tool. A hook that fails, prints or leaks is
 * removed the same afternoon, and an installer that eats a settings file is
 * never trusted again, so most of this is about what they must not do.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHookPayload } from "../src/observe.js";
import { summariseObservations } from "../src/teach.js";
import { AGENT_RULES, applyHooks, hookInstalled, mergeClaude, mergeCursor } from "../src/setup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(here, "..", "src", "observe-cli.js");
const SERVER = path.resolve(here, "..", "src", "miyagi.js");

const tmp = (name: string) => fs.mkdtemp(path.join(os.tmpdir(), `miyagi-${name}-`));

function runHook(entry: string, args: string[], stdin: string, home: string) {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: { ...process.env, MIYAGI_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(stdin);
  });
}

/* ---- payloads ---- */

test("a Claude Code Bash call becomes a scrubbed command observation", () => {
  const [o] = parseHookPayload({
    hook_event_name: "PostToolUse",
    session_id: "s1",
    cwd: "/work/app",
    tool_name: "Bash",
    tool_input: { command: "curl -H 'Authorization: Bearer abcdef1234567890abcdef' https://api.example.com\nnpm test" },
  });
  assert.equal(o.kind, "command");
  assert.equal(o.source, "claude-code");
  assert.ok(o.kind === "command" && !o.command.includes("abcdef1234567890"));
  assert.ok(o.kind === "command" && !o.command.includes("\n"), "a multi-line command would break the log");
});

test("edits record the file, the size and the ideas — never the contents", () => {
  const body = "export async function POST(req: Request) {\n  const key = process.env.API_KEY;\n}\n";
  const [o] = parseHookPayload({
    hook_event_name: "PostToolUse",
    cwd: "/work/app",
    tool_name: "Write",
    tool_input: { file_path: "/work/app/app/api/pay/route.ts", content: body },
  });
  assert.ok(o.kind === "edit");
  assert.equal(o.file, path.join("app", "api", "pay", "route.ts"), "paths are stored relative to the project");
  assert.equal(o.added, 3);
  assert.deepEqual(o.concepts.map((c) => c.id).sort(), ["api-route", "async-await", "env-vars"]);
  assert.ok(!JSON.stringify(o).includes("req: Request) {\\n"), "file contents were stored");

  const [multi] = parseHookPayload({
    hook_event_name: "PostToolUse",
    tool_name: "MultiEdit",
    tool_input: { file_path: "a.tsx", edits: [{ new_string: "const [a, setA] = useState(0);" }, { new_string: "useEffect(() => {}, []);" }] },
  });
  assert.ok(multi.kind === "edit" && multi.concepts.length === 2);
});

test("Cursor's hook dialect is understood too", () => {
  const [cmd] = parseHookPayload({ hook_event_name: "afterShellExecution", command: "git status", workspace_roots: ["/w"] });
  assert.ok(cmd.kind === "command" && cmd.source === "cursor" && cmd.cwd === "/w");
  const [edit] = parseHookPayload({
    hook_event_name: "afterFileEdit",
    file_path: "src/x.ts",
    edits: [{ old_string: "", new_string: "const r = await fetch('/api');" }],
  });
  assert.ok(edit.kind === "edit" && edit.concepts.some((c) => c.id === "http-fetch"));
});

test("unknown tools, empty input and the tutor's own plumbing produce nothing", () => {
  assert.deepEqual(parseHookPayload({ tool_name: "Read", tool_input: { file_path: "a.ts" } }), []);
  assert.deepEqual(parseHookPayload({ tool_name: "Bash", tool_input: { command: "   " } }), []);
  assert.deepEqual(parseHookPayload({ tool_name: "Bash", tool_input: { command: "npx -y -p miyagi-mcp miyagi-observe" } }), []);
  assert.deepEqual(parseHookPayload({ tool_name: "Edit", tool_input: { file_path: "a.ts", new_string: "" } }), []);
  for (const junk of [null, 42, "x", [], { tool_name: 7 }, { tool_name: "Bash" }, { tool_name: "Write", tool_input: "nope" }]) {
    assert.deepEqual(parseHookPayload(junk), []);
  }
  // A project that happens to be called miyagi is not plumbing.
  assert.equal(parseHookPayload({ tool_name: "Bash", tool_input: { command: "cd miyagi && npm test" } }).length, 1);
});

test("observations summarise into commands, files and sightings", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-01-01T00:05:00Z");
  const obs = [
    ...parseHookPayload({ tool_name: "Bash", tool_input: { command: "npm test" } }, now),
    ...parseHookPayload({ tool_name: "Bash", tool_input: { command: "npm test" } }, now),
    ...parseHookPayload({ tool_name: "Write", tool_input: { file_path: "a.tsx", content: "useEffect(() => {}, []);\n" } }, later),
  ];
  const s = summariseObservations(obs);
  assert.equal(s.commandTotal, 2);
  assert.deepEqual(s.commands, [{ command: "npm test", count: 2 }]);
  assert.deepEqual(s.files, ["a.tsx"]);
  assert.equal(s.newest, later.toISOString());
});

/* ---- the hook process ---- */

test("the hook appends one line, prints nothing and exits 0", async () => {
  const home = await tmp("hook");
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "git status" },
  });
  const res = await runHook(HOOK, [], payload, home);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, "", "a hook that prints is injecting text into the editor");
  const lines = (await fs.readFile(path.join(home, "observations.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).command, "git status");

  // The server binary accepts the same job through a flag.
  const viaFlag = await runHook(SERVER, ["--observe"], payload, home);
  assert.equal(viaFlag.code, 0);
  assert.equal(viaFlag.stdout, "");
  assert.equal((await fs.readFile(path.join(home, "observations.jsonl"), "utf8")).trim().split("\n").length, 2);
});

test("the hook survives garbage, silence and an unwritable home", async () => {
  const home = await tmp("hook-bad");
  for (const input of ["", "not json", "{", "[1,2,3]", '{"tool_name":"Bash"}']) {
    const res = await runHook(HOOK, [], input, home);
    assert.equal(res.code, 0, `exited non-zero on ${JSON.stringify(input)}`);
    assert.equal(res.stdout, "");
  }
  const file = path.join(home, "a-file");
  await fs.writeFile(file, "x");
  const blocked = await runHook(HOOK, [], JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }), path.join(file, "nested"));
  assert.equal(blocked.code, 0, "a hook must never fail the tool call it follows");
});

/* ---- installing it ---- */

test("installing merges into existing settings and is idempotent", () => {
  const existing = {
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "prettier --write" }] }],
      Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
    },
  };
  const once = mergeClaude(existing, "node x.js # miyagi-observe");
  const twice = mergeClaude(once, "node x.js # miyagi-observe");
  assert.deepEqual(once, twice, "running setup twice added a second hook");
  const post = (once.hooks as any).PostToolUse;
  assert.equal(post.length, 2);
  assert.equal(post[0].hooks[0].command, "prettier --write", "someone else's hook was disturbed");
  assert.deepEqual((once.hooks as any).Stop, existing.hooks.Stop);
  assert.deepEqual(once.permissions, existing.permissions);

  const removed = mergeClaude(once, null);
  assert.deepEqual(removed, existing, "uninstall did not restore the original settings");
  assert.deepEqual(mergeClaude({}, null), {});
});

test("Cursor hooks follow the same rules", () => {
  const existing = { version: 1, hooks: { afterFileEdit: [{ command: "./fmt.sh" }] } };
  const once = mergeCursor(existing, "miyagi-observe");
  assert.deepEqual(mergeCursor(once, "miyagi-observe"), once);
  assert.equal((once.hooks as any).afterFileEdit.length, 2);
  assert.equal((once.hooks as any).afterShellExecution.length, 1);
  assert.deepEqual(mergeCursor(once, null), existing);
});

test("setup writes the file, reports honestly, and refuses to overwrite broken JSON", async () => {
  const cwd = await tmp("setup");
  const first = await applyHooks({ client: "claude", scope: "project", cwd, command: "node x # miyagi-observe" });
  assert.equal(first.status, "installed");
  assert.equal(await hookInstalled("claude", cwd), first.file);
  const again = await applyHooks({ client: "claude", scope: "project", cwd, command: "node x # miyagi-observe" });
  assert.equal(again.status, "already");

  const dry = await applyHooks({ client: "cursor", scope: "project", cwd, dryRun: true, command: "miyagi-observe" });
  assert.equal(dry.status, "installed");
  assert.match(dry.detail, /would be/);
  assert.equal(await hookInstalled("cursor", cwd), null, "a dry run wrote a file");

  const gone = await applyHooks({ client: "claude", scope: "project", cwd, remove: true });
  assert.equal(gone.status, "removed");
  assert.equal(await hookInstalled("claude", cwd), null);
  assert.equal((await applyHooks({ client: "claude", scope: "project", cwd, remove: true })).status, "absent");

  const broken = await tmp("setup-broken");
  await fs.mkdir(path.join(broken, ".claude"));
  const file = path.join(broken, ".claude", "settings.local.json");
  await fs.writeFile(file, "{ this is not json");
  const res = await applyHooks({ client: "claude", scope: "project", cwd: broken, command: "miyagi-observe" });
  assert.equal(res.status, "skipped");
  assert.equal(await fs.readFile(file, "utf8"), "{ this is not json", "a settings file was overwritten");
});

test("the agent rules name the tools they ask for", () => {
  for (const tool of ["explain_change", "debrief", "review_due_items", "quick_config"]) {
    assert.ok(AGENT_RULES.includes(tool), `rules do not mention ${tool}`);
  }
});
