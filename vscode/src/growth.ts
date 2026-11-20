/**
 * What the learner does that is not answering a question.
 *
 * The profile records what someone can recall. Growing as a developer is
 * also what they do first: read the error before the assistant fixes it,
 * guess what a change will touch before it lands, explain a thing in their
 * own words, choose a tool for a reason they can still give next month. None
 * of that is a quiz answer, so none of it has a place in `profile.json`.
 *
 * It lives in `~/.miyagi/growth.json`, read and rewritten whole, like the
 * panel's journal. Everything here is described back to the learner, never
 * ranked against anyone: the point is for them to see their own trend.
 *
 * No `vscode` import: the counting and the trend are tested from the command line.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { profileDir } from "../../src/profile.js";
import { weekOf } from "./meter.js";

export type Verdict = "right" | "partly" | "wrong";

export interface ToolRecord {
  id: string;
  name: string;
  emoji: string;
  job: string;
  at: string;
  root: string;
  /** How it came to be taught: seen in a change, asked for by name, or named by the learner's AI. */
  source: "detected" | "asked" | "ai";
  /** The line or command it was seen in. */
  evidence: string;
  /** What the learner guessed it was for, before reading. */
  guess?: string;
  /** The ideas registered for its vocabulary. */
  termIds: string[];
  /** Its terms are on the review schedule. */
  adopted: boolean;
  /**
   * The whole description, kept only for tools the catalogue does not know
   * (written by the learner's AI), so their questions still exist next week.
   */
  spec?: {
    name: string;
    emoji: string;
    job: string;
    oneLiner: string;
    flow: string[];
    terms: Array<{ term: string; meaning: string }>;
    risks: string[];
    verify: string;
    topic: string;
  };
}

export interface Prediction {
  id: string;
  at: string;
  root: string;
  files: string[];
  approach?: string;
  resolved?: {
    at: string;
    actual: string[];
    hits: string[];
    misses: string[];
    surprises: string[];
    /** 0-1: how much of what was named and what happened overlapped. */
    score: number;
    approachVerdict?: Verdict;
  };
}

export interface DebugRead {
  at: string;
  signature: string;
  command: string;
  verdict: Verdict | "skipped" | "self-right" | "self-wrong";
}

export interface Decision {
  id: string;
  at: string;
  root: string;
  title: string;
  chose: string;
  over: string[];
  because: string;
  tradeoff?: string;
  revisit?: string;
  /** The recall question registered for it, when there is one. */
  conceptId?: string;
}

export interface Incident {
  id: string;
  at: string;
  title: string;
  whatBroke: string;
  cause: string;
  prevention: string;
  /** A built-in idea it was an instance of. */
  relatedConcept?: string;
  conceptId?: string;
}

export interface StoryEntry {
  id: string;
  at: string;
  kind: "tool" | "decision" | "incident" | "debug" | "belt" | "turn" | "prediction" | "check";
  title: string;
  detail: string;
}

/** One week of moves, counted. */
export interface WeekCounts {
  week: string;
  /** The learner went first: explained, predicted, read the error, wrote it. */
  first: number;
  /** The AI went first: an explanation asked for without trying, or "just show me". */
  aiFirst: number;
  /** Explanations of their own that were judged. */
  explainedTried: number;
  explainedRight: number;
  unaided: number;
  predictions: number;
  /** Sum of prediction scores, 0-1 each. */
  predictionScore: number;
  debugReads: number;
  debugRight: number;
}

export interface Growth {
  version: 1;
  tools: ToolRecord[];
  predictions: Prediction[];
  debug: DebugRead[];
  decisions: Decision[];
  incidents: Incident[];
  story: StoryEntry[];
  weeks: WeekCounts[];
  /** Commit checks answered, and how many were right. */
  gates: { asked: number; right: number };
}

export function emptyGrowth(): Growth {
  return { version: 1, tools: [], predictions: [], debug: [], decisions: [], incidents: [], story: [], weeks: [], gates: { asked: 0, right: 0 } };
}

export function growthPath(): string {
  return path.join(profileDir(), "growth.json");
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown, max = 600): string => (typeof v === "string" ? v.slice(0, max) : "");
const strings = (v: unknown, max = 40): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const VERDICTS = ["right", "partly", "wrong"] as const;
const verdict = (v: unknown): Verdict | undefined => VERDICTS.find((x) => x === v);

