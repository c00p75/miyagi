/**
 * Idea packs on disk.
 *
 * What a pack may contain is `registerConcepts`' business and is tested there.
 * This suite is about the files: that every one is accounted for, that a bad
 * one is named instead of ignored, and that one bad file does not take the
 * good ones down with it.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-packs-"));
process.env.MIYAGI_HOME = home;

const { ideaPacksDir, loadIdeaPacks, packProblems } = await import("../src/packs.js");
const { CONCEPTS, clearRegisteredConcepts, conceptById, conceptOrigin, detectConcepts } = await import(
  "../src/concepts.js"
);
const { questionById } = await import("../src/quiz.js");
const { runDoctor } = await import("../src/doctor.js");

const BUILT_IN_COUNT = CONCEPTS.length;

const idea = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Idea ${id}`,
  patterns: [`\\b${id.replace(/-/g, "_")}\\(`],
  hook: "A hook that is long enough to read.",
  what: "What this idea is, in one plain sentence.",
  lens: "The same explanation at every depth, which is allowed for a pack.",
  pitfall: "What goes wrong when it is misunderstood.",
  questions: [
    {
      question: `What is the idea called ${id} about, in this test?`,
      answer: "Nothing in particular",
      distractors: ["Everything all at once, in detail", "Something else that is unrelated"],
      explanation: "It exists so the loader has a question to register.",
    },
  ],
  ...over,
});

const write = (file: string, content: unknown) =>
  fs.writeFile(
    path.join(ideaPacksDir(), file),
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8",
  );

beforeEach(async () => {
  clearRegisteredConcepts();
  await fs.rm(ideaPacksDir(), { recursive: true, force: true });
  await fs.mkdir(ideaPacksDir(), { recursive: true });
});

test("packs live under the profile directory", () => {
  assert.equal(ideaPacksDir(), path.join(home, "ideas"));
});

test("a missing ideas directory is not an error", async () => {
  await fs.rm(ideaPacksDir(), { recursive: true, force: true });
  assert.deepEqual(await loadIdeaPacks(), []);
});

test("a pack's concepts are registered, with the file as their origin", async () => {
  await write("team.json", { name: "Team rules", concepts: [idea("money-rule"), idea("flag-rule")] });
  await write("notes.txt", "not a pack, and not read");

  const loads = await loadIdeaPacks();
  assert.equal(loads.length, 1);
  assert.deepEqual(loads[0], {
    file: "team.json",
    name: "Team rules",
    added: ["money-rule", "flag-rule"],
    rejected: [],
  });
  assert.deepEqual(packProblems(loads), []);

  assert.equal(conceptById("money-rule")?.title, "Idea money-rule");
  assert.equal(conceptOrigin("money-rule"), "pack:team.json");
  assert.ok(detectConcepts("a.py", "total = money_rule(order)").some((h) => h.id === "money-rule"));
  assert.equal(questionById("c-flag-rule-1")?.answer, "Nothing in particular");
});

test("files load in name order, the later one wins a shared id, and a pack with no name takes its file's", async () => {
  await write("b.json", { concepts: [idea("shared-idea", { title: "From b" })] });
  await write("a.json", { name: "  ", concepts: [idea("shared-idea", { title: "From a" })] });
  await write("C.JSON", { name: "Upper", concepts: [idea("third-idea")] });

  const loads = await loadIdeaPacks();
  assert.deepEqual(loads.map((l) => l.file), ["C.JSON", "a.json", "b.json"]);
  assert.deepEqual(loads.map((l) => l.name), ["Upper", "a", "b"]);
  assert.equal(conceptById("shared-idea")?.title, "From b");
  assert.equal(conceptOrigin("shared-idea"), "pack:b.json");
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT + 2);
});

test("a file that is not a pack is reported with an error and registers nothing", async () => {
  await write("broken.json", "{ not json");
  await write("list.json", [idea("in-a-list")]);
  await write("no-concepts.json", { name: "Empty-handed" });
  await write("wrong-type.json", { name: "Wrong", concepts: { id: "an-object" } });
  await write("null.json", "null");
  await write("good.json", { name: "Good", concepts: [idea("good-idea")] });

  const loads = await loadIdeaPacks();
  const by = Object.fromEntries(loads.map((l) => [l.file, l]));
  assert.equal(loads.length, 6, "every file is accounted for");

  for (const file of ["broken.json", "list.json", "no-concepts.json", "wrong-type.json", "null.json"]) {
    assert.ok(by[file].error, `${file} loaded without an error`);
    assert.deepEqual(by[file].added, []);
  }
  assert.match(by["no-concepts.json"].error!, /concepts/);
  assert.equal(by["no-concepts.json"].name, "Empty-handed");
  assert.equal(conceptById("in-a-list"), undefined);

  assert.equal(by["good.json"].error, undefined);
  assert.deepEqual(by["good.json"].added, ["good-idea"], "a bad neighbour hid a good pack");
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT + 1);

  const problems = packProblems(loads);
  assert.equal(problems.length, 5);
  assert.ok(problems.some((p) => p.startsWith("broken.json (")));
});

test("a bad concept is rejected by name while the rest of its pack loads", async () => {
  await write("mixed.json", {
    name: "Mixed",
    concepts: [idea("fine-idea"), idea("react-state"), idea("bad-regex", { patterns: ["(unclosed"] }), { title: "no id" }],
  });

  const [load] = await loadIdeaPacks();
  assert.equal(load.error, undefined);
  assert.deepEqual(load.added, ["fine-idea"]);
  assert.deepEqual(load.rejected.map((r) => r.id), ["react-state", "bad-regex", "(unknown)"]);
  assert.match(load.rejected[0].reason, /built-in/);
  assert.notEqual(conceptById("react-state")?.title, "Idea react-state", "a pack replaced a built-in");

  const problems = packProblems([load]);
  assert.equal(problems.length, 3);
  assert.ok(problems.every((p) => p.startsWith("mixed.json: ")));
});

test("an oversized file is refused before it is parsed", async () => {
  await write("huge.json", JSON.stringify({ name: "Huge", concepts: [idea("huge-idea")], padding: "x".repeat(500_001) }));
  const [load] = await loadIdeaPacks();
  assert.match(load.error ?? "", /larger than 500 kB/);
  assert.equal(conceptById("huge-idea"), undefined);
});

test("only the first 200 concepts of a pack are read, and the rest are reported", async () => {
  const concepts = Array.from({ length: 203 }, (_, i) =>
    idea(`bulk-idea-${i}`, { patterns: [], questions: [] }),
  );
  await write("bulk.json", { name: "Bulk", concepts });
  const [load] = await loadIdeaPacks();
  assert.equal(load.added.length, 200);
  assert.equal(conceptById("bulk-idea-199")?.id, "bulk-idea-199");
  assert.equal(conceptById("bulk-idea-200"), undefined);
  assert.deepEqual(load.rejected.map((r) => r.id), ["(pack)"]);
  assert.match(load.rejected[0].reason, /3 concepts past the limit of 200/);
});

test("loading again picks up an edited pack instead of duplicating it", async () => {
  await write("team.json", { name: "Team", concepts: [idea("money-rule")] });
  await loadIdeaPacks();
  await write("team.json", { name: "Team", concepts: [idea("money-rule", { title: "Edited" })] });
  await loadIdeaPacks();
  assert.equal(conceptById("money-rule")?.title, "Edited");
  assert.equal(CONCEPTS.length, BUILT_IN_COUNT + 1);
});

test("the doctor counts loaded packs and names what was skipped", async () => {
  await write("good.json", { name: "Good", concepts: [idea("good-idea")] });
  const clean: string[] = [];
  await runDoctor((line) => clean.push(line));
  assert.ok(clean.some((l) => /Idea packs: 1 idea from 1 file/.test(l)), clean.join("\n"));
  assert.ok(!clean.some((l) => /Idea packs skipped/.test(l)));

  await write("broken.json", "{ not json");
  await write("mixed.json", { concepts: [idea("css-layout")] });
  const lines: string[] = [];
  const code = await runDoctor((line) => lines.push(line));
  const skipped = lines.find((l) => /Idea packs skipped/.test(l)) ?? "";
  assert.match(skipped, /broken\.json/);
  assert.match(skipped, /mixed\.json: css-layout/);
  assert.equal(code, 0, "a skipped pack is a warning, not a failed install");
});
