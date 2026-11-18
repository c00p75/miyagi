/**
 * Runs inside a real extension host (`npm run test:host`).
 *
 * The unit tests cover the engine, the providers and the hook. This covers the
 * part they cannot: that the extension activates, finds the repository, turns
 * a file an "assistant" just wrote into a lesson, and that the panel opens.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

const until = async (what, check, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

exports.run = async function run() {
  const extension = vscode.extensions.getExtension("georgemsapenda.miyagi-vscode");
  assert.ok(extension, "the extension is installed in this host");
  const api = await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of ["open", "setup", "moveToSide", "explainChanges", "review", "chooseAi", "enableCapture", "disableCapture", "clearFeed"]) {
    assert.ok(commands.includes(`miyagi.${id}`), `command miyagi.${id} is registered`);
  }

  // VS Code docks the panel in the secondary side bar; forks reserve it and fall back.
  const [major, minor] = vscode.version.split(".").map(Number);
  const isVsCode = /^(Visual Studio Code|Code - OSS|VSCodium)/i.test(vscode.env.appName);
  const expected = isVsCode && (major > 1 || minor >= 106) ? "miyagi.panelSecondary" : "miyagi.panel";
  assert.equal(api.viewId(), expected, `on ${vscode.env.appName} ${vscode.version}`);

  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const real = await fs.realpath(folder);
  await until("the repository to be found", async () =>
    (await Promise.all(api.roots().map((r) => fs.realpath(r)))).includes(real),
  );
  // Let the baseline read finish, so the next write is seen as new.
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(api.lessons(), [], "nothing is taught from what was already there");

  await fs.writeFile(
    path.join(folder, "auth.ts"),
    'import bcrypt from "bcrypt";\nexport const hash = (pw: string) => bcrypt.hash(pw, 12);\n',
  );
  const lessons = await until("a lesson from the new file", () => (api.lessons().length ? api.lessons() : null));
  assert.equal(lessons[0].source, "auth.ts");
  assert.ok(lessons[0].concepts.includes("password-hashing"), JSON.stringify(lessons));

  // The view resolves and renders without throwing.
  await vscode.commands.executeCommand("miyagi.open");
  await new Promise((r) => setTimeout(r, 1500));
  console.log("MIYAGI SMOKE OK", vscode.env.appName, vscode.version, api.viewId(), JSON.stringify(lessons));
};
