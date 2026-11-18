/**
 * Noticing work without being part of it.
 *
 * Three read-only sources:
 *
 * 1. Git. When files in a repository change and then go quiet, the diff is
 *    read and reduced to the lines that were not there last time. This works
 *    for any assistant in any editor, because it looks at the result and not
 *    at the tool that produced it.
 *
 * 2. Plain folders. A workspace folder that is not a repository has no diff
 *    to read, so changed files are compared with what was last seen of them.
 *
 * 3. The hook log, if the learner turned capture on. That adds the commands an
 *    assistant ran, which no diff can show.
 *
 * None of them writes anything into the workspace or talks to the assistant.
 */

import * as vscode from "vscode";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { gitChanges } from "../../src/changes.js";
import type { FileChange } from "../../src/concepts.js";
import { observationsPath, readObservations, type Observation } from "../../src/observe.js";
import { DiffTracker } from "./tracker.js";
import { ignoreMatcher } from "./schedule.js";

/** Long enough for an assistant's burst of edits to finish, short enough to feel live. */
const QUIET_MS = 2_500;
const OBSERVATION_POLL_MS = 4_000;
const IGNORED = /[\\/](\.git|node_modules|dist|build|out|\.next|\.venv|__pycache__|target|vendor)[\\/]/;
/** In a folder without git there is no ignore file to trust, so only source-like files are read. */
const SOURCE_FILE =
  /\.(jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|swift|vue|svelte|sql|css|scss|html|sh|ya?ml|toml|json|env|prisma)$|(^|[\\/])(Dockerfile|\.gitignore|\.env[^\\/]*)$/i;
const MAX_PLAIN_FILE = 200_000;

export interface Scan {
  root: string;
  at: string;
  /** Files with lines that were not there before. */
  files: number;
}

export interface WatchEvents {
  onChanges(root: string, source: string, changes: FileChange[]): void;
  onObservations(observations: Observation[]): void;
  onRoots(roots: string[]): void;
  /** Every completed read that found something new, taught or not. */
  onScan(scan: Scan): void;
  /** What was already uncommitted in a repository when it was first read. */
  onBaseline(root: string, files: number): void;
}

export interface WatchSettings {
  /** Read changes at all. */
  enabled: boolean;
  /** Read and remember, but do not teach: a pause, or quiet hours. */
  muted: boolean;
  /** Globs, relative to the repository, for files never to teach from. */
  ignore: readonly string[];
  /** Repository folder names (or full paths) to leave alone. */
  excludeRepos: readonly string[];
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

/**
 * The same folder can have two names. Git reports a repository by its
 * resolved path while the editor reports file events by the path the folder
 * was opened with, and on macOS every temp directory (and any symlinked
 * project folder) differs between the two. Matching on text alone silently
 * drops every event, which looks exactly like an assistant that wrote nothing.
 */
function resolved(p: string): string {
  try {
    return fsSync.realpathSync.native(p);
  } catch {
    return p;
  }
}

export function describeFiles(names: readonly string[]): string {
  return names.length === 1
    ? names[0]
    : `${names[0]} and ${names.length - 1} other file${names.length === 2 ? "" : "s"}`;
}

export class Watcher implements vscode.Disposable {
  private readonly tracker = new DiffTracker();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly dirty = new Set<string>();
  private readonly scanning = new Set<string>();
  /** Files touched in folders that are not repositories: path -> was it just created. */
  private readonly plainTouched = new Map<string, boolean>();
  private roots: string[] = [];
  private plainRoots: string[] = [];
  private allRoots: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private poll: NodeJS.Timeout | undefined;
  private observedUntil = new Date().toISOString();
  private observationMtime = 0;
  private settings: WatchSettings = { enabled: true, muted: false, ignore: [], excludeRepos: [] };
  private ignored: (relativePath: string) => boolean = () => false;
  private git: GitApi | null = null;
  /** Resolved path of each root, and of each folder a file event came from. */
  private readonly realRoots = new Map<string, string>();
  private readonly realDirs = new Map<string, string>();

  constructor(private readonly events: WatchEvents) {}

  async start(): Promise<void> {
    this.git = await this.gitApi();
    if (this.git) {
      this.disposables.push(
        this.git.onDidOpenRepository(() => void this.refreshRoots()),
        this.git.onDidCloseRepository(() => void this.refreshRoots()),
      );
    }
    await this.refreshRoots();
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshRoots()));

    const files = vscode.workspace.createFileSystemWatcher("**/*");
    this.disposables.push(
      files,
      files.onDidChange((uri) => this.touched(uri, false)),
      files.onDidCreate((uri) => this.touched(uri, true)),
    );

