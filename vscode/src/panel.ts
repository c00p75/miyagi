/**
 * The panel.
 *
 * A webview the learner can keep in a side bar or open as a tab beside their
 * editor. It holds the lesson feed, the review queue and the dojo. The webview
 * is a renderer only: every decision (what to teach, how an answer is graded,
 * which AI is asked, what it is asked) happens here, in the extension host,
 * and the webview is sent the whole state each time something changes.
 *
 * Sending everything is deliberate. The same state may be on screen twice (a
 * side bar view and an editor tab), a webview can be thrown away and rebuilt
 * at any moment, and a renderer that keeps its own copy of the truth is a
 * renderer that eventually disagrees with it.
 */

import * as vscode from "vscode";
import path from "node:path";
import { conceptsIn, gitChanges } from "../../src/changes.js";
import { CONCEPTS, scrub, type FileChange } from "../../src/concepts.js";
import type { Observation } from "../../src/observe.js";
import { AudioQueue } from "../../src/tts.js";
import * as engine from "./engine.js";
import { resolveProvider, type AiOptions, type Prompt } from "./ai.js";
import {
  contrastPrompt,
  hintPrompt,
  parseContrast,
  parseYourTurn,
  traceQuestionPrompt,
  transferQuestionPrompt,
  whyQuestionPrompt,
  yourTurnPrompt,
  type Hint,
  type YourTurn,
} from "./prompts.js";
import {
  bugDrillPrompt,
  explainPrompt,
  findIdeasPrompt,
  followUpPrompt,
  gradeAttemptPrompt,
  ownQuestionPrompt,
  parseAttemptFeedback,
  parseBugDrill,
  parseFoundIdeas,
  parseOwnQuestion,
  parseRisks,
  parseWalkthrough,
  riskPrompt,
  walkthroughPrompt,
  type BugDrill,
  type ChangedFile,
  type Risk,
  type Verdict,
  type WalkStep,
} from "./prompts.js";
import { registerFound, registerOwnQuestion } from "./ideas.js";
import { parseConfidence } from "./journal.js";
import { practisedDays, weekProgress, type WeekProgress } from "./reports.js";
import { currentMeter, describeMeter, recordCall, type Meter } from "./meter.js";
import type { QuietReason } from "./schedule.js";
import { assistantReasoning } from "./transcript.js";
import { parseTopic } from "./topics.js";
import type { Scan } from "./watch.js";
import { Coach } from "./coach.js";
import { addStory, count, updateGrowth } from "./growth.js";

const FEED_KEY = "miyagi.feed.v1";
const TOPIC_KEY = "miyagi.topic.v1";
const METER_KEY = "miyagi.meter.v1";
const DEPTH_DISMISSED_KEY = "miyagi.depthSuggestionDismissed.v1";
const MIRROR_KEY = "miyagi.mirror.v1";
/** Questions in an unaided check. */
const CHECK_LENGTH = 10;
/** XP for a small change written without the assistant: more than any single answer. */
const XP_YOUR_TURN = 40;
const MAX_LESSONS = 25;
const MAX_COMMANDS = 30;
/** A change smaller than this is not worth a model call to look for ideas in. */
const MIN_LINES_FOR_AI_IDEAS = 8;
const ATTRIBUTION_WINDOW_MS = 90_000;

const SOURCE_NAMES: Record<Observation["source"], string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  unknown: "",
};

interface Explanation {
  text: string;
  by: string;
}

interface CommandRow {
  command: string;
  count: number;
  info: engine.CommandInfo | null;
}

/** Everything a learner has done with one card beyond reading it. */
interface CardExtra {
  followUps: Array<{ question: string; answer: string; by: string }>;
  /** "Explain it yourself first": the code shown, then what they wrote and how it was judged. */
  attempt?: { code: string; text?: string; verdict?: Verdict; feedback?: string; by?: string };
  /** The answer to a drill stays in the extension host until it is found. */
  bug?: { lines: string[]; hint: string; by: string; wrong: number[]; found: boolean; bugLine?: number; explanation?: string };
  contrast?: { question: string; a: string; b: string; by: string; picked?: "a" | "b"; flawed?: "a" | "b"; explanation?: string };
  /** Help that stops short of the answer: a nudge, then a pointer. */
  hints?: { nudge?: string; pointer?: string; by?: string };
  /** A question the learner is writing, and what was wrong with the last attempt to save it. */
  ownCard?: { saved?: string; problem?: string };
  /** The assistant's own words when it wrote the file, or a note that none were found. */
  why?: { text: string; at: string | null } | { missing: true };
}

interface LessonExtra {
  risks?: { items: Risk[]; by: string };
  walk?: { steps: WalkStep[]; by: string };
  /** A small follow-up change for the learner to write without the assistant. */
  turn?: YourTurn & { by: string; verdict?: "done" | "nothing" | "assisted"; lines?: number; hintShown?: boolean };
}

/** How the learner uses their assistant, counted for one week. Described, never scored. */
interface Mirror {
  week: string;
  /** Files an assistant changed, and the ones the learner then opened. */
  changed: string[];
  opened: string[];
  cards: number;
  explained: number;
  attempted: number;
}

interface SavedFeed {
  lessons: engine.LessonView[];
  explanations: Record<string, Explanation>;
  /** Where each idea was last seen, so the dojo can point at real code. */
  lastSeen?: Record<string, engine.Where>;
}

type Inbound =
  | { type: "ready" }
  | { type: "openFile"; key: string }
  | { type: "openAt"; root: string; file: string; line: number | null }
  | { type: "explain"; key: string }
  | { type: "followUp"; key: string; text: string }
  | { type: "ownQuiz"; key: string }
  | { type: "attempt"; key: string }
  | { type: "attemptSubmit"; key: string; text: string }
  | { type: "bug"; key: string }
  | { type: "why"; key: string }
  | { type: "speak"; key: string }
  | { type: "risks"; lesson: string }
  | { type: "walk"; lesson: string }
  | { type: "walkStep"; lesson: string; index: number }
  | { type: "quiz"; key: string }
  | { type: "answer"; token: string; index: number; confidence?: string }
  | { type: "hint"; key: string; step: Hint }
  | { type: "practice"; key: string; kind: "why" | "trace" | "contrast" | "own" | "bug" | "transfer" }
  | { type: "bugGuess"; key: string; line: number }
  | { type: "bugReveal"; key: string }
  | { type: "contrastPick"; key: string; pick: "a" | "b" }
  | { type: "ownCard"; key: string; question: string; answer: string; wrong: string[]; why: string }
  | { type: "turn"; lesson: string }
  | { type: "turnDone"; lesson: string }
  | { type: "turnHint"; lesson: string }
  | { type: "check" }
  | { type: "recap"; text: string }
  | { type: "review" }
  | { type: "dojo" }
  | { type: "setDepth"; depth: engine.Level }
  | { type: "dismissDepth"; depth: string }
  | { type: "setTopic"; topic: string }
  | { type: "idea"; id: string }
  | { type: "command"; id: string }
  | { type: "openLink"; url: string }
  | { type: "copy"; text: string }
  // The coach: tools, debugging, predictions, commit checks, decisions, growth.
  | { type: "learnAbout"; text: string }
  | { type: "toolGuess"; key: string; text: string }
  | { type: "toolPrimer"; key: string }
  | { type: "toolAdopt"; key: string }
  | { type: "toolDecision"; key: string }
  | { type: "termQuiz"; slot: string; id: string }
  | { type: "saveDecision"; key?: string; lesson?: string; index?: number; typed?: { title: string; chose: string; over: string; because: string } }
  | { type: "lessonDecisions"; lesson: string }
  | { type: "copyDecision"; id: string }
  | { type: "debugPick"; key: string; line: number }
  | { type: "debugSubmit"; key: string; text: string }
  | { type: "debugSkip"; key: string }
  | { type: "debugHint"; key: string; step: Hint }
  | { type: "debugSelf"; key: string; right: boolean }
  | { type: "debugLesson"; key: string }
  | { type: "predictOpen" }
  | { type: "predictLock"; files: string[]; approach: string }
  | { type: "predictDismiss" }
  | { type: "predictApproach"; key: string }
  | { type: "predictWalk"; key: string }
  | { type: "gateAsk"; key: string }
  | { type: "dismissItem"; key: string }
  | { type: "answerOwn"; token: string; text: string; confidence?: string }
  | { type: "findIdeasOffer"; accept: boolean }
  | { type: "grow" }
  | { type: "incident"; text: string }
  | { type: "skillExercise"; id: string }
  | { type: "skillDone"; id: string }
  | { type: "storyAsk" }
  | { type: "storyAnswer"; text: string };

