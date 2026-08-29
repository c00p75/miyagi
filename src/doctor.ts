/**
 * `miyagi --doctor`.
 *
 * A stdio MCP server is a bad place to debug an install: everything the user
 * would want to see is either invisible or would corrupt the protocol if
 * printed. So there is a non-MCP mode that checks the things that actually go
 * wrong — an unwritable profile, a corrupt track file, no speech binary, a
 * POSIX track on a PowerShell host — and says so in plain text on stdout,
 * where a person can read it.
 *
 * This is the one place in the codebase allowed to write to stdout, because in
 * this mode there is no transport to corrupt.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { VERSION } from "./version.js";
import { loadProfile, profileDir, profilePath } from "./profile.js";
import { historyPath, readHistory, summarise } from "./history.js";
import { allTracks, loadUserTracks, roadmapsDir, verifiableSteps } from "./roadmaps.js";
import { hostShell, execShellName } from "./platform.js";
import { generatedCachePath, loadGeneratedCache } from "./sampling.js";
import { QUIZ_BANK } from "./quiz.js";

const exec = promisify(execCb);

type Status = "ok" | "warn" | "fail";

interface Check {
  name: string;
  status: Status;
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

const ICON: Record<Status, string> = { ok: "✅", warn: "⚠️ ", fail: "❌" };

async function commandExists(cmd: string): Promise<boolean> {
  try {
    if (os.platform() === "win32") {
      await exec(`where ${cmd}`);
    } else {
      await exec(`command -v ${cmd}`, { shell: "/bin/sh" });
    }
    return true;
  } catch {
    return false;
  }
}

async function checkNode(): Promise<Check> {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 18
    ? { name: "Node version", status: "ok", detail: `${process.version}` }
    : {
        name: "Node version",
        status: "fail",
        detail: `${process.version} is below the supported floor`,
        fix: "Install Node 18 or newer.",
      };
}

async function checkProfileDir(): Promise<Check> {
  const dir = profileDir();
  const probe = path.join(dir, `.doctor-${process.pid}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, "x", "utf8");
    await fs.rm(probe, { force: true });
    return { name: "Profile directory", status: "ok", detail: `${dir} is writable` };
  } catch (err) {
    return {
      name: "Profile directory",
      status: "fail",
      detail: `${dir} is not writable (${(err as Error).message})`,
      fix: "Fix the permissions, or set MIYAGI_HOME to a directory you own. Progress is session-only until then.",
    };
  }
}

async function checkProfile(): Promise<Check> {
  let raw: string;
  try {
    raw = await fs.readFile(profilePath(), "utf8");
  } catch {
    return {
      name: "Saved profile",
      status: "ok",
      detail: "none yet; a fresh profile will be created on first use",
    };
  }
  const parsed = await loadProfile();
  if (!parsed) {
    return {
      name: "Saved profile",
      status: "warn",
      detail: `${profilePath()} exists (${raw.length} bytes) but could not be used, so it will be replaced by a fresh one`,
      fix: "That is by design for a corrupt file. If you hand-edited it, check the JSON and the version field.",
    };
  }
  return {
    name: "Saved profile",
    status: "ok",
    detail: `v${parsed.version}: level ${parsed.player.level}, ${parsed.player.xp} XP, ${parsed.review.length} scheduled items, ${Object.keys(parsed.verified).length} verified checkpoints`,
  };
}

async function checkHistory(): Promise<Check> {
  const entries = await readHistory();
  const stats = summarise(entries);
  if (!entries.length) {
    return { name: "Practice history", status: "ok", detail: "empty; nothing recorded yet" };
  }
  return {
    name: "Practice history",
    status: "ok",
    detail: `${stats.total} events across ${stats.days} days in ${historyPath()}`,
  };
}

async function checkTracks(): Promise<Check[]> {
  const report = await loadUserTracks();
  const tracks = allTracks();
  const checks: Check[] = [
    {
      name: "Roadmap tracks",
      status: "ok",
      detail: `${tracks.length} tracks (${report.loaded} user-authored from ${roadmapsDir()}), ${tracks.reduce((n, t) => n + verifiableSteps(t), 0)} checkpointed steps`,
    },
  ];
  if (report.skipped.length) {
    checks.push({
      name: "Track files skipped",
      status: "warn",
      detail: report.skipped.join("; "),
      fix: "Fix or remove those files. A skipped track is silently absent from suggestions otherwise.",
    });
  }
  const host = hostShell();
  const incompatible = tracks.filter((t) => t.shell !== "any" && t.shell !== host);
  if (incompatible.length) {
    const withVariants = incompatible.filter((t) => t.steps.some((s) => s.windows)).length;
    checks.push({
      name: "Shell compatibility",
      status: "warn",
      detail: `${incompatible.length} of ${tracks.length} tracks are written for a different shell than this host (${host}, commands run via ${execShellName()}); ${withVariants} have per-step alternatives`,
      fix:
        host === "powershell"
          ? "Run the tutor from WSL or Git Bash for POSIX tracks, or author a track with \"shell\": \"powershell\"."
          : "Nothing to do unless you want those tracks on this host.",
    });
  }
  return checks;
}

async function checkSpeech(): Promise<Check> {
  const platform = os.platform();
  if (platform === "darwin") {
    return (await commandExists("say"))
      ? { name: "Speech engine", status: "ok", detail: "`say` is available" }
      : { name: "Speech engine", status: "warn", detail: "`say` not found; audio will stay silent" };
  }
  if (platform === "win32") {
    return (await commandExists("powershell"))
      ? { name: "Speech engine", status: "ok", detail: "PowerShell System.Speech is available" }
      : {
          name: "Speech engine",
          status: "warn",
          detail: "powershell not found; audio will stay silent",
        };
  }
  for (const cmd of ["spd-say", "espeak-ng", "espeak", "festival"]) {
    if (await commandExists(cmd)) {
      return { name: "Speech engine", status: "ok", detail: `\`${cmd}\` is available` };
    }
  }
  return {
    name: "Speech engine",
    status: "warn",
    detail: "no Linux speech binary found; audio degrades silently",
    fix: "sudo apt install speech-dispatcher",
  };
}

async function checkQuizzes(): Promise<Check> {
  const generated = await loadGeneratedCache();
  return {
    name: "Quiz bank",
    status: "ok",
    detail: `${QUIZ_BANK.length} hand-written questions, ${generated} cached generated ones (${generatedCachePath()})`,
  };
}

async function checkExecShell(): Promise<Check> {
  // If the shell used for execution cannot run a trivial command, nothing else
  // in this server works, and the failure would otherwise surface as a
  // baffling Hotfix Diagnostic on the learner's first lesson.
  try {
    const { stdout } = await exec("echo miyagi-doctor-ok", { timeout: 10_000 });
    return stdout.includes("miyagi-doctor-ok")
      ? { name: "Command execution", status: "ok", detail: `${execShellName()} runs commands` }
      : {
          name: "Command execution",
          status: "fail",
          detail: `${execShellName()} produced unexpected output`,
        };
  } catch (err) {
    return {
      name: "Command execution",
      status: "fail",
      detail: `${execShellName()} could not run a trivial command: ${(err as Error).message}`,
      fix: "Without a working shell the tutor cannot run or verify anything.",
    };
  }
}

export async function runDoctor(write: (line: string) => void = console.log): Promise<number> {
  const checks: Check[] = [];
  checks.push(await checkNode());
  checks.push(await checkExecShell());
  checks.push(await checkProfileDir());
  checks.push(await checkProfile());
  checks.push(await checkHistory());
  checks.push(...(await checkTracks()));
  checks.push(await checkQuizzes());
  checks.push(await checkSpeech());

  write(`miyagi ${VERSION} — doctor`);
  write(`platform ${os.platform()} ${os.release()} · shell ${hostShell()} · cwd ${process.cwd()}`);
  write("");
  for (const c of checks) {
    write(`${ICON[c.status]} ${c.name}: ${c.detail}`);
    if (c.fix) write(`   → ${c.fix}`);
  }
  write("");

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  write(
    failed
      ? `${failed} check${failed === 1 ? "" : "s"} failed and ${warned} warned. The failures above will stop the tutor working properly.`
      : warned
        ? `All required checks passed, with ${warned} warning${warned === 1 ? "" : "s"}. Warnings degrade features, they do not break the server.`
        : "All checks passed.",
  );
  // A warning is a working install, so only a real failure is a non-zero exit.
  return failed ? 1 : 0;
}