    this.poll = setInterval(() => void this.readNewObservations(), OBSERVATION_POLL_MS);
  }

  configure(settings: WatchSettings): void {
    const rootsChanged = settings.excludeRepos.join("\n") !== this.settings.excludeRepos.join("\n");
    this.settings = settings;
    this.ignored = ignoreMatcher(settings.ignore);
    if (rootsChanged) void this.refreshRoots();
  }

  /** Repositories being watched. */
  getRoots(): string[] {
    return [...this.roots];
  }

  /** Workspace folders watched without git. */
  getPlainRoots(): string[] {
    return [...this.plainRoots];
  }

  /** Every repository in the window, including ones the learner excluded. */
  getAllRoots(): string[] {
    return [...this.allRoots];
  }

  /** Has every repository been read once, so the next change is compared against a baseline? */
  isReady(): boolean {
    return this.roots.every((r) => this.tracker.isPrimed(r));
  }

  /**
   * The watched root a file belongs to, deepest first, and the file's path
   * relative to it. Tries the path as given, then with symlinks resolved.
   */
  private owner(roots: readonly string[], file: string): string | undefined {
    const deepest = (candidates: string[]) => candidates.sort((a, b) => b.length - a.length)[0];
    const direct = deepest(roots.filter((r) => inside(r, file)));
    if (direct) return direct;
    const dir = path.dirname(file);
    let realDir = this.realDirs.get(dir);
    if (realDir === undefined) {
      realDir = resolved(dir);
      if (this.realDirs.size > 2_000) this.realDirs.clear();
      this.realDirs.set(dir, realDir);
    }
    const real = path.join(realDir, path.basename(file));
    return deepest(roots.filter((r) => inside(this.realRoots.get(r) ?? r, real)));
  }

  /** Is this path inside something the learner has open? */
  inWorkspace(dir: string): boolean {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const real = resolved(dir);
    return [...folders, ...this.roots].some((r) => {
      const rr = this.realRoots.get(r) ?? r;
      return inside(r, dir) || inside(dir, r) || inside(rr, real) || inside(real, rr);
    });
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

  private excluded(root: string): boolean {
    return this.settings.excludeRepos.some((e) => e === root || e === path.basename(root));
  }

  private async refreshRoots(): Promise<void> {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const fromGit = this.git ? this.git.repositories.map((r) => r.rootUri.fsPath) : [];
    this.allRoots = [...new Set(fromGit)];
    this.roots = this.allRoots.filter((r) => !this.excluded(r));
    // A workspace folder with no repository in or above it is watched file by file.
    const realRepos = this.allRoots.map(resolved);
    this.plainRoots = folders.filter((f) => {
      const real = resolved(f);
      return !this.excluded(f) && !realRepos.some((r) => inside(r, real) || inside(real, r));
    });
    this.realRoots.clear();
    for (const r of [...this.allRoots, ...folders]) this.realRoots.set(r, resolved(r));
    this.events.onRoots(this.getRoots());
    // Baseline each repository now, so the first real edit is compared against
    // what was already there rather than taught as if it were all new.
    for (const root of this.roots) {
      if (!this.tracker.isPrimed(root)) void this.scan(root);
    }
  }

  private touched(uri: vscode.Uri, created: boolean): void {
    if (!this.settings.enabled || uri.scheme !== "file" || IGNORED.test(uri.fsPath)) return;
    // The deepest repository wins: a nested repo's file belongs to the nested repo.
    const root = this.owner(this.roots, uri.fsPath);
    if (root) {
      this.dirty.add(root);
    } else if (SOURCE_FILE.test(uri.fsPath) && this.owner(this.plainRoots, uri.fsPath)) {
      this.plainTouched.set(uri.fsPath, created || this.plainTouched.get(uri.fsPath) === true);
    } else {
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const roots = [...this.dirty];
      this.dirty.clear();
      for (const r of roots) void this.scan(r);
      const plain = [...this.plainTouched];
      this.plainTouched.clear();
      if (plain.length) void this.scanPlain(plain);
    }, QUIET_MS);
  }

  private emit(root: string, fresh: FileChange[]): void {
    const kept = fresh.filter((c) => !this.ignored(c.file));
    if (!kept.length) return;
    this.events.onScan({ root, at: new Date().toISOString(), files: kept.length });
    if (!this.settings.muted) this.events.onChanges(root, describeFiles(kept.map((c) => c.file)), kept);
  }

  private async scan(root: string): Promise<void> {
    if (this.scanning.has(root)) {
      // Something changed mid-read; look again once this pass is done.
      this.dirty.add(root);
      return;
    }
    this.scanning.add(root);
    try {
      const first = !this.tracker.isPrimed(root);
      const found = await gitChanges(root);
      const fresh = this.tracker.delta(root, found.changes);
      if (first) {
        if (found.kind === "working-tree") {
          this.events.onBaseline(root, found.changes.filter((c) => !this.ignored(c.file)).length);
        }
      } else if (fresh.length && this.settings.enabled) {
        this.emit(root, fresh);
      }
    } catch {
      // A repository that cannot be read teaches nothing; it must not break the rest.
    } finally {
      this.scanning.delete(root);
    }
  }

  private async scanPlain(touched: ReadonlyArray<[string, boolean]>): Promise<void> {
    const byRoot = new Map<string, FileChange[]>();
    for (const [file, created] of touched) {
      const root = this.owner(this.plainRoots, file);
      if (!root) continue;
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > MAX_PLAIN_FILE) continue;
        const text = await fs.readFile(file, "utf8");
        if (text.includes("\u0000")) continue;
        const relative = inside(root, file)
          ? path.relative(root, file)
          : path.relative(this.realRoots.get(root) ?? root, resolved(file));
        const change = this.tracker.deltaFile(root, relative, text, created);
        if (change) byRoot.set(root, [...(byRoot.get(root) ?? []), change]);
      } catch {
        // Deleted between the event and the read.
      }
    }
    for (const [root, changes] of byRoot) this.emit(root, changes);
  }

  /** Everything uncommitted (or the last commit), on request. */
  async everything(): Promise<Array<{ root: string; source: string; changes: FileChange[] }>> {
    const out: Array<{ root: string; source: string; changes: FileChange[] }> = [];
    for (const root of this.roots) {
      try {
        const found = await gitChanges(root);
        const changes = found.changes.filter((c) => !this.ignored(c.file));
        if (changes.length) out.push({ root, source: `${found.source} in ${path.basename(root)}`, changes });
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
