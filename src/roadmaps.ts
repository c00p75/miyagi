/**
 * Roadmap tracks: the ordered list of commands a learner walks.
 *
 * Two problems with the original design are fixed here. Tracks were hardcoded,
 * so the tool accepted any `roadmap_name` string and then silently fell back to
 * Command Line Basics, which taught a would-be frontend developer to run `pwd`
 * with no hint anything had gone wrong. And there was no way to discover a
 * valid name. So: lookups report whether they matched, and tracks can be
 * authored as JSON under `~/.miyagi/roadmaps/` where a user track shadows a
 * built-in of the same name.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { profileDir } from "./profile.js";
import { hostShell, shellCompatible, type Shell } from "./platform.js";
import { screenDanger } from "./safety.js";

export type Category =
  | "Role Based"
  | "Skill Based"
  | "Absolute Beginners"
  | "Best Practices";

export const CATEGORIES: Category[] = [
  "Role Based",
  "Skill Based",
  "Absolute Beginners",
  "Best Practices",
];

/**
 * How a step proves itself.
 *
 * This is what makes a track a course rather than a list of suggestions. XP
 * used to be awarded for a tool call succeeding, which meant the *server* had
 * run the command and the learner may never have touched a keyboard. A
 * checkpoint is a separate, read-only command whose exit code (and optionally
 * whose output) says whether the intended outcome actually exists.
 */
export interface Checkpoint {
  /** Read-only probe. Must exit 0 for the step to pass. */
  command: string;
  /** When set, the probe's stdout must also contain this. */
  contains?: string;
  /** Human-readable pass criterion, shown before the learner starts. */
  describe: string;
  /** PowerShell equivalent of `command`, used on Windows. */
  windows?: string;
}

export interface RoadmapStep {
  command: string;
  topic: string;
  note?: string;
  /** PowerShell equivalent, for a POSIX track being walked on Windows. */
  windows?: string;
  /** Outcome check. A step without one can only ever award attempt XP. */
  verify?: Checkpoint;
}

export interface Track {
  name: string;
  category: Category;
  description: string;
  /** The shell the commands are written for. */
  shell: Shell;
  steps: RoadmapStep[];
  source: "builtin" | "user";
}

interface StepOptions {
  note?: string;
  windows?: string;
  verify?: Checkpoint;
}