/** Keeps what is well formed, drops the rest entry by entry. A bad file costs itself, nothing else. */
export function normaliseGrowth(raw: unknown): Growth {
  if (!isObj(raw)) return emptyGrowth();
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter(isObj) : []);
  return {
    version: 1,
    tools: list("tools")
      .filter((t) => typeof t.id === "string" && typeof t.name === "string")
      .map((t) => ({
        id: s(t.id, 60),
        name: s(t.name, 80),
        emoji: s(t.emoji, 16) || "🧰",
        job: s(t.job, 80),
        at: s(t.at, 40),
        root: s(t.root, 500),
        source: (t.source === "asked" || t.source === "ai" ? t.source : "detected") as ToolRecord["source"],
        evidence: s(t.evidence, 200),
        ...(typeof t.guess === "string" ? { guess: s(t.guess, 400) } : {}),
        termIds: strings(t.termIds, 12),
        adopted: t.adopted === true,
        ...(isObj(t.spec) && typeof t.spec.name === "string"
          ? {
              spec: {
                name: s(t.spec.name, 60),
                emoji: s(t.spec.emoji, 16),
                job: s(t.spec.job, 80),
                oneLiner: s(t.spec.oneLiner, 200),
                flow: strings(t.spec.flow, 5).map((x) => x.slice(0, 140)),
                terms: (Array.isArray(t.spec.terms) ? t.spec.terms : [])
                  .filter(isObj)
                  .filter((x) => typeof x.term === "string" && typeof x.meaning === "string")
                  .map((x) => ({ term: s(x.term, 40), meaning: s(x.meaning, 200) }))
                  .slice(0, 6),
                risks: strings(t.spec.risks, 3).map((x) => x.slice(0, 200)),
                verify: s(t.spec.verify, 240),
                topic: s(t.spec.topic, 40),
              },
            }
          : {}),
      }))
      .slice(-80),
    predictions: list("predictions")
      .filter((p) => typeof p.id === "string" && typeof p.at === "string")
      .map((p): Prediction => {
        const r = isObj(p.resolved) ? p.resolved : null;
        return {
          id: s(p.id, 60),
          at: s(p.at, 40),
          root: s(p.root, 500),
          files: strings(p.files, 20),
          ...(typeof p.approach === "string" ? { approach: s(p.approach, 400) } : {}),
          ...(r
            ? {
                resolved: {
                  at: s(r.at, 40),
                  actual: strings(r.actual, 60),
                  hits: strings(r.hits, 40),
                  misses: strings(r.misses, 40),
                  surprises: strings(r.surprises, 60),
                  score: Math.max(0, Math.min(1, n(r.score))),
                  ...(verdict(r.approachVerdict) ? { approachVerdict: verdict(r.approachVerdict) } : {}),
                },
              }
            : {}),
        };
      })
      .slice(-120),
    debug: list("debug")
      .filter((d) => typeof d.at === "string")
      .map((d) => ({
        at: s(d.at, 40),
        signature: s(d.signature, 200),
        command: s(d.command, 300),
        verdict: (["right", "partly", "wrong", "skipped", "self-right", "self-wrong"] as const).find((x) => x === d.verdict) ?? "skipped",
      }))
      .slice(-300),
    decisions: list("decisions")
      .filter((d) => typeof d.id === "string" && typeof d.chose === "string")
      .map((d) => ({
        id: s(d.id, 60),
        at: s(d.at, 40),
        root: s(d.root, 500),
        title: s(d.title, 120),
        chose: s(d.chose, 120),
        over: strings(d.over, 6).map((o) => o.slice(0, 120)),
        because: s(d.because, 500),
        ...(typeof d.tradeoff === "string" ? { tradeoff: s(d.tradeoff, 400) } : {}),
        ...(typeof d.revisit === "string" ? { revisit: s(d.revisit, 300) } : {}),
        ...(typeof d.conceptId === "string" ? { conceptId: s(d.conceptId, 60) } : {}),
      }))
      .slice(-200),
    incidents: list("incidents")
      .filter((i) => typeof i.id === "string" && typeof i.title === "string")
      .map((i) => ({
        id: s(i.id, 60),
        at: s(i.at, 40),
        title: s(i.title, 120),
        whatBroke: s(i.whatBroke, 500),
        cause: s(i.cause, 500),
        prevention: s(i.prevention, 500),
        ...(typeof i.relatedConcept === "string" ? { relatedConcept: s(i.relatedConcept, 60) } : {}),
        ...(typeof i.conceptId === "string" ? { conceptId: s(i.conceptId, 60) } : {}),
      }))
      .slice(-100),
    story: list("story")
      .filter((e) => typeof e.id === "string" && typeof e.title === "string")
      .map((e) => ({
        id: s(e.id, 60),
        at: s(e.at, 40),
        kind: (["tool", "decision", "incident", "debug", "belt", "turn", "prediction", "check"] as const).find((k) => k === e.kind) ?? "belt",
        title: s(e.title, 160),
        detail: s(e.detail, 500),
      }))
      .slice(-300),
    weeks: list("weeks")
      .filter((w) => typeof w.week === "string")
      .map((w) => ({
        week: s(w.week, 10),
        first: n(w.first),
        aiFirst: n(w.aiFirst),
        explainedTried: n(w.explainedTried),
        explainedRight: n(w.explainedRight),
        unaided: n(w.unaided),
        predictions: n(w.predictions),
        predictionScore: n(w.predictionScore),
        debugReads: n(w.debugReads),
        debugRight: n(w.debugRight),
      }))
      .slice(-26),
    gates: isObj(raw.gates) ? { asked: n(raw.gates.asked), right: n(raw.gates.right) } : { asked: 0, right: 0 },
  };
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

