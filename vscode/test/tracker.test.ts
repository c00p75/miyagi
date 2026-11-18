import { test } from "node:test";
import assert from "node:assert/strict";
import { DiffTracker } from "../src/tracker.js";

const change = (file: string, added: string) => ({ file, added, addedLines: added.split("\n").length });

test("the first read of a repository is a baseline and teaches nothing", () => {
  const t = new DiffTracker();
  assert.deepEqual(t.delta("/repo", [change("a.ts", "const a = 1;\nconst b = 2;")]), []);
  assert.equal(t.isPrimed("/repo"), true);
});

test("only lines that were not there before come back", () => {
  const t = new DiffTracker();
  t.delta("/repo", [change("a.ts", "const a = 1;")]);
  const fresh = t.delta("/repo", [change("a.ts", "const a = 1;\nconst hash = await bcrypt.hash(pw, 12);")]);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].added, "const hash = await bcrypt.hash(pw, 12);");
  assert.equal(fresh[0].addedLines, 1);
  // Reading the same diff again yields nothing.
  assert.deepEqual(t.delta("/repo", [change("a.ts", "const a = 1;\nconst hash = await bcrypt.hash(pw, 12);")]), []);
});

test("re-indented or moved lines are not new", () => {
  const t = new DiffTracker();
  t.delta("/repo", [change("a.ts", "useEffect(() => {}, []);")]);
  assert.deepEqual(t.delta("/repo", [change("a.ts", "\n    useEffect(() => {}, []);")]), []);
});

test("a file that appears after the baseline is all new", () => {
  const t = new DiffTracker();
  t.delta("/repo", []);
  const fresh = t.delta("/repo", [change("new.ts", "export const x = 1;\n\nexport const y = 2;")]);
  assert.equal(fresh[0].addedLines, 2);
});

test("repositories are tracked separately", () => {
  const t = new DiffTracker();
  t.delta("/one", [change("a.ts", "same line")]);
  t.delta("/two", []);
  assert.equal(t.delta("/two", [change("a.ts", "same line")]).length, 1);
});
