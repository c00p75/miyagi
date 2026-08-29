/**
 * Card rendering.
 *
 * Every tool returns markdown a human can read and a model can teach from.
 * The rendering lives here so the tool handlers stay about state and the
 * layout is changeable in one place.
 */

import {
  binOf,
  conceptFor,
  contentFor,
  diagramFor,
  docsFor,
  lensFor,
  pitfallsFor,
  teachingBrief,
  type SkillLevel,
} from "./content.js";
import { forDisplay, STDERR_DISPLAY_LIMIT, STDOUT_DISPLAY_LIMIT, type ExecOutcome } from "./run.js";
import type { AskedQuiz } from "./quiz.js";
import type { XpResult, DayResult, Roadmap, Player } from "./state.js";
import type { Screening } from "./safety.js";
import { REVIEW_INTERVALS_DAYS } from "./profile.js";
import type { SurfaceSections } from "./modes.js";

export function xpBar(xp: number): string {
  const into = xp % 100;
  const filled = Math.round(into / 10);
  return `[${"█".repeat(filled)}${"░".repeat(10 - filled)}] ${into}/100`;
}

export function roadmapBar(roadmap: Roadmap): string {
  const total = Math.max(1, roadmap.total_steps);
  const done = Math.min(total, Math.max(0, roadmap.step_index));
  const filled = Math.round((done / total) * 12);
  return `[${"█".repeat(filled)}${"░".repeat(12 - filled)}] step ${done}/${total}`;
}

export function relative(iso: string | null): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (Math.abs(mins) < 1) return "just now";
  if (mins > 0) {
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  }
  const ahead = -mins;
  if (ahead < 60) return `in ${ahead}m`;
  if (ahead < 1440) return `in ${Math.round(ahead / 60)}h`;
  return `in ${Math.round(ahead / 1440)}d`;
}

export function playerBlock(player: Player, streakLine: string): string {
  return (
    `**${player.title}** · Level **${player.level}** · ${player.xp} XP  \n` +
    `\`${xpBar(player.xp)}\`  \n` +
    streakLine +
    (player.badges.length ? `  \nBadges: ${player.badges.join(" · ")}` : "")
  );
}

export function xpFootnote(xp: XpResult | null, day: DayResult | null): string | null {
  if (!xp && !day?.newDay) return null;
  const bits: string[] = [];
  if (xp) bits.push(`+${xp.awarded} XP`);
  if (xp?.leveledUp) bits.push(`**LEVEL UP → ${xp.newLevel}**`);
  if (xp?.titleChanged) bits.push(`new title: **${xp.newTitle}**`);
  if (day?.newDay) {
    bits.push(
      day.extended
        ? `day streak **${day.dayStreak}** 📅`
        : day.broken
        ? `new day streak (a ${day.broken}-day run lapsed)`
        : `day **1** of a new streak`,
    );
  }
  const badges = [...(xp?.newBadges ?? []), ...(day?.newBadges ?? [])];
  if (badges.length) bits.push(`unlocked: ${badges.join(", ")}`);
  return bits.length ? `> ${bits.join(" · ")}` : null;
}

export interface QuizAskingView {
  quiz: AskedQuiz;
  token: string;
}

export function quizBlock(view: QuizAskingView): string {
  const lines = [
    view.quiz.review ? "## ♻️ Spaced Repetition" : "## ❓ Active Recall Quiz",
    `**${view.quiz.question}**`,
    view.quiz.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join("\n"),
    "",
    `_Answer with \`verify_quiz_answer\` (quiz_id: \`${view.token}\`). Say it out loud before you check._`,
  ];
  return lines.join("\n");
}

export interface TeachingCardArgs {
  command: string;
  outcome: ExecOutcome | null;
  executed: boolean;
  dryRunReason: string | null;
  concept: string | null;
  quiz: QuizAskingView | null;
  xp: XpResult | null;
  day: DayResult | null;
  screening: Screening;
  skillLevel: SkillLevel;
  roadmap: Roadmap;
  player: Player;
  streakLine: string;
  reviewDue: number;
  surface?: SurfaceSections;
  showXpFootnote?: boolean;
}

const FULL_SURFACE: SurfaceSections = {
  roadmap: true,
  what: true,
  how: true,
  tradeoffs: "all",
  diagram: true,
  pitfalls: true,
  docs: true,
  xpFootnote: "always",
};

function tradeoffLine(text: string, count: SurfaceSections["tradeoffs"]): string | null {
  if (count === 0) return null;
  if (count === "all") return text;
  const first = text.split(/(?<=\.)\s+/)[0];
  return first || text;
}

