/**
 * What the panel remembers that the shared profile has no place for.
 *
 * The profile (`profile.json`) is written by the MCP server as well, and its
 * shape is the server's to define. Three things the panel needs do not belong
 * in it:
 *
 * - How sure the learner said they were before each answer. Without that
 *   there is no way to tell "knew it" from "guessed right", and no way to
 *   show them whether their confidence can be trusted.
 * - Confident misses still owed an extra review. Being sure and wrong is the
 *   error most worth catching, and the one most likely to come back.
 * - The mistake journal: what was believed, and what is true.
 *
 * So they live in their own file, `~/.miyagi/panel.json`, read and rewritten
 * whole. It is small, and a file that fails to parse costs the journal and
 * nothing else.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { profileDir } from "../../src/profile.js";

export type Confidence = "sure" | "think" | "guess";
export const CONFIDENCES: readonly Confidence[] = ["sure", "think", "guess"];

export function parseConfidence(raw: unknown): Confidence | null {
  return CONFIDENCES.find((c) => c === raw) ?? null;
}

export interface AnswerRecord {
  at: string;
  question: string;
  concept: string | null;
  confidence: Confidence | null;
  correct: boolean;
}

export interface Mistake {
  at: string;
  concept: string | null;
  /** The idea's title at the time, so an entry still reads if the idea is later removed. */
  about: string;
  question: string;
  believed: string;
  truth: string;
  why: string;
  /** Said "sure", and was wrong. */
  confident: boolean;
}

export interface Journal {
  version: 1;
  answers: AnswerRecord[];
  /** Question ids whose next correct answer does not advance: the extra review. */
  owedReview: string[];
  mistakes: Mistake[];
  /** Ideas for which a transfer question (same idea, different setting) was answered correctly. */
  transfer: string[];
  /** Unaided checks: a sitting of questions with every kind of help switched off. */
  checks: Check[];
}

export interface Check {
  at: string;
  asked: number;
  correct: number;
}

const MAX_ANSWERS = 3_000;
const MAX_MISTAKES = 300;

export function journalPath(): string {
  return path.join(profileDir(), "panel.json");
}

