/**
 * The panel's side of Miyagi's engine.
 *
 * Nothing here is new teaching logic. Concepts, ranking, questions, the review
 * schedule, XP and persistence are all imported from the MCP server's own
 * modules, so a concept learned in the panel is the same record the server
 * reads, in the same `~/.miyagi/profile.json`.
 *
 * What this file adds is the shape a panel needs: plain data instead of
 * markdown, a question per card instead of one per lesson, and a reload from
 * disk before every operation, because the MCP server may be running next to
 * the editor and writing the same profile.
 *
 * It imports nothing from `vscode`, which is what lets it be tested with
 * `node --test` against a scratch `MIYAGI_HOME`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import * as S from "../../src/state.js";
import {
  UNSEEN,
  dojoRows,
  mergeSightings,
  pickConceptQuestion,
  rankSightings,
  type Familiarity,
  type Sighting,
} from "../../src/teach.js";
import {
  BELTS,
  beltForBox,
  conceptBin,
  conceptById,
  isConceptBin,
  questionsForConcept,
  scrub,
  type ConceptHit,
  type ConceptLevel,
} from "../../src/concepts.js";
import { ask, questionById, type AskedQuiz } from "../../src/quiz.js";
import { flushHistory } from "../../src/history.js";
import { contentFor } from "../../src/content.js";
import { XP_CONCEPT_DISCOVERED, scoreQuizAnswer } from "../../src/scoring.js";
import { TOPICS, topicOf, type Topic } from "./topics.js";

export { TOPICS, type Topic };

export type Level = ConceptLevel;

export interface Chip {
  id: string;
  title: string;
  emoji: string;
}

export interface CardView {
  key: string;
  conceptId: string;
  title: string;
  emoji: string;
  hook: string;
  what: string;
  lens: Record<Level, string>;
  pitfall: string;
  askTheAi: string;
  docs: { label: string; url: string };
  topic: Topic;
  /** `locked`: in the pack, not yet seen in this learner's code. */
  status: "new" | "learning" | "locked";
  belt: string;
  lapses: number;
  /** Repository root, so the panel can open the file. Empty when no file is known. */
  root: string;
  /** Where it was seen. Empty for an idea opened from the dojo that has no known file. */
  file: string;
  otherFiles: number;
  evidence: string;
  hasQuiz: boolean;
}

export interface LessonView {
  id: string;
  at: string;
  /** Completes "From …". */
  source: string;
  cards: CardView[];
  later: Chip[];
  solid: Chip[];
  discovered: number;
  xpAwarded: number;
}

export interface QuizView {
  token: string;
  question: string;
  choices: string[];
  review: boolean;
  /** The concept or command this question is about, for the review heading. */
  about: string;
}

export interface AnswerView {
  token: string;
  correct: boolean;
  chosenIndex: number;
  answerIndex: number;
  explanation: string;
  xpAwarded: number;
  /** ISO time the question comes back, or null if it was not in the queue. */
  nextDueAt: string | null;
  belt: string;
  leveledUp: boolean;
  title: string;
  newBadges: string[];
  quizStreak: number;
}

export interface StatusView {
  xp: number;
  level: number;
  title: string;
  /** XP into the current level, 0-99. */
  intoLevel: number;
  dayStreak: number;
  quizStreak: number;
  dueQuestions: number;
  /** Due questions per topic, for the filter. */
  dueByTopic: Record<string, number>;
  /** Command drills belong to the terminal tracks; the panel only counts them. */
  dueCommands: number;
  discovered: number;
  concepts: number;
  depth: Level;
}

export interface DojoRowView {
  id: string;
  title: string;
  emoji: string;
  topic: Topic;
  seen: boolean;
  box: number;
  belt: string;
  lapses: number;
}

/* ------------------------------------------------------------------ *
 * Serialisation and sync
 * ------------------------------------------------------------------ */

let chain: Promise<unknown> = Promise.resolve();

/**
 * Every operation runs alone, after re-reading the profile. The reload is what
 * keeps two writers honest: without it the panel would save a snapshot taken
 * before the server's last answer and the merge would have to guess.
 */
function run<T>(work: () => T | Promise<T>, options: { write?: boolean } = {}): Promise<T> {
  const next = chain.then(async () => {
    await S.hydrate();
    const out = await work();
    if (options.write) {
      await S.persistNow();
      await flushHistory();
    }
    return out;
  });
  chain = next.catch(() => undefined);
  return next;
}

