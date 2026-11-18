/**
 * One bundle for the extension, one for the editor hook, one per test file.
 *
 * The extension imports Miyagi's engine straight from `../src`, so the panel
 * and the MCP server grade, schedule and persist with the same code. Bundling
 * is what makes that possible: the published extension carries the engine
 * inside `dist/extension.js` and needs no `node_modules` at runtime.
 */
import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const production = args.has("--production");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  // `src/setup.ts` reads import.meta.url inside a function the extension never
  // calls. The warning is accurate and irrelevant.
  logOverride: { "empty-import-meta": "silent" },
};

const targets = [
  { ...shared, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"] },
  // The hook Claude Code and Cursor run after each tool call. Self-contained,
  // so it can be copied to a path that survives extension updates.
  { ...shared, entryPoints: ["../src/observe-cli.ts"], outfile: "dist/observe-hook.cjs", sourcemap: false },
];

if (args.has("--tests")) {
  const tests = fs.readdirSync("test").filter((f) => f.endsWith(".test.ts"));
  await build({
    ...shared,
    entryPoints: tests.map((f) => path.join("test", f)),
    outdir: "dist-test",
    outExtension: { ".js": ".cjs" },
    sourcemap: "inline",
    minify: false,
    external: ["vscode"],
  });
} else if (args.has("--watch")) {
  for (const t of targets) await (await context(t)).watch();
} else {
  for (const t of targets) await build(t);
}
