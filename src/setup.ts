/**
 * `miyagi --setup`: turn on ride-along capture.
 *
 * The hook is what makes the tutor aware of a session it was never called in,
 * and a feature that needs hand-edited JSON in a dot-directory is a feature
 * most people never switch on. So one command writes the hook into the
 * editor's settings, and one command takes it out again.
 *
 * Rules this follows, because it edits a file the user owns:
 * - It merges; it never replaces. Other hooks and settings are left as found.
 * - It is idempotent. Running it twice leaves one entry, not two.
 * - It refuses to touch a settings file it cannot parse, rather than
 *   overwriting someone's work with a clean file.
 * - `--dry-run` prints what would change and writes nothing.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Client = "claude" | "cursor";
export type Scope = "project" | "global";

/** Appears in every hook command we write, so we can find our own entries again. */
const MARKER = "miyagi-observe";

/**
 * The command the editor will run. An absolute path to this install is fastest
 * (no package resolution on every tool call). When this copy lives in npx's
 * cache the path will not survive, so fall back to asking npx for it.
 */
export function hookCommand(): string {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "observe-cli.js");
  if (/[\\/]_npx[\\/]/.test(cli)) return `npx -y -p miyagi-mcp ${MARKER}`;
  // The trailing comment is the marker: the path itself says observe-cli.
  return `"${process.execPath}" "${cli}" # ${MARKER}`;
}

export function settingsPath(client: Client, scope: Scope, cwd: string = process.cwd()): string {
  const base = scope === "global" ? os.homedir() : cwd;
  return client === "claude"
    ? path.join(base, ".claude", scope === "global" ? "settings.json" : "settings.local.json")
    : path.join(base, ".cursor", "hooks.json");
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);

async function readJson(file: string): Promise<{ data: Json; existed: boolean } | { error: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return { data: {}, existed: false };
  }
  if (!raw.trim()) return { data: {}, existed: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObj(parsed)) return { error: "it is not a JSON object" };
    return { data: parsed, existed: true };
  } catch (err) {
    return { error: `it is not valid JSON (${(err as Error).message})` };
  }
}

const mentionsUs = (v: unknown): boolean => JSON.stringify(v ?? "").includes(MARKER);

/**
 * Claude Code: `hooks.<Event>[] = { matcher?, hooks: [{ type, command }] }`.
 *
 * - PostToolUse: commands run and files edited.
 * - PostToolUseFailure: a command that failed, so the learner can be coached
 *   to read the error before the assistant fixes it.
 * - UserPromptSubmit: that a new task was given (never its text), the moment
 *   to predict what the assistant is about to change.
 */
const CLAUDE_EVENTS: ReadonlyArray<{ event: string; matcher?: string }> = [
  { event: "PostToolUse", matcher: "Bash|Edit|Write|MultiEdit|NotebookEdit" },
  { event: "PostToolUseFailure", matcher: "Bash" },
  { event: "UserPromptSubmit" },
];

export function mergeClaude(settings: Json, command: string | null): Json {
  const out: Json = { ...settings };
  const hooks: Json = isObj(out.hooks) ? { ...out.hooks } : {};
  for (const { event, matcher } of CLAUDE_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const others = existing.filter((entry) => !mentionsUs(entry));
    const ours = { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command, timeout: 5 }] };
    const next = command ? [...others, ours] : others;
    if (next.length) hooks[event] = next;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** Cursor: `{ version: 1, hooks: { afterFileEdit: [{ command }], afterShellExecution: [...] } }`. */
export function mergeCursor(settings: Json, command: string | null): Json {
  const out: Json = { version: 1, ...settings };
  const hooks: Json = isObj(out.hooks) ? { ...out.hooks } : {};
  for (const event of ["afterFileEdit", "afterShellExecution"]) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const others = existing.filter((entry) => !mentionsUs(entry));
    const next = command ? [...others, { command }] : others;
    if (next.length) hooks[event] = next;
    else delete hooks[event];
  }
  out.hooks = hooks;
  return out;
}

export interface SetupResult {
  client: Client;
  file: string;
  status: "installed" | "already" | "removed" | "absent" | "skipped";
  detail: string;
}

export async function applyHooks(options: {
  client: Client;
  scope: Scope;
  remove?: boolean;
  dryRun?: boolean;
  cwd?: string;
  command?: string;
}): Promise<SetupResult> {
  const file = settingsPath(options.client, options.scope, options.cwd);
  const read = await readJson(file);
  if ("error" in read) {
    return {
      client: options.client,
      file,
      status: "skipped",
      detail: `left alone because ${read.error}. Fix or remove the file and run this again.`,
    };
  }
  const had = mentionsUs(read.data);
  if (options.remove && !had) {
    return { client: options.client, file, status: "absent", detail: "no miyagi hook was installed here" };
  }
  const command = options.remove ? null : options.command ?? hookCommand();
  const merge = options.client === "claude" ? mergeClaude : mergeCursor;
  const next = merge(read.data, command);
  const unchanged = JSON.stringify(next) === JSON.stringify(read.data);

  if (!options.dryRun && !unchanged) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
  }
  const prefix = options.dryRun ? "would be " : "";
  if (options.remove) return { client: options.client, file, status: "removed", detail: `${prefix}removed` };
  return unchanged
    ? { client: options.client, file, status: "already", detail: "already installed and up to date" }
    : { client: options.client, file, status: "installed", detail: `${prefix}${had ? "updated" : "installed"}` };
}

