/**
 * The side panel.
 *
 * A webview view the learner can dock wherever they like, usually opposite the
 * assistant. It holds the lesson feed, the review queue and the dojo. The
 * webview is a renderer only: every decision (what to teach, how an answer is
 * graded, which AI is asked) happens here, in the extension host.
 */

import * as vscode from "vscode";
import path from "node:path";
import { conceptsIn } from "../../src/changes.js";
import type { FileChange } from "../../src/concepts.js";
import type { Observation } from "../../src/observe.js";
import * as engine from "./engine.js";
import { parseTopic } from "./topics.js";
import { explainPrompt, resolveProvider, type AiOptions, type Provider } from "./ai.js";

const FEED_KEY = "miyagi.feed.v1";
const TOPIC_KEY = "miyagi.topic.v1";
const MAX_LESSONS = 25;
const MAX_COMMANDS = 30;

interface Explanation {
  text: string;
  by: string;
}

interface CommandRow {
  command: string;
  count: number;
  info: engine.CommandInfo | null;
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
  | { type: "explain"; key: string }
  | { type: "quiz"; key: string }
  | { type: "answer"; token: string; index: number }
  | { type: "review" }
  | { type: "dojo" }
  | { type: "setDepth"; depth: engine.Level }
  | { type: "setTopic"; topic: string }
  | { type: "idea"; id: string }
  | { type: "command"; id: string }
  | { type: "openLink"; url: string }
  | { type: "copy"; text: string };

export interface PanelDeps {
  context: vscode.ExtensionContext;
  aiOptions(): Promise<AiOptions>;
  roots(): string[];
  /** Assistants capture is on for, and ones it could be turned on for. */
  capture(): Promise<{ on: string[]; available: string[] }>;
}

export class MiyagiPanel implements vscode.WebviewViewProvider {
  static readonly viewId = "miyagi.panel";
  static readonly secondaryViewId = "miyagi.panelSecondary";

  private view: vscode.WebviewView | undefined;
  private lessons: engine.LessonView[] = [];
  private explanations: Record<string, Explanation> = {};
  private readonly explaining = new Map<string, AbortController>();
  private readonly commands = new Map<string, CommandRow>();
  private commandTotal = 0;
  private unseen = 0;
  /** Question ids already asked in this review pass, so a miss is not re-asked at once. */
  private reviewed: string[] = [];
  private seenAssistant: Observation["source"] | null = null;
  private lastSeen: Record<string, engine.Where> = {};
  /** Lessons opened from the dojo. They live outside the feed. */
  private readonly ideaCards = new Map<string, engine.CardView>();
  private topic: engine.Topic | null;

  constructor(private readonly deps: PanelDeps) {
    const saved = deps.context.workspaceState.get<SavedFeed>(FEED_KEY);
    if (saved?.lessons) {
      this.lessons = saved.lessons;
      this.explanations = saved.explanations ?? {};
      this.lastSeen = saved.lastSeen ?? {};
    }
    this.topic = parseTopic(deps.context.globalState.get<string>(TOPIC_KEY));
  }

  /* ---- view lifecycle ------------------------------------------- */

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.deps.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((message: Inbound) => void this.receive(message));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.unseen = 0;
        this.badge();
        void this.pushState();
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
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

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private badge(): void {
    if (!this.view) return;
    this.view.badge = this.unseen
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

  async pushState(): Promise<void> {
    if (!this.view) return;
    const [status, resolved, capture] = await Promise.all([
      engine.status(),
      this.resolveAi(),
      this.deps.capture(),
    ]);
    const config = vscode.workspace.getConfiguration("miyagi");
    this.post({
      type: "state",
      status,
      topics: engine.TOPICS,
      topic: this.topic,
      lessons: this.lessons,
      explanations: this.explanations,
      explaining: [...this.explaining.keys()],
      commands: [...this.commands.values()].slice(-MAX_COMMANDS).reverse(),
      commandTotal: this.commandTotal,
      ai: resolved.provider ? { label: resolved.provider.label } : { label: null, reason: resolved.reason },
      capture,
      watching: config.get<boolean>("watch.enabled", true),
      repos: this.deps.roots().map((r) => path.basename(r)),
    });
  }

  private async resolveAi() {
    const options = await this.deps.aiOptions();
    return resolveProvider({ ...options, seen: this.seenAssistant });
  }

  /* ---- things that arrive from the watcher ---------------------- */

  async teach(root: string, source: string, changes: readonly FileChange[], repeat = false): Promise<number> {
    const limit = vscode.workspace.getConfiguration("miyagi").get<number>("ideasPerChange", 2);
    const lesson = await engine.teach({ changes: conceptsIn(changes), root, source, limit, repeat });
    return this.addLesson(lesson);
  }

  private addLesson(lesson: engine.LessonView | null): number {
    if (!lesson) return 0;
    this.lessons = [lesson, ...this.lessons].slice(0, MAX_LESSONS);
    for (const card of lesson.cards) {
      this.lastSeen[card.conceptId] = {
        root: card.root,
        file: card.file,
        otherFiles: card.otherFiles,
        evidence: card.evidence,
      };
    }
    this.save();
    if (!this.view?.visible) {
      this.unseen += lesson.cards.length;
      this.badge();
    }
    void this.pushState();
    if (vscode.workspace.getConfiguration("miyagi").get<string>("ai.explain") === "auto") {
      for (const card of lesson.cards) void this.explain(card.key);
    }
    return lesson.cards.length;
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
      } else if (o.concepts.length && o.cwd) {
        // Usually the git watcher has already taught this edit and the session
        // filter drops it. This is the path for folders that are not repositories.
        const lesson = await engine.teach({
          changes: [{ file: o.file, concepts: o.concepts }],
          root: o.cwd,
          source: o.file,
          limit: vscode.workspace.getConfiguration("miyagi").get<number>("ideasPerChange", 2),
        });
        this.addLesson(lesson);
      }
    }
    while (this.commands.size > MAX_COMMANDS) this.commands.delete(this.commands.keys().next().value as string);
    void this.pushState();
  }

