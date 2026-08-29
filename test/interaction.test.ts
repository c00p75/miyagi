/**
 * The parts that involve the client doing something back.
 *
 * `confirm_dangerous` used to be a flag the *model* filled in, which is not
 * confirmation: a prompt-injected assistant sets it as easily as a careful one.
 * And a grade can now be changed by a model. Both need tests that play the
 * client's side, including playing it badly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TestClient, graderReply, generatorReply } from "./harness.js";

async function scratch(name: string): Promise<{ home: string; work: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `miyagi-${name}-`));
  const work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  return { home: path.join(root, "home"), work };
}

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false);

async function ready(client: TestClient): Promise<void> {
  await client.initialize();
  await client.call("quick_config", { mode: "drill", voice_enabled: false });
}

/** Waits for a fire-and-forget write, without pinning a fixed sleep in the test. */
async function eventually(file: string, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      if (Date.now() > deadline) throw new Error(`${file} never appeared`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Human confirmation
 * ------------------------------------------------------------------ */

test("a destructive command asks the human, and runs when they type the word", async () => {
  const { home, work } = await scratch("elicit-accept");
  const target = path.join(work, "doomed");
  await fs.mkdir(target);

  const client = new TestClient({ home, cwd: work, capabilities: { elicitation: true } });
  await client.initialize();
  try {
    const data = await client.data("run_teaching_command", { command: `rm -rf ${target}`, cwd: work });
    assert.equal(client.elicitations.length, 1, "the person was asked");
    assert.match(client.elicitations[0], /destructive/);
    assert.match(client.elicitations[0], /rm -rf/, "and shown the actual command");
    assert.equal(data.executed, true);
    assert.equal(data.confirmed_by, "human");
    assert.equal(await exists(target), false);
  } finally {
    client.close();
  }
});

test("declining the prompt leaves the command unrun", async () => {
  const { home, work } = await scratch("elicit-decline");
  const target = path.join(work, "safe");
  await fs.mkdir(target);

  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { elicitation: true },
    onElicit: () => ({ action: "decline" }),
  });
  await client.initialize();
  try {
    const res = await client.call("run_teaching_command", { command: `rm -rf ${target}`, cwd: work });
    assert.equal(res.result.structuredContent.executed, false);
    assert.equal(res.result.structuredContent.confirmed_by, null);
    assert.match(res.result.content[0].text, /declined/);
    assert.equal(await exists(target), true, "the directory is still there");
  } finally {
    client.close();
  }
});

test("the model cannot talk its way past the prompt with the flag", async () => {
  const { home, work } = await scratch("elicit-flag-ignored");
  const target = path.join(work, "protected");
  await fs.mkdir(target);

  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { elicitation: true },
    // A person who cancels, while the caller insists it is fine.
    onElicit: () => ({ action: "cancel" }),
  });
  await client.initialize();
  try {
    const data = await client.data("run_teaching_command", {
      command: `rm -rf ${target}`,
      confirm_dangerous: true,
      cwd: work,
    });
    assert.equal(data.executed, false, "the human's answer beats the caller's flag");
    assert.equal(await exists(target), true);
  } finally {
    client.close();
  }
});

test("typing the wrong word is not confirmation", async () => {
  const { home, work } = await scratch("elicit-wrong-word");
  const target = path.join(work, "typo");
  await fs.mkdir(target);

  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { elicitation: true },
    onElicit: () => ({ action: "accept", content: { confirm: "yes" } }),
  });
  await client.initialize();
  try {
    const res = await client.call("run_teaching_command", { command: `rm -rf ${target}`, cwd: work });
    assert.equal(res.result.structuredContent.executed, false);
    assert.match(res.result.content[0].text, /did not match/);
    assert.equal(await exists(target), true);
  } finally {
    client.close();
  }
});

test("a catastrophic command is never even offered for confirmation", async () => {
  const { home, work } = await scratch("elicit-blocked");
  const client = new TestClient({ home, cwd: work, capabilities: { elicitation: true } });
  await client.initialize();
  try {
    const data = await client.data("run_teaching_command", {
      command: "rm -rf /",
      confirm_dangerous: true,
      cwd: work,
    });
    assert.equal(data.blocked, true);
    assert.equal(data.executed, false);
    assert.equal(client.elicitations.length, 0, "there is nothing to ask about; the answer is no");
  } finally {
    client.close();
  }
});