function familiarity(id: string): Familiarity {
  const items = questionsForConcept(id)
    .map((q) => S.findReviewItem("quiz", q.id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  if (!items.length) return UNSEEN;
  return {
    seen: true,
    box: Math.max(...items.map((i) => i.box)),
    lapses: items.reduce((n, i) => n + i.lapses, 0),
  };
}

export interface Where {
  root: string;
  file: string;
  otherFiles: number;
  evidence: string;
}

const NOWHERE: Where = { root: "", file: "", otherFiles: 0, evidence: "" };

function buildCard(conceptId: string, key: string, f: Familiarity, where: Where, hasQuiz: boolean): CardView | null {
  const c = conceptById(conceptId);
  if (!c) return null;
  return {
    key,
    conceptId,
    title: c.title,
    emoji: c.emoji,
    hook: c.hook,
    what: c.what,
    lens: c.lens,
    pitfall: c.pitfall,
    askTheAi: c.askTheAi,
    docs: c.docs,
    topic: topicOf(conceptId),
    status: f.seen ? "learning" : "new",
    belt: beltForBox(f.box).name,
    lapses: f.lapses,
    ...where,
    hasQuiz,
  };
}

const chip = (s: Sighting): Chip => {
  const c = conceptById(s.id)!;
  return { id: c.id, title: c.title, emoji: c.emoji };
};

/* ------------------------------------------------------------------ *
 * Teaching
 * ------------------------------------------------------------------ */

/**
 * Concepts already put on a card since the editor opened. An assistant touches
 * the same idea in edit after edit; one card per sitting is teaching, a card
 * per edit is wallpaper.
 */
const taughtThisSession = new Set<string>();
let lessonCounter = 0;

export interface TeachInput {
  changes: ReadonlyArray<{ file: string; concepts: readonly ConceptHit[] }>;
  root: string;
  source: string;
  limit: number;
  /** A deliberate request re-teaches ideas already shown this sitting. */
  repeat?: boolean;
}

export function teach(input: TeachInput): Promise<LessonView | null> {
  return run(
    () => {
      const sightings = mergeSightings(input.changes).filter(
        (s) => conceptById(s.id) && (input.repeat || !taughtThisSession.has(s.id)),
      );
      if (!sightings.length) return null;

      // Familiarity is read before anything is queued, so "new" means new.
      const before = new Map(sightings.map((s) => [s.id, familiarity(s.id)]));
      const fam = (id: string) => before.get(id) ?? UNSEEN;
      const ranked = rankSightings(sightings, fam, Math.max(1, input.limit));
      const depth = S.session.skillLevel;
      const id = `l${Date.now().toString(36)}-${++lessonCounter}`;

      let discovered = 0;
      const cards: CardView[] = [];
      for (const s of ranked.teach) {
        const c = conceptById(s.id)!;
        const f = fam(s.id);
        if (!f.seen) discovered++;
        // Queued now, asked when the learner opens it: the schedule should not
        // depend on whether they happened to be looking at the panel.
        const question = pickConceptQuestion(s.id, depth, S.session.recentQuizIds);
        if (question) S.ensureReviewItem("quiz", question.id, question.question);
        S.record({
          kind: "concept",
          label: c.title,
          bin: conceptBin(s.id),
          detail: `${f.seen ? "seen again" : "discovered"} in ${s.file} (panel)`,
          xpAwarded: f.seen ? 0 : XP_CONCEPT_DISCOVERED,
        });
        taughtThisSession.add(s.id);
        cards.push(
          buildCard(
            s.id,
            `${id}:${s.id}`,
            f,
            { root: input.root, file: s.file, otherFiles: s.files - 1, evidence: s.evidence },
            Boolean(question),
          )!,
        );
      }
      // Known-cold ideas are named once per sitting, not on every edit.
      for (const s of ranked.solid) taughtThisSession.add(s.id);

      const xp = discovered ? S.awardXp(discovered * XP_CONCEPT_DISCOVERED) : null;
      if (cards.length) S.touchDay();
      if (!cards.length && !ranked.solid.length) return null;

      return {
        id,
        at: new Date().toISOString(),
        source: input.source,
        cards,
        later: ranked.later.map(chip),
        solid: ranked.solid.map(chip),
        discovered,
        xpAwarded: xp?.awarded ?? 0,
      };
    },
    { write: true },
  );
}

/**
 * One idea's full lesson, opened from the dojo rather than from a change.
 *
 * Read-only: looking an idea up is not the same as meeting it in your own
 * code, so nothing is queued, recorded or paid. A locked idea can be read but
 * has no question until an assistant actually uses it for this learner.
 */
export function ideaCard(conceptId: string, where: Where | null = null): Promise<CardView | null> {
  return run(() => {
    const f = familiarity(conceptId);
    const card = buildCard(
      conceptId,
      `dojo:${conceptId}`,
      f,
      where ?? NOWHERE,
      f.seen && questionsForConcept(conceptId).length > 0,
    );
    if (card && !f.seen) card.status = "locked";
    return card;
  });
}

/** Test seam, and what "Clear the lesson feed" calls. */
export function forgetSession(): void {
  taughtThisSession.clear();
}

/* ------------------------------------------------------------------ *
 * Questions
 * ------------------------------------------------------------------ */

interface OpenQuiz {
  quiz: AskedQuiz;
  about: string;
}

const open = new Map<string, OpenQuiz>();
let quizCounter = 0;

function openQuiz(quiz: AskedQuiz, about: string): QuizView {
  const token = `q${++quizCounter}`;
  open.set(token, { quiz, about });
  // Bounded: a question nobody answered is not worth holding forever.
  if (open.size > 60) open.delete(open.keys().next().value as string);
  return { token, question: quiz.question, choices: quiz.choices, review: quiz.review, about };
}

/** The question for one card, asked at the moment the learner opens it. */
export function quizForConcept(conceptId: string): Promise<QuizView | null> {
  return run(
    () => {
      const concept = conceptById(conceptId);
      if (!concept) return null;
      const question = pickConceptQuestion(conceptId, S.session.skillLevel, S.session.recentQuizIds);
      if (!question) return null;
      S.ensureReviewItem("quiz", question.id, question.question);
      S.noteQuizAsked(question.id);
      const item = S.findReviewItem("quiz", question.id);
      // A question already answered once is a review, and pays like one.
      const review = Boolean(item && item.reps > 0);
      return openQuiz(
        ask(question, conceptBin(conceptId), { review, salt: String(quizCounter + 1) }),
        concept.title,
      );
    },
    { write: true },
  );
}

/** The next due question, most overdue first, or null when the queue is clear. */
export function nextReview(skip: readonly string[] = [], topic: Topic | null = null): Promise<QuizView | null> {
  return run(
    () => {
      const skipped = new Set(skip);
      for (const item of S.due("quiz", 100)) {
        if (skipped.has(item.ref)) continue;
        const question = questionById(item.ref);
        if (!question) continue;
        const bin = question.bins[0] ?? "shell";
        // A topic narrows the pass to that shelf; terminal questions have none.
        if (topic && !(isConceptBin(bin) && topicOf(bin.slice("concept:".length)) === topic)) continue;
        const about = isConceptBin(bin)
          ? conceptById(bin.slice("concept:".length))?.title ?? "Recall"
          : `\`${bin}\``;
        S.noteQuizAsked(question.id);
        return openQuiz(ask(question, bin, { review: true, salt: String(quizCounter + 1) }), about);
      }
      return null;
    },
    { write: true },
  );
}

/** The question id behind a token, so a review pass can avoid repeating it. */
export function questionIdFor(token: string): string | null {
  return open.get(token)?.quiz.id ?? null;
}

/**
 * Grades a choice. The XP comes from the server's own `scoreQuizAnswer`, and a
 * slow correct answer holds its box instead of advancing.
 */
export function answer(token: string, choiceIndex: number): Promise<AnswerView | null> {
  return run(
    () => {
      const entry = open.get(token);
      if (!entry) return null;
      open.delete(token);
      const { quiz } = entry;
      const chosen = quiz.choices[choiceIndex];
      const correct = chosen !== undefined && chosen === quiz.answer;

      const elapsedMs = Date.now() - Date.parse(quiz.askedAt);
      const hesitant = Number.isFinite(elapsedMs) && elapsedMs > 45_000;

      S.recordMastery(quiz.bin, { quiz: true, correct });
      const scheduled = S.gradeReviewItem("quiz", quiz.id, correct, { hesitant });
      const day = S.touchDay();
      const score = scoreQuizAnswer(correct, quiz.review);
      S.record({
        kind: quiz.review ? "review" : "quiz",
        label: quiz.question,
        bin: quiz.bin,
        correct,
        detail: correct
          ? `Correct (${quiz.answer}), streak ${S.player.quizStreak}, x${score.multiplier} (panel)`
          : `Incorrect (answered "${chosen ?? ""}", correct: ${quiz.answer}), streak reset from ${score.lostStreak} (panel)`,
        xpAwarded: score.amount,
      });

      return {
        token,
        correct,
        chosenIndex: choiceIndex,
        answerIndex: quiz.choices.indexOf(quiz.answer),
        explanation: quiz.explanation,
        xpAwarded: score.xp.awarded,
        nextDueAt: scheduled?.dueAt ?? null,
        belt: beltForBox(scheduled?.box ?? 0).name,
        leveledUp: score.xp.leveledUp,
        title: S.player.title,
        newBadges: [...day.newBadges, ...score.newBadges, ...score.xp.newBadges],
        quizStreak: S.player.quizStreak,
      };
    },
    { write: true },
  );
}

/* ------------------------------------------------------------------ *
 * Reading state
 * ------------------------------------------------------------------ */

export function status(): Promise<StatusView> {
  return run(() => {
    const counts = S.reviewCounts();
    const rows = dojoRows(familiarity);
    const dueByTopic: Record<string, number> = Object.fromEntries(TOPICS.map((t) => [t, 0]));
    for (const item of S.due("quiz", 500)) {
      const bin = questionById(item.ref)?.bins[0] ?? "";
      if (isConceptBin(bin)) dueByTopic[topicOf(bin.slice("concept:".length))] += 1;
    }
    return {
      xp: S.player.xp,
      level: S.player.level,
      title: S.player.title,
      intoLevel: S.player.xp % 100,
      dayStreak: S.streak.dayStreak,
      quizStreak: S.player.quizStreak,
      dueQuestions: counts.dueQuiz,
      dueByTopic,
      dueCommands: counts.dueCommand,
      discovered: rows.filter((r) => r.familiarity.seen).length,
      concepts: rows.length,
      depth: S.session.skillLevel,
    };
  });
}

export function dojo(): Promise<DojoRowView[]> {
  return run(() =>
    dojoRows(familiarity)
      .map((r) => ({
        id: r.id,
        title: r.title,
        emoji: r.emoji,
        topic: topicOf(r.id),
        seen: r.familiarity.seen,
        box: r.familiarity.box,
        belt: beltForBox(r.familiarity.box).name,
        lapses: r.familiarity.lapses,
      }))
      .sort((a, b) => Number(b.seen) - Number(a.seen) || b.box - a.box || a.title.localeCompare(b.title)),
  );
}

export const BELT_NAMES: readonly string[] = BELTS.map((b) => b.name);

export function setDepth(depth: Level): Promise<void> {
  return run(
    () => {
      S.session.skillLevel = depth;
    },
    { write: true },
  );
}

/* ------------------------------------------------------------------ *
 * Commands the assistant ran
 * ------------------------------------------------------------------ */

export interface CommandInfo {
  bin: string;
  summary: string;
  what: string;
}

/** The built-in lesson for a command, when the content pack has one. */
export function commandInfo(command: string, depth: Level): CommandInfo | null {
  const { bin, content } = contentFor(command);
  if (!content) return null;
  return { bin, summary: content.summary, what: content.lens[depth].what };
}

/* ------------------------------------------------------------------ *
 * The lines an explanation should point at
 * ------------------------------------------------------------------ */

const EXCERPT_CONTEXT = 6;
const EXCERPT_MAX_CHARS = 5_000;
const EXCERPT_MAX_FILE = 400_000;

/**
 * The parts of a file that use a concept, with a few lines either side and
 * real line numbers. Scrubbed, because this text is about to be sent to a
 * model, and the one line guaranteed to match "hard-coded secret" is the
 * secret.
 */
export async function excerptFor(conceptId: string, root: string, file: string): Promise<string | null> {
  const concept = conceptById(conceptId);
  if (!concept) return null;
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  let text: string;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > EXCERPT_MAX_FILE) return null;
    text = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
  if (text.includes("\u0000")) return null;
  const lines = text.split(/\r?\n/);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (line.length <= 400 && concept.patterns.some((re) => re.test(line))) hits.push(i);
  });
  if (!hits.length) return null;

  const keep = new Set<number>();
  for (const hit of hits.slice(0, 6)) {
    for (let i = Math.max(0, hit - EXCERPT_CONTEXT); i <= Math.min(lines.length - 1, hit + EXCERPT_CONTEXT); i++) {
      keep.add(i);
    }
  }
  const out: string[] = [];
  let last = -2;
  let size = 0;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== last + 1 && out.length) out.push("…");
    const withheld = conceptId === "hardcoded-secret" && concept.patterns.some((re) => re.test(lines[i]));
    const row = `${i + 1}: ${withheld ? "«line withheld: it holds the credential»" : scrub(lines[i])}`;
    size += row.length + 1;
    if (size > EXCERPT_MAX_CHARS) break;
    out.push(row);
    last = i;
  }
  return out.join("\n");
}
