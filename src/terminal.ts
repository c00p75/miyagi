/**
 * Miyagi in a terminal.
 *
 * The MCP server needs an assistant that chooses to call it, and the panel
 * needs VS Code. Neither is true for someone working in JetBrains, Neovim,
 * Zed or a plain shell beside a terminal agent. This is the same tutor with
 * no host at all:
 *
 *   miyagi watch [dir]   teach from what changes in a repository, as it changes
 *   miyagi review        answer what is due, from memory
 *   miyagi dojo          what has been found, and the belt held in each
 *
 * It shares everything that matters with the other two: the idea pack, the
 * ranking, the questions, the review schedule, the scoring and the profile in
 * `~/.miyagi`. A belt earned here is the belt the panel shows.
 *
 * All input and output goes through `TerminalIo`, so the whole of a review can
 * be driven by a test with scripted answers.
 */

import readline from "node:readline";
import path from "node:path";
import { conceptsIn, gitChanges } from "./changes.js";
import {
  beltForBox,
  conceptBin,
  conceptById,
  isConceptBin,
  type ConceptLevel,
  type FileChange,
} from "./concepts.js";
import { conceptFamiliarity } from "./familiarity.js";
import { flushHistory } from "./history.js";
import { loadIdeaPacks } from "./packs.js";
import { ask, grade, questionById, type AskedQuiz } from "./quiz.js";
import { XP_CONCEPT_DISCOVERED, scoreQuizAnswer } from "./scoring.js";
import * as S from "./state.js";
import {
  dojoRows,
  dojoSummary,
  mergeSightings,
  pickConceptQuestion,
  rankSightings,
  type Familiarity,
  type Sighting,
} from "./teach.js";
import { DiffTracker } from "./tracker.js";
import { VERSION } from "./version.js";

