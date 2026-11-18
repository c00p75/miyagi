/**
 * What an answer is worth.
 *
 * These numbers used to live inside the `verify_quiz_answer` handler. The
 * editor panel grades the same questions against the same profile, and two
 * copies of a scoring rule is one of them drifting: a learner who answers in
 * the panel and a learner who answers in chat would level at different rates
 * for the same recall. So the rule lives here and both call it.
 *
 * It mutates the player (streak, XP, badges) and schedules a save. It does
 * not touch the review schedule, mastery or history: those depend on the
 * question, and the caller already has it.
 */

import { awardXp, player, schedulePersist, type XpResult } from "./state.js";

/** A technique seen for the first time. Small, once, and impossible to farm: it needs real code. */
export const XP_CONCEPT_DISCOVERED = 5;

/** First-sight recall. */
export const XP_QUIZ = 25;
/** Cold recall out of the review queue is the harder skill, so it pays more. */
export const XP_REVIEW = 30;
/** Consolation for an attempt: a miss is how a question gets scheduled, not a penalty. */
export const XP_MISS = 5;

const STREAK_BADGES: ReadonlyArray<readonly [number, string]> = [
  [3, "Sharpshooter 🔥"],
  [5, "Deadeye 🎯"],
  [10, "Unbreakable 💎"],
];

export interface QuizScore {
  correct: boolean;
  /** XP before the multiplier. */
  base: number;
  multiplier: number;
  /** XP actually awarded. */
  amount: number;
  /** The streak that a miss reset. Zero on a correct answer. */
  lostStreak: number;
  xp: XpResult;
  /** Streak badges earned by this answer. Level and XP badges are in `xp.newBadges`. */
  newBadges: string[];
}

export function scoreQuizAnswer(correct: boolean, review: boolean): QuizScore {
  if (!correct) {
    const lostStreak = player.quizStreak;
    player.quizStreak = 0;
    const xp = awardXp(XP_MISS);
    return { correct, base: XP_MISS, multiplier: 1, amount: XP_MISS, lostStreak, xp, newBadges: [] };
  }

  player.quizStreak += 1;
  player.bestStreak = Math.max(player.bestStreak, player.quizStreak);
  // The multiplier caps at 2x: past that, XP stops meaning practice and
  // starts meaning "answered the easy ones in a row".
  const multiplier = 1 + Math.min(1, Math.floor(player.quizStreak / 3) * 0.25);
  const base = review ? XP_REVIEW : XP_QUIZ;
  const amount = Math.round(base * multiplier);
  const xp = awardXp(amount);

  const newBadges: string[] = [];
  for (const [streak, badge] of STREAK_BADGES) {
    if (player.quizStreak >= streak && !player.badges.includes(badge)) {
      player.badges.push(badge);
      newBadges.push(badge);
    }
  }
  if (newBadges.length) schedulePersist();
  return { correct, base, multiplier, amount, lostStreak: 0, xp, newBadges };
}
