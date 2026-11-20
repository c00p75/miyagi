/**
 * The map: what a developer is expected to be able to do at each level, and
 * how much of it this learner has touched.
 *
 * Belts only measure what an assistant happened to write. Someone can ship
 * forty changes and never meet a test, a transaction or a failed payment, and
 * nothing in the dojo would say so. This is the other view: a short list of
 * skills per level, each tied to evidence Miyagi already has (ideas held, and
 * the moves counted in growth.json), so the gaps are visible and nameable.
 *
 * It describes; it never grades the person. "Not met yet" is a statement about
 * what their projects have asked of them so far.
 */

import type { Growth } from "./growth.js";

export type SkillLevel = "Junior" | "Mid" | "Senior";
export const SKILL_LEVELS: readonly SkillLevel[] = ["Junior", "Mid", "Senior"];

type Signal =
  | { kind: "ideas"; ids: string[] }
  | { kind: "count"; of: "debugRight" | "explainedRight" | "decisions" | "incidents" | "tools" | "unaided" | "gates"; target: number };

export interface Skill {
  id: string;
  level: SkillLevel;
  title: string;
  why: string;
  /** A small, concrete thing to try in their own project. Shown when there is no AI to suggest one. */
  tryIt: string;
  signal: Signal;
}

export const SKILLS: readonly Skill[] = [
  // Junior: the things that bite in the first month.
  {
    id: "secrets",
    level: "Junior",
    title: "Keep secrets out of code",
    why: "A key in the code is a key on the internet the moment the repo is shared.",
    tryIt: "Find one value in your project that should be an environment variable, move it, and check .env is in .gitignore.",
    signal: { kind: "ideas", ids: ["hardcoded-secret", "env-vars", "gitignore"] },
  },
  {
    id: "failure",
    level: "Junior",
    title: "Handle what can fail",
    why: "Every network call, file read and parse fails eventually. The happy path is a demo.",
    tryIt: "Pick one fetch or database call and decide, in code, what the user sees when it fails.",
    signal: { kind: "ideas", ids: ["error-handling", "async-await"] },
  },
  {
    id: "read-errors",
    level: "Junior",
    title: "Read an error before asking",
    why: "Most errors say what is wrong and where. Reading them is the fastest debugging there is.",
    tryIt: "Next time something fails, find the first line that names one of your files before your AI does.",
    signal: { kind: "count", of: "debugRight", target: 3 },
  },
  {
    id: "apis",
    level: "Junior",
    title: "Talk to an API",
    why: "Almost every app is a front end calling a back end calling someone else's service.",
    tryIt: "Trace one request in your app from the click to the response, and name each file it passes through.",
    signal: { kind: "ideas", ids: ["http-fetch", "api-route"] },
  },
  {
    id: "ui-state",
    level: "Junior",
    title: "Keep UI state straight",
    why: "Most front-end bugs are state in the wrong place or updated at the wrong time.",
    tryIt: "Find one piece of state in a component and say who owns it, who reads it, and what changes it.",
    signal: { kind: "ideas", ids: ["react-props", "react-state", "react-effect"] },
  },
  {
    id: "dependencies",
    level: "Junior",
    title: "Know what you installed",
    why: "Every package and service is code you did not write, running as part of your app.",
    tryIt: "Open package.json and say in one line what each direct dependency is for. Look up the ones you cannot.",
    signal: { kind: "count", of: "tools", target: 2 },
  },
  // Mid: owning a feature end to end.
  {
    id: "validation",
    level: "Mid",
    title: "Validate input at the door",
    why: "Anything from a user, a form or another service is untrusted until checked.",
    tryIt: "Pick one API route and validate its input with a schema before anything else runs.",
    signal: { kind: "ideas", ids: ["input-validation", "xss-html-injection"] },
  },
  {
    id: "auth",
    level: "Mid",
    title: "Authentication done right",
    why: "Login is where small mistakes become account takeovers.",
    tryIt: "Find where your app decides who the user is, and check every protected route actually asks.",
    signal: { kind: "ideas", ids: ["auth-token", "password-hashing"] },
  },
  {
    id: "data",
    level: "Mid",
    title: "Model and change data safely",
    why: "Code can be redeployed; a corrupted table cannot.",
    tryIt: "Find a place two writes must both happen or neither, and wrap them in a transaction.",
    signal: { kind: "ideas", ids: ["db-schema", "orm-query", "db-transaction"] },
  },
  {
    id: "testing",
    level: "Mid",
    title: "Write a test that would catch it",
    why: "A test is how you change code next month without fear.",
    tryIt: "Write one test for a function your AI wrote, including one input that should fail.",
    signal: { kind: "ideas", ids: ["tests"] },
  },
  {
    id: "explain",
    level: "Mid",
    title: "Explain it in your own words",
    why: "If you cannot explain the code, you cannot review it, debug it or defend it.",
    tryIt: "On your next card, use \"Explain in my code\" and write your explanation before reading the AI's.",
    signal: { kind: "count", of: "explainedRight", target: 5 },
  },
  {
    id: "scale",
    level: "Mid",
    title: "Make it fast enough",
    why: "What works on ten rows times out on ten thousand.",
    tryIt: "Find a list endpoint that returns everything and add pagination to it.",
    signal: { kind: "ideas", ids: ["caching", "pagination"] },
  },
  // Senior: judgement, systems, and the things that break in production.
  {
    id: "security",
    level: "Senior",
    title: "Review a change for security",
    why: "Seniors are the ones who catch the injection before it ships.",
    tryIt: "Run \"Check it for risks\" on your next change and verify each finding yourself.",
    signal: { kind: "ideas", ids: ["sql-interpolation", "cors", "rate-limiting", "file-upload"] },
  },
  {
    id: "async-systems",
    level: "Senior",
    title: "Work that happens later",
    why: "Webhooks and queues are where retries, duplicates and ordering bugs live.",
    tryIt: "Find a slow thing your app does in a request and ask whether it should be a background job.",
    signal: { kind: "ideas", ids: ["background-job", "webhook"] },
  },
  {
    id: "delivery",
    level: "Senior",
    title: "Ship it reliably",
    why: "Code that only runs on your laptop is not done.",
    tryIt: "Make the tests run on every push, in CI, and read the first failing run end to end.",
    signal: { kind: "ideas", ids: ["container-image", "type-escape"] },
  },
  {
    id: "decisions",
    level: "Senior",
    title: "Choose for a reason",
    why: "Seniors are mostly people who remember why things are the way they are.",
    tryIt: "Log the reason behind one tool or design choice in your project, and the alternative you passed on.",
    signal: { kind: "count", of: "decisions", target: 3 },
  },
  {
    id: "incidents",
    level: "Senior",
    title: "Learn from what broke",
    why: "Every production failure is a lesson the project already paid for.",
    tryIt: "Take the last real bug you fixed and turn it into a lesson in the Grow tab.",
    signal: { kind: "count", of: "incidents", target: 2 },
  },
];

