/**
 * The end-to-end eval: one learner walking a track.
 *
 * Every other suite tests a part. This one asserts the thing the product
 * claims: that a learner who does the work is credited for outcomes that exist
 * on their machine, that a learner who does not do the work is *not*, and that
 * the whole run survives a restart. If this suite passes, miyagi works.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TestClient } from "./harness.js";

let home: string;
let work: string;
let client: TestClient;

before(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-journey-"));
  home = path.join(root, "home");
  work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  client = new TestClient({ home, cwd: work, capabilities: { elicitation: true } });
  await client.initialize();
  await client.call("quick_config", {
    roadmap_name: "Command Line Basics",
    category: "Absolute Beginners",
    voice_enabled: false,
    mode: "drill",
  });
});

after(() => client?.close());

test("the first response orients a new user, and only the first", async () => {
  const first = await client.text("get_user_stats");
  assert.match(first, /First run/, "a new install explains itself once");
  assert.match(first, /verify_step/);
  const second = await client.text("get_user_stats");
  assert.ok(!/First run/.test(second), "and never again, or it is noise by the third card");
});

test("a step announces its checkpoint before the learner starts", async () => {
  // Walk to the first checkpointed step: mkdir -p practice/day1.
  let next = await client.data("get_next_roadmap_command");
  let guard = 0;
  while (!next.criterion && guard++ < 12) {
    next = await client.data("get_next_roadmap_command", { advance: true });
  }
  assert.ok(next.criterion, "the beginner track reaches a checkpoint");
  assert.match(next.command, /mkdir/);
  assert.match(next.criterion, /practice\/day1/);
  assert.equal(next.already_verified, false);
});

test("claiming a step without doing it earns nothing", async () => {
  const before = await client.data("get_user_stats");
  const result = await client.data("verify_step");
  assert.equal(result.has_checkpoint, true);
  assert.equal(result.passed, false, "the directory does not exist, so nothing passed");
  assert.equal(result.xp_awarded, 0);
  assert.equal(result.advanced, false);
  const after = await client.data("get_user_stats");
  assert.equal(after.player.xp, before.player.xp, "no XP for asserting you did the work");
});

test("running the step's own command verifies the outcome and pays for it", async () => {
  const before = await client.data("get_user_stats");
  const next = await client.data("get_next_roadmap_command");

  const run = await client.data("run_teaching_command", { command: next.command, cwd: work });
  assert.equal(run.executed, true);
  assert.ok(run.checkpoint, "the step's command triggers its checkpoint automatically");
  assert.equal(run.checkpoint.passed, true);
  assert.equal(run.checkpoint.first_pass, true);
  assert.equal(run.checkpoint.advanced, true);
  // 10 for the attempt, 30 for the verified outcome.
  assert.equal(run.xp_awarded, 40);

  const after = await client.data("get_user_stats");
  assert.equal(after.player.xp, before.player.xp + 40);
  assert.ok(
    await fs.stat(path.join(work, "practice", "day1")).then(() => true).catch(() => false),
    "and the directory really is there",
  );
});

test("re-verifying a passed step confirms it and pays nothing", async () => {
  // Step back to the one just completed and check it again.
  const stats = await client.data("get_user_stats");
  await client.call("set_active_roadmap", {
    category: "Absolute Beginners",
    roadmap_name: "Command Line Basics",
    step_index: stats.roadmap.step_index - 1,
  });
  const again = await client.data("verify_step", { cwd: work });
  assert.equal(again.passed, true);
  assert.equal(again.first_pass, false, "already credited");
  assert.equal(again.xp_awarded, 0, "the ledger pays for outcomes, not repeats");
  assert.equal((await client.data("get_user_stats")).player.xp, stats.player.xp);
});

test("a checkpoint that needs file contents is not satisfied by an empty file", async () => {
  await client.call("set_active_roadmap", {
    category: "Absolute Beginners",
    roadmap_name: "Command Line Basics",
    step_index: 5, // touch notes.txt && echo 'hello shell' > notes.txt
  });
  const step = await client.data("get_next_roadmap_command");
  assert.match(step.criterion, /hello shell/);

  await fs.writeFile(path.join(work, "notes.txt"), "", "utf8");
  const empty = await client.data("verify_step", { cwd: work });
  assert.equal(empty.passed, false, "the file exists but says nothing");

  await fs.writeFile(path.join(work, "notes.txt"), "hello shell\n", "utf8");
  const filled = await client.data("verify_step", { cwd: work });
  assert.equal(filled.passed, true);
  assert.equal(filled.xp_awarded, 30);
});

test("a near-miss command does not claim the checkpoint's XP", async () => {
  await client.call("set_active_roadmap", {
    category: "Absolute Beginners",
    roadmap_name: "Command Line Basics",
    step_index: 8, // cp notes.txt notes.bak && ls -l
  });
  const run = await client.data("run_teaching_command", {
    command: "cp notes.txt something-else.bak",
    cwd: work,
  });
  assert.equal(run.executed, true);
  assert.equal(run.checkpoint, null, "a different command is not this step's command");
  assert.equal(run.xp_awarded, 10, "attempt XP only");
});

test("progress and verified checkpoints survive a restart", async () => {
  const before = await client.data("get_user_stats");
  client.close();
  await new Promise((r) => setTimeout(r, 500));

  const revived = new TestClient({ home, cwd: work, capabilities: { elicitation: true } });
  await revived.initialize();
  try {
    const after = await revived.data("get_user_stats");
    assert.equal(after.player.xp, before.player.xp, "XP came back");
    assert.equal(after.lifetime.commands >= 2, true, "so did the practice log");

    const profile = JSON.parse(await fs.readFile(path.join(home, "profile.json"), "utf8"));
    assert.ok(
      Object.keys(profile.verified).length >= 2,
      "and the verified checkpoints, which are the record that matters",
    );

    const stats = await revived.text("get_user_stats");
    assert.ok(!/First run/.test(stats), "a returning learner is not onboarded again");
  } finally {
    revived.close();
    client = revived;
  }
});