function posixQuote(value: string): string {
  if (/^[A-Za-z0-9._/=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A checkpoint that only asserts a path exists, which is most of them. */
const exists = (target: string, describe: string): Checkpoint => ({
  command: `test -e ${posixQuote(target)}`,
  windows: `if (Test-Path -LiteralPath ${psQuote(target)}) { exit 0 } else { exit 1 }`,
  describe,
});

const missing = (target: string, describe: string): Checkpoint => ({
  command: `test ! -e ${posixQuote(target)}`,
  windows: `if (Test-Path -LiteralPath ${psQuote(target)}) { exit 1 } else { exit 0 }`,
  describe,
});

const step = (command: string, topic: string, opts: StepOptions | string = {}): RoadmapStep => {
  // A bare string third argument stays supported: most steps only want a note.
  const o: StepOptions = typeof opts === "string" ? { note: opts } : opts;
  return { command, topic, note: o.note, windows: o.windows, verify: o.verify };
};

const BUILTIN: Track[] = [
  {
    name: "Command Line Basics",
    category: "Absolute Beginners",
    description: "Move around a filesystem, read and write files, and survive your first shell.",
    shell: "posix",
    source: "builtin",
    steps: [
      step("pwd", "Knowing where you are", {
        note: "Every path bug starts with a wrong assumption about cwd.",
        windows: "Get-Location",
      }),
      step("ls -lah", "Reading a directory listing", {
        note: "Columns are mode, links, owner, group, size, mtime, name.",
        windows: "Get-ChildItem -Force",
      }),
      step("cd .. && pwd", "Relative navigation", {
        note: "`..` is the parent; chaining with && proves it worked.",
        windows: "Set-Location ..; Get-Location",
      }),
      step("mkdir -p practice/day1", "Creating directory trees", {
        note: "`-p` makes parents and is idempotent. Stay in this directory for the rest of the track — `cd` inside a tutor command cannot persist.",
        windows: "New-Item -ItemType Directory -Force practice/day1",
        verify: exists("practice/day1", "the directory `practice/day1` exists"),
      }),
      step("touch notes.txt && echo 'hello shell' > notes.txt", "Writing to a file", {
        note: "`>` truncates, `>>` appends. Learn the difference before you need it.",
        windows: "Set-Content notes.txt 'hello shell'",
        verify: {
          command: "cat notes.txt",
          contains: "hello shell",
          windows: "Get-Content -Raw notes.txt",
          describe: "`notes.txt` exists and contains `hello shell`",
        },
      }),
      step("cat notes.txt", "Reading a file", {
        note: "For anything long, `less` beats `cat`.",
        windows: "Get-Content notes.txt",
        verify: exists("notes.txt", "`notes.txt` is still there to read"),
      }),
      step("grep -n 'hello' notes.txt", "Searching inside files", {
        note: "`-n` prints line numbers, which is what makes a hit actionable.",
        windows: "Select-String -Pattern hello -Path notes.txt",
        verify: {
          command: "grep -c hello notes.txt",
          windows: "if (Select-String -Pattern hello -Path notes.txt -Quiet) { exit 0 } else { exit 1 }",
          describe: "`notes.txt` contains a line matching `hello`",
        },
      }),
      step("cp notes.txt notes.bak && ls -l", "Copying safely", {
        note: "Back up before you edit, always.",
        windows: "Copy-Item notes.txt notes.bak; Get-ChildItem",
        verify: exists("notes.bak", "the copy `notes.bak` exists alongside the original"),
      }),
      step("mv notes.bak archive.txt", "Moving and renaming", {
        note: "`mv` is rename, and it overwrites without asking.",
        windows: "Move-Item notes.bak archive.txt",
        verify: {
          command: "test -e archive.txt && test ! -e notes.bak",
          windows:
            "if ((Test-Path -LiteralPath 'archive.txt') -and -not (Test-Path -LiteralPath 'notes.bak')) { exit 0 } else { exit 1 }",
          describe: "`archive.txt` exists and `notes.bak` no longer does",
        },
      }),
      step("rm -i archive.txt", "Deleting deliberately", {
        note: "`-i` prompts. There is no trash can in a shell.",
        windows: "Remove-Item archive.txt -Confirm",
        verify: missing("archive.txt", "`archive.txt` is gone"),
      }),
    ],
  },
  {
    name: "Git and GitHub",
    category: "Skill Based",
    description: "Commit, branch, inspect history, and collaborate without losing work.",
    shell: "posix",
    source: "builtin",
    steps: [
      step("git --version", "Verifying your toolchain", {
        note: "Behaviour differs across versions; know yours.",
        verify: { command: "git --version", contains: "git version", describe: "git is installed and on your PATH" },
      }),
      step("git init demo-repo", "Creating a repository", {
        note: "`.git` is the whole database. Delete it and history is gone. Later steps use `git -C demo-repo` so they work from this directory, not from wherever `cd` last left a subprocess.",
        verify: {
          command: "git -C demo-repo rev-parse --is-inside-work-tree",
          contains: "true",
          describe: "`demo-repo` is a git working tree",
        },
      }),
      step("git -C demo-repo status", "Reading the working tree", "The single most useful command in git. Run it constantly."),
      step("git -C demo-repo add -A && git -C demo-repo commit -m 'chore: initial commit'", "Staging and committing", {
        note: "The index is a deliberate middle step, not overhead.",
        verify: {
          command: "git -C demo-repo rev-parse --verify HEAD",
          describe: "`demo-repo` has at least one commit",
        },
      }),
      step("git -C demo-repo log --oneline --graph --decorate --all", "Reading history", {
        note: "`--all` is what reveals branches you forgot about.",
        verify: { command: "git -C demo-repo log --oneline -1", describe: "there is history to read" },
      }),
      step("git -C demo-repo switch -c feature/first-branch", "Branching", {
        note: "`switch` replaced `checkout` for branches; it is harder to misuse.",
        verify: {
          command: "git -C demo-repo rev-parse --abbrev-ref HEAD",
          contains: "feature/first-branch",
          describe: "HEAD is on `feature/first-branch`",
        },
      }),
      step("git -C demo-repo diff --stat", "Reviewing your own change", "Review before you commit and you will commit less garbage."),
      step("git -C demo-repo restore --staged .", "Undoing safely", {
        note: "Unstages without touching your edits.",
        verify: {
          command: "git -C demo-repo diff --cached --quiet",
          describe: "nothing is left staged in `demo-repo`",
        },
      }),
      step("git -C demo-repo remote -v", "Inspecting remotes", "Know which server you are about to push to."),
      step("git push --force-with-lease", "Rewriting shared history", "`--force-with-lease` refuses if someone else pushed. Plain `--force` does not."),
    ],
  },
  {
    name: "Backend Developer",
    category: "Role Based",
    description: "Node toolchain, HTTP debugging, ports, and containerised services.",
    shell: "posix",
    source: "builtin",
    steps: [
      step("node --version && npm --version", "Runtime and package manager", {
        note: "Pin these in your README; version drift is a whole class of bug.",
        verify: { command: "node --version", contains: "v", describe: "node is installed and reports a version" },
      }),
      step("mkdir -p practice/backend && npm init -y --prefix practice/backend", "Project manifest", {
        note: "package.json is the contract for everything downstream. The prefix keeps this from crediting a package.json that was already in the workspace.",
        verify: exists("practice/backend/package.json", "`practice/backend/package.json` exists"),
      }),
      step("npm ci --prefix practice/backend", "Reproducible installs", {
        note: "`ci` obeys the lockfile exactly. `install` may rewrite it. After a bare `npm init` there is no lockfile yet — `npm install --prefix practice/backend` first, then `ci` is what CI should run.",
      }),
      step("npm run build --if-present", "Build scripts", "`--if-present` keeps CI green for projects without a build."),
      step("curl -fsS -o /dev/null -w '%{http_code}\\n' https://example.com", "HTTP from the terminal", {
        note: "`-f` makes curl fail on 5xx; without it curl exits 0 on a 500.",
        verify: { command: "command -v curl", windows: "if (Get-Command curl -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }", describe: "curl is available to call" },
      }),
      step("lsof -nP -iTCP -sTCP:LISTEN", "Finding what holds a port", "The answer to 'address already in use'."),
      step("docker compose config", "Validating compose files", {
        note: "Renders the resolved config, including interpolated env vars.",
        verify: { command: "docker compose version", describe: "the docker compose plugin is installed" },
      }),
      step("docker compose up -d --build", "Running a service stack", "`--build` prevents debugging yesterday's image."),
      step("docker compose logs --tail=100 -f", "Reading service logs", "`--tail` keeps you from scrolling through a week of output."),
      step("docker compose down -v", "Tearing down", "`-v` removes volumes, and with them your data. Know before you type it."),
    ],
  },
  {
    name: "Frontend Developer",
    category: "Role Based",
    description: "Package tooling, dev servers, bundle budgets, and browser-facing checks.",
    shell: "posix",
    source: "builtin",
    steps: [
      step("node --version && npm --version", "Runtime baseline", {
        note: "Frontend toolchains are the least forgiving about Node versions.",
        verify: { command: "node --version", contains: "v", describe: "node reports a version" },
      }),
      step("npm ci", "Reproducible installs", {
        note: "A drifting lockfile is the usual cause of 'works on my machine'.",
        verify: exists("node_modules", "dependencies are installed"),
      }),
      step("npm ls --depth=0", "Direct dependency audit", "What you actually chose, without the transitive noise."),
      step("npm run dev", "Dev server", "Long-running: run this in your own terminal, not through the tutor."),
      step("npx tsc --noEmit", "Type checking without emitting", "The fastest correctness signal a TS project has."),
      step("npx eslint . --max-warnings=0", "Lint as a gate", "Warnings you never fail on are warnings nobody reads."),
      step("npm run build", "Production build", {
        note: "The only build whose output your users will ever see.",
        verify: {
          command: "test -d dist || test -d build",
          windows: "if ((Test-Path -LiteralPath 'dist') -or (Test-Path -LiteralPath 'build')) { exit 0 } else { exit 1 }",
          describe: "a build output directory (`dist` or `build`) exists",
        },
      }),
      step("du -sh dist 2>/dev/null || du -sh build", "Bundle size", "Measure before you optimise. Budgets beat opinions."),
      step("npx serve -s dist -l 5000", "Serving the built output", "Static hosting behaves differently from the dev server."),
      step(
        "npx lighthouse http://localhost:5000 --only-categories=performance --quiet --chrome-flags='--headless'",
        "Auditing performance",
        "Real numbers, one command, no dashboards.",
      ),
    ],
  },
  {
    name: "DevOps",
    category: "Best Practices",
    description: "Host inspection, service state, containers, orchestration and planned change.",
    shell: "posix",
    source: "builtin",
    steps: [
      step("uname -a", "Knowing the host", "Kernel and arch decide what will even run."),
      step("df -h", "Disk headroom", "A full disk presents as a hundred unrelated bugs."),
      step("free -m || vm_stat", "Memory pressure", "The `||` fallback is how one command covers Linux and macOS."),
      step("systemctl --failed || launchctl list | head", "Failed services", "Start triage with what the host already knows is broken."),
      step("journalctl -p err -n 50 --no-pager", "Reading error logs", "`--no-pager` is what makes it scriptable."),
      step("docker ps --format 'table {{.Names}}\\t{{.Status}}'", "Container state", {
        note: "Custom formats turn docker output into something greppable.",
        verify: { command: "docker version --format '{{.Server.Version}}'", describe: "a docker daemon is reachable" },
      }),
      step("kubectl config current-context", "Knowing which cluster you are in", {
        note: "Check this before every destructive kubectl command. Every one.",
        verify: { command: "kubectl config current-context", describe: "a kube context is configured" },
      }),
      step("kubectl get pods -A", "Cluster-wide pod state", "`-A` catches the broken thing in the namespace you forgot."),
      step("terraform plan -out=tfplan", "Proposing infrastructure change", {
        note: "A plan file is the reviewable artefact. Never apply without one.",
        verify: exists("tfplan", "a saved plan file `tfplan` exists to review"),
      }),
      step("terraform apply tfplan", "Applying a reviewed plan", "Applying the saved plan is what makes review meaningful."),
    ],
  },
  {
    name: "Shell Scripting",
    category: "Skill Based",
    description: "Write scripts that fail loudly, quote correctly, and survive being run twice.",
    shell: "posix",
    source: "builtin",
    steps: [
      step("echo $SHELL && echo $0", "Which shell you are in", "bash and zsh differ in ways that will bite you."),
      step("printf '%s\\n' 'safer than echo'", "printf over echo", "`echo` handling of backslashes and flags is not portable."),
      step("set -euo pipefail; echo guarded", "The strict-mode preamble", "Errors exit, unset vars are errors, pipeline failures propagate."),
      step('f=my\\ file.txt; touch "$f"; ls -l "$f"', "Quoting variables", {
        note: "Unquoted, that is two arguments and two files.",
        verify: exists("my file.txt", "a single file named `my file.txt` exists, not two files"),
      }),
      step('for i in 1 2 3; do printf \'step %s\\n\' "$i"; done', "Loops", "Quote the loop variable exactly like any other."),
      step("test -f /etc/hosts && echo present || echo missing", "Conditionals and exit codes", "`&&`/`||` chains read as logic because exit codes are the logic."),
      step("grep -c . /etc/hosts | tr -d ' '", "Composing with pipes", "Each stage does one thing; the pipe is the program."),
      step("trap 'echo cleaning up' EXIT; echo working", "Cleanup with trap", "`trap ... EXIT` is how a script leaves no mess behind."),
      step("printf '#!/bin/sh\\necho hi\\n' > hello.sh && sh -n hello.sh && echo 'syntax ok'", "Checking syntax without running", {
        note: "`-n` parses without executing. Cheap insurance.",
        verify: {
          command: "sh -n hello.sh",
          describe: "`hello.sh` exists and parses as valid shell",
        },
      }),
      step("command -v shellcheck >/dev/null && echo 'shellcheck available' || echo 'install shellcheck'", "Static analysis", "shellcheck finds the quoting bug you cannot see."),
    ],
  },
];

/* ------------------------------------------------------------------ *
 * User-authored tracks
 * ------------------------------------------------------------------ */

export function roadmapsDir(): string {
  return path.join(profileDir(), "roadmaps");
}

function parseTrack(raw: unknown, fallbackName: string): Track | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name =
    typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 120) : fallbackName;
  if (!name) return null;

  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  const steps: RoadmapStep[] = [];
  for (const s of rawSteps.slice(0, 200)) {
    // A step may be a bare command string, which is the shape most people
    // reach for first, or an object with a topic, a note and a checkpoint.
    if (typeof s === "string") {
      if (s.trim()) steps.push({ command: s.trim().slice(0, 500), topic: name });
      continue;
    }
    if (!s || typeof s !== "object") continue;
    const so = s as Record<string, unknown>;
    const command = typeof so.command === "string" ? so.command.trim().slice(0, 500) : "";
    if (!command) continue;
    steps.push({
      command,
      topic:
        typeof so.topic === "string" && so.topic.trim() ? so.topic.trim().slice(0, 200) : name,
      note: typeof so.note === "string" ? so.note.trim().slice(0, 500) : undefined,
      windows: typeof so.windows === "string" && so.windows.trim() ? so.windows.trim().slice(0, 500) : undefined,
      verify: parseCheckpoint(so.verify),
    });
  }
  if (!steps.length) return null;

  const category = CATEGORIES.includes(o.category as Category)
    ? (o.category as Category)
    : "Skill Based";

  return {
    name,
    category,
    description:
      typeof o.description === "string" ? o.description.trim().slice(0, 300) : "User-authored track.",
    shell: o.shell === "powershell" || o.shell === "any" ? o.shell : "posix",
    steps,
    source: "user",
  };
}

/**
 * A checkpoint from a user file. Two rules, both non-negotiable: it has to be a
 * command, and it must not be one the danger screen objects to. A "probe" that
 * deletes something is not a probe, and a track file is exactly the place
 * somebody would hide one.
 */
function parseCheckpoint(raw: unknown): Checkpoint | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const command = typeof o.command === "string" ? o.command.trim().slice(0, 500) : "";
  if (!command) return undefined;
  if (screenDanger(command).length) return undefined;
  const windowsRaw = typeof o.windows === "string" ? o.windows.trim().slice(0, 500) : "";
  const windows = windowsRaw && !screenDanger(windowsRaw).length ? windowsRaw : undefined;
  return {
    command,
    windows,
    contains: typeof o.contains === "string" && o.contains ? o.contains.slice(0, 200) : undefined,
    describe:
      typeof o.describe === "string" && o.describe.trim()
        ? o.describe.trim().slice(0, 300)
        : `\`${command}\` succeeds`,
  };
}

