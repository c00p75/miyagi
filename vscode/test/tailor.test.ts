import { test } from "node:test";
import assert from "node:assert/strict";
import { groundedIn, parseTailored, tailorPrompt } from "../src/prompts.js";

const excerpt = [
  "12: export async function totalFor(userId: string) {",
  "13:   const invoices = fetchInvoices(userId);",
  "14:   return invoices.reduce((sum, i) => sum + i.amount, 0);",
  "15: }",
].join("\n");

test("the prompt carries the general lesson, the code and the grounding rules", () => {
  const p = tailorPrompt({ title: "async/await", what: "Waiting for a promise.", hook: "H", lens: "L", pitfall: "P", file: "src/bill.ts", excerpt, depth: "Junior" });
  assert.match(p.user, /src\/bill\.ts/);
  assert.match(p.user, /fetchInvoices\(userId\)/);
  assert.match(p.user, /- pitfall: P/);
  assert.match(p.user, /backticks/);
  assert.match(p.user, /line N/);
});

test("names and line numbers must be in the lines shown", () => {
  assert.equal(groundedIn("`fetchInvoices` runs on line 13 without `await`.", excerpt), false, "`await` is not in the code");
  assert.equal(groundedIn("`fetchInvoices()` returns a promise on line 13.", excerpt), true);
  assert.equal(groundedIn("`loadUser` is called first.", excerpt), false);
  assert.equal(groundedIn("See line 40.", excerpt), false);
  assert.equal(groundedIn("Lines 12-15 are the whole function.", excerpt), true);
  assert.equal(groundedIn("Lines 12 to 99.", excerpt), false);
  assert.equal(groundedIn("No names at all.", excerpt), true);
});

test("an ungrounded part falls back alone; the others are kept", () => {
  const reply = JSON.stringify({
    hook: "`totalFor` adds up a user's invoices.",
    lens: "`fetchInvoices` is called inside `getBilling`.",
    pitfall: "On line 14, `invoices` is still a promise, so `reduce` throws.",
  });
  const t = parseTailored("Sure! " + reply, excerpt);
  assert.ok(t);
  assert.equal(t.hook, "`totalFor` adds up a user's invoices.");
  assert.equal(t.lens, "", "getBilling is not in the code");
  assert.match(t.pitfall, /line 14/);
});

test("nothing usable is null, and an overlong part is dropped", () => {
  assert.equal(parseTailored("not json", excerpt), null);
  assert.equal(parseTailored(JSON.stringify({ hook: "`nope` here", lens: "", pitfall: "" }), excerpt), null);
  const t = parseTailored(JSON.stringify({ hook: "x".repeat(300), lens: "Fine.", pitfall: "" }), excerpt);
  assert.deepEqual(t, { hook: "", lens: "Fine.", pitfall: "" });
});
