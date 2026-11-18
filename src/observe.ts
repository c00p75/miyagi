/**
 * Passive observation.
 *
 * An MCP server only sees the calls an assistant chooses to route to it, and
 * an assistant in agent mode routes shell commands to its own shell tool and
 * edits to its own edit tool. So the tutor was silent in exactly the session
 * it existed to teach: the one where the AI did everything.
 *
 * Editors now expose hooks that fire after each tool call. This module is the
 * receiving end: a hook process is handed a JSON payload on stdin, reduces it
 * to a small observation, and appends one line to a log. The server reads the
 * log when the learner asks for a debrief.
 *
 * Constraints, in order of importance:
 *
 * 1. It must never break the editor. A hook that exits non-zero, prints to
 *    stdout or takes a second gets removed. Everything here swallows its own
 *    errors and the entry point always exits 0.
 *
 * 2. It keeps as little as it can. The log is plain text in a home directory.
 *    It stores the command line (scrubbed), the file path, the number of added
 *    lines, the ids of the concepts found and one scrubbed line of evidence
 *    per concept. It never stores file contents or command output.
 *
 * 3. It must be cheap to load, so it imports nothing from the MCP SDK.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectConcepts, scrub, type ConceptHit } from "./concepts.js";

export type ObservationSource = "claude-code" | "cursor" | "unknown";

interface ObservationBase {
  at: string;
  source: ObservationSource;
  session?: string;
  cwd?: string;
}

export interface CommandObservation extends ObservationBase {
  kind: "command";
  command: string;
}

export interface EditObservation extends ObservationBase {
  kind: "edit";
  file: string;
  added: number;
  concepts: ConceptHit[];
}

export type Observation = CommandObservation | EditObservation;

/** Duplicated from profile.ts on purpose: importing it would pull in the mode table. */
function homeDir(): string {
  return process.env.MIYAGI_HOME ?? path.join(os.homedir(), ".miyagi");
}

export function observationsPath(): string {
  return path.join(homeDir(), "observations.jsonl");
}

export function observationCursorPath(): string {
  return path.join(homeDir(), "observations.cursor");
}

const MAX_COMMAND = 300;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function relativeTo(cwd: string | undefined, file: string): string {
  if (!cwd || !path.isAbsolute(file)) return file;
  const rel = path.relative(cwd, file);
  return rel && !rel.startsWith("..") ? rel : file;
}

function cleanCommand(command: string): string {
  const oneLine = scrub(command.replace(/\s*\n\s*/g, " ⏎ ").trim());
  return oneLine.length > MAX_COMMAND ? oneLine.slice(0, MAX_COMMAND - 1) + "…" : oneLine;
}

function countLines(text: string): number {
  return text ? text.split(/\r?\n/).filter((l) => l.trim()).length : 0;
}

/**
 * Reduces a hook payload to observations. Returns an empty list for anything
 * it does not recognise: an unknown tool is not an error, it is just not
 * something there is a lesson in.
 *
 * Two payload dialects are understood:
 * - Claude Code `PostToolUse`: `{ tool_name, tool_input, cwd, session_id }`
 * - Cursor `afterShellExecution` / `afterFileEdit`:
 *   `{ hook_event_name, command }` / `{ hook_event_name, file_path, edits }`
 */