let userTracks: Track[] = [];
export interface LoadReport {
  loaded: number;
  skipped: string[];
  dir: string;
}

/**
 * Reads every `*.json` under the roadmaps dir. A file that will not parse is
 * named in the report and skipped: an author needs to know their track was
 * ignored, and one bad file must not hide the others.
 */
export async function loadUserTracks(): Promise<LoadReport> {
  const dir = roadmapsDir();
  const report: LoadReport = { loaded: 0, skipped: [], dir };
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith(".json"));
  } catch {
    userTracks = [];
    return report;
  }
  const found: Track[] = [];
  for (const file of names.sort()) {
    try {
      const text = await fs.readFile(path.join(dir, file), "utf8");
      const track = parseTrack(JSON.parse(text), path.basename(file, path.extname(file)));
      if (!track) {
        report.skipped.push(`${file} (no usable steps)`);
        continue;
      }
      found.push(track);
    } catch (err) {
      report.skipped.push(`${file} (${(err as Error).message.slice(0, 80)})`);
    }
  }
  userTracks = found;
  report.loaded = found.length;
  return report;
}

/** A user track shadows a built-in of the same name, so anyone can retune a track. */
export function allTracks(): Track[] {
  const byName = new Map<string, Track>();
  for (const t of BUILTIN) byName.set(t.name.toLowerCase(), t);
  for (const t of userTracks) byName.set(t.name.toLowerCase(), t);
  return [...byName.values()];
}

