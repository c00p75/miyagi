/**
 * The coach: the parts of growing as a developer that are not one idea in
 * one change.
 *
 * - Tools: a library or service the project adopts, taught as a small track
 *   (primer, vocabulary with belts, the decision behind it).
 * - Debugging: when something fails, the learner reads the error first and
 *   their read is compared with the real cause.
 * - Before you commit: one question about a large staged change.
 * - Decisions, incidents, the skill map, the trend, and their story.
 *
 * The rule throughout is the one the rest of Miyagi follows: the learner goes
 * first, then sees the answer. Guessing before reading, reading the error
 * before the fix. Getting it wrong first is not a
 * failure of the exercise; it is the exercise.
 *
 * The panel owns the webview and the model calls. The coach decides what to
 * offer and keeps its own small state, and is handed the panel's `ask` so every
 * model call is metered, cancellable and reported the same way.
 */

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import path from "node:path";
import { conceptsIn, gitChanges } from "../../src/changes.js";
import { CONCEPTS, registerConcepts, scrub, type ConceptDefinition, type FileChange } from "../../src/concepts.js";
import { errorExcerpt, type Observation } from "../../src/observe.js";
import * as engine from "./engine.js";
import type { Prompt } from "./ai.js";
import {
  addStory,
  clueLine,
  count,
  errorSignature,
  loadGrowth,
  trend,
  updateGrowth,
  worthCoaching,
  type Growth,
  type Move,
  type ToolRecord,
  type Verdict,
} from "./growth.js";
import {
  commitQuestionPrompt,
  debugHintPrompt,
  decisionsPrompt,
  diagnosePrompt,
  incidentPrompt,
  parseAttemptFeedback,
  parseDecisions,
  parseDiagnosis,
  parseIncident,
  parseOwnQuestion,
  parseStoryQuestion,
  parseToolPrimer,
  parseYourTurn,
  recallGradePrompt,
  skillExercisePrompt,
  storyFeedbackPrompt,
  storyQuestionPrompt,
  toolPrimerPrompt,
  type ChangedFile,
  type Depth,
  type Diagnosis,
  type FoundDecision,
  type Hint,
  type ToolPrimer,
  type YourTurn,
} from "./prompts.js";
import { SKILLS, skillMap, type MapView } from "./skills.js";
import {
  detectTools,
  findTool,
  registerTool,
  slugOf,
  specFromModel,
  specOf,
  toolById,
  unknownPackages,
  type ToolSpec,
} from "./tools.js";
import { assignTopic } from "./topics.js";
import { trackedFiles, chooseFiles } from "./reports.js";

const COACH_KEY = "miyagi.coach.v1";
const TOOLS_KEY = "miyagi.coachTools.v1";
const NO_AI_OFFER_KEY = "miyagi.noAiOffered.v1";

/** XP for going first. Smaller than an answer recalled cold, larger than nothing. */
const XP_DEBUG: Record<Verdict, number> = { right: 20, partly: 10, wrong: 5 };
const XP_INCIDENT = 15;
const XP_DECISION = 10;
/** The same failure within this window is the same lesson, not a new one. */
const DEBUG_REPEAT_MS = 15 * 60_000;
const MAX_DEBUG_PER_HOUR = 4;
/** A staged change smaller than this is not worth a question before commit. */
const DEFAULT_GATE_LINES = 60;
const MAX_ITEMS = 30;
/** Repeats of one failure before it is offered as a lesson in its own right. */
const RECURRING = 3;

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

export interface ToolItem {
  kind: "tool";
  key: string;
  at: string;
  root: string;
  toolId: string;
  name: string;
  emoji: string;
  job: string;
  evidence: string;
  file: string;
  source: ToolRecord["source"];
  spec: ToolSpec | null;
  /** Shown in the Now feed. Cleared with the feed; the tool itself is never forgotten. */
  inFeed: boolean;
  guess?: string;
  guessDone: boolean;
  primer?: ToolPrimer & { by: string };
  termIds: string[];
  adopted: boolean;
  decision?: FoundDecision & { by: string; saved?: boolean };
  conversant?: boolean;
}

export interface DebugItem {
  kind: "debug";
  key: string;
  at: string;
  root: string;
  command: string;
  /** Who ran it: an assistant's name, or "you" for the learner's own terminal. */
  by: string;
  lines: string[];
  signature: string;
  repeats: number;
  picked?: number;
  guess?: string;
  result?: Diagnosis & { by: string };
  hints?: { nudge?: string; pointer?: string; by?: string };
  /** No AI: the learner checked their own read against the likely clue. */
  self?: "right" | "wrong";
  /** No AI, after "show me": the heuristic clue line. */
  revealed?: number;
}

export interface GateItem {
  kind: "gate";
  key: string;
  at: string;
  root: string;
  files: string[];
  lines: number;
  signature: string;
  token?: string;
  answered?: boolean;
  correct?: boolean;
  committed?: boolean;
  noQuestion?: boolean;
}

export type CoachItem = ToolItem | DebugItem | GateItem;

interface Saved {
  items: CoachItem[];
  /** Packages a lesson's change added that the catalogue does not know. */
  packages: Record<string, string[]>;
}

export interface CoachHost {
  context: vscode.ExtensionContext;
  ask(slot: string, build: () => Promise<Prompt | string>, use: (reply: string, by: string) => string | void | Promise<string | void>): Promise<void>;
  push(): void;
  post(message: unknown): void;
  depth(): Promise<Depth>;
  aiReady(): Promise<boolean>;
  quiet(): boolean;
  /** Something new arrived while the panel may be hidden. */
  announce(count: number, title: string): void;
  /** Files of a lesson's change, numbered as they sit now. */
  lessonFiles(lessonId: string): Promise<ChangedFile[]>;
  /** A lesson's root and files, when it still exists. */
  lessonInfo(lessonId: string): { root: string; files: string[] } | null;
  roots(): string[];
  rootOf(dir: string): string | undefined;
  /** Assistant name for an observation source. */
  sourceName(source: Observation["source"]): string;
}

const setting = <T>(key: string, fallback: T): T => vscode.workspace.getConfiguration("miyagi").get<T>(key, fallback);

function run(cwd: string, command: string, args: string[], timeout = 8_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 4 * 1024 * 1024, timeout, windowsHide: true }, (err, stdout) =>
      resolve(err && !stdout ? null : String(stdout)),
    );
  });
}

/* ------------------------------------------------------------------ *
 * The skill ideas: reading errors, and the commit check's home
 * ------------------------------------------------------------------ */

