/**
 * Shell awareness.
 *
 * Every built-in track was written for a POSIX shell. On Windows the tutor
 * substitutes a PowerShell line where the step has one, and `runCommand`
 * invokes powershell.exe — Node's default `exec` uses cmd.exe, which cannot
 * run those substitutions. A step with no alternative is warned about rather
 * than handed over as a line that is known to fail. Silence was the only
 * unacceptable option.
 */

import os from "node:os";

export type Shell = "posix" | "powershell" | "any";

export function hostShell(platform: NodeJS.Platform = os.platform()): Shell {
  return platform === "win32" ? "powershell" : "posix";
}

/** True when a track written for `want` will run as-is on this host. */
export function shellCompatible(want: Shell, host: Shell = hostShell()): boolean {
  return want === "any" || want === host;
}

/**
 * A POSIX-shell environment reachable from Windows. Checked lazily and only on
 * win32, because the answer changes what advice is useful: "install WSL" is
 * unhelpful to somebody who already has Git Bash.
 */
export function posixEscapeHatch(platform: NodeJS.Platform = os.platform()): string {
  if (platform !== "win32") return "";
  return (
    "This track assumes a POSIX shell. On Windows, run these in WSL (`wsl`) or Git Bash " +
    "rather than PowerShell, or switch to a track that declares `powershell`."
  );
}

/** Which shell the given command line will actually be handed to by `runCommand`. */
export function execShellName(platform: NodeJS.Platform = os.platform()): string {
  return platform === "win32" ? "powershell.exe" : "/bin/sh";
}
