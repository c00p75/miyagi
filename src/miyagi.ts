#!/usr/bin/env node
/**
 * miyagi
 * A patient, gamified, voice-enabled MCP coding tutor.
 *
 * Wax on, wax off: the learner runs every command themselves. This server
 * drills, corrects, catches the falls, and keeps score — it never does the
 * work for them.
 *
 * Transport: stdio. NOTHING may be written to stdout except MCP frames —
 * all diagnostics go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

const exec = promisify(execCb);
const log = (...a: unknown[]) => console.error("[miyagi]", ...a);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

type Category =
  | "Role Based"
  | "Skill Based"
  | "Absolute Beginners"
  | "Best Practices";

type SkillLevel = "Junior" | "Mid" | "Senior";

interface Roadmap {
  category: Category;
  roadmap_name: string;
  current_topic: string;
  step_index: number;
  total_steps: number;
}

interface Player {
  xp: number;
  level: number;
  title: string;
  quizStreak: number;
  bestStreak: number;
  badges: string[];
}

interface VoiceConfig {
  enabled: boolean;
  words_per_minute: number;
}

interface HistoryEntry {
  at: string;
  kind: "command" | "concept" | "quiz" | "config";
  label: string;
  detail: string;
  xpAwarded: number;
}

interface PendingQuiz {
  question: string;
  answer: string;
  choices: string[];
  explanation: string;
}

const TITLES: Array<{ minLevel: number; title: string }> = [
  { minLevel: 1, title: "Terminal Novice" },
  { minLevel: 3, title: "Shell Apprentice" },
  { minLevel: 6, title: "CLI Artisan" },
  { minLevel: 10, title: "Terminal Wizard" },
];

const activeRoadmap: Roadmap = {
  category: "Absolute Beginners",
  roadmap_name: "Command Line Basics",
  current_topic: "Navigating the filesystem",
  step_index: 1,
  total_steps: 10,
};

const player: Player = {
  xp: 0,
  level: 1,
  title: "Terminal Novice",
  quizStreak: 0,
  bestStreak: 0,
  badges: [],
};

const voice: VoiceConfig = { enabled: true, words_per_minute: 180 };

let skillLevel: SkillLevel = "Junior";

const sessionHistory: HistoryEntry[] = [];
let pendingQuiz: PendingQuiz | null = null;

const sessionStartedAt = new Date().toISOString();

/* ------------------------------------------------------------------ *
 * Text sanitising for TTS
 * ------------------------------------------------------------------ */

/** Strip markdown, code fences, symbols and URLs so the TTS engine reads prose. */
export function sanitizeForSpeech(raw: string): string {
  let t = raw;
  t = t.replace(/```[\s\S]*?```/g, " code block. ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " image. ");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/\bhttps?:\/\/\S+/gi, " link ");
  t = t.replace(/\bwww\.\S+/gi, " link ");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/^\s*[-*_]{3,}\s*$/gm, " ");
  t = t.replace(/\|/g, " ");
  t = t.replace(/(\*\*|__|\*|_|~~)/g, "");
  t = t.replace(/[#`<>{}\[\]\\^|]/g, " ");
  // Emoji / pictographs
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu,
    " "
  );
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 1200);
}

/** Quote a string for safe single-argument shell use. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/* ------------------------------------------------------------------ *
 * Cross-platform audio engine: non-blocking FIFO queue with fallbacks
 * ------------------------------------------------------------------ */

class AudioQueue {
  private queue: string[] = [];
  private draining = false;
  private linuxSpeaker: string | null | undefined = undefined; // undefined = not probed

  enqueue(text: string): void {
    if (!voice.enabled) return;
    const clean = sanitizeForSpeech(text);
    if (!clean) return;
    this.queue.push(clean);
    if (!this.draining) void this.drain();
  }

  clear(): void {
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        try {
          await this.speak(next);
        } catch (err) {
          // Never let a TTS failure take down the server.
          log("tts failed (non-fatal):", (err as Error).message);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      await exec(`command -v ${cmd}`, { shell: "/bin/sh" });
      return true;
    } catch {
      return false;
    }
  }

  private async resolveLinuxSpeaker(): Promise<string | null> {
    if (this.linuxSpeaker !== undefined) return this.linuxSpeaker;
    for (const cmd of ["spd-say", "espeak-ng", "espeak", "festival"]) {
      if (await this.commandExists(cmd)) {
        this.linuxSpeaker = cmd;
        return cmd;
      }
    }
    this.linuxSpeaker = null;
    log("no Linux TTS binary found; audio disabled for this session");
    return null;
  }