export function renderTeachingCard(a: TeachingCardArgs): string {
  const lens = lensFor(a.command, a.skillLevel);
  const concept = a.concept ?? conceptFor(a.command);
  const surface = a.surface ?? FULL_SURFACE;
  const out: string[] = [];

  out.push(`# 🥋 Miyagi · \`${a.command}\``);
  out.push("");
  if (surface.roadmap) {
    out.push("## 🗺️ Roadmap Alignment");
    out.push(
      `**${a.roadmap.category} → ${a.roadmap.roadmap_name}**  \n` +
        `Topic: **${a.roadmap.current_topic}**  \n` +
        `Progress: \`${roadmapBar(a.roadmap)}\``,
    );
    out.push("");
  }

  if (a.screening.reasons.length) {
    out.push("## ⚠️ Safety Screen");
    out.push(a.screening.reasons.map((r) => `- Flagged: **${r}**`).join("\n"));
    if (a.screening.blocked) {
      out.push(
        "\n**Not executed, and not executable through this tool.** This shape is irreversible or " +
          "destroys the evidence of what happened. If you genuinely need it, run it in your own " +
          "terminal where you own the consequence.",
      );
    } else if (!a.executed) {
      out.push(
        "\n_Explained but not executed._ Pass `confirm_dangerous: true` to run it, once you have " +
          "read the command and know what it will change.",
      );
    } else {
      out.push("\n_Executed with explicit confirmation._");
    }
    out.push("");
  }

  const outcomeKind = !a.executed ? "dry-run" : a.outcome?.ok ? "success" : "failure";
  const stdoutExcerpt = a.outcome ? forDisplay(a.outcome.stdout, STDOUT_DISPLAY_LIMIT) : { text: "", trimmed: false };

  if (surface.what || surface.how || surface.tradeoffs !== 0) {
    out.push(`## 🧠 Concept: ${concept}`);
    out.push(`**Audience level: ${a.skillLevel}**`);
    if (surface.what) out.push(`- **What:** ${lens.what}`);
    if (surface.how) out.push(`- **How:** ${lens.how}`);
    const trade = tradeoffLine(lens.tradeoffs, surface.tradeoffs);
    if (trade) out.push(`- **Trade-offs:** ${trade}`);
    out.push("");
    out.push(
      teachingBrief({
        command: a.command,
        level: a.skillLevel,
        topic: a.roadmap.current_topic,
        track: a.roadmap.roadmap_name,
        hasContent: hasAuthoredContent(a.command),
        outcome: outcomeKind,
        stdoutExcerpt: stdoutExcerpt.text,
      }),
    );
    out.push("");
  }

  out.push("## 🖥️ Execution");
  if (!a.executed || !a.outcome) {
    out.push(
      `**Mode:** \`DRY RUN\`${a.dryRunReason ? ` — ${a.dryRunReason}` : ""}. The command was parsed and explained but not run.`,
    );
    out.push("Copy-paste to run it yourself when ready:");
    out.push("```bash\n" + a.command + "\n```");
  } else if (a.outcome.ok) {
    out.push(`**Mode:** \`EXECUTED\` in ${a.outcome.durationMs} ms. Exit code \`0\` ✅`);
    out.push("```\n" + (stdoutExcerpt.text || "(no stdout)") + "\n```");
    if (stdoutExcerpt.trimmed || a.outcome.truncated) {
      out.push(
        a.outcome.truncated
          ? "> ⚠️ **Output was truncated by the 4 MB cap**, so this is not the whole story. Narrow the command (`head`, `--tail`, a tighter glob) and run it again."
          : `> ⚠️ Output shown is the first ${STDOUT_DISPLAY_LIMIT} characters; there was more.`,
      );
    }
    const err = forDisplay(a.outcome.stderr, STDERR_DISPLAY_LIMIT);
    if (err.text) {
      out.push("_stderr (non-fatal):_\n```\n" + err.text + "\n```");
    }
  } else {
    out.push(hotfixDiagnostic(a.command, a.outcome));
  }
  out.push("");

  if (surface.diagram) {
    out.push("## 📊 Mental Model");
    out.push("```mermaid\n" + diagramFor(a.command, a.outcome?.ok ?? true, a.roadmap.current_topic) + "\n```");
    out.push("");
  }

  if (surface.pitfalls) {
    out.push("## 🕳️ Common Pitfalls");
    out.push(pitfallsFor(a.command).map((p) => `- ${p}`).join("\n"));
    out.push("");
  }

  if (surface.docs) {
    out.push("## 📚 Curated Docs");
    out.push(docsFor(a.command).map((d) => `- [${d.label}](${d.url})`).join("\n"));
    out.push("");
  }

  if (a.quiz) {
    out.push(quizBlock(a.quiz));
    out.push("");
  }

  const footnoteWanted = a.showXpFootnote ?? surface.xpFootnote === "always";
  if (footnoteWanted) {
    out.push("## 🏆 Player");
    out.push(playerBlock(a.player, a.streakLine));
    const note = xpFootnote(a.xp, a.day);
    if (note) out.push(note);
  }
  if (a.reviewDue > 0) {
    out.push(
      `\n_${a.reviewDue} item${a.reviewDue === 1 ? "" : "s"} due for review. \`review_due_items\` is worth more XP than new ground right now._`,
    );
  }

  return out.join("\n");
}

