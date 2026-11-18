/**
 * Asking the learner's own AI.
 *
 * Miyagi has no account, no key and no server. When a card needs an
 * explanation tied to the learner's code, it is written by an assistant they
 * already pay for, on their existing login:
 *
 * - `editor`  the chat models the editor exposes to extensions
 * - `claude`  Claude Code, run headless (`claude -p`)
 * - `codex`   Codex, run headless (`codex exec`)
 * - `gemini`  Gemini CLI, run headless (`gemini -p`)
 * - `custom`  any command that reads stdin and prints an answer
 *
 * The headless runs are deliberately separate from the session doing the real
 * work: a fresh process in a temp directory, no tools, no project context, a
 * small model. Nothing the tutor asks can reach the assistant's conversation,
 * which is the whole reason this lives in a panel and not in the chat.
 *
 * No `vscode` import: the editor's models arrive through `EditorModels`, so
 * the selection and process handling can be tested without an editor.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ProviderId = "editor" | "claude" | "codex" | "gemini" | "custom";
export type ProviderSetting = ProviderId | "auto" | "off";

export interface Prompt {
  /** One plain line. It is passed as a command-line argument on some providers. */
  system: string;
  user: string;
}

export interface Provider {
  id: ProviderId;
  /** Shown under each explanation: "Claude Code (haiku)". */
  label: string;
  run(prompt: Prompt, signal: AbortSignal): Promise<string>;
}

export interface EditorModel {
  id: string;
  name: string;
  family: string;
}

/** The editor's language-model API, reduced to what this module needs. */
export interface EditorModels {
  list(): Promise<EditorModel[]>;
  send(modelId: string, text: string, signal: AbortSignal): Promise<string>;
}

export interface AiOptions {
  setting: ProviderSetting;
  model: string;
  customCommand: string;
  editor: EditorModels | null;
  /** Absolute paths of binaries shipped inside other editor extensions. */
  bundled: Partial<Record<"claude" | "codex" | "gemini", string[]>>;
  /** The assistant last seen working, from the hook log. Breaks ties in `auto`. */
  seen?: "claude-code" | "cursor" | "unknown" | null;
}

/* ------------------------------------------------------------------ *
 * Finding binaries
 * ------------------------------------------------------------------ */

const isWindows = process.platform === "win32";

function isExecutable(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (isWindows) return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * An editor launched from the dock does not always inherit the shell's PATH,
 * so the usual install locations are checked as well.
 */
function searchDirs(env: NodeJS.ProcessEnv): string[] {
  const home = os.homedir();
  const fromPath = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const usual = isWindows
    ? [path.join(home, "AppData", "Roaming", "npm"), path.join(home, ".local", "bin")]
    : [
        path.join(home, ".local", "bin"),
        path.join(home, ".claude", "local"),
        path.join(home, ".npm-global", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ];
  return [...new Set([...fromPath, ...usual])];
}

export function findBinary(
  name: string,
  bundled: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const names = isWindows ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
  for (const dir of searchDirs(env)) {
    for (const n of names) {
      const candidate = path.join(dir, n);
      if (isExecutable(candidate)) return candidate;
    }
  }
  // The copy inside an editor extension is the fallback, not the first choice:
  // a learner who installed the CLI themselves is running the newer one.
  return bundled.find(isExecutable) ?? null;
}

/* ------------------------------------------------------------------ *
 * Running a command
 * ------------------------------------------------------------------ */

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 200_000;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function quoteForShell(arg: string): string {
  return /^[A-Za-z0-9_\-./:=\\]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

export function runProcess(
  command: string,
  args: readonly string[],
  input: string,
  signal: AbortSignal,
  options: { shell?: boolean; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("cancelled"));
    // A `.cmd` shim cannot be spawned directly on Windows.
    const shim = /\.(cmd|bat)$/i.test(command);
    const spawnOptions = { cwd: os.tmpdir(), env: childEnv(), windowsHide: true };
    const child = options.shell
      ? // The learner's own command line, passed to the shell exactly as they wrote it.
        spawn(command, { ...spawnOptions, shell: true })
      : shim
      ? spawn([quoteForShell(command), ...args.map(quoteForShell)].join(" "), { ...spawnOptions, shell: true })
      : spawn(command, [...args], spawnOptions);

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      child.kill();
      finish(() => reject(new Error("cancelled")));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`no answer after ${Math.round((options.timeoutMs ?? TIMEOUT_MS) / 1000)}s`)));
    }, options.timeoutMs ?? TIMEOUT_MS);
    signal.addEventListener("abort", onAbort);

    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });
    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
    // A provider that never reads stdin closes the pipe; that is not our error.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
}