test("without elicitation support, the flag is the documented fallback", async () => {
  const { home, work } = await scratch("elicit-absent");
  const target = path.join(work, "fallback");
  await fs.mkdir(target);

  const client = new TestClient({ home, cwd: work }); // no capabilities at all
  await client.initialize();
  try {
    const dry = await client.data("run_teaching_command", { command: `rm -rf ${target}`, cwd: work });
    assert.equal(dry.executed, false, "still not run without confirmation of some kind");
    assert.equal(await exists(target), true);

    const confirmed = await client.data("run_teaching_command", {
      command: `rm -rf ${target}`,
      confirm_dangerous: true,
      cwd: work,
    });
    assert.equal(confirmed.executed, true);
    assert.equal(confirmed.confirmed_by, "caller-flag");
    assert.equal(client.elicitations.length, 0);
  } finally {
    client.close();
  }
});

/* ------------------------------------------------------------------ *
 * Model-assisted grading
 * ------------------------------------------------------------------ */

test("a prose answer that means the right thing is upgraded to correct", async () => {
  const { home, work } = await scratch("grade-upgrade");
  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { sampling: true },
    onSample: (prompt) => (prompt.includes("GRADING") || prompt.includes("grading") ? graderReply(true) : null),
  });
  await ready(client);
  try {
    const run = await client.data("run_teaching_command", { command: "printf 'x\\n'", cwd: work });
    const graded = await client.data("verify_quiz_answer", {
      quiz_id: run.quiz_id,
      answer: "honestly I would say it is whichever one keeps the remote from being clobbered",
    });
    assert.equal(client.samplings.length >= 1, true, "the model was asked");
    assert.equal(graded.correct, true, "meaning beat string comparison");
    assert.ok(graded.xp_awarded >= 25);
  } finally {
    client.close();
  }
});

test("a model saying no cannot take away an answer that already matched", async () => {
  const { home, work } = await scratch("grade-no-downgrade");
  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { sampling: true },
    // A hostile or broken grader that fails everything.
    onSample: () => graderReply(false, "no"),
  });
  await ready(client);
  try {
    const run = await client.call("run_teaching_command", { command: "printf 'x\\n'", cwd: work });
    const card = run.result.content[0].text as string;
    const quizId = run.result.structuredContent.quiz_id as string;
    const block = card.slice(card.indexOf("Active Recall Quiz"));
    const choices = [...block.matchAll(/^([A-D])\. (.+)$/gm)].map((m) => ({ letter: m[1], text: m[2] }));
    assert.ok(choices.length >= 3, "the card lists choices");

    // The letter that already string-matches must stay correct. Sampling is
    // configured to fail everything, so a pass here is the deterministic path
    // winning, not the model.
    const { questionById } = await import("../src/quiz.js");
    const authored = questionById(quizId.split("#")[0]);
    assert.ok(authored, "the card's quiz is in the bank");
    const correctLetter = choices.find((c) => c.text === authored.answer)?.letter;
    assert.ok(correctLetter, "the card still lists the authored answer");

    const graded = await client.data("verify_quiz_answer", { quiz_id: quizId, answer: correctLetter });
    assert.equal(graded.correct, true, "a matched letter is not taken away by a model saying no");
  } finally {
    client.close();
  }
});

test("a broken sampling client does not break grading", async () => {
  const { home, work } = await scratch("grade-broken-sampling");
  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { sampling: true },
    onSample: () => "this is not JSON at all, sorry",
  });
  await ready(client);
  try {
    const run = await client.data("run_teaching_command", { command: "printf 'x\\n'", cwd: work });
    const graded = await client.data("verify_quiz_answer", {
      quiz_id: run.quiz_id,
      answer: "some long prose answer that will be sent to the grader and come back as junk",
    });
    assert.equal(graded.correct, false, "the deterministic verdict stands");
    assert.equal(graded.xp_awarded, 5, "and the consolation XP is still paid");
  } finally {
    client.close();
  }
});

test("a command the bank does not cover gets a generated, validated question", async () => {
  const { home, work } = await scratch("generate");
  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { sampling: true },
    onSample: (prompt) => (prompt.includes("multiple-choice") ? generatorReply() : graderReply(false)),
  });
  await ready(client);
  try {
    const run = await client.data("run_teaching_command", { command: "jq --version", cwd: work });
    assert.match(run.quiz_id, /^gen:jq:/, "the question came from the model");

    const cache = JSON.parse(await eventually(path.join(home, "generated-quizzes.json")));
    assert.equal(cache.length, 1, "and was cached so it is not asked for twice");
    assert.match(cache[0].id, /^gen:jq:/);

    const graded = await client.data("verify_quiz_answer", {
      quiz_id: run.quiz_id,
      answer: "It exits non-zero when the last output was null or false",
    });
    assert.equal(graded.correct, true, "a generated question grades like any other");
  } finally {
    client.close();
  }
});

