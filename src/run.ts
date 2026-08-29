/**
 * Command execution.
 *
 * Separated from the server so the truncation and timeout rules are readable
 * on their own. Both used to be silent: output over the buffer cap was cut
 * with no note in the card, which reads to a learner as "that is all the
 * output there was" — the one interpretation guaranteed to mislead them.
 *
 * On Windows the host shell is PowerShell and the tracks substitute PowerShell
 * lines, so execution has to go through powershell.exe. Node's default `exec`
 * uses cmd.exe, which cannot run `Get-Location` and is why a Windows learner's
 * first lesson used to be a Hotfix Diagnostic for the tutor's own suggestion.
 */

import { exec as execCb, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const exec = promisify(execCb);
const execFile = promisify(execFileCb);

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_OUTPUT_BYTES = 1024 * 1024 * 4;

/** Displayed output is capped well below the buffer cap; nobody reads 4 MB in a card. */
export const STDOUT_DISPLAY_LIMIT = 4_000;
export const STDERR_DISPLAY_LIMIT = 1_500;

export interface ExecOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  errorMessage?: string;
  /** Output exceeded the buffer cap, so what came back is incomplete. */
  truncated: boolean;
  /** The process was killed by the timeout rather than exiting on its own. */
  timedOut: boolean;
  durationMs: number;
}

/**
 * PowerShell 5.1 (the one Windows ships) returns 0 from `-Command` even when
 * the native program failed, unless the script exits with `$LASTEXITCODE`.
 * Cmdlets set `$?` instead. Honour both so `git status` in a non-repo is a
 * failure the card can teach from, not a fake success.
 */
export function powershellScript(command: string): string {
  return (
    `${command}; ` +
    "if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; " +
    "if (-not $?) { exit 1 }"
  );
}

async function invoke(
  command: string,
  options: { cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  const common = {
    timeout: options.timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
    cwd: options.cwd,
    env: process.env,
  };
  if (os.platform() === "win32") {
    return execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", powershellScript(command)],
      { ...common, windowsHide: true },
    );
  }
  return exec(command, common);
}

export async function runCommand(
  command: string,
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecOutcome> {
  const started = Date.now();
  const timeout = Math.min(600_000, Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  try {
    const { stdout, stderr } = await invoke(command, {
      timeout,
      cwd: options.cwd || process.cwd(),
    });
    return {
      ok: true,
      stdout,
      stderr,
      code: 0,
      signal: null,
      // Hitting the cap exactly is indistinguishable from being cut at it, so
      // say "truncated" and let the learner re-run with a narrower command.
      truncated: Buffer.byteLength(stdout) >= MAX_OUTPUT_BYTES,
      timedOut: false,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };
    const maxBufferHit =
      e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(e.message ?? "");
    const timedOut = Boolean(e.killed) && !maxBufferHit;
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : null,
      signal: e.signal ?? null,
      errorMessage: timedOut
        ? `Process exceeded the ${Math.round(timeout / 1000)}s tutor timeout and was killed (${e.signal ?? "SIGTERM"}).`
        : maxBufferHit
        ? `Output exceeded the ${Math.round(MAX_OUTPUT_BYTES / 1024 / 1024)} MB cap and the process was stopped.`
        : e.message,
      truncated: maxBufferHit,
      timedOut,
      durationMs: Date.now() - started,
    };
  }
}

/** Trims for display and says so, rather than cutting silently. */
export function forDisplay(text: string, limit: number): { text: string; trimmed: boolean } {
  const t = text.trim();
  if (t.length <= limit) return { text: t, trimmed: false };
  return { text: t.slice(0, limit), trimmed: true };
}

const INTERACTIVE_HINTS = [
  /\b(vim?|nano|emacs|less|more|top|htop|watch)\b/,
  /\bnpm\s+run\s+(dev|start|serve)\b/,
  /\b(tail|journalctl|docker\s+(compose\s+)?logs)\b[^;|&]*\s-{1,2}f\b/,
  /\b(ssh|psql|mysql|sqlite3|python3?|node|irb)\s*$/,
  /\bkubectl\s+(exec|port-forward|attach)\b/,
  /\bdocker\s+exec\b[^;|&]*\s-{1,2}[a-zA-Z]*it\b/,
];

/**
 * Commands that will sit there waiting for input or never exit. Running these
 * through a 60-second timeout teaches the learner that the tool is broken, so
 * they are better refused up front with an explanation.
 */
export function looksInteractive(command: string): boolean {
  return INTERACTIVE_HINTS.some((re) => re.test(command));
}