function childEnv(): NodeJS.ProcessEnv {
  // If the headless assistant has hooks configured, ours must not log the
  // tutor's own question as something the learner's assistant did.
  return { ...process.env, MIYAGI_OBSERVE: "off" };
}

function failure(name: string, result: RunResult): Error {
  const detail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-3).join(" ").slice(0, 300);
  return new Error(`${name} exited with code ${result.code ?? "?"}${detail ? `: ${detail}` : ""}`);
}

const looksLikeBadFlag = (r: RunResult) =>
  r.code !== 0 && /unknown (option|argument)|unexpected argument|unrecognized (option|argument)/i.test(r.stderr + r.stdout);

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

function clean(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("the AI returned an empty answer");
  return trimmed.length > 4_000 ? trimmed.slice(0, 4_000) + "…" : trimmed;
}

function joined(prompt: Prompt): string {
  return `${prompt.system}\n\n${prompt.user}`;
}

/** Cheap by default: an explanation of twenty lines does not need the largest model. */
const CLAUDE_DEFAULT_MODEL = "haiku";

export function claudeProvider(bin: string, model: string): Provider {
  const chosen = model || CLAUDE_DEFAULT_MODEL;
  return {
    id: "claude",
    label: `Claude Code (${chosen})`,
    async run(prompt, signal) {
      // No tools, no MCP servers, no saved session, its own system prompt: a
      // single question and answer that leaves no trace in the working session.
      const strict = [
        "-p",
        "--model",
        chosen,
        "--tools",
        "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--system-prompt",
        prompt.system,
      ];
      let result = await runProcess(bin, strict, prompt.user, signal);
      if (looksLikeBadFlag(result)) {
        // An older Claude Code. Fewer guarantees, same answer.
        result = await runProcess(bin, ["-p", "--model", chosen], joined(prompt), signal);
      }
      if (result.code !== 0) throw failure("Claude Code", result);
      return clean(result.stdout);
    },
  };
}

export function codexProvider(bin: string, model: string): Provider {
  return {
    id: "codex",
    label: model ? `Codex (${model})` : "Codex",
    async run(prompt, signal) {
      const out = path.join(os.tmpdir(), `miyagi-codex-${process.pid}-${Date.now()}.txt`);
      const base = ["exec", "--skip-git-repo-check", "-s", "read-only", "--color", "never", "-o", out];
      const withModel = model ? [...base, "-m", model] : base;
      try {
        let result = await runProcess(bin, [...withModel, "--ephemeral", "-"], joined(prompt), signal);
        if (looksLikeBadFlag(result)) {
          result = await runProcess(bin, [...withModel, "-"], joined(prompt), signal);
        }
        if (result.code !== 0) throw failure("Codex", result);
        // stdout carries progress lines as well; the file holds only the answer.
        const last = await fsp.readFile(out, "utf8").catch(() => "");
        return clean(last || result.stdout);
      } finally {
        await fsp.rm(out, { force: true }).catch(() => undefined);
      }
    },
  };
}

export function geminiProvider(bin: string, model: string): Provider {
  return {
    id: "gemini",
    label: model ? `Gemini CLI (${model})` : "Gemini CLI",
    async run(prompt, signal) {
      const args = ["-p", "Answer the request on standard input. Reply with the answer only."];
      const result = await runProcess(bin, model ? [...args, "-m", model] : args, joined(prompt), signal);
      if (result.code !== 0) throw failure("Gemini CLI", result);
      return clean(result.stdout);
    },
  };
}

export function customProvider(command: string): Provider {
  const name = command.trim().split(/\s+/)[0] ?? "custom";
  return {
    id: "custom",
    label: path.basename(name),
    async run(prompt, signal) {
      const result = await runProcess(command, [], joined(prompt), signal, { shell: true });
      if (result.code !== 0) throw failure(name, result);
      return clean(result.stdout);
    },
  };
}

function pickEditorModel(models: readonly EditorModel[], wanted: string): EditorModel | null {
  if (!models.length) return null;
  if (wanted) {
    const w = wanted.toLowerCase();
    const match = models.find(
      (m) => m.id.toLowerCase() === w || m.family.toLowerCase() === w || m.name.toLowerCase().includes(w),
    );
    if (match) return match;
  }
  // Small models first: the names differ by vendor, the word for "small" mostly does not.
  return models.find((m) => /mini|haiku|flash|small|nano/i.test(`${m.family} ${m.name}`)) ?? models[0];
}