export interface PanelDeps {
  context: vscode.ExtensionContext;
  aiOptions(): Promise<AiOptions>;
  roots(): string[];
  plainRoots(): string[];
  /** Assistants capture is on for, and ones it could be turned on for. */
  capture(): Promise<{ on: string[]; available: string[] }>;
  quiet(): QuietReason;
  /** Called after every state push, for the status bar and reminders. */
  onStatus(status: engine.StatusView): void;
  /** Are changes read and waiting for a stopping point? */
  holding(): boolean;
  /** The watched repository a folder belongs to. */
  rootOf(dir: string): string | undefined;
}

const setting = <T>(key: string, fallback: T): T => vscode.workspace.getConfiguration("miyagi").get<T>(key, fallback);

export class MiyagiPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "miyagi.panel";
  static readonly secondaryViewId = "miyagi.panelSecondary";

  private readonly webviews = new Set<vscode.Webview>();
  private view: vscode.WebviewView | undefined;
  private tab: vscode.WebviewPanel | undefined;

  private lessons: engine.LessonView[] = [];
  private explanations: Record<string, Explanation> = {};
  private lastSeen: Record<string, engine.Where> = {};
  /** Lessons opened from the dojo. They live outside the feed. */
  private readonly ideaCards = new Map<string, engine.CardView>();
  private topic: engine.Topic | null;

  private readonly extras: Record<string, CardExtra> = {};
  private readonly lessonExtras: Record<string, LessonExtra> = {};
  /** slot -> the provider being asked. A slot is `<card or lesson>|<what>`. */
  private readonly busy = new Map<string, { by: string; abort: AbortController }>();
  private readonly errors: Record<string, string> = {};

  private readonly commands = new Map<string, CommandRow>();
  private commandTotal = 0;
  private unseen = 0;
  /** Question ids already asked in this review pass, so a miss is not re-asked at once. */
  private reviewed: string[] = [];

  private seenAssistant: Observation["source"] | null = null;
  /** Files an assistant's hook reported editing, by absolute path. */
  private readonly recentEdits = new Map<string, { source: Observation["source"]; session?: string; at: number }>();
  /** The added lines behind each lesson. Memory only: file contents are not persisted. */
  private readonly changes = new Map<string, FileChange[]>();
  private heartbeat: (Scan & { taught: number }) | null = null;
  private readonly baseline = new Map<string, number>();
  private aiIdeaCalls: number[] = [];
  /** What a drill is hiding, by card. Never sent to the webview before it is found. */
  private readonly secrets = new Map<string, { bugLine?: number; flawed?: "a" | "b"; explanation: string }>();
  private week: { at: number; value: WeekProgress } | null = null;
  /** An unaided check in progress. */
  private check: { plan: string[]; asked: number; correct: number; token: string | null } | null = null;
  /** A capped review, such as the three questions offered after the first commit of the day. */
  private reviewCap: number | null = null;
  /** Lines each file had added when a "your turn" task was proposed. */
  private readonly turnBaselines = new Map<string, { lines: number; at: number }>();
  private turnsProposed = 0;
  private lastDepth: engine.Level = "Junior";
  readonly coach: Coach;

  private readonly voice = { enabled: true, words_per_minute: 180 };
  private readonly audio = new AudioQueue(this.voice);
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
  });

  constructor(private readonly deps: PanelDeps) {
    const saved = deps.context.workspaceState.get<SavedFeed>(FEED_KEY);
    if (saved?.lessons) {
      // Lessons saved by an earlier version lack fields added since.
      this.lessons = saved.lessons.map((l) => ({ ...l, root: l.root ?? l.cards[0]?.root ?? "", files: l.files ?? [] }));
      this.explanations = saved.explanations ?? {};
      this.lastSeen = saved.lastSeen ?? {};
    }
    this.topic = parseTopic(deps.context.globalState.get<string>(TOPIC_KEY));
    this.coach = new Coach({
      context: deps.context,
      ask: (slot, build, use) => this.ask(slot, build, use),
      push: () => void this.pushState(),
      post: (message) => this.post(message),
      depth: async () => (await engine.status()).depth,
      aiReady: async () => Boolean((await this.resolveAi()).provider),
      quiet: () => this.deps.quiet().quiet,
      announce: (count, title) => this.announce(count, title),
      lessonFiles: async (id) => {
        const lesson = this.lesson(id);
        return lesson ? this.changedFiles(lesson) : [];
      },
      lessonInfo: (id) => {
        const lesson = this.lesson(id);
        return lesson ? { root: lesson.root, files: lesson.files } : null;
      },
      walk: (id) => {
        this.post({ type: "openLesson", lesson: id });
        void this.walk(id);
      },
      roots: () => this.deps.roots(),
      rootOf: (dir) => this.deps.rootOf(dir),
      sourceName: (source) => SOURCE_NAMES[source],
    });
  }

  /** Something new arrived: a badge, and a toast if the learner asked for those. */
  private announce(count: number, title: string): void {
    if (!count || this.visible) return void this.pushState();
    this.unseen += count;
    this.badge();
    if (setting<string>("notify", "badge") === "toast" && title) {
      void vscode.window.showInformationMessage(`Miyagi: ${title}`, "Open").then((choice) => {
        if (choice) void vscode.commands.executeCommand("miyagi.open");
      });
    }
    void this.pushState();
  }

  /* ---- webviews -------------------------------------------------- */

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.attach(view.webview);
    view.onDidChangeVisibility(() => {
      if (view.visible) this.seen();
    });
    view.onDidDispose(() => {
      this.webviews.delete(view.webview);
      if (this.view === view) this.view = undefined;
    });
  }

  /** The same panel as an editor tab, for editors whose side bars are taken. */
  openBeside(): void {
    if (this.tab) return this.tab.reveal(undefined, true);
    const media = vscode.Uri.joinPath(this.deps.context.extensionUri, "media");
    const tab = vscode.window.createWebviewPanel(
      "miyagi.tab",
      "Miyagi",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] },
    );
    tab.iconPath = vscode.Uri.joinPath(media, "icon.png");
    this.tab = tab;
    this.attach(tab.webview);
    tab.onDidChangeViewState(() => {
      if (tab.visible) this.seen();
    });
    tab.onDidDispose(() => {
      this.webviews.delete(tab.webview);
      this.tab = undefined;
    });
    this.seen();
  }

  private attach(webview: vscode.Webview): void {
    const media = vscode.Uri.joinPath(this.deps.context.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    webview.html = this.html(webview, media);
    webview.onDidReceiveMessage((message: Inbound) => void this.receive(message));
    this.webviews.add(webview);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js"));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
<title>Miyagi</title>
</head>
<body>
<div id="app" aria-live="polite"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }

  private get visible(): boolean {
    return Boolean(this.view?.visible || this.tab?.visible);
  }

  private seen(): void {
    this.unseen = 0;
    this.badge();
    void this.pushState();
  }

  private post(message: unknown): void {
    for (const webview of this.webviews) void webview.postMessage(message);
  }

  private badge(): void {
    if (!this.view) return;
    this.view.badge =
      this.unseen && setting<string>("notify", "badge") !== "off"
        ? { value: this.unseen, tooltip: `${this.unseen} new idea${this.unseen === 1 ? "" : "s"} from your assistant's work` }
        : undefined;
  }

  private save(): void {
    const keys = new Set(this.lessons.flatMap((l) => l.cards.map((c) => c.key)));
    for (const key of Object.keys(this.explanations)) {
      // Dojo explanations belong to the idea, not to a lesson that can scroll away.
      if (!keys.has(key) && !key.startsWith("dojo:")) delete this.explanations[key];
    }
    void this.deps.context.workspaceState.update(FEED_KEY, {
      lessons: this.lessons,
      explanations: this.explanations,
      lastSeen: this.lastSeen,
    } satisfies SavedFeed);
  }

  private meter(): Meter {
    return currentMeter(this.deps.context.globalState.get(METER_KEY));
  }

  async pushState(): Promise<void> {
    const [status, resolved, capture] = await Promise.all([engine.status(), this.resolveAi(), this.deps.capture()]);
    this.lastDepth = status.depth;
    this.deps.onStatus(status);
    if (!this.webviews.size) return;
    const quiet = this.deps.quiet();
    const dismissed = this.deps.context.globalState.get<string>(DEPTH_DISMISSED_KEY);
    let skipped = 0;
    for (const n of this.baseline.values()) skipped += n;
    this.post({
      type: "state",
      status: {
        ...status,
        // Offered once per depth: a suggestion that returns after "no" is a nag.
        suggestedDepth:
          status.suggestedDepth && dismissed !== `${status.depth}>${status.suggestedDepth}` ? status.suggestedDepth : null,
      },
      topics: engine.TOPICS,
      topic: this.topic,
      lessons: this.lessons,
      explanations: this.explanations,
      extras: this.extras,
      lessonExtras: this.lessonExtras,
      busy: Object.fromEntries([...this.busy].map(([slot, b]) => [slot, b.by])),
      errors: this.errors,
      commands: [...this.commands.values()].slice(-MAX_COMMANDS).reverse(),
      commandTotal: this.commandTotal,
      ai: resolved.provider ? { label: resolved.provider.label } : { label: null, reason: resolved.reason },
      capture,
      watching: setting("watch.enabled", true),
      repos: this.deps.roots().map((r) => path.basename(r)),
      folders: this.deps.plainRoots().map((r) => path.basename(r)),
      heartbeat: this.heartbeat && { ...this.heartbeat, root: path.basename(this.heartbeat.root) },
      skipped,
      quiet: quiet.quiet ? { why: quiet.why, until: quiet.why === "paused" ? quiet.until.toISOString() : null } : null,
      meter: describeMeter(this.meter()),
      findIdeas: setting<string>("ai.findIdeas", "off"),
      recallFirst: setting("recallFirst", true),
      explainFirst: setting("explainFirst", true),
      fadeSupport: setting("fadeSupport", true),
      holding: this.deps.holding(),
      week: await this.weekNow(),
      mirror: this.mirrorLine(),
      check: this.check && { asked: this.check.asked, of: this.check.plan.length + this.check.asked },
      turnsLeft: this.turnsProposed === 0,
      coach: await this.coach.view(),
      lessonDecisions: this.coach.lessonDecisionView(),
      explainBack: setting("explainBack", true) && Boolean(resolved.provider),
      predictions: setting<string>("coach.predictions", "onNewTask"),
    });
  }

  private async weekNow(): Promise<WeekProgress> {
    // The history file is read at most once a minute, not on every redraw.
    if (!this.week || Date.now() - this.week.at > 60_000) {
      this.week = { at: Date.now(), value: weekProgress(await practisedDays(), setting("weeklyGoalDays", 4)) };
    }
    return this.week.value;
  }

  /* ---- the mirror ------------------------------------------------ */

  private mirror(): Mirror {
    const saved = this.deps.context.globalState.get<Mirror>(MIRROR_KEY);
    const week = currentMeter(null).week;
    return saved && saved.week === week && Array.isArray(saved.changed) && Array.isArray(saved.opened)
      ? saved
      : { week, changed: [], opened: [], cards: 0, explained: 0, attempted: 0 };
  }

  private reflect(change: (m: Mirror) => void): void {
    const m = this.mirror();
    change(m);
    m.changed = [...new Set(m.changed)].slice(-600);
    m.opened = [...new Set(m.opened)].filter((f) => m.changed.includes(f));
    void this.deps.context.globalState.update(MIRROR_KEY, m);
  }

  /** Called when the learner brings a file to the front of the editor. */
  opened(file: string): void {
    if (this.mirror().changed.includes(file)) this.reflect((m) => m.opened.push(file));
  }

  /**
   * One neutral sentence, or null when there is too little to say. It is a
   * description of a habit, with no target attached: the point is for the
   * learner to see it, not to be graded on it.
   */
  private mirrorLine(): string | null {
    const m = this.mirror();
    if (m.changed.length < 3) return null;
    const first = `You opened ${m.opened.length} of the ${m.changed.length} files your assistant changed this week.`;
    const second = m.cards
      ? ` Of ${m.cards} card${m.cards === 1 ? "" : "s"}, you tried explaining ${m.attempted} yourself and asked for ${m.explained} explanation${m.explained === 1 ? "" : "s"}.`
      : "";
    return first + second;
  }

  private async resolveAi() {
    const options = await this.deps.aiOptions();
    return resolveProvider({ ...options, seen: this.seenAssistant });
  }

  /* ---- asking the learner's AI ----------------------------------- */

  /**
   * One model call, start to finish: pick the provider, mark the slot busy,
   * count the cost, and turn every way it can go wrong into a sentence on the
   * card. `use` returns a sentence when the reply could not be used.
   */
  private async ask(
    slot: string,
    build: () => Promise<Prompt | string>,
    use: (reply: string, by: string) => string | void | Promise<string | void>,
  ): Promise<void> {
    if (this.busy.has(slot)) return;
    delete this.errors[slot];
    const resolved = await this.resolveAi();
    if (!resolved.provider) {
      this.errors[slot] = resolved.reason;
      return void this.pushState();
    }
    const provider = resolved.provider;
    const abort = new AbortController();
    this.busy.set(slot, { by: provider.label, abort });
    void this.pushState();
    try {
      const prompt = await build();
      if (typeof prompt === "string") {
        if (prompt) this.errors[slot] = prompt;
        return;
      }
      const reply = await provider.run(prompt, abort.signal);
      void this.deps.context.globalState.update(
        METER_KEY,
        recordCall(this.meter(), prompt.system.length + prompt.user.length, reply.length),
      );
      const problem = await use(reply, provider.label);
      if (problem) this.errors[slot] = problem;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason !== "cancelled") this.errors[slot] = `${provider.label} could not answer: ${reason}`;
    } finally {
      this.busy.delete(slot);
      void this.pushState();
    }
  }

  private extra(key: string): CardExtra {
    return (this.extras[key] ??= { followUps: [] });
  }

  private card(key: string): engine.CardView | undefined {
    const idea = this.ideaCards.get(key);
    if (idea) return idea;
    for (const lesson of this.lessons) {
      const card = lesson.cards.find((c) => c.key === key);
      if (card) return card;
    }
    return undefined;
  }

  /**
   * The function a card's evidence sits in, from the editor's own language
   * server. A model that sees one whole function explains it far better than
   * one shown six lines either side of a match, and a find-the-bug exercise
   * cut mid-function is not an exercise. Null when no language server answers
   * in time, the file has no symbols, or the function is too long to send.
   */
  private async enclosingFunction(card: engine.CardView): Promise<string | null> {
    const needle = card.evidence.replace(/…$/, "").trim();
    if (!needle || needle.startsWith("(")) return null;
    const abs = path.isAbsolute(card.file) ? card.file : path.join(card.root, card.file);
    try {
      const uri = vscode.Uri.file(abs);
      const doc = await vscode.workspace.openTextDocument(uri);
      const at = doc.getText().indexOf(needle.slice(0, 60));
      if (at < 0) return null;
      const line = doc.positionAt(at).line;
      const symbols = await Promise.race([
        vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>("vscode.executeDocumentSymbolProvider", uri),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_500)),
      ]);
      if (!Array.isArray(symbols)) return null;
      const callable = new Set([
        vscode.SymbolKind.Function,
        vscode.SymbolKind.Method,
        vscode.SymbolKind.Constructor,
        vscode.SymbolKind.Variable,
        vscode.SymbolKind.Constant,
        vscode.SymbolKind.Property,
      ]);
      // The innermost callable that contains the line and is short enough to read.
      let best: vscode.Range | null = null;
      const visit = (list: readonly vscode.DocumentSymbol[]) => {
        for (const symbol of list) {
          if (!symbol.range || line < symbol.range.start.line || line > symbol.range.end.line) continue;
          const length = symbol.range.end.line - symbol.range.start.line + 1;
          if (callable.has(symbol.kind) && length >= 3 && length <= 70) best = symbol.range;
          visit(symbol.children ?? []);
        }
      };
      visit(symbols);
      const range = best as vscode.Range | null;
      return range ? await engine.excerptOfRange(card.root, card.file, range.start.line, range.end.line) : null;
    } catch {
      return null;
    }
  }

  /** The learner's lines for a card: the enclosing function, else where the pattern matches, else around the evidence. */
  private async excerpt(card: engine.CardView): Promise<string | null> {
    if (!card.file) return null;
    return (
      (await this.enclosingFunction(card)) ??
      (await engine.excerptFor(card.conceptId, card.root, card.file)) ??
      (card.evidence ? await engine.excerptOfChange(card.root, card.file, card.evidence.replace(/…$/, "")) : null)
    );
  }

  private readonly needsCode =
    "Miyagi could not read the lines this idea was seen in. The file may have been moved or deleted.";

  private async explain(key: string): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    await this.ask(
      `${key}|explain`,
      async () =>
        explainPrompt({
          title: card.title,
          what: card.what,
          depth: (await engine.status()).depth,
          file: card.file,
          excerpt: await this.excerpt(card),
          evidence: card.evidence,
        }),
      (text, by) => {
        this.explanations[key] = { text, by };
        this.reflect((m) => m.explained++);
        this.save();
        if (setting("voice.autoRead", false)) this.speakText(text);
      },
    );
  }

  private async followUp(key: string, question: string): Promise<void> {
    const card = this.card(key);
    const asked = question.trim();
    if (!card || !asked) return;
    await this.ask(
      `${key}|followUp`,
      async () =>
        followUpPrompt({
          title: card.title,
          file: card.file,
          excerpt: await this.excerpt(card),
          explanation: this.explanations[key]?.text ?? "",
          earlier: this.extra(key).followUps,
          question: asked,
          depth: (await engine.status()).depth,
        }),
      (answer, by) => {
        this.extra(key).followUps.push({ question: asked, answer, by });
      },
    );
  }

  private async ownQuiz(key: string): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    await this.ask(
      `${key}|ownQuiz`,
      async () => {
        const excerpt = await this.excerpt(card);
        if (!excerpt) return this.needsCode;
        return ownQuestionPrompt({ title: card.title, file: card.file, excerpt, depth: (await engine.status()).depth });
      },
      (reply) => {
        const question = parseOwnQuestion(reply);
        const quiz = question ? engine.quizFromOwnCode(card.conceptId, question) : null;
        if (!quiz) return "The AI's reply was not a usable question. Try again.";
        this.post({ type: "quiz", key: `${key}|own`, quiz });
      },
    );
  }

  /** Step one of "explain it yourself first" costs nothing: it only shows the code. */
  private async attemptStart(key: string): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    const code = await this.excerpt(card);
    if (!code) this.errors[`${key}|attempt`] = this.needsCode;
    else this.extra(key).attempt = { code };
    void this.pushState();
  }

  private async attemptSubmit(key: string, text: string): Promise<void> {
    const card = this.card(key);
    const attempt = this.extra(key).attempt;
    const wrote = text.trim();
    if (!card || !attempt || !wrote) return;
    attempt.text = wrote;
    await this.ask(
      `${key}|attempt`,
      async () =>
        gradeAttemptPrompt({
          title: card.title,
          excerpt: attempt.code,
          attempt: wrote,
          depth: (await engine.status()).depth,
        }),
      (reply, by) => {
        const feedback = parseAttemptFeedback(reply);
        if (!feedback) return "The AI's reply could not be read. Try again.";
        Object.assign(attempt, feedback, { by });
        this.reflect((m) => m.attempted++);
        void updateGrowth((g) => count(g, { kind: "explained", verdict: feedback.verdict }));
      },
    );
    // Their explanation first, then the model's, so the two can be compared.
    if (attempt.verdict && !this.explanations[key]) await this.explain(key);
  }

  /** One rung of the ladder: a nudge, then a pointer. The full explanation is `explain`. */
  private async hint(key: string, step: Hint): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    await this.ask(
      `${key}|hint`,
      async () => {
        const excerpt = (this.extra(key).attempt?.code ?? (await this.excerpt(card))) || "";
        if (!excerpt) return this.needsCode;
        return hintPrompt({ step, title: card.title, file: card.file, excerpt, depth: (await engine.status()).depth });
      },
      (reply, by) => {
        const hints = (this.extra(key).hints ??= {});
        hints[step] = reply.slice(0, 500);
        hints.by = by;
      },
    );
  }

  /** The other kinds of question: why, trace, and the same idea in another language. */
  private async practiceQuestion(key: string, kind: "why" | "trace" | "transfer"): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    await this.ask(
      `${key}|${kind}`,
      async () => {
        const depth = (await engine.status()).depth;
        if (kind === "transfer") return transferQuestionPrompt({ title: card.title, what: card.what, file: card.file || "code", depth });
        const excerpt = await this.excerpt(card);
        if (!excerpt) return this.needsCode;
        const req = { title: card.title, file: card.file, excerpt, depth };
        return kind === "why" ? whyQuestionPrompt(req) : traceQuestionPrompt(req);
      },
      (reply) => {
        const question = parseOwnQuestion(reply);
        const quiz = question ? engine.quizFromOwnCode(card.conceptId, question, { transfer: kind === "transfer" }) : null;
        if (!quiz) return "The AI's reply was not a usable question. Try again.";
        this.post({ type: "quiz", key: `${key}|${kind}`, quiz });
      },
    );
  }

  private async contrast(key: string): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    await this.ask(
      `${key}|contrast`,
      async () => {
        const excerpt = await this.excerpt(card);
        if (!excerpt) return this.needsCode;
        return contrastPrompt({ title: card.title, excerpt, depth: (await engine.status()).depth });
      },
      (reply, by) => {
        const pair = parseContrast(reply);
        // An unusable pair is dropped quietly: the learner asked for practice, not for an error.
        if (!pair) return "That exercise did not come out usable. Try again, or pick another kind.";
        this.secrets.set(`${key}|contrast`, { flawed: pair.flawed, explanation: pair.explanation });
        this.extra(key).contrast = { question: pair.question, a: pair.a, b: pair.b, by };
      },
    );
  }

  private contrastPick(key: string, pick: "a" | "b"): void {
    const exercise = this.extras[key]?.contrast;
    const secret = this.secrets.get(`${key}|contrast`);
    if (!exercise || !secret?.flawed || exercise.picked) return;
    Object.assign(exercise, { picked: pick, flawed: secret.flawed, explanation: secret.explanation });
    void this.pushState();
  }

  private bugGuess(key: string, line: number | null): void {
    const drill = this.extras[key]?.bug;
    const secret = this.secrets.get(`${key}|bug`);
    if (!drill || !secret?.bugLine || drill.found) return;
    if (line === null || line === secret.bugLine) {
      Object.assign(drill, { found: true, bugLine: secret.bugLine, explanation: secret.explanation });
    } else if (!drill.wrong.includes(line)) {
      drill.wrong.push(line);
    }
    void this.pushState();
  }

  /** A question the learner wrote. No model involved. */
  private async ownCard(key: string, input: { question: string; answer: string; wrong: string[]; why: string }): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    const result = await registerOwnQuestion({ conceptId: card.conceptId, title: card.title, topic: card.topic }, input);
    if ("problem" in result) {
      this.extra(key).ownCard = { problem: result.problem };
    } else {
      await engine.adopt(result.id);
      this.extra(key).ownCard = { saved: result.id };
    }
    void this.pushState();
  }

  /* ---- your turn ------------------------------------------------- */

  private async addedLines(root: string, file: string): Promise<number> {
    const found = await gitChanges(root).catch(() => null);
    return found?.kind === "working-tree" ? found.changes.find((c) => c.file === file)?.addedLines ?? 0 : 0;
  }

  /** Proposes one small change for the learner to write by hand. */
  private async turn(id: string): Promise<void> {
    const lesson = this.lesson(id);
    if (!lesson) return;
    let files: string[] = [];
    await this.ask(
      `${id}|turn`,
      async () => {
        const changed = await this.changedFiles(lesson);
        if (!changed.length) return this.noChange;
        files = changed.map((c) => c.file);
        return yourTurnPrompt(changed, (await engine.status()).depth);
      },
      async (reply, by) => {
        const task = parseYourTurn(reply, files);
        if (!task) return "The AI's suggestion was not usable (it may have written the code for you). Try again.";
        (this.lessonExtras[id] ??= {}).turn = { ...task, by };
        this.turnBaselines.set(id, { lines: await this.addedLines(lesson.root, task.file), at: Date.now() });
        this.turnsProposed++;
      },
    );
  }

  /**
   * Checks the diff, never the learner's word and never the file's contents:
   * did the file gain lines since the task was set, and did an assistant's
   * hook report editing it in that time? Miyagi does not write the change, and
   * does not judge whether it is correct. It only confirms who wrote it.
   */
  private async turnDone(id: string): Promise<void> {
    const lesson = this.lesson(id);
    const turn = this.lessonExtras[id]?.turn;
    const baseline = this.turnBaselines.get(id);
    if (!lesson || !turn || !baseline || turn.verdict === "done") return;
    const abs = path.join(lesson.root, turn.file);
    const edit = this.recentEdits.get(abs);
    const gained = (await this.addedLines(lesson.root, turn.file)) - baseline.lines;
    if (edit && edit.at > baseline.at) {
      turn.verdict = "assisted";
    } else if (gained <= 0) {
      turn.verdict = "nothing";
    } else {
      turn.verdict = "done";
      turn.lines = gained;
      await engine.creditUnaided(turn.task, XP_YOUR_TURN);
      await updateGrowth((g) => {
        count(g, { kind: "unaided" });
        addStory(g, { kind: "turn", title: `Wrote it without the AI: ${turn.task.slice(0, 80)}`, detail: `${gained} lines in ${turn.file}, checked against the diff.` });
      });
    }
    void this.pushState();
  }

  /* ---- the unaided check ----------------------------------------- */

  private async checkNext(): Promise<void> {
    if (!this.check) {
      const plan = await engine.checkPlan(CHECK_LENGTH);
      if (!plan.length) return this.post({ type: "review", quiz: null });
      this.check = { plan, asked: 0, correct: 0, token: null };
    }
    const next = this.check.plan.shift();
    const quiz = next ? await engine.quizForCheck(next) : null;
    if (!quiz) {
      const result = await engine.recordCheck(this.check.asked, this.check.correct);
      this.check = null;
      if (result && result.correct / result.asked >= 0.8) {
        await updateGrowth((g) =>
          addStory(g, { kind: "check", title: `Unaided check: ${result.correct} of ${result.asked}`, detail: "Answered with every kind of help switched off." }),
        );
      }
      this.post({ type: "review", quiz: null, checked: result });
      return void this.pushState();
    }
    this.check.token = quiz.token;
    this.check.asked++;
    this.post({ type: "review", quiz });
    void this.pushState();
  }

  /** What Miyagi saw today, to set beside what the learner remembers of it. No model call. */
  private recap(text: string): void {
    const today = new Date().toDateString();
    const lessons = this.lessons.filter((l) => new Date(l.at).toDateString() === today);
    this.post({
      type: "recap",
      wrote: text.trim().slice(0, 2_000),
      files: [...new Set(lessons.flatMap((l) => l.files))].slice(0, 30),
      ideas: [...new Set(lessons.flatMap((l) => l.cards.map((c) => `${c.emoji} ${c.title}`)))],
      commands: this.commandTotal,
    });
  }

  /** A short review, such as the three questions offered after the first commit of the day. */
  beginCheck(): void {
    this.post({ type: "startCheck" });
  }

  beginRecap(): void {
    this.post({ type: "startRecap" });
  }

  startReview(cap: number | null): void {
    this.reviewCap = cap;
    this.reviewed = [];
    this.post({ type: "tab", tab: "review" });
  }

  private async bug(key: string): Promise<void> {
    const card = this.card(key);
    if (!card) return;
    await this.ask(
      `${key}|bug`,
      async () => {
        const excerpt = await this.excerpt(card);
        if (!excerpt) return this.needsCode;
        return bugDrillPrompt({ title: card.title, excerpt, depth: (await engine.status()).depth });
      },
      (reply, by) => {
        const drill = parseBugDrill(reply);
        if (!drill) return "The AI's reply was not a usable exercise. Try again.";
        this.secrets.set(`${key}|bug`, { bugLine: drill.bugLine, explanation: drill.explanation });
        this.extra(key).bug = { lines: drill.lines, hint: drill.hint, by, wrong: [], found: false };
      },
    );
  }

  /** The assistant's own words. No model call: they are already on disk. */
  private async why(key: string): Promise<void> {
    const card = this.card(key);
    if (!card?.file) return;
    const abs = path.isAbsolute(card.file) ? card.file : path.join(card.root, card.file);
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const found = await assistantReasoning({
      session: this.recentEdits.get(abs)?.session,
      cwds: [...new Set([card.root, ...folders])],
      file: abs,
    });
    this.extra(key).why = found ?? { missing: true };
    void this.pushState();
  }

  /* ---- a whole change -------------------------------------------- */

  private lesson(id: string): engine.LessonView | undefined {
    return this.lessons.find((l) => l.id === id);
  }

  /** The changed lines of a lesson, numbered as they sit in the files now. */
  private async changedFiles(lesson: engine.LessonView): Promise<ChangedFile[]> {
    let changes = this.changes.get(lesson.id);
    if (!changes) {
      // After a reload the lines are gone from memory; git still has them
      // until the change is committed.
      const found = await gitChanges(lesson.root).catch(() => null);
      const wanted = new Set(lesson.files.length ? lesson.files : lesson.cards.map((c) => c.file));
      changes = (found?.changes ?? []).filter((c) => wanted.has(c.file));
    }
    const out: ChangedFile[] = [];
    for (const change of changes.slice(0, 8)) {
      const excerpt =
        (await engine.excerptOfChange(lesson.root, change.file, change.added)) ??
        change.added.split(/\r?\n/).slice(0, 60).map(scrub).join("\n");
      out.push({ file: change.file, excerpt });
    }
    if (out.length) return out;
    // Committed since, so git has no diff left to show. The code is still in
    // the files, though: use each card's lines as they stand now.
    const seen = new Set<string>();
    for (const card of lesson.cards) {
      if (!card.file || seen.has(card.file) || out.length >= 8) continue;
      seen.add(card.file);
      const excerpt = await this.excerpt(card);
      if (excerpt) out.push({ file: card.file, excerpt });
    }
    return out;
  }

  private readonly noChange =
    "Miyagi could not find the code for this change. The files it touched have probably been moved or deleted since.";

  private async risks(id: string): Promise<void> {
    const lesson = this.lesson(id);
    if (!lesson) return;
    let files: string[] = [];
    await this.ask(
      `${id}|risks`,
      async () => {
        const changed = await this.changedFiles(lesson);
        if (!changed.length) return this.noChange;
        files = changed.map((c) => c.file);
        return riskPrompt(changed, (await engine.status()).depth);
      },
      (reply, by) => {
        const items = parseRisks(reply, files);
        if (!items) return "The AI's reply could not be read. Try again.";
        (this.lessonExtras[id] ??= {}).risks = { items, by };
      },
    );
  }

  private async walk(id: string): Promise<void> {
    const lesson = this.lesson(id);
    if (!lesson) return;
    let files: string[] = [];
    await this.ask(
      `${id}|walk`,
      async () => {
        const changed = await this.changedFiles(lesson);
        if (!changed.length) return this.noChange;
        files = changed.map((c) => c.file);
        return walkthroughPrompt(changed, (await engine.status()).depth);
      },
      (reply, by) => {
        const steps = parseWalkthrough(reply, files);
        if (!steps) return "The AI's reply was not a usable walkthrough. Try again.";
        (this.lessonExtras[id] ??= {}).walk = { steps, by };
        void this.walkStep(id, 0);
      },
    );
  }

  private async walkStep(id: string, index: number): Promise<void> {
    const lesson = this.lesson(id);
    const step = this.lessonExtras[id]?.walk?.steps[index];
    if (!lesson || !step) return;
    if (step.file) await this.openAt(lesson.root, step.file, step.line, true);
    if (setting("voice.autoRead", false)) this.speakText(`${step.title}. ${step.text}`);
  }

  /* ---- the editor ------------------------------------------------ */

  private async openAt(root: string, file: string, line: number | null, keepFocus = false): Promise<boolean> {
    const abs = path.isAbsolute(file) ? file : path.join(root, file);
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      // Column one, so a panel open as a tab beside the code is not replaced by the code.
      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: keepFocus,
        viewColumn: this.tab ? vscode.ViewColumn.One : undefined,
      });
      if (line && line <= doc.lineCount) {
        const range = doc.lineAt(line - 1).range;
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.setDecorations(this.highlight, [range]);
      }
      return true;
    } catch {
      void vscode.window.showWarningMessage(`Miyagi could not open ${file}. It may have been moved or deleted.`);
      return false;
    }
  }

  private async openFile(key: string): Promise<void> {
    const card = this.card(key);
    if (!card || !card.file) return;
    const abs = path.isAbsolute(card.file) ? card.file : path.join(card.root, card.file);
    let line: number | null = null;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      const needle = card.evidence.replace(/…$/, "").trim();
      const index = needle && !needle.startsWith("(") ? doc.getText().indexOf(needle.slice(0, 60)) : -1;
      if (index >= 0) line = doc.positionAt(index).line + 1;
    } catch {
      // openAt reports the failure.
    }
    await this.openAt(card.root, card.file, line);
  }

  /* ---- voice ----------------------------------------------------- */

  private speakText(text: string): void {
    this.voice.words_per_minute = Math.max(90, Math.min(360, setting("voice.wordsPerMinute", 180)));
    this.audio.enqueue(text);
  }

  private speak(key: string): void {
    const card = this.card(key);
    if (!card) return;
    // Pressing it again while more is queued is how you stop it.
    if (this.audio.pending) return this.audio.clear();
    this.speakText(
      [
        card.title,
        card.hook,
        card.what,
        card.lens[this.lastDepth],
        `How it goes wrong. ${card.pitfall}`,
        this.explanations[key]?.text ?? "",
      ]
        .filter(Boolean)
        .join(". "),
    );
  }

  /* ---- things that arrive from the watcher ----------------------- */

  private attribution(root: string, files: readonly string[]): string | undefined {
    const now = Date.now();
    for (const file of files) {
      const edit = this.recentEdits.get(path.isAbsolute(file) ? file : path.join(root, file));
      if (edit && now - edit.at < ATTRIBUTION_WINDOW_MS && SOURCE_NAMES[edit.source]) return SOURCE_NAMES[edit.source];
    }
    return undefined;
  }

  async teach(root: string, source: string, changes: readonly FileChange[], repeat = false): Promise<number> {
    const files = changes.map((c) => c.file);
    const lesson = await engine.teach({
      changes: conceptsIn(changes),
      root,
      source,
      limit: setting("ideasPerChange", 2),
      repeat,
      focus: this.topic,
      files,
    });
    if (lesson) {
      lesson.by = this.attribution(root, files);
      this.changes.set(lesson.id, [...changes]);
    }
    const cards = this.addLesson(lesson);
    if (this.heartbeat && this.heartbeat.root === root) this.heartbeat.taught += cards;
    await this.coach.changes(root, changes, lesson?.id ?? null);

    const mode = setting<string>("ai.findIdeas", "off");
    if (!repeat && (mode === "always" || (mode === "whenNothingFound" && !cards))) {
      void this.findIdeas(root, source, changes);
    }
    void this.pushState();
    return cards;
  }

  /**
   * Asks the learner's AI what in a change is worth a lesson, when they have
   * turned that on. Rate-limited, because it runs without a button press and
   * spends their allowance.
   */
  private async findIdeas(root: string, source: string, changes: readonly FileChange[]): Promise<void> {
    const lines = changes.reduce((n, c) => n + c.addedLines, 0);
    if (lines < MIN_LINES_FOR_AI_IDEAS || this.deps.quiet().quiet) return;
    const hourAgo = Date.now() - 3_600_000;
    this.aiIdeaCalls = this.aiIdeaCalls.filter((t) => t > hourAgo);
    if (this.aiIdeaCalls.length >= Math.max(1, setting("ai.findIdeasPerHour", 6))) return;
    this.aiIdeaCalls.push(Date.now());

    const slot = `${root}|findIdeas`;
    const files: string[] = [];
    await this.ask(
      slot,
      async () => {
        const changed: ChangedFile[] = [];
        for (const change of changes.slice(0, 8)) {
          const excerpt = await engine.excerptOfChange(root, change.file, change.added);
          if (excerpt) changed.push({ file: change.file, excerpt });
        }
        // Nothing readable is not worth telling the learner about; they did not ask.
        if (!changed.length) return "";
        files.push(...changed.map((c) => c.file));
        return findIdeasPrompt(changed, CONCEPTS.map((c) => c.title), (await engine.status()).depth);
      },
      async (reply, by) => {
        const parsed = parseFoundIdeas(reply, files);
        if (!parsed?.length) return;
        // A tool is taught as a track of its own, not as one more idea card.
        for (const tool of parsed.filter((f) => f.kind === "tool")) {
          await this.coach.foundTool(root, tool.title, scrub(tool.evidence) || tool.title, tool.file);
        }
        const found = parsed.filter((f) => f.kind !== "tool");
        if (!found.length) return;
        const registered = await registerFound(found);
        if (!registered.length) return;
        const lesson = await engine.teach({
          changes: registered.map((r) => ({
            file: r.idea.file || files[0],
            concepts: [{ id: r.id, count: 1, evidence: scrub(r.idea.evidence) }],
          })),
          root,
          source: `${source}, found by ${by}`,
          limit: 2,
          focus: this.topic,
          files,
        });
        if (lesson) {
          lesson.by = this.attribution(root, files);
          this.changes.set(lesson.id, [...changes]);
          if (this.heartbeat && this.heartbeat.root === root) this.heartbeat.taught += lesson.cards.length;
          this.addLesson(lesson);
        }
      },
    );
    // A background call that failed is not the learner's problem to read about.
    delete this.errors[slot];
  }

  private addLesson(lesson: engine.LessonView | null): number {
    if (!lesson) return 0;
    this.lessons = [lesson, ...this.lessons].slice(0, MAX_LESSONS);
    for (const id of [...this.changes.keys()]) if (!this.lesson(id)) this.changes.delete(id);
    for (const card of lesson.cards) {
      this.lastSeen[card.conceptId] = {
        root: card.root,
        file: card.file,
        otherFiles: card.otherFiles,
        evidence: card.evidence,
      };
    }
    this.save();
    this.reflect((m) => {
      m.cards += lesson.cards.length;
      // Only files an assistant is known to have written belong in the mirror.
      if (lesson.by) m.changed.push(...lesson.files.map((f) => path.join(lesson.root, f)));
    });
    if (lesson.cards.length && !this.visible) {
      this.unseen += lesson.cards.length;
      this.badge();
      if (setting<string>("notify", "badge") === "toast") {
        const titles = lesson.cards.map((c) => c.title).join(", ");
        void vscode.window
          .showInformationMessage(`Miyagi: worth understanding in ${lesson.source}: ${titles}`, "Open")
          .then((choice) => {
            if (choice) void vscode.commands.executeCommand("miyagi.open");
          });
      }
    }
    if (setting<string>("ai.explain", "onDemand") === "auto") {
      for (const card of lesson.cards) void this.explain(card.key);
    }
    if (setting("voice.autoRead", false) && lesson.cards[0]) {
      this.speakText(`New idea. ${lesson.cards[0].title}. ${lesson.cards[0].hook}`);
    }
    return lesson.cards.length;
  }

  scanned(scan: Scan): void {
    this.heartbeat = { ...scan, taught: 0 };
    void this.pushState();
  }

  baselined(root: string, files: number): void {
    this.baseline.set(root, files);
    void this.pushState();
  }

  /** Once the learner has asked for their uncommitted changes, they are no longer "skipped". */
  clearBaseline(): void {
    this.baseline.clear();
  }

  async observed(observations: readonly Observation[]): Promise<void> {
    const status = await engine.status();
    for (const o of observations) {
      if (o.source !== "unknown") this.seenAssistant = o.source;
      if (o.kind === "command") {
        this.commandTotal++;
        const row = this.commands.get(o.command);
        // Re-inserted so the map stays ordered by most recent use.
        this.commands.delete(o.command);
        this.commands.set(o.command, {
          command: o.command,
          count: (row?.count ?? 0) + 1,
          info: row?.info ?? engine.commandInfo(o.command, status.depth),
        });
        continue;
      }
      if (o.kind !== "edit" || !o.cwd) continue;
      const abs = path.isAbsolute(o.file) ? o.file : path.join(o.cwd, o.file);
      const at = Date.parse(o.at) || Date.now();
      this.recentEdits.set(abs, { source: o.source, session: o.session, at });
      this.reflect((m) => m.changed.push(abs));
      // The git read often lands first. Credit the lesson it already made.
      const name = SOURCE_NAMES[o.source];
      for (const lesson of this.lessons) {
        if (lesson.by || !name || Math.abs(at - Date.parse(lesson.at)) > ATTRIBUTION_WINDOW_MS) continue;
        if (lesson.files.some((f) => path.join(lesson.root, f) === abs)) lesson.by = name;
      }
      if (o.concepts.length && !this.deps.quiet().quiet) {
        // Usually the git watcher has already taught this edit and the session
        // filter drops it. This is the path for edits git never sees.
        const lesson = await engine.teach({
          changes: [{ file: o.file, concepts: o.concepts }],
          root: o.cwd,
          source: o.file,
          limit: setting("ideasPerChange", 2),
          focus: this.topic,
        });
        if (lesson) lesson.by = name || undefined;
        this.addLesson(lesson);
      }
    }
    await this.coach.observed(observations);
    while (this.commands.size > MAX_COMMANDS) this.commands.delete(this.commands.keys().next().value as string);
    while (this.recentEdits.size > 400) this.recentEdits.delete(this.recentEdits.keys().next().value as string);
    void this.pushState();
  }

  clear(): void {
    for (const b of this.busy.values()) b.abort.abort();
    this.busy.clear();
    this.lessons = [];
    // What was written for a dojo idea is kept; it was not part of the feed.
    for (const key of Object.keys(this.explanations)) if (!key.startsWith("dojo:")) delete this.explanations[key];
    for (const key of Object.keys(this.extras)) if (!key.startsWith("dojo:")) delete this.extras[key];
    for (const key of Object.keys(this.lessonExtras)) delete this.lessonExtras[key];
    for (const key of Object.keys(this.errors)) delete this.errors[key];
    this.changes.clear();
    this.commands.clear();
    this.commandTotal = 0;
    this.unseen = 0;
    this.coach.clear();
    engine.forgetSession();
    this.badge();
    this.save();
    void this.pushState();
  }

  /** The feed reduced to what a test needs to assert on. */
  summary(): Array<{ source: string; concepts: string[] }> {
    return this.lessons.map((l) => ({ source: l.source, concepts: l.cards.map((c) => c.conceptId) }));
  }

  showTab(tab: "now" | "review" | "dojo" | "grow"): void {
    this.post({ type: "tab", tab });
  }

  /* ---- messages from the webview --------------------------------- */

  private async receive(message: Inbound): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          return void (await this.pushState());
        case "openFile":
          return void (await this.openFile(message.key));
        case "openAt":
          return void (await this.openAt(message.root, message.file, message.line));
        case "explain":
          // Asking before trying is the AI going first. Counted, never scolded.
          if (!this.extras[message.key]?.attempt) void updateGrowth((g) => count(g, { kind: "aiFirst" }));
          return void (await this.explain(message.key));
        case "followUp":
          return void (await this.followUp(message.key, message.text));
        case "ownQuiz":
          return void (await this.ownQuiz(message.key));
        case "attempt":
          return void (await this.attemptStart(message.key));
        case "attemptSubmit":
          return void (await this.attemptSubmit(message.key, message.text));
        case "bug":
          return void (await this.bug(message.key));
        case "why":
          return void (await this.why(message.key));
        case "speak":
          return this.speak(message.key);
        case "risks":
          return void (await this.risks(message.lesson));
        case "walk":
          return void (await this.walk(message.lesson));
        case "walkStep":
          return void (await this.walkStep(message.lesson, message.index));
        case "quiz": {
          const card = this.card(message.key);
          const quiz = card ? await engine.quizForConcept(card.conceptId) : null;
          return this.post({ type: "quiz", key: message.key, quiz });
        }
        case "answer": {
          const questionId = engine.questionIdFor(message.token);
          if (questionId) this.reviewed.push(questionId);
          const answer = await engine.answer(message.token, message.index, parseConfidence(message.confidence), {
            // Without an AI there is nobody to write a transfer question, so nothing may wait on one.
            blackBeltNeedsTransfer: setting("blackBeltNeedsTransfer", true) && Boolean((await this.resolveAi()).provider),
          });
          if (this.check && this.check.token === message.token && answer?.correct) this.check.correct++;
          this.week = null;
          this.post({ type: "answered", token: message.token, answer });
          await this.coach.answered(message.token, answer);
          return void (await this.pushState());
        }
        case "answerOwn": {
          const questionId = engine.questionIdFor(message.token);
          if (questionId) this.reviewed.push(questionId);
          await this.coach.answerOwnWords(message.token, String(message.text ?? ""), message.confidence ?? null, {
            blackBeltNeedsTransfer: setting("blackBeltNeedsTransfer", true),
          });
          this.week = null;
          return void (await this.pushState());
        }
        case "review": {
          if (this.check) return void (await this.checkNext());
          if (this.reviewCap !== null && this.reviewCap <= 0) {
            this.reviewCap = null;
            this.reviewed = [];
            return this.post({ type: "review", quiz: null });
          }
          // Unaided checks stay multiple choice: the point there is no help at all, including an AI judge.
          const explainBack = !this.check && setting("explainBack", true) && Boolean((await this.resolveAi()).provider);
          const quiz = await engine.nextReview(this.reviewed, this.topic, setting("mixTopicsInReview", true), { explainBack });
          if (!quiz) {
            this.reviewed = [];
            this.reviewCap = null;
          } else if (this.reviewCap !== null) this.reviewCap--;
          return this.post({ type: "review", quiz });
        }
        case "check":
          this.check = null;
          return void (await this.checkNext());
        case "hint":
          return void (await this.hint(message.key, message.step === "pointer" ? "pointer" : "nudge"));
        case "practice":
          if (message.kind === "own") return void (await this.ownQuiz(message.key));
          if (message.kind === "bug") return void (await this.bug(message.key));
          if (message.kind === "contrast") return void (await this.contrast(message.key));
          if (message.kind === "why" || message.kind === "trace" || message.kind === "transfer") {
            return void (await this.practiceQuestion(message.key, message.kind));
          }
          return;
        case "bugGuess":
          return this.bugGuess(message.key, Number(message.line));
        case "bugReveal":
          return this.bugGuess(message.key, null);
        case "contrastPick":
          return this.contrastPick(message.key, message.pick === "b" ? "b" : "a");
        case "ownCard":
          return void (await this.ownCard(message.key, {
            question: String(message.question ?? ""),
            answer: String(message.answer ?? ""),
            wrong: Array.isArray(message.wrong) ? message.wrong.map(String) : [],
            why: String(message.why ?? ""),
          }));
        case "turn":
          return void (await this.turn(message.lesson));
        case "turnDone":
          return void (await this.turnDone(message.lesson));
        case "turnHint": {
          const turn = this.lessonExtras[message.lesson]?.turn;
          if (turn) turn.hintShown = true;
          return void (await this.pushState());
        }
        case "recap":
          return this.recap(String(message.text ?? ""));
        case "learnAbout":
          return void (await this.coach.learnAbout(String(message.text ?? "")));
        case "toolGuess":
          return void (await this.coach.toolGuess(message.key, String(message.text ?? "")));
        case "toolPrimer":
          return void (await this.coach.toolPrimer(message.key));
        case "toolAdopt":
          return void (await this.coach.toolAdopt(message.key));
        case "toolDecision":
          return void (await this.coach.toolDecision(message.key));
        case "termQuiz":
          return void (await this.coach.termQuiz(message.slot, message.id));
        case "saveDecision": {
          const problem = await this.coach.saveDecision({ key: message.key, lesson: message.lesson, index: message.index, typed: message.typed });
          if (problem) this.post({ type: "decisionProblem", problem });
          return void (await this.coach.refreshGrow());
        }
        case "lessonDecisions":
          return void (await this.coach.lessonDecisionsFind(message.lesson));
        case "copyDecision": {
          const text = await this.coach.decisionMarkdown(String(message.id ?? ""));
          if (text) {
            await vscode.env.clipboard.writeText(text);
            void vscode.window.setStatusBarMessage("Miyagi: decision record copied. Paste it into your docs.", 3000);
          }
          return;
        }
        case "debugPick":
          return this.coach.debugPick(message.key, Number(message.line));
        case "debugSubmit":
          return void (await this.coach.debugSubmit(message.key, String(message.text ?? "")));
        case "debugSkip":
          return void (await this.coach.debugSubmit(message.key, "", true));
        case "debugHint":
          return void (await this.coach.debugHint(message.key, message.step === "pointer" ? "pointer" : "nudge"));
        case "debugSelf":
          return void (await this.coach.debugSelf(message.key, message.right === true));
        case "debugLesson":
          return this.post({ type: "incidentPrefill", text: this.coach.incidentFrom(message.key) });
        case "predictOpen":
          return void (await this.coach.predictOpen("manual"));
        case "predictLock":
          return void (await this.coach.predictLock(Array.isArray(message.files) ? message.files.map(String) : [], String(message.approach ?? "")));
        case "predictDismiss":
          return this.coach.predictDismiss();
        case "predictApproach":
          return void (await this.coach.predictApproach(message.key));
        case "predictWalk":
          return this.coach.walk(message.key);
        case "gateAsk":
          return void (await this.coach.gateAsk(message.key));
        case "dismissItem":
          return this.coach.dismiss(message.key);
        case "findIdeasOffer":
          return void (await this.coach.offerFindIdeas(message.accept === true));
        case "grow":
          return void (await this.coach.refreshGrow());
        case "incident":
          await this.coach.incident(String(message.text ?? ""));
          return void (await this.coach.refreshGrow());
        case "skillExercise":
          return void (await this.coach.skillExercise(String(message.id ?? "")));
        case "skillDone":
          return void (await this.coach.skillDone(String(message.id ?? "")));
        case "storyAsk":
          return void (await this.coach.storyAsk());
        case "storyAnswer":
          return void (await this.coach.storyAnswer(String(message.text ?? "")));
        case "dojo":
          return this.post({
            type: "dojo",
            rows: await engine.dojo(),
            belts: engine.BELT_NAMES,
            insight: await engine.insight(),
          });
        case "setDepth":
          await engine.setDepth(message.depth);
          return void (await this.pushState());
        case "dismissDepth":
          await this.deps.context.globalState.update(DEPTH_DISMISSED_KEY, message.depth);
          return void (await this.pushState());
        case "setTopic":
          this.topic = parseTopic(message.topic);
          this.reviewed = [];
          void this.deps.context.globalState.update(TOPIC_KEY, this.topic ?? undefined);
          return void (await this.pushState());
        case "idea": {
          const card = await engine.ideaCard(message.id, this.lastSeen[message.id] ?? null);
          if (card) this.ideaCards.set(card.key, card);
          return this.post({ type: "idea", card });
        }
        case "command":
          if (/^miyagi\.[A-Za-z]+$/.test(message.id)) await vscode.commands.executeCommand(message.id);
          return;
        case "openLink":
          if (/^https:\/\//.test(message.url)) await vscode.env.openExternal(vscode.Uri.parse(message.url));
          return;
        case "copy":
          await vscode.env.clipboard.writeText(message.text);
          return void vscode.window.setStatusBarMessage("Miyagi: copied. Paste it to your assistant.", 3000);
      }
    } catch (err) {
      console.error("[miyagi]", err);
    }
  }

  dispose(): void {
    for (const b of this.busy.values()) b.abort.abort();
    this.audio.dispose();
    this.highlight.dispose();
    this.tab?.dispose();
  }
}
