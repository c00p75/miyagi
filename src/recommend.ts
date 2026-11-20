/**
 * Session intake: which track to offer, and at what depth.
 *
 * The default profile used to dump every new learner onto Command Line Basics
 * at Junior. That is a valid start for someone who asked for it. It is the
 * wrong start for a frontend engineer opening a Next app. Recommendations
 * rank tracks from XP, mastery, and what they said they are building; the
 * learner still picks. A short placement quiz can override the Junior default
 * without forcing anyone through it.
 */

import type { QuizQuestion } from "./quiz.js";
import type { SkillLevel } from "./content.js";

export interface RecommendableTrack {
  name: string;
  category: string;
  description: string;
  source: string;
  steps: { topic: string; command: string }[];
}

export interface TrackRecommendation {
  name: string;
  category: string;
  score: number;
  reason: string;
}

export interface SkillSuggestion {
  level: SkillLevel;
  reason: string;
}

export interface PlacementResult {
  level: SkillLevel;
  correct: boolean;
}

/** Extra search terms a track should match, beyond its own name and copy. */
const ALIASES: Record<string, string[]> = {
  "Command Line Basics": [
    "beginner",
    "first shell",
    "new to the terminal",
    "never used a terminal",
    "pwd",
    "cli basics",
  ],
  "Git and GitHub": [
    "git",
    "github",
    "gitlab",
    "commit",
    "branch",
    "pull request",
    "version control",
    "merge",
  ],
  "Backend Developer": [
    "backend",
    "api",
    "server",
    "node",
    "express",
    "nestjs",
    "fastify",
    "django",
    "flask",
    "rails",
    "postgres",
    "prisma",
    "python",
  ],
  "Frontend Developer": [
    "frontend",
    "react",
    "next",
    "next.js",
    "vue",
    "svelte",
    "remix",
    "vite",
    "css",
    "tailwind",
    "ui",
    "browser",
    "typescript",
    "eslint",
  ],
  "DevOps": [
    "devops",
    "docker",
    "kubernetes",
    "k8s",
    "kubectl",
    "terraform",
    "ansible",
    "deploy",
    "ci",
    "infra",
    "cluster",
  ],
  "Shell Scripting": ["script", "bash", "zsh", "automation", "quoting", "pipefail", "shellcheck"],
};

