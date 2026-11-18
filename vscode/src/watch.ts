/**
 * Noticing work without being part of it.
 *
 * Two read-only sources:
 *
 * 1. Git. When files in a repository change and then go quiet, the diff is
 *    read and reduced to the lines that were not there last time. This works
 *    for any assistant in any editor, because it looks at the result and not
 *    at the tool that produced it.
 *
 * 2. The hook log, if the learner turned capture on. That adds the commands an
 *    assistant ran, which no diff can show.
 *
 * Neither writes anything into the workspace or talks to the assistant.
 */

import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { gitChanges } from "../../src/changes.js";
import type { FileChange } from "../../src/concepts.js";
import { observationsPath, readObservations, type Observation } from "../../src/observe.js";
import { DiffTracker } from "./tracker.js";

/** Long enough for an assistant's burst of edits to finish, short enough to feel live. */
const QUIET_MS = 2_500;
const OBSERVATION_POLL_MS = 4_000;
const IGNORED = /[\\/](\.git|node_modules|dist|build|out|\.next|\.venv|__pycache__|target|vendor)[\\/]/;

export interface WatchEvents {
  onChanges(root: string, source: string, changes: FileChange[]): void;
  onObservations(observations: Observation[]): void;
  onRoots(roots: string[]): void;
}

interface GitRepository {
  rootUri: vscode.Uri;
}
interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export class Watcher implements vscode.Disposable {
  private readonly tracker = new DiffTracker();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly dirty = new Set<string>();
  private readonly scanning = new Set<string>();
  private roots: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private poll: NodeJS.Timeout | undefined;
  private observedUntil = new Date().toISOString();
  private observationMtime = 0;
  private enabled = true;

  constructor(private readonly events: WatchEvents) {}

  async start(): Promise<void> {
    const git = await this.gitApi();
    if (git) {
      this.disposables.push(
        git.onDidOpenRepository(() => void this.refreshRoots(git)),
        git.onDidCloseRepository(() => void this.refreshRoots(git)),
      );
    }
    await this.refreshRoots(git);
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshRoots(git)),
    );

    const files = vscode.workspace.createFileSystemWatcher("**/*");
    const touched = (uri: vscode.Uri) => this.touched(uri);
    this.disposables.push(files, files.onDidChange(touched), files.onDidCreate(touched));

    this.poll = setInterval(() => void this.readNewObservations(), OBSERVATION_POLL_MS);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getRoots(): string[] {
    return [...this.roots];
  }

  /** Is this path inside something the learner has open? */
  inWorkspace(dir: string): boolean {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    return [...folders, ...this.roots].some((r) => inside(r, dir) || inside(dir, r));
  }

  private async gitApi(): Promise<GitApi | null> {
    try {
      const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>("vscode.git");
      if (!extension) return null;
      const exports = extension.isActive ? extension.exports : await extension.activate();
      return exports.getAPI(1);
    } catch {
      return null;
    }
  }

  private async refreshRoots(git: GitApi | null): Promise<void> {
    const fromGit = git ? git.repositories.map((r) => r.rootUri.fsPath) : [];
    // Without the git extension, a workspace folder is the best guess; a folder
    // that is not a repository simply yields no changes.
    const fallback = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    this.roots = [...new Set(fromGit.length ? fromGit : fallback)];
    this.events.onRoots(this.getRoots());
    // Baseline each repository now, so the first real edit is compared against
    // what was already there rather than taught as if it were all new.
    for (const root of this.roots) {
      if (!this.tracker.isPrimed(root)) void this.scan(root);
    }
  }

  private touched(uri: vscode.Uri): void {
    if (!this.enabled || uri.scheme !== "file" || IGNORED.test(uri.fsPath)) return;
    // The deepest repository wins: a nested repo's file belongs to the nested repo.
    const root = this.roots
      .filter((r) => inside(r, uri.fsPath))
      .sort((a, b) => b.length - a.length)[0];
    if (!root) return;
    this.dirty.add(root);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const roots = [...this.dirty];
      this.dirty.clear();
      for (const r of roots) void this.scan(r);
    }, QUIET_MS);
  }

  private async scan(root: string): Promise<void> {
    if (this.scanning.has(root)) {
      // Something changed mid-read; look again once this pass is done.
      this.dirty.add(root);
      return;
    }
    this.scanning.add(root);
    try {
      const found = await gitChanges(root);
      const fresh = this.tracker.delta(root, found.changes);
      if (fresh.length && this.enabled) {
        const names = fresh.map((c) => c.file);
        const source =
          names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} other file${names.length === 2 ? "" : "s"}`;
        this.events.onChanges(root, source, fresh);
      }
    } catch {
      // A repository that cannot be read teaches nothing; it must not break the rest.
    } finally {
      this.scanning.delete(root);
    }
  }

  /** Everything uncommitted (or the last commit), on request. */
  async everything(): Promise<Array<{ root: string; source: string; changes: FileChange[] }>> {
    const out: Array<{ root: string; source: string; changes: FileChange[] }> = [];
    for (const root of this.roots) {
      try {
        const found = await gitChanges(root);
        if (found.changes.length) {
          out.push({ root, source: `${found.source} in ${path.basename(root)}`, changes: found.changes });
        }
      } catch {
        // skip
      }
    }
    return out;
  }

  private async readNewObservations(): Promise<void> {
    try {
      const stat = await fs.stat(observationsPath());
      if (stat.mtimeMs === this.observationMtime) return;
      this.observationMtime = stat.mtimeMs;
    } catch {
      return;
    }
    const all = await readObservations({ since: this.observedUntil });
    if (!all.length) return;
    this.observedUntil = all[all.length - 1].at;
    // The log is shared by every project on the machine. Only this window's count.
    const mine = all.filter((o) => o.cwd && this.inWorkspace(o.cwd));
    if (mine.length) this.events.onObservations(mine);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearInterval(this.poll);
    for (const d of this.disposables) d.dispose();
  }
}