let cache: Growth | null = null;
let writing: Promise<void> = Promise.resolve();

export async function loadGrowth(): Promise<Growth> {
  if (cache) return cache;
  try {
    cache = normaliseGrowth(JSON.parse(await fs.readFile(growthPath(), "utf8")));
  } catch {
    cache = emptyGrowth();
  }
  return cache;
}

/** Test seam: forget what was read, so the next load goes back to disk. */
export function forgetGrowth(): void {
  cache = null;
}

/** Applies a change and writes the file. Writes are queued, so two changes never race. */
export async function updateGrowth(change: (g: Growth) => void): Promise<Growth> {
  const g = await loadGrowth();
  change(g);
  cache = normaliseGrowth(g);
  const snapshot = JSON.stringify(cache);
  writing = writing.then(async () => {
    try {
      const file = growthPath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot, "utf8");
      await fs.rename(tmp, file);
    } catch {
      // Growth that fails to save costs the trend line, never the lesson.
    }
  });
  await writing;
  return cache;
}

/* ------------------------------------------------------------------ *
 * Counting moves
 * ------------------------------------------------------------------ */

export type Move =
  | { kind: "first" }
  | { kind: "aiFirst" }
  | { kind: "explained"; verdict: Verdict }
  | { kind: "unaided" }
  | { kind: "prediction"; score: number }
  | { kind: "debug"; verdict: Verdict | null };

export function weekRow(g: Growth, now: Date = new Date()): WeekCounts {
  const week = weekOf(now);
  let row = g.weeks.find((w) => w.week === week);
  if (!row) {
    row = { week, first: 0, aiFirst: 0, explainedTried: 0, explainedRight: 0, unaided: 0, predictions: 0, predictionScore: 0, debugReads: 0, debugRight: 0 };
    g.weeks.push(row);
    g.weeks.sort((a, b) => a.week.localeCompare(b.week));
  }
  return row;
}

/** Folds one move into this week's counts. Every move that is not `aiFirst` is the learner going first. */
export function count(g: Growth, move: Move, now: Date = new Date()): void {
  const row = weekRow(g, now);
  switch (move.kind) {
    case "aiFirst":
      row.aiFirst++;
      return;
    case "first":
      row.first++;
      return;
    case "explained":
      row.first++;
      row.explainedTried++;
      if (move.verdict === "right") row.explainedRight++;
      return;
    case "unaided":
      row.first++;
      row.unaided++;
      return;
    case "prediction":
      row.first++;
      row.predictions++;
      row.predictionScore += Math.max(0, Math.min(1, move.score));
      return;
    case "debug":
      row.first++;
      row.debugReads++;
      if (move.verdict === "right") row.debugRight++;
      return;
  }
}

export function addStory(g: Growth, entry: Omit<StoryEntry, "id" | "at">, now: Date = new Date()): void {
  // The same achievement told twice is padding, not a story.
  if (g.story.some((e) => e.kind === entry.kind && e.title === entry.title)) return;
  g.story.push({ id: `s${now.getTime().toString(36)}${g.story.length}`, at: now.toISOString(), ...entry });
}

/* ------------------------------------------------------------------ *
 * The trend
 * ------------------------------------------------------------------ */

