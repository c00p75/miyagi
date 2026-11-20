/**
 * "Why not another way?" and the project glossary: what the model is asked,
 * how its reply is checked, and what is kept on disk.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { alternativesPrompt, glossaryPrompt, parseAlternatives, parseGlossary } from "../src/prompts.js";
import {
  addTerms,
  domainFiles,
  emptyGlossary,
  loadGlossary,
  normaliseGlossary,
  registerTerm,
  restoreGlossary,
  termAsIdea,
  termId,
  termsFor,
  updateGlossary,
} from "../src/glossary.js";
import { conceptById } from "../../src/concepts.js";

before(async () => {
  process.env.MIYAGI_HOME = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-glossary-")), "home");
});

// Choices of similar length: the idea registry rejects a question whose answer stands out by length.
const q = { question: "What is a settlement here?", answer: "Paid invoices sent to the bank", distractors: ["A refund issued to a customer", "A customer's saved card detail", "A nightly copy of the database"], explanation: "Settlements group payments." };

/* ---- why not another way? ---- */

test("the alternatives prompt carries the code and, only when given, the learner's own idea", () => {
  const p = alternativesPrompt({ title: "Storing passwords as hashes", file: "auth.ts", excerpt: "3: bcrypt.hash(pw, 12)", guess: "use sha256", depth: "Junior" });
  assert.match(p.user, /3: bcrypt\.hash/);
  assert.match(p.user, /I guessed another way myself: "use sha256"/);
  assert.match(p.user, /exactly 2 real alternatives/);
  const skipped = alternativesPrompt({ title: "t", file: "f", excerpt: "x", guess: "  ", depth: "Mid" });
  assert.doesNotMatch(skipped.user, /I guessed/);
  assert.match(skipped.user, /onGuess: ""/);
});

test("alternatives are parsed, fences stripped, duplicates and empty ones dropped", () => {
  const reply = JSON.stringify({
    chosen: "bcrypt with cost 12",
    why: "Line 3 hashes slowly on purpose.",
    alternatives: [
      { name: "argon2id", sketch: "```ts\nawait argon2.hash(pw)\n```", wins: "Memory-hard", costs: "A native build step", when: "New projects" },
      { name: "argon2id", costs: "duplicate" },
      { name: "", costs: "nameless" },
      { name: "scrypt", sketch: "", wins: "Built into Node", costs: "Harder to tune", when: "No native modules allowed" },
      { name: "third", costs: "only two are kept" },
    ],
    verdict: "Right call for a small app.",
    onGuess: "SHA-256 is fast, so it is the wrong tool.",
  });
  const a = parseAlternatives("Sure!\n" + reply);
  assert.ok(a);
  assert.equal(a.chosen, "bcrypt with cost 12");
  assert.deepEqual(a.alternatives.map((x) => x.name), ["argon2id", "scrypt"]);
  assert.equal(a.alternatives[0].sketch, "await argon2.hash(pw)");
  assert.match(a.onGuess, /SHA-256/);
});

test("a reply without a reason or any usable alternative is refused", () => {
  assert.equal(parseAlternatives('{"chosen": "x", "why": "", "alternatives": [{"name": "y", "costs": "z"}]}'), null);
  assert.equal(parseAlternatives('{"chosen": "x", "why": "w", "alternatives": [{"name": "y"}]}'), null);
  assert.equal(parseAlternatives("not json"), null);
});

/* ---- the glossary ---- */

test("the glossary prompt shows the files and asks not to repeat known terms", () => {
  const p = glossaryPrompt({ files: [{ file: "src/models/invoice.ts", excerpt: "1: export interface Invoice {}" }], tree: ["src/models/invoice.ts"], known: ["tenant"], depth: "Junior" });
  assert.match(p.user, /src\/models\/invoice\.ts/);
  assert.match(p.user, /do not repeat them\): tenant/);
  assert.match(p.user, /Not programming concepts/);
});

