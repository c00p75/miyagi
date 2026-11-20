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
  conceptOrigin,
  isConceptBin,
  questionsForConcept,
  scrub,
  type ConceptHit,
  type ConceptLevel,
} from "../../src/concepts.js";
import { ask, questionById, shuffleChoices, type AskedQuiz } from "../../src/quiz.js";
import { flushHistory } from "../../src/history.js";
import { contentFor } from "../../src/content.js";
import { conceptFamiliarity } from "../../src/familiarity.js";
import { XP_CONCEPT_DISCOVERED, scoreQuizAnswer } from "../../src/scoring.js";
import {
  calibration,
  calibrationVerdict,
  checkIsDue,
  emptyJournal,
  lastCheck,
  loadJournal,
  mistakesForReview,
  recordAnswer,
  saveJournal,
  type CalibrationRow,
  type Check,
  type Confidence,
  type Journal,
  type Mistake,
} from "./journal.js";
import { TOPICS, orderByPrerequisite, prerequisiteOf, topicOf, type Topic } from "./topics.js";

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
  /** Security and data-loss ideas: the ones that hurt when misunderstood. */
  risk: boolean;
  /** Where the lesson came from: the built-in pack, a pack file, or a model. */
  origin: "built-in" | "pack" | "ai" | "own";
  /** The idea this one leans on, when the learner has not met it yet. */
  buildsOn: Chip | null;
  /** `locked`: in the pack, not yet seen in this learner's code. */
  status: "new" | "learning" | "locked";
  /**
   * How much the card hands over before asking. Help that never fades becomes
   * a crutch, so it thins as the belt rises: `full` shows the lesson,
   * `question-first` asks before it shows, `minimal` keeps the lesson behind a
   * link and asks the hardest question the idea has.
   */
  support: "full" | "question-first" | "minimal";
  /** At brown belt, with the transfer question still to pass. */
  needsTransfer: boolean;
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
  root: string;
  /** Every file the change touched, for "walk me through it" and the risk check. */
  files: string[];
  /** The assistant that made the change, when the hook saw it. */
  by?: string;
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
  /** Mixed in from outside the topic the learner chose, on purpose. */
  otherTopic?: boolean;
  /** The idea behind the question, so the panel can open its page. Absent for terminal questions. */
  conceptId?: string;
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
  /** Correct at brown belt, but black needs the idea shown in a different setting first. */
  needsTransfer: boolean;
  /** This was that transfer question, and it was answered correctly. */
  transferPassed: boolean;
  /** They said they were sure, and it was wrong. This one gets an extra review. */
  confidentMiss: boolean;
  /** Correct, but it repays an earlier confident miss, so the belt holds. */
  repaysMiss: boolean;
}