export interface SkillView {
  id: string;
  level: SkillLevel;
  title: string;
  why: string;
  tryIt: string;
  status: "held" | "started" | "untouched";
  /** "2 of 3 ideas at green belt", "1 of 3 errors read right". */
  progress: string;
}

export interface MapView {
  skills: SkillView[];
  /** The skill most worth working on next, with one plain sentence, or null when everything is held. */
  next: { id: string; sentence: string } | null;
}

export interface MapInput {
  /** Per idea: seen at all, and its belt box (0 white to 5 black). */
  ideas: ReadonlyMap<string, { seen: boolean; box: number }>;
  growth: Growth;
  /** Ideas met in total, so a gap can be put in proportion. */
  changesSeen: number;
}

/** Green belt: answered after a week's gap. Held means every idea of the skill is there. */
const HELD_BOX = 3;

const COUNT_WORDS: Record<Extract<Signal, { kind: "count" }>["of"], [string, string]> = {
  debugRight: ["error read right", "errors read right"],
  explainedRight: ["explanation judged right", "explanations judged right"],
  decisions: ["decision logged", "decisions logged"],
  incidents: ["incident turned into a lesson", "incidents turned into lessons"],
  tools: ["tool learned", "tools learned"],
  unaided: ["change written unaided", "changes written unaided"],
  gates: ["commit check answered", "commit checks answered"],
};

function countOf(g: Growth, of: Extract<Signal, { kind: "count" }>["of"]): number {
  switch (of) {
    case "debugRight":
      return g.weeks.reduce((n, w) => n + w.debugRight, 0);
    case "explainedRight":
      return g.weeks.reduce((n, w) => n + w.explainedRight, 0);
    case "decisions":
      return g.decisions.length;
    case "incidents":
      return g.incidents.length;
    case "tools":
      return g.tools.filter((t) => t.adopted || t.guess !== undefined).length;
    case "unaided":
      return g.weeks.reduce((n, w) => n + w.unaided, 0);
    case "gates":
      return g.gates.asked;
  }
}

export function skillMap(input: MapInput): MapView {
  const skills: SkillView[] = SKILLS.map((skill) => {
    const sig = skill.signal;
    if (sig.kind === "ideas") {
      const rows = sig.ids.map((id) => input.ideas.get(id) ?? { seen: false, box: 0 });
      const seen = rows.filter((r) => r.seen).length;
      const held = rows.filter((r) => r.seen && r.box >= HELD_BOX).length;
      return {
        ...skill,
        status: held === rows.length ? "held" : seen ? "started" : "untouched",
        progress: `${held} of ${rows.length} idea${rows.length === 1 ? "" : "s"} at green belt or above`,
      };
    }
    const have = countOf(input.growth, sig.of);
    const [one, many] = COUNT_WORDS[sig.of];
    return {
      ...skill,
      status: have >= sig.target ? "held" : have > 0 ? "started" : "untouched",
      progress: `${Math.min(have, sig.target)} of ${sig.target} ${sig.target === 1 ? one : many}`,
    };
  });

  // The lowest level first, and within it a skill already started before an
  // untouched one: finishing something is closer than starting something.
  const order = (v: SkillView) => SKILL_LEVELS.indexOf(v.level) * 10 + (v.status === "started" ? 0 : 1);
  const open = skills.filter((v) => v.status !== "held").sort((a, b) => order(a) - order(b));
  const pick = open[0];
  let next: MapView["next"] = null;
  if (pick) {
    const lead =
      pick.status === "untouched" && input.changesSeen >= 10
        ? `${input.changesSeen} ideas met so far, and nothing yet on "${pick.title.toLowerCase()}".`
        : pick.status === "untouched"
        ? `Not met yet: "${pick.title.toLowerCase()}".`
        : `Halfway there: "${pick.title.toLowerCase()}" (${pick.progress}).`;
    next = { id: pick.id, sentence: `${lead} ${pick.why}` };
  }
  return { skills, next };
}
