#!/usr/bin/env node
/**
 * miyagi
 * A patient, gamified, voice-enabled MCP coding tutor.
 *
 * Wax on, wax off: the learner runs every command themselves. This server
 * drills, corrects, catches the falls, and keeps score. It never does the
 * work for them.
 *
 * Transport: stdio. NOTHING may be written to stdout except MCP frames.
 * All diagnostics go to stderr.
 *
 * This file is the MCP surface only — tools, resources, prompts. The teaching
 * content lives in content.ts, progression in state.ts, layout in render.ts.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import os from "node:os";
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION } from "./version.js";
import { profilePath, profileDir, isDue, REVIEW_INTERVALS_DAYS } from "./profile.js";
import { readHistory, summarise, historyPath, flushHistory } from "./history.js";
import { analyse } from "./insights.js";
import { runDoctor } from "./doctor.js";
import {
  allTracks,
  exampleTrackJson,
  findTrack,
  loadUserTracks,
  resolveStep,
  roadmapsDir,
  stepAt,
  trackNames,
  trackShellWarning,
  verifiableSteps,
  CATEGORIES,
  DEFAULT_TRACK_FOR_CATEGORY,
  type Category,
  type RoadmapStep,
} from "./roadmaps.js";
import { binOf, conceptFor, type SkillLevel } from "./content.js";
import { isSameCommand, runCheckpoint, type CheckpointResult } from "./checkpoint.js";
import { execShellName, hostShell, posixEscapeHatch } from "./platform.js";
import {
  ask,
  grade,
  generatedCount,
  pickQuestion,
  questionById,
  type AskedQuiz,
} from "./quiz.js";
import {
  attachSampling,
  bankCovers,
  cachedCount,
  generateQuestion,
  gradeProse,
  loadGeneratedCache,
  samplingAvailable,
} from "./sampling.js";
import { screenCommand, screenDanger } from "./safety.js";
import { looksInteractive, runCommand, DEFAULT_TIMEOUT_MS } from "./run.js";
import { AudioQueue, sanitizeForSpeech } from "./tts.js";
import {
  commandXp,
  parseMode,
  policyFor,
  requestModeChange,
  shouldSurfaceCard,
  showsXpFootnote,
  surfaceFor,
} from "./modes.js";
import {
  activeRoadmap,
  awardXp,
  due,
  ensureReviewItem,
  gradeReviewItem,
  hydrate,
  masteryRows,
  nextDueAt,
  noteQuizAsked,
  persistNow,
  player,
  record,
  recordMastery,
  resetProgress,
  review,
  reviewCounts,
  schedulePersist,
  session,
  snapshot,
  streak,
  streakState,
  strongSpots,
  titleLadder,
  touchDay,
  firstRun,
  markReturning,
  onPersist,
  verified,
  verifiedAt,
  verifiedCount,
  isVerified,
  markVerified,
  voice,
  weakSpots,
  type DayResult,
  type XpResult,
} from "./state.js";
import {
  playerBlock,
  relative,
  renderTeachingCard,
  reviewLadder,
  roadmapBar,
  quizBlock,
  xpBar,
  xpFootnote,
} from "./render.js";

const log = (...a: unknown[]) => console.error("[miyagi]", ...a);

/** Re-exported for the test suite, which screens commands without a transport. */
export { screenDanger, sanitizeForSpeech };
export { titleForLevel } from "./profile.js";
export { resetProgress };

const audioQueue = new AudioQueue(voice);

/* ------------------------------------------------------------------ *
 * Open quizzes
 *
 * There used to be one `pendingQuiz` global, so a second command silently
 * discarded the question you were part-way through answering, and two clients
 * sharing a server clobbered each other. Askings are now addressed by token.
 * The most recent one is still the default, so answering without a token works
 * exactly as it did.
 * ------------------------------------------------------------------ */

interface OpenQuiz extends AskedQuiz {
  token: string;
}

const openQuizzes = new Map<string, OpenQuiz>();
let quizCounter = 0;
const MAX_OPEN_QUIZZES = 20;

function openQuiz(quiz: AskedQuiz): OpenQuiz {
  const token = `${quiz.id}#${++quizCounter}`;
  const open: OpenQuiz = { ...quiz, token };
  openQuizzes.set(token, open);
  // Oldest first out. A question from forty commands ago is not being answered.
  while (openQuizzes.size > MAX_OPEN_QUIZZES) {
    const oldest = openQuizzes.keys().next().value;
    if (oldest === undefined) break;
    openQuizzes.delete(oldest);
  }
  noteQuizAsked(quiz.id);
  return open;
}

function resolveQuiz(token?: string): OpenQuiz | null {
  if (token) {
    const direct = openQuizzes.get(token);
    if (direct) return direct;
    // A caller may pass the bare question id rather than the token it was given.
    const byId = [...openQuizzes.values()].reverse().find((q) => q.id === token);
    if (byId) return byId;
    return null;
  }
  const all = [...openQuizzes.values()];
  return all.length ? all[all.length - 1] : null;
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function streakLine(): string {
  const state = streakState();
  const nudge =
    state === "at-risk"
      ? " — practise today to keep it"
      : state === "broken"
      ? " — lapsed, today restarts it"
      : "";
  return (
    `Quiz streak: **${player.quizStreak}** 🔥 (best ${player.bestStreak})  \n` +
    `Practice days: **${streak.dayStreak}** in a row${nudge} (best ${streak.bestDayStreak}, ${streak.totalDays} total)`
  );
}

/* ------------------------------------------------------------------ *
 * First run
 *
 * A new user had to already know that `list_roadmaps` existed. The first
 * substantive response of a fresh install now carries the orientation, once,
 * and then never again — a banner on every card would be noise by the third
 * one.
 * ------------------------------------------------------------------ */

let onboardingShown = false;

function onboarding(): string | null {
  if (!firstRun || onboardingShown) return null;
  onboardingShown = true;
  return [
    "> ### 👋 First run",
    "> Nothing is saved yet, so here is the shape of it:",
    `> 1. \`list_roadmaps\` — pick a track. There are ${allTracks().length}, and you can author your own.`,
    "> 2. `get_next_roadmap_command` — it hands you a command. **You** run it, in your own terminal or through `run_teaching_command`.",
    "> 3. `verify_step` — checks the outcome actually exists on your machine. That is what earns real XP; running a command is worth a token amount.",
    "> 4. `review_due_items` — comes back later for whatever you got wrong. That is the part that turns practice into memory.",
    `> Progress saves to \`${profilePath()}\`. Nothing leaves your machine.`,
  ].join("\n");
}

/** Prepends the first-run orientation to a card, when there is one to show. */
function withOnboarding(text: string): string {
  const intro = onboarding();
  return intro ? `${intro}\n\n${text}` : text;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function result<T extends Record<string, unknown>>(text: string, structured: T) {
  return {
    content: [{ type: "text" as const, text: withOnboarding(text) }],
    structuredContent: structured,
  };
}

/* ------------------------------------------------------------------ *
 * Human confirmation
 *
 * `confirm_dangerous` was a flag the *model* filled in, which is not
 * confirmation at all: a prompt-injected or over-eager assistant sets it as
 * easily as a careful one. Where the client supports elicitation, the server
 * asks the person directly and requires them to type the word, and no amount
 * of model enthusiasm satisfies that. The flag remains only as the fallback
 * for clients that cannot elicit, and is documented as such.
 * ------------------------------------------------------------------ */

const CONFIRM_WORD = "RUN";

type ConfirmDecision =
  | { authorised: true; by: "human" | "caller-flag" }
  | { authorised: false; reason: string };

function clientCanElicit(): boolean {
  return Boolean(server.server.getClientCapabilities()?.elicitation);
}

async function askHuman(command: string, reasons: string[]): Promise<ConfirmDecision> {
  try {
    const answer = await server.server.elicitInput({
      message:
        `miyagi wants to run a command flagged as destructive:\n\n${command}\n\n` +
        `Flagged for: ${reasons.join(", ")}.\n\n` +
        `Read it. If you want it to run, type ${CONFIRM_WORD}. Anything else cancels.`,
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "string",
            title: `Type ${CONFIRM_WORD} to execute`,
            description: `Exactly "${CONFIRM_WORD}" authorises this command. Leave blank to cancel.`,
          },
        },
        required: ["confirm"],
      },
    });

    if (answer.action !== "accept") {
      return { authorised: false, reason: `you ${answer.action === "decline" ? "declined" : "cancelled"} the confirmation` };
    }
    const typed = String(answer.content?.confirm ?? "").trim().toUpperCase();
    if (typed !== CONFIRM_WORD) {
      return {
        authorised: false,
        reason: `the confirmation did not match (expected ${CONFIRM_WORD}, got ${typed ? `"${typed}"` : "nothing"})`,
      };
    }
    return { authorised: true, by: "human" };
  } catch (err) {
    // A client that advertises elicitation and then fails it must not become a
    // way to execute something nobody approved. Failure means no.
    log("elicitation failed:", (err as Error).message);
    return { authorised: false, reason: "the confirmation prompt could not be delivered" };
  }
}

/** The current track, resolved through the roadmap registry every time. */
function currentTrack() {
  return findTrack(activeRoadmap.roadmap_name, activeRoadmap.category);
}

interface Suggestion {
  command: string;
  topic: string;
  note?: string;
  rationale: string;
  matched: boolean;
  step: RoadmapStep;
  /** The POSIX line was swapped for a PowerShell one. */
  substituted: boolean;
  /** Set when this host cannot run the step and there is no alternative. */
  shellWarning: string | null;
  /** The pass criterion, when the step has one. */
  criterion: string | null;
  alreadyVerified: boolean;
}

