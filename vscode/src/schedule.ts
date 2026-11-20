/**
 * When Miyagi should keep quiet.
 *
 * Two reasons, one answer. A pause is the learner saying "not now"; quiet
 * hours are them saying "never at these times". While either holds, changes
 * are still read (so nothing is taught late as if it had just happened) but
 * no card, toast or reminder is produced.
 */

export interface QuietHours {
  /** Minutes after midnight. */
  from: number;
  to: number;
}

/** "22:00-07:00" or "9:30 - 12:00". Anything else, or an empty range, means none. */
export function parseQuietHours(raw: unknown): QuietHours | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const from = h1 * 60 + m1;
  const to = h2 * 60 + m2;
  return from === to ? null : { from, to };
}

export function inQuietHours(hours: QuietHours | null, now: Date = new Date()): boolean {
  if (!hours) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  // A range that crosses midnight is "after from OR before to".
  return hours.from < hours.to ? minute >= hours.from && minute < hours.to : minute >= hours.from || minute < hours.to;
}

export function pausedUntil(saved: unknown, now: Date = new Date()): Date | null {
  if (typeof saved !== "string") return null;
  const t = Date.parse(saved);
  return Number.isFinite(t) && t > now.getTime() ? new Date(t) : null;
}

export type QuietReason = { quiet: false } | { quiet: true; why: "paused"; until: Date } | { quiet: true; why: "hours" };

export function quietNow(state: { pausedUntil: unknown; quietHours: unknown }, now: Date = new Date()): QuietReason {
  const until = pausedUntil(state.pausedUntil, now);
  if (until) return { quiet: true, why: "paused", until };
  return inQuietHours(parseQuietHours(state.quietHours), now) ? { quiet: true, why: "hours" } : { quiet: false };
}

/** The next 7 a.m. local time: what "until tomorrow" means to someone pausing at midnight. */
export function tomorrowMorning(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(7, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * A glob from settings as a regular expression over forward-slash paths.
 * `**` crosses folders, `*` does not, `?` is one character. A pattern with no
 * slash matches at any depth, the way a .gitignore line does.
 */
export function globToRegExp(glob: string): RegExp | null {
  const g = glob.trim().replace(/\\/g, "/");
  if (!g || g.length > 200) return null;
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        re += g[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += g[i + 2] === "/" ? 2 : 1;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(g.includes("/") ? `^${re}$` : `(?:^|/)${re}$`);
}

export function ignoreMatcher(globs: readonly unknown[]): (relativePath: string) => boolean {
  const patterns = globs
    .filter((g): g is string => typeof g === "string")
    .map(globToRegExp)
    .filter((r): r is RegExp => Boolean(r));
  return (relativePath) => {
    const p = relativePath.replace(/\\/g, "/");
    return patterns.some((re) => re.test(p));
  };
}
