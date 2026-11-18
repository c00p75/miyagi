/**
 * The two things a per-line pattern cannot know: that a line is a comment,
 * and that a statement runs over several lines.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, familyOf } from "../src/structure.js";
import { detectConcepts } from "../src/concepts.js";

const ids = (file: string, code: string) => detectConcepts(file, code).map((h) => h.id);

test("comments are blanked without changing line count or length", () => {
  const lines = [
    "const a = 1; // await the result",
    "/* useEffect(() => {}) */ const b = 2;",
    "const url = 'http://example.com/a//b'; // real comment",
    "const c = `template // not a comment`;",
  ];
  const { code } = analyse("a.ts", lines);
  assert.equal(code.length, lines.length);
  code.forEach((c, i) => assert.equal(c.length, lines[i].length));
  assert.match(code[0], /^const a = 1; +$/);
  assert.match(code[1], /^ +const b = 2;$/);
  assert.ok(code[2].includes("'http://example.com/a//b'"), "slashes inside a string are not a comment");
  assert.ok(!code[2].includes("real comment"));
  assert.equal(code[3], lines[3], "nor inside a template literal");
});

test("each syntax family has its own comments", () => {
  assert.equal(familyOf("a.py"), "hash");
  assert.equal(familyOf("src/App.vue"), "markup");
  assert.equal(familyOf("q.sql"), "sql");
  assert.equal(familyOf("Dockerfile"), "hash");
  assert.equal(familyOf("data.json"), "none");
  assert.match(analyse("a.py", ['x = "#fff"  # await this'])[`code`][0], /^x = "#fff" +$/);
  assert.match(analyse("q.sql", ["SELECT 1 -- BEGIN later"]).code[0], /^SELECT 1 +$/);
  assert.match(analyse("p.html", ["<p>hi</p><!-- innerHTML = x -->"]).code[0], /^<p>hi<\/p> +$/);
  assert.equal(analyse("run.sh", ["#!/bin/sh"]).code[0], "#!/bin/sh", "a shebang is not a comment");
  assert.equal(analyse("data.json", ['{"a": "// not a comment"}']).code[0], '{"a": "// not a comment"}');
});

test("a fragment that starts inside a doc comment does not leak prose into detection", () => {
  const fragment = [" * Call fetch(url) and await the response.", " * Uses useEffect internally.", " */", "export const x = 1;"];
  assert.deepEqual(ids("a.ts", fragment.join("\n")), []);
  // An unclosed block comment in a short fragment blanks what follows it, and no more.
  const { code } = analyse("a.ts", ["/* note", "still note", "*/ const y = await load();"]);
  assert.match(code[2], /const y = await load\(\);$/);
});

test("prose in a comment no longer counts as the idea it mentions", () => {
  assert.deepEqual(ids("a.ts", "// await the result before returning"), []);
  assert.deepEqual(ids("a.ts", "const total = sum(a, b); // TODO: wrap in try/catch and use bcrypt"), []);
  assert.deepEqual(ids("app.py", "# cache.get(key) would be faster here"), []);
  assert.ok(ids("a.ts", "const r = await load(); // comment").includes("async-await"), "the code on the line still counts");
});

test("ideas that are written as comments, or hide in them, are still found", () => {
  assert.ok(ids("a.ts", "// @ts-ignore").includes("type-escape"));
  assert.ok(ids("a.ts", '// const apiKey = "sk_live_abcdefghijklmnop1234";').includes("hardcoded-secret"), "a secret in a comment is still leaked");
});

test("a statement split across lines is matched as a whole, once", () => {
  const split = ["const rows = await db.query(", "  `SELECT * FROM posts", "   LIMIT ${size}", "   OFFSET ${skip}`,", ");"].join("\n");
  const hits = detectConcepts("a.ts", split);
  const pagination = hits.find((h) => h.id === "pagination");
  assert.ok(pagination, `pagination across two lines, got ${hits.map((h) => h.id).join()}`);
  assert.equal(pagination.count, 1, "one statement is one sighting");
  // The same lines with no enclosing statement are separate lines, as before.
  assert.ok(!ids("notes.txt", "LIMIT is a word\nOFFSET is another").includes("pagination"));
});

test("statements are grouped by brackets and template literals, with a cap", () => {
  const { statement } = analyse("a.ts", ["call(", "  a,", "  b", ");", "const z = 1;"]);
  assert.equal(statement[0], "call( a, b );");
  assert.equal(statement[3], statement[0]);
  assert.equal(statement[4], "", "a one-line statement has no joined form");
  const long = analyse("a.ts", ["f(", ...Array.from({ length: 30 }, (_, i) => `  arg${i},`), ");"]);
  assert.ok(long.statement.every((s) => s.split(" ").length <= 9), "never more than eight lines joined");
});