function suggestCommand(): Suggestion {
  const lookup = currentTrack();
  const step = stepAt(lookup.track, activeRoadmap.step_index);
  const resolved = resolveStep(lookup.track, step);
  return {
    command: resolved.command,
    topic: step.topic,
    note: step.note,
    matched: lookup.matched,
    step,
    substituted: resolved.substituted,
    shellWarning: resolved.warning,
    criterion: step.verify?.describe ?? null,
    alreadyVerified: isVerified(lookup.track.name, activeRoadmap.step_index),
    rationale: `Step ${activeRoadmap.step_index}/${activeRoadmap.total_steps} of "${lookup.track.name}". Topic: ${activeRoadmap.current_topic}.`,
  };
}

/* ------------------------------------------------------------------ *
 * Checkpoints
 * ------------------------------------------------------------------ */

/** XP for a verified outcome. Deliberately more than running the command. */
const XP_COMMAND_ATTEMPT = 10;
const XP_CHECKPOINT_PASS = 30;

interface CheckpointOutcome {
  result: CheckpointResult;
  criterion: string;
  /** First time this step has passed, so XP is owed. */
  firstPass: boolean;
  advanced: boolean;
  xp: XpResult | null;
}

/**
 * Verifies the current step and books the consequences: XP once, advance once.
 * Re-verifying an already-passed step confirms it and pays nothing, because
 * paying twice would recreate the problem checkpoints exist to solve.
 */
async function verifyCurrentStep(cwd?: string): Promise<CheckpointOutcome | null> {
  const lookup = currentTrack();
  const stepIndex = Math.min(lookup.track.steps.length, Math.max(1, activeRoadmap.step_index));
  if (activeRoadmap.total_steps !== lookup.track.steps.length || activeRoadmap.step_index !== stepIndex) {
    activeRoadmap.total_steps = lookup.track.steps.length;
    activeRoadmap.step_index = stepIndex;
    schedulePersist();
  }
  const step = stepAt(lookup.track, stepIndex);
  if (!step.verify) return null;

  const result = await runCheckpoint(step.verify, { cwd });
  let firstPass = false;
  let advanced = false;
  let xp: XpResult | null = null;

  if (result.passed) {
    firstPass = markVerified(lookup.track.name, stepIndex);
    if (firstPass) {
      xp = awardXp(XP_CHECKPOINT_PASS);
      touchDay();
    }
    if (stepIndex < lookup.track.steps.length) {
      activeRoadmap.step_index = stepIndex + 1;
      activeRoadmap.current_topic = stepAt(lookup.track, activeRoadmap.step_index).topic;
      advanced = true;
      schedulePersist();
    }
  } else if (!result.unusable) {
    // A failed checkpoint is the clearest possible signal to practise again.
    ensureReviewItem("command", binOf(step.command), step.command);
  }

  record({
    kind: "checkpoint",
    label: `${lookup.track.name} step ${stepIndex}: ${step.verify.describe}`,
    bin: binOf(step.command),
    correct: result.passed,
    detail: result.passed
      ? firstPass
        ? "passed for the first time"
        : "passed again (already credited)"
      : `did not pass: ${result.reason}`,
    xpAwarded: xp?.awarded ?? 0,
  });

  return { result, criterion: step.verify.describe, firstPass, advanced, xp };
}

function renderCheckpoint(outcome: CheckpointOutcome): string {
  const lines = [outcome.result.passed ? "## ✅ Checkpoint Passed" : "## ⛔ Checkpoint Not Passed"];
  lines.push(`**Criterion:** ${outcome.criterion}`);
  if (outcome.result.passed) {
    lines.push(
      outcome.firstPass
        ? `Verified on your machine, so this is credited: **+${XP_CHECKPOINT_PASS} XP**.`
        : "Verified again. Already credited, so no XP this time — the ledger pays for outcomes, not for repeats.",
    );
    if (outcome.advanced) {
      lines.push(`Advanced to step **${activeRoadmap.step_index}/${activeRoadmap.total_steps}**.`);
    }
  } else {
    lines.push(`**Result:** ${outcome.result.reason}`);
    if (outcome.result.output) lines.push("```\n" + outcome.result.output + "\n```");
    lines.push(
      outcome.result.unusable
        ? "_The probe itself could not run, so nothing is being held against you._"
        : "_The step stays where it is. Re-run the command, then `verify_step` again — the checkpoint is the whole point: XP is for the outcome, not for the attempt._",
    );
  }
  return lines.join("\n");
}

/** Shared shape for the player block in structured output. */
const PLAYER_OUT = {
  xp: z.number(),
  level: z.number(),
  title: z.string(),
  quiz_streak: z.number(),
  best_quiz_streak: z.number(),
  day_streak: z.number(),
  badges: z.array(z.string()),
};