export interface TerminalIo {
  write(text: string): void;
  /** Resolves with what was typed, or null when input has ended. */
  ask(prompt: string): Promise<string | null>;
  /** Terminal width in columns. */
  width: number;
  colour: boolean;
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

const ESC = "\u001b[";

export function styler(colour: boolean) {
  const wrap = (code: string) => (s: string) => (colour ? `${ESC}${code}m${s}${ESC}0m` : s);
  return { bold: wrap("1"), dim: wrap("2"), green: wrap("32"), red: wrap("31"), yellow: wrap("33"), cyan: wrap("36") };
}

/** Lesson text is written in light markdown. A terminal shows the words. */
export function plain(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1$2");
}

/** Wraps to a width on spaces, keeping a hanging indent. Never splits a word. */
export function wrap(text: string, width: number, indent = ""): string {
  const limit = Math.max(20, width - indent.length);
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > limit) {
        out.push(indent + line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(indent + line);
  }
  return out.join("\n");
}

export function renderCard(
  s: Sighting,
  level: ConceptLevel,
  f: Familiarity,
  io: Pick<TerminalIo, "width" | "colour">,
): string {
  const c = conceptById(s.id);
  if (!c) return "";
  const st = styler(io.colour);
  const width = Math.min(io.width, 96);
  const status = f.seen ? `${beltForBox(f.box).name} belt` : "new";
  const where = s.files > 1 ? `${s.file} and ${s.files - 1} more` : s.file;
  const section = (label: string, body: string) => `${st.dim(label)}\n${wrap(plain(body), width, "  ")}`;
  return [
    `${st.bold(`${c.emoji}  ${c.title}`)}  ${st.cyan(`[${status}]`)}`,
    wrap(plain(c.hook), width, "  "),
    "",
    `${st.dim("Where")}\n  ${where}${s.evidence ? `\n  ${st.dim(s.evidence)}` : ""}`,
    section("What it is", c.what),
    section("Know this", c.lens[level]),
    section("How it bites", c.pitfall),
    st.dim(`  ${c.docs.url}`),
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Teaching a change
 * ------------------------------------------------------------------ */

export interface Taught {
  cards: number;
  discovered: number;
  later: string[];
}

/**
 * Turns added lines into cards and queues their questions. Ideas already
 * shown since the watcher started are skipped: an assistant touches the same
 * idea edit after edit, and a card per edit is wallpaper.
 */
export async function teachChanges(
  changes: readonly FileChange[],
  shown: Set<string>,
  io: TerminalIo,
  limit = 2,
): Promise<Taught> {
  await S.hydrate();
  const sightings = mergeSightings(conceptsIn(changes)).filter((s) => conceptById(s.id) && !shown.has(s.id));
  if (!sightings.length) return { cards: 0, discovered: 0, later: [] };
  const before = new Map(sightings.map((s) => [s.id, conceptFamiliarity(s.id)]));
  const fam = (id: string) => before.get(id)!;
  const ranked = rankSightings(sightings, fam, limit);
  const level = S.session.skillLevel;

  let discovered = 0;
  for (const s of ranked.teach) {
    const c = conceptById(s.id)!;
    const f = fam(s.id);
    if (!f.seen) discovered++;
    const question = pickConceptQuestion(s.id, level, S.session.recentQuizIds);
    if (question) S.ensureReviewItem("quiz", question.id, question.question);
    S.record({
      kind: "concept",
      label: c.title,
      bin: conceptBin(s.id),
      detail: `${f.seen ? "seen again" : "discovered"} in ${s.file} (terminal)`,
      xpAwarded: f.seen ? 0 : XP_CONCEPT_DISCOVERED,
    });
    shown.add(s.id);
    io.write("\n" + renderCard(s, level, f, io) + "\n");
  }
  for (const s of ranked.solid) shown.add(s.id);
  if (ranked.teach.length) S.touchDay();
  await S.persistNow();
  await flushHistory();
  return {
    cards: ranked.teach.length,
    discovered,
    later: ranked.later.map((s) => conceptById(s.id)!.title),
  };
}

export interface WatchOptions {
  cwd: string;
  /** Milliseconds between looks at the repository. */
  pollMs?: number;
  /** A change is taught once the repository has been still for this long. */
  quietMs?: number;
  signal?: AbortSignal;
}

/**
 * Watches one repository until interrupted. What was already uncommitted when
 * it started is the baseline and is not taught; a change is taught once the
 * work has paused, not mid-burst.
 */
export async function runWatch(io: TerminalIo, options: WatchOptions): Promise<number> {
  const st = styler(io.colour);
  const first = await gitChanges(options.cwd);
  if (first.kind === "none" && !(await isRepository(options.cwd))) {
    io.write(`${options.cwd} is not a git repository. Run this inside one, or pass its path: miyagi watch <dir>\n`);
    return 1;
  }
  await loadIdeaPacks().catch(() => []);
  const tracker = new DiffTracker();
  tracker.delta(options.cwd, first.changes);
  const shown = new Set<string>();
  const pending = new Map<string, FileChange>();
  let lastChange = 0;
  const pollMs = options.pollMs ?? 3_000;
  const quietMs = options.quietMs ?? 20_000;

  await S.hydrate();
  const due = S.reviewCounts().dueQuiz;
  io.write(
    `${st.bold(`miyagi ${VERSION}`)} watching ${path.basename(options.cwd)}. Cards appear when the work pauses. Ctrl+C to stop.\n` +
      (due ? `${due} question${due === 1 ? " is" : "s are"} due: ${st.cyan("miyagi review")}\n` : ""),
  );

  while (!options.signal?.aborted) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (options.signal?.aborted) break;
    const found = await gitChanges(options.cwd).catch(() => null);
    const fresh = found ? tracker.delta(options.cwd, found.changes) : [];
    for (const change of fresh) {
      const earlier = pending.get(change.file);
      pending.set(
        change.file,
        earlier
          ? { file: change.file, added: `${earlier.added}\n${change.added}`, addedLines: earlier.addedLines + change.addedLines }
          : change,
      );
      lastChange = Date.now();
    }
    if (!pending.size || Date.now() - lastChange < quietMs) continue;
    const changes = [...pending.values()];
    pending.clear();
    const names = changes.map((c) => c.file);
    const taught = await teachChanges(changes, shown, io);
    const stamp = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    io.write(
      st.dim(
        `${stamp}  ${names.length} file${names.length === 1 ? "" : "s"} changed (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}): ` +
          (taught.cards ? `${taught.cards} idea${taught.cards === 1 ? "" : "s"} above` : "nothing new to teach") +
          (taught.later.length ? `. Also in there: ${taught.later.join(", ")}` : "") +
          "\n",
      ),
    );
    if (taught.cards) io.write(st.dim(`Their questions are queued: ${"miyagi review"}\n`));
  }
  return 0;
}

async function isRepository(cwd: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeout: 10_000 }, (err, stdout) =>
      resolve(!err && String(stdout).trim() === "true"),
    );
  });
}