  clear(): void {
    for (const controller of this.explaining.values()) controller.abort();
    this.explaining.clear();
    this.lessons = [];
    // Explanations written for a dojo idea are kept; they were not part of the feed.
    for (const key of Object.keys(this.explanations)) if (!key.startsWith("dojo:")) delete this.explanations[key];
    this.commands.clear();
    this.commandTotal = 0;
    this.unseen = 0;
    engine.forgetSession();
    this.badge();
    this.save();
    void this.pushState();
  }

  /** The feed reduced to what a test needs to assert on. */
  summary(): Array<{ source: string; concepts: string[] }> {
    return this.lessons.map((l) => ({ source: l.source, concepts: l.cards.map((c) => c.conceptId) }));
  }

  showTab(tab: "now" | "review" | "dojo"): void {
    this.post({ type: "tab", tab });
  }

  /* ---- messages from the webview -------------------------------- */

  private card(key: string): engine.CardView | undefined {
    const idea = this.ideaCards.get(key);
    if (idea) return idea;
    for (const lesson of this.lessons) {
      const card = lesson.cards.find((c) => c.key === key);
      if (card) return card;
    }
    return undefined;
  }

  private async receive(message: Inbound): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          return void (await this.pushState());
        case "openFile":
          return void (await this.openFile(message.key));
        case "explain":
          return void (await this.explain(message.key));
        case "quiz": {
          const card = this.card(message.key);
          const quiz = card ? await engine.quizForConcept(card.conceptId) : null;
          return this.post({ type: "quiz", key: message.key, quiz });
        }
        case "answer": {
          const questionId = engine.questionIdFor(message.token);
          if (questionId) this.reviewed.push(questionId);
          const answer = await engine.answer(message.token, message.index);
          this.post({ type: "answered", token: message.token, answer });
          return void (await this.pushState());
        }
        case "review": {
          const quiz = await engine.nextReview(this.reviewed, this.topic);
          if (!quiz) this.reviewed = [];
          return this.post({ type: "review", quiz });
        }
        case "dojo":
          return this.post({ type: "dojo", rows: await engine.dojo(), belts: engine.BELT_NAMES });
        case "setDepth":
          await engine.setDepth(message.depth);
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

  private async openFile(key: string): Promise<void> {
    const card = this.card(key);
    if (!card || !card.file) return;
    const abs = path.isAbsolute(card.file) ? card.file : path.join(card.root, card.file);
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      // Beside whatever is focused, never over the assistant's chat.
      const editor = await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
      const needle = card.evidence.replace(/…$/, "").trim();
      if (needle && !needle.startsWith("(")) {
        const index = doc.getText().indexOf(needle.slice(0, 60));
        if (index >= 0) {
          const line = doc.lineAt(doc.positionAt(index).line);
          editor.selection = new vscode.Selection(line.range.start, line.range.end);
          editor.revealRange(line.range, vscode.TextEditorRevealType.InCenter);
        }
      }
    } catch {
      void vscode.window.showWarningMessage(`Miyagi could not open ${card.file}. It may have been moved or deleted.`);
    }
  }

  private async explain(key: string): Promise<void> {
    const card = this.card(key);
    if (!card || this.explaining.has(key)) return;
    const resolved = await this.resolveAi();
    if (!resolved.provider) {
      return this.post({ type: "explained", key, error: resolved.reason });
    }
    const provider: Provider = resolved.provider;
    const controller = new AbortController();
    this.explaining.set(key, controller);
    this.post({ type: "explaining", key, by: provider.label });
    try {
      const status = await engine.status();
      const excerpt = await engine.excerptFor(card.conceptId, card.root, card.file);
      const text = await provider.run(
        explainPrompt({
          title: card.title,
          what: card.what,
          depth: status.depth,
          file: card.file,
          excerpt,
          evidence: card.evidence,
        }),
        controller.signal,
      );
      this.explanations[key] = { text, by: provider.label };
      this.save();
      this.post({ type: "explained", key, explanation: this.explanations[key] });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason !== "cancelled") {
        this.post({ type: "explained", key, error: `${provider.label} could not answer: ${reason}` });
      }
    } finally {
      this.explaining.delete(key);
    }
  }

  dispose(): void {
    for (const controller of this.explaining.values()) controller.abort();
  }
}
