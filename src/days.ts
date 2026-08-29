/**
 * Calendar-day arithmetic for the practice streak.
 *
 * Days are local, not UTC: a learner who practises at 11pm and again at 8am
 * has practised on two consecutive days by every reckoning that matters to
 * them, and a UTC boundary would silently break streaks for anyone west of
 * Greenwich. The cost is that crossing a timezone can gift or cost a day,
 * which is the cheaper mistake.
 */

/** Local calendar day as `YYYY-MM-DD`. */
export function dayKey(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days between two `YYYY-MM-DD` keys, or null if either is unparseable. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function isDayKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && daysBetween(v, v) === 0;
}