/* ------------------------------------------------------------------ *
 * Review
 * ------------------------------------------------------------------ */

export interface ReviewResult {
  asked: number;
  correct: number;
  xp: number;
}

/**
 * Asks what is due, most overdue first. Recall comes before recognition here
 * too: the question is shown alone, and the choices only after Enter.
 */
export async function runReview(io: TerminalIo, options: { limit?: number } = {}): Promise<ReviewResult> {
  const st = styler(io.colour);
  const width = Math.min(io.width, 96);
  await S.hydrate();
  await loadIdeaPacks().catch(() => []);
  const result: ReviewResult = { asked: 0, correct: 0, xp: 0 };
  const limit = options.limit ?? 20;
  const done = new Set<string>();
  let stopped = false;

  while (result.asked < limit) {
    const item = S.due("quiz", 200).find((r) => !done.has(r.ref) && questionById(r.ref));
    if (!item) break;
    done.add(item.ref);
    const question = questionById(item.ref)!;
    const bin = question.bins[0] ?? "shell";
    const about = isConceptBin(bin) ? conceptById(bin.slice("concept:".length))?.title ?? "Recall" : bin;
    const quiz: AskedQuiz = ask(question, bin, { review: true, salt: String(result.asked) });
    S.noteQuizAsked(question.id);

    io.write(`\n${st.dim(about)}\n${st.bold(wrap(plain(quiz.question), width))}\n`);
    if ((await io.ask(st.dim("Answer it in your head, then press Enter for the choices. "))) === null) {
      stopped = true;
      break;
    }
    quiz.choices.forEach((choice, i) => io.write(wrap(`${"ABCDEFGH"[i]}. ${plain(choice)}`, width, "   ").replace(/^ {3}/, "  ") + "\n"));

    let given: string | null = null;
    for (;;) {
      given = await io.ask("Your answer (letter), or q to stop: ");
      if (given === null || /^q(uit)?$/i.test(given.trim())) {
        given = null;
        break;
      }
      const letter = given.trim().toUpperCase();
      if (/^[A-H]$/.test(letter) && letter.charCodeAt(0) - 65 < quiz.choices.length) break;
      io.write(`Type one of ${"ABCDEFGH".slice(0, quiz.choices.length).split("").join(", ")}.\n`);
    }
    if (given === null) {
      stopped = true;
      break;
    }

    const { correct } = grade(quiz, given);
    const elapsed = Date.now() - Date.parse(quiz.askedAt);
    S.recordMastery(bin, { quiz: true, correct });
    const scheduled = S.gradeReviewItem("quiz", question.id, correct, { hesitant: elapsed > 45_000 });
    S.touchDay();
    const score = scoreQuizAnswer(correct, true);
    S.record({
      kind: "review",
      label: quiz.question,
      bin,
      correct,
      detail: correct ? `Correct (${quiz.answer}) (terminal)` : `Incorrect, correct: ${quiz.answer} (terminal)`,
      xpAwarded: score.amount,
    });
    result.asked++;
    result.xp += score.amount;
    if (correct) result.correct++;

    const again = scheduled ? `, back ${relativeDays(scheduled.dueAt)}` : "";
    io.write(
      (correct ? st.green("Correct") : `${st.red("Not quite.")} It is: ${plain(quiz.answer)}`) +
        st.dim(`  +${score.amount} XP${again}${correct && scheduled ? `, ${beltForBox(scheduled.box).name} belt` : ""}`) +
        `\n${wrap(plain(quiz.explanation), width, "  ")}\n`,
    );
    await S.persistNow();
  }

  await S.persistNow();
  await flushHistory();
  const left = S.reviewCounts().dueQuiz;
  io.write(
    result.asked
      ? `\n${st.bold(`${result.correct} of ${result.asked}`)} from memory, +${result.xp} XP. ${left} still due.\n`
      : stopped
      ? `\nStopped. ${left} question${left === 1 ? " is" : "s are"} still due.\n`
      : "\nNothing is due. Questions come back after 10 minutes, then 1, 3, 7, 16 and 35 days.\n",
  );
  return result;
}

