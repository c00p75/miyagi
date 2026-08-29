/**
 * Session interactivity.
 *
 * The server had one interaction contract: every executed command returned a
 * full teaching card, asked a question, awarded XP and spoke. That assumes the
 * user is sitting in a lesson. The actual context of an MCP server is that it
 * is installed and always on while someone works, so the assumption is wrong
 * most of the time it is loaded, and a tutor that interrupts real work gets
 * uninstalled the first afternoon it does so.
 *
 * Three things this deliberately does NOT do:
 *
 * 1. It is not a slider. "Interactivity 3" tells a user nothing they can
 *    predict, so the modes are named after the situation instead. The axis is
 *    how much attention is spare right now, not how much someone wants to
 *    learn, which is why switching down reads as "I am heads-down" rather than
 *    as giving up.
 *
 * 2. It does not simply switch the quiz off. Active recall is the only
 *    mechanism here that teaches; removing it leaves exposure, which feels like
 *    learning and largely is not. So the quieter modes defer recall rather than
 *    delete it: what you were exposed to is queued and paid out when you ask
 *    for a review.
 *
 * 3. It does not silence the safety screen. Mode governs pedagogy. A dangerous
 *    command forced into dry-run must surface in every mode, including the one
 *    that shows nothing else, because a quietness preference must never be able
 *    to hide the fact that something was refused.
 */

export type SessionMode = 'drill' | 'ride-along' | 'focus';

/** How much of the teaching card reaches the transcript. */
export type CardDepth = 'full' | 'brief' | 'none';

/**
 * Which sections of the card surface *now*, in the transcript.
 *
 * `tradeoffs` is a count rather than a flag because it is the highest
 * value-per-line thing in the card and the part a man page will not give you.
 * If a quiet mode keeps exactly one section, it should be this one.
 *
 * `how` is on in ride-along as well as drill. Watching a command run without
 * knowing how it works is the situation that mode exists for, so the mechanics
 * are the one long-form section that earns its lines mid-task. It costs
 * ride-along a couple of lines; the sections that stay off are the ones you can
 * read later without having lost the thread.
 */
export interface SurfaceSections {
  roadmap: boolean;
  what: boolean;
  how: boolean;
  /** 0, 1, or every trade-off the content has for this skill level. */
  tradeoffs: 0 | 1 | 'all';
  diagram: boolean;
  pitfalls: boolean;
  docs: boolean;
  /**
   * How often the player footnote appears: the XP, level and streak line.
   *
   * This is separate from how much XP is earned. `xpPerCommand` decides what
   * accrues; this decides whether the learner is told each time. In drill the
   * telling is the reward loop and belongs on every turn. In ride-along it is
   * the opposite: forty commands across a working afternoon would be forty
   * lines reporting that a number went up by three and nothing happened, which
   * is precisely the chirping the mode exists to remove. So it speaks only when
   * something actually changed, and forty lines become one worth reading.
   */
  xpFootnote: 'always' | 'on-change' | 'never';
}

/**
 * Everything is archived in full in every mode, regardless of what surfaced.
 *
 * The quiet modes defer material rather than dropping it, exactly as they defer
 * recall rather than deleting it. The consequence is the one worth having: in
 * ride-along you saw two lines at the time and the notes export still gives you
 * the whole explanation for every command you ran, so the quieter mode produces
 * the richer artifact rather than a thinner one.
 */
export const ARCHIVE_IS_ALWAYS_FULL = true;

export interface ModePolicy {
  mode: SessionMode;
  /** Shown when listing or confirming a switch. */
  label: string;
  /** The situation this mode is for, in one line. */
  when: string;
  card: CardDepth;
  /** Which sections reach the transcript. The archive keeps everything. */
  surface: SurfaceSections;
  /** Ask the recall question inline, in the same turn. */
  quiz: boolean;
  /** Narrate through the OS speech engine. */
  speak: boolean;
  /**
   * XP for merely running a command. Exposure pays little: if presence earns
   * the same as recall then XP stops meaning "I retrieved this" and starts
   * meaning "I had the tool open", which devalues the streak that is the only
   * reason anyone comes back.
   */
  xpPerCommand: number;
  /** Queue the item for a later review session. True in every mode. */
  queueForReview: boolean;
}

/**
 * Ride-along is the default, not drill. The failure mode of too quiet is mild
 * disappointment; the failure mode of too loud is an uninstall, and that
 * happens before anyone finds this setting. Intensity is opted into.
 */
export const DEFAULT_MODE: SessionMode = 'ride-along';