function playerOut() {
  return {
    xp: player.xp,
    level: player.level,
    title: player.title,
    quiz_streak: player.quizStreak,
    best_quiz_streak: player.bestStreak,
    day_streak: streak.dayStreak,
    badges: [...player.badges],
  };
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */

const server = new McpServer({
  name: "miyagi",
  version: VERSION,
});

/* ---- quick_config -------------------------------------------------- *
 * Voice settings used to live in a second `configure_voice` tool that
 * duplicated these fields. One tool now owns configuration, including the
 * test phrase, because two ways to set the same value is two things to keep
 * in sync and one of them will drift.
 * ------------------------------------------------------------------ */
server.registerTool(
  "quick_config",
  {
    title: "Quick Config",
    annotations: {
      title: "Quick Config",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Set the teaching depth (Junior/Mid/Senior), roadmap category, track, topic, voice, and session mode (drill, ride-along, or focus). Call with no arguments to read the current configuration.",
    inputSchema: {
      skill_level: z
        .enum(["Junior", "Mid", "Senior"])
        .optional()
        .describe("Depth of explanation used in every teaching card."),
      category: z.enum(CATEGORIES as [Category, ...Category[]]).optional(),
      roadmap_name: z
        .string()
        .optional()
        .describe('Track name. Use `list_roadmaps` for valid values, e.g. "Backend Developer".'),
      current_topic: z.string().optional(),
      voice_enabled: z.boolean().optional(),
      words_per_minute: z.number().int().min(80).max(400).optional(),
      test_phrase: z.string().optional().describe("Speak this immediately to test the audio setup."),
      mode: z
        .string()
        .optional()
        .describe("Session intensity: drill (full lesson), ride-along (quiet default), or focus (refusals only)."),
      reset_progress: z
        .boolean()
        .optional()
        .describe("Wipe saved XP, level, streaks, mastery and review queue back to first-run state."),
    },
  },
  async (args) => {
    const changes: string[] = [];
    const warnings: string[] = [];

    if (args.reset_progress) {
      resetProgress();
      changes.push("**progress reset** to level 1, 0 XP, empty review queue");
    }
    if (args.skill_level) {
      session.skillLevel = args.skill_level;
      changes.push(`skill level → **${session.skillLevel}**`);
    }
    if (args.category) {
      activeRoadmap.category = args.category;
      // Switching category with no track named moves to that category's default,
      // but only when the current track does not exist any more.
      if (!args.roadmap_name && !findTrack(activeRoadmap.roadmap_name).matched) {
        activeRoadmap.roadmap_name = DEFAULT_TRACK_FOR_CATEGORY[args.category];
        changes.push(`track → **${activeRoadmap.roadmap_name}** (category default)`);
      }
      changes.push(`category → **${activeRoadmap.category}**`);
    }
    if (args.roadmap_name) {
      const lookup = findTrack(args.roadmap_name, activeRoadmap.category);
      activeRoadmap.roadmap_name = lookup.matched ? lookup.track.name : args.roadmap_name;
      activeRoadmap.total_steps = lookup.track.steps.length;
      activeRoadmap.step_index = Math.min(activeRoadmap.step_index, activeRoadmap.total_steps);
      changes.push(`roadmap → **${activeRoadmap.roadmap_name}**`);
      if (!lookup.matched) {
        warnings.push(
          `No track named **${args.roadmap_name}** exists, so suggestions will come from **${lookup.track.name}**.` +
            (lookup.suggestions.length ? ` Did you mean: ${lookup.suggestions.join(", ")}?` : "") +
            " `list_roadmaps` shows every track, including your own.",
        );
      }
    }
    if (args.current_topic) {
      activeRoadmap.current_topic = args.current_topic;
      changes.push(`topic → **${activeRoadmap.current_topic}**`);
    }
    if (typeof args.voice_enabled === "boolean") {
      voice.enabled = args.voice_enabled;
      if (!voice.enabled) audioQueue.clear();
      changes.push(`voice → **${voice.enabled ? "on" : "off"}**`);
    }
    if (args.words_per_minute) {
      voice.words_per_minute = args.words_per_minute;
      changes.push(`speech rate → **${voice.words_per_minute} wpm**`);
    }
    if (args.mode !== undefined) {
      const parsed = parseMode(args.mode);
      if (!parsed) {
        warnings.push(
          `Unknown mode **${args.mode}**. Use \`drill\`, \`ride-along\`, or \`focus\`.`,
        );
      } else {
        const req = requestModeChange(session.mode, parsed);
        session.mode = req.mode;
        if (req.changed) {
          changes.push(`mode → **${req.policy.label}** — ${req.policy.when}`);
          if (!req.policy.speak) audioQueue.clear();
        }
      }
    }

    const counts = reviewCounts();
    const status = [
      `- Skill level: **${session.skillLevel}**`,
      `- Category: **${activeRoadmap.category}**`,
      `- Roadmap: **${activeRoadmap.roadmap_name}** (\`${roadmapBar(activeRoadmap)}\`)`,
      `- Topic: **${activeRoadmap.current_topic}**`,
      `- Voice: **${voice.enabled ? "on" : "off"}** @ ${voice.words_per_minute} wpm via ${audioQueue.engineName()}`,
      `- Mode: **${policyFor(session.mode).label}** — ${policyFor(session.mode).when}`,
      `- Platform: **${os.platform()}** · queue depth ${audioQueue.pending}`,
      `- Review queue: **${counts.due}** due of ${counts.total}`,
      `- Profile: \`${profilePath()}\``,
    ].join("\n");

    if (args.test_phrase && voice.enabled) audioQueue.enqueue(args.test_phrase);

    if (!changes.length) {
      return textResult(`## ⚙️ Configuration\n${status}`);
    }

    schedulePersist();
    record({ kind: "config", label: "quick_config", detail: changes.join("; "), xpAwarded: 0 });
    if (!args.test_phrase) {
      audioQueue.enqueue(
        `Configuration updated. Teaching at ${session.skillLevel} level on ${activeRoadmap.roadmap_name}.`,
      );
    }

    return textResult(
      [
        "## ⚙️ Quick Config Applied",
        changes.map((c) => `- ${c}`).join("\n"),
        warnings.length ? "\n### ⚠️ Warnings\n" + warnings.map((w) => `- ${w}`).join("\n") : "",
        "",
        "### Now",
        status,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

/* ---- list_roadmaps -------------------------------------------------- */
server.registerTool(
  "list_roadmaps",
  {
    title: "List Roadmaps",
    annotations: {
      title: "List Roadmaps",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "List every available track, built-in and user-authored, with its category and step count. Call this before setting a roadmap name: previously an unknown name silently fell back to Command Line Basics.",
    inputSchema: {
      category: z.enum(CATEGORIES as [Category, ...Category[]]).optional(),
      reload: z
        .boolean()
        .default(false)
        .describe("Re-read user tracks from disk before listing, after you have edited them."),
    },
    outputSchema: {
      tracks: z.array(
        z.object({
          name: z.string(),
          category: z.string(),
          description: z.string(),
          steps: z.number(),
          source: z.string(),
          active: z.boolean(),
        }),
      ),
      user_dir: z.string(),
      loaded_user_tracks: z.number(),
      skipped_files: z.array(z.string()),
    },
  },
  async ({ category, reload }) => {
    const report = reload ? await loadUserTracks() : null;
    const tracks = allTracks()
      .filter((t) => !category || t.category === category)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const rows = tracks.map((t) => ({
      name: t.name,
      category: t.category,
      description: t.description,
      steps: t.steps.length,
      source: t.source,
      active: t.name === activeRoadmap.roadmap_name,
    }));

    const byCategory = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byCategory.get(r.category) ?? [];
      list.push(r);
      byCategory.set(r.category, list);
    }

    const lines = ["# 🗺️ Available Roadmaps", ""];
    for (const [cat, list] of byCategory) {
      lines.push(`## ${cat}`);
      for (const r of list) {
        lines.push(
          `- ${r.active ? "▶️" : "  "} **${r.name}** · ${r.steps} steps · ${r.source}  \n  ${r.description}`,
        );
      }
      lines.push("");
    }
    lines.push("## Authoring your own");
    lines.push(
      `Drop a JSON file in \`${roadmapsDir()}\` and it appears here. A file whose \`name\` matches a built-in shadows it, so you can retune a track without forking the server.`,
    );
    lines.push("```json\n" + exampleTrackJson() + "\n```");
    if (report?.skipped.length) {
      lines.push("", "### ⚠️ Skipped files", report.skipped.map((s) => `- ${s}`).join("\n"));
    }
    lines.push("", "_Set one with `quick_config` or `set_active_roadmap`._");

    return result(lines.join("\n"), {
      tracks: rows,
      user_dir: roadmapsDir(),
      loaded_user_tracks: report?.loaded ?? rows.filter((r) => r.source === "user").length,
      skipped_files: report?.skipped ?? [],
    });
  },
);

/* ---- set_active_roadmap -------------------------------------------- */
server.registerTool(
  "set_active_roadmap",
  {
    title: "Set Active Roadmap",
    annotations: {
      title: "Set Active Roadmap",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Configure the active roadmap: category, track name, current topic, and progress counters. An unknown track name is reported rather than silently substituted.",
    inputSchema: {
      category: z.enum(CATEGORIES as [Category, ...Category[]]),
      roadmap_name: z.string(),
      current_topic: z.string().optional(),
      step_index: z.number().int().min(1).default(1),
      total_steps: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Ignored. The track's own step count is used so a caller cannot inflate the counter to farm checkpoint XP."),
    },
  },
  async (args) => {
    const lookup = findTrack(args.roadmap_name, args.category);
    activeRoadmap.category = args.category;
    activeRoadmap.roadmap_name = lookup.matched ? lookup.track.name : args.roadmap_name;
    activeRoadmap.total_steps = lookup.track.steps.length;
    activeRoadmap.step_index = Math.min(args.step_index, activeRoadmap.total_steps);
    activeRoadmap.current_topic =
      args.current_topic ?? stepAt(lookup.track, activeRoadmap.step_index).topic;

    schedulePersist();
    record({
      kind: "concept",
      label: `Roadmap set: ${activeRoadmap.roadmap_name}`,
      detail: `${args.category} → ${activeRoadmap.current_topic} (step ${activeRoadmap.step_index}/${activeRoadmap.total_steps})`,
      xpAwarded: 0,
    });
    audioQueue.enqueue(
      `Roadmap set to ${activeRoadmap.roadmap_name}. Current topic: ${activeRoadmap.current_topic}. Step ${activeRoadmap.step_index} of ${activeRoadmap.total_steps}.`,
    );

    const next = suggestCommand();
    return textResult(
      [
        "## 🗺️ Active Roadmap Updated",
        `**Category:** ${activeRoadmap.category}`,
        `**Roadmap:** ${activeRoadmap.roadmap_name}${lookup.matched ? "" : " ⚠️"}`,
        `**Topic:** ${activeRoadmap.current_topic}`,
        `**Progress:** \`${roadmapBar(activeRoadmap)}\``,
        lookup.matched
          ? ""
          : [
              "",
              `### ⚠️ No track called **${args.roadmap_name}**`,
              `Suggestions will come from **${lookup.track.name}** until you set a real one.` +
                (lookup.suggestions.length ? ` Did you mean: ${lookup.suggestions.join(", ")}?` : ""),
              "Run `list_roadmaps` to see every track, or author your own as JSON.",
            ].join("\n"),
        "",
        "**Suggested next command:**",
        "```bash\n" + next.command + "\n```",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

/* ---- get_next_roadmap_command -------------------------------------- */
server.registerTool(
  "get_next_roadmap_command",
  {
    title: "Get Next Roadmap Command",
    annotations: {
      title: "Get Next Roadmap Command",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Suggest the next copy-pasteable command for the active roadmap milestone. Optionally advance the step counter.",
    inputSchema: {
      advance: z.boolean().default(false).describe("Advance step_index by one before suggesting."),
    },
    outputSchema: {
      command: z.string(),
      topic: z.string(),
      step_index: z.number(),
      total_steps: z.number(),
      roadmap_name: z.string(),
      roadmap_exists: z.boolean(),
      flagged: z.array(z.string()),
      review_due: z.number(),
      criterion: z.string().nullable(),
      already_verified: z.boolean(),
      shell_warning: z.string().nullable(),
    },
  },
  async ({ advance }) => {
    if (advance && activeRoadmap.step_index < activeRoadmap.total_steps) {
      activeRoadmap.step_index += 1;
      schedulePersist();
    }
    const next = suggestCommand();
    activeRoadmap.current_topic = next.topic;
    const screening = screenCommand(next.command);
    const counts = reviewCounts();

    audioQueue.enqueue(`Next up on ${activeRoadmap.roadmap_name}: ${next.rationale}. Try the suggested command.`);
    record({ kind: "concept", label: "Suggested command", detail: next.command, xpAwarded: 0, bin: binOf(next.command) });

    const text = [
      "## ➡️ Next Roadmap Command",
      next.rationale,
      `Progress: \`${roadmapBar(activeRoadmap)}\``,
      "",
      "```bash\n" + next.command + "\n```",
      next.substituted
        ? "_(PowerShell equivalent, because this track is written for a POSIX shell and you are on Windows.)_"
        : "",
      next.note ? `> ${next.note}` : "",
      next.criterion
        ? `\n🔍 **Checkpoint:** this step passes when ${next.criterion}.` +
          (next.alreadyVerified
            ? " You have already passed it once, so re-passing pays nothing."
            : ` Run the command yourself, then \`verify_step\` — that is what earns the ${XP_CHECKPOINT_PASS} XP.`)
        : "\n_No checkpoint on this step, so it is worth attempt XP only._",
      next.shellWarning ? `\n⚠️ **${next.shellWarning}**` : "",
      next.matched
        ? ""
        : `\n⚠️ **${activeRoadmap.roadmap_name}** is not a known track, so this came from **${currentTrack().track.name}**. Run \`list_roadmaps\`.`,
      screening.reasons.length
        ? `\n⚠️ **Safety note:** flagged for _${screening.reasons.join(", ")}_.` +
          (screening.blocked
            ? " This will not execute through the tutor at all."
            : " It will dry-run unless you pass `confirm_dangerous: true`.")
        : "",
      counts.due
        ? `\n♻️ **${counts.due}** item${counts.due === 1 ? "" : "s"} due for review. \`review_due_items\` first pays better than new ground.`
        : "",
      "",
      "Run it through `run_teaching_command` to get the full teaching card and earn XP.",
    ]
      .filter(Boolean)
      .join("\n");

    return result(text, {
      command: next.command,
      topic: next.topic,
      step_index: activeRoadmap.step_index,
      total_steps: activeRoadmap.total_steps,
      roadmap_name: activeRoadmap.roadmap_name,
      roadmap_exists: next.matched,
      flagged: screening.reasons,
      review_due: counts.due,
      criterion: next.criterion,
      already_verified: next.alreadyVerified,
      shell_warning: next.shellWarning,
    });
  },
);

/* ---- run_teaching_command ------------------------------------------ */
server.registerTool(
  "run_teaching_command",
  {
    title: "Run Teaching Command",
    description:
      "Execute (or dry-run) a shell command and return a teaching card. Depth follows the session mode (drill / ride-along / focus): drill is the full card plus quiz and speech; quieter modes defer recall rather than dropping it. If the command is the current roadmap step and that step has a checkpoint, the outcome is verified on disk afterwards and XP is awarded for the verified outcome. Failures return a Hotfix Diagnostic instead of throwing.",
    annotations: {
      title: "Run Teaching Command",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      command: z.string().min(1).describe("The shell command to teach and optionally run."),
      concept: z.string().optional().describe("Override the concept label on the card."),
      is_dangerous: z
        .boolean()
        .default(false)
        .describe("Caller-asserted danger flag. Forces a dry run; never authorises one."),
      dry_run: z.boolean().default(false).describe("Explain without executing."),
      confirm_dangerous: z
        .boolean()
        .default(false)
        .describe(
          "Fallback confirmation for clients that cannot elicit input from the user. Where the client supports elicitation the human is asked directly and this flag is not sufficient on its own. Never authorises a catastrophic shape.",
        ),
      cwd: z.string().optional().describe("Working directory for execution."),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe(`Execution timeout. Defaults to ${DEFAULT_TIMEOUT_MS} ms.`),
    },
    outputSchema: {
      command: z.string(),
      executed: z.boolean(),
      exit_code: z.number().nullable(),
      duration_ms: z.number().nullable(),
      truncated: z.boolean(),
      timed_out: z.boolean(),
      flagged: z.array(z.string()),
      blocked: z.boolean(),
      quiz_id: z.string(),
      xp_awarded: z.number(),
      confirmed_by: z.string().nullable(),
      checkpoint: z
        .object({
          criterion: z.string(),
          passed: z.boolean(),
          first_pass: z.boolean(),
          advanced: z.boolean(),
        })
        .nullable(),
      player: z.object(PLAYER_OUT),
    },
  },
  async (args) => {
    const command = args.command.trim();
    const bin = binOf(command);
    const screening = screenCommand(command);

    // Order matters: the screen's own verdict decides, then the caller's flag
    // can only ever make execution less likely, never more.
    let executed = !args.dry_run && !args.is_dangerous;
    let dryRunReason: string | null = args.dry_run
      ? "requested"
      : args.is_dangerous
      ? "caller flagged it as dangerous"
      : null;

    let confirmedBy: "human" | "caller-flag" | null = null;

    if (screening.blocked) {
      executed = false;
      dryRunReason = "the safety screen refuses this shape outright";
    } else if (screening.reasons.length && executed) {
      // Ask the person where we can. Only fall back to the caller's flag when
      // the client genuinely cannot put a prompt in front of a human.
      if (clientCanElicit()) {
        const decision = await askHuman(command, screening.reasons);
        if (decision.authorised) {
          confirmedBy = decision.by;
        } else {
          executed = false;
          dryRunReason = `flagged as destructive and ${decision.reason}`;
        }
      } else if (args.confirm_dangerous) {
        confirmedBy = "caller-flag";
      } else {
        executed = false;
        dryRunReason = "flagged as destructive and not confirmed";
      }
    }

    if (executed && looksInteractive(command)) {
      executed = false;
      dryRunReason =
        "this command waits for input or never exits, so it would only hit the timeout — run it in your own terminal";
    }

    const outcome = executed
      ? await runCommand(command, { cwd: args.cwd, timeoutMs: args.timeout_ms })
      : null;

    // Attempt XP follows the session mode. Exposure in ride-along pays little;
    // focus pays nothing; drill still pays less than a verified checkpoint.
    const xp: XpResult | null = outcome ? awardXp(commandXp(session.mode)) : null;
    const day: DayResult | null = outcome ? touchDay() : null;
    if (outcome) {
      recordMastery(bin, { attempt: true, success: outcome.ok });
      // Practised commands enter the review queue so they come back later.
      ensureReviewItem("command", bin, command);
    }

    // Verify the outcome when this was the current step's command and that step
    // has a checkpoint. Nothing is verified for a dry run: there is no outcome.
    const suggestion = suggestCommand();
    const checkpoint =
      outcome && suggestion.step.verify && isSameCommand(command, suggestion.command)
        ? await verifyCurrentStep(args.cwd)
        : null;

    // Where the bank has nothing about this command, ask the host model for a
    // question and cache it, so the bank grows towards what this user practises.
    // No sampling, a refusal or anything unparseable falls back to the bank.
    const generated =
      !bankCovers(bin) && samplingAvailable()
        ? await generateQuestion({
            bin,
            command,
            level: session.skillLevel,
            topic: activeRoadmap.current_topic,
            avoid: session.recentQuizIds,
          })
        : null;

    const question =
      generated ??
      pickQuestion({
        bin,
        skillLevel: session.skillLevel,
        recentIds: session.recentQuizIds,
        salt: `${activeRoadmap.step_index}:${player.xp}`,
      });
    ensureReviewItem("quiz", question.id, question.question);

    const policy = policyFor(session.mode);
    const dangerous = Boolean(screening.reasons.length);
    const askNow = policy.quiz;
    const quiz = askNow ? openQuiz(ask(question, bin, { salt: String(quizCounter + 1) })) : null;

    record({
      kind: "command",
      label: command,
      bin,
      detail: !outcome
        ? `not executed (${dryRunReason ?? "dry run"})`
        : outcome.ok
        ? `executed successfully (exit 0, ${outcome.durationMs} ms)`
        : `failed (exit ${outcome.code ?? "n/a"}), hotfix diagnostic issued`,
      xpAwarded: xp?.awarded ?? 0,
    });

    if (policy.speak) {
      const spoken = !outcome
        ? `Not executed. ${dryRunReason ?? "Dry run"}.` + (quiz ? ` Here is the quiz: ${quiz.question}` : "")
        : outcome.ok
        ? `Command succeeded. You earned ${xp?.awarded ?? 0} experience points.` +
          (quiz ? ` Quiz time: ${quiz.question}` : "")
        : `The command failed. Do not worry, here is the hotfix diagnostic.` +
          (quiz ? ` ${quiz.question}` : "");
      audioQueue.enqueue(spoken);
    }

    const counts = reviewCounts();
    const progressChange = {
      leveledUp: Boolean(xp?.leveledUp || checkpoint?.xp?.leveledUp),
      titleChanged: Boolean(xp?.titleChanged || checkpoint?.xp?.titleChanged),
      newBadges: [...(xp?.newBadges ?? []), ...(checkpoint?.xp?.newBadges ?? []), ...(day?.newBadges ?? [])],
      streakMilestone: Boolean(day?.newDay && (day.dayStreak === 3 || day.dayStreak === 7 || day.dayStreak === 30)),
    };

    let text: string;
    if (!shouldSurfaceCard(session.mode, dangerous)) {
      text = [
        `# 🥋 Miyagi · \`${command}\``,
        "",
        "_Focus mode: queued for review, nothing else. `quick_config` with `mode: \"ride-along\"` or `\"drill\"` when you have attention to spare._",
        checkpoint ? "\n" + renderCheckpoint(checkpoint) : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      text = renderTeachingCard({
        command,
        outcome,
        executed: Boolean(outcome),
        dryRunReason,
        concept: args.concept ?? null,
        quiz: quiz ? { quiz, token: quiz.token } : null,
        xp,
        day,
        screening,
        skillLevel: session.skillLevel,
        roadmap: activeRoadmap,
        player,
        streakLine: streakLine(),
        reviewDue: counts.due,
        surface: surfaceFor(session.mode, dangerous),
        showXpFootnote: showsXpFootnote(session.mode, progressChange),
      });
    }

    if (checkpoint && shouldSurfaceCard(session.mode, dangerous)) {
      // Above the quiz, because whether the outcome exists is the headline.
      const marker = "## ❓ Active Recall Quiz";
      const block = renderCheckpoint(checkpoint) + "\n\n";
      text = text.includes(marker) ? text.replace(marker, block + marker) : text + "\n\n" + block;
    }

    return result(text, {
      command,
      executed: Boolean(outcome),
      exit_code: outcome?.code ?? null,
      duration_ms: outcome?.durationMs ?? null,
      truncated: outcome?.truncated ?? false,
      timed_out: outcome?.timedOut ?? false,
      flagged: screening.reasons,
      blocked: screening.blocked,
      quiz_id: quiz?.token ?? "",
      xp_awarded: (xp?.awarded ?? 0) + (checkpoint?.xp?.awarded ?? 0),
      confirmed_by: confirmedBy,
      checkpoint: checkpoint
        ? {
            criterion: checkpoint.criterion,
            passed: checkpoint.result.passed,
            first_pass: checkpoint.firstPass,
            advanced: checkpoint.advanced,
          }
        : null,
      player: playerOut(),
    });
  },
);

/* ---- verify_quiz_answer -------------------------------------------- */
server.registerTool(
  "verify_quiz_answer",
  {
    title: "Verify Quiz Answer",
    annotations: {
      title: "Verify Quiz Answer",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Grade the learner's answer to a quiz. Updates streaks, XP, badges, per-command mastery and the spaced-repetition schedule. Answers the most recent question when no quiz_id is given.",
    inputSchema: {
      answer: z.string().min(1).describe("A letter (A-D) or the answer text."),
      quiz_id: z
        .string()
        .optional()
        .describe("The quiz_id printed on the card. Defaults to the most recent question."),
    },
    outputSchema: {
      correct: z.boolean(),
      quiz_id: z.string().nullable(),
      answer: z.string(),
      xp_awarded: z.number(),
      next_review_in: z.string().nullable(),
      player: z.object(PLAYER_OUT),
    },
  },
  async ({ answer, quiz_id }) => {
    const quiz = resolveQuiz(quiz_id);
    if (!quiz) {
      return result(
        [
          "## ❓ No Active Quiz",
          quiz_id
            ? `No open question matches \`${quiz_id}\`. It may have been answered already, or aged out.`
            : "Run `run_teaching_command` or `review_due_items` first. Every card ends with a question.",
        ].join("\n"),
        {
          correct: false,
          quiz_id: quiz_id ?? null,
          answer,
          xp_awarded: 0,
          next_review_in: null,
          player: playerOut(),
        },
      );
    }

    openQuizzes.delete(quiz.token);
    const given = answer.trim();
    const deterministic = grade(quiz, given);
    let correct = deterministic.correct;
    let modelReason: string | null = null;

    // Only ever upgrade. A learner who explains the idea correctly in their own
    // words should not lose to a string comparison; a model must never be able
    // to take away an answer that already matched, because that failure would
    // be invisible to the learner and impossible to argue with.
    if (!correct) {
      const verdict = await gradeProse({
        question: quiz.question,
        expected: quiz.answer,
        explanation: quiz.explanation,
        given,
      });
      if (verdict?.correct) {
        correct = true;
        modelReason = verdict.reason;
      }
    }

    // Answer latency is the cheap half of a real scheduler: a slow correct
    // answer is weaker recall than a fast one and deserves a shorter interval.
    const elapsedMs = Date.now() - Date.parse(quiz.askedAt);
    const hesitant = Number.isFinite(elapsedMs) && elapsedMs > 45_000;

    recordMastery(quiz.bin, { quiz: true, correct });
    const scheduled = gradeReviewItem("quiz", quiz.id, correct, { hesitant });
    const day = touchDay();

    if (correct) {
      player.quizStreak += 1;
      player.bestStreak = Math.max(player.bestStreak, player.quizStreak);
      // Streak multiplier caps at 2x: past that, XP stops meaning practice and
      // starts meaning "answered the easy ones in a row".
      const multiplier = 1 + Math.min(1, Math.floor(player.quizStreak / 3) * 0.25);
      const base = quiz.review ? 30 : 25; // review is worth more; it is the harder recall
      const amount = Math.round(base * multiplier);
      const xp = awardXp(amount);

      const newBadges: string[] = [];
      const badgeFor = (n: number, badge: string) => {
        if (player.quizStreak >= n && !player.badges.includes(badge)) {
          player.badges.push(badge);
          newBadges.push(badge);
        }
      };
      badgeFor(3, "Sharpshooter 🔥");
      badgeFor(5, "Deadeye 🎯");
      badgeFor(10, "Unbreakable 💎");
      if (newBadges.length) schedulePersist();

      record({
        kind: quiz.review ? "review" : "quiz",
        label: quiz.question,
        bin: quiz.bin,
        correct: true,
        detail: `Correct (${quiz.answer}), streak ${player.quizStreak}, x${multiplier}`,
        xpAwarded: amount,
      });

      audioQueue.enqueue(
        `Correct! ${quiz.explanation} You earned ${amount} experience points. Your streak is ${player.quizStreak}.` +
          (xp.leveledUp ? ` Level up! You are now a ${player.title}.` : ""),
      );

      const lines = [
        quiz.review ? "# ✅ Correct — review cleared" : "# ✅ Correct!",
        "",
        `**Answer:** ${quiz.answer}`,
        modelReason ? `**Judged by meaning:** ${modelReason}` : "",
        `**Why:** ${quiz.explanation}`,
        "",
        `+**${xp.awarded} XP** (base ${base} × ${multiplier} streak multiplier)`,
        hesitant ? "_Took a while, so this comes back sooner than a fast answer would._" : "",
        playerBlock(player, streakLine()),
      ].filter(Boolean);
      if (scheduled) {
        lines.push(
          "",
          `♻️ Scheduled again in **${relative(scheduled.dueAt).replace(/^in /, "")}** (box ${scheduled.box} of ${REVIEW_INTERVALS_DAYS.length - 1}).`,
        );
      }
      const note = xpFootnote(xp, day);
      if (note) lines.push("", note);
      if (newBadges.length) lines.push(`Badges unlocked: ${newBadges.join(" · ")}`);
      lines.push("", "_`get_next_roadmap_command` for new ground, `review_due_items` for what is due._");

      return result(lines.join("\n"), {
        correct: true,
        quiz_id: quiz.token,
        answer: given,
        xp_awarded: xp.awarded,
        next_review_in: scheduled?.dueAt ?? null,
        player: playerOut(),
      });
    }

    const lostStreak = player.quizStreak;
    player.quizStreak = 0;
    const xp = awardXp(5); // consolation XP for attempting

    record({
      kind: quiz.review ? "review" : "quiz",
      label: quiz.question,
      bin: quiz.bin,
      correct: false,
      detail: `Incorrect (answered "${given}", correct: ${quiz.answer}), streak reset from ${lostStreak}`,
      xpAwarded: 5,
    });

    audioQueue.enqueue(
      `Not quite. The correct answer is ${quiz.answer}. ${quiz.explanation} Your streak resets, but you keep 5 experience points for trying, and this one comes back in ten minutes.`,
    );

    const lines = [
      "# ❌ Not Quite",
      "",
      `**You answered:** ${given}`,
      `**Correct answer:** ${quiz.answer}`,
      `**Why:** ${quiz.explanation}`,
      "",
      `+**5 XP** for the attempt.` + (lostStreak ? ` Streak reset from **${lostStreak}** → 0.` : ""),
      playerBlock(player, streakLine()),
    ];
    if (scheduled) {
      lines.push(
        "",
        `♻️ Back in the queue **${relative(scheduled.dueAt)}** (box 0). Missing it is how it gets scheduled, not a penalty.`,
      );
    }
    const note = xpFootnote(xp, day);
    if (note) lines.push("", note);
    lines.push("", "_Say the answer out loud before you check next time. That is what makes recall stick._");

    return result(lines.join("\n"), {
      correct: false,
      quiz_id: quiz.token,
      answer: given,
      xp_awarded: 5,
      next_review_in: scheduled?.dueAt ?? null,
      player: playerOut(),
    });
  },
);

/* ---- verify_step ---------------------------------------------------- *
 * The honest scoreboard. XP used to be paid for a tool call returning, which
 * meant the server had run the command and the learner may never have touched
 * a keyboard. This runs a read-only probe and pays for the outcome.
 * ------------------------------------------------------------------ */
server.registerTool(
  "verify_step",
  {
    title: "Verify Step",
    description:
      "Check whether the current roadmap step's intended outcome actually exists on disk, using a read-only probe. Passing awards XP once and advances the step; failing explains what is missing and leaves the step where it is.",
    annotations: {
      title: "Verify Step",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      cwd: z.string().optional().describe("Directory to check in. Defaults to the server's cwd."),
    },
    outputSchema: {
      has_checkpoint: z.boolean(),
      passed: z.boolean(),
      criterion: z.string().nullable(),
      first_pass: z.boolean(),
      advanced: z.boolean(),
      xp_awarded: z.number(),
      step_index: z.number(),
      total_steps: z.number(),
      verified_steps: z.number(),
      player: z.object(PLAYER_OUT),
    },
  },
  async ({ cwd }) => {
    const lookup = currentTrack();
    const stepIndex = activeRoadmap.step_index;
    const step = stepAt(lookup.track, stepIndex);

    if (!step.verify) {
      const gradeable = verifiableSteps(lookup.track);
      const text = [
        "## 🔍 No Checkpoint For This Step",
        `Step ${stepIndex} of **${lookup.track.name}** (\`${step.command}\`) is informational: there is no outcome on disk to check.`,
        "",
        gradeable
          ? `${gradeable} of ${lookup.track.steps.length} steps in this track are checkpointed.`
          : "This track has no checkpoints at all yet.",
        "",
        "_Add one by authoring the track yourself — a `verify` command and a `describe` line is all it takes. `list_roadmaps` shows the shape._",
      ].join("\n");
      return result(text, {
        has_checkpoint: false,
        passed: false,
        criterion: null,
        first_pass: false,
        advanced: false,
        xp_awarded: 0,
        step_index: stepIndex,
        total_steps: activeRoadmap.total_steps,
        verified_steps: verifiedCount(lookup.track.name),
        player: playerOut(),
      });
    }

    const outcome = await verifyCurrentStep(cwd);
    if (!outcome) {
      // Unreachable given the guard above, but returning a shaped answer beats
      // throwing at a learner who did nothing wrong.
      return result("## 🔍 Nothing to verify", {
        has_checkpoint: false,
        passed: false,
        criterion: null,
        first_pass: false,
        advanced: false,
        xp_awarded: 0,
        step_index: stepIndex,
        total_steps: activeRoadmap.total_steps,
        verified_steps: verifiedCount(lookup.track.name),
        player: playerOut(),
      });
    }

    audioQueue.enqueue(
      outcome.result.passed
        ? outcome.firstPass
          ? `Checkpoint passed. ${outcome.criterion}. You earned ${XP_CHECKPOINT_PASS} experience points for the outcome, not the attempt.`
          : `Checkpoint still passes. Already credited.`
        : `Checkpoint not passed. ${outcome.result.reason}`,
    );

    const next = outcome.advanced ? suggestCommand() : null;
    const text = [
      `# 🔍 Checkpoint · ${lookup.track.name} step ${stepIndex}`,
      "",
      renderCheckpoint(outcome),
      "",
      `Progress: \`${roadmapBar(activeRoadmap)}\` · verified **${verifiedCount(lookup.track.name)}/${verifiableSteps(lookup.track)}** checkpointed steps`,
      outcome.result.passed ? playerBlock(player, streakLine()) : "",
      next
        ? ["", "**Next up:**", "```bash\n" + next.command + "\n```", next.criterion ? `_Passes when: ${next.criterion}._` : ""]
            .filter(Boolean)
            .join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return result(text, {
      has_checkpoint: true,
      passed: outcome.result.passed,
      criterion: outcome.criterion,
      first_pass: outcome.firstPass,
      advanced: outcome.advanced,
      xp_awarded: outcome.xp?.awarded ?? 0,
      step_index: activeRoadmap.step_index,
      total_steps: activeRoadmap.total_steps,
      verified_steps: verifiedCount(lookup.track.name),
      player: playerOut(),
    });
  },
);

/* ---- review_due_items ---------------------------------------------- *
 * The feature the exported notes already recommended and the server did not
 * have: XP that turns into retention rather than a number that goes up.
 * ------------------------------------------------------------------ */
server.registerTool(
  "review_due_items",
  {
    title: "Review Due Items",
    annotations: {
      title: "Review Due Items",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Start a spaced-repetition session: the questions and commands whose interval has elapsed, weakest and most overdue first. Answer each with verify_quiz_answer.",
    inputSchema: {
      limit: z.number().int().min(1).max(10).default(3).describe("How many questions to ask now."),
      include_commands: z
        .boolean()
        .default(true)
        .describe("Also list practised commands that are due for a re-run."),
    },
    outputSchema: {
      asked: z.array(z.object({ quiz_id: z.string(), question: z.string() })),
      commands_due: z.array(z.string()),
      due_total: z.number(),
      queue_total: z.number(),
      next_due_at: z.string().nullable(),
    },
  },
  async ({ limit, include_commands }) => {
    const counts = reviewCounts();
    const dueQuizzes = due("quiz", limit);
    const dueCommands = include_commands ? due("command", 5) : [];

    if (!dueQuizzes.length && !dueCommands.length) {
      const next = nextDueAt();
      const text = [
        "## ♻️ Nothing Due",
        counts.total
          ? `The queue holds **${counts.total}** item${counts.total === 1 ? "" : "s"}, and the next one is due **${next ? relative(next) : "later"}**.`
          : "The queue is empty. Run a few commands and answer their quizzes; anything you touch gets scheduled.",
        "",
        `Schedule: ${reviewLadder()}. A miss drops an item to box 0, not to zero progress.`,
        "",
        "_New ground is the right move right now: `get_next_roadmap_command`._",
      ].join("\n");
      return result(text, {
        asked: [],
        commands_due: [],
        due_total: 0,
        queue_total: counts.total,
        next_due_at: next,
      });
    }

    const asked: Array<{ quiz_id: string; question: string }> = [];
    const blocks: string[] = [];

    for (const item of dueQuizzes) {
      const question = questionById(item.ref);
      if (!question) continue; // A bank entry removed by an upgrade: skip, do not fail.
      const open = openQuiz(ask(question, question.bins[0] ?? "shell", {
        review: true,
        salt: `review:${quizCounter + 1}`,
      }));
      asked.push({ quiz_id: open.token, question: open.question });
      blocks.push(
        [
          `### Due ${relative(item.dueAt)} · box ${item.box} · ${item.reps} reps, ${item.lapses} lapses`,
          quizBlock({ quiz: open, token: open.token }),
        ].join("\n"),
      );
    }

    const lines = [
      "# ♻️ Spaced Repetition",
      "",
      `**${counts.due}** of ${counts.total} items are due. Asking ${asked.length} now.`,
      `Correct answers are worth 30 XP before multipliers, more than a fresh quiz, because recalling something cold is the harder skill.`,
      "",
      ...blocks,
    ];

    if (dueCommands.length) {
      lines.push(
        "",
        "## 🔁 Commands Due for a Re-run",
        "Muscle memory decays like anything else. Re-run these through `run_teaching_command`:",
        dueCommands
          .map((c) => `- \`${c.label}\` — last practised ${relative(c.lastAt)}, box ${c.box}`)
          .join("\n"),
      );
    }

    lines.push("", `_Schedule: ${reviewLadder()}._`);

    audioQueue.enqueue(
      `Review time. ${counts.due} items are due. First question: ${asked[0]?.question ?? "none"}`,
    );
    record({
      kind: "review",
      label: "Review session started",
      detail: `${asked.length} questions asked, ${counts.due} due`,
      xpAwarded: 0,
    });

    return result(lines.join("\n"), {
      asked,
      commands_due: dueCommands.map((c) => c.label),
      due_total: counts.due,
      queue_total: counts.total,
      next_due_at: nextDueAt(),
    });
  },
);

/* ---- get_user_stats ------------------------------------------------ */
server.registerTool(
  "get_user_stats",
  {
    title: "Get User Stats",
    annotations: {
      title: "Get User Stats",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "The player profile: XP, level, title, quiz and practice-day streaks, badges, roadmap position, per-command mastery, weak spots, and review queue state.",
    inputSchema: {
      speak: z.boolean().default(false).describe("Read the summary aloud."),
      include_mastery: z.boolean().default(true).describe("Include the full per-command table."),
    },
    outputSchema: {
      player: z.object(PLAYER_OUT),
      roadmap: z.object({
        category: z.string(),
        name: z.string(),
        topic: z.string(),
        step_index: z.number(),
        total_steps: z.number(),
        exists: z.boolean(),
      }),
      streak: z.object({
        day_streak: z.number(),
        best_day_streak: z.number(),
        total_days: z.number(),
        state: z.string(),
      }),
      review: z.object({ total: z.number(), due: z.number(), next_due_at: z.string().nullable() }),
      weak_spots: z.array(z.object({ bin: z.string(), rate: z.number().nullable(), attempts: z.number() })),
      lifetime: z.object({
        commands: z.number(),
        quizzes: z.number(),
        quizzes_correct: z.number(),
        days: z.number(),
      }),
    },
  },
  async ({ speak, include_mastery }) => {
    const entries = await readHistory();
    const stats = summarise(entries);
    const counts = reviewCounts();
    const next = nextDueAt();
    const lookup = currentTrack();
    const weak = weakSpots();
    const strong = strongSpots();
    const rows = masteryRows().sort((a, b) => b.attempts + b.quizAttempts - (a.attempts + a.quizAttempts));

    const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
    const nextLevelAt = player.level * 100;

    const lines = [
      "# 🏆 Player Stats",
      "",
      `**${player.title}** · Level **${player.level}**`,
      `XP: **${player.xp}** \`${xpBar(player.xp)}\` (${nextLevelAt - player.xp} to level ${player.level + 1})`,
      streakLine(),
      `Badges: ${player.badges.length ? player.badges.join(" · ") : "_none yet_"}`,
      "",
      "## 🗺️ Roadmap",
      `${activeRoadmap.category} → **${activeRoadmap.roadmap_name}**${lookup.matched ? "" : " ⚠️ (not a known track)"}`,
      `Topic: ${activeRoadmap.current_topic}`,
      `\`${roadmapBar(activeRoadmap)}\``,
      "",
      "## ♻️ Review Queue",
      `**${counts.due}** due now of ${counts.total} scheduled (${counts.dueQuiz} questions, ${counts.dueCommand} commands).`,
      next ? `Next item due ${relative(next)}.` : "_Nothing scheduled ahead._",
      "",
      "## 📈 Lifetime",
      `- Practice days: **${stats.days}** · first recorded ${relative(stats.firstAt)}`,
      `- Commands practised: **${stats.commands}**`,
      `- Quizzes: **${stats.quizzesCorrect}/${stats.quizzes}** correct${stats.quizzes ? ` (${Math.round((stats.quizzesCorrect / stats.quizzes) * 100)}%)` : ""}`,
      `- Review sessions logged: **${stats.reviews}**`,
      "",
    ];

    if (weak.length) {
      lines.push(
        "## 🎯 Weakest",
        "Enough attempts to be a real signal, and still under 80%:",
        weak.map((w) => `- \`${w.bin}\` — ${pct(w.rate)} over ${w.attempts + w.quizAttempts} attempts`).join("\n"),
        "",
      );
    }
    if (strong.length) {
      lines.push(
        "## 💪 Strongest",
        strong.map((w) => `- \`${w.bin}\` — ${pct(w.rate)}`).join("\n"),
        "",
      );
    }
    if (include_mastery && rows.length) {
      lines.push(
        "## 📊 Per-command Mastery",
        "| Command | Runs | Clean | Quizzes | Correct | Rate | Last |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...rows
          .slice(0, 25)
          .map(
            (r) =>
              `| \`${r.bin}\` | ${r.attempts} | ${r.successes} | ${r.quizAttempts} | ${r.quizCorrect} | ${pct(r.rate)} | ${relative(r.lastAt)} |`,
          ),
        "",
      );
    }

    lines.push(
      "## ⚙️ Session",
      `- Teaching depth: **${session.skillLevel}**`,
      `- Mode: **${policyFor(session.mode).label}**`,
      `- Voice: **${voice.enabled ? "on" : "off"}** @ ${voice.words_per_minute} wpm`,
      `- Profile: \`${profilePath()}\``,
      `- History: \`${historyPath()}\` (${stats.total} events)`,
      `- Checkpoints verified: **${verified.size}** across all tracks (${verifiedCount(lookup.track.name)} in this one)`,
      `- Model assistance: **${samplingAvailable() ? "available" : "not offered by this client"}**` +
        (generatedCount() ? ` · ${generatedCount()} generated questions in play (${cachedCount()} cached)` : ""),
      trackShellWarning(lookup.track) ? `- ⚠️ ${trackShellWarning(lookup.track)}` : "",
      "",
      "## 🎖️ Title Ladder",
      ...titleLadder().map(
        (t) => `- ${player.level >= t.minLevel ? "✅" : "🔒"} **${t.title}** · level ${t.minLevel}+`,
      ),
    );

    if (speak) {
      audioQueue.enqueue(
        `You are a ${player.title}, level ${player.level}, with ${player.xp} experience points. ` +
          `Your practice streak is ${streak.dayStreak} days, and ${counts.due} items are due for review.` +
          (weak.length ? ` Your weakest command right now is ${weak[0].bin}.` : ""),
      );
    }

    return result(lines.join("\n"), {
      player: playerOut(),
      roadmap: {
        category: activeRoadmap.category,
        name: activeRoadmap.roadmap_name,
        topic: activeRoadmap.current_topic,
        step_index: activeRoadmap.step_index,
        total_steps: activeRoadmap.total_steps,
        exists: lookup.matched,
      },
      streak: {
        day_streak: streak.dayStreak,
        best_day_streak: streak.bestDayStreak,
        total_days: streak.totalDays,
        state: streakState(),
      },
      review: { total: counts.total, due: counts.due, next_due_at: next },
      weak_spots: weak.map((w) => ({ bin: w.bin, rate: w.rate, attempts: w.attempts + w.quizAttempts })),
      lifetime: {
        commands: stats.commands,
        quizzes: stats.quizzes,
        quizzes_correct: stats.quizzesCorrect,
        days: stats.days,
      },
    });
  },
);

/* ---- export_roadmap_notes ------------------------------------------ */
server.registerTool(
  "export_roadmap_notes",
  {
    title: "Export Roadmap Notes",
    annotations: {
      title: "Export Roadmap Notes",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Write a ROADMAP_PROGRESS.md review sheet: roadmap position, player stats, mastery, what is due for review, and the practice log. Reads the durable history, so it is correct after a restart.",
    inputSchema: {
      output_path: z
        .string()
        .default("ROADMAP_PROGRESS.md")
        .describe("File path (relative paths resolve against the server's cwd)."),
      append: z.boolean().default(false).describe("Append instead of overwriting."),
      scope: z
        .enum(["session", "lifetime"])
        .default("lifetime")
        .describe("Log this session only, or everything on record."),
    },
  },
  async ({ output_path, append, scope }) => {
    const target = path.isAbsolute(output_path)
      ? output_path
      : path.resolve(process.cwd(), output_path);

    await flushHistory();
    const entries = await readHistory(
      scope === "session" ? { since: session.startedAt } : {},
    );
    const stats = summarise(entries);
    const commands = entries.filter((h) => h.kind === "command");
    const quizzes = entries.filter((h) => h.kind === "quiz" || h.kind === "review");
    const counts = reviewCounts();
    const weak = weakSpots();
    const next = suggestCommand();

    const md = [
      "# 🗺️ Roadmap Progress",
      "",
      `> Generated by **miyagi ${VERSION}** on ${new Date().toISOString()}`,
      `> Scope: **${scope}**${scope === "session" ? ` (session started ${session.startedAt})` : ""}`,
      "",
      "## Current Position",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Category | ${activeRoadmap.category} |`,
      `| Roadmap | ${activeRoadmap.roadmap_name} |`,
      `| Topic | ${activeRoadmap.current_topic} |`,
      `| Step | ${activeRoadmap.step_index} / ${activeRoadmap.total_steps} |`,
      `| Teaching depth | ${session.skillLevel} |`,
      "",
      "## Player",
      "",
      `- **Title:** ${player.title}`,
      `- **Level:** ${player.level}`,
      `- **XP:** ${player.xp}`,
      `- **Quiz streak:** ${player.quizStreak} (best ${player.bestStreak})`,
      `- **Practice days:** ${streak.dayStreak} in a row, ${streak.totalDays} total (best ${streak.bestDayStreak})`,
      `- **Badges:** ${player.badges.length ? player.badges.join(", ") : "none yet"}`,
      `- **Quiz accuracy (${scope}):** ${stats.quizzes ? `${stats.quizzesCorrect}/${stats.quizzes} (${Math.round((stats.quizzesCorrect / stats.quizzes) * 100)}%)` : "no quizzes answered"}`,
      "",
      "## Due for Review",
      "",
      counts.due
        ? due(undefined, 20)
            .map((r) => `- ${r.kind === "quiz" ? "❓" : "🔁"} ${r.label} _(box ${r.box}, ${r.lapses} lapses)_`)
            .join("\n")
        : "_Nothing due. " + (counts.total ? `Next item ${relative(nextDueAt())}.` : "Queue is empty.") + "_",
      "",
      "## Weak Spots",
      "",
      weak.length
        ? weak
            .map(
              (w) =>
                `- \`${w.bin}\` — ${Math.round((w.rate ?? 0) * 100)}% over ${w.attempts + w.quizAttempts} attempts`,
            )
            .join("\n")
        : "_Not enough evidence yet. Three attempts at a command before it can be called a weakness._",
      "",
      "## Commands Practised",
      "",
      commands.length
        ? commands
            .map(
              (c) =>
                `- \`${c.label}\`: ${c.detail}${c.xpAwarded ? ` _(+${c.xpAwarded} XP)_` : ""} — ${c.day}`,
            )
            .join("\n")
        : "_No commands recorded in this scope._",
      "",
      "## Quiz Log",
      "",
      quizzes.length
        ? quizzes.map((qz) => `- ${qz.correct ? "✅" : "❌"} ${qz.label}\n  - ${qz.detail}`).join("\n")
        : "_No quizzes answered in this scope._",
      "",
      "## Next Up",
      "",
      "```bash\n" + next.command + "\n```",
      "",
      "---",
      `_Review this file before your next session. ${counts.due} item${counts.due === 1 ? "" : "s"} due; spaced repetition is where the XP turns into skill._`,
      "",
    ].join("\n");

    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (append) {
        await fs.appendFile(target, "\n\n" + md, "utf8");
      } else {
        await fs.writeFile(target, md, "utf8");
      }
    } catch (err) {
      return textResult(
        [
          "### 🛠️ Tutor Hotfix Diagnostic",
          `Could not write **${target}**: ${(err as Error).message}`,
          "",
          "1. Check the directory exists and is writable (`ls -ld`).",
          "2. Try an absolute path inside your home directory.",
          "3. The server's cwd is: `" + process.cwd() + "`",
        ].join("\n"),
      );
    }

    await persistNow();
    audioQueue.enqueue(
      `Notes exported. ${stats.commands} commands and ${stats.quizzes} quiz questions on record, across ${stats.days} days of practice.`,
    );

    return textResult(
      [
        "## 📝 Notes Exported",
        `Wrote **${target}** (${append ? "appended" : "overwritten"}, ${md.length} bytes, scope **${scope}**).`,
        "",
        `- Commands practised: **${stats.commands}**`,
        `- Quizzes: **${stats.quizzesCorrect}/${stats.quizzes}** correct`,
        `- Practice days on record: **${stats.days}**`,
        `- Due for review: **${counts.due}** of ${counts.total}`,
        `- Ending as: **${player.title}**, level **${player.level}**, ${player.xp} XP`,
      ].join("\n"),
    );
  },
);

/* ------------------------------------------------------------------ *
 * Resources
 *
 * Everything above is also readable without a tool call, so a client can
 * render progress in a sidebar rather than spending a turn asking for it.
 * ------------------------------------------------------------------ */

const json = (uri: string, data: unknown) => ({
  contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
});

const markdown = (uri: string, text: string) => ({
  contents: [{ uri, mimeType: "text/markdown", text }],
});

server.registerResource(
  "profile",
  "miyagi://profile",
  {
    title: "Player profile",
    description: "XP, level, badges, streaks, mastery and the review queue, as saved on disk.",
    mimeType: "application/json",
  },
  async (uri) => json(uri.href, snapshot()),
);

server.registerResource(
  "roadmap",
  "miyagi://roadmap",
  {
    title: "Active roadmap",
    description: "The current track, position, and the next command in the sequence.",
    mimeType: "application/json",
  },
  async (uri) => {
    const lookup = currentTrack();
    const next = suggestCommand();
    return json(uri.href, {
      category: activeRoadmap.category,
      name: activeRoadmap.roadmap_name,
      exists: lookup.matched,
      topic: activeRoadmap.current_topic,
      step_index: activeRoadmap.step_index,
      total_steps: activeRoadmap.total_steps,
      next_command: next.command,
      steps: lookup.track.steps,
    });
  },
);

server.registerResource(
  "review-queue",
  "miyagi://review",
  {
    title: "Review queue",
    description: "Every scheduled item with its box, due date and lapse count.",
    mimeType: "application/json",
  },
  async (uri) =>
    json(uri.href, {
      counts: reviewCounts(),
      next_due_at: nextDueAt(),
      intervals_days: REVIEW_INTERVALS_DAYS,
      items: review.map((r) => ({ ...r, due_now: isDue(r) })),
    }),
);

server.registerResource(
  "history",
  "miyagi://history",
  {
    title: "Practice history",
    description: "The durable append-only practice log, most recent 200 events.",
    mimeType: "application/json",
  },
  async (uri) => {
    const entries = await readHistory({ limit: 200 });
    return json(uri.href, { stats: summarise(entries), entries });
  },
);

server.registerResource(
  "insights",
  "miyagi://insights",
  {
    title: "Learning insights",
    description:
      "Whether this is working: practice cadence by week, first-sight versus review accuracy, and checkpoint pass rates.",
    mimeType: "application/json",
  },
  async (uri) => json(uri.href, analyse(await readHistory())),
);

server.registerResource(
  "getting-started",
  "miyagi://getting-started",
  {
    title: "Getting started",
    description: "How the tutor works, and the order to do things in.",
    mimeType: "text/markdown",
  },
  async (uri) =>
    markdown(
      uri.href,
      [
        "# Getting started with miyagi",
        "",
        "**You run the commands.** This server drills, corrects, keeps score, and never does the work for you.",
        "",
        "## The loop",
        "1. **`list_roadmaps`** — pick a track. Author your own by dropping JSON in `" + roadmapsDir() + "`.",
        "2. **`get_next_roadmap_command`** — the next command, with the reason it comes next and the checkpoint it has to pass.",
        "3. **Run it yourself**, or through `run_teaching_command`. Default mode is ride-along; `quick_config` with `mode: \"drill\"` is the full card, quiz, and voice.",
        "4. **`verify_step`** — a read-only probe confirms the outcome exists on your machine. This is where the XP is: " +
          `${XP_CHECKPOINT_PASS} for a verified outcome against up to ${XP_COMMAND_ATTEMPT} for an attempt (less in quieter modes).`,
        "5. **`review_due_items`** — whatever you got wrong comes back on a spacing ladder until it sticks.",
        "",
        "## What is scored",
        "- **Verified outcomes**, once each. Re-passing a checkpoint pays nothing.",
        "- **Quiz answers**, with a streak multiplier. Review answers pay more than first sights.",
        "- **Practice days**, as a separate consecutive-day streak.",
        "",
        "## Safety",
        "Catastrophic commands never run. Destructive ones are explained and dry-run until you personally confirm them — where your client supports it, that means typing a word into a prompt, not a model setting a flag.",
        "",
        "## Where things live",
        "- Profile: `" + profilePath() + "`",
        "- Practice log: `" + historyPath() + "`",
        "- Your tracks: `" + roadmapsDir() + "`",
        "",
        "Run `npx miyagi-mcp --doctor` if anything looks wrong.",
      ].join("\n"),
    ),
);

server.registerResource(
  "roadmap-track",
  new ResourceTemplate("miyagi://roadmaps/{name}", {
    list: async () => ({
      resources: allTracks().map((t) => ({
        uri: `miyagi://roadmaps/${encodeURIComponent(t.name)}`,
        name: t.name,
        description: `${t.category} · ${t.steps.length} steps · ${t.source}`,
        mimeType: "text/markdown",
      })),
    }),
    complete: {
      // Track-name completion, so a client can offer the real list rather than
      // letting someone invent a name that silently falls back.
      name: (value) =>
        trackNames().filter((n) => n.toLowerCase().includes(String(value).toLowerCase())),
    },
  }),
  {
    title: "Roadmap track",
    description: "One track's full step list, as markdown.",
    mimeType: "text/markdown",
  },
  async (uri, variables) => {
    const wanted = decodeURIComponent(String(variables.name ?? ""));
    const lookup = findTrack(wanted);
    if (!lookup.matched) {
      return markdown(
        uri.href,
        [
          `# No track called "${wanted}"`,
          "",
          "Available tracks:",
          ...trackNames().map((n) => `- ${n}`),
        ].join("\n"),
      );
    }
    const t = lookup.track;
    return markdown(
      uri.href,
      [
        `# ${t.name}`,
        "",
        `**${t.category}** · ${t.steps.length} steps · ${t.source}`,
        "",
        t.description,
        "",
        ...t.steps.map(
          (s, i) =>
            `${i + 1}. **${s.topic}**\n   \`\`\`bash\n   ${s.command}\n   \`\`\`${s.note ? `\n   > ${s.note}` : ""}`,
        ),
      ].join("\n"),
    );
  },
);

/* ------------------------------------------------------------------ *
 * Prompts
 *
 * A learner should not have to know tool names to start. These are the three
 * things anyone actually wants: drill me, test what I have forgotten, and
 * explain what just went wrong.
 * ------------------------------------------------------------------ */

const userMessage = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

server.registerPrompt(
  "drill",
  {
    title: "Drill me",
    description: "Start a practice session on a track, one command at a time.",
    argsSchema: {
      roadmap: completable(
        z.string().optional().describe("Track to drill. Defaults to the active one."),
        (value) => trackNames().filter((n) => n.toLowerCase().includes(String(value ?? "").toLowerCase())),
      ),
      level: z.enum(["Junior", "Mid", "Senior"]).optional().describe("Teaching depth."),
    },
  },
  ({ roadmap, level }) =>
    userMessage(
      [
        "Be my coding tutor for this session, using the miyagi tools.",
        roadmap ? `Track: "${roadmap}" (verify it exists with list_roadmaps first).` : "Use my active roadmap.",
        level ? `Set my teaching depth to ${level} with quick_config.` : "",
        "",
        "Loop, one step at a time:",
        "1. Call review_due_items first. Anything due gets cleared before new ground.",
        "2. Call get_next_roadmap_command and show me the command with the reason it comes next.",
        "3. Wait for me to say I have run it, or run it through run_teaching_command if I ask you to.",
        "4. Teach from the card's tutor brief, then ask me the quiz and grade it with verify_quiz_answer.",
        "",
        "Rules: I run the commands. Do not answer the quiz for me, do not skip ahead, and stop after each step until I respond.",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
);

server.registerPrompt(
  "review",
  {
    title: "Review what I've forgotten",
    description: "Run a spaced-repetition session over everything that is due.",
    argsSchema: {
      count: z.string().optional().describe("How many questions to ask (default 3)."),
    },
  },
  ({ count }) =>
    userMessage(
      [
        `Run a spaced-repetition session with miyagi. Call review_due_items with limit ${count ?? 3}.`,
        "Ask me each question one at a time, wait for my answer, and grade it with verify_quiz_answer using the quiz_id from the card.",
        "After the questions, call get_user_stats and tell me plainly which commands I am weakest on and what I should drill next.",
        "Do not give me the answers before I attempt them.",
      ].join("\n"),
    ),
);

server.registerPrompt(
  "explain-last-error",
  {
    title: "Explain what just went wrong",
    description: "Teach from a failing command instead of just fixing it.",
    argsSchema: {
      command: z.string().optional().describe("The command that failed, if you have it."),
      error: z.string().optional().describe("The error output you saw."),
    },
  },
  ({ command, error }) =>
    userMessage(
      [
        "Something I ran failed and I want to understand it, not just have it fixed.",
        command ? `Command: \`${command}\`` : "Ask me for the exact command if I have not given it.",
        error ? `Error:\n${error}` : "",
        "",
        `Use run_teaching_command with dry_run: true${command ? "" : " once you have the command"} to get the teaching card and the hotfix diagnostic, then walk me down the troubleshooting ladder one rung at a time.`,
        "Tell me what to change and why, but let me run it. Finish with the card's quiz.",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
);

server.registerPrompt(
  "progress",
  {
    title: "Where am I?",
    description: "Read back progress, weak spots and what to do next.",
    argsSchema: {},
  },
  () =>
    userMessage(
      [
        "Call get_user_stats and read the miyagi://review resource, then tell me:",
        "- where I am on the roadmap and what is due for review,",
        "- which commands I am measurably weakest on,",
        "- and the single next thing I should do, with the command to run.",
        "Be honest about thin evidence: do not call something a weakness off two attempts.",
      ].join("\n"),
    ),
);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

process.on("uncaughtException", (e) => log("uncaughtException:", e));
process.on("unhandledRejection", (e) => log("unhandledRejection:", e));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    audioQueue.dispose();
    void persistNow().finally(() => process.exit(0));
  });
}

async function main(): Promise<void> {
  const restored = await hydrate();
  if (restored) markReturning();
  const tracks = await loadUserTracks();
  const cachedQuestions = await loadGeneratedCache();

  attachSampling(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Tell subscribed clients when saved state moves, so a sidebar reading the
  // profile is not showing a level the learner passed twenty minutes ago.
  onPersist(() => {
    for (const uri of ["miyagi://profile", "miyagi://review", "miyagi://roadmap", "miyagi://insights"]) {
      void server.server.sendResourceUpdated({ uri }).catch(() => {});
    }
  });

  log(
    restored
      ? `ready on stdio. Restored ${player.title}, level ${player.level}, ${player.xp} XP from ${profilePath()}`
      : `ready on stdio. New profile; progress will be saved to ${profilePath()}`,
  );
  log(
    `platform ${os.platform()}, cwd ${process.cwd()}, ${allTracks().length} tracks ` +
      `(${tracks.loaded} user-authored from ${tracks.dir}), ${reviewCounts().due} items due for review`,
  );
  if (tracks.skipped.length) log("skipped roadmap files:", tracks.skipped.join(", "));
  log(
    `shell ${hostShell()} via ${execShellName()}, ${cachedQuestions} cached generated questions, ` +
      `${verified.size} verified checkpoints`,
  );
  log(`profile dir ${profileDir()}`);
  const escape = posixEscapeHatch();
  if (escape) log(escape);
}

/**
 * Only boot when run as a program. Without this guard, importing the module
 * (a test, a script) would connect a stdio transport and hang.
 *
 * Symlinks have to be resolved on both sides. npm installs a bin as a symlink
 * (`node_modules/.bin/miyagi-mcp` into the package), so `process.argv[1]` is
 * the link while `import.meta.url` is the real file. Comparing the two without
 * realpath makes this false for every `npx` and global install, and the server
 * exits silently having served nothing.
 */
function canonicalPath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

const entryPoint = process.argv[1] ? canonicalPath(process.argv[1]) : "";
const invokedDirectly =
  entryPoint !== "" && entryPoint === canonicalPath(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  // `--doctor` is not MCP: there is no transport, so stdout is a person's
  // terminal rather than a frame stream, and printing there is correct.
  if (process.argv.slice(2).some((a) => a === "--doctor" || a === "doctor")) {
    runDoctor()
      .then((code) => process.exit(code))
      .catch((err) => {
        log("doctor failed:", err);
        process.exit(1);
      });
  } else if (process.argv.slice(2).some((a) => a === "--version" || a === "-v")) {
    console.log(VERSION);
  } else {
    main().catch((err) => {
      log("fatal:", err);
      process.exit(1);
    });
  }
}
