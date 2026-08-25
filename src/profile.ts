/**
 * Durable player progress.
 *
 * XP that vanishes when the editor restarts is not progress, it is a score in
 * an arcade cabinet nobody plugged in. So the profile lives on disk, and the
 * whole file is treated as untrusted input on the way back in: it is
 * hand-editable, it can be truncated by a crash mid-write, and a future version
 * of this server may have written it. Anything that fails to parse or validate
 * is discarded in favour of a fresh profile rather than surfaced as an error,
 * because losing a streak is a smaller harm than refusing to start.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PROFILE_VERSION = 1;

export interface PersistedPlayer {
  xp: number;
  level: number;
  title: string;
  quizStreak: number;
  bestStreak: number;
  badges: string[];
}

export interface PersistedRoadmap {
  category: string;
  roadmap_name: string;
  current_topic: string;
  step_index: number;
  total_steps: number;
}

export interface PersistedProfile {
  version: number;
  updatedAt: string;
  player: PersistedPlayer;
  settings: { skillLevel: string; voiceEnabled: boolean; wordsPerMinute: number };
  roadmap: PersistedRoadmap;
}

/** `MIYAGI_HOME` exists so tests and sandboxes never touch a real profile. */
export function profileDir(): string {
  return process.env.MIYAGI_HOME ?? path.join(os.homedir(), ".miyagi");
}

export function profilePath(): string {
  return path.join(profileDir(), "profile.json");
}

const int = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v: unknown, fallback: string, max = 80): string =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;

/**
 * Coerces whatever was on disk into a usable profile. Every field is clamped
 * rather than rejected: a hand-edited `xp: 999999999` becomes the ceiling, not
 * a crash, and not a level that overflows the title ladder.
 */
export function normaliseProfile(raw: unknown): PersistedProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (int(o.version, 0, 0, 999) !== PROFILE_VERSION) return null;

  const p = (o.player ?? {}) as Record<string, unknown>;
  const s = (o.settings ?? {}) as Record<string, unknown>;
  const r = (o.roadmap ?? {}) as Record<string, unknown>;

  const xp = int(p.xp, 0, 0, 10_000_000);
  const totalSteps = int(r.total_steps, 10, 1, 999);

  return {
    version: PROFILE_VERSION,
    updatedAt: str(o.updatedAt, new Date(0).toISOString(), 40),
    player: {
      xp,
      // Derived rather than trusted: level is a pure function of XP, so a file
      // claiming level 99 at 40 XP is corrected instead of believed.
      level: Math.floor(xp / 100) + 1,
      title: str(p.title, "Terminal Novice"),
      quizStreak: int(p.quizStreak, 0, 0, 100_000),
      bestStreak: int(p.bestStreak, 0, 0, 100_000),
      badges: Array.isArray(p.badges)
        ? Array.from(
            new Set(
              p.badges.filter((b): b is string => typeof b === "string" && b.trim().length > 0),
            ),
          ).slice(0, 50)
        : [],
    },
    settings: {
      skillLevel: ["Junior", "Mid", "Senior"].includes(String(s.skillLevel))
        ? String(s.skillLevel)
        : "Junior",
      voiceEnabled: typeof s.voiceEnabled === "boolean" ? s.voiceEnabled : true,
      wordsPerMinute: int(s.wordsPerMinute, 180, 80, 400),
    },
    roadmap: {
      category: str(r.category, "Absolute Beginners"),
      roadmap_name: str(r.roadmap_name, "Command Line Basics", 120),
      current_topic: str(r.current_topic, "Navigating the filesystem", 200),
      total_steps: totalSteps,
      step_index: int(r.step_index, 1, 1, totalSteps),
    },
  };
}

/** Returns null when there is nothing usable on disk, for any reason. */
export async function loadProfile(): Promise<PersistedProfile | null> {
  try {
    const text = await fs.readFile(profilePath(), "utf8");
    return normaliseProfile(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Written to a sibling temp file and renamed, so a crash midway leaves the
 * previous profile intact rather than a half-written one. Never throws: a
 * read-only home directory should cost the streak, not the session.
 */
export async function saveProfile(profile: PersistedProfile): Promise<boolean> {
  const target = profilePath();
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temp, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    await fs.rename(temp, target);
    return true;
  } catch {
    try {
      await fs.unlink(temp);
    } catch {
      /* nothing to clean up */
    }
    return false;
  }
}
