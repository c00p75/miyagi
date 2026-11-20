/**
 * Miyagi for VS Code (and its forks).
 *
 * The MCP server teaches from inside the assistant's conversation, which means
 * it can only teach when the assistant chooses to call it, and every lesson
 * costs the working session time and context. This extension is the other
 * arrangement: a panel beside the assistant that watches the result of its
 * work and teaches from there. The assistant is never told the tutor exists.
 */

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseUnifiedDiff } from "../../src/concepts.js";
import { loadIdeaPacks } from "../../src/packs.js";
import { profileDir } from "../../src/profile.js";
import { MiyagiPanel } from "./panel.js";
import { Watcher } from "./watch.js";
import * as engine from "./engine.js";
import {
  available,
  findBinary,
  resolveProvider,
  type AiOptions,
  type EditorModels,
  type ProviderSetting,
} from "./ai.js";
import {
  CLIENT_NAMES,
  capturedClients,
  detectClients,
  disableCapture,
  enableCapture,
  healCapture,
  hookRuntime,
  hookScriptPath,
  installedHooks,
  setupCapture,
  type Client,
  type Scope,
} from "./capture.js";
import { aiIdeaCount, loadAiIdeas, loadOwnCards } from "./ideas.js";
import { currentMeter, describeMeter, recordCall } from "./meter.js";
import { projectMapPrompt } from "./prompts.js";
import { chooseFiles, practisedDays, trackedFiles, weekProgress, weeklyReport } from "./reports.js";
import { buildSummary, fileNameFor, readSummaries, renderTour, teamReport, tourStops } from "./team.js";
import { quietNow, tomorrowMorning, type QuietReason } from "./schedule.js";
import { supportsSecondarySidebar } from "./docking.js";
import { registerSkillIdeas, restoreTools } from "./coach.js";
import { restoreGlossary } from "./glossary.js";

const WELCOMED_KEY = "miyagi.welcomed.v1";
const PAUSED_KEY = "miyagi.pausedUntil.v1";
const REMINDED_KEY = "miyagi.remindedOn.v1";
const METER_KEY = "miyagi.meter.v1";
const FIRST_COMMIT_KEY = "miyagi.firstCommitOfferedOn.v1";
/** A test run is a stopping point: the assistant thinks it has finished something. */
const TEST_COMMAND = /\b(npm (run )?test|pnpm (run )?test|yarn test|jest|vitest|pytest|go test|cargo test|rspec|phpunit|mvn test|gradle(w)? test)\b/;
/** Fewer than this and a reminder is an interruption about nothing. */
const REMIND_AT = 3;

const config = () => vscode.workspace.getConfiguration("miyagi");

/* ------------------------------------------------------------------ *
 * The editor's own models
 * ------------------------------------------------------------------ */

