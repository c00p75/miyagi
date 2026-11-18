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
import fs from "node:fs";
import path from "node:path";
import { MiyagiPanel } from "./panel.js";
import { Watcher } from "./watch.js";
import { available, resolveProvider, type AiOptions, type EditorModels, type ProviderSetting } from "./ai.js";
import {
  CLIENT_NAMES,
  capturedClients,
  detectClients,
  disableCapture,
  enableCapture,
  healCapture,
  setupCapture,
  type Client,
  type Scope,
} from "./capture.js";

const WELCOMED_KEY = "miyagi.welcomed.v1";

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
  const config = vscode.workspace.getConfiguration("miyagi");
  return {
    setting: config.get<ProviderSetting>("ai.provider", "auto"),
    model: config.get<string>("ai.model", "").trim(),
    customCommand: config.get<string>("ai.customCommand", ""),
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
}

/**
 * VS Code from 1.106 lets an extension put a view in the secondary side bar,
 * which is where the panel belongs: opposite the files, where an assistant
 * would sit. The forks share the version number and not the permission:
 * Cursor reserves that side bar for its own agent and drops a contributed
 * view into the Explorer instead. So the automatic placement is for VS Code
 * itself, and everywhere else the panel starts in the activity bar with a
 * command to move it. The manifest declares both; this context key picks one.
 */
export function supportsSecondarySidebar(appName: string, version: string): boolean {
  if (!/^(Visual Studio Code|Code - OSS|VSCodium)/i.test(appName)) return false;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 1 || (major === 1 && minor >= 106);
}

const list = (items: readonly string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export async function activate(context: vscode.ExtensionContext): Promise<MiyagiApi> {
  const dist = path.join(context.extensionPath, "dist");
  const workspaceDir = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const captureOptions = () => ({ extensionDist: dist, cwd: workspaceDir(), editorExecPath: process.execPath });
  const clientsHere = () =>
    detectClients({
      claudeExtension: Boolean(vscode.extensions.getExtension("anthropic.claude-code")),
      appName: vscode.env.appName,
    });

  const secondary = supportsSecondarySidebar(vscode.env.appName, vscode.version);
  const viewId = secondary ? MiyagiPanel.secondaryViewId : MiyagiPanel.viewId;
  // Unset means "activity bar", so an editor that does not allow the secondary
  // side bar never shows the view anywhere else, even before activation.
  if (secondary) await vscode.commands.executeCommand("setContext", "miyagi.secondarySidebar", true);

  let watcher: Watcher | undefined;
  const panel = new MiyagiPanel({
    context,
    aiOptions,
    roots: () => watcher?.getRoots() ?? [],
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
  });

  watcher = new Watcher({
    onChanges: (root, source, changes) => void panel.teach(root, source, changes),
    onObservations: (observations) => void panel.observed(observations),
    onRoots: () => void panel.pushState(),
  });
  watcher.setEnabled(vscode.workspace.getConfiguration("miyagi").get<boolean>("watch.enabled", true));

  const viewOptions = { webviewOptions: { retainContextWhenHidden: true } };
  context.subscriptions.push(
    panel,
    watcher,
    // Only one of the two is ever shown; the manifest's `when` clauses see to that.
    vscode.window.registerWebviewViewProvider(MiyagiPanel.viewId, panel, viewOptions),
    vscode.window.registerWebviewViewProvider(MiyagiPanel.secondaryViewId, panel, viewOptions),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("miyagi")) return;
      watcher?.setEnabled(vscode.workspace.getConfiguration("miyagi").get<boolean>("watch.enabled", true));
      void panel.pushState();
    }),
  );

  const open = () => vscode.commands.executeCommand(`${viewId}.focus`);
  const register = (id: string, run: () => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, run));

  register("miyagi.open", open);

  /**
   * Everything that can be done without the learner: find their assistants,
   * turn capture on for each, confirm which AI will write explanations, and
   * open the panel. Safe to run again; it only reports what it changed.
   */
  const setup = async (options: { quiet?: boolean } = {}) => {
    const clients = clientsHere();
    const captured = await setupCapture({ ...captureOptions(), clients });
    const ai = await resolveProvider(await aiOptions());
    const repos = watcher?.getRoots() ?? [];
    await panel.pushState();
    await open();

    const lines = [
      repos.length
        ? `Watching ${list(repos.map((r) => path.basename(r)))}.`
        : "No git repository is open yet; Miyagi starts watching as soon as one is.",
      ai.provider
        ? `Explanations will be written by ${ai.provider.label}, on your account.`
        : "No AI assistant was found for explanations, so cards use the built-in lessons.",
      captured.on.length
        ? `Capturing the commands ${list(captured.on.map((c) => CLIENT_NAMES[c]))} runs.` +
          (captured.changed.length ? ` Start a new ${list(captured.changed.map((c) => CLIENT_NAMES[c]))} session for that to begin.` : "")
        : clients.length
        ? ""
        : "No assistant with a hook system (Claude Code, Cursor) was found, so commands are not captured.",
      ...captured.problems,
    ].filter(Boolean);
    if (!options.quiet || captured.problems.length) {
      const show = captured.problems.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      void show(`Miyagi is set up. ${lines.join(" ")}`);
    }
  };
  register("miyagi.setup", () => setup());

  register("miyagi.moveToSide", async () => {
    await open();
    try {
      // The editor's own picker for where a view lives.
      await vscode.commands.executeCommand("workbench.action.moveFocusedView");
    } catch {
      void vscode.window.showInformationMessage("Drag the Miyagi icon to the side bar you want it in.");
    }
  });

  register("miyagi.explainChanges", async () => {
    await open();
    const sets = (await watcher?.everything()) ?? [];
    let cards = 0;
    for (const set of sets) cards += await panel.teach(set.root, set.source, set.changes, true);
    if (!sets.length) {
      void vscode.window.showInformationMessage("Miyagi found no uncommitted changes or commits in the open repositories.");
    } else if (!cards) {
      void vscode.window.showInformationMessage(
        "Miyagi read the changes and found nothing new to teach: either none of its ideas appear, or you already hold them.",
      );
    }
  });

  register("miyagi.review", async () => {
    await open();
    panel.showTab("review");
  });

  register("miyagi.clearFeed", () => panel.clear());

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
    await vscode.workspace
      .getConfiguration("miyagi")
      .update("ai.provider", picked.value, vscode.ConfigurationTarget.Global);
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

  // Paths move when Node, the editor or this extension is updated. An
  // installed hook is rewritten with today's paths before it can go stale.
  void healCapture(captureOptions()).catch(() => undefined);

  await watcher.start();

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
  };
}

export function deactivate(): void {
  // Subscriptions dispose the watcher and the panel.
}
