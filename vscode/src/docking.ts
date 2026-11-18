/**
 * Where the panel may sit by default.
 *
 * VS Code from 1.106 lets an extension put a view in the secondary side bar,
 * which is where the panel belongs: opposite the files, where an assistant
 * would sit. The forks share the version number and not the permission:
 * Cursor reserves that side bar for its own agent and drops a contributed
 * view into the Explorer instead. So the automatic placement is for VS Code
 * itself, and everywhere else the panel starts in the activity bar, with
 * "Open Beside the Editor" for anyone who wants it on the right.
 *
 * In its own file, with no `vscode` import, so the rule can be tested.
 */
export function supportsSecondarySidebar(appName: string, version: string): boolean {
  if (!/^(Visual Studio Code|Code - OSS|VSCodium)/i.test(appName)) return false;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 1 || (major === 1 && minor >= 106);
}