export function editorProvider(editor: EditorModels, model: EditorModel): Provider {
  return {
    id: "editor",
    label: model.name,
    async run(prompt, signal) {
      return clean(await editor.send(model.id, joined(prompt), signal));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Choosing one
 * ------------------------------------------------------------------ */

export interface Available {
  id: ProviderId;
  label: string;
  /** Where it was found, for the picker. */
  detail: string;
  provider: Provider;
}

/** Every provider that could answer right now, in `auto` preference order. */
export async function available(options: AiOptions): Promise<Available[]> {
  const out: Available[] = [];
  const add = (provider: Provider, detail: string) =>
    out.push({ id: provider.id, label: provider.label, detail, provider });

  const claude = findBinary("claude", options.bundled.claude);
  const codex = findBinary("codex", options.bundled.codex);
  const gemini = findBinary("gemini", options.bundled.gemini);

  let editorModels: EditorModel[] = [];
  if (options.editor) {
    try {
      editorModels = await options.editor.list();
    } catch {
      editorModels = [];
    }
  }
  const editorModel = pickEditorModel(editorModels, options.model);

  // The assistant that was seen doing the work goes first: that is the one the
  // learner is "using", and the one they expect to be billed by.
  if (options.seen === "claude-code" && claude) add(claudeProvider(claude, options.model), claude);
  if (options.editor && editorModel) {
    add(editorProvider(options.editor, editorModel), `${editorModels.length} model(s) offered by the editor`);
  }
  if (claude && !out.some((a) => a.id === "claude")) add(claudeProvider(claude, options.model), claude);
  if (codex) add(codexProvider(codex, options.model), codex);
  if (gemini) add(geminiProvider(gemini, options.model), gemini);
  if (options.customCommand.trim()) add(customProvider(options.customCommand), options.customCommand.trim());
  return out;
}

export type Resolved =
  | { provider: Provider; reason?: undefined }
  | { provider: null; reason: string };

export async function resolveProvider(options: AiOptions): Promise<Resolved> {
  if (options.setting === "off") return { provider: null, reason: "AI explanations are turned off in settings." };
  const found = await available(options);
  if (options.setting === "auto") {
    return found.length
      ? { provider: found[0].provider }
      : {
          provider: null,
          reason:
            "No AI assistant was found. Install Claude Code, Codex or Gemini CLI, sign in to Copilot, or set miyagi.ai.customCommand.",
        };
  }
  const match = found.find((a) => a.id === options.setting);
  if (match) return { provider: match.provider };
  const why: Record<ProviderId, string> = {
    editor: "This editor is not offering any chat models to extensions.",
    claude: "Claude Code was not found on this machine.",
    codex: "Codex was not found on this machine.",
    gemini: "Gemini CLI was not found on this machine.",
    custom: "miyagi.ai.customCommand is empty.",
  };
  return { provider: null, reason: why[options.setting] };
}

/* ------------------------------------------------------------------ *
 * The one prompt
 * ------------------------------------------------------------------ */

export interface ExplainRequest {
  title: string;
  what: string;
  depth: "Junior" | "Mid" | "Senior";
  file: string;
  /** Numbered lines from the learner's file. Null when the file could not be read. */
  excerpt: string | null;
  evidence: string;
}

const DEPTH_NOTE: Record<ExplainRequest["depth"], string> = {
  Junior: "They are new to programming. Use everyday words and define any term you cannot avoid.",
  Mid: "They can read code but did not write this. Skip the basics and explain the mechanism.",
  Senior: "They are experienced. Go straight to the design choice, its cost, and what to verify.",
};

export function explainPrompt(req: ExplainRequest): Prompt {
  return {
    system:
      "You are Miyagi, a coding tutor. Explain one idea in the code the learner shows you, in plain language. Do not use tools. Do not offer to do anything else.",
    user: [
      "An AI assistant wrote the code below while I watched. Teach me one idea in it.",
      "",
      `Idea: ${req.title}`,
      `In general: ${req.what}`,
      `File: ${req.file}`,
      "",
      req.excerpt
        ? "The relevant lines, with line numbers:\n```\n" + req.excerpt + "\n```"
        : `The line that uses it: ${req.evidence || "(not available)"}`,
      "",
      "Rules:",
      "- At most 110 words, in two short paragraphs. No headings, no lists, no greeting, no praise.",
      "- Paragraph one: what these specific lines do. Quote a short fragment in backticks and give its line number.",
      "- Paragraph two: why it is written this way, and the one thing I should check or could get wrong here.",
      "- Talk about this code, not the idea in general. If the lines do not actually use the idea, say so in one sentence.",
      `- ${DEPTH_NOTE[req.depth]}`,
    ].join("\n"),
  };
}
