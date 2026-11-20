/**
 * What is new since the last look.
 *
 * `git diff HEAD` answers "what is uncommitted", and the panel needs "what did
 * the assistant just write". The difference is everything already in the diff
 * the last time it was read. This keeps, per repository and file, the added
 * lines it has already seen and hands back only the ones it has not.
 *
 * Lines are compared by trimmed text rather than position: an edit above a
 * block renumbers every line below it, and none of those lines are new.
 *
 * Pure and synchronous, so the rule is testable without a repository.
 */

import type { FileChange } from "./concepts.js";

export class DiffTracker {
  private readonly seen = new Map<string, Set<string>>();
  private readonly primed = new Set<string>();

  private key(root: string, file: string): string {
    return `${root}\u0000${file}`;
  }

  /** Has this repository been read at least once? */
  isPrimed(root: string): boolean {
    return this.primed.has(root);
  }

  /**
   * Returns only the added lines not seen before, and remembers them.
   *
   * The first read of a repository is its baseline: whatever was uncommitted
   * when the editor opened was not written while the learner was watching, so
   * it is remembered and nothing is returned. "Teach me my uncommitted
   * changes" exists for the case where they want it anyway.
   */
  delta(root: string, changes: readonly FileChange[]): FileChange[] {
    const first = !this.primed.has(root);
    this.primed.add(root);
    const out: FileChange[] = [];
    for (const change of changes) {
      const key = this.key(root, change.file);
      let known = this.seen.get(key);
      if (!known) {
        known = new Set();
        this.seen.set(key, known);
      }
      const fresh: string[] = [];
      for (const line of change.added.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || known.has(trimmed)) continue;
        known.add(trimmed);
        fresh.push(line);
      }
      if (fresh.length && !first) {
        out.push({ file: change.file, added: fresh.join("\n"), addedLines: fresh.length });
      }
    }
    return out;
  }

  /**
   * The same question for a folder with no git: what in this file is new
   * since it was last read. There is no diff to ask, so the whole file is
   * compared with what was remembered.
   *
   * A file read for the first time is a baseline, like a repository is,
   * unless it was just created: then every line in it is new.
   */
  deltaFile(root: string, file: string, text: string, created: boolean): FileChange | null {
    const key = this.key(root, file);
    let known = this.seen.get(key);
    const first = !known;
    if (!known) {
      known = new Set();
      this.seen.set(key, known);
    }
    const fresh: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || known.has(trimmed)) continue;
      known.add(trimmed);
      fresh.push(line);
    }
    if (!fresh.length || (first && !created)) return null;
    return { file, added: fresh.join("\n"), addedLines: fresh.length };
  }

  reset(): void {
    this.seen.clear();
    this.primed.clear();
  }
}
