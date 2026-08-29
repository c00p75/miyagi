/**
 * The eval suite: a rubric over everything a learner can actually see.
 *
 * Unit tests check that a function does what it says. These check that the
 * *content* is worth reading — every lesson at every depth, every question in
 * the bank, every card the server can render — because the failure mode of a
 * teaching tool is not a crash, it is a card that is technically correct and
 * says nothing. That is invisible to a type checker and obvious to a rubric.
 *
 * Every assertion here is a defect this codebase has shipped or nearly shipped:
 * boilerplate lessons, a quiz whose answer was always in the same slot, a
 * diagram broken by an apostrophe, a card with `undefined` in it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.MIYAGI_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-quality-"));

const { CONTENT, binOf, diagramFor, docsFor, lensFor, pitfallsFor, teachingBrief } = await import(
  "../src/content.js"
);
const { QUIZ_BANK, ask, grade, shuffleChoices } = await import("../src/quiz.js");
const { allTracks } = await import("../src/roadmaps.js");
const { renderTeachingCard, quizBlock, hotfixDiagnostic } = await import("../src/render.js");
const { sanitizeForSpeech } = await import("../src/tts.js");
const { screenCommand, screenDanger } = await import("../src/safety.js");
const { titleForLevel } = await import("../src/profile.js");

const LEVELS = ["Junior", "Mid", "Senior"] as const;

/**
 * Whether rendered text has a JavaScript value showing through.
 *
 * Deliberately precise rather than a substring search for "undefined": one
 * distractor legitimately discusses undefined *behaviour*, and a rubric that
 * cannot tell those apart would either fire falsely or be turned off. What is
 * never acceptable is a value standing alone where content belongs.
 */