export const READING_ERRORS = "skill-reading-errors";
export const COMMIT_CHECK = "skill-commit-check";

const SKILL_IDEAS: ConceptDefinition[] = [
  {
    id: READING_ERRORS,
    title: "Reading an error message",
    emoji: "🩺",
    weight: 60,
    patterns: [],
    hook: "Most errors tell you what broke and where. Reading them is the fastest debugging there is.",
    what: "An error message names what went wrong, and a stack trace lists where, newest call first.",
    lens: {
      Junior:
        "Read the first line that says Error, then look down the list for the first line that names one of YOUR files (not node_modules). That file and line is where to start.",
      Mid:
        "The message says what; the frames say where. Skip frames from libraries and the runtime; the topmost frame in your own code is usually the cause, or the caller that passed bad input.",
      Senior:
        "Separate the symptom from the cause: the throw site is often downstream of the real mistake. 'Caused by' chains and the first error in a log matter more than the last.",
    },
    pitfall:
      "You paste the whole error to your AI, it changes three files, and the error goes away. You still could not say what was wrong, so the next one costs the same.",
    askTheAi: "Before you fix it: which line of this error told you what was wrong, and how did you know to look there?",
    docs: { label: "MDN: Error", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error" },
    questions: [
      {
        question: "A stack trace lists twenty lines. Which one is usually worth reading first?",
        answer: "The top line naming a file in your own project",
        distractors: ["The very last line at the bottom", "The first line from node_modules", "Whichever line is the longest"],
        explanation: "Library and runtime frames are where the error surfaced, not where your code went wrong. The first frame in your own files is where to look.",
        level: "Junior",
      },
      {
        question: "An error says `Cannot read properties of undefined (reading 'id')`. What is it telling you?",
        answer: "Something you expected to be an object was undefined",
        distractors: ["The id property was spelled wrong", "The database has no row with that id", "The id is the wrong type, a string"],
        explanation: "The code tried to read `.id` from a value that was undefined. The question is why that value was missing, usually one line earlier.",
        level: "Junior",
      },
      {
        question: "A log shows five errors in a row after one request. Which one is most likely the cause?",
        answer: "The first one, since the rest often follow from it",
        distractors: ["The last one, since it ended the request", "The longest one, as it has the most detail", "Whichever one repeats the most often"],
        explanation: "Later errors are frequently consequences of the first failure. Fix the first and the rest often disappear.",
        level: "Mid",
      },
    ],
  },
  {
    id: COMMIT_CHECK,
    title: "Knowing what you commit",
    emoji: "🚦",
    weight: 45,
    patterns: [],
    hook: "A commit is your name on the change. Thirty seconds of reading it is cheap insurance.",
    what: "Reading a staged change before committing, well enough to say what it does and what it could break.",
    lens: "Read the diff, not the summary. For each file ask: what does this change for the user, and what input would break it?",
    pitfall: "You commit four hundred lines because the tests passed. Next week a bug report arrives and you cannot say which part of it you even shipped.",
    askTheAi: "Before I commit: what does this change do that a user would notice, and what is the riskiest line?",
  },
];

/** Registers the skill ideas. Call once at startup, before anything is taught. */
export function registerSkillIdeas(): void {
  const added = registerConcepts(SKILL_IDEAS, "skills").added;
  for (const id of added) assignTopic(id, "Tooling");
}

/** Re-registers the vocabulary of every tool the learner has met, so its questions still exist. */
export async function restoreTools(): Promise<number> {
  const g = await loadGrowth();
  let n = 0;
  for (const t of g.tools) {
    const catalogued = toolById(t.id);
    const spec = catalogued ? specOf(catalogued) : t.spec ? specFromModel({ ...t.spec }) : null;
    if (!spec) continue;
    if (!catalogued) spec.id = t.id;
    if (registerTool(spec).length) n++;
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * The coach
 * ------------------------------------------------------------------ */

export class Coach {
  private items: CoachItem[] = [];
  private tools = new Map<string, ToolItem>();
  private packages: Record<string, string[]> = {};
  private recentCommands: Array<{ command: string; at: number; cwd?: string }> = [];
  private debugTimes: number[] = [];
  /** Tokens of open questions the coach asked, and what they belong to. */
  private readonly tokens = new Map<string, { kind: "gate" | "story" | "term"; key: string }>();
  private readonly secrets = new Map<string, { clue: number | null }>();
  /** Results the panel posts to the webview for "explain it in your own words". */
  private readonly ownWords = new Map<string, { verdict: Verdict; feedback: string; by: string }>();
  /** Grow tab state that lives only for this sitting. */
  private exercise: Record<string, (YourTurn & { by: string; root?: string; completed?: boolean }) | undefined> = {};
  private story: { question?: string; entry?: number; by?: string; feedback?: { verdict: Verdict; feedback: string; by: string } } = {};
  private incidentDraft: { lesson?: string } = {};
  private trackedCache = new Map<string, { at: number; files: string[] }>();

  constructor(private readonly host: CoachHost) {
    const saved = host.context.workspaceState.get<Saved>(COACH_KEY);
    // "prediction" items were saved by versions before 0.6.2.
    if (saved?.items) this.items = saved.items.filter((i) => i && i.kind !== "tool" && (i.kind as string) !== "prediction").slice(0, MAX_ITEMS);
    this.packages = saved?.packages ?? {};
    const tools = host.context.globalState.get<ToolItem[]>(TOOLS_KEY) ?? [];
    for (const t of tools) if (t && t.toolId) this.tools.set(t.toolId, { ...t, inFeed: t.inFeed && this.isLocalRoot(t.root) });
  }

  private isLocalRoot(root: string): boolean {
    return this.host.roots().length === 0 || this.host.roots().includes(root);
  }

  private save(): void {
    void this.host.context.workspaceState.update(COACH_KEY, { items: this.items.slice(0, MAX_ITEMS), packages: this.packages } satisfies Saved);
    void this.host.context.globalState.update(TOOLS_KEY, [...this.tools.values()].slice(-60));
  }

  private add(item: CoachItem): void {
    this.items = [item, ...this.items.filter((i) => i.key !== item.key)].slice(0, MAX_ITEMS);
    this.save();
  }

  private item(key: string): CoachItem | undefined {
    if (key.startsWith("tool:")) return this.tools.get(key.slice(5));
    return this.items.find((i) => i.key === key);
  }

  private async move(move: Move): Promise<void> {
    await updateGrowth((g) => count(g, move));
  }

  /* ---- what the webview sees ----------------------------------- */

  /** Feed items for the Now tab, newest first, and what is half-done at the top. */
  async view(): Promise<unknown> {
    const states = await engine.ideaStates();
    const toolView = (t: ToolItem) => {
      const terms = t.termIds.map((id) => {
        const s = states.get(id) ?? { seen: false, box: 0 };
        const c = CONCEPTS.find((x) => x.id === id);
        return { id, term: c ? c.title.replace(/^[^:]+:\s*/, "") : id, meaning: c?.what ?? "", seen: s.seen, box: s.box };
      });
      const held = terms.filter((x) => x.seen && x.box >= 3).length;
      return { ...t, terms, held };
    };
    const feedTools = [...this.tools.values()].filter((t) => t.inFeed).map(toolView);
    const ai = await this.host.aiReady();
    return {
      items: [...this.items.map((i) => (i.kind === "debug" ? this.debugView(i) : i)), ...feedTools].sort((a, b) => b.at.localeCompare(a.at)),
      tools: [...this.tools.values()].map(toolView),
      packages: this.packages,
      offerAi: !ai && !this.host.context.globalState.get<boolean>(NO_AI_OFFER_KEY),
      ownWords: Object.fromEntries(this.ownWords),
    };
  }

  private debugView(i: DebugItem) {
    // The clue stays on this side until the learner has read or asked.
    return { ...i };
  }

  /** The Grow tab: computed on request, like the dojo. */
  async grow(): Promise<unknown> {
    const [g, states, met] = await Promise.all([loadGrowth(), engine.ideaStates(), engine.ideasMet()]);
    const map: MapView = skillMap({ ideas: states, growth: g, changesSeen: met });
    const t = trend(g);
    const toolsView = (await this.view()) as { tools: unknown[] };
    return {
      trend: t,
      map,
      tools: toolsView.tools,
      decisions: [...g.decisions].reverse().slice(0, 30),
      incidents: [...g.incidents].reverse().slice(0, 20),
      story: [...g.story].reverse().slice(0, 40),
      storyCount: g.story.length,
      gates: g.gates,
      exercise: this.exercise,
      practice: this.story,
      incidentDraft: this.incidentDraft,
    };
  }

  /* ---- tools --------------------------------------------------- */

  /** A change or a command named a tool. Taught once per machine, never again unasked. */
  private async meetTool(spec: ToolSpec, hit: { root: string; evidence: string; file: string; source: ToolRecord["source"] }): Promise<ToolItem | null> {
    const known = this.tools.get(spec.id);
    if (known) {
      if (hit.source !== "detected" && !known.inFeed) {
        known.inFeed = true;
        known.at = new Date().toISOString();
        this.save();
      }
      return known;
    }
    const g = await loadGrowth();
    if (hit.source === "detected" && g.tools.some((t) => t.id === spec.id)) return null;
    const termIds = registerTool(spec);
    const item: ToolItem = {
      kind: "tool",
      key: `tool:${spec.id}`,
      at: new Date().toISOString(),
      root: hit.root,
      toolId: spec.id,
      name: spec.name,
      emoji: spec.emoji,
      job: spec.job,
      evidence: scrub(hit.evidence),
      file: hit.file,
      source: hit.source,
      spec,
      inFeed: true,
      guessDone: false,
      termIds,
      adopted: false,
    };
    this.tools.set(spec.id, item);
    await updateGrowth((growth) => {
      growth.tools = [
        ...growth.tools.filter((t) => t.id !== spec.id),
        {
          id: spec.id,
          name: spec.name,
          emoji: spec.emoji,
          job: spec.job,
          at: item.at,
          root: hit.root,
          source: hit.source,
          evidence: item.evidence,
          termIds,
          adopted: false,
          ...(spec.builtIn
            ? {}
            : { spec: { name: spec.name, emoji: spec.emoji, job: spec.job, oneLiner: spec.oneLiner, flow: spec.flow, terms: spec.terms, risks: spec.risks, verify: spec.verify, topic: spec.topic } }),
        },
      ];
    });
    this.save();
    if (hit.source === "detected") this.host.announce(1, `New tool: ${spec.name}`);
    return item;
  }

  /** "Teach me about…": a catalogued tool, an idea by name, or something the learner's AI describes. */
  async learnAbout(query: string): Promise<void> {
    const q = query.trim().slice(0, 80);
    if (!q) return;
    const tool = findTool(q);
    const root = this.host.roots()[0] ?? "";
    if (tool) {
      const item = await this.meetTool(specOf(tool), { root, evidence: `You asked about ${tool.name}`, file: "", source: "asked" });
      if (item) this.host.post({ type: "openItem", key: item.key });
      return this.host.push();
    }
    const lower = q.toLowerCase();
    const idea = CONCEPTS.find((c) => c.title.toLowerCase() === lower) ?? CONCEPTS.find((c) => lower.length >= 4 && c.title.toLowerCase().includes(lower));
    if (idea) return this.host.post({ type: "openIdea", id: idea.id });

    const slot = "learn|about";
    let mentions: ChangedFile[] = [];
    await this.host.ask(
      slot,
      async () => {
        mentions = root ? await this.mentions(root, [q]) : [];
        return toolPrimerPrompt({ name: q, files: mentions, depth: await this.host.depth() });
      },
      async (reply, by) => {
        const primer = parseToolPrimer(reply, mentions.map((m) => m.file), true);
        if (!primer?.spec) return `${by} could not describe "${q}" well enough to teach. Check the spelling, or try its package name.`;
        const spec = specFromModel({ ...primer.spec, flow: primer.flow, risks: primer.risks.map((r) => `${r.title}: ${r.why}`), verify: primer.verify });
        if (!spec) return `${by}'s description of "${q}" was not usable. Try again.`;
        const item = await this.meetTool(spec, { root, evidence: `You asked about ${q}`, file: "", source: "ai" });
        if (!item) return;
        item.primer = { ...primer, by };
        this.save();
        this.host.post({ type: "openItem", key: item.key });
      },
    );
  }

  /** Files that mention a tool, as numbered excerpts. Uses git, so it is quick and respects .gitignore. */
  private async mentions(root: string, needles: readonly string[]): Promise<ChangedFile[]> {
    const terms = needles.map((n) => n.replace(/\/$/, "")).filter((n) => n.length >= 3).slice(0, 4);
    if (!terms.length) return [];
    const args = ["grep", "-n", "-i", "-I", "-F", "--max-count=4"];
    for (const t of terms) args.push("-e", t);
    args.push("--", ".", ":(exclude)*.lock", ":(exclude)package-lock.json", ":(exclude)pnpm-lock.yaml", ":(exclude)*.min.*", ":(exclude)*.map");
    const out = await run(root, "git", args, 5_000);
    if (!out) return [];
    const byFile = new Map<string, string[]>();
    for (const line of out.split("\n").slice(0, 200)) {
      const m = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (!m) continue;
      const rows = byFile.get(m[1]) ?? [];
      if (rows.length < 4) rows.push(`${m[2]}: ${scrub(m[3]).slice(0, 200)}`);
      byFile.set(m[1], rows);
    }
    return [...byFile.entries()].slice(0, 6).map(([file, rows]) => ({ file, excerpt: rows.join("\n") }));
  }

  async toolGuess(key: string, text: string): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "tool") return;
    const guess = text.trim().slice(0, 300);
    item.guessDone = true;
    if (guess) {
      item.guess = guess;
      await updateGrowth((g) => {
        count(g, { kind: "first" });
        const t = g.tools.find((x) => x.id === item.toolId);
        if (t) t.guess = guess;
      });
    }
    this.save();
    this.host.push();
    // The primer is the answer to the guess; fetch it now if an AI is there to write it.
    if (!item.primer && (await this.host.aiReady())) await this.toolPrimer(key);
  }

  async toolPrimer(key: string): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "tool") return;
    const catalogued = toolById(item.toolId);
    let files: ChangedFile[] = [];
    await this.host.ask(
      `${key}|primer`,
      async () => {
        const needles = catalogued ? [...catalogued.packages.slice(0, 2), catalogued.name, ...(catalogued.env ?? []).slice(0, 1)] : [item.name];
        files = item.root ? await this.mentions(item.root, needles) : [];
        return toolPrimerPrompt({
          name: item.name,
          job: item.job,
          terms: item.spec?.terms.map((t) => t.term),
          files,
          guess: item.guess,
          depth: await this.host.depth(),
        });
      },
      (reply, by) => {
        const primer = parseToolPrimer(reply, files.map((f) => f.file), false);
        if (!primer) return "The AI's reply could not be read. Try again.";
        item.primer = { ...primer, by };
        this.save();
      },
    );
  }

  /** Puts the vocabulary on the review schedule. The learner's choice, never automatic. */
  async toolAdopt(key: string): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "tool" || item.adopted) return;
    await engine.adoptIdeas(item.termIds, `${item.name}'s vocabulary`);
    item.adopted = true;
    await updateGrowth((g) => {
      const t = g.tools.find((x) => x.id === item.toolId);
      if (t) t.adopted = true;
      addStory(g, { kind: "tool", title: `Started learning ${item.name}`, detail: `${item.job}. Added its ${item.termIds.length} key terms to spaced review.` });
    });
    this.save();
    this.host.push();
  }

  async termQuiz(slot: string, conceptId: string): Promise<void> {
    const quiz = await engine.quizForConcept(conceptId);
    if (quiz) this.tokens.set(quiz.token, { kind: "term", key: slot });
    this.host.post({ type: "quiz", key: slot, quiz });
  }

  async toolDecision(key: string): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "tool") return;
    let files: ChangedFile[] = [];
    await this.host.ask(
      `${key}|decision`,
      async () => {
        files = item.root ? await this.mentions(item.root, [item.name]) : [];
        return decisionsPrompt({ files, tool: item.name, depth: await this.host.depth() });
      },
      (reply, by) => {
        const found = parseDecisions(reply);
        if (!found) return "The AI's reply could not be read. Try again.";
        if (!found.length) return `${by} could not see enough in your project to say why ${item.name} was chosen. Log it yourself in the Grow tab.`;
        item.decision = { ...found[0], by };
        this.save();
      },
    );
  }

  /** Decisions found in one lesson's change, kept for the lesson's page. */
  private readonly lessonDecisions: Record<string, { items: Array<FoundDecision & { saved?: boolean }>; by: string }> = {};

  async lessonDecisionsFind(lessonId: string): Promise<void> {
    await this.host.ask(
      `${lessonId}|decisions`,
      async () => {
        const files = await this.host.lessonFiles(lessonId);
        if (!files.length) return "Miyagi could not find the code for this change any more.";
        return decisionsPrompt({ files, depth: await this.host.depth() });
      },
      (reply, by) => {
        const found = parseDecisions(reply);
        if (!found) return "The AI's reply could not be read. Try again.";
        this.lessonDecisions[lessonId] = { items: found, by };
      },
    );
  }

  lessonDecisionView(): Record<string, unknown> {
    return this.lessonDecisions;
  }

  /** Saves a decision: from a tool page, from a change, or typed by the learner. */
  async saveDecision(from: { key?: string; lesson?: string; index?: number; typed?: { title: string; chose: string; over: string; because: string } }): Promise<string | null> {
    let d: (FoundDecision & { saved?: boolean }) | undefined;
    let root = this.host.roots()[0] ?? "";
    if (from.key) {
      const item = this.item(from.key);
      if (item?.kind === "tool" && item.decision) {
        d = item.decision;
        root = item.root || root;
      }
    } else if (from.lesson && typeof from.index === "number") {
      d = this.lessonDecisions[from.lesson]?.items[from.index];
      root = this.host.lessonInfo(from.lesson)?.root ?? root;
    } else if (from.typed) {
      const t = from.typed;
      if (!t.chose.trim() || !t.because.trim()) return "Say what was chosen and why.";
      d = {
        title: (t.title.trim() || `Chose ${t.chose.trim()}`).slice(0, 120),
        chose: t.chose.trim().slice(0, 120),
        over: t.over.split(/,|\bor\b/).map((x) => x.trim()).filter(Boolean).slice(0, 3),
        because: t.because.trim().slice(0, 500),
        tradeoff: "",
        revisit: "",
        question: null,
      };
    }
    if (!d || d.saved) return null;
    const decision = d;
    const id = `decision-${slugOf(decision.title).slice(0, 30) || Date.now().toString(36)}-${Date.now().toString(36).slice(-4)}`;
    let conceptId: string | undefined;
    if (decision.question) {
      const def: ConceptDefinition = {
        id,
        title: `Why: ${decision.title}`.slice(0, 80),
        emoji: "🧭",
        weight: 45,
        patterns: [],
        hook: `Your project chose ${decision.chose}${decision.over.length ? ` over ${decision.over.join(" or ")}` : ""}.`.slice(0, 200),
        what: decision.because.slice(0, 400),
        lens: [decision.because, decision.tradeoff && `Given up: ${decision.tradeoff}`, decision.revisit && `Revisit when: ${decision.revisit}`].filter(Boolean).join(" ").slice(0, 700),
        pitfall: (decision.tradeoff || "A choice nobody can explain gets reversed by accident, or kept long after the reason for it is gone.").slice(0, 500),
        questions: [{ ...decision.question, distractors: decision.question.distractors.slice(0, 4), level: "Junior" }],
      };
      if (registerConcepts([def], "decision").added.includes(id)) {
        assignTopic(id, "Tooling");
        await engine.adoptIdeas([id], "a decision you logged");
        conceptId = id;
      }
    }
    decision.saved = true;
    await updateGrowth((g) => {
      g.decisions.push({ id, at: new Date().toISOString(), root, title: decision.title, chose: decision.chose, over: decision.over, because: decision.because, ...(decision.tradeoff ? { tradeoff: decision.tradeoff } : {}), ...(decision.revisit ? { revisit: decision.revisit } : {}), ...(conceptId ? { conceptId } : {}) });
      count(g, { kind: "first" });
      addStory(g, { kind: "decision", title: `Chose ${decision.chose}${decision.over.length ? ` over ${decision.over[0]}` : ""}`, detail: decision.because });
    });
    await engine.credit("Decision logged", decision.title, XP_DECISION);
    this.save();
    this.host.push();
    return null;
  }

  /* ---- debugging ------------------------------------------------ */

  /** A command failed, in the learner's terminal or the assistant's. */
  async failed(f: { command: string; output?: string; error?: string; cwd?: string; by: string }): Promise<void> {
    if (!setting("coach.debugging", true) || this.host.quiet()) return;
    const error = f.error ?? errorExcerpt(f.output ?? "");
    const command = scrub(f.command.trim()).slice(0, 300);
    if (!error || !worthCoaching(command, error)) return;
    const root = (f.cwd && this.host.rootOf(f.cwd)) || f.cwd || this.host.roots()[0] || "";
    const signature = errorSignature(command, error);
    const now = Date.now();
    const same = this.items.find((i): i is DebugItem => i.kind === "debug" && i.signature === signature && now - Date.parse(i.at) < DEBUG_REPEAT_MS * (i.repeats + 1));
    if (same) {
      same.repeats++;
      same.at = new Date().toISOString();
      this.save();
      return this.host.push();
    }
    this.debugTimes = this.debugTimes.filter((t) => now - t < 3_600_000);
    if (this.debugTimes.length >= MAX_DEBUG_PER_HOUR) return;
    this.debugTimes.push(now);
    const lines = error.split("\n").slice(0, 8);
    const item: DebugItem = {
      kind: "debug",
      key: `debug:${now.toString(36)}`,
      at: new Date().toISOString(),
      root,
      command,
      by: f.by,
      lines,
      signature,
      repeats: 1,
    };
    this.secrets.set(item.key, { clue: clueLine(lines) });
    this.add(item);
    this.host.announce(1, `Something broke: ${command.slice(0, 60)}`);
    this.host.push();
  }

  debugPick(key: string, line: number): void {
    const item = this.item(key);
    if (item?.kind !== "debug" || item.result || item.revealed) return;
    item.picked = item.picked === line ? undefined : line;
    this.save();
    this.host.push();
  }

  /** Code an error points at, from the file paths it names that exist in the project. */
  private async errorCode(item: DebugItem): Promise<ChangedFile[]> {
    if (!item.root) return [];
    const out: ChangedFile[] = [];
    for (const line of item.lines) {
      const m = /((?:[\w@.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|vue|svelte)):(\d+)/.exec(line);
      if (!m || /node_modules|site-packages|node:internal/.test(line)) continue;
      const file = m[1].replace(/^\.?\//, "");
      const at = Number(m[2]);
      const excerpt = await engine.excerptOfRange(item.root, file, Math.max(0, at - 8), at + 6).catch(() => null);
      if (excerpt && !out.some((o) => o.file === file)) out.push({ file, excerpt });
      if (out.length >= 2) break;
    }
    return out;
  }

  async debugSubmit(key: string, text: string, skipped = false): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "debug" || item.result) return;
    const guess = skipped ? "" : text.trim().slice(0, 800);
    item.guess = guess || undefined;
    const tried = Boolean(guess || item.picked);
    if (!(await this.host.aiReady())) {
      // Without an AI, the reveal is the heuristic clue and a habit to check against.
      item.revealed = this.secrets.get(key)?.clue ?? clueLine(item.lines) ?? 1;
      if (!tried) await this.move({ kind: "aiFirst" });
      this.save();
      return this.host.push();
    }
    let code: ChangedFile[] = [];
    await this.host.ask(
      `${key}|diagnose`,
      async () => {
        code = await this.errorCode(item);
        return diagnosePrompt({ command: item.command, error: item.lines.join("\n"), guess, picked: item.picked ?? null, code, depth: await this.host.depth() });
      },
      async (reply, by) => {
        const d = parseDiagnosis(reply, code.map((c) => c.file), item.lines.length);
        if (!d) return "The AI's reply could not be read. Try again.";
        item.result = { ...d, by };
        const verdict = tried ? d.verdict ?? "wrong" : null;
        await updateGrowth((g) => {
          if (verdict) count(g, { kind: "debug", verdict });
          else count(g, { kind: "aiFirst" });
          g.debug.push({ at: new Date().toISOString(), signature: item.signature, command: item.command, verdict: verdict ?? "skipped" });
          if (verdict === "right") addStory(g, { kind: "debug", title: `Diagnosed a failing \`${item.command.slice(0, 50)}\` before the AI`, detail: d.cause });
        });
        if (verdict) {
          await engine.credit("Read an error first", item.command, XP_DEBUG[verdict]);
          // The skill has its own belt: the first read puts it on the schedule.
          await engine.adoptIdeas([READING_ERRORS], "an error you read");
        }
        this.save();
      },
    );
  }

  /** No AI: the learner compares their read with the clue line and says whether they had it. */
  async debugSelf(key: string, right: boolean): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "debug" || item.self) return;
    item.self = right ? "right" : "wrong";
    await updateGrowth((g) => {
      count(g, { kind: "debug", verdict: right ? "right" : "wrong" });
      g.debug.push({ at: new Date().toISOString(), signature: item.signature, command: item.command, verdict: right ? "self-right" : "self-wrong" });
    });
    await engine.adoptIdeas([READING_ERRORS], "an error you read");
    this.save();
    this.host.push();
  }

  async debugHint(key: string, step: Hint): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "debug") return;
    await this.host.ask(
      `${key}|hint`,
      async () => debugHintPrompt({ command: item.command, error: item.lines.join("\n"), step, depth: await this.host.depth() }),
      (reply, by) => {
        item.hints = { ...(item.hints ?? {}), [step]: reply.trim().slice(0, 400), by };
        this.save();
      },
    );
  }

  /** The project's tracked files, cached for five minutes. */
  private async tracked(root: string): Promise<string[]> {
    const c = this.trackedCache.get(root);
    if (c && Date.now() - c.at < 5 * 60_000) return c.files;
    const files = await trackedFiles(root).catch(() => [] as string[]);
    this.trackedCache.set(root, { at: Date.now(), files });
    return files;
  }

  /* ---- commit check --------------------------------------------- */

  private gateBusy = new Set<string>();

  /** Something was staged. A large staged change earns one question before it is committed. */
  async staged(root: string): Promise<void> {
    const min = setting<number>("coach.commitCheckLines", DEFAULT_GATE_LINES);
    if (!min || min <= 0 || this.host.quiet() || this.gateBusy.has(root)) return;
    this.gateBusy.add(root);
    try {
      const numstat = await run(root, "git", ["diff", "--cached", "--numstat"]);
      if (!numstat) return;
      let lines = 0;
      const files: string[] = [];
      for (const row of numstat.split("\n")) {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(row);
        if (!m) continue;
        lines += m[1] === "-" ? 0 : Number(m[1]);
        files.push(m[3]);
      }
      if (lines < min) {
        // Unstaged since: an open check for this root no longer applies.
        const open = this.items.find((i): i is GateItem => i.kind === "gate" && i.root === root && !i.answered && !i.committed);
        if (open) {
          this.items = this.items.filter((i) => i !== open);
          this.save();
          this.host.push();
        }
        return;
      }
      const signature = `${files.length}:${lines}:${files.slice(0, 20).join("|")}`;
      if (this.items.some((i) => i.kind === "gate" && i.root === root && i.signature === signature)) return;
      // One open check per repository: a re-stage replaces it.
      this.items = this.items.filter((i) => !(i.kind === "gate" && i.root === root && !i.answered && !i.committed));
      this.add({ kind: "gate", key: `gate:${Date.now().toString(36)}`, at: new Date().toISOString(), root, files: files.slice(0, 30), lines, signature });
      this.host.announce(1, `Before you commit: ${lines} lines staged`);
      this.host.push();
    } finally {
      this.gateBusy.delete(root);
    }
  }

  committed(root: string): void {
    let changed = false;
    for (const i of this.items) {
      if (i.kind === "gate" && i.root === root && !i.committed) {
        i.committed = true;
        changed = true;
      }
    }
    if (changed) {
      this.save();
      this.host.push();
    }
  }

  async gateAsk(key: string): Promise<void> {
    const item = this.item(key);
    if (item?.kind !== "gate") return;
    const diff = await run(item.root, "git", ["diff", "--cached", "--no-color", "--no-ext-diff", "-U0"], 10_000);
    const { parseUnifiedDiff } = await import("../../src/concepts.js");
    const changes: FileChange[] = diff ? parseUnifiedDiff(diff) : [];
    const hits = conceptsIn(changes).flatMap((c) => c.concepts.map((x) => x.id));
    const conceptId = hits.find((id) => engine.knownIdea(id)) ?? COMMIT_CHECK;
    if (!(await this.host.aiReady())) {
      // Without an AI: the question of the idea the staged change leans on most.
      const quiz = hits.length ? await engine.quizForConcept(hits[0]) : null;
      if (!quiz) {
        item.noQuestion = true;
        this.save();
        return this.host.push();
      }
      item.token = quiz.token;
      this.tokens.set(quiz.token, { kind: "gate", key });
      this.save();
      return this.host.post({ type: "quiz", key, quiz });
    }
    await this.host.ask(
      `${key}|ask`,
      async () => {
        const files: ChangedFile[] = [];
        for (const c of changes.slice(0, 8)) {
          const excerpt = await engine.excerptOfChange(item.root, c.file, c.added);
          files.push({ file: c.file, excerpt: excerpt ?? c.added.split(/\r?\n/).slice(0, 60).map(scrub).join("\n") });
        }
        if (!files.length) return "Nothing staged any more.";
        return commitQuestionPrompt(files, await this.host.depth());
      },
      (reply) => {
        const q = parseOwnQuestion(reply);
        const quiz = q ? engine.quizFromOwnCode(conceptId, q) : null;
        if (!quiz) return "The AI's question was not usable. Try again.";
        item.token = quiz.token;
        this.tokens.set(quiz.token, { kind: "gate", key });
        this.save();
        this.host.post({ type: "quiz", key, quiz });
      },
    );
  }

  /** Called for every graded answer, so the coach can follow the ones it asked. */
  async answered(token: string, answer: engine.AnswerView | null): Promise<void> {
    if (!answer) return;
    const mine = this.tokens.get(token);
    this.tokens.delete(token);
    if (mine?.kind === "gate") {
      const item = this.item(mine.key);
      if (item?.kind === "gate") {
        item.answered = true;
        item.correct = answer.correct;
        this.save();
      }
      await updateGrowth((g) => {
        g.gates.asked++;
        if (answer.correct) g.gates.right++;
        count(g, { kind: "first" });
      });
    }
    // Belts worth a line in the story: the first that means "held", and black.
    if (answer.correct && (answer.belt === "Green" || answer.belt === "Black")) {
      const quiz = engine.openQuestion(token);
      const about = quiz?.about ?? "";
      await updateGrowth((g) => {
        if (about) addStory(g, { kind: "belt", title: `${answer.belt} belt: ${about}`, detail: answer.belt === "Black" ? "Answered cold after a month, and recognised in another setting." : "Answered from memory after a week's gap." });
      });
    }
    await this.checkConversant();
  }

  private async checkConversant(): Promise<void> {
    const states = await engine.ideaStates();
    for (const t of this.tools.values()) {
      if (t.conversant || !t.adopted || !t.termIds.length) continue;
      if (t.termIds.every((id) => (states.get(id)?.box ?? 0) >= 3)) {
        t.conversant = true;
        await updateGrowth((g) => addStory(g, { kind: "tool", title: `Conversant in ${t.name}`, detail: `Every key term of ${t.name} (${t.job.toLowerCase()}) held at green belt or above.` }));
        this.save();
      }
    }
  }

  /* ---- explain it in your own words ------------------------------ */

  async answerOwnWords(token: string, text: string, confidence: string | null, options: { blackBeltNeedsTransfer: boolean }): Promise<void> {
    const q = engine.openQuestion(token);
    const written = text.trim();
    if (!q || !written) return;
    await this.host.ask(
      `review|own`,
      async () => recallGradePrompt({ idea: q.about, question: q.question, truth: q.answer, why: q.explanation, answer: written, depth: await this.host.depth() }),
      async (reply, by) => {
        const graded = parseAttemptFeedback(reply);
        if (!graded) return "The AI's judgement could not be read. Try again, or show the choices.";
        const { parseConfidence } = await import("./journal.js");
        const answer = await engine.answerInOwnWords(token, written, graded.verdict, parseConfidence(confidence), options);
        await updateGrowth((g) => count(g, { kind: "explained", verdict: graded.verdict }));
        this.ownWords.set(token, { ...graded, by });
        this.host.post({ type: "answered", token, answer: answer && { ...answer, ownWords: { ...graded, by } } });
        await this.answered(token, answer);
      },
    );
  }

  /* ---- changes and commands from the watcher -------------------- */

  /** Every change the watcher reads, before or without a lesson. */
  async changes(root: string, changes: readonly FileChange[], lessonId: string | null): Promise<void> {
    if (this.host.quiet()) return;
    if (setting("coach.tools", true)) {
      const commands = this.recentCommands.filter((c) => Date.now() - c.at < 15 * 60_000).map((c) => c.command);
      for (const hit of detectTools(changes, commands)) {
        const tool = toolById(hit.id);
        if (tool) await this.meetTool(specOf(tool), { root, evidence: hit.evidence, file: hit.file, source: "detected" });
      }
      const unknown = unknownPackages(changes);
      if (lessonId && unknown.length) {
        this.packages[lessonId] = unknown;
        const keep = new Set(Object.keys(this.packages).slice(-40));
        for (const k of Object.keys(this.packages)) if (!keep.has(k)) delete this.packages[k];
      }
    }
    this.save();
  }

  /** A tool the learner's AI named while looking for ideas in a change. */
  async foundTool(root: string, name: string, evidence: string, file: string): Promise<void> {
    const catalogued = findTool(name);
    if (catalogued) await this.meetTool(specOf(catalogued), { root, evidence, file, source: "detected" });
    this.host.push();
  }

  async observed(observations: readonly Observation[]): Promise<void> {
    for (const o of observations) {
      if (o.kind !== "command") continue;
      this.recentCommands.push({ command: o.command, at: Date.parse(o.at) || Date.now(), cwd: o.cwd });
      if (o.failed && o.error) await this.failed({ command: o.command, error: o.error, cwd: o.cwd, by: this.host.sourceName(o.source) || "your assistant" });
      if (setting("coach.tools", true) && !this.host.quiet()) {
        const root = (o.cwd && this.host.rootOf(o.cwd)) || this.host.roots()[0] || "";
        for (const hit of detectTools([], [o.command])) {
          const tool = toolById(hit.id);
          if (tool) await this.meetTool(specOf(tool), { root, evidence: hit.evidence, file: "", source: "detected" });
        }
      }
    }
    this.recentCommands = this.recentCommands.slice(-50);
  }

  /* ---- incidents ------------------------------------------------ */

  async incident(report: string): Promise<void> {
    const text = report.trim().slice(0, 4_000);
    if (text.length < 15) return;
    const ideas = CONCEPTS.filter((c) => !c.id.startsWith("tool-") && !c.id.startsWith("own-") && !c.id.startsWith("decision-") && !c.id.startsWith("incident-")).map((c) => ({ id: c.id, title: c.title }));
    await this.host.ask(
      "grow|incident",
      async () => incidentPrompt({ report: scrub(text), ideas: ideas.slice(0, 60), depth: await this.host.depth() }),
      async (reply, by) => {
        const lesson = parseIncident(reply, ideas.map((i) => i.id));
        if (!lesson) return "The AI's reply could not be read. Try again.";
        const id = `incident-${slugOf(lesson.title).slice(0, 30) || "x"}-${Date.now().toString(36).slice(-4)}`;
        let conceptId: string | undefined;
        if (lesson.question) {
          const def: ConceptDefinition = {
            id,
            title: `Incident: ${lesson.title}`.slice(0, 80),
            emoji: "🔥",
            weight: 70,
            patterns: [],
            hook: lesson.whatBroke.slice(0, 200) || lesson.title,
            what: lesson.cause.slice(0, 400),
            lens: `${lesson.cause} ${lesson.prevention ? `What would have caught it: ${lesson.prevention}` : ""}`.trim().slice(0, 700),
            pitfall: (lesson.prevention || lesson.cause).slice(0, 500),
            questions: [{ ...lesson.question, level: "Junior" }],
          };
          if (registerConcepts([def], "incident").added.includes(id)) {
            assignTopic(id, "Tooling");
            await engine.adoptIdeas([id], "an incident you learned from");
            conceptId = id;
          }
        }
        if (lesson.related) await engine.bringForward(lesson.related);
        await updateGrowth((g) => {
          g.incidents.push({ id, at: new Date().toISOString(), title: lesson.title, whatBroke: lesson.whatBroke, cause: lesson.cause, prevention: lesson.prevention, ...(lesson.related ? { relatedConcept: lesson.related } : {}), ...(conceptId ? { conceptId } : {}) });
          count(g, { kind: "first" });
          addStory(g, { kind: "incident", title: lesson.title, detail: `${lesson.cause} Prevention: ${lesson.prevention}` });
        });
        await engine.credit("Learned from an incident", lesson.title, XP_INCIDENT);
        this.incidentDraft = { lesson: `${by}` };
        this.host.post({ type: "incidentDone", title: lesson.title, related: lesson.related ? CONCEPTS.find((c) => c.id === lesson.related)?.title ?? "" : "" });
      },
    );
  }

  /** A failure seen often enough to be worth a lesson: prefills the incident box. */
  incidentFrom(key: string): string {
    const item = this.item(key);
    if (item?.kind !== "debug") return "";
    return `\`${item.command}\` failed ${item.repeats} times:\n${item.lines.join("\n")}${item.result ? `\nCause: ${item.result.cause}` : ""}`;
  }

  /* ---- blind spots ------------------------------------------------ */

  async skillExercise(id: string): Promise<void> {
    const skill = SKILLS.find((s) => s.id === id);
    const root = this.host.roots()[0];
    if (!skill) return;
    if (!root) {
      this.exercise[id] = { task: skill.tryIt, file: "", done: "", hint: "", by: "Miyagi" };
      return this.host.push();
    }
    let known: string[] = [];
    await this.host.ask(
      `grow|skill|${id}`,
      async () => {
        const files = await this.tracked(root);
        known = files;
        const chosen = chooseFiles(files, { tree: 150, heads: 4 });
        const heads: ChangedFile[] = [];
        for (const f of chosen.heads) {
          const head = await engine.headOf(root, f, 30);
          if (head) heads.push({ file: f, excerpt: head });
        }
        return skillExercisePrompt({ skill: skill.title, why: skill.why, tree: chosen.tree, heads, depth: await this.host.depth() });
      },
      (reply, by) => {
        const task = parseYourTurn(reply, known);
        if (!task) return "The AI's suggestion was not usable. Here is a built-in one instead: " + skill.tryIt;
        this.exercise[id] = { ...task, by, root };
      },
    );
    this.postGrow();
  }

  async skillDone(id: string): Promise<void> {
    const skill = SKILLS.find((s) => s.id === id);
    const ex = this.exercise[id];
    if (!skill || !ex || ex.completed) return;
    ex.completed = true;
    await updateGrowth((g) => {
      count(g, { kind: "unaided" });
      addStory(g, { kind: "turn", title: `Practised: ${skill.title.toLowerCase()}`, detail: ex.task });
    });
    this.postGrow();
  }

  /* ---- the story -------------------------------------------------- */

  async storyAsk(): Promise<void> {
    const g = await loadGrowth();
    const entries = [...g.story].reverse().slice(0, 12);
    if (!entries.length) return;
    this.story = {};
    await this.host.ask(
      "grow|story",
      async () => storyQuestionPrompt(entries),
      (reply, by) => {
        const q = parseStoryQuestion(reply, entries.length);
        if (!q) return "The AI's question could not be read. Try again.";
        this.story = { question: q.question, entry: q.entry - 1, by };
      },
    );
    this.postGrow();
  }

  async storyAnswer(text: string): Promise<void> {
    const g = await loadGrowth();
    const entries = [...g.story].reverse().slice(0, 12);
    const entry = entries[this.story.entry ?? 0];
    if (!this.story.question || !entry || !text.trim()) return;
    await this.host.ask(
      "grow|storyAnswer",
      async () => storyFeedbackPrompt({ question: this.story.question ?? "", answer: text, entry }),
      (reply, by) => {
        const r = parseAttemptFeedback(reply);
        if (!r) return "The AI's feedback could not be read. Try again.";
        this.story.feedback = { ...r, by };
      },
    );
    this.postGrow();
  }

  /** The story as Markdown, for a portfolio, a CV or an interview. */
  async storyMarkdown(): Promise<string> {
    const g = await loadGrowth();
    const by = (k: string) => g.story.filter((e) => e.kind === k);
    const section = (title: string, kinds: string[]) => {
      const rows = kinds.flatMap(by).sort((a, b) => b.at.localeCompare(a.at));
      return rows.length ? [`## ${title}`, "", ...rows.map((e) => `- **${e.title}** (${e.at.slice(0, 10)}). ${e.detail}`), ""] : [];
    };
    const t = trend(g);
    return [
      "# What I have learned building with AI",
      "",
      `_From Miyagi, ${new Date().toISOString().slice(0, 10)}. Every entry is something I did or can recall without help, not something I was shown._`,
      "",
      t.sentence ? `${t.sentence}\n` : "",
      ...section("Tools I can work with", ["tool"]),
      ...section("Decisions I can explain", ["decision"]),
      ...section("Things that broke, and what I learned", ["incident", "debug"]),
      ...section("Ideas I hold", ["belt"]),
      ...section("Built without the AI", ["turn", "check"]),
      g.decisions.length ? ["## Decision log", "", ...g.decisions.map((d) => `### ${d.title}\n\n- Chose: ${d.chose}${d.over.length ? `\n- Over: ${d.over.join(", ")}` : ""}\n- Because: ${d.because}${d.tradeoff ? `\n- Given up: ${d.tradeoff}` : ""}${d.revisit ? `\n- Revisit when: ${d.revisit}` : ""}\n`)].join("\n") : "",
    ]
      .flat()
      .join("\n");
  }

  /** A decision as an architecture decision record, for the repo's docs. */
  async decisionMarkdown(id: string): Promise<string> {
    const d = (await loadGrowth()).decisions.find((x) => x.id === id);
    if (!d) return "";
    return [`# ${d.title}`, "", `Date: ${d.at.slice(0, 10)}`, "", "## Decision", "", `We chose ${d.chose}${d.over.length ? ` over ${d.over.join(", ")}` : ""}.`, "", "## Why", "", d.because, d.tradeoff ? `\n## Consequences\n\n${d.tradeoff}` : "", d.revisit ? `\n## Revisit when\n\n${d.revisit}` : "", ""].join("\n");
  }

  private postGrow(): void {
    void this.grow().then((g) => this.host.post({ type: "grow", data: g }));
  }

  async refreshGrow(): Promise<void> {
    this.postGrow();
  }

  /* ---- odds and ends --------------------------------------------- */

  /**
   * The banner shown when no AI is available. Choosing one hides it, because
   * the banner only shows without an AI; "use built-in ideas" hides it for good.
   */
  async aiOffer(accept: boolean): Promise<void> {
    if (accept) return void (await vscode.commands.executeCommand("miyagi.chooseAi"));
    await this.host.context.globalState.update(NO_AI_OFFER_KEY, true);
    this.host.push();
  }

  dismiss(key: string): void {
    if (key.startsWith("tool:")) {
      const t = this.tools.get(key.slice(5));
      if (t) t.inFeed = false;
    } else {
      this.items = this.items.filter((i) => i.key !== key);
    }
    this.save();
    this.host.push();
  }

  /** "Clear the feed": feed items go; tools stay learnable from the Grow tab. */
  clear(): void {
    this.items = [];
    this.packages = {};
    for (const t of this.tools.values()) t.inFeed = false;
    this.save();
  }

  /** Tools in the feed, and the tool's own page data, by key. */
  toolKeys(): string[] {
    return [...this.tools.values()].map((t) => `tool:${t.toolId}`);
  }

  growthSnapshot(): Promise<Growth> {
    return loadGrowth();
  }
}
