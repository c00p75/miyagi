/**
 * Outcome verification.
 *
 * The original design awarded XP when `run_teaching_command` returned, which
 * meant the *server* had run the command and the learner may never have
 * touched a keyboard: a client could farm a Terminal Wizard title in thirty
 * seconds. A checkpoint is a separate, read-only probe whose exit code says
 * whether the intended outcome actually exists. XP moves to that.
 *
 * Two rules keep the probe trustworthy. It is screened by the danger rules
 * before it runs, because a "probe" that deletes something is not a probe and a
 * user-authored track file is exactly where one would hide. And it is never
 * allowed to substitute for the learner's own work: it only ever reads.
 */

import { runCommand, forDisplay, STDOUT_DISPLAY_LIMIT } from "./run.js";
import { screenDanger } from "./safety.js";
import { resolveCheckpoint, type Checkpoint } from "./roadmaps.js";

/** Checkpoints are probes, so they get a short leash. */
const CHECKPOINT_TIMEOUT_MS = 15_000;

export interface CheckpointResult {
  passed: boolean;
  /** Why it failed, in terms the learner can act on. */
  reason: string;
  /** What the probe printed, trimmed for display. */
  output: string;
  exitCode: number | null;
  /** True when the probe itself could not be run, as opposed to failing. */
  unusable: boolean;
  durationMs: number;
}

export async function runCheckpoint(
  check: Checkpoint,
  options: { cwd?: string } = {},
): Promise<CheckpointResult> {
  const resolved = resolveCheckpoint(check);
  const flagged = screenDanger(resolved.command);
  if (flagged.length) {
    return {
      passed: false,
      reason: `This checkpoint was refused: a probe must only read, and this one is flagged for ${flagged.join(", ")}.`,
      output: "",
      exitCode: null,
      unusable: true,
      durationMs: 0,
    };
  }

  const outcome = await runCommand(resolved.command, {
    cwd: options.cwd,
    timeoutMs: CHECKPOINT_TIMEOUT_MS,
  });
  const shown = forDisplay(outcome.stdout, Math.min(600, STDOUT_DISPLAY_LIMIT));

  if (!outcome.ok) {
    return {
      passed: false,
      reason: outcome.timedOut
        ? "The checkpoint probe timed out, so nothing could be confirmed either way."
        : `The check did not pass: ${check.describe}.`,
      output: shown.text || forDisplay(outcome.stderr, 400).text,
      exitCode: outcome.code,
      unusable: outcome.timedOut,
      durationMs: outcome.durationMs,
    };
  }

  if (resolved.contains && !outcome.stdout.includes(resolved.contains)) {
    return {
      passed: false,
      reason: `The command succeeded, but its output does not contain \`${resolved.contains}\`, so the outcome is not what the step asked for.`,
      output: shown.text,
      exitCode: outcome.code,
      unusable: false,
      durationMs: outcome.durationMs,
    };
  }

  return {
    passed: true,
    reason: check.describe,
    output: shown.text,
    exitCode: outcome.code,
    unusable: false,
    durationMs: outcome.durationMs,
  };
}

/**
 * Whether a command the learner ran is the step's command.
 *
 * Deliberately forgiving about whitespace and quoting style, and deliberately
 * not fuzzy beyond that: matching loosely would let a near-miss claim a
 * checkpoint's XP, which is the exact failure this whole mechanism exists to
 * prevent. When in doubt the answer is no, and `verify_step` is always available
 * to check the outcome explicitly.
 */
export function isSameCommand(a: string, b: string): boolean {
  const normalise = (s: string) =>
    s
      .trim()
      .replace(/['"]/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([;|&<>])\s*/g, "$1")
      .toLowerCase();
  return normalise(a) === normalise(b);
}
