/**
 * Finding "what just changed" without being told.
 *
 * `explain_change` is most useful when it needs no arguments: the assistant
 * finishes a piece of work and asks the tutor what is worth understanding in
 * it. Git already knows the answer. Everything here is read-only — `git diff`,
 * `git ls-files`, `git show` and plain file reads — and git is invoked without
 * a shell, so nothing a caller passes is ever interpreted as a command.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { detectConcepts, parseUnifiedDiff, type ConceptHit, type FileChange } from "./concepts.js";

const MAX_BUFFER = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 200_000;
const MAX_UNTRACKED = 40;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: MAX_BUFFER, timeout: 15_000, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout)),
    );
  });
}

async function readText(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const text = await fs.readFile(file, "utf8");
    // A NUL byte means binary. There is no lesson in a PNG.
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

function countLines(text: string): number {
  return text.split(/\r?\n/).filter((l) => l.trim()).length;
}

export interface FoundChanges {
  changes: FileChange[];
  /** A phrase that completes "From …", shown to the learner. */
  source: string;
  kind: "working-tree" | "last-commit" | "diff" | "file" | "none";
}

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "-U0"];

/**
 * Uncommitted work first (tracked edits plus brand-new files, which a diff
 * leaves out and which are most of what an assistant produces). Failing that,
 * the last commit: the assistant may have committed already.
 */
export async function gitChanges(cwd: string): Promise<FoundChanges> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return { changes: [], source: "", kind: "none" };

  let diff = await git(cwd, ["diff", "HEAD", ...DIFF_FLAGS]);
  if (diff === null) {
    // No HEAD yet: a repository before its first commit.
    diff = [(await git(cwd, ["diff", "--cached", ...DIFF_FLAGS])) ?? "", (await git(cwd, ["diff", ...DIFF_FLAGS])) ?? ""].join("\n");
  }
  const changes = parseUnifiedDiff(diff);

  const untracked = ((await git(cwd, ["ls-files", "--others", "--exclude-standard"])) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_UNTRACKED);
  for (const rel of untracked) {
    const text = await readText(path.join(cwd, rel));
    if (text?.trim()) changes.push({ file: rel, added: text, addedLines: countLines(text) });
  }
  if (changes.length) return { changes, source: "your uncommitted changes", kind: "working-tree" };

  const last = await git(cwd, ["show", "--format=", ...DIFF_FLAGS, "HEAD"]);
  const committed = last ? parseUnifiedDiff(last) : [];
  return committed.length
    ? { changes: committed, source: "your last commit", kind: "last-commit" }
    : { changes: [], source: "", kind: "none" };
}

/** Text handed over directly. A real diff is split per file; anything else is treated as one snippet. */
export function changesFromText(text: string, nameHint?: string): FoundChanges {
  const parsed = parseUnifiedDiff(text);
  if (parsed.length) return { changes: parsed, source: "the diff you passed", kind: "diff" };
  // `.tsx` is the hint that excludes the least when nobody says what language this is.
  const file = nameHint?.trim() || "snippet.tsx";
  return {
    changes: text.trim() ? [{ file, added: text, addedLines: countLines(text) }] : [],
    source: nameHint ? `\`${file}\`` : "the code you passed",
    kind: "diff",
  };
}

export async function changesFromFile(cwd: string, file: string): Promise<FoundChanges | { error: string }> {
  const abs = path.isAbsolute(file) ? file : path.join(cwd, file);
  const text = await readText(abs);
  if (text === null) {
    return { error: `Could not read \`${file}\` as text (missing, binary, or over ${MAX_FILE_BYTES / 1000} kB).` };
  }
  const rel = path.relative(cwd, abs);
  const shown = rel && !rel.startsWith("..") ? rel : file;
  return {
    changes: text.trim() ? [{ file: shown, added: text, addedLines: countLines(text) }] : [],
    source: `\`${shown}\``,
    kind: "file",
  };
}

export function conceptsIn(changes: readonly FileChange[]): Array<{ file: string; concepts: ConceptHit[] }> {
  return changes.map((c) => ({ file: c.file, concepts: detectConcepts(c.file, c.added) }));
}