export interface StatusView {
  xp: number;
  level: number;
  /** The terminal-track title from the shared profile. The panel shows `rank`. */
  title: string;
  rank: string;
  /** A depth the answers so far suggest, when it differs from the current one. */
  suggestedDepth: Level | null;
  /** The last unaided check, or null if none has been taken. */
  independence: Check | null;
  /** Enough belts are held, and enough time has passed, for an unaided check to be worth offering. */
  checkDue: boolean;
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
/** The panel's own journal, re-read with the profile before every operation. */
let journal: Journal = emptyJournal();

/** Ideas this many places from black belt need one more thing than a correct answer. */
const BROWN_BOX = 4;
/** Fewer ideas than this with a belt and an unaided check says nothing. */
const MIN_FOR_CHECK = 5;

/**
 * Every operation runs alone, after re-reading the profile. The reload is what
 * keeps two writers honest: without it the panel would save a snapshot taken
 * before the server's last answer and the merge would have to guess.
 */
function run<T>(work: () => T | Promise<T>, options: { write?: boolean } = {}): Promise<T> {
  const next = chain.then(async () => {
    await S.hydrate();
    journal = await loadJournal();
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

const familiarity = conceptFamiliarity;

/** Green belt and above have answered after a week's gap; they need a question, not a lecture. */
function supportFor(f: Familiarity): CardView["support"] {
  if (!f.seen || f.box < 3) return "full";
  return f.box >= 4 ? "minimal" : "question-first";
}

/** At this weight a misunderstanding costs data, money or a breach, not just a bug. */
const RISK_WEIGHT = 85;

function originOf(conceptId: string): CardView["origin"] {
  const origin = conceptOrigin(conceptId);
  return origin === null ? "built-in" : origin === "ai" ? "ai" : origin === "own" ? "own" : "pack";
}

function unmetPrerequisite(conceptId: string): Chip | null {
  const needs = prerequisiteOf(conceptId);
  const c = needs ? conceptById(needs) : undefined;
  if (!c || familiarity(c.id).seen) return null;
  return { id: c.id, title: c.title, emoji: c.emoji };
}

/**
 * A rank for the whole learner, in the dojo's own vocabulary. The shared
 * profile's titles ("Terminal Novice", "Shell Apprentice") were named for the
 * command-line tracks and read oddly above a card about React.
 */
const RANKS: ReadonlyArray<readonly [number, string]> = [
  [1, "Novice"],
  [3, "Apprentice"],
  [6, "Practitioner"],
  [10, "Adept"],
  [15, "Sensei"],
];

export function rankForLevel(level: number): string {
  let rank = RANKS[0][1];
  for (const [min, name] of RANKS) if (level >= min) rank = name;
  return rank;
}

const DEPTHS: readonly Level[] = ["Junior", "Mid", "Senior"];

/**
 * Suggests moving the depth when the answers say it is wrong: consistently
 * right means the explanations are too shallow, consistently wrong means too
 * deep. A suggestion only, and only on real evidence; the learner chooses.
 */
export function depthSuggestion(current: Level, answers: { attempts: number; correct: number }): Level | null {
  if (answers.attempts < 10) return null;
  const rate = answers.correct / answers.attempts;
  const at = DEPTHS.indexOf(current);
  if (rate >= 0.85 && at < DEPTHS.length - 1) return DEPTHS[at + 1];
  if (rate <= 0.4 && at > 0) return DEPTHS[at - 1];
  return null;
}

function conceptAnswers(): { attempts: number; correct: number } {
  let attempts = 0;
  let correct = 0;
  for (const [bin, m] of S.mastery) {
    if (!isConceptBin(bin)) continue;
    attempts += m.quizAttempts;
    correct += m.quizCorrect;
  }
  return { attempts, correct };
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
    risk: c.weight >= RISK_WEIGHT,
    origin: originOf(conceptId),
    buildsOn: unmetPrerequisite(conceptId),
    status: f.seen ? "learning" : "new",
    support: supportFor(f),
    needsTransfer: f.seen && f.box === BROWN_BOX && !journal.transfer.includes(conceptId),
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
  /** The topic the learner chose to concentrate on. Its ideas are taught first. */
  focus?: Topic | null;
  /** Every file in the change, including ones with no recognised idea. */
  files?: readonly string[];
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
      // Ranked without a limit first, so the learner's focus and "what builds
      // on what" can reorder before the cut is made.
      const all = rankSightings(sightings, fam, sightings.length);
      const focused = input.focus
        ? [...all.teach].sort(
            (a, b) => Number(topicOf(b.id) === input.focus) - Number(topicOf(a.id) === input.focus),
          )
        : all.teach;
      const ordered = orderByPrerequisite(focused);
      const limit = Math.max(1, input.limit);
      const ranked = { teach: ordered.slice(0, limit), later: ordered.slice(limit), solid: all.solid };
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
        root: input.root,
        files: [...new Set(input.files ?? input.changes.map((c) => c.file))],
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
  /** Answering this correctly is what unlocks black belt for the idea. */
  transfer?: boolean;
}

const open = new Map<string, OpenQuiz>();
let quizCounter = 0;

function openQuiz(quiz: AskedQuiz, about: string, flags: { transfer?: boolean } = {}): QuizView {
  const token = `q${++quizCounter}`;
  open.set(token, { quiz, about, ...flags });
  // Bounded: a question nobody answered is not worth holding forever.
  if (open.size > 60) open.delete(open.keys().next().value as string);
  const view: QuizView = { token, question: quiz.question, choices: quiz.choices, review: quiz.review, about };
  if (isConceptBin(quiz.bin)) view.conceptId = quiz.bin.slice("concept:".length);
  return view;
}

/** The question for one card, asked at the moment the learner opens it. */
export function quizForConcept(conceptId: string): Promise<QuizView | null> {
  return run(
    () => {
      const concept = conceptById(conceptId);
      if (!concept) return null;
      // At brown and black belt the idea's hardest question is asked, whatever
      // depth the explanations are set to.
      const level = familiarity(conceptId).box >= 4 ? "Senior" : S.session.skillLevel;
      const question = pickConceptQuestion(conceptId, level, S.session.recentQuizIds);
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

/**
 * A question written about the learner's own lines.
 *
 * It is graded and paid like any first-sight question, and counts toward the
 * idea's mastery, but it never enters the review queue: next month the code
 * will have changed and the question would be about lines that no longer
 * exist. The idea's own question is what comes back.
 */
export function quizFromOwnCode(
  conceptId: string,
  q: { question: string; answer: string; distractors: readonly string[]; explanation: string },
  flags: { transfer?: boolean } = {},
): QuizView | null {
  const concept = conceptById(conceptId);
  if (!concept) return null;
  const id = `own-${conceptId}-${quizCounter + 1}`;
  return openQuiz(
    {
      id,
      question: q.question,
      choices: shuffleChoices([q.answer, ...q.distractors], id),
      answer: q.answer,
      explanation: q.explanation,
      bin: conceptBin(conceptId),
      review: false,
      askedAt: new Date().toISOString(),
    },
    concept.title,
    flags,
  );
}

/** With a topic chosen, one question in this many still comes from elsewhere. */
const MIX_EVERY = 4;
let reviewsAsked = 0;

/**
 * The next due question, most overdue first, or null when the queue is clear.
 *
 * A chosen topic narrows the pass, but not completely: about one question in
 * four is taken from another topic and labelled as such. Answering the same
 * kind of question in a row feels like progress and is mostly recognising the
 * pattern of the last one; a question that arrives from somewhere else has to
 * be recalled cold.
 */
export function nextReview(
  skip: readonly string[] = [],
  topic: Topic | null = null,
  mix = true,
): Promise<QuizView | null> {
  return run(
    () => {
      const skipped = new Set(skip);
      const due: Array<{ question: NonNullable<ReturnType<typeof questionById>>; bin: string; inTopic: boolean }> = [];
      for (const item of S.due("quiz", 200)) {
        if (skipped.has(item.ref)) continue;
        const question = questionById(item.ref);
        if (!question) continue;
        const bin = question.bins[0] ?? "shell";
        const conceptId = isConceptBin(bin) ? bin.slice("concept:".length) : null;
        due.push({ question, bin, inTopic: Boolean(topic && conceptId && topicOf(conceptId) === topic) });
      }
      if (!due.length) return null;

      let pick = due[0];
      let otherTopic = false;
      if (topic) {
        const inside = due.find((d) => d.inTopic);
        // Terminal questions have no topic and are never mixed in.
        const outside = due.find((d) => !d.inTopic && isConceptBin(d.bin));
        const mixNow = mix && reviewsAsked % MIX_EVERY === MIX_EVERY - 1;
        if (inside && !(mixNow && outside)) pick = inside;
        else if (inside && outside) {
          pick = outside;
          otherTopic = true;
        } else return null; // nothing left in this topic: the pass is done
      }
      reviewsAsked++;
      const about = isConceptBin(pick.bin)
        ? conceptById(pick.bin.slice("concept:".length))?.title ?? "Recall"
        : `\`${pick.bin}\``;
      S.noteQuizAsked(pick.question.id);
      const view = openQuiz(ask(pick.question, pick.bin, { review: true, salt: String(quizCounter + 1) }), about);
      return otherTopic ? { ...view, otherTopic: true } : view;
    },
    { write: true },
  );
}

/** Test seam: start the one-in-four count again. */
export function resetReviewMix(): void {
  reviewsAsked = 0;
}

/** Test seam: count a review as asked without consuming a question. */
export function bumpReviewMixForTest(): void {
  reviewsAsked++;
}

/** The question id behind a token, so a review pass can avoid repeating it. */
export function questionIdFor(token: string): string | null {
  return open.get(token)?.quiz.id ?? null;
}

/**
 * Grades a choice. The XP comes from the server's own `scoreQuizAnswer`, and a
 * slow correct answer holds its box instead of advancing.
 */
export function answer(
  token: string,
  choiceIndex: number,
  confidence: Confidence | null = null,
  options: { blackBeltNeedsTransfer?: boolean } = {},
): Promise<AnswerView | null> {
  return run(
    async () => {
      const entry = open.get(token);
      if (!entry) return null;
      open.delete(token);
      const { quiz } = entry;
      const chosen = quiz.choices[choiceIndex];
      const correct = chosen !== undefined && chosen === quiz.answer;

      const conceptId = isConceptBin(quiz.bin) ? quiz.bin.slice("concept:".length) : null;
      const outcome = recordAnswer(journal, {
        question: quiz.id,
        concept: conceptId,
        about: entry.about,
        prompt: quiz.question,
        chosen: chosen ?? "",
        truth: quiz.answer,
        why: quiz.explanation,
        confidence,
        correct,
      });
      journal = outcome.journal;
      const transferPassed = Boolean(entry.transfer && correct && conceptId);
      if (transferPassed && conceptId && !journal.transfer.includes(conceptId)) {
        journal = { ...journal, transfer: [...journal.transfer, conceptId] };
      }
      await saveJournal(journal);

      // Black belt is not one more correct answer to a question seen five
      // times. It also takes the idea recognised somewhere it was not learned.
      const item = S.findReviewItem("quiz", quiz.id);
      const needsTransfer = Boolean(
        options.blackBeltNeedsTransfer &&
          correct &&
          conceptId &&
          item?.box === BROWN_BOX &&
          !journal.transfer.includes(conceptId),
      );

      const elapsedMs = Date.now() - Date.parse(quiz.askedAt);
      // Slow recall holds its box. So does a correct answer that repays a
      // confident miss: sure-and-wrong has to be right twice to move on.
      const hesitant = (Number.isFinite(elapsedMs) && elapsedMs > 45_000) || outcome.repaysMiss || needsTransfer;

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
        needsTransfer,
        transferPassed,
        confidentMiss: outcome.confidentMiss,
        repaysMiss: outcome.repaysMiss,
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
      rank: rankForLevel(S.player.level),
      suggestedDepth: depthSuggestion(S.session.skillLevel, conceptAnswers()),
      independence: lastCheck(journal),
      checkDue: checkable().length >= MIN_FOR_CHECK && checkIsDue(journal),
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

async function readLines(root: string, file: string): Promise<string[] | null> {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > EXCERPT_MAX_FILE) return null;
    const text = await fs.readFile(abs, "utf8");
    return text.includes("\u0000") ? null : text.split(/\r?\n/);
  } catch {
    return null;
  }
}

/**
 * The lines of a file that matter, with a few either side and their real line
 * numbers. Every line is scrubbed, because this text is about to be sent to a
 * model; `withhold` names the lines that must not be sent even scrubbed.
 */
function numbered(
  lines: readonly string[],
  hits: readonly number[],
  options: { context: number; maxChars: number; withhold?: (line: string) => boolean },
): string | null {
  if (!hits.length) return null;
  const keep = new Set<number>();
  for (const hit of hits) {
    for (let i = Math.max(0, hit - options.context); i <= Math.min(lines.length - 1, hit + options.context); i++) {
      keep.add(i);
    }
  }
  const out: string[] = [];
  let last = -2;
  let size = 0;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== last + 1 && out.length) out.push("…");
    const row = `${i + 1}: ${options.withhold?.(lines[i]) ? "«line withheld: it holds the credential»" : scrub(lines[i])}`;
    size += row.length + 1;
    if (size > options.maxChars) break;
    out.push(row);
    last = i;
  }
  return out.join("\n");
}

const SECRET = () => conceptById("hardcoded-secret")?.patterns ?? [];
const holdsSecret = (line: string) => line.length <= 400 && SECRET().some((re) => re.test(line));

/**
 * The parts of a file that use a concept. The one line guaranteed to match
 * "hard-coded secret" is the secret, so it is withheld rather than scrubbed.
 */
export async function excerptFor(conceptId: string, root: string, file: string): Promise<string | null> {
  const concept = conceptById(conceptId);
  const lines = concept ? await readLines(root, file) : null;
  if (!concept || !lines) return null;
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (line.length <= 400 && concept.patterns.some((re) => re.test(line))) hits.push(i);
  });
  return numbered(lines, hits.slice(0, 6), {
    context: EXCERPT_CONTEXT,
    maxChars: EXCERPT_MAX_CHARS,
    withhold: holdsSecret,
  });
}

/**
 * The parts of a file that a change added, located in the file as it is now
 * so the line numbers are real. A diff knows what was added but not where it
 * ended up after later edits.
 */
export async function excerptOfChange(root: string, file: string, added: string, maxChars = 3_500): Promise<string | null> {
  const lines = await readLines(root, file);
  if (!lines) return null;
  const wanted = new Set(added.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2));
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (wanted.has(line.trim())) hits.push(i);
  });
  return numbered(lines, hits.slice(0, 80), { context: 2, maxChars, withhold: holdsSecret });
}

/** A range of a file, such as one whole function, with its real line numbers. Zero-based, inclusive. */
export async function excerptOfRange(root: string, file: string, start: number, end: number, maxChars = EXCERPT_MAX_CHARS): Promise<string | null> {
  const lines = await readLines(root, file);
  if (!lines || start < 0 || end < start) return null;
  const hits: number[] = [];
  for (let i = start; i <= Math.min(end, lines.length - 1); i++) hits.push(i);
  return numbered(lines, hits, { context: 0, maxChars, withhold: holdsSecret });
}

/** The start of a file, for a model that needs to know what a project is. */
export async function headOf(root: string, file: string, maxLines: number): Promise<string | null> {
  const lines = await readLines(root, file);
  if (!lines) return null;
  return lines
    .slice(0, maxLines)
    .map((l) => (holdsSecret(l) ? "«line withheld»" : scrub(l)))
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * What the answers say about the learner
 * ------------------------------------------------------------------ */

export interface InsightView {
  calibration: CalibrationRow[];
  /** One sentence, or null when there are too few "sure" answers to say. */
  verdict: string | null;
  mistakes: Mistake[];
}

export function insight(): Promise<InsightView> {
  return run(() => {
    const rows = calibration(journal);
    return { calibration: rows, verdict: calibrationVerdict(rows), mistakes: mistakesForReview(journal) };
  });
}

/* ------------------------------------------------------------------ *
 * The unaided check
 *
 * Practice with help overstates what someone can do without it. Once in a
 * while the learner is asked a short run of questions on ideas they hold a
 * belt for, with every kind of help switched off, and told the plain result.
 * ------------------------------------------------------------------ */

/** Ideas held firmly enough to be worth checking: answered correctly at least once after a gap. */
function checkable(): string[] {
  return dojoRows(familiarity)
    .filter((r) => r.familiarity.seen && r.familiarity.box >= 1 && questionsForConcept(r.id).length > 0)
    .map((r) => r.id);
}

/** Up to `limit` ideas for a check, weakest belts first so the result is not flattering. */
export function checkPlan(limit = 10): Promise<string[]> {
  return run(() =>
    checkable()
      .sort((a, b) => familiarity(a).box - familiarity(b).box || a.localeCompare(b))
      .slice(0, limit),
  );
}

/** One question of a check: the idea's hardest, whatever depth is set. */
export function quizForCheck(conceptId: string): Promise<QuizView | null> {
  return run(
    () => {
      const concept = conceptById(conceptId);
      const question = concept ? pickConceptQuestion(conceptId, "Senior", S.session.recentQuizIds) : null;
      if (!concept || !question) return null;
      S.ensureReviewItem("quiz", question.id, question.question);
      S.noteQuizAsked(question.id);
      return openQuiz(ask(question, conceptBin(conceptId), { review: true, salt: String(quizCounter + 1) }), concept.title);
    },
    { write: true },
  );
}

export function recordCheck(asked: number, correct: number): Promise<Check | null> {
  return run(async () => {
    if (asked <= 0) return null;
    const check = { at: new Date().toISOString(), asked, correct: Math.min(correct, asked) };
    journal = { ...journal, checks: [...journal.checks, check] };
    await saveJournal(journal);
    return check;
  });
}

/**
 * Puts a question the learner wrote themselves on the review schedule. It was
 * registered as an idea of its own first (see ideas.ts); this is the step that
 * makes it come back.
 */
export function adopt(conceptId: string): Promise<boolean> {
  return run(
    () => {
      const concept = conceptById(conceptId);
      const question = questionsForConcept(conceptId)[0];
      if (!concept || !question) return false;
      S.ensureReviewItem("quiz", question.id, question.question);
      S.record({ kind: "concept", label: concept.title, bin: conceptBin(conceptId), detail: "question written by the learner (panel)", xpAwarded: 0 });
      return true;
    },
    { write: true },
  );
}

/**
 * XP for something done without the assistant. Recorded as a checkpoint,
 * because that is what it is: a verified outcome, not an attempt.
 */
export function creditUnaided(what: string, xp: number): Promise<number> {
  return run(
    () => {
      S.touchDay();
      const awarded = S.awardXp(xp).awarded;
      S.record({ kind: "checkpoint", label: "Your turn", detail: `${what.slice(0, 200)} (panel, written unaided)`, xpAwarded: awarded, correct: true });
      return awarded;
    },
    { write: true },
  );
}