const ADVANCED_BINS = new Set(["kubectl", "terraform", "docker", "git"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+#]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 2);
}

function haystack(parts: string[]): Set<string> {
  return new Set(parts.flatMap(tokens));
}

const STOP = new Set(["the", "and", "for", "with", "your", "you", "are", "this", "that", "from", "into"]);

function phraseHit(hay: string, phrase: string): boolean {
  const p = phrase.toLowerCase().trim();
  if (!p || STOP.has(p)) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9+#])${escaped}(?:[^a-z0-9+#]|$)`).test(hay);
}

function trackTerms(track: RecommendableTrack): string[] {
  const extra = ALIASES[track.name] ?? [];
  return [
    track.name,
    track.category,
    track.description,
    ...extra,
    ...track.steps.flatMap((s) => [s.topic, s.command.split(/\s+/)[0] ?? ""]),
  ];
}

function hitsFor(track: RecommendableTrack, interests: string, project: string): string[] {
  const hay = `${interests} ${project}`.toLowerCase();
  if (!hay.trim()) return [];
  const words = haystack([interests, project]);
  const found: string[] = [];
  const add = (token: string) => {
    if (token.length < 3 || STOP.has(token) || found.includes(token)) return;
    found.push(token);
  };
  for (const term of trackTerms(track)) {
    const t = term.toLowerCase().trim();
    if (t.length < 2) continue;
    if (t.includes(" ")) {
      if (phraseHit(hay, t)) add(t);
      for (const w of tokens(t)) {
        if (words.has(w) || phraseHit(hay, w)) add(w);
      }
    } else if (words.has(t) || phraseHit(hay, t)) {
      add(t);
    }
  }
  return found;
}

export function recommendTracks(opts: {
  tracks: RecommendableTrack[];
  xp: number;
  interests?: string;
  project?: string;
  activeName?: string;
  remainingOnActive?: number;
  strongBins?: readonly string[];
}): TrackRecommendation[] {
  const interests = opts.interests ?? "";
  const project = opts.project ?? "";
  const signal = `${interests} ${project}`.trim();
  const strong = new Set((opts.strongBins ?? []).map((b) => b.toLowerCase()));

  const scored = opts.tracks.map((track) => {
    let score = 0;
    const why: string[] = [];
    const hits = hitsFor(track, interests, project);
    if (hits.length) {
      score += hits.length * 4;
      why.push(`fits ${hits.slice(0, 3).join(", ")}`);
    }
    if (track.source === "user") {
      score += 3;
      why.push("you authored this track");
    }
    if (track.name === opts.activeName && (opts.remainingOnActive ?? 0) > 0) {
      score += 2;
      why.push("you already started this one");
    }
    if (track.category === "Absolute Beginners") {
      if (hits.length === 0 && signal) score -= 6;
      else if (!signal && opts.xp < 30) {
        score += 2;
        why.push("a gentle start if the shell is still new");
      }
      if (opts.xp >= 100) score -= 4;
    }
    const trackBins = new Set(track.steps.map((s) => (s.command.split(/\s+/)[0] ?? "").toLowerCase()));
    let overlap = 0;
    for (const b of trackBins) if (strong.has(b)) overlap += 1;
    if (overlap >= 2) score -= 1;

    return {
      name: track.name,
      category: track.category,
      score,
      reason: why.length ? why.join("; ") : "available if you want it",
    };
  });

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Always offer a real choice. CLI is not the whole menu, even at 0 XP.
  const picked: TrackRecommendation[] = [];
  for (const row of scored) {
    if (picked.length >= 3) break;
    picked.push(row);
  }
  return picked;
}

/**
 * Depth from history when they skip the placement quiz. XP and title are a
 * weak signal on purpose — a high number still does not mean they want Senior
 * prose, so this is a suggestion they can override.
 */
export function suggestSkillLevel(opts: {
  xp: number;
  playerLevel: number;
  strongBins?: readonly string[];
  placement?: PlacementResult[] | null;
}): SkillSuggestion {
  if (opts.placement && opts.placement.length >= 3) {
    return levelFromPlacement(opts.placement);
  }
  const advanced = (opts.strongBins ?? []).some((b) => ADVANCED_BINS.has(b.toLowerCase()));
  if (opts.xp >= 400 || opts.playerLevel >= 6 || (advanced && opts.xp >= 150)) {
    return {
      level: "Senior",
      reason: "XP and practised tools look like Senior depth. You can still pick Junior or Mid.",
    };
  }
  if (opts.xp >= 100 || opts.playerLevel >= 3 || advanced) {
    return {
      level: "Mid",
      reason: "Some practice is on record, so Mid is a better default than Junior. You choose.",
    };
  }
  return {
    level: "Junior",
    reason: "Little on record yet, so Junior is the safe suggestion — not a requirement. Pick Mid or Senior if the shell is already home.",
  };
}

/**
 * One question per depth, generic (not tied to a binary), so the test gauges
 * the person rather than the last command they ran.
 */
export function pickPlacementQuestions(
  questions: readonly QuizQuestion[],
  recentIds: readonly string[] = [],
): QuizQuestion[] {
  const recent = new Set(recentIds);
  const pick = (level: SkillLevel): QuizQuestion | undefined => {
    const generic = questions.filter((q) => q.level === level && q.bins.length === 0);
    const pool = generic.length ? generic : questions.filter((q) => q.level === level);
    const fresh = pool.filter((q) => !recent.has(q.id));
    return (fresh.length ? fresh : pool)[0];
  };
  return ["Junior", "Mid", "Senior"]
    .map((level) => pick(level as SkillLevel))
    .filter((q): q is QuizQuestion => Boolean(q));
}

/**
 * Missing Junior caps the suggestion at Junior. Passing Mid without Junior is
 * treated as a fundamentals gap, not as Mid.
 */
export function levelFromPlacement(results: readonly PlacementResult[]): SkillSuggestion {
  const byLevel = (level: SkillLevel) => results.filter((r) => r.level === level);
  const junior = byLevel("Junior");
  const mid = byLevel("Mid");
  const senior = byLevel("Senior");
  const juniorOk = junior.length > 0 && junior.every((r) => r.correct);
  const midOk = mid.length > 0 && mid.every((r) => r.correct);
  const seniorOk = senior.length > 0 && senior.every((r) => r.correct);

  if (juniorOk && midOk && seniorOk) {
    return { level: "Senior", reason: "Placement: Junior, Mid and Senior all landed." };
  }
  if (juniorOk && midOk) {
    return { level: "Mid", reason: "Placement: fundamentals and Mid held; Senior can wait." };
  }
  if (juniorOk) {
    return { level: "Junior", reason: "Placement: Junior held. Mid is there when you want it." };
  }
  return {
    level: "Junior",
    reason: "Placement: a Junior miss, so start there. You can raise the depth any time.",
  };
}

/* ------------------------------------------------------------------ *
 * In-process placement log. Cleared when a new test starts.
 * ------------------------------------------------------------------ */

let placementLog: PlacementResult[] = [];

export function resetPlacementLog(): void {
  placementLog = [];
}

export function recordPlacementResult(level: SkillLevel, correct: boolean): PlacementResult[] {
  placementLog = [...placementLog, { level, correct }];
  return placementLog;
}

export function currentPlacement(): PlacementResult[] {
  return placementLog;
}
