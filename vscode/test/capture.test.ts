/**
 * Capture end to end: the hook is installed into a settings file, the script
 * it points at really runs, and what it writes is what the panel reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  capturedClients,
  detectClients,
  disableCapture,
  enableCapture,
  healCapture,
  hookRuntime,
  hookScriptPath,
  installedHooks,
  setupCapture,
} from "../src/capture.js";
import { readObservations } from "../../src/observe.js";

const dist = path.resolve(__dirname, "..", "dist");

test("enable installs a hook that records a Claude Code edit, and disable removes it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-capture-"));
  const work = path.join(root, "work");
  await fs.mkdir(path.join(work, ".claude"), { recursive: true });
  process.env.MIYAGI_HOME = path.join(root, "home");
  // Someone else's settings must survive.
  const settings = path.join(work, ".claude", "settings.local.json");
  await fs.writeFile(settings, JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }));

  const result = await enableCapture({ extensionDist: dist, client: "claude", scope: "project", cwd: work });
  assert.ok(!("error" in result), JSON.stringify(result));
  assert.equal(result.status, "installed");

  const written = JSON.parse(await fs.readFile(settings, "utf8"));
  assert.deepEqual(written.permissions, { allow: ["Bash(ls:*)"] });
  const command: string = written.hooks.PostToolUse[0].hooks[0].command;
  assert.ok(command.includes(hookScriptPath()), "the hook points at the stable copy, not the extension folder");
  assert.deepEqual(await capturedClients(work), ["claude"]);
  assert.deepEqual(await installedHooks(work), [{ client: "claude", scope: "project", file: settings }]);

  // Run exactly what the editor would run, with the payload it would send.
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    cwd: work,
    session_id: "s1",
    tool_input: { file_path: path.join(work, "auth.ts"), content: "const h = await bcrypt.hash(pw, 12);\n" },
  });
  const stdout = execFileSync(process.execPath, [hookScriptPath()], { input: payload, env: process.env });
  assert.equal(String(stdout), "", "a hook that prints is a hook the assistant can read");

  const seen = await readObservations();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, "edit");
  assert.equal(seen[0].source, "claude-code");
  assert.ok(seen[0].kind === "edit" && seen[0].concepts.some((c) => c.id === "password-hashing"));

  // Idempotent.
  const again = await enableCapture({ extensionDist: dist, client: "claude", scope: "project", cwd: work });
  assert.ok(!("error" in again) && again.status === "already");

  const removed = await disableCapture({ client: "claude", scope: "project", cwd: work });
  assert.equal(removed.status, "removed");
  const after = JSON.parse(await fs.readFile(settings, "utf8"));
  assert.equal(after.hooks, undefined);
  assert.deepEqual(after.permissions, { allow: ["Bash(ls:*)"] });
});

test("a hook left pointing at a stale path is repaired on the next activation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-heal-"));
  const work = path.join(root, "work");
  await fs.mkdir(path.join(work, ".claude"), { recursive: true });
  process.env.MIYAGI_HOME = path.join(root, "home");
  const settings = path.join(work, ".claude", "settings.local.json");
  // What an older install would have written: a Node that has since been removed.
  const stale = {
    hooks: {
      PostToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: '"/old/node" "/old/observe.js" # miyagi-observe' }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "echo someone-elses-hook" }] },
      ],
    },
  };
  await fs.writeFile(settings, JSON.stringify(stale));

  assert.equal(await healCapture({ extensionDist: dist, cwd: work }), 1);
  const healed = JSON.stringify(JSON.parse(await fs.readFile(settings, "utf8")));
  assert.ok(healed.includes(JSON.stringify(hookScriptPath()).slice(1, -1)), "now points at the stable script");
  assert.ok(!healed.includes("/old/node"));
  assert.ok(healed.includes("someone-elses-hook"), "another tool's hook is left alone");
  assert.ok(await fs.stat(hookScriptPath()), "and the script it points at exists");
  // Nothing left to repair.
  assert.equal(await healCapture({ extensionDist: dist, cwd: work }), 0);
  // No hook, no repair, and nothing is created.
  const empty = path.join(root, "empty");
  await fs.mkdir(empty);
  assert.equal(await healCapture({ extensionDist: dist, cwd: empty }), 0);
});

test("without Node the editor's own runtime runs the hook, except on Windows", () => {
  assert.equal(hookRuntime("/Apps/Editor Helper", "/usr/bin/node"), '"/usr/bin/node"');
  const fallback = hookRuntime("/Apps/Editor Helper", null);
  if (process.platform === "win32") assert.equal(fallback, null);
  else assert.equal(fallback, 'ELECTRON_RUN_AS_NODE=1 "/Apps/Editor Helper"');
  assert.equal(hookRuntime(undefined, null), null);
});

test("assistants are detected from the editor, its extensions and their folders", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-detect-"));
  const none = detectClients({ claudeExtension: false, appName: "Visual Studio Code", home });
  assert.ok(!none.includes("cursor"));
  assert.ok(detectClients({ claudeExtension: true, appName: "Antigravity", home }).includes("claude"));
  assert.deepEqual(
    detectClients({ claudeExtension: false, appName: "Cursor", home }).filter((c) => c === "cursor"),
    ["cursor"],
  );
  await fs.mkdir(path.join(home, ".cursor"));
  assert.ok(detectClients({ claudeExtension: false, appName: "Visual Studio Code", home }).includes("cursor"));
});

test("setup reports what it turned on and does not repeat itself", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-setup-"));
  const work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  process.env.MIYAGI_HOME = path.join(root, "home");
  // Setup writes to the global settings file, so point "home" somewhere disposable.
  const realHome = process.env.HOME;
  process.env.HOME = path.join(root, "userhome");
  try {
    const first = await setupCapture({ extensionDist: dist, cwd: work, clients: ["claude", "cursor"] });
    assert.deepEqual(first, { on: ["claude", "cursor"], changed: ["claude", "cursor"], problems: [] });
    const written = JSON.parse(await fs.readFile(path.join(root, "userhome", ".claude", "settings.json"), "utf8"));
    assert.equal(written.hooks.PostToolUse.length, 1);
    const again = await setupCapture({ extensionDist: dist, cwd: work, clients: ["claude", "cursor"] });
    assert.deepEqual(again, { on: ["claude", "cursor"], changed: [], problems: [] });
    assert.deepEqual(await setupCapture({ extensionDist: dist, cwd: work, clients: [] }), { on: [], changed: [], problems: [] });
  } finally {
    process.env.HOME = realHome;
  }
});