function relativeDays(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ *
 * Dojo
 * ------------------------------------------------------------------ */

export async function runDojo(io: TerminalIo): Promise<number> {
  const st = styler(io.colour);
  await S.hydrate();
  await loadIdeaPacks().catch(() => []);
  const rows = dojoRows(conceptFamiliarity);
  const seen = rows
    .filter((r) => r.familiarity.seen)
    .sort((a, b) => b.familiarity.box - a.familiarity.box || a.title.localeCompare(b.title));
  io.write(`${st.bold("The Dojo")}  ${plain(dojoSummary(rows))}\n\n`);
  for (const r of seen) {
    const belt = beltForBox(r.familiarity.box).name;
    const dots = Array.from({ length: 6 }, (_, i) => (i <= r.familiarity.box ? "●" : "○")).join("");
    io.write(`  ${dots}  ${belt.padEnd(7)} ${r.emoji}  ${r.title}\n`);
  }
  const locked = rows.length - seen.length;
  if (locked) io.write(st.dim(`\n  ${locked} still locked. They unlock when code that uses them is written.\n`));
  const due = S.reviewCounts().dueQuiz;
  io.write(`\nLevel ${S.player.level}, ${S.player.xp} XP. ${due ? `${due} due: ${st.cyan("miyagi review")}` : "Nothing due."}\n`);
  return 0;
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

export type TerminalCommand = { name: "watch"; dir: string } | { name: "review" } | { name: "dojo" };

/** The terminal commands, or null when the arguments ask for something else. */
export function parseTerminalCommand(argv: readonly string[], cwd: string): TerminalCommand | null {
  const [first, second] = argv;
  if (first === "watch" || first === "--watch") {
    return { name: "watch", dir: second && !second.startsWith("-") ? path.resolve(cwd, second) : cwd };
  }
  if (first === "review" || first === "--review") return { name: "review" };
  if (first === "dojo" || first === "--dojo") return { name: "dojo" };
  return null;
}

export function stdio(): TerminalIo & { close(): void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on("close", () => (closed = true));
  return {
    write: (text) => void process.stdout.write(text),
    ask: (prompt) =>
      new Promise((resolve) => {
        if (closed) return resolve(null);
        const onClose = () => resolve(null);
        rl.once("close", onClose);
        rl.question(prompt, (answer) => {
          rl.off("close", onClose);
          resolve(answer);
        });
      }),
    width: process.stdout.columns || 80,
    colour: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    close: () => rl.close(),
  };
}

export async function runTerminal(command: TerminalCommand): Promise<number> {
  const io = stdio();
  try {
    if (command.name === "review") {
      await runReview(io);
      return 0;
    }
    if (command.name === "dojo") return await runDojo(io);
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    return await runWatch(io, { cwd: command.dir, signal: abort.signal });
  } finally {
    io.close();
  }
}