export function trackNames(): string[] {
  return allTracks()
    .map((t) => t.name)
    .sort();
}

export const DEFAULT_TRACK_FOR_CATEGORY: Record<Category, string> = {
  "Role Based": "Backend Developer",
  "Skill Based": "Git and GitHub",
  "Absolute Beginners": "Command Line Basics",
  "Best Practices": "DevOps",
};

export interface Lookup {
  track: Track;
  /** False when the requested name did not exist, so callers can say so out loud. */
  matched: boolean;
  requested: string;
  /** Close names, for a "did you mean" line. */
  suggestions: string[];
}

/** Case-insensitive, then substring, then category default. Never silently wrong. */
export function findTrack(name: string, category?: Category): Lookup {
  const tracks = allTracks();
  const wanted = name.trim().toLowerCase();

  const exact = tracks.find((t) => t.name.toLowerCase() === wanted);
  if (exact) return { track: exact, matched: true, requested: name, suggestions: [] };

  const partial = wanted
    ? tracks.filter(
        (t) => t.name.toLowerCase().includes(wanted) || wanted.includes(t.name.toLowerCase()),
      )
    : [];
  if (partial.length === 1) {
    return { track: partial[0], matched: true, requested: name, suggestions: [] };
  }

  const fallbackName =
    (category && DEFAULT_TRACK_FOR_CATEGORY[category]) || "Command Line Basics";
  const fallback =
    tracks.find((t) => t.name === fallbackName) ??
    tracks.find((t) => t.name === "Command Line Basics") ??
    tracks[0];

  return {
    track: fallback,
    matched: false,
    requested: name,
    suggestions: (partial.length ? partial : tracks.filter((t) => !category || t.category === category))
      .map((t) => t.name)
      .slice(0, 5),
  };
}