export interface TrendWeek {
  week: string;
  /** 0-1, or null when fewer than three moves were made that week. */
  wentFirst: number | null;
  moves: number;
}

export interface Trend {
  weeks: TrendWeek[];
  /** One plain sentence, or null when there is too little to say. */
  sentence: string | null;
  thisWeek: WeekCounts;
}

const MIN_MOVES = 3;

/** The last `span` weeks, oldest first, with empty weeks filled in so gaps show as gaps. */
export function trend(g: Growth, now: Date = new Date(), span = 8): Trend {
  const weeks: TrendWeek[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const week = weekOf(new Date(now.getTime() - i * 7 * 86_400_000));
    const row = g.weeks.find((w) => w.week === week);
    const moves = row ? row.first + row.aiFirst : 0;
    weeks.push({ week, moves, wentFirst: row && moves >= MIN_MOVES ? row.first / moves : null });
  }
  const thisWeek = g.weeks.find((w) => w.week === weekOf(now)) ?? {
    week: weekOf(now), first: 0, aiFirst: 0, explainedTried: 0, explainedRight: 0, unaided: 0, predictions: 0, predictionScore: 0, debugReads: 0, debugRight: 0,
  };
  const known = weeks.filter((w) => w.wentFirst !== null);
  let sentence: string | null = null;
  const latest = known[known.length - 1];
  if (latest) {
    const pct = Math.round((latest.wentFirst ?? 0) * 100);
    const lead = latest.week === weekOf(now) ? "This week you" : "In your last active week you";
    sentence = `${lead} went first ${pct}% of the time: you tried before your AI explained.`;
    const earlier = known.length >= 2 ? known[0] : null;
    if (earlier && earlier !== latest) {
      const was = Math.round((earlier.wentFirst ?? 0) * 100);
      const delta = pct - was;
      sentence +=
        Math.abs(delta) < 5
          ? ` About the same as ${weeksAgo(earlier.week, now)}.`
          : delta > 0
          ? ` Up from ${was}% ${weeksAgo(earlier.week, now)}.`
          : ` Down from ${was}% ${weeksAgo(earlier.week, now)}. Worth noticing, not worrying about.`;
    }
  }
  return { weeks, sentence, thisWeek };
}

function weeksAgo(week: string, now: Date): string {
  const diff = Math.round((Date.parse(weekOf(now)) - Date.parse(week)) / (7 * 86_400_000));
  return diff <= 1 ? "last week" : `${diff} weeks ago`;
}

/* ------------------------------------------------------------------ *
 * Debugging
 * ------------------------------------------------------------------ */

/** The same failure seen again, ignoring numbers, paths and timings that change run to run. */
export function errorSignature(command: string, error: string): string {
  const first = error.split("\n").find((l) => /error|exception|failed|cannot|not found/i.test(l)) ?? error.split("\n")[0] ?? "";
  const shape = (t: string) =>
    t
      .toLowerCase()
      .replace(/\d+(\.\d+)?(ms|s)?/g, "#")
      .replace(/(\/|\\)[^\s:'"]+/g, "/…")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  return `${shape(command.split(/\s+/).slice(0, 3).join(" "))}|${shape(first)}`;
}

/**
 * Commands whose failure is ordinary and teaches nothing: a search that found
 * nothing, a probe for whether something exists, a process being stopped.
 */
const ROUTINE_FAILURE =
  /^\s*(grep|rg|egrep|fgrep|test|\[|which|command -v|type|diff|cmp|pgrep|pkill|kill|killall|ls|find|stat|git (diff|status|log|show|rev-parse|ls-files|branch|stash|remote|config)|cat|head|tail|curl -[a-z]*f)\b/i;

export function worthCoaching(command: string, error: string | undefined | null): boolean {
  if (!error || error.length < 12) return false;
  if (ROUTINE_FAILURE.test(command)) return false;
  return true;
}

/** The line of an error most worth reading first: the first that names a project file, else the first error line. */
export function clueLine(lines: readonly string[]): number | null {
  const frame = lines.findIndex((l) => /(^|[\s(])((\.{0,2}\/)?[\w@.-]+\/)*[\w.-]+\.(tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|swift|vue|svelte):\d+/.test(l) && !/node_modules|node:internal|site-packages/.test(l));
  if (frame >= 0) return frame + 1;
  const message = lines.findIndex((l) => /error|exception|failed|cannot|not found/i.test(l));
  return message >= 0 ? message + 1 : lines.length ? 1 : null;
}
