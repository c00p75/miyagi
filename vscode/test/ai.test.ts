import { test } from "node:test";
import assert from "node:assert/strict";
import {
  available,
  customProvider,
  editorProvider,
  explainPrompt,
  findBinary,
  resolveProvider,
  runProcess,
  type AiOptions,
  type EditorModels,
} from "../src/ai.js";

const base: AiOptions = { setting: "auto", model: "", customCommand: "", editor: null, bundled: {} };
const never = new AbortController().signal;
const prompt = { system: "SYSTEM LINE", user: "USER LINE" };

test("a custom command receives the prompt on stdin and its stdout is the answer", async () => {
  const provider = customProvider(`"${process.execPath}" -e "process.stdin.pipe(process.stdout)"`);
  const out = await provider.run(prompt, never);
  assert.match(out, /SYSTEM LINE/);
  assert.match(out, /USER LINE/);
});

test("a failing command reports its exit code and the end of its output", async () => {
  const provider = customProvider(`"${process.execPath}" -e "console.error('not signed in'); process.exit(3)"`);
  await assert.rejects(provider.run(prompt, never), /code 3.*not signed in/);
});

test("an empty answer is an error, not a blank card", async () => {
  const provider = customProvider(`"${process.execPath}" -e "process.stdin.resume(); process.stdin.on('end', () => {})"`);
  await assert.rejects(provider.run(prompt, never), /empty answer/);
});

test("a run can be cancelled and can time out", async () => {
  const hang = ["-e", "setInterval(() => {}, 1000)"];
  const controller = new AbortController();
  const pending = runProcess(process.execPath, hang, "", controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(runProcess(process.execPath, hang, "", never, { timeoutMs: 200 }), /no answer/);
});

test("binaries are found on PATH, then among bundled copies", () => {
  assert.ok(findBinary("node"));
  assert.equal(findBinary("definitely-not-a-real-binary-xyz"), null);
  assert.equal(findBinary("definitely-not-a-real-binary-xyz", [process.execPath]), process.execPath);
});

test("off means off, and a chosen provider that is missing says why", async () => {
  const off = await resolveProvider({ ...base, setting: "off" });
  assert.equal(off.provider, null);
  const custom = await resolveProvider({ ...base, setting: "custom" });
  assert.equal(custom.provider, null);
  assert.match(custom.reason ?? "", /customCommand is empty/);
  const editor = await resolveProvider({ ...base, setting: "editor" });
  assert.match(editor.reason ?? "", /not offering any chat models/);
});

test("the editor's models are used, preferring a small one", async () => {
  const sent: string[] = [];
  const editor: EditorModels = {
    list: async () => [
      { id: "big", name: "GPT Large", family: "gpt-large" },
      { id: "small", name: "GPT Mini", family: "gpt-mini" },
    ],
    send: async (id, text) => {
      sent.push(id);
      return `answer to: ${text.slice(0, 11)}`;
    },
  };
  const resolved = await resolveProvider({ ...base, setting: "editor", editor });
  assert.equal(resolved.provider?.label, "GPT Mini");
  assert.equal(await resolved.provider!.run(prompt, never), "answer to: SYSTEM LINE");
  assert.deepEqual(sent, ["small"]);

  const named = await resolveProvider({ ...base, setting: "editor", editor, model: "gpt-large" });
  assert.equal(named.provider?.label, "GPT Large");
  assert.equal(editorProvider(editor, { id: "big", name: "GPT Large", family: "x" }).id, "editor");
});

test("an editor that throws while listing models is treated as having none", async () => {
  const editor: EditorModels = {
    list: async () => {
      throw new Error("not implemented in this fork");
    },
    send: async () => "",
  };
  const found = await available({ ...base, editor });
  assert.equal(found.some((a) => a.id === "editor"), false);
});

test("the assistant seen doing the work is preferred in auto", async () => {
  const editor: EditorModels = { list: async () => [{ id: "m", name: "Model", family: "f" }], send: async () => "x" };
  const options = { ...base, editor, bundled: { claude: [process.execPath] } };
  const unseen = await available(options);
  const seen = await available({ ...options, seen: "claude-code" as const });
  // Only meaningful when no real `claude` is on PATH ahead of the bundled stand-in.
  assert.equal(seen[0].id, "claude");
  assert.equal(seen.filter((a) => a.id === "claude").length, 1);
  assert.equal(unseen[0].id, "editor");
});

test("the prompt carries the excerpt, the depth and the length limit", () => {
  const p = explainPrompt({
    title: "Storing passwords as hashes",
    what: "A one-way scramble.",
    depth: "Junior",
    file: "auth.ts",
    excerpt: "3:   const hash = await bcrypt.hash(password, 12);",
    evidence: "",
  });
  assert.match(p.user, /3: {3}const hash = await bcrypt\.hash/);
  assert.match(p.user, /new to programming/);
  assert.match(p.user, /At most 110 words/);
  assert.doesNotMatch(p.system, /["'\n]/, "the system line is passed as an argument; keep it shell-plain");

  const bare = explainPrompt({ title: "t", what: "w", depth: "Senior", file: "f", excerpt: null, evidence: "x = 1" });
  assert.match(bare.user, /The line that uses it: x = 1/);
});