test("glossary replies are checked: unknown files dropped, known terms skipped, at most eight", () => {
  const terms = [
    { term: "Settlement", meaning: "Money sent to the merchant's bank", inProject: "The Settlement table", where: ["src/models/settlement.ts", "invented/file.ts"], related: ["Invoice", "Settlement"], question: q },
    { term: "Tenant", meaning: "already known" },
    { term: "settlement", meaning: "duplicate in a different case" },
    { term: "", meaning: "no term" },
    ...Array.from({ length: 12 }, (_, i) => ({ term: `Word ${i}`, meaning: "m" })),
  ];
  const found = parseGlossary(JSON.stringify({ terms }), ["src/models/settlement.ts"], ["tenant"]);
  assert.ok(found);
  assert.equal(found.length, 8);
  assert.equal(found[0].term, "Settlement");
  assert.deepEqual(found[0].where, ["src/models/settlement.ts"], "a file the AI was not shown is not trusted");
  assert.deepEqual(found[0].related, ["Invoice"], "a term is not related to itself");
  assert.ok(found[0].question);
  assert.ok(!found.some((t) => t.term === "Tenant"));
  assert.equal(parseGlossary('{"terms": []}', [], [])?.length, 0, "no terms is a good answer");
  assert.equal(parseGlossary("nope", [], []), null);
});

test("terms are kept per project, and a term already there is not overwritten", () => {
  const g = emptyGlossary();
  const where = { project: "shop", root: "/code/shop", by: "Claude Code (haiku)" };
  const first = addTerms(g, [{ term: "Settlement", meaning: "first", inProject: "", where: [], related: [], question: q }], where);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, termId("shop", "Settlement"));
  const again = addTerms(g, [{ term: "settlement", meaning: "second", inProject: "", where: [], related: [], question: null }], where);
  assert.equal(again.length, 0);
  assert.equal(termsFor(g, "shop")[0].meaning, "first");
  addTerms(g, [{ term: "Settlement", meaning: "other project", inProject: "", where: [], related: [], question: null }], { ...where, project: "blog" });
  assert.equal(termsFor(g, "blog").length, 1);
  assert.equal(termsFor(g, "shop").length, 1);
});

test("the file on disk is read defensively and written safely", async () => {
  assert.deepEqual((await loadGlossary()).terms, [], "no file is an empty glossary");
  await updateGlossary((g) => addTerms(g, [{ term: "Payout", meaning: "Money out", inProject: "payouts table", where: ["db.sql"], related: [], question: q }], { project: "shop", root: "/r", by: "AI" }));
  const back = await loadGlossary();
  assert.equal(back.terms[0].term, "Payout");
  const messy = normaliseGlossary({ terms: [{ id: "x" }, "junk", { ...back.terms[0], where: "not a list", question: { question: "q" } }] });
  assert.equal(messy.terms.length, 1, "a broken entry costs only itself");
  assert.deepEqual(messy.terms[0].where, []);
  assert.equal(messy.terms[0].question, null);
});

test("a term goes on review as an idea, and is registered again after a restart", async () => {
  const g = emptyGlossary();
  const [t] = addTerms(g, [{ term: "Chargeback", meaning: "A customer's bank takes a payment back", inProject: "Dispute model", where: [], related: [], question: q }], { project: "shop", root: "/r", by: "AI" });
  assert.equal(termAsIdea({ ...t, question: null }), null, "no question, no review");
  const unfair = { ...q, answer: "A very long answer that gives itself away by being far longer than the rest" };
  assert.equal(registerTerm({ ...t, id: "term-shop-unfair", question: unfair }), null, "a question that fails the quality bar is not put on review");
  const id = registerTerm(t);
  assert.equal(id, t.id);
  assert.match(conceptById(t.id)?.title ?? "", /"Chargeback" in shop/);
  await updateGlossary((x) => {
    x.terms.push({ ...t, id: "term-shop-restored", conceptId: "term-shop-restored" });
  });
  assert.ok((await restoreGlossary()) >= 1);
  assert.ok(conceptById("term-shop-restored"));
});

test("domain files are preferred: models, schemas and types over tests and config", () => {
  const files = ["README.md", "src/models/invoice.ts", "prisma/schema.prisma", "src/types.ts", "src/models/invoice.test.ts", "vite.config.ts", "src/components/Button.tsx", "src/api/routes.ts"];
  const picked = domainFiles(files, 4);
  assert.ok(picked.includes("prisma/schema.prisma"));
  assert.ok(picked.includes("src/models/invoice.ts"));
  assert.ok(!picked.includes("src/models/invoice.test.ts"));
  assert.ok(!picked.includes("vite.config.ts"));
  assert.ok(!picked.includes("README.md"));
});