  private async speak(text: string): Promise<void> {
    const platform = os.platform();
    const wpm = Math.min(400, Math.max(80, Math.round(voice.words_per_minute)));
    const timeout = 60_000;

    if (platform === "darwin") {
      if (!(await this.commandExists("say"))) return;
      await exec(`say -r ${wpm} -- ${shellQuote(text)}`, { timeout });
      return;
    }

    if (platform === "win32") {
      // PowerShell rate is -10..10; 180 wpm ~= rate 0.
      const rate = Math.max(-10, Math.min(10, Math.round((wpm - 180) / 20)));
      const psText = text.replace(/'/g, "''");
      const script =
        `Add-Type -AssemblyName System.Speech; ` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$s.Rate = ${rate}; ` +
        `$s.Speak('${psText}');`;
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      await exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { timeout }
      );
      return;
    }

    // Linux / other POSIX
    const speaker = await this.resolveLinuxSpeaker();
    if (!speaker) return;
    const quoted = shellQuote(text);
    if (speaker === "spd-say") {
      // spd-say rate is -100..100; 180 wpm ~= 0.
      const rate = Math.max(-100, Math.min(100, Math.round((wpm - 180) / 2)));
      await exec(`spd-say -w -r ${rate} -- ${quoted}`, { timeout });
    } else if (speaker === "festival") {
      await exec(`echo ${quoted} | festival --tts`, { timeout, shell: "/bin/sh" });
    } else {
      await exec(`${speaker} -s ${wpm} ${quoted}`, { timeout });
    }
  }
}

const audioQueue = new AudioQueue();

/* ------------------------------------------------------------------ *
 * Gamification engine
 * ------------------------------------------------------------------ */

function titleForLevel(level: number): string {
  let title = TITLES[0].title;
  for (const t of TITLES) if (level >= t.minLevel) title = t.title;
  return title;
}

function addBadge(badge: string): boolean {
  if (player.badges.includes(badge)) return false;
  player.badges.push(badge);
  return true;
}

interface XpResult {
  awarded: number;
  leveledUp: boolean;
  newLevel: number;
  newTitle: string;
  titleChanged: boolean;
  newBadges: string[];
}

function awardXp(amount: number): XpResult {
  const beforeLevel = player.level;
  const beforeTitle = player.title;
  const beforeBadges = player.badges.length;

  player.xp = Math.max(0, player.xp + amount);
  player.level = Math.floor(player.xp / 100) + 1;
  player.title = titleForLevel(player.level);

  if (player.level >= 10) addBadge("Archwizard 🧙");
  if (player.xp >= 500) addBadge("Grinder 💪");

  return {
    awarded: amount,
    leveledUp: player.level > beforeLevel,
    newLevel: player.level,
    newTitle: player.title,
    titleChanged: player.title !== beforeTitle,
    newBadges: player.badges.slice(beforeBadges),
  };
}

function record(entry: Omit<HistoryEntry, "at">): void {
  sessionHistory.push({ at: new Date().toISOString(), ...entry });
  if (sessionHistory.length > 500) sessionHistory.shift();
}

function xpBar(): string {
  const into = player.xp % 100;
  const filled = Math.round(into / 10);
  return `[${"█".repeat(filled)}${"░".repeat(10 - filled)}] ${into}/100`;
}

function roadmapBar(): string {
  const total = Math.max(1, activeRoadmap.total_steps);
  const done = Math.min(total, Math.max(0, activeRoadmap.step_index));
  const filled = Math.round((done / total) * 12);
  return `[${"█".repeat(filled)}${"░".repeat(12 - filled)}] step ${done}/${total}`;
}

/* ------------------------------------------------------------------ *
 * Teaching content generators
 * ------------------------------------------------------------------ */

const AUDIENCE_LENS: Record<SkillLevel, { what: string; how: string; tradeoffs: string }> = {
  Junior: {
    what: "Plain-language definition, what you should expect to see on screen, and the one job this command does.",
    how: "Flag-by-flag walkthrough with a safe example you can retype from memory.",
    tradeoffs: "When to reach for this versus the GUI equivalent, and the single mistake beginners make most.",
  },
  Mid: {
    what: "Where this fits in the wider toolchain and what state it mutates.",
    how: "Composition with pipes/redirects, exit codes, and scripting-safe invocation.",
    tradeoffs: "Performance, portability across shells/OSes, and idempotency concerns in CI.",
  },
  Senior: {
    what: "The system-level contract: syscalls/IO touched, failure domains, blast radius.",
    how: "Hardening: quoting, --, set -euo pipefail, least privilege, deterministic output for parsing.",
    tradeoffs: "Operational cost, auditability, rollback story, and where this belongs in automation versus a purpose-built tool.",
  },
};

function guessConcept(command: string): string {
  const bin = command.trim().split(/\s+/)[0]?.replace(/^.*\//, "") ?? "shell";
  return bin;
}

function mermaidFor(command: string, ok: boolean): string {
  const bin = guessConcept(command);
  return [
    "flowchart TD",
    `    A["Shell parses: ${bin}"] --> B{"Binary on PATH?"}`,
    '    B -- "no" --> E["127: command not found"]',
    '    B -- "yes" --> C["fork + execve"]',
    '    C --> D{"Args & permissions valid?"}',
    '    D -- "no" --> F["non-zero exit + stderr"]',
    '    D -- "yes" --> G["Process runs, writes stdout"]',
    `    G --> H["Exit code ${ok ? "0 (success)" : "non-zero"}"]`,
    `    H --> I["Roadmap: ${activeRoadmap.current_topic.replace(/"/g, "'")}"]`,
  ].join("\n");
}

function pitfallsFor(command: string): string[] {
  const generic = [
    "Unquoted variables split on whitespace — always quote `\"$VAR\"`.",
    "Relative paths depend on your current directory; confirm with `pwd` first.",
    "A zero exit code inside a pipeline can hide an earlier failure — use `set -o pipefail`.",
  ];
  const bin = guessConcept(command);
  const specific: Record<string, string[]> = {
    rm: ["`rm -rf` has no undo and no trash — dry-run the glob with `ls` first.", "A stray space in `rm -rf / path` is catastrophic."],
    git: ["`git push --force` rewrites shared history; prefer `--force-with-lease`.", "Detached HEAD commits are easy to lose — branch before experimenting."],
    docker: ["Containers are ephemeral; unmounted data dies with them.", "`latest` is not a version — pin digests for reproducibility."],
    npm: ["`npm install` can drift lockfiles; use `npm ci` in CI.", "Global installs mask project-local version mismatches."],
    chmod: ["`chmod 777` is almost never the fix — narrow the owner/group instead."],
    curl: ["Piping `curl` straight to a shell executes unreviewed code.", "Without `-f`, curl exits 0 on HTTP 500."],
  };
  return [...(specific[bin] ?? []), ...generic].slice(0, 4);
}

function docsFor(command: string): Array<{ label: string; url: string }> {
  const bin = guessConcept(command);
  const map: Record<string, Array<{ label: string; url: string }>> = {
    git: [
      { label: "Pro Git (free book)", url: "https://git-scm.com/book/en/v2" },
      { label: "git reference", url: "https://git-scm.com/docs" },
    ],
    docker: [
      { label: "Docker CLI reference", url: "https://docs.docker.com/reference/cli/docker/" },
      { label: "Dockerfile best practices", url: "https://docs.docker.com/build/building/best-practices/" },
    ],
    npm: [
      { label: "npm CLI docs", url: "https://docs.npmjs.com/cli/v10/commands" },
    ],
  };
  return [
    ...(map[bin] ?? []),
    { label: `man page: ${bin}`, url: `https://man7.org/linux/man-pages/man1/${bin}.1.html` },
    { label: "roadmap.sh (this track)", url: "https://roadmap.sh/roadmaps" },
    { label: "Bash Reference Manual", url: "https://www.gnu.org/software/bash/manual/bash.html" },
  ].slice(0, 4);
}

function buildQuiz(command: string, exitOk: boolean): PendingQuiz {
  const bin = guessConcept(command);
  const bank: PendingQuiz[] = [
    {
      question: `You ran \`${bin}\`. Which shell variable holds the exit code of the command that just finished?`,
      choices: ["$?", "$!", "$0", "$#"],
      answer: "$?",
      explanation: "`$?` is the exit status of the most recently completed foreground command. 0 means success.",
    },
    {
      question: `Before running \`${bin}\` destructively, what is the safest first move?`,
      choices: [
        "Run it with a dry-run/list flag first",
        "Run it as root",
        "Run it twice to be sure",
        "Redirect stderr to /dev/null",
      ],
      answer: "Run it with a dry-run/list flag first",
      explanation: "Previewing the affected set (dry-run, `ls`, `--dry-run`, `-n`) turns an irreversible action into a reviewable one.",
    },
    {
      question: `In the pipeline \`${bin} ... | grep x\`, which exit code does the shell report by default?`,
      choices: [
        "The last command's (grep)",
        "The first command's",
        "The highest of the two",
        "Always 0",
      ],
      answer: "The last command's (grep)",
      explanation: "Without `set -o pipefail`, only the final command's status propagates — earlier failures are silently masked.",
    },
  ];
  const idx = (bin.length + activeRoadmap.step_index + (exitOk ? 0 : 1)) % bank.length;
  return bank[idx];
}

/* ------------------------------------------------------------------ *
 * Roadmap command suggestions
 * ------------------------------------------------------------------ */

const ROADMAP_COMMANDS: Record<string, string[]> = {
  "Command Line Basics": [
    "pwd",
    "ls -lah",
    "cd .. && pwd",
    "mkdir -p practice/day1 && cd practice/day1",
    "touch notes.txt && echo 'hello shell' > notes.txt",
    "cat notes.txt",
    "grep -n 'hello' notes.txt",
    "cp notes.txt notes.bak && ls -l",
    "mv notes.bak archive.txt",
    "rm -i archive.txt",
  ],
  "Git and GitHub": [
    "git --version",
    "git init demo-repo && cd demo-repo",
    "git status",
    "git add -A && git commit -m 'chore: initial commit'",
    "git log --oneline --graph --decorate --all",
    "git switch -c feature/first-branch",
    "git diff --stat",
    "git restore --staged .",
    "git remote -v",
    "git push --force-with-lease",
  ],
  "Backend Developer": [
    "node --version && npm --version",
    "npm init -y",
    "npm ci",
    "npm run build --if-present",
    "curl -fsS -o /dev/null -w '%{http_code}\\n' https://example.com",
    "lsof -nP -iTCP -sTCP:LISTEN",
    "docker compose config",
    "docker compose up -d --build",
    "docker compose logs --tail=100 -f",
    "docker compose down -v",
  ],
  "DevOps": [
    "uname -a",
    "df -h",
    "free -m || vm_stat",
    "systemctl --failed || launchctl list | head",
    "journalctl -p err -n 50 --no-pager",
    "docker ps --format 'table {{.Names}}\\t{{.Status}}'",
    "kubectl config current-context",
    "kubectl get pods -A",
    "terraform plan -out=tfplan",
    "terraform apply tfplan",
  ],
};

const DEFAULT_TRACK_FOR_CATEGORY: Record<Category, string> = {
  "Role Based": "Backend Developer",
  "Skill Based": "Git and GitHub",
  "Absolute Beginners": "Command Line Basics",
  "Best Practices": "DevOps",
};

function suggestCommand(): { command: string; rationale: string } {
  const list =
    ROADMAP_COMMANDS[activeRoadmap.roadmap_name] ??
    ROADMAP_COMMANDS[DEFAULT_TRACK_FOR_CATEGORY[activeRoadmap.category]] ??
    ROADMAP_COMMANDS["Command Line Basics"];
  const idx = Math.min(list.length - 1, Math.max(0, activeRoadmap.step_index - 1));
  return {
    command: list[idx],
    rationale: `Step ${activeRoadmap.step_index}/${activeRoadmap.total_steps} of "${activeRoadmap.roadmap_name}" — topic: ${activeRoadmap.current_topic}.`,
  };
}

/* ------------------------------------------------------------------ *
 * Command execution with hotfix diagnostics
 * ------------------------------------------------------------------ */

interface ExecOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  errorMessage?: string;
}