test("a generated question that fails validation is discarded, not shown", async () => {
  const { home, work } = await scratch("generate-invalid");
  const client = new TestClient({
    home,
    cwd: work,
    capabilities: { sampling: true },
    // Answer not among the choices: the classic generated-question defect.
    onSample: (prompt) =>
      prompt.includes("multiple-choice") ? generatorReply({ answer: "something else" }) : null,
  });
  await ready(client);
  try {
    const run = await client.data("run_teaching_command", { command: "jq --version", cwd: work });
    assert.ok(!run.quiz_id.startsWith("gen:"), "the invalid question was not used");
    assert.equal(await exists(path.join(home, "generated-quizzes.json")), false, "and not cached");
  } finally {
    client.close();
  }
});

/* ------------------------------------------------------------------ *
 * Notifications and the new resources
 * ------------------------------------------------------------------ */

test("saved state changing tells the client to re-read the profile", async () => {
  const { home, work } = await scratch("notify");
  const client = new TestClient({ home, cwd: work });
  await client.initialize();
  try {
    await client.call("run_teaching_command", { command: "printf 'x\\n'", cwd: work });
    // The write is debounced, so give it a beat.
    await new Promise((r) => setTimeout(r, 900));
    const updates = client.notifications.filter(
      (n) => n.method === "notifications/resources/updated",
    );
    assert.ok(updates.length > 0, "a sidebar reading the profile must not show a stale level");
    assert.ok(updates.some((u) => u.params.uri === "miyagi://profile"));
  } finally {
    client.close();
  }
});

test("insights read back as a report that refuses to overclaim", async () => {
  const { home, work } = await scratch("insights");
  const client = new TestClient({ home, cwd: work });
  await client.initialize();
  try {
    await client.call("run_teaching_command", { command: "printf 'x\\n'", cwd: work });
    const res = await client.send("resources/read", { uri: "miyagi://insights" });
    const report = JSON.parse(res.result.contents[0].text);
    assert.equal(report.totalDays, 1);
    assert.match(report.verdict, /Too early/, "one day of practice proves nothing");
    assert.ok(Array.isArray(report.weeks));
  } finally {
    client.close();
  }
});

test("getting-started is readable without spending a turn asking for it", async () => {
  const { home, work } = await scratch("getting-started");
  const client = new TestClient({ home, cwd: work });
  await client.initialize();
  try {
    const res = await client.send("resources/read", { uri: "miyagi://getting-started" });
    const text = res.result.contents[0].text as string;
    assert.match(text, /You run the commands/);
    assert.match(text, /verify_step/);
    assert.match(text, /--doctor/);
  } finally {
    client.close();
  }
});

test("the default mode is ride-along: no inline quiz, little attempt XP", async () => {
  const { home, work } = await scratch("ride-along-default");
  const client = new TestClient({ home, cwd: work });
  await client.initialize();
  try {
    const res = await client.call("run_teaching_command", { command: "printf 'hello\\n'", cwd: work });
    const data = res.result.structuredContent;
    const text = res.result.content[0].text as string;
    assert.equal(data.quiz_id, "", "recall is deferred, not asked inline");
    assert.equal(data.xp_awarded, 3);
    assert.ok(!/Active Recall Quiz/.test(text));
    assert.match(text, /What:/);
  } finally {
    client.close();
  }
});

test("nothing but MCP frames ever reaches stdout", async () => {
  const { home, work } = await scratch("stdout-clean");
  const client = new TestClient({ home, cwd: work, capabilities: { sampling: true } });
  await client.initialize();
  try {
    // The client throws on any non-JSON stdout line, so exercising the noisy
    // paths — diagnostics, warnings, speech — is the assertion.
    await client.call("run_teaching_command", { command: "ls /definitely/not/here", cwd: work });
    await client.call("quick_config", { roadmap_name: "Nonexistent Track" });
    await client.call("verify_step", { cwd: work });
    await client.call("get_user_stats", { speak: true });
    assert.ok(client.stderr.join("").length > 0, "diagnostics went to stderr, where they belong");
  } finally {
    client.close();
  }
});