export function emptyJournal(): Journal {
  return { version: 1, answers: [], owedReview: [], mistakes: [], transfer: [], checks: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Keeps what is well-formed and drops the rest, entry by entry. */
export function normaliseJournal(raw: unknown): Journal {
  if (!isObj(raw)) return emptyJournal();
  const answers = (Array.isArray(raw.answers) ? raw.answers : [])
    .filter(isObj)
    .filter((a) => typeof a.at === "string" && typeof a.question === "string" && typeof a.correct === "boolean")
    .map((a) => ({
      at: a.at as string,
      question: a.question as string,
      concept: typeof a.concept === "string" ? a.concept : null,
      confidence: parseConfidence(a.confidence),
      correct: a.correct as boolean,
    }));
  const mistakes = (Array.isArray(raw.mistakes) ? raw.mistakes : [])
    .filter(isObj)
    .filter((m) => typeof m.at === "string" && typeof m.believed === "string" && typeof m.truth === "string")
    .map((m) => ({
      at: m.at as string,
      concept: typeof m.concept === "string" ? m.concept : null,
      about: typeof m.about === "string" ? m.about : "",
      question: typeof m.question === "string" ? m.question : "",
      believed: m.believed as string,
      truth: m.truth as string,
      why: typeof m.why === "string" ? m.why : "",
      confident: m.confident === true,
    }));
  return {
    version: 1,
    answers: answers.slice(-MAX_ANSWERS),
    owedReview: (Array.isArray(raw.owedReview) ? raw.owedReview : []).filter((q): q is string => typeof q === "string").slice(-500),
    mistakes: mistakes.slice(-MAX_MISTAKES),
    transfer: (Array.isArray(raw.transfer) ? raw.transfer : []).filter((t): t is string => typeof t === "string").slice(-500),
    checks: (Array.isArray(raw.checks) ? raw.checks : [])
      .filter(isObj)
      .filter((c) => typeof c.at === "string" && Number.isInteger(c.asked) && Number.isInteger(c.correct))
      .map((c) => ({ at: c.at as string, asked: c.asked as number, correct: Math.min(c.correct as number, c.asked as number) }))
      .filter((c) => c.asked > 0)
      .slice(-60),
  };
}

export async function loadJournal(): Promise<Journal> {
  try {
    return normaliseJournal(JSON.parse(await fs.readFile(journalPath(), "utf8")));
  } catch {
    return emptyJournal();
  }
}

export async function saveJournal(journal: Journal): Promise<void> {
  try {
    const file = journalPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(normaliseJournal(journal)), "utf8");
    await fs.rename(tmp, file);
  } catch {
    // Losing a journal entry must never cost an answer its grade.
  }
}

export interface Graded {
  question: string;
  concept: string | null;
  about: string;
  prompt: string;
  chosen: string;
  truth: string;
  why: string;
  confidence: Confidence | null;
  correct: boolean;
}

export interface Outcome {
  journal: Journal;
  /** Said "sure" and was wrong, just now. */
  confidentMiss: boolean;
  /** This answer was correct but repays an earlier confident miss, so it must not advance. */
  repaysMiss: boolean;
}

/**
 * Folds one graded answer into the journal.
 *
 * A confident miss is remembered as a debt. The next correct answer to the
 * same question pays it off instead of moving the question on, which is the
 * "extra early review": the learner has to be right twice before the schedule
 * believes them again.
 */
export function recordAnswer(journal: Journal, g: Graded, now: Date = new Date()): Outcome {
  const at = now.toISOString();
  const owed = new Set(journal.owedReview);
  const repaysMiss = g.correct && owed.has(g.question);
  const confidentMiss = !g.correct && g.confidence === "sure";
  if (repaysMiss) owed.delete(g.question);
  if (confidentMiss) owed.add(g.question);

  const mistakes = g.correct
    ? journal.mistakes
    : [
        ...journal.mistakes,
        { at, concept: g.concept, about: g.about, question: g.prompt, believed: g.chosen, truth: g.truth, why: g.why, confident: confidentMiss },
      ];
  return {
    journal: {
      ...journal,
      version: 1,
      answers: [...journal.answers, { at, question: g.question, concept: g.concept, confidence: g.confidence, correct: g.correct }].slice(-MAX_ANSWERS),
      owedReview: [...owed],
      mistakes: mistakes.slice(-MAX_MISTAKES),
    },
    confidentMiss,
    repaysMiss,
  };
}

export interface CalibrationRow {
  confidence: Confidence;
  answers: number;
  correct: number;
  /** 0-1, or null when there are too few answers to say. */
  accuracy: number | null;
}

/** Fewer than this at one confidence level and a percentage is noise. */
export const MIN_FOR_CALIBRATION = 5;

/** How often each level of confidence turned out to be right. */
export function calibration(journal: Journal): CalibrationRow[] {
  return CONFIDENCES.map((confidence) => {
    const rows = journal.answers.filter((a) => a.confidence === confidence);
    const correct = rows.filter((a) => a.correct).length;
    return {
      confidence,
      answers: rows.length,
      correct,
      accuracy: rows.length >= MIN_FOR_CALIBRATION ? correct / rows.length : null,
    };
  });
}

/**
 * One plain sentence about whether their confidence can be trusted, or null
 * when there is not enough to say. It describes; it does not score.
 */
export function calibrationVerdict(rows: readonly CalibrationRow[]): string | null {
  const sure = rows.find((r) => r.confidence === "sure");
  const guess = rows.find((r) => r.confidence === "guess");
  if (!sure || sure.accuracy === null) return null;
  const pct = Math.round(sure.accuracy * 100);
  if (pct >= 85) return `When you say you are sure, you are right ${pct}% of the time. Your "sure" can be trusted.`;
  if (pct >= 65) return `When you say you are sure, you are right ${pct}% of the time. Worth a second look before you rely on it.`;
  const tail = guess && guess.accuracy !== null && guess.accuracy >= sure.accuracy ? " Your guesses are doing about as well." : "";
  return `When you say you are sure, you are right ${pct}% of the time. Feeling certain is not telling you much yet.${tail}`;
}

/** Mistakes newest first, confident ones leading: those are the ones that return. */
export function mistakesForReview(journal: Journal, limit = 30): Mistake[] {
  return [...journal.mistakes]
    .sort((a, b) => Number(b.confident) - Number(a.confident) || b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** Days after which another unaided check is worth offering. */
export const CHECK_EVERY_DAYS = 30;

export function lastCheck(journal: Journal): Check | null {
  return journal.checks.length ? journal.checks[journal.checks.length - 1] : null;
}

export function checkIsDue(journal: Journal, now: Date = new Date()): boolean {
  const last = lastCheck(journal);
  return !last || now.getTime() - Date.parse(last.at) > CHECK_EVERY_DAYS * 86_400_000;
}
