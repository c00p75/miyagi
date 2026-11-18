/**
 * Command capture: the optional editor hook.
 *
 * Watching git shows what an assistant wrote. It cannot show what the
 * assistant ran. Claude Code and Cursor both run a command after each tool
 * call, and Miyagi's `observe` hook turns that into one line in
 * `~/.miyagi/observations.jsonl`. The hook prints nothing and always exits 0,
 * so the assistant never sees it and cannot be steered by it.
 *
 * The settings files are edited by the MCP package's own `applyHooks`, which
 * merges, is idempotent, and refuses to touch a file it cannot parse.
 *
 * What this adds is everything a learner should not have to do by hand:
 *
 * - A stable home for the script. An extension's install directory changes
 *   with every update, and a hook pointing at last week's directory fails
 *   silently, so the script is copied to `~/.miyagi/bin/`.
 * - Something to run it with. Node.js if it is installed; otherwise the
 *   editor's own runtime, which is Node with a window attached.
 * - Knowing which assistants are on the machine, so setup is one click.
 * - Repair. Paths move when Node or the editor is updated, so an installed
 *   hook is rewritten on every activation.
 */

import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { profileDir } from "../../src/profile.js";
import { applyHooks, settingsPath, type Client, type Scope, type SetupResult } from "../../src/setup.js";
import { findBinary } from "./ai.js";

export type { Client, Scope, SetupResult };

const SCRIPT = "observe-hook.cjs";
const MARKER = "miyagi-observe";
const CLIENTS: readonly Client[] = ["claude", "cursor"];
const SCOPES: readonly Scope[] = ["project", "global"];

export const CLIENT_NAMES: Record<Client, string> = { claude: "Claude Code", cursor: "Cursor" };

export function hookScriptPath(): string {
  return path.join(profileDir(), "bin", SCRIPT);
}

/** Copies the bundled hook to its stable path. Returns false if it could not. */
export async function refreshHookScript(extensionDist: string): Promise<boolean> {
  try {
    const target = hookScriptPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(extensionDist, SCRIPT), target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The start of the hook command: whatever will execute a JavaScript file.
 *
 * `editorExecPath` is the editor's own binary. Every Electron app runs as
 * plain Node when ELECTRON_RUN_AS_NODE is set, which means capture works for
 * someone who never installed Node. The `VAR=1 command` form needs a POSIX
 * shell, so on Windows a real Node is still required.
 */
export function hookRuntime(editorExecPath?: string, node: string | null = findBinary("node")): string | null {
  if (node) return `"${node}"`;
  if (editorExecPath && process.platform !== "win32") return `ELECTRON_RUN_AS_NODE=1 "${editorExecPath}"`;
  return null;
}

/** The line the editor runs. The trailing comment is how the entry is found again. */
export function hookCommandFor(runtime: string): string {
  return `${runtime} "${hookScriptPath()}" # ${MARKER}`;
}

export interface CaptureOptions {
  extensionDist: string;
  cwd: string;
  editorExecPath?: string;
}

export async function enableCapture(
  options: CaptureOptions & { client: Client; scope: Scope },
): Promise<SetupResult | { error: string }> {
  const runtime = hookRuntime(options.editorExecPath);
  if (!runtime) {
    return { error: "Command capture runs a small script, and no Node.js was found to run it with." };
  }
  if (!(await refreshHookScript(options.extensionDist))) {
    return { error: `Could not write the hook script to ${hookScriptPath()}.` };
  }
  return applyHooks({
    client: options.client,
    scope: options.scope,
    cwd: options.cwd,
    command: hookCommandFor(runtime),
  });
}

export function disableCapture(options: { client: Client; scope: Scope; cwd: string }): Promise<SetupResult> {
  return applyHooks({ client: options.client, scope: options.scope, cwd: options.cwd, remove: true });
}

/** Every settings file that currently holds our hook. */
export async function installedHooks(cwd: string): Promise<Array<{ client: Client; scope: Scope; file: string }>> {
  const out: Array<{ client: Client; scope: Scope; file: string }> = [];
  for (const client of CLIENTS) {
    for (const scope of SCOPES) {
      const file = settingsPath(client, scope, cwd);
      try {
        if ((await fs.readFile(file, "utf8")).includes(MARKER)) out.push({ client, scope, file });
      } catch {
        // No such settings file: no hook there.
      }
    }
  }
  return out;
}

/** The clients capture is on for, in this workspace or globally. */
export async function capturedClients(cwd: string): Promise<Client[]> {
  return [...new Set((await installedHooks(cwd)).map((h) => h.client))];
}

/**
 * Rewrites every installed hook with today's paths and refreshes the script.
 * Returns how many settings files changed.
 */
export async function healCapture(options: CaptureOptions): Promise<number> {
  const installed = await installedHooks(options.cwd);
  if (!installed.length) return 0;
  let changed = 0;
  for (const hook of installed) {
    const result = await enableCapture({ ...options, client: hook.client, scope: hook.scope });
    if (!("error" in result) && result.status === "installed") changed++;
  }
  return changed;
}

/**
 * Which assistants with a hook system are on this machine.
 *
 * Generous on purpose: a hook in the settings of an assistant that is
 * installed but idle costs nothing, and missing one means a learner who has to
 * find a command to turn on something they were told was set up.
 */
export function detectClients(hints: { claudeExtension: boolean; appName: string; home?: string }): Client[] {
  const home = hints.home ?? os.homedir();
  const exists = (p: string) => fsSync.existsSync(p);
  const out: Client[] = [];
  if (hints.claudeExtension || exists(path.join(home, ".claude")) || findBinary("claude")) out.push("claude");
  if (/cursor/i.test(hints.appName) || exists(path.join(home, ".cursor"))) out.push("cursor");
  return out;
}

export interface SetupSummary {
  /** Clients capture is now on for, including ones that were already on. */
  on: Client[];
  /** Clients whose settings changed just now. */
  changed: Client[];
  problems: string[];
}

/** One call that turns capture on, for every project, for every assistant found. */
export async function setupCapture(options: CaptureOptions & { clients: readonly Client[] }): Promise<SetupSummary> {
  const summary: SetupSummary = { on: [], changed: [], problems: [] };
  const already = await capturedClients(options.cwd);
  for (const client of options.clients) {
    if (already.includes(client)) {
      summary.on.push(client);
      continue;
    }
    const result = await enableCapture({ ...options, client, scope: "global" });
    if ("error" in result) {
      summary.problems.push(result.error);
      break; // The same reason applies to every client.
    } else if (result.status === "skipped") {
      summary.problems.push(`${CLIENT_NAMES[client]}: ${result.file} was ${result.detail}`);
    } else {
      summary.on.push(client);
      if (result.status === "installed") summary.changed.push(client);
    }
  }
  return summary;
}