/** Is our hook present for this client, in either scope? Used by the doctor and the debrief. */
export async function hookInstalled(client: Client, cwd: string = process.cwd()): Promise<string | null> {
  for (const scope of ["project", "global"] as const) {
    const file = settingsPath(client, scope, cwd);
    const read = await readJson(file);
    if (!("error" in read) && mentionsUs(read.data)) return file;
  }
  return null;
}

export async function anyHookInstalled(cwd: string = process.cwd()): Promise<string | null> {
  return (await hookInstalled("claude", cwd)) ?? (await hookInstalled("cursor", cwd));
}

/**
 * The paragraph that makes an assistant bring the tutor in without being asked.
 * Hooks capture what happened; this is what gets it taught.
 */
export const AGENT_RULES = [
  "## Learning with miyagi",
  "",
  "The person you are working with wants to understand what gets built, not only to have it built.",
  "",
  "- When you finish a meaningful change (a feature, a fix, a new file), call the miyagi `explain_change` tool before you summarise. Teach from the card it returns: ground each idea in the code you just wrote, in two or three sentences, then ask its one question and wait for the answer.",
  "- When they ask what just happened, or come back after a break, call `debrief`.",
  "- At the start of a session, call `review_due_items` if anything is due. It takes a minute.",
  "- Keep it light. One idea at a time, in plain words, tied to their project. Never lecture, never block the work to teach, and skip ideas the card marks as already solid.",
  "- If they say they are busy, set `quick_config` to `mode: \"focus\"` and stop teaching until they say otherwise.",
].join("\n");

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseClients(args: readonly string[]): Client[] {
  const i = args.indexOf("--client");
  const value = i >= 0 ? args[i + 1] : "";
  if (value === "claude") return ["claude"];
  if (value === "cursor") return ["cursor"];
  return ["claude", "cursor"];
}

export async function runSetup(
  args: readonly string[],
  write: (line: string) => void = console.log,
): Promise<number> {
  const remove = args.includes("--uninstall") || args.includes("uninstall");
  const dryRun = args.includes("--dry-run");
  const scope: Scope = args.includes("--global") ? "global" : "project";
  const explicit = args.includes("--client");
  const clients = parseClients(args);

  write(remove ? "miyagi — removing ride-along capture" : "miyagi — setting up ride-along capture");
  write(`scope: ${scope === "global" ? "every project (your home directory)" : `this project (${process.cwd()})`}`);
  write("");

  let failed = 0;
  for (const client of clients) {
    // Without --client, Cursor is only wired up where Cursor is already in use:
    // creating a .cursor directory in a project that has never seen it is litter.
    if (!explicit && !remove && client === "cursor" && !(await cursorDirExists(scope))) {
      write("⏭  Cursor: no .cursor directory here, skipped (use --client cursor to force)");
      continue;
    }
    const result = await applyHooks({ client, scope, remove, dryRun });
    if (result.status === "skipped") failed++;
    const icon = result.status === "skipped" ? "⚠️ " : result.status === "absent" ? "⏭ " : "✅";
    write(`${icon} ${label(client)}: ${result.detail}`);
    write(`   ${result.file}`);
  }

  write("");
  if (remove) {
    write("Capture is off. Your progress and review queue are untouched.");
    return failed ? 1 : 0;
  }
  write("What this does: after each command or edit your assistant makes, one line is added to");
  write("~/.miyagi/observations.jsonl — the command, the file name and which ideas the change used.");
  write("No file contents, no command output, nothing leaves your machine.");
  write("");
  write("Next:");
  write("  1. Restart your editor so it picks up the hook.");
  write("  2. Build something as usual.");
  write('  3. Ask your assistant: "miyagi, debrief me".');
  write("");
  write("Want the assistant to teach without being asked? Add the rules to CLAUDE.md, AGENTS.md or .cursorrules:");
  write("  npx miyagi-mcp --rules >> CLAUDE.md");
  write("");
  write("Turn it off any time with: npx miyagi-mcp --setup --uninstall" + (scope === "global" ? " --global" : ""));
  return failed ? 1 : 0;
}

async function cursorDirExists(scope: Scope): Promise<boolean> {
  return fs.stat(path.dirname(settingsPath("cursor", scope))).then(() => true, () => false);
}

function label(client: Client): string {
  return client === "claude" ? "Claude Code" : "Cursor";
}