const POLICIES: Record<SessionMode, ModePolicy> = {
  drill: {
    mode: 'drill',
    label: 'Drill',
    when: 'You sat down to learn. Full card, a question every time, spoken aloud.',
    card: 'full',
    surface: {
      roadmap: true,
      what: true,
      how: true,
      tradeoffs: 'all',
      diagram: true,
      pitfalls: true,
      docs: true,
      xpFootnote: 'always',
    },
    quiz: true,
    speak: true,
    xpPerCommand: 10,
    queueForReview: true,
  },
  'ride-along': {
    mode: 'ride-along',
    label: 'Ride-along',
    when: 'You are working. What it is, how it works and what it costs. No question, no voice.',
    card: 'brief',
    // What it is, how it works, and the one thing it costs you. The diagram,
    // the pitfalls and the docs stay off: they read fine an hour later, and the
    // archive keeps them.
    surface: {
      roadmap: false,
      what: true,
      how: true,
      tradeoffs: 1,
      diagram: false,
      pitfalls: false,
      docs: false,
      xpFootnote: 'on-change',
    },
    quiz: false,
    speak: false,
    xpPerCommand: 3,
    queueForReview: true,
  },
  focus: {
    mode: 'focus',
    label: 'Focus',
    when: 'Do not interrupt. Nothing surfaces but a refusal; it all waits for review.',
    card: 'none',
    surface: {
      roadmap: false,
      what: false,
      how: false,
      tradeoffs: 0,
      diagram: false,
      pitfalls: false,
      docs: false,
      xpFootnote: 'never',
    },
    quiz: false,
    speak: false,
    xpPerCommand: 0,
    queueForReview: true,
  },
};

export const MODES: readonly ModePolicy[] = [
  POLICIES.drill,
  POLICIES['ride-along'],
  POLICIES.focus,
];

export function policyFor(mode: SessionMode): ModePolicy {
  return POLICIES[mode];
}

/**
 * Coerces untrusted input to a mode. The value can arrive from a hand-edited
 * profile on disk or from a tool argument, so anything unrecognised falls back
 * to the default rather than throwing. Accepts a few obvious spellings because
 * a model writing `ride_along` should not be a failed call.
 */
export function parseMode(raw: unknown): SessionMode | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (k === 'drill' || k === 'ride-along' || k === 'focus') return k;
  if (k === 'ridealong' || k === 'ride' || k === 'ambient') return 'ride-along';
  if (k === 'quiet' || k === 'silent' || k === 'none' || k === 'off') return 'focus';
  if (k === 'full' || k === 'interactive' || k === 'lesson') return 'drill';
  return null;
}

export function resolveMode(raw: unknown): SessionMode {
  return parseMode(raw) ?? DEFAULT_MODE;
}

/**
 * Mode changes only ever come from the dedicated tool. Executing a command must
 * never raise interactivity on its own, for the same reason the danger screen
 * re-derives its own verdict: a model that can turn the volume up mid-session
 * will do it at the wrong moment. Deliberately not exported as a general
 * setter — callers go through this so the intent is explicit at the call site.
 *
 * Unrecognised input keeps the current mode. Snapping to the default would
 * escalate a focus session into ride-along, which is the failure this exists
 * to prevent.
 */
export function requestModeChange(
  current: SessionMode,
  requested: unknown,
): { mode: SessionMode; changed: boolean; policy: ModePolicy } {
  const parsed = parseMode(requested);
  if (parsed === null) {
    return { mode: current, changed: false, policy: policyFor(current) };
  }
  return { mode: parsed, changed: parsed !== current, policy: policyFor(parsed) };
}

/**
 * Whether a teaching card should surface at all this turn.
 *
 * `dangerous` is the override: a command the screen forced into dry-run always
 * reports, in every mode. Focus mode hides lessons, never refusals.
 */
export function shouldSurfaceCard(mode: SessionMode, dangerous: boolean): boolean {
  if (dangerous) return true;
  return policyFor(mode).card !== 'none';
}

/** Depth to render at, accounting for the same safety override. */
export function cardDepthFor(mode: SessionMode, dangerous: boolean): CardDepth {
  const depth = policyFor(mode).card;
  if (dangerous && depth === 'none') return 'brief';
  return depth;
}

/**
 * Sections to render this turn.
 *
 * A refusal is the one thing that overrides the mode, and it needs more than a
 * bare "blocked": in focus mode the learner has asked to be told nothing, so
 * the single report they do get must say what the command was and what it would
 * have cost. That is `what` plus one trade-off, which is the ride-along shape.
 */
export function surfaceFor(mode: SessionMode, dangerous: boolean): SurfaceSections {
  const p = policyFor(mode);
  if (dangerous && p.card === 'none') return policyFor('ride-along').surface;
  return p.surface;
}

/** XP for an execution under the active mode. */
export function commandXp(mode: SessionMode): number {
  return policyFor(mode).xpPerCommand;
}

/**
 * The shape of a progress change, structurally rather than by import, so this
 * module stays free of dependencies on the state layer. Pass whatever the XP
 * award returned.
 */
export interface ProgressChange {
  leveledUp?: boolean;
  titleChanged?: boolean;
  newBadges?: readonly unknown[];
  /** A streak reaching a value the learner would care about, not every increment. */
  streakMilestone?: boolean;
}

/**
 * Whether a change is worth a line of its own.
 *
 * Deliberately not "did XP move". XP moves on every command; that is not news.
 * A level, a title, a badge or a streak milestone is news.
 */
export function isWorthAnnouncing(change: ProgressChange | null | undefined): boolean {
  if (!change) return false;
  return Boolean(
    change.leveledUp ||
      change.titleChanged ||
      change.streakMilestone ||
      (change.newBadges && change.newBadges.length > 0),
  );
}

/** Whether to render the player footnote this turn. */
export function showsXpFootnote(mode: SessionMode, change?: ProgressChange | null): boolean {
  const policy = policyFor(mode).surface.xpFootnote;
  if (policy === 'never') return false;
  if (policy === 'always') return true;
  return isWorthAnnouncing(change);
}
