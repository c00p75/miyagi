/**
 * What the assistant said when it wrote a file.
 *
 * Claude Code keeps each session as a JSONL file under `~/.claude/projects/`.
 * When it edits a file it usually says why first, in a sentence or two the
 * learner scrolled past. That sentence is the best available answer to "why
 * was it written this way", and it costs nothing to show: no model call, just
 * the assistant's own words.
 *
 * The transcript format is not documented and can change without notice, so
 * everything here treats it as hostile input: unknown shapes are skipped, a
 * file that cannot be read yields null, and nothing is ever written.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_READ = 24 * 1024 * 1024;
const MAX_TEXT = 1_600;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export interface Reasoning {
  text: string;
  /** ISO time of the edit, when the transcript recorded one. */
  at: string | null;
}

function projectsDir(home: string = os.homedir()): string {
  return path.join(home, ".claude", "projects");
}

/** Claude Code names a project folder after its path, with every other character turned into a dash. */
export function projectFolderName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

async function newest(dir: string, limit: number): Promise<string[]> {
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl"));
    const stats = await Promise.all(
      names.map(async (n) => ({ file: path.join(dir, n), mtime: (await fs.stat(path.join(dir, n))).mtimeMs })),
    );
    return stats.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((s) => s.file);
  } catch {
    return [];
  }
}

/** Transcripts that could hold this edit, most likely first. */
export async function candidateTranscripts(
  options: { session?: string | null; cwds: readonly string[] },
  home: string = os.homedir(),
): Promise<string[]> {
  const root = projectsDir(home);
  const out: string[] = [];
  if (options.session && /^[A-Za-z0-9-]{8,80}$/.test(options.session)) {
    try {
      for (const dir of await fs.readdir(root)) {
        const file = path.join(root, dir, `${options.session}.jsonl`);
        try {
          await fs.access(file);
          out.push(file);
        } catch {
          // not in this project folder
        }
      }
    } catch {
      // no projects directory at all
    }
  }
  for (const cwd of options.cwds) out.push(...(await newest(path.join(root, projectFolderName(cwd)), 3)));
  return [...new Set(out)];
}

interface Block {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: { file_path?: unknown; notebook_path?: unknown };
}

function blocksOf(line: unknown): Block[] {
  const message = (line as { message?: { content?: unknown } } | null)?.message;
  return Array.isArray(message?.content) ? (message.content as Block[]) : [];
}

function samePath(edited: unknown, wanted: string): boolean {
  if (typeof edited !== "string" || !edited) return false;
  const a = edited.replace(/\\/g, "/");
  const b = wanted.replace(/\\/g, "/");
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
}

/**
 * The assistant's words leading up to its most recent edit of `file`.
 *
 * Reads backwards from the edit, collecting what the assistant said, and stops
 * at the learner's own message: anything before that belongs to a different
 * request.
 */
export function reasoningFrom(jsonl: string, file: string): Reasoning | null {
  const lines: unknown[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // A half-written last line is normal while a session is running.
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] as { type?: unknown; timestamp?: unknown };
    if (line?.type !== "assistant") continue;
    const edit = blocksOf(line).find(
      (b) =>
        b.type === "tool_use" &&
        typeof b.name === "string" &&
        EDIT_TOOLS.has(b.name) &&
        (samePath(b.input?.file_path, file) || samePath(b.input?.notebook_path, file)),
    );
    if (!edit) continue;

    const said: string[] = [];
    for (let j = i; j >= 0 && said.length < 4; j--) {
      const prior = lines[j] as { type?: unknown };
      const blocks = blocksOf(prior);
      if (prior?.type === "user") {
        // Tool results are also "user" lines. A line with real text is the learner speaking.
        const isToolResult = blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
        if (!isToolResult) break;
        continue;
      }
      if (prior?.type !== "assistant") continue;
      for (const b of [...blocks].reverse()) {
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) said.unshift(b.text.trim());
      }
    }
    if (!said.length) return null;
    const text = said.join("\n\n");
    return {
      text: text.length > MAX_TEXT ? "…" + text.slice(text.length - MAX_TEXT) : text,
      at: typeof line.timestamp === "string" ? line.timestamp : null,
    };
  }
  return null;
}

async function readTail(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    if (stat.size <= MAX_READ) return await fs.readFile(file, "utf8");
    // A very long session: the recent end is where a recent edit is.
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(MAX_READ);
      await handle.read(buffer, 0, MAX_READ, stat.size - MAX_READ);
      const text = buffer.toString("utf8");
      return text.slice(text.indexOf("\n") + 1);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function assistantReasoning(
  options: { session?: string | null; cwds: readonly string[]; file: string },
  home: string = os.homedir(),
): Promise<Reasoning | null> {
  for (const transcript of await candidateTranscripts(options, home)) {
    const text = await readTail(transcript);
    const found = text ? reasoningFrom(text, options.file) : null;
    if (found) return found;
  }
  return null;
}