export function parseHookPayload(raw: unknown, now: Date = new Date()): Observation[] {
  const p = obj(raw);
  const at = now.toISOString();
  const cwd = str(p.cwd) || (Array.isArray(p.workspace_roots) ? str(p.workspace_roots[0]) : "") || undefined;
  const session = str(p.session_id) || str(p.conversation_id) || undefined;
  const event = str(p.hook_event_name);

  const edit = (source: ObservationSource, file: string, added: string): Observation[] => {
    if (!file || !added.trim()) return [];
    const rel = relativeTo(cwd, file);
    return [
      {
        at,
        source,
        session,
        cwd,
        kind: "edit",
        file: rel,
        added: countLines(added),
        concepts: detectConcepts(rel, added),
      },
    ];
  };

  const command = (source: ObservationSource, text: string): Observation[] => {
    const trimmed = text.trim();
    // The tutor's own plumbing is not something to teach back to the learner.
    if (!trimmed || /\b(miyagi-mcp|miyagi-observe|observe-cli)\b/.test(trimmed)) return [];
    return [{ at, source, session, cwd, kind: "command", command: cleanCommand(trimmed) }];
  };

  // Cursor
  if (event === "afterShellExecution") return command("cursor", str(p.command));
  if (event === "afterFileEdit") {
    const edits = Array.isArray(p.edits) ? p.edits : [];
    const added = edits.map((e) => str(obj(e).new_string)).join("\n");
    return edit("cursor", str(p.file_path), added);
  }

  // Claude Code
  const tool = str(p.tool_name);
  const input = obj(p.tool_input);
  if (!tool) return [];
  const source: ObservationSource = event === "PostToolUse" ? "claude-code" : "unknown";

  switch (tool) {
    case "Bash":
      return command(source, str(input.command));
    case "Write":
      return edit(source, str(input.file_path), str(input.content));
    case "Edit":
      return edit(source, str(input.file_path), str(input.new_string));
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return edit(source, str(input.file_path), edits.map((e) => str(obj(e).new_string)).join("\n"));
    }
    case "NotebookEdit":
      return edit(source, str(input.notebook_path), str(input.new_source));
    default:
      return [];
  }
}

export async function appendObservations(observations: readonly Observation[]): Promise<void> {
  if (!observations.length) return;
  const file = observationsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, observations.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
}

function isObservation(v: unknown): v is Observation {
  const o = obj(v);
  if (typeof o.at !== "string" || !Number.isFinite(Date.parse(o.at))) return false;
  if (o.kind === "command") return typeof o.command === "string";
  if (o.kind === "edit") return typeof o.file === "string" && Array.isArray(o.concepts);
  return false;
}

/** Every readable observation, oldest first. A corrupt line costs only itself. */
export async function readObservations(options: { since?: string | null } = {}): Promise<Observation[]> {
  let raw: string;
  try {
    raw = await fs.readFile(observationsPath(), "utf8");
  } catch {
    return [];
  }
  const sinceMs = options.since ? Date.parse(options.since) : NaN;
  const out: Observation[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isObservation(parsed)) continue;
      if (Number.isFinite(sinceMs) && Date.parse(parsed.at) <= sinceMs) continue;
      out.push(parsed);
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * The debrief cursor: the timestamp of the newest observation already taught.
 * A timestamp rather than a byte offset, because the hook appends while the
 * server reads and the log is trimmed underneath both.
 */
export async function readCursor(): Promise<string | null> {
  try {
    const raw = (await fs.readFile(observationCursorPath(), "utf8")).trim();
    return Number.isFinite(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

export async function writeCursor(at: string): Promise<void> {
  try {
    await fs.mkdir(homeDir(), { recursive: true });
    await fs.writeFile(observationCursorPath(), at, "utf8");
  } catch {
    // A cursor that fails to save means a repeated debrief, not a broken one.
  }
}

const MAX_LINES = 3_000;
const TRIM_TO = 2_000;

/** Keeps the log bounded. Called by the server, never by the hook. */
export async function pruneObservations(): Promise<number> {
  try {
    const raw = await fs.readFile(observationsPath(), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length <= MAX_LINES) return 0;
    const kept = lines.slice(-TRIM_TO);
    const tmp = observationsPath() + `.tmp-${process.pid}`;
    await fs.writeFile(tmp, kept.join("\n") + "\n", "utf8");
    await fs.rename(tmp, observationsPath());
    return lines.length - kept.length;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * The hook entry point
 * ------------------------------------------------------------------ */

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    const done = () => resolve(data);
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
      // A payload this large is a whole generated file; the head is enough.
      if (data.length > 2_000_000) {
        clearTimeout(timer);
        done();
      }
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      done();
    });
  });
}

/**
 * Reads one hook payload from stdin and records it. Resolves to the number of
 * observations written. Never throws and never writes to stdout: the editor is
 * on the other end of both.
 */
export async function runObserveHook(): Promise<number> {
  try {
    if (process.env.MIYAGI_OBSERVE === "off") return 0;
    const raw = await readStdin(2_000);
    if (!raw.trim()) return 0;
    const observations = parseHookPayload(JSON.parse(raw));
    await appendObservations(observations);
    return observations.length;
  } catch {
    return 0;
  }
}