export function stepAt(track: Track, stepIndex: number): RoadmapStep {
  const idx = Math.min(track.steps.length - 1, Math.max(0, stepIndex - 1));
  return track.steps[idx];
}

/** Written on demand so a user has a working file to copy rather than a schema to read. */
export function exampleTrackJson(): string {
  return JSON.stringify(
    {
      name: "My Python Track",
      category: "Skill Based",
      description: "What this track teaches, in one line.",
      shell: "posix",
      steps: [
        "python3 --version",
        {
          command: "python3 -m venv .venv && . .venv/bin/activate",
          topic: "Isolated environments",
          note: "Never install into the system interpreter.",
          windows: "python -m venv .venv; .venv\\Scripts\\Activate.ps1",
          verify: {
            command: "test -x .venv/bin/python",
            describe: "a virtualenv exists at .venv",
          },
        },
      ],
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ *
 * Platform resolution
 * ------------------------------------------------------------------ */

export interface ResolvedStep {
  step: RoadmapStep;
  /** The command line to actually offer, after platform substitution. */
  command: string;
  /** True when the POSIX line was swapped for a PowerShell one. */
  substituted: boolean;
  /** Set when the host shell cannot run this step and there is no alternative. */
  warning: string | null;
}

/**
 * Picks the command line to offer for a step on this host. A track written for
 * POSIX being walked on Windows gets the `windows` variant where the step has
 * one, and an explicit warning where it does not — never a line that is known
 * to fail.
 */
export function resolveStep(
  track: Track,
  step: RoadmapStep,
  host: Shell = hostShell(),
): ResolvedStep {
  if (shellCompatible(track.shell, host)) {
    return { step, command: step.command, substituted: false, warning: null };
  }
  if (host === "powershell" && step.windows) {
    return { step, command: step.windows, substituted: true, warning: null };
  }
  return {
    step,
    command: step.command,
    substituted: false,
    warning:
      `This step is written for a ${track.shell} shell and you are on ${host}. ` +
      "It will not run as-is here: use WSL or Git Bash, or pick a track that matches your shell.",
  };
}

/** The probe to actually run on this host. */
export function resolveCheckpoint(
  check: Checkpoint,
  host: Shell = hostShell(),
): { command: string; contains?: string } {
  if (host === "powershell" && check.windows) {
    return { command: check.windows, contains: check.contains };
  }
  return { command: check.command, contains: check.contains };
}

/** Steps with a checkpoint, which is what makes a track gradeable. */
export function verifiableSteps(track: Track): number {
  return track.steps.filter((s) => s.verify).length;
}

export function trackShellWarning(track: Track, host: Shell = hostShell()): string | null {
  if (shellCompatible(track.shell, host)) return null;
  const covered = track.steps.filter((s) => s.windows).length;
  return (
    `**${track.name}** is written for a \`${track.shell}\` shell; this host runs \`${host}\`. ` +
    (covered
      ? `${covered} of ${track.steps.length} steps have a PowerShell equivalent; the rest will need WSL or Git Bash.`
      : "None of its steps have a PowerShell equivalent, so run them in WSL or Git Bash.")
  );
}