const DANGEROUS_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf]/, why: "recursive/forced delete" },
  { re: /\bmkfs(\.|\s)/, why: "filesystem format" },
  { re: /\bdd\s+.*of=\/dev\//, why: "raw device write" },
  { re: /:\(\)\s*\{.*\};\s*:/, why: "fork bomb" },
  { re: />\s*\/dev\/sd[a-z]/, why: "raw disk overwrite" },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b/, why: "host power state change" },
  { re: /\bchmod\s+-R\s+777\b/, why: "world-writable recursion" },
  { re: /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba)?sh/, why: "piping remote code into a shell" },
  { re: /\bgit\s+push\b.*--force(?!-with-lease)/, why: "history-rewriting force push" },
];

function screenDanger(command: string): string[] {
  return DANGEROUS_PATTERNS.filter((p) => p.re.test(command)).map((p) => p.why);
}

async function runCommand(command: string, cwd?: string): Promise<ExecOutcome> {
  try {
    const { stdout, stderr } = await exec(command, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024 * 4,
      cwd: cwd || process.cwd(),
      env: process.env,
    });
    return { ok: true, stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : null,
      errorMessage: e.killed
        ? `Process timed out or was killed (${e.signal ?? "timeout"}).`
        : e.message,
    };
  }
}

function hotfixDiagnostic(command: string, outcome: ExecOutcome): string {
  const bin = guessConcept(command);
  const blob = `${outcome.stderr}\n${outcome.errorMessage ?? ""}`.toLowerCase();
  const tips: string[] = [];

  if (blob.includes("command not found") || outcome.code === 127) {
    tips.push(`\`${bin}\` is not on your PATH. Install it, or check with \`command -v ${bin}\`.`);
  }
  if (blob.includes("permission denied")) {
    tips.push("Permission denied — check ownership with `ls -l`, and prefer fixing the file mode over `sudo`.");
  }
  if (blob.includes("no such file or directory")) {
    tips.push("A path does not exist. Run `pwd` and `ls` to confirm where you actually are.");
  }
  if (blob.includes("timed out") || blob.includes("killed")) {
    tips.push("The command exceeded the 60s tutor timeout. Long-running or interactive commands should be run in your own terminal.");
  }
  if (blob.includes("unexpected") || blob.includes("syntax error")) {
    tips.push("Shell syntax error — usually an unbalanced quote, paren, or a stray backslash.");
  }
  if (blob.includes("eacces") || blob.includes("eperm")) {
    tips.push("The OS refused the operation. You may be writing outside your user-owned directories.");
  }
  if (tips.length === 0) {
    tips.push(`Exit code ${outcome.code ?? "unknown"}. Read the stderr text above literally — it usually names the failing argument.`);
    tips.push(`Re-read the contract with \`${bin} --help\` or \`man ${bin}\`.`);
  }
  tips.push("Reproduce in isolation: run the smallest version of the command, then add flags back one at a time.");

  return [
    "### 🛠️ Tutor Hotfix Diagnostic",
    `**Command:** \`${command}\``,
    `**Exit code:** \`${outcome.code ?? "n/a"}\``,
    outcome.stderr.trim() ? "**stderr:**\n```\n" + outcome.stderr.trim().slice(0, 1500) + "\n```" : "",
    outcome.errorMessage ? `**Runtime error:** ${outcome.errorMessage}` : "",
    "",
    "**Troubleshooting ladder:**",
    ...tips.map((t, i) => `${i + 1}. ${t}`),
    "",
    "> Failures are curriculum. Nothing crashed — read the diagnosis, adjust one variable, and try again.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * UI card rendering
 * ------------------------------------------------------------------ */

function renderTeachingCard(
  command: string,
  outcome: ExecOutcome | null,
  dryRun: boolean,
  concept: string,
  quiz: PendingQuiz,
  xp: XpResult | null,
  dangerReasons: string[]
): string {
  const lens = AUDIENCE_LENS[skillLevel];
  const out: string[] = [];

  out.push(`# 🥋 Miyagi — \`${command}\``);
  out.push("");
  out.push("## 🗺️ Roadmap Alignment");
  out.push(
    `**${activeRoadmap.category} → ${activeRoadmap.roadmap_name}**  \n` +
      `Topic: **${activeRoadmap.current_topic}**  \n` +
      `Progress: \`${roadmapBar()}\``
  );
  out.push("");

  if (dangerReasons.length) {
    out.push("## ⚠️ Safety Screen");
    out.push(
      dangerReasons.map((r) => `- Flagged: **${r}**`).join("\n") +
        (dryRun ? "\n\n_Executed as a dry run — nothing was changed._" : "")
    );
    out.push("");
  }

  out.push(`## 🧠 Concept: ${concept}`);
  out.push(`**Audience level: ${skillLevel}**`);
  out.push(`- **What:** ${lens.what}`);
  out.push(`- **How:** ${lens.how}`);
  out.push(`- **Trade-offs:** ${lens.tradeoffs}`);
  out.push("");

  out.push("## 🖥️ Execution");
  if (dryRun || !outcome) {
    out.push("**Mode:** `DRY RUN` — the command was parsed and explained but not executed.");
    out.push("Copy-paste to run it yourself when ready:");
    out.push("```bash\n" + command + "\n```");
  } else if (outcome.ok) {
    out.push(`**Mode:** \`EXECUTED\` — exit code \`0\` ✅`);
    const so = outcome.stdout.trim();
    out.push("```\n" + (so ? so.slice(0, 4000) : "(no stdout)") + "\n```");
    if (outcome.stderr.trim()) {
      out.push("_stderr (non-fatal):_\n```\n" + outcome.stderr.trim().slice(0, 800) + "\n```");
    }
  } else {
    out.push(hotfixDiagnostic(command, outcome));
  }
  out.push("");

  out.push("## 📊 Mental Model");
  out.push("```mermaid\n" + mermaidFor(command, outcome?.ok ?? true) + "\n```");
  out.push("");

  out.push("## 🕳️ Common Pitfalls");
  out.push(pitfallsFor(command).map((p) => `- ${p}`).join("\n"));
  out.push("");

  out.push("## 📚 Curated Docs");
  out.push(docsFor(command).map((d) => `- [${d.label}](${d.url})`).join("\n"));
  out.push("");

  out.push("## ❓ Active Recall Quiz");
  out.push(`**${quiz.question}**`);
  out.push(quiz.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join("\n"));
  out.push("");
  out.push("_Answer with the `verify_quiz_answer` tool to bank XP and extend your streak._");
  out.push("");

  out.push("## 🏆 Player");
  out.push(
    `**${player.title}** · Level **${player.level}** · ${player.xp} XP  \n` +
      `\`${xpBar()}\`  \n` +
      `Streak: **${player.quizStreak}** 🔥 (best ${player.bestStreak})` +
      (player.badges.length ? `  \nBadges: ${player.badges.join(" · ")}` : "")
  );
  if (xp) {
    const bits = [`+${xp.awarded} XP`];
    if (xp.leveledUp) bits.push(`**LEVEL UP → ${xp.newLevel}**`);
    if (xp.titleChanged) bits.push(`new title: **${xp.newTitle}**`);
    if (xp.newBadges.length) bits.push(`unlocked: ${xp.newBadges.join(", ")}`);
    out.push(`> ${bits.join(" · ")}`);
  }

  return out.join("\n");
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/* ------------------------------------------------------------------ *
 * Server + tools
 * ------------------------------------------------------------------ */

const server = new McpServer({
  name: "miyagi",
  version: "1.0.0",
});

/* ---- quick_config -------------------------------------------------- */
server.registerTool(
  "quick_config",
  {
    title: "Quick Config",
    description:
      "Instantly switch the target skill level (Junior/Mid/Senior), roadmap category, roadmap track, or topic via simple key-value parameters.",
    inputSchema: {
      skill_level: z.enum(["Junior", "Mid", "Senior"]).optional()
        .describe("Depth of explanation used in every teaching card."),
      category: z
        .enum(["Role Based", "Skill Based", "Absolute Beginners", "Best Practices"])
        .optional(),
      roadmap_name: z.string().optional().describe('e.g. "Backend Developer", "Git and GitHub"'),
      current_topic: z.string().optional(),
      voice_enabled: z.boolean().optional(),
      words_per_minute: z.number().int().min(80).max(400).optional(),
    },
  },
  async (args) => {
    const changes: string[] = [];
    if (args.skill_level) {
      skillLevel = args.skill_level;
      changes.push(`skill level → **${skillLevel}**`);
    }
    if (args.category) {
      activeRoadmap.category = args.category;
      if (!args.roadmap_name && !ROADMAP_COMMANDS[activeRoadmap.roadmap_name]) {
        activeRoadmap.roadmap_name = DEFAULT_TRACK_FOR_CATEGORY[args.category];
      }
      changes.push(`category → **${activeRoadmap.category}**`);
    }
    if (args.roadmap_name) {
      activeRoadmap.roadmap_name = args.roadmap_name;
      changes.push(`roadmap → **${activeRoadmap.roadmap_name}**`);
    }
    if (args.current_topic) {
      activeRoadmap.current_topic = args.current_topic;
      changes.push(`topic → **${activeRoadmap.current_topic}**`);
    }
    if (typeof args.voice_enabled === "boolean") {
      voice.enabled = args.voice_enabled;
      if (!voice.enabled) audioQueue.clear();
      changes.push(`voice → **${voice.enabled ? "on" : "off"}**`);
    }
    if (args.words_per_minute) {
      voice.words_per_minute = args.words_per_minute;
      changes.push(`speech rate → **${voice.words_per_minute} wpm**`);
    }

    if (!changes.length) {
      return textResult(
        `## ⚙️ Quick Config (unchanged)\n- Skill level: **${skillLevel}**\n- Category: **${activeRoadmap.category}**\n- Roadmap: **${activeRoadmap.roadmap_name}**\n- Topic: **${activeRoadmap.current_topic}**\n- Voice: **${voice.enabled ? "on" : "off"}** @ ${voice.words_per_minute} wpm`
      );
    }

    record({ kind: "config", label: "quick_config", detail: changes.join("; "), xpAwarded: 0 });
    audioQueue.enqueue(`Configuration updated. Teaching at ${skillLevel} level on ${activeRoadmap.roadmap_name}.`);

    return textResult(
      `## ⚙️ Quick Config Applied\n${changes.map((c) => `- ${c}`).join("\n")}\n\n**Now teaching:** ${activeRoadmap.category} → ${activeRoadmap.roadmap_name} → ${activeRoadmap.current_topic} at **${skillLevel}** depth.`
    );
  }
);

/* ---- set_active_roadmap -------------------------------------------- */
server.registerTool(
  "set_active_roadmap",
  {
    title: "Set Active Roadmap",
    description:
      "Configure the active roadmap: category, roadmap name, current topic node, and progress step counters.",
    inputSchema: {
      category: z.enum([
        "Role Based",
        "Skill Based",
        "Absolute Beginners",
        "Best Practices",
      ]),
      roadmap_name: z.string(),
      current_topic: z.string(),
      step_index: z.number().int().min(1).default(1),
      total_steps: z.number().int().min(1).default(10),
    },
  },
  async (args) => {
    activeRoadmap.category = args.category;
    activeRoadmap.roadmap_name = args.roadmap_name;
    activeRoadmap.current_topic = args.current_topic;
    activeRoadmap.total_steps = args.total_steps;
    activeRoadmap.step_index = Math.min(args.step_index, args.total_steps);

    record({
      kind: "concept",
      label: `Roadmap set: ${args.roadmap_name}`,
      detail: `${args.category} → ${args.current_topic} (step ${activeRoadmap.step_index}/${activeRoadmap.total_steps})`,
      xpAwarded: 0,
    });
    audioQueue.enqueue(
      `Roadmap set to ${args.roadmap_name}. Current topic: ${args.current_topic}. Step ${activeRoadmap.step_index} of ${activeRoadmap.total_steps}.`
    );

    const next = suggestCommand();
    return textResult(
      [
        "## 🗺️ Active Roadmap Updated",
        `**Category:** ${activeRoadmap.category}`,
        `**Roadmap:** ${activeRoadmap.roadmap_name}`,
        `**Topic:** ${activeRoadmap.current_topic}`,
        `**Progress:** \`${roadmapBar()}\``,
        "",
        "**Suggested next command:**",
        "```bash\n" + next.command + "\n```",
      ].join("\n")
    );
  }
);

/* ---- get_next_roadmap_command -------------------------------------- */
server.registerTool(
  "get_next_roadmap_command",
  {
    title: "Get Next Roadmap Command",
    description:
      "Suggest the next copy-pasteable terminal command for the active roadmap milestone. Optionally advance the step counter.",
    inputSchema: {
      advance: z
        .boolean()
        .default(false)
        .describe("Advance step_index by one before suggesting."),
    },
  },
  async ({ advance }) => {
    if (advance && activeRoadmap.step_index < activeRoadmap.total_steps) {
      activeRoadmap.step_index += 1;
    }
    const { command, rationale } = suggestCommand();
    const danger = screenDanger(command);

    audioQueue.enqueue(
      `Next up on ${activeRoadmap.roadmap_name}: ${rationale}. Try the suggested command.`
    );
    record({ kind: "concept", label: "Suggested command", detail: command, xpAwarded: 0 });

    return textResult(
      [
        "## ➡️ Next Roadmap Command",
        rationale,
        `Progress: \`${roadmapBar()}\``,
        "",
        "```bash\n" + command + "\n```",
        danger.length
          ? `\n⚠️ **Safety note:** flagged for _${danger.join(", ")}_ — run with \`dry_run: true\` first.`
          : "",
        "",
        "Run it through `run_teaching_command` to get the full teaching card and earn XP.",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
);

/* ---- configure_voice ----------------------------------------------- */
server.registerTool(
  "configure_voice",
  {
    title: "Configure Voice",
    description: "Toggle tutor audio on/off and adjust the speech rate in words per minute.",
    inputSchema: {
      enabled: z.boolean().optional(),
      words_per_minute: z.number().int().min(80).max(400).optional(),
      test_phrase: z.string().optional().describe("Speak this immediately to test the setup."),
    },
  },
  async (args) => {
    if (typeof args.enabled === "boolean") {
      voice.enabled = args.enabled;
      if (!voice.enabled) audioQueue.clear();
    }
    if (args.words_per_minute) voice.words_per_minute = args.words_per_minute;

    const platform = os.platform();
    const engine =
      platform === "darwin"
        ? "`say`"
        : platform === "win32"
        ? "PowerShell `System.Speech.Synthesis`"
        : "`spd-say` (falls back to espeak/festival)";

    if (voice.enabled) {
      audioQueue.enqueue(
        args.test_phrase ?? `Voice enabled at ${voice.words_per_minute} words per minute.`
      );
    }

    return textResult(
      [
        "## 🔊 Voice Configuration",
        `- Audio: **${voice.enabled ? "ON" : "OFF"}**`,
        `- Rate: **${voice.words_per_minute} wpm**`,
        `- Platform: **${platform}** → engine ${engine}`,
        `- Queue depth: **${audioQueue.pending}**`,
        "",
        "_Speech is queued FIFO so lines never overlap, and a missing TTS binary degrades silently instead of crashing._",
      ].join("\n")
    );
  }
);

/* ---- get_user_stats ------------------------------------------------ */
server.registerTool(
  "get_user_stats",
  {
    title: "Get User Stats",
    description:
      "Return the current player profile: XP, level, title, quiz streak, unlocked badges, and roadmap progress.",
    inputSchema: {
      speak: z.boolean().default(false).describe("Read the stats aloud."),
    },
  },
  async ({ speak }) => {
    const nextLevelAt = player.level * 100;
    const summary = [
      "# 🏆 Player Stats",
      "",
      `**${player.title}** — Level **${player.level}**`,
      `XP: **${player.xp}** \`${xpBar()}\` (${nextLevelAt - player.xp} to level ${player.level + 1})`,
      `Quiz streak: **${player.quizStreak}** 🔥 · Best: **${player.bestStreak}**`,
      `Badges: ${player.badges.length ? player.badges.join(" · ") : "_none yet_"}`,
      "",
      "## 🗺️ Roadmap",
      `${activeRoadmap.category} → **${activeRoadmap.roadmap_name}**`,
      `Topic: ${activeRoadmap.current_topic}`,
      `\`${roadmapBar()}\``,
      "",
      "## ⚙️ Session",
      `- Teaching depth: **${skillLevel}**`,
      `- Voice: **${voice.enabled ? "on" : "off"}** @ ${voice.words_per_minute} wpm`,
      `- History entries: **${sessionHistory.length}**`,
      "",
      "## 🎖️ Title Ladder",
      ...TITLES.map(
        (t) =>
          `- ${player.level >= t.minLevel ? "✅" : "🔒"} **${t.title}** — level ${t.minLevel}+`
      ),
    ].join("\n");

    if (speak) {
      audioQueue.enqueue(
        `You are a ${player.title}, level ${player.level}, with ${player.xp} experience points and a quiz streak of ${player.quizStreak}.`
      );
    }
    return textResult(summary);
  }
);

/* ---- run_teaching_command ------------------------------------------ */
server.registerTool(
  "run_teaching_command",
  {
    title: "Run Teaching Command",
    description:
      "Execute (or dry-run) a shell command and return a full teaching card: roadmap alignment, level-appropriate What/How/Trade-offs, a Mermaid flowchart, pitfalls, curated docs, and an active-recall quiz. Errors return a Tutor Hotfix Diagnostic instead of throwing.",
    inputSchema: {
      command: z.string().min(1).describe("The shell command to teach and optionally run."),
      concept: z
        .string()
        .optional()
        .describe("Concept label for the card, e.g. 'Filesystem navigation'."),
      is_dangerous: z
        .boolean()
        .default(false)
        .describe("Caller-asserted danger flag. Dangerous commands are forced into dry-run."),
      dry_run: z
        .boolean()
        .default(false)
        .describe("Explain without executing."),
      cwd: z.string().optional().describe("Working directory for execution."),
    },
  },
  async (args) => {
    const command = args.command.trim();
    const detected = screenDanger(command);
    const dangerReasons = args.is_dangerous
      ? ["caller-flagged as dangerous", ...detected]
      : detected;
    const dryRun = args.dry_run || args.is_dangerous || detected.length > 0;

    let outcome: ExecOutcome | null = null;
    if (!dryRun) {
      outcome = await runCommand(command, args.cwd);
    }

    const concept = args.concept ?? `\`${guessConcept(command)}\` in ${activeRoadmap.current_topic}`;
    const quiz = buildQuiz(command, outcome?.ok ?? true);
    pendingQuiz = quiz;

    // XP: +15 for a real execution (success or an instructive failure is still practice).
    const xp = outcome ? awardXp(15) : null;

    record({
      kind: "command",
      label: command,
      detail: dryRun
        ? "dry run — not executed"
        : outcome!.ok
        ? "executed successfully (exit 0)"
        : `failed (exit ${outcome!.code ?? "n/a"}) — hotfix diagnostic issued`,
      xpAwarded: xp?.awarded ?? 0,
    });

    // Queue clean speech: narration, never raw stdout.
    const spoken = dryRun
      ? `Dry run for ${guessConcept(command)}. ${AUDIENCE_LENS[skillLevel].what} Here is the quiz: ${quiz.question}`
      : outcome!.ok
      ? `Command succeeded. ${concept}. You earned 15 experience points. Quiz time: ${quiz.question}`
      : `The command failed. Do not worry, here is the hotfix diagnostic. ${quiz.question}`;
    audioQueue.enqueue(spoken);

    return textResult(
      renderTeachingCard(command, outcome, dryRun, concept, quiz, xp, dangerReasons)
    );
  }
);

/* ---- verify_quiz_answer -------------------------------------------- */
server.registerTool(
  "verify_quiz_answer",
  {
    title: "Verify Quiz Answer",
    description:
      "Evaluate the learner's answer to the most recent active-recall quiz. Updates streak, XP and badges, and speaks feedback.",
    inputSchema: {
      answer: z
        .string()
        .min(1)
        .describe("The learner's answer — a letter (A-D) or the answer text."),
    },
  },
  async ({ answer }) => {
    if (!pendingQuiz) {
      return textResult(
        "## ❓ No Active Quiz\nRun `run_teaching_command` first — every teaching card ends with a question."
      );
    }

    const quiz = pendingQuiz;
    const given = answer.trim();
    const letter = given.replace(/[).\s]/g, "").toUpperCase();
    let chosen: string | null = null;
    if (/^[A-D]$/.test(letter)) {
      chosen = quiz.choices[letter.charCodeAt(0) - 65] ?? null;
    }
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$?!#]/g, "");
    const correct =
      (chosen !== null && norm(chosen) === norm(quiz.answer)) ||
      norm(given) === norm(quiz.answer);

    let xp: XpResult;
    const newBadges: string[] = [];

    if (correct) {
      player.quizStreak += 1;
      player.bestStreak = Math.max(player.bestStreak, player.quizStreak);
      const multiplier = 1 + Math.min(1, Math.floor(player.quizStreak / 3) * 0.25);
      const amount = Math.round(25 * multiplier);
      xp = awardXp(amount);

      if (player.quizStreak >= 3 && addBadge("Sharpshooter 🔥")) newBadges.push("Sharpshooter 🔥");
      if (player.quizStreak >= 5 && addBadge("Deadeye 🎯")) newBadges.push("Deadeye 🎯");
      if (player.quizStreak >= 10 && addBadge("Unbreakable 💎")) newBadges.push("Unbreakable 💎");

      record({
        kind: "quiz",
        label: quiz.question,
        detail: `Correct (${quiz.answer}) — streak ${player.quizStreak}, x${multiplier}`,
        xpAwarded: amount,
      });

      audioQueue.enqueue(
        `Correct! ${quiz.explanation} You earned ${amount} experience points. Your streak is ${player.quizStreak}.` +
          (xp.leveledUp ? ` Level up! You are now a ${player.title}.` : "")
      );

      const lines = [
        "# ✅ Correct!",
        "",
        `**Answer:** ${quiz.answer}`,
        `**Why:** ${quiz.explanation}`,
        "",
        `+**${xp.awarded} XP** (base 25 × ${multiplier} streak multiplier)`,
        `Streak: **${player.quizStreak}** 🔥 · Best: **${player.bestStreak}**`,
        `**${player.title}** — Level **${player.level}** · ${player.xp} XP \`${xpBar()}\``,
      ];
      if (xp.leveledUp) lines.push("", `## 🎉 LEVEL UP → **${player.level}**`);
      if (xp.titleChanged) lines.push(`New title unlocked: **${player.title}**`);
      if (newBadges.length) lines.push(`Badges unlocked: ${newBadges.join(" · ")}`);
      lines.push("", "_Keep going — call `get_next_roadmap_command` for the next milestone._");

      pendingQuiz = null;
      return textResult(lines.join("\n"));
    }

    const lostStreak = player.quizStreak;
    player.quizStreak = 0;
    xp = awardXp(5); // consolation XP for attempting

    record({
      kind: "quiz",
      label: quiz.question,
      detail: `Incorrect (answered "${given}", correct: ${quiz.answer}) — streak reset from ${lostStreak}`,
      xpAwarded: 5,
    });

    audioQueue.enqueue(
      `Not quite. The correct answer is ${quiz.answer}. ${quiz.explanation} Your streak resets, but you keep 5 experience points for trying.`
    );

    pendingQuiz = null;
    return textResult(
      [
        "# ❌ Not Quite",
        "",
        `**You answered:** ${given}`,
        `**Correct answer:** ${quiz.answer}`,
        `**Why:** ${quiz.explanation}`,
        "",
        `+**5 XP** for the attempt.` + (lostStreak ? ` Streak reset from **${lostStreak}** → 0.` : ""),
        `**${player.title}** — Level **${player.level}** · ${player.xp} XP \`${xpBar()}\``,
        "",
        "_Re-run the command and say the answer out loud before checking — that's what makes recall stick._",
      ].join("\n")
    );
  }
);

/* ---- export_roadmap_notes ------------------------------------------ */
server.registerTool(
  "export_roadmap_notes",
  {
    title: "Export Roadmap Notes",
    description:
      "Write a clean ROADMAP_PROGRESS.md summary of the session — roadmap position, player stats, and every concept/command covered.",
    inputSchema: {
      output_path: z
        .string()
        .default("ROADMAP_PROGRESS.md")
        .describe("File path (relative paths resolve against the server's cwd)."),
      append: z.boolean().default(false).describe("Append instead of overwriting."),
    },
  },
  async ({ output_path, append }) => {
    const target = path.isAbsolute(output_path)
      ? output_path
      : path.resolve(process.cwd(), output_path);

    const commands = sessionHistory.filter((h) => h.kind === "command");
    const quizzes = sessionHistory.filter((h) => h.kind === "quiz");
    const concepts = sessionHistory.filter((h) => h.kind === "concept");
    const correct = quizzes.filter((q) => q.detail.startsWith("Correct")).length;

    const md = [
      "# 🗺️ Roadmap Progress",
      "",
      `> Generated by **miyagi** on ${new Date().toISOString()}`,
      `> Session started: ${sessionStartedAt}`,
      "",
      "## Current Position",
      "",
      `| Field | Value |`,
      `| --- | --- |`,
      `| Category | ${activeRoadmap.category} |`,
      `| Roadmap | ${activeRoadmap.roadmap_name} |`,
      `| Topic | ${activeRoadmap.current_topic} |`,
      `| Step | ${activeRoadmap.step_index} / ${activeRoadmap.total_steps} |`,
      `| Teaching depth | ${skillLevel} |`,
      "",
      "## Player",
      "",
      `- **Title:** ${player.title}`,
      `- **Level:** ${player.level}`,
      `- **XP:** ${player.xp}`,
      `- **Quiz streak:** ${player.quizStreak} (best ${player.bestStreak})`,
      `- **Badges:** ${player.badges.length ? player.badges.join(", ") : "none yet"}`,
      `- **Quiz accuracy:** ${quizzes.length ? `${correct}/${quizzes.length} (${Math.round((correct / quizzes.length) * 100)}%)` : "no quizzes answered"}`,
      "",
      "## Commands Practised",
      "",
      commands.length
        ? commands
            .map((c) => `- \`${c.label}\` — ${c.detail}${c.xpAwarded ? ` _(+${c.xpAwarded} XP)_` : ""}`)
            .join("\n")
        : "_No commands run this session._",
      "",
      "## Concepts Covered",
      "",
      concepts.length
        ? concepts.map((c) => `- **${c.label}** — ${c.detail}`).join("\n")
        : "_No concepts recorded._",
      "",
      "## Quiz Log",
      "",
      quizzes.length
        ? quizzes.map((q) => `- ${q.detail.startsWith("Correct") ? "✅" : "❌"} ${q.label}\n  - ${q.detail}`).join("\n")
        : "_No quizzes answered._",
      "",
      "## Next Up",
      "",
      "```bash\n" + suggestCommand().command + "\n```",
      "",
      "---",
      "_Review this file tomorrow before starting — spaced repetition is where the XP turns into skill._",
      "",
    ].join("\n");

    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (append) {
        await fs.appendFile(target, "\n\n" + md, "utf8");
      } else {
        await fs.writeFile(target, md, "utf8");
      }
    } catch (err) {
      return textResult(
        [
          "### 🛠️ Tutor Hotfix Diagnostic",
          `Could not write **${target}**: ${(err as Error).message}`,
          "",
          "1. Check the directory exists and is writable (`ls -ld`).",
          "2. Try an absolute path inside your home directory.",
          "3. The server's cwd is: `" + process.cwd() + "`",
        ].join("\n")
      );
    }

    audioQueue.enqueue(
      `Notes exported. You covered ${commands.length} commands and answered ${quizzes.length} quiz questions this session.`
    );

    return textResult(
      [
        "## 📝 Notes Exported",
        `Wrote **${target}** (${append ? "appended" : "overwritten"}, ${md.length} bytes).`,
        "",
        `- Commands practised: **${commands.length}**`,
        `- Concepts covered: **${concepts.length}**`,
        `- Quizzes: **${correct}/${quizzes.length}** correct`,
        `- Ending as: **${player.title}**, level **${player.level}**, ${player.xp} XP`,
      ].join("\n")
    );
  }
);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

process.on("uncaughtException", (e) => log("uncaughtException:", e));
process.on("unhandledRejection", (e) => log("unhandledRejection:", e));

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready on stdio — platform ${os.platform()}, cwd ${process.cwd()}`);
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