function leaksJsValue(text: string): string | null {
  if (text.includes("[object Object]")) return "[object Object]";
  for (const line of text.split("\n")) {
    // A choice, list item or field whose entire value is a JS value.
    if (/^(?:[A-Z]\.|[-*]|>?\s*\*\*[^*]+:\*\*)\s*(undefined|null|NaN)\s*$/.test(line.trim())) {
      return line.trim();
    }
    if (/\b(undefined|NaN)\b\s*(?:$|[.,)])/.test(line) && !/behaviour|behavior|variable|value is/.test(line)) {
      return line.trim().slice(0, 80);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Lesson quality
 * ------------------------------------------------------------------ */

/** Phrases that describe a lesson instead of being one. */
const HOLLOW = [
  /^plain-language definition/i,
  /^flag-by-flag walkthrough/i,
  /\bwhat you should expect to see\b/i,
  /\ba description of\b/i,
  /\bTODO\b/,
  /\bTBD\b/,
  /lorem ipsum/i,
];

test("no lesson describes an explanation instead of giving one", () => {
  // The v1 card printed "Plain-language definition, what you should expect to
  // see on screen..." for every command. That is a table of contents.
  for (const [bin, entry] of Object.entries(CONTENT)) {
    for (const level of LEVELS) {
      const lens = entry.lens[level];
      for (const [field, text] of Object.entries(lens)) {
        for (const pattern of HOLLOW) {
          assert.ok(
            !pattern.test(text),
            `${bin} ${level} ${field} reads as boilerplate: "${text.slice(0, 80)}"`,
          );
        }
      }
    }
  }
});

test("every lesson is specific to its command, not to shells in general", () => {
  for (const [bin, entry] of Object.entries(CONTENT)) {
    const blob = LEVELS.map((l) => Object.values(entry.lens[l]).join(" "))
      .join(" ")
      .toLowerCase();
    const aliasesOf: Record<string, string[]> = {
      printf: ["printf", "echo"],
      set: ["set -e", "pipefail", "strict"],
      test: ["test", "[ ", "condition"],
      command: ["command -v", "which", "path"],
      sh: ["sh ", "shell", "shebang"],
      cd: ["cd", "director"],
      tsc: ["tsc", "typescript", "type"],
      eslint: ["eslint", "lint"],
    };
    const needles = aliasesOf[bin] ?? [bin];
    assert.ok(
      needles.some((n) => blob.includes(n.toLowerCase())),
      `${bin}'s lesson never mentions ${needles.join(" or ")}, so it is not about ${bin}`,
    );
  }
});

test("depth actually changes the lesson at every level boundary", () => {
  for (const [bin, entry] of Object.entries(CONTENT)) {
    const junior = entry.lens.Junior;
    const mid = entry.lens.Mid;
    const senior = entry.lens.Senior;
    for (const field of ["what", "how", "tradeoffs"] as const) {
      assert.notEqual(junior[field], mid[field], `${bin} ${field}: Junior and Mid are identical`);
      assert.notEqual(mid[field], senior[field], `${bin} ${field}: Mid and Senior are identical`);
    }
    const words = (s: string) => s.split(/\s+/).length;
    assert.ok(
      words(senior.how) + words(senior.tradeoffs) >= words(junior.how) * 0.7,
      `${bin}: the Senior lesson is thinner than the Junior one`,
    );
  }
});

test("every pitfall states a consequence, not just a rule", () => {
  for (const [bin, entry] of Object.entries(CONTENT)) {
    for (const pitfall of entry.pitfalls) {
      assert.ok(pitfall.length > 40, `${bin} has a pitfall too short to be useful: "${pitfall}"`);
      assert.ok(/[.!]$/.test(pitfall.trim()), `${bin} pitfall is not a sentence: "${pitfall}"`);
    }
  }
});

test("every documentation link is plausible and consistently labelled", () => {
  const seen = new Map<string, string>();
  for (const [bin, entry] of Object.entries(CONTENT)) {
    for (const doc of entry.docs) {
      assert.match(doc.url, /^https:\/\//, `${bin} has a non-HTTPS doc link: ${doc.url}`);
      assert.ok(doc.label.length > 3, `${bin} has an unlabelled doc link`);
      assert.ok(!/localhost|example\.com/.test(doc.url), `${bin} links to a placeholder`);
      const previous = seen.get(doc.url);
      if (previous) {
        // The same URL under two labels is a copy-paste slip.
        assert.equal(previous, doc.label, `${doc.url} is labelled two different ways`);
      }
      seen.set(doc.url, doc.label);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Quiz quality
 * ------------------------------------------------------------------ */

test("no question can be answered by picking the longest choice", () => {
  // With four choices, chance puts the answer last-by-length 25% of the time.
  // Anything much above that means the distractors were written with less care
  // than the answer, and a learner can score without knowing anything.
  let longest = 0;
  for (const q of QUIZ_BANK) {
    const lengths = q.choices.map((c) => c.length);
    if (Math.max(...lengths) === q.answer.length) longest++;
  }
  const share = longest / QUIZ_BANK.length;
  assert.ok(
    share < 0.35,
    `the answer is the longest choice in ${Math.round(share * 100)}% of questions`,
  );
});

test("no question leaks its answer through its own wording", () => {
  for (const q of QUIZ_BANK) {
    const question = q.question.toLowerCase();
    const answerWords = q.answer
      .toLowerCase()
      .split(/[^a-z0-9$?]+/)
      .filter((w) => w.length > 5);
    const leaked = answerWords.filter((w) => question.includes(w));
    // One shared technical term is normal; several means the question says it.
    assert.ok(
      leaked.length <= 1,
      `${q.id} leaks its answer: question shares ${leaked.join(", ")} with the answer`,
    );
  }
});

test("distractors are distinct enough to be a real choice", () => {
  for (const q of QUIZ_BANK) {
    // Punctuation is kept: `$?` and `$!` differ only by it, and that difference
    // is the whole question. Whitespace and case are not meaningful.
    const normalised = q.choices.map((c) => c.toLowerCase().replace(/\s+/g, " ").trim());
    assert.ok(normalised.every(Boolean), `${q.id} has an empty choice`);
    assert.equal(new Set(normalised).size, normalised.length, `${q.id} has near-duplicate choices`);
    for (const choice of q.choices) {
      assert.ok(choice.trim().length >= 2, `${q.id} has a stub choice: "${choice}"`);
    }
  }
});

test("every explanation teaches, rather than restating the answer", () => {
  for (const q of QUIZ_BANK) {
    assert.ok(q.explanation.length > 40, `${q.id}'s explanation is too thin to teach`);
    assert.notEqual(
      q.explanation.toLowerCase().trim(),
      q.answer.toLowerCase().trim(),
      `${q.id} explains the answer with the answer`,
    );
  }
});

test("answers are spread across positions over many askings", () => {
  // The v1 engine was deterministic, so a learner could learn the letter.
  const positions = new Map<number, number>();
  for (const q of QUIZ_BANK) {
    for (let salt = 0; salt < 12; salt++) {
      const idx = shuffleChoices(q.choices, `${q.id}:${salt}`).indexOf(q.answer);
      positions.set(idx, (positions.get(idx) ?? 0) + 1);
    }
  }
  const counts = [...positions.values()];
  const total = counts.reduce((a, b) => a + b, 0);
  assert.ok(positions.size >= 4, "the answer never lands in some positions");
  for (const [idx, count] of positions) {
    const share = count / total;
    assert.ok(
      share > 0.1 && share < 0.45,
      `position ${idx} holds ${Math.round(share * 100)}% of answers`,
    );
  }
});

test("grading every question by its own answer and letter always succeeds", () => {
  // A round-trip over the whole bank: authoring an answer the grader cannot
  // match is a defect no single test case would catch.
  for (const q of QUIZ_BANK) {
    const asked = ask(q, q.bins[0] ?? "shell", { salt: q.id });
    assert.equal(grade(asked, q.answer).correct, true, `${q.id} rejects its own answer`);
    const letter = String.fromCharCode(65 + asked.choices.indexOf(asked.answer));
    assert.equal(grade(asked, letter).correct, true, `${q.id} rejects its own letter`);
    for (const wrong of asked.choices.filter((c) => c !== asked.answer)) {
      assert.equal(grade(asked, wrong).correct, false, `${q.id} accepts a wrong choice: ${wrong}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Card rendering, over everything a track can produce
 * ------------------------------------------------------------------ */

const roadmap = {
  category: "Absolute Beginners" as const,
  roadmap_name: "Command Line Basics",
  current_topic: "Navigating the filesystem",
  step_index: 3,
  total_steps: 10,
};

const player = {
  xp: 260,
  level: 3,
  title: titleForLevel(3),
  quizStreak: 2,
  bestStreak: 5,
  badges: ["Sharpshooter"],
};

function card(command: string, level: (typeof LEVELS)[number], ok: boolean): string {
  const quiz = ask(QUIZ_BANK[0], binOf(command), { salt: command });
  return renderTeachingCard({
    command,
    outcome: ok
      ? {
          ok: true,
          stdout: "some output",
          stderr: "",
          code: 0,
          signal: null,
          truncated: false,
          timedOut: false,
          durationMs: 4,
        }
      : {
          ok: false,
          stdout: "",
          stderr: "boom",
          code: 1,
          signal: null,
          truncated: false,
          timedOut: false,
          durationMs: 4,
          errorMessage: "failed",
        },
    executed: true,
    dryRunReason: null,
    concept: null,
    quiz: { quiz, token: `${quiz.id}#1` },
    xp: null,
    day: null,
    screening: screenCommand(command),
    skillLevel: level,
    roadmap,
    player,
    streakLine: "Quiz streak: **2**",
    reviewDue: 0,
  });
}

test("every track step renders a complete card at every depth", () => {
  const problems: string[] = [];
  for (const track of allTracks()) {
    for (const step of track.steps) {
      for (const level of LEVELS) {
        for (const ok of [true, false]) {
          const text = card(step.command, level, ok);
          const check = (bad: boolean, why: string) => {
            if (bad) problems.push(`${track.name} / ${step.command} / ${level}: ${why}`);
          };
          const leak = leaksJsValue(text);
          check(leak !== null, `leaked a JS value: ${leak}`);
          check((text.match(/```/g) ?? []).length % 2 !== 0, "unbalanced code fence");
          check(!text.includes("Concept"), "no concept section");
          check(!text.includes("Common Pitfalls"), "no pitfalls section");
          check(!text.includes("Tutor brief"), "no tutor brief");
          check(text.includes("- **What:** \n"), "empty What");
          check(text.length < 600, "suspiciously short card");
        }
      }
    }
  }
  assert.deepEqual(problems, [], `cards with defects:\n  ${problems.slice(0, 10).join("\n  ")}`);
});

test("every mermaid diagram is balanced and renderable", () => {
  for (const track of allTracks()) {
    for (const step of track.steps) {
      for (const ok of [true, false]) {
        const diagram = diagramFor(step.command, ok, step.topic);
        assert.match(diagram, /^flowchart (TD|LR)/, step.command);
        assert.equal(
          (diagram.match(/"/g) ?? []).length % 2,
          0,
          `unbalanced quotes for ${step.command} (an apostrophe in a topic used to do this)`,
        );
        assert.equal(
          (diagram.match(/\[/g) ?? []).length,
          (diagram.match(/\]/g) ?? []).length,
          step.command,
        );
        assert.ok(!/\n\s*\n/.test(diagram), `blank line inside diagram for ${step.command}`);
      }
    }
  }
});

test("every card is speakable: sanitising leaves prose, not punctuation soup", () => {
  for (const track of allTracks()) {
    for (const step of track.steps.slice(0, 3)) {
      const spoken = sanitizeForSpeech(card(step.command, "Mid", true));
      assert.ok(spoken.length > 40, `nothing left to speak for ${step.command}`);
      assert.ok(!/[`*#|]/.test(spoken), `markdown survived into speech for ${step.command}`);
      assert.ok(!spoken.includes("http"), `a URL survived into speech for ${step.command}`);
      const letters = spoken.replace(/[^a-z]/gi, "").length;
      assert.ok(letters / spoken.length > 0.6, `mostly punctuation for ${step.command}`);
    }
  }
});

test("a hotfix diagnostic always ends with something actionable", () => {
  const cases: Array<[string, string, number | null]> = [
    ["ls /nope", "No such file or directory", 2],
    ["frobnicate", "command not found", 127],
    ["cat /etc/shadow", "Permission denied", 1],
    ["node app.js", "EADDRINUSE: address already in use", 1],
    ["curl http://localhost:1", "Connection refused", 7],
    ["weird", "something nobody has ever seen", 42],
  ];
  for (const [command, stderr, code] of cases) {
    const text = hotfixDiagnostic(command, {
      ok: false,
      stdout: "",
      stderr,
      code,
      signal: null,
      truncated: false,
      timedOut: false,
      durationMs: 1,
    });
    assert.match(text, /Troubleshooting ladder/, command);
    assert.match(text, /1\. /, command);
    assert.ok(text.includes("Failures are curriculum"), command);
    assert.equal(leaksJsValue(text), null, `${command} leaked a JS value`);
  }
});

/* ------------------------------------------------------------------ *
 * Fuzz: nothing a caller can type may throw
 * ------------------------------------------------------------------ */

test("hostile and malformed command lines are handled, not thrown on", () => {
  const nasty = [
    "",
    " ",
    "\n\n",
    "'",
    '"',
    "|",
    "&&",
    ";;;",
    "$(",
    "${",
    "`",
    "\\",
    "--",
    "-",
    "/",
    "//",
    "sudo",
    "sudo sudo sudo",
    "FOO=bar",
    "FOO=bar BAZ=qux",
    "a".repeat(5000),
    "ls " + "-l ".repeat(500),
    "echo " + "$VAR ".repeat(200),
    "rm -rf " + "../".repeat(50),
    "git status",
    // An ANSI escape, built from a char code so this file stays readable.
    "ls " + String.fromCharCode(27) + "[31m",
    "🔥 emoji only 🥋",
    "cmd with 'unclosed quote",
    "if then else fi",
    "for for for",
    "| | |",
    "npx",
    "env",
    "./relative",
    "../parent",
    "~/home",
  ];
  for (const command of nasty) {
    assert.doesNotThrow(() => {
      const bin = binOf(command);
      assert.equal(typeof bin, "string");
      assert.ok(bin.length > 0, `empty bin for ${JSON.stringify(command)}`);
      screenDanger(command);
      screenCommand(command);
      pitfallsFor(command);
      docsFor(command);
      lensFor(command, "Mid");
      diagramFor(command, true, "topic with 'quotes' and \"more\"");
      sanitizeForSpeech(command);
      teachingBrief({
        command,
        level: "Senior",
        topic: "t",
        track: "r",
        hasContent: false,
        outcome: "dry-run",
        stdoutExcerpt: "",
      });
    }, `threw on ${JSON.stringify(command)}`);
  }
});

test("a quiz block renders correctly for every question in the bank", () => {
  for (const q of QUIZ_BANK) {
    const asked = ask(q, "shell", { salt: "x" });
    const block = quizBlock({ quiz: asked, token: `${q.id}#1` });
    assert.match(block, /verify_quiz_answer/);
    assert.equal(leaksJsValue(block), null, `${q.id} rendered a JS value`);
    const letters = [...block.matchAll(/^([A-Z])\. /gm)].map((m) => m[1]);
    assert.deepEqual(
      letters,
      asked.choices.map((_, i) => String.fromCharCode(65 + i)),
      `${q.id} letters do not match its choices`,
    );
  }
});
