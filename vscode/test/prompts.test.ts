/**
 * A model's reply is untrusted input. These cover what each parser accepts,
 * and more importantly what it refuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bugDrillPrompt,
  changeBlock,
  extractJson,
  findIdeasPrompt,
  parseAttemptFeedback,
  parseBugDrill,
  parseFoundIdeas,
  parseOwnQuestion,
  parseRisks,
  parseWalkthrough,
  projectMapPrompt,
  riskPrompt,
} from "../src/prompts.js";

test("JSON is found however the model wrapped it", () => {
  assert.deepEqual(extractJson('{"a": 1}'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go:\n```json\n{"a": {"b": "}"}}\n```\nHope that helps.'), { a: { b: "}" } });
  assert.deepEqual(extractJson('{"s": "a \\"quoted\\" brace }"} trailing'), { s: 'a "quoted" brace }' });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson('{"unterminated": '), null);
  assert.equal(extractJson("{not json}"), null);
});

test("a question needs an answer and at least two different wrong answers", () => {
  const good = parseOwnQuestion(
    JSON.stringify({ question: "What does line 3 do?", answer: "Hashes it", distractors: ["Encrypts it", "Stores it", "Hashes it"], explanation: "Because." }),
  );
  assert.ok(good);
  assert.deepEqual(good.distractors, ["Encrypts it", "Stores it"], "a distractor equal to the answer is dropped");
  assert.equal(parseOwnQuestion(JSON.stringify({ question: "Q?", answer: "A", distractors: ["B"] })), null);
  assert.equal(parseOwnQuestion(JSON.stringify({ question: "Q?", answer: "A", distractors: ["b", "B"] })), null, "case is not a difference");
  assert.equal(parseOwnQuestion(JSON.stringify({ answer: "A", distractors: ["B", "C"] })), null);
  assert.equal(parseOwnQuestion("I could not think of a question."), null);
});

test("an attempt is judged right, partly or wrong, and nothing else", () => {
  assert.deepEqual(parseAttemptFeedback('{"verdict": "Partly", "feedback": "You missed line 4."}'), {
    verdict: "partly",
    feedback: "You missed line 4.",
  });
  assert.equal(parseAttemptFeedback('{"verdict": "excellent", "feedback": "Great job"}'), null);
  assert.equal(parseAttemptFeedback('{"verdict": "right"}'), null);
});

test("a bug drill must point at a real line of code", () => {
  const code = "function f(a) {\n  if (a = 1) {\n    return true;\n  }\n}";
  const drill = parseBugDrill(JSON.stringify({ code, bugLine: 2, hint: "Look at the condition.", explanation: "Assignment, not comparison." }));
  assert.ok(drill);
  assert.equal(drill.lines.length, 5);
  assert.equal(drill.lines[drill.bugLine - 1], "  if (a = 1) {");
  assert.equal(parseBugDrill(JSON.stringify({ code, bugLine: 9, explanation: "x" })), null, "past the end");
  assert.equal(parseBugDrill(JSON.stringify({ code, bugLine: 4, explanation: "x" })), null, "a lone brace is not a bug");
  assert.equal(parseBugDrill(JSON.stringify({ code, bugLine: 2 })), null, "no explanation");
  assert.equal(parseBugDrill(JSON.stringify({ code: "x", bugLine: 1, explanation: "x" })), null, "too short to be an exercise");
  assert.equal(parseBugDrill(JSON.stringify({ code, bugLine: "2", explanation: "x" }))?.bugLine, 2, "a number sent as text");
});

test("risks keep to the files that were sent, and an empty list is an answer", () => {
  const known = ["src/api/users.ts", "src/db.ts"];
  assert.deepEqual(parseRisks('{"risks": []}', known), []);
  assert.equal(parseRisks("Looks fine to me!", known), null);
  const risks = parseRisks(
    JSON.stringify({
      risks: [
        { file: "users.ts", line: 12, title: "No auth check", why: "Anyone can delete.", fix: "Check the session." },
        { file: "/etc/passwd", line: 1, title: "Made up", why: "Not a file we sent." },
        { title: "", why: "no title" },
        { file: "src/db.ts", line: -4, title: "Bad line", why: "x" },
        { file: "src/db.ts", line: 1, title: "A fourth", why: "x" },
      ],
    }),
    known,
  );
  assert.ok(risks);
  assert.equal(risks.length, 2, "at most three are read, and the untitled one is dropped");
  assert.equal(risks[0].file, "src/api/users.ts", "a shortened path is mapped back");
  assert.equal(risks[1].file, "", "a file we never sent is not linked");
});

test("a walkthrough needs at least two usable steps", () => {
  const known = ["a.ts"];
  const steps = parseWalkthrough(
    JSON.stringify({ steps: [{ file: "a.ts", line: 3, title: "Start", text: "It begins." }, { line: 9, title: "End", text: "It ends." }] }),
    known,
  );
  assert.ok(steps);
  assert.equal(steps[1].file, "a.ts", "with one file, a step that names none means that file");
  assert.equal(parseWalkthrough(JSON.stringify({ steps: [{ title: "Only", text: "one" }] }), known), null);
  assert.equal(parseWalkthrough('{"steps": "see above"}', known), null);
});

test("found ideas are capped at two and need a whole lesson", () => {
  const idea = (title: string, extra: object = {}) => ({
    title,
    topic: "Frontend",
    hook: "h",
    what: "w",
    know: "k",
    pitfall: "p",
    file: "a.ts",
    evidence: "x",
    question: { question: "Q?", answer: "A", distractors: ["B", "C", "D"], explanation: "E" },
    ...extra,
  });
  const found = parseFoundIdeas(JSON.stringify({ ideas: [idea("Debouncing"), idea("Half", { pitfall: "" }), idea("Third")] }), ["a.ts"]);
  assert.ok(found);
  assert.deepEqual(found.map((f) => f.title), ["Debouncing"], "the incomplete one is dropped and the third is never read");
  assert.equal(found[0].topic, "Frontend");
  assert.ok(found[0].question);
  const odd = parseFoundIdeas(JSON.stringify({ ideas: [idea("Memoising", { topic: "Cooking", question: { question: "Q?" } })] }), ["a.ts"]);
  assert.equal(odd?.[0].topic, "Tooling", "an unknown topic falls back");
  assert.equal(odd?.[0].question, null, "a broken question does not sink the lesson");
  assert.deepEqual(parseFoundIdeas('{"ideas": []}', []), []);
});

test("prompts stay within their budgets and say what must not be done", () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ file: `f${i}.ts`, excerpt: "x".repeat(900) }));
  const block = changeBlock(big);
  assert.ok(block.length < 10_500, `change block was ${block.length}`);
  assert.match(block, /more file\(s\) not shown/);
  assert.match(riskPrompt(big.slice(0, 1), "Junior").user, /Do not invent a risk/);
  assert.match(findIdeasPrompt(big.slice(0, 1), ["React state"], "Mid").user, /already being taught: React state/);
  assert.match(bugDrillPrompt({ title: "t", excerpt: "1: x", depth: "Senior" }).user, /exactly one line/);
  const map = projectMapPrompt(
    { name: "shop", tree: ["a.ts"], totalFiles: 900, heads: Array.from({ length: 30 }, (_, i) => ({ file: `h${i}`, head: "y".repeat(2_000) })) },
    "Junior",
  );
  assert.ok(map.user.length < 15_000, `map prompt was ${map.user.length}`);
  assert.match(map.user, /Do not present a guess as a fact/);
  for (const p of [map, riskPrompt(big.slice(0, 1), "Mid")]) {
    assert.doesNotMatch(p.system, /["'\n]/, "the system line is passed as a shell argument");
  }
});
