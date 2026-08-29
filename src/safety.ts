/**
 * The danger screen.
 *
 * This is the control that lets a stranger install a server that runs shell
 * commands, so it is worth being precise about what it is. It is a denylist of
 * shapes that are catastrophic or irreversible, re-derived from the command
 * text rather than trusted from the caller's `is_dangerous` flag, because the
 * caller is a language model that can be talked into anything.
 *
 * It is not a sandbox. `sh -c "$(printf ...)"` defeats any pattern match, and
 * pretending otherwise would be worse than saying so. What it does is stop the
 * obviously destructive thing proposed to someone who is clicking through
 * approval prompts, and flag the shapes that hide their own contents so the
 * learner is told they are approving something opaque.
 *
 * Two tiers, because one tier had a real cost: everything flagged was forced
 * into dry-run forever, so a learner who genuinely needed to practise `rm -rf
 * build` had to leave the tutor to do it, which teaches them to work around
 * their own safety rail.
 *
 *   - `catastrophic` never executes. No flag, no confirmation, no exceptions.
 *   - `destructive` executes only with an explicit, separate confirmation.
 */

export type Severity = "catastrophic" | "destructive";

export interface DangerRule {
  re: RegExp;
  why: string;
  severity: Severity;
}

/** A path that is a root, a home, or a system directory: no legitimate recursive delete. */
const ROOTISH = String.raw`(\/|~|\$HOME|\/\*|\/(etc|usr|var|bin|sbin|lib|boot|dev|sys|proc|System|Users|home)(\/\*?)?)\s*$`;

export const DANGER_RULES: DangerRule[] = [
  /* ---- catastrophic: never executed ---- */
  {
    // The trailing token must itself look like a flag. Without that anchor,
    // `rm -i archive.txt` matches on the "ar" inside the filename.
    re: new RegExp(String.raw`\brm\s+(-{1,2}[a-zA-Z-]+\s+)*-{1,2}[a-zA-Z]*[rf][a-zA-Z]*\s+` + ROOTISH),
    why: "recursive delete of a root, home or system directory",
    severity: "catastrophic",
  },
  { re: /\bmkfs(\.|\s)/, why: "filesystem format", severity: "catastrophic" },
  { re: /\bdd\s+.*of=\/dev\//, why: "raw device write", severity: "catastrophic" },
  { re: /:\(\)\s*\{.*\};\s*:/, why: "fork bomb", severity: "catastrophic" },
  { re: />\s*\/dev\/(sd[a-z]|nvme\d|disk\d)/, why: "raw disk overwrite", severity: "catastrophic" },
  {
    re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/,
    why: "piping remote code into a shell",
    severity: "catastrophic",
  },
  {
    re: /\b(shred|wipefs)\b/,
    why: "irrecoverable data destruction",
    severity: "catastrophic",
  },
  {
    re: /\bchown\s+-R\b[^;|&]*\s\/\s*$/,
    why: "recursive ownership change from the root",
    severity: "catastrophic",
  },
  {
    re: /\b(history\s+-c|>\s*~?\/?\.?(bash|zsh)_history)\b/,
    why: "destroying the shell history that would explain what happened",
    severity: "catastrophic",
  },

  /* ---- destructive: executable only with explicit confirmation ---- */
  {
    re: /\brm\s+(-{1,2}[a-zA-Z-]+\s+)*-{1,2}[a-zA-Z]*[rf]/,
    why: "recursive or forced delete",
    severity: "destructive",
  },
  {
    re: /\bfind\b[^;|&]*\s(-delete\b|-exec\s+rm\b)/,
    why: "bulk delete driven by a search",
    severity: "destructive",
  },
  { re: /\btruncate\s+(-s\s*0|--size[= ]0)/, why: "emptying a file in place", severity: "destructive" },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/, why: "host power state change", severity: "destructive" },
  { re: /\bchmod\s+(-R\s+)?[0-7]?777\b/, why: "world-writable permissions", severity: "destructive" },
  { re: /\bchmod\s+-R\b/, why: "recursive permission change", severity: "destructive" },
  {
    re: /\bgit\s+push\b[^;|&]*--force(?!-with-lease)/,
    why: "history-rewriting force push",
    severity: "destructive",
  },
  // `-f` specifically: `git clean -nd` is the dry run this server recommends.
  { re: /\bgit\s+clean\b[^;|&]*\s-{1,2}[a-zA-Z]*f/, why: "deleting untracked and ignored files", severity: "destructive" },
  { re: /\bgit\s+reset\s+--hard\b/, why: "discarding uncommitted work", severity: "destructive" },
  { re: /\bterraform\s+(destroy|apply)\b(?![^;|&]*\btfplan\b)/, why: "unreviewed infrastructure change", severity: "destructive" },
  { re: /\bkubectl\s+delete\b/, why: "deleting live cluster resources", severity: "destructive" },
  { re: /\bdocker\s+system\s+prune\b[^;|&]*-[a-zA-Z]*a/, why: "removing all unused images and volumes", severity: "destructive" },
  { re: /\bdocker\s+(compose\s+)?down\b[^;|&]*\s-[a-zA-Z]*v/, why: "deleting named volumes and their data", severity: "destructive" },
  { re: /\bdrop\s+(database|table)\b/i, why: "dropping a database object", severity: "destructive" },
  { re: /\bnpm\s+audit\s+fix\b[^;|&]*--force/, why: "accepting breaking dependency upgrades", severity: "destructive" },

  /* ---- opaque: the screen cannot see what this runs ---- */
  {
    re: /\b(ba|z|da)?sh\s+-c\b|\beval\b|\bsource\s+\/dev\/stdin\b|\bbase64\s+(-d|--decode)\b[^;|&]*\|/,
    why: "the real command is hidden from the safety screen (shell -c, eval or a decoded payload)",
    severity: "destructive",
  },
];

/**
 * Reasons this command is flagged. Kept as the simple string list the original
 * exported, so callers and tests that only ask "is this flagged" keep working.
 */
export function screenDanger(command: string): string[] {
  return DANGER_RULES.filter((r) => r.re.test(command)).map((r) => r.why);
}

export interface Screening {
  reasons: string[];
  severity: Severity | null;
  /** True when no confirmation can authorise execution. */
  blocked: boolean;
  /** True when an explicit confirmation would allow execution. */
  confirmable: boolean;
}

export function screenCommand(command: string): Screening {
  const hits = DANGER_RULES.filter((r) => r.re.test(command));
  if (!hits.length) {
    return { reasons: [], severity: null, blocked: false, confirmable: false };
  }
  const blocked = hits.some((h) => h.severity === "catastrophic");
  // Duplicate reasons happen when two rules describe the same shape; collapse them.
  const reasons = Array.from(new Set(hits.map((h) => h.why)));
  return {
    reasons,
    severity: blocked ? "catastrophic" : "destructive",
    blocked,
    confirmable: !blocked,
  };
}