function withTimeout<T>(work: Thenable<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Null on editors that do not implement the language-model API at all. */
function editorModels(): EditorModels | null {
  const lm = (vscode as { lm?: typeof vscode.lm }).lm;
  if (!lm?.selectChatModels) return null;
  return {
    async list() {
      // Some forks expose the function and never answer it.
      const models = await withTimeout(lm.selectChatModels(), 3_000, []);
      return models.map((m) => ({ id: m.id, name: m.name, family: m.family }));
    },
    async send(modelId, text, signal) {
      const [model] = await lm.selectChatModels({ id: modelId });
      if (!model) throw new Error("that model is no longer offered by the editor");
      const cancel = new vscode.CancellationTokenSource();
      const onAbort = () => cancel.cancel();
      signal.addEventListener("abort", onAbort);
      try {
        const response = await model.sendRequest(
          [vscode.LanguageModelChatMessage.User(text)],
          { justification: "Miyagi explains the code your assistant just wrote, in the side panel." },
          cancel.token,
        );
        let out = "";
        for await (const part of response.text) out += part;
        return out;
      } finally {
        signal.removeEventListener("abort", onAbort);
        cancel.dispose();
      }
    },
  };
}

/** Assistants that ship their command-line binary inside their editor extension. */
function bundledBinaries(): AiOptions["bundled"] {
  const exe = process.platform === "win32" ? ".exe" : "";
  const out: AiOptions["bundled"] = {};
  const claude = vscode.extensions.getExtension("anthropic.claude-code")?.extensionPath;
  if (claude) out.claude = [path.join(claude, "resources", "native-binary", `claude${exe}`)];
  const codex = vscode.extensions.getExtension("openai.chatgpt")?.extensionPath;
  if (codex) {
    try {
      const bin = path.join(codex, "bin");
      out.codex = fs.readdirSync(bin).map((dir) => path.join(bin, dir, `codex${exe}`));
    } catch {
      // No bundled binary in this version of the extension.
    }
  }
  return out;
}

async function aiOptions(): Promise<AiOptions> {
  return {
    setting: config().get<ProviderSetting>("ai.provider", "auto"),
    model: config().get<string>("ai.model", "").trim(),
    customCommand: config().get<string>("ai.customCommand", ""),
    ollamaUrl: config().get<string>("ai.ollamaUrl", "http://localhost:11434").trim(),
    editor: editorModels(),
    bundled: bundledBinaries(),
  };
}

/* ------------------------------------------------------------------ *
 * Activation
 * ------------------------------------------------------------------ */

/** What `activate` hands back. Used by the smoke test; not a public API. */
export interface MiyagiApi {
  roots(): string[];
  lessons(): Array<{ source: string; concepts: string[] }>;
  /** Which view the panel lives in on this editor. */
  viewId(): string;
  /** Every repository has been read once; the next change will be compared against that. */
  ready(): boolean;
}

const list = (items: readonly string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function run(cwd: string, command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 30_000, windowsHide: true }, (err, stdout) =>
      resolve(err ? null : String(stdout)),
    );
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<MiyagiApi> {
  const dist = path.join(context.extensionPath, "dist");
  const workspaceDir = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const captureOptions = () => ({ extensionDist: dist, cwd: workspaceDir(), editorExecPath: process.execPath });
  const clientsHere = () =>
    detectClients({
      claudeExtension: Boolean(vscode.extensions.getExtension("anthropic.claude-code")),
      appName: vscode.env.appName,
    });
  const quiet = (): QuietReason =>
    quietNow({ pausedUntil: context.globalState.get(PAUSED_KEY), quietHours: config().get("quietHours", "") });

  const secondary = supportsSecondarySidebar(vscode.env.appName, vscode.version);
  const viewId = secondary ? MiyagiPanel.secondaryViewId : MiyagiPanel.viewId;
  // Unset means "activity bar", so an editor that does not allow the secondary
  // side bar never shows the view anywhere else, even before activation.
  if (secondary) await vscode.commands.executeCommand("setContext", "miyagi.secondarySidebar", true);

  // Ideas written by hand and ideas a model found in earlier sittings. Both
  // must exist before anything is taught, or their questions have no lesson.
  const packs = await loadIdeaPacks().catch(() => []);
  await loadAiIdeas().catch(() => 0);
  await loadOwnCards().catch(() => 0);
  // The coach's own ideas (reading errors, the commit check) and the
  // vocabulary of every tool met so far, so their questions are still there.
  registerSkillIdeas();
  await restoreTools().catch(() => 0);
  // Glossary words on review are ideas too; without this their questions vanish after a restart.
  await restoreGlossary().catch(() => 0);

  /* ---- status bar ----------------------------------------------- */

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusItem.name = "Miyagi";
  context.subscriptions.push(statusItem);

  let lastStatus: engine.StatusView | null = null;
  const renderStatus = (status: engine.StatusView | null) => {
    lastStatus = status ?? lastStatus;
    const q = quiet();
    void vscode.commands.executeCommand("setContext", "miyagi.paused", q.quiet && q.why === "paused");
    const due = lastStatus?.dueQuestions ?? 0;
    if (q.quiet) {
      statusItem.text = "$(debug-pause) Miyagi";
      statusItem.tooltip =
        q.why === "paused"
          ? `Miyagi is paused until ${q.until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Click to resume.`
          : "Miyagi is in quiet hours. Changes are still read; nothing is shown until they end.";
      statusItem.command = q.why === "paused" ? "miyagi.resume" : "miyagi.open";
    } else {
      statusItem.text = due ? `$(mortar-board) ${due} due` : "$(mortar-board) Miyagi";
      statusItem.tooltip = due
        ? `${due} question${due === 1 ? " is" : "s are"} due for review. Click to start.`
        : "Miyagi is watching for code worth understanding. Click to open the panel.";
      statusItem.command = due ? "miyagi.review" : "miyagi.open";
    }
    if (config().get<boolean>("statusBar", true)) statusItem.show();
    else statusItem.hide();
    maybeRemind(lastStatus);
  };

  /** At most once a day, and never when asked to be quiet. */
  const maybeRemind = (status: engine.StatusView | null) => {
    if (!status || config().get<string>("reviewReminder", "daily") !== "daily" || quiet().quiet) return;
    const today = new Date().toDateString();
    if (status.dueQuestions < REMIND_AT || context.globalState.get<string>(REMINDED_KEY) === today) return;
    void context.globalState.update(REMINDED_KEY, today);
    void vscode.window
      .showInformationMessage(
        `Miyagi: ${status.dueQuestions} questions are due. Answering them from memory is the part that makes it stick.`,
        "Review now",
        "Not today",
      )
      .then((choice) => {
        if (choice === "Review now") void vscode.commands.executeCommand("miyagi.review");
      });
  };

  /* ---- panel and watcher ---------------------------------------- */

  let watcher: Watcher | undefined;
  const panel = new MiyagiPanel({
    context,
    aiOptions,
    roots: () => watcher?.getRoots() ?? [],
    plainRoots: () => watcher?.getPlainRoots() ?? [],
    capture: async () => {
      const on = await capturedClients(workspaceDir());
      return {
        on: on.map((c) => CLIENT_NAMES[c]),
        // Assistants that could be captured and are not yet.
        available: clientsHere()
          .filter((c) => !on.includes(c))
          .map((c) => CLIENT_NAMES[c]),
      };
    },
    quiet,
    onStatus: renderStatus,
    holding: () => Boolean(watcher?.isHolding()),
    rootOf: (dir) => watcher?.rootOf(dir) ?? watcher?.getRoots().find((r) => dir === r || dir.startsWith(r + path.sep)),
  });

  /**
   * Opt-in: the first commit of the day is a moment the learner already stops
   * at, so a short review is offered there and nowhere else. Three questions,
   * once, and only if something is due.
   */
  const offerReviewAfterCommit = async () => {
    if (!config().get<boolean>("reviewAfterFirstCommit", false) || quiet().quiet) return;
    const today = new Date().toDateString();
    if (context.globalState.get<string>(FIRST_COMMIT_KEY) === today) return;
    await context.globalState.update(FIRST_COMMIT_KEY, today);
    const due = (await engine.status()).dueQuestions;
    if (!due) return;
    const count = Math.min(3, due);
    const choice = await vscode.window.showInformationMessage(
      `First commit of the day. ${count === 1 ? "One quick question" : `${count} quick questions`} while it is fresh? About two minutes.`,
      "Start",
      "Not now",
    );
    if (choice === "Start") {
      await vscode.commands.executeCommand(`${viewId}.focus`);
      panel.startReview(count);
    }
  };

  /** Staging fires several state changes in a row; look once it settles. */
  const stagedTimers = new Map<string, NodeJS.Timeout>();
  const stagedSoon = (root: string) => {
    clearTimeout(stagedTimers.get(root));
    stagedTimers.set(
      root,
      setTimeout(() => {
        stagedTimers.delete(root);
        void panel.coach.staged(root);
      }, 1_500),
    );
  };
  context.subscriptions.push({ dispose: () => stagedTimers.forEach((t) => clearTimeout(t)) });

  watcher = new Watcher({
    onChanges: (root, source, changes) => void panel.teach(root, source, changes),
    onObservations: (observations) => {
      if (observations.some((o) => o.kind === "command" && TEST_COMMAND.test(o.command))) watcher?.releaseAll("tests");
      void panel.observed(observations);
    },
    onRoots: () => void panel.pushState(),
    onScan: (scan) => panel.scanned(scan),
    onBaseline: (root, files) => panel.baselined(root, files),
    onCommit: (root) => {
      panel.coach.committed(root);
      void offerReviewAfterCommit();
    },
    onRepoState: (root) => stagedSoon(root),
  });
  const configureWatcher = () =>
    watcher?.configure({
      enabled: config().get<boolean>("watch.enabled", true),
      muted: quiet().quiet,
      ignore: config().get<string[]>("watch.ignore", []),
      excludeRepos: config().get<string[]>("watch.excludeRepositories", []),
      holdSeconds:
        config().get<string>("watch.teachAt", "breakpoints") === "breakpoints"
          ? Math.max(5, config().get<number>("watch.quietSeconds", 60))
          : 0,
    });
  configureWatcher();

  /*
   * The learner's own terminal. When a command they ran fails, the debugging
   * coach offers to read the error with them. Output is read into memory only
   * while the command runs, reduced to its error lines, and never written down.
   */
  const shell = vscode.window as unknown as {
    onDidStartTerminalShellExecution?: vscode.Event<{ execution: { read(): AsyncIterable<string> } }>;
    onDidEndTerminalShellExecution?: vscode.Event<{
      execution: { commandLine: { value: string }; cwd?: vscode.Uri };
      exitCode: number | undefined;
      terminal: { shellIntegration?: { cwd?: vscode.Uri } };
    }>;
  };
  if (shell.onDidStartTerminalShellExecution && shell.onDidEndTerminalShellExecution) {
    const outputs = new WeakMap<object, { text: string }>();
    context.subscriptions.push(
      shell.onDidStartTerminalShellExecution((e) => {
        const buffer = { text: "" };
        outputs.set(e.execution, buffer);
        void (async () => {
          try {
            for await (const chunk of e.execution.read()) buffer.text = (buffer.text + chunk).slice(-40_000);
          } catch {
            // A stream that cannot be read leaves an empty buffer; the failure is still noticed.
          }
        })();
      }),
      shell.onDidEndTerminalShellExecution((e) => {
        const code = e.exitCode;
        // 130 and 143 are Ctrl+C and a kill: the learner stopped it, nothing broke.
        if (code === undefined || code === 0 || code === 130 || code === 143) return;
        const output = outputs.get(e.execution)?.text ?? "";
        // Let the stream finish draining before the error is read from it.
        setTimeout(() => {
          void panel.coach.failed({
            command: e.execution.commandLine.value,
            output: (outputs.get(e.execution)?.text ?? output) || "",
            cwd: e.execution.cwd?.fsPath ?? e.terminal.shellIntegration?.cwd?.fsPath,
            by: "you",
          });
        }, 300);
      }),
    );
  }

  const viewOptions = { webviewOptions: { retainContextWhenHidden: true } };
  context.subscriptions.push(
    panel,
    watcher,
    // Only one of the two is ever shown; the manifest's `when` clauses see to that.
    vscode.window.registerWebviewViewProvider(MiyagiPanel.viewId, panel, viewOptions),
    vscode.window.registerWebviewViewProvider(MiyagiPanel.secondaryViewId, panel, viewOptions),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("miyagi")) return;
      configureWatcher();
      void panel.pushState();
    }),
  );
  // Which of the assistant's files the learner goes and looks at.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.uri.scheme === "file") panel.opened(editor.document.uri.fsPath);
    }),
  );
  // Quiet hours begin and end without any event to hang them on.
  const tick = setInterval(() => {
    configureWatcher();
    renderStatus(null);
  }, 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });

  const open = () => vscode.commands.executeCommand(`${viewId}.focus`);
  const register = (id: string, handler: () => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register("miyagi.open", open);
  register("miyagi.openBeside", () => panel.openBeside());
  register("miyagi.settings", () =>
    vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`),
  );

  /* ---- pause ----------------------------------------------------- */

  const setPause = async (until: Date | null) => {
    await context.globalState.update(PAUSED_KEY, until ? until.toISOString() : undefined);
    configureWatcher();
    await panel.pushState();
  };
  register("miyagi.pause", async () => {
    type Item = vscode.QuickPickItem & { until: Date };
    const now = Date.now();
    const picked = await vscode.window.showQuickPick<Item>(
      [
        { label: "For 30 minutes", until: new Date(now + 30 * 60_000) },
        { label: "For 1 hour", until: new Date(now + 60 * 60_000) },
        { label: "For 3 hours", until: new Date(now + 180 * 60_000) },
        { label: "Until tomorrow morning", until: tomorrowMorning() },
      ],
      {
        title: "Pause Miyagi",
        placeHolder: "No cards, toasts or reminders until then. What your assistant writes meanwhile is not taught later.",
      },
    );
    if (picked) await setPause(picked.until);
  });
  register("miyagi.resume", () => setPause(null));

  /* ---- setup ----------------------------------------------------- */

  /**
   * Everything that can be done without the learner: find their assistants,
   * turn capture on for each, confirm which AI will write explanations, and
   * open the panel. Safe to run again; it only reports what it changed.
   */
  const setup = async () => {
    const clients = clientsHere();
    const captured = await setupCapture({ ...captureOptions(), clients });
    const ai = await resolveProvider(await aiOptions());
    const repos = watcher?.getRoots() ?? [];
    await panel.pushState();
    await open();

    const lines = [
      repos.length
        ? `Watching ${repos.length === 1 ? path.basename(repos[0]) : `${repos.length} repositories`}.`
        : "No git repository is open yet; Miyagi starts watching as soon as one is.",
      ai.provider
        ? `Explanations will be written by ${ai.provider.label}, on your account.`
        : "No AI assistant was found for explanations, so cards use the built-in lessons.",
      captured.on.length
        ? `Capturing the commands ${list(captured.on.map((c) => CLIENT_NAMES[c]))} runs.` +
          (captured.changed.length
            ? ` Start a new ${list(captured.changed.map((c) => CLIENT_NAMES[c]))} session for that to begin.`
            : "")
        : clients.length
        ? ""
        : "No assistant with a hook system (Claude Code, Cursor) was found, so commands are not captured.",
      ...captured.problems,
    ].filter(Boolean);
    const show = captured.problems.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void show(`Miyagi is set up. ${lines.join(" ")}`);
  };
  register("miyagi.setup", setup);

  register("miyagi.moveToSide", async () => {
    await open();
    try {
      // The editor's own picker for where a view lives.
      await vscode.commands.executeCommand("workbench.action.moveFocusedView");
    } catch {
      void vscode.window.showInformationMessage("Drag the Miyagi icon to the side bar you want it in.");
    }
  });

  /* ---- teaching on request -------------------------------------- */

  const pickRepo = async (title: string): Promise<string | undefined> => {
    const roots = watcher?.getRoots() ?? [];
    if (roots.length <= 1) return roots[0];
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    const sorted = [...roots].sort(
      (a, b) => Number(Boolean(active?.startsWith(b + path.sep))) - Number(Boolean(active?.startsWith(a + path.sep))),
    );
    const picked = await vscode.window.showQuickPick(
      sorted.map((r) => ({ label: path.basename(r), description: r })),
      { title },
    );
    return picked?.description;
  };

  const nothingNew = () =>
    vscode.window.showInformationMessage(
      "Miyagi read the changes and found nothing new to teach: either none of its ideas appear, or you already hold them.",
    );

  register("miyagi.unaidedCheck", async () => {
    await open();
    panel.beginCheck();
  });
  register("miyagi.recap", async () => {
    await open();
    panel.beginRecap();
  });

  register("miyagi.explainChanges", async () => {
    await open();
    // Asking is itself a stopping point: nothing should still be waiting for one.
    watcher?.releaseAll("asked");
    const sets = (await watcher?.everything()) ?? [];
    let cards = 0;
    for (const set of sets) cards += await panel.teach(set.root, set.source, set.changes, true);
    panel.clearBaseline();
    void panel.pushState();
    if (!sets.length) {
      void vscode.window.showInformationMessage("Miyagi found no uncommitted changes or commits in the open repositories.");
    } else if (!cards) {
      void nothingNew();
    }
  });

  register("miyagi.teachBranch", async () => {
    const root = await pickRepo("Which repository?");
    if (!root) return void vscode.window.showInformationMessage("Miyagi needs an open git repository for this.");
    const input = await vscode.window.showInputBox({
      title: "Teach me a branch or a pull request",
      prompt: "A branch to compare against (the lesson covers everything since it), or a pull request number.",
      value: "main",
    });
    const target = input?.trim();
    if (!target) return;

    let diff: string | null;
    let source: string;
    if (/^#?\d+$/.test(target)) {
      const number = target.replace("#", "");
      const gh = findBinary("gh");
      if (!gh) {
        return void vscode.window.showWarningMessage(
          "Reading a pull request needs the GitHub CLI (gh), which was not found. Use a branch name instead.",
        );
      }
      diff = await run(root, gh, ["pr", "diff", number]);
      source = `pull request #${number}`;
    } else if (/^[\w./-]{1,200}$/.test(target) && !target.startsWith("-")) {
      diff = await run(root, "git", ["diff", "--no-color", "--no-ext-diff", "-U0", `${target}...HEAD`]);
      source = `this branch since ${target}`;
    } else {
      return void vscode.window.showWarningMessage("That does not look like a branch name or a pull request number.");
    }
    if (diff === null) {
      return void vscode.window.showWarningMessage(`Miyagi could not read ${source}. Check that it exists in ${path.basename(root)}.`);
    }
    const changes = parseUnifiedDiff(diff);
    if (!changes.length) return void vscode.window.showInformationMessage(`There are no added lines in ${source}.`);
    await open();
    if (!(await panel.teach(root, source, changes, true))) void nothingNew();
  });

  register("miyagi.review", async () => {
    await open();
    panel.showTab("review");
  });

  register("miyagi.clearFeed", () => panel.clear());

  /* ---- growing: tools, predictions, incidents, the story -------- */

  register("miyagi.learnAbout", async () => {
    const text = await vscode.window.showInputBox({
      title: "Teach me about a tool or an idea",
      prompt: "A library, service or idea: Sentry, Stripe, Zod, debouncing… Miyagi explains it and how your project uses it.",
      placeHolder: "Sentry",
    });
    if (!text?.trim()) return;
    await open();
    await panel.coach.learnAbout(text);
  });
  register("miyagi.predict", async () => {
    await open();
    panel.showTab("now");
    await panel.coach.predictOpen("manual");
  });
  register("miyagi.growth", async () => {
    await open();
    panel.showTab("grow");
  });
  register("miyagi.incident", async () => {
    await open();
    panel.showTab("grow");
  });
  register("miyagi.story", async () => {
    const text = await panel.coach.storyMarkdown();
    await showMarkdown("reports", `story-${new Date().toISOString().slice(0, 10)}.md`, text);
  });

  /* ---- reading matter: the week, and the project ---------------- */

  const showMarkdown = async (folder: string, name: string, text: string) => {
    const dir = path.join(profileDir(), folder);
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await fsp.writeFile(file, text, "utf8");
    const uri = vscode.Uri.file(file);
    try {
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    } catch {
      await vscode.window.showTextDocument(uri);
    }
  };

  register("miyagi.weeklyReport", async () => {
    const [status, dojo] = await Promise.all([engine.status(), engine.dojo()]);
    const text = await weeklyReport({
      status,
      dojo,
      meterLine: describeMeter(currentMeter(context.globalState.get(METER_KEY))),
    });
    await showMarkdown("reports", `week-${new Date().toISOString().slice(0, 10)}.md`, text);
  });

  register("miyagi.projectMap", async () => {
    const root = await pickRepo("Explain how which project works?");
    if (!root) return void vscode.window.showInformationMessage("Miyagi needs an open git repository for this.");
    const resolved = await resolveProvider(await aiOptions());
    if (!resolved.provider) return void vscode.window.showWarningMessage(`Miyagi: ${resolved.reason}`);
    const provider = resolved.provider;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Miyagi: asking ${provider.label} how ${path.basename(root)} works`,
        cancellable: true,
      },
      async (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        try {
          const files = await trackedFiles(root);
          if (!files.length) throw new Error("no tracked files were found in that repository");
          const chosen = chooseFiles(files, { tree: 220, heads: 9 });
          const heads: Array<{ file: string; head: string }> = [];
          for (const file of chosen.heads) {
            const head = await engine.headOf(root, file, /readme/i.test(file) ? 60 : 45);
            if (head?.trim()) heads.push({ file, head });
          }
          const prompt = projectMapPrompt(
            { name: path.basename(root), tree: chosen.tree, totalFiles: files.length, heads },
            (await engine.status()).depth,
          );
          const reply = await provider.run(prompt, abort.signal);
          await context.globalState.update(
            METER_KEY,
            recordCall(currentMeter(context.globalState.get(METER_KEY)), prompt.system.length + prompt.user.length, reply.length),
          );
          const text = [
            `# How ${path.basename(root)} works`,
            "",
            `_Written by ${provider.label} on ${new Date().toISOString().slice(0, 10)} from ${chosen.tree.length} of ${files.length} file names and the first lines of ${heads.length} files. It has not read the whole project, so treat it as a map to check, not a fact sheet._`,
            "",
            reply,
            "",
          ].join("\n");
          await showMarkdown("maps", `${path.basename(root).replace(/[^\w.-]+/g, "-")}.md`, text);
          void panel.pushState();
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (reason !== "cancelled") void vscode.window.showWarningMessage(`Miyagi could not write the map: ${reason}`);
        }
      },
    );
  });

  /* ---- team ------------------------------------------------------ */

  /** The shared folder, inside the repository so that sharing is a commit. */
  const teamFolder = (root: string) => {
    const configured = config().get<string>("team.folder", ".miyagi/team").trim() || ".miyagi/team";
    return path.isAbsolute(configured) ? configured : path.join(root, configured);
  };

  register("miyagi.shareWithTeam", async () => {
    const root = await pickRepo("Share into which repository?");
    if (!root) return void vscode.window.showInformationMessage("Miyagi needs an open git repository to share into.");
    let name = config().get<string>("team.name", "").trim();
    if (!name) {
      const suggested = ((await run(root, "git", ["config", "user.name"])) ?? "").trim();
      const typed = await vscode.window.showInputBox({
        title: "Share my progress with my team",
        prompt: "The name your teammates will see. It is saved in your settings for next time.",
        value: suggested,
      });
      name = typed?.trim() ?? "";
      if (!name) return;
      await config().update("team.name", name, vscode.ConfigurationTarget.Global);
    }
    const [status, dojo] = await Promise.all([engine.status(), engine.dojo()]);
    const summary = buildSummary({
      name,
      status,
      dojo,
      week: weekProgress(await practisedDays(), config().get<number>("weeklyGoalDays", 4)),
    });
    const folder = teamFolder(root);
    const file = path.join(folder, fileNameFor(name));
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(summary, null, 2) + "\n", "utf8");
    const choice = await vscode.window.showInformationMessage(
      `Miyagi wrote ${path.relative(root, file)}: ${summary.ideas.length} idea${summary.ideas.length === 1 ? "" : "s"} and their belts, nothing else. It reaches your team when you commit it.`,
      "Open the file",
      "Show team report",
    );
    if (choice === "Open the file") await vscode.window.showTextDocument(vscode.Uri.file(file));
    if (choice === "Show team report") await vscode.commands.executeCommand("miyagi.teamReport");
  });

  register("miyagi.teamReport", async () => {
    const root = await pickRepo("Team report for which repository?");
    if (!root) return void vscode.window.showInformationMessage("Miyagi needs an open git repository for this.");
    const { summaries, skipped } = await readSummaries(teamFolder(root));
    await showMarkdown("reports", `team-${path.basename(root).replace(/[^\w.-]+/g, "-")}.md`, teamReport(summaries, skipped));
  });

  register("miyagi.tour", async () => {
    const root = await pickRepo("Tour the ideas in which repository?");
    if (!root) return void vscode.window.showInformationMessage("Miyagi needs an open git repository for this.");
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Miyagi: reading ${path.basename(root)} for the ideas it relies on` },
      async () => {
        const files = await trackedFiles(root);
        const tour = await tourStops(root, files);
        await showMarkdown("maps", `tour-${path.basename(root).replace(/[^\w.-]+/g, "-")}.md`, renderTour(path.basename(root), tour, files.length));
      },
    );
  });

  /* ---- AI and capture ------------------------------------------- */

  register("miyagi.chooseAi", async () => {
    const options = await aiOptions();
    const found = await available(options);
    type Item = vscode.QuickPickItem & { value: ProviderSetting };
    const items: Item[] = [
      {
        label: "Automatic",
        description: found.length ? `currently ${found[0].label}` : "nothing found yet",
        detail: "The assistant you were seen working with, else the first one found.",
        value: "auto",
      },
      ...found.map((a): Item => ({ label: a.label, detail: a.detail, value: a.id })),
      { label: "Off", detail: "No AI. Cards use the built-in lessons only.", value: "off" },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: "Which AI writes Miyagi's explanations?",
      placeHolder: "It runs on your own account with that provider. Miyagi has no key of its own.",
    });
    if (!picked) return;
    await config().update("ai.provider", picked.value, vscode.ConfigurationTarget.Global);
  });

  register("miyagi.enableCapture", async () => {
    type ClientItem = vscode.QuickPickItem & { value: Client };
    const client = await vscode.window.showQuickPick<ClientItem>(
      [
        { label: "Claude Code", detail: "Adds a PostToolUse hook to Claude Code's settings.", value: "claude" },
        { label: "Cursor", detail: "Adds afterFileEdit and afterShellExecution hooks.", value: "cursor" },
      ],
      {
        title: "Capture the commands your assistant runs",
        placeHolder: "The hook writes one line to ~/.miyagi and prints nothing. The assistant never sees it.",
      },
    );
    if (!client) return;
    type ScopeItem = vscode.QuickPickItem & { value: Scope };
    const scope = await vscode.window.showQuickPick<ScopeItem>(
      [
        { label: "Every project on this machine", value: "global" },
        { label: "This project only", value: "project" },
      ],
      { title: "Where should the hook be installed?" },
    );
    if (!scope) return;
    const result = await enableCapture({ ...captureOptions(), client: client.value, scope: scope.value });
    if ("error" in result) {
      void vscode.window.showErrorMessage(`Miyagi: ${result.error}`);
    } else if (result.status === "skipped") {
      void vscode.window.showWarningMessage(`Miyagi: ${result.file} was ${result.detail}`);
    } else {
      void vscode.window.showInformationMessage(
        `Miyagi: capture hook ${result.detail} in ${result.file}. Start a new ${client.label} session for it to take effect.`,
      );
    }
    void panel.pushState();
  });

  register("miyagi.disableCapture", async () => {
    const removed: string[] = [];
    for (const client of ["claude", "cursor"] as const) {
      for (const scope of ["project", "global"] as const) {
        const result = await disableCapture({ client, scope, cwd: workspaceDir() });
        if (result.status === "removed") removed.push(result.file);
      }
    }
    void vscode.window.showInformationMessage(
      removed.length ? `Miyagi: capture hook removed from ${removed.join(" and ")}.` : "Miyagi: no capture hook was installed.",
    );
    void panel.pushState();
  });

  /* ---- what is going on ----------------------------------------- */

  const output = vscode.window.createOutputChannel("Miyagi");
  context.subscriptions.push(output);
  register("miyagi.doctor", async () => {
    const options = await aiOptions();
    const [found, hooks, status] = await Promise.all([available(options), installedHooks(workspaceDir()), engine.status()]);
    let editorList: string[] = [];
    try {
      editorList = ((await options.editor?.list()) ?? []).map((m) => `${m.name} (${m.family})`);
    } catch {
      editorList = [];
    }
    const q = quiet();
    const lines = [
      `Miyagi ${context.extension.packageJSON.version} in ${vscode.env.appName} ${vscode.version} on ${process.platform}`,
      "",
      "WATCHING",
      `  enabled: ${config().get("watch.enabled", true)}`,
      `  repositories: ${watcher?.getRoots().join(", ") || "(none)"}`,
      `  folders without git: ${watcher?.getPlainRoots().join(", ") || "(none)"}`,
      `  excluded: ${(watcher?.getAllRoots() ?? []).filter((r) => !watcher?.getRoots().includes(r)).join(", ") || "(none)"}`,
      `  ignore patterns: ${config().get<string[]>("watch.ignore", []).join(", ") || "(none)"}`,
      `  quiet: ${q.quiet ? (q.why === "paused" ? `paused until ${q.until.toLocaleString()}` : "quiet hours") : "no"}`,
      "",
      "AI FOR EXPLANATIONS",
      `  setting: ${options.setting}${options.model ? `, model ${options.model}` : ""}`,
      `  in use: ${found.length && options.setting !== "off" ? (options.setting === "auto" ? found[0].label : found.find((a) => a.id === options.setting)?.label ?? "(not available)") : "(none)"}`,
      ...found.map((a) => `  found: ${a.id}: ${a.label}  [${a.detail}]`),
      `  editor language-model API: ${options.editor ? `present, ${editorList.length} model(s)${editorList.length ? ": " + editorList.join(", ") : ""}` : "not offered by this editor"}`,
      `  ${describeMeter(currentMeter(context.globalState.get(METER_KEY)))}`,
      `  find ideas with AI: ${config().get("ai.findIdeas", "whenNothingFound")}`,
      "",
      "COACH",
      `  tools: ${config().get("coach.tools", true)}, debugging: ${config().get("coach.debugging", true)}, predictions: ${config().get("coach.predictions", "onNewTask")}, commit check from: ${config().get("coach.commitCheckLines", 60)} lines`,
      `  explain in your own words: ${config().get("explainBack", true)}`,
      `  terminal failures: ${(vscode.window as { onDidEndTerminalShellExecution?: unknown }).onDidEndTerminalShellExecution ? "read through shell integration" : "not available in this editor"}`,
      "",
      "COMMAND CAPTURE",
      `  assistants found: ${clientsHere().map((c) => CLIENT_NAMES[c]).join(", ") || "(none)"}`,
      ...(hooks.length ? hooks.map((h) => `  hook: ${CLIENT_NAMES[h.client]} (${h.scope}) in ${h.file}`) : ["  hook: not installed"]),
      `  hook script: ${hookScriptPath()} ${fs.existsSync(hookScriptPath()) ? "(present)" : "(missing)"}`,
      `  runs on: ${hookRuntime(process.execPath) ?? "nothing found (install Node.js)"}`,
      "",
      "IDEAS AND PROGRESS",
      `  profile: ${profileDir()}`,
      `  ideas: ${status.concepts} (${aiIdeaCount()} found by AI, ${packs.reduce((n, p) => n + p.added.length, 0)} from pack files)`,
      ...packs.flatMap((p) => [
        `  pack ${p.file}: ${p.error ? `skipped, ${p.error}` : `${p.added.length} idea(s)`}`,
        ...p.rejected.map((r) => `    rejected ${r.id}: ${r.reason}`),
      ]),
      `  level ${status.level} (${status.rank}), ${status.xp} XP, ${status.discovered} found, ${status.dueQuestions} due`,
      "",
    ];
    output.clear();
    output.appendLine(lines.join("\n"));
    output.show(true);
  });

  // Paths move when Node, the editor or this extension is updated. An
  // installed hook is rewritten with today's paths before it can go stale.
  void healCapture(captureOptions()).catch(() => undefined);

  await watcher.start();
  void engine.status().then(renderStatus);

  if (!context.globalState.get<boolean>(WELCOMED_KEY)) {
    void context.globalState.update(WELCOMED_KEY, true);
    const clients = clientsHere().map((c) => CLIENT_NAMES[c]);
    // Watching and explaining need nothing from the learner and are already
    // on. Capture edits another tool's settings file, so it gets one click of
    // consent rather than none.
    void vscode.window
      .showInformationMessage(
        "Miyagi teaches you the ideas in the code your AI assistant writes, in a side panel. It never changes your files or talks to the assistant." +
          (clients.length ? ` One click also captures the commands ${list(clients)} runs.` : ""),
        "Set up for me",
        "Not now",
      )
      .then((choice) => {
        if (choice === "Set up for me") void setup();
      });
  }

  return {
    roots: () => watcher?.getRoots() ?? [],
    lessons: () => panel.summary(),
    viewId: () => viewId,
    ready: () => Boolean(watcher?.isReady()),
  };
}

export function deactivate(): void {
  // Subscriptions dispose the watcher and the panel.
}
