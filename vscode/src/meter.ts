/**
 * What Miyagi has cost the learner.
 *
 * Explanations run on the learner's own AI account, so every button in the
 * panel spends something of theirs. They should be able to see how much.
 * This counts calls and characters per week. Tokens are estimated at four
 * characters each, which is close enough for "is this a lot" and is labelled
 * as an estimate wherever it is shown. No prices: Miyagi does not know which
 * plan anyone is on.
 */

export interface Meter {
  /** Monday of the week these numbers belong to, YYYY-MM-DD. */
  week: string;
  calls: number;
  charsIn: number;
  charsOut: number;
}

export function weekOf(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

export function emptyMeter(now: Date = new Date()): Meter {
  return { week: weekOf(now), calls: 0, charsIn: 0, charsOut: 0 };
}

/** Anything unreadable, or from an earlier week, starts again from zero. */
export function currentMeter(saved: unknown, now: Date = new Date()): Meter {
  const m = saved as Partial<Meter> | null | undefined;
  const ok =
    m &&
    typeof m.week === "string" &&
    [m.calls, m.charsIn, m.charsOut].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  return ok && m.week === weekOf(now) ? (m as Meter) : emptyMeter(now);
}

export function recordCall(meter: Meter, charsIn: number, charsOut: number, now: Date = new Date()): Meter {
  const base = currentMeter(meter, now);
  return {
    week: base.week,
    calls: base.calls + 1,
    charsIn: base.charsIn + Math.max(0, charsIn),
    charsOut: base.charsOut + Math.max(0, charsOut),
  };
}

export function estimatedTokens(meter: Meter): number {
  return Math.round((meter.charsIn + meter.charsOut) / 4);
}

/** "12 AI calls this week, about 9,400 tokens." */
export function describeMeter(meter: Meter): string {
  if (!meter.calls) return "No AI calls this week.";
  return `${meter.calls} AI call${meter.calls === 1 ? "" : "s"} this week, about ${estimatedTokens(meter).toLocaleString("en-US")} tokens.`;
}