/** Whether the Concept block above is authored prose or the generic shell model. */
function hasAuthoredContent(command: string): boolean {
  return contentFor(command).content !== null;
}

export function hotfixDiagnostic(command: string, outcome: ExecOutcome): string {
  const bin = binOf(command);
  const blob = `${outcome.stderr}\n${outcome.errorMessage ?? ""}`.toLowerCase();
  const tips: string[] = [];

  if (blob.includes("command not found") || outcome.code === 127) {
    tips.push(`\`${bin}\` is not on your PATH. Install it, or check with \`command -v ${bin}\`.`);
  }
  if (blob.includes("permission denied")) {
    tips.push(
      "Permission denied. Check the file with `ls -l` and the directory with `ls -ld`; creating or deleting needs write on the *directory*. Prefer fixing ownership over reaching for `sudo`.",
    );
  }
  if (blob.includes("no such file or directory")) {
    tips.push("A path does not exist. Run `pwd` and `ls` to confirm where you actually are.");
  }
  if (outcome.timedOut) {
    tips.push(
      "The command exceeded the tutor timeout. Long-running or interactive commands belong in your own terminal; raise `timeout_ms` only if you know it finishes.",
    );
  }
  if (outcome.truncated) {
    tips.push("Output hit the size cap. Pipe through `head`, or narrow the query, then re-run.");
  }
  if (blob.includes("unexpected") || blob.includes("syntax error")) {
    tips.push("Shell syntax error, usually an unbalanced quote, paren or stray backslash.");
  }
  if (blob.includes("eacces") || blob.includes("eperm")) {
    tips.push("The OS refused the operation. You may be writing outside your user-owned directories.");
  }
  if (blob.includes("address already in use") || blob.includes("eaddrinuse")) {
    tips.push("Something already holds that port. Find it with `lsof -nP -iTCP -sTCP:LISTEN` before killing anything.");
  }
  if (blob.includes("connection refused") || blob.includes("econnrefused")) {
    tips.push("Nothing is listening on that address and port. Confirm the service is up, and that you are pointed at the right host.");
  }
  if (tips.length === 0) {
    tips.push(
      `Exit code ${outcome.code ?? "unknown"}${outcome.signal ? ` (signal ${outcome.signal})` : ""}. Read the stderr text above literally, because it usually names the failing argument.`,
    );
    tips.push(`Re-read the contract with \`${bin} --help\` or \`man ${bin}\`.`);
  }
  tips.push("Reproduce in isolation: run the smallest version of the command, then add flags back one at a time.");

  const err = forDisplay(outcome.stderr, STDERR_DISPLAY_LIMIT);
  return [
    "### 🛠️ Tutor Hotfix Diagnostic",
    `**Command:** \`${command}\``,
    `**Exit code:** \`${outcome.code ?? "n/a"}\`${outcome.signal ? ` · signal \`${outcome.signal}\`` : ""} · ${outcome.durationMs} ms`,
    err.text ? "**stderr:**\n```\n" + err.text + "\n```" : "",
    outcome.errorMessage ? `**Runtime error:** ${outcome.errorMessage}` : "",
    "",
    "**Troubleshooting ladder:**",
    ...tips.map((t, i) => `${i + 1}. ${t}`),
    "",
    "> Failures are curriculum. Nothing crashed. Read the diagnosis, change one variable, try again.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The schedule, printed once so a learner knows what "box 3" buys them. */
export function reviewLadder(): string {
  return REVIEW_INTERVALS_DAYS.map((d, i) =>
    `box ${i}: ${d === 0 ? "10 minutes" : d === 1 ? "1 day" : `${d} days`}`,
  ).join(" → ");
}
