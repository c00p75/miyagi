/**
 * The version advertised over MCP and the version on npm have to be the same
 * number, and nothing else enforces that: package.json cannot be imported
 * from src, so the constant is hand-maintained and checked here instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("VERSION matches package.json", async () => {
  const { VERSION } = await import("../src/version.js");
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(VERSION, pkg.version);
});
