/**
 * Teaching content.
 *
 * The defect this suite guards is the original card's: the same three
 * sentences printed for `pwd`, `kubectl get pods` and `terraform apply`. A
 * lesson has to differ per command, and where there is no authored lesson the
 * card has to say so rather than print filler.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  CONTENT,
  binOf,
  conceptFor,
  contentFor,
  diagramFor,
  docsFor,
  lensFor,
  pitfallsFor,
  teachingBrief,
} = await import("../src/content.js");

test("the binary is extracted from realistic command lines", () => {
  assert.equal(binOf("ls -lah"), "ls");
  assert.equal(binOf("  git   status  "), "git");
  assert.equal(binOf("/usr/local/bin/node --version"), "node");
  assert.equal(binOf("FOO=bar docker ps"), "docker");
  assert.equal(binOf("sudo rm -rf build"), "rm", "the lesson is about rm, not sudo");
  assert.equal(binOf("sudo"), "shell", "a wrapper with nothing after it is about the shell");
  assert.equal(binOf(""), "shell");
  assert.equal(binOf("npx tsc --noEmit"), "tsc", "npx is a runner, not the lesson");
  assert.equal(binOf('f=my\\ file.txt; touch "$f"'), "touch", "a leading assignment is not the command");
  assert.equal(binOf("cat a | grep b"), "cat", "the first real command in a pipeline");
  assert.equal(binOf("for i in 1 2 3; do printf x; done"), "for", "a keyword is its own lesson");
});

test("aliases resolve to the pack entry", () => {
  assert.equal(contentFor("docker-compose up").content, CONTENT.docker);
  assert.equal(contentFor("pnpm install").content, CONTENT.npm);
  assert.equal(contentFor("npx tsc --noEmit").content, CONTENT.tsc, "npx defers to what it runs");
  assert.equal(contentFor("echo hi").content, CONTENT.printf, "echo's lesson is printf's");
  assert.equal(contentFor("for i in 1 2; do :; done").content, CONTENT.set, "control flow shares one lesson");
});

test("different commands get genuinely different lessons", () => {
  const whats = new Set(
    ["pwd", "git status", "docker ps", "npm ci", "rm -rf build", "curl https://x", "chmod 755 f"].map(
      (c) => lensFor(c, "Mid").what,
    ),
  );
  assert.equal(whats.size, 7, "each authored command has its own What");
});

test("depth changes the lesson, not just the label", () => {
  const j = lensFor("git status", "Junior");
  const s = lensFor("git status", "Senior");
  assert.notEqual(j.what, s.what);
  assert.notEqual(j.how, s.how);
  assert.notEqual(j.tradeoffs, s.tradeoffs);
});

test("an unauthored command falls back to the shell model, and the brief admits it", () => {
  const { content } = contentFor("jq '.items[]' data.json");
  assert.equal(content, null);
  const brief = teachingBrief({
    command: "jq '.items[]' data.json",
    level: "Mid",
    topic: "Parsing JSON",
    track: "Backend Developer",
    hasContent: false,
    outcome: "success",
    stdoutExcerpt: "{}",
  });
  assert.match(brief, /no authored lesson/i, "the model is told to teach it rather than repeat filler");
  assert.match(brief, /jq/, "and told which command");
  assert.match(brief, /Mid/);
});

test("the brief for an authored command asks for the invocation, not the concept again", () => {
  const brief = teachingBrief({
    command: "git push --force-with-lease",
    level: "Senior",
    topic: "Rewriting history",
    track: "Git and GitHub",
    hasContent: true,
    outcome: "failure",
    stdoutExcerpt: "",
  });
  assert.match(brief, /authored and correct/);
  assert.match(brief, /rather than repeating it/);
});

test("the brief never tells the model to do the work for the learner", () => {
  const brief = teachingBrief({
    command: "ls",
    level: "Junior",
    topic: "t",
    track: "r",
    hasContent: true,
    outcome: "dry-run",
    stdoutExcerpt: "",
  });
  assert.match(brief, /Do not answer the quiz for them/);
});

test("diagrams are command-specific where a specific one exists", () => {
  const git = diagramFor("git commit -m x", true, "Committing");
  const docker = diagramFor("docker compose up -d", true, "Containers");
  const generic = diagramFor("jq . data.json", true, "Parsing");
  assert.match(git, /git add/);
  assert.match(docker, /Volume/);
  assert.match(generic, /execve/, "the fallback is the process lifecycle");
  assert.notEqual(git, docker);
});

test("every diagram is syntactically plausible mermaid", () => {
  for (const cmd of ["git status", "docker ps", "curl https://x", "pwd", "jq ."]) {
    const d = diagramFor(cmd, true, "topic");
    assert.match(d, /^flowchart (TD|LR)/, cmd);
    // Unbalanced quotes inside node labels are the usual way a diagram fails to render.
    assert.equal((d.match(/"/g) ?? []).length % 2, 0, `unbalanced quotes in ${cmd}`);
  }
});

test("a topic containing a quote cannot break the generic diagram", () => {
  const d = diagramFor("jq .", true, 'the "hard" bits');
  assert.equal((d.match(/"/g) ?? []).length % 2, 0);
});

test("pitfalls are drawn from the command line as well as the binary", () => {
  assert.ok(pitfallsFor("cat a | grep b").some((p) => /pipeline/i.test(p)));
  assert.ok(pitfallsFor("echo hi > file").some((p) => /truncates/i.test(p)));
  assert.ok(pitfallsFor("rm -rf $DIR").some((p) => /unquoted variable/i.test(p)));
  assert.ok(pitfallsFor("sudo apt install x").some((p) => /root/i.test(p)));
});

test("pitfalls and docs are always present and bounded", () => {
  for (const cmd of ["pwd", "git rebase -i", "jq .", "terraform apply"]) {
    const p = pitfallsFor(cmd);
    assert.ok(p.length > 0 && p.length <= 5, cmd);
    const d = docsFor(cmd);
    assert.ok(d.length > 0 && d.length <= 4, cmd);
    for (const link of d) assert.match(link.url, /^https:\/\//, `${cmd} → ${link.url}`);
  }
});

test("the concept label names the command when nothing is authored", () => {
  assert.match(conceptFor("jq ."), /jq/);
  assert.equal(conceptFor("git status"), CONTENT.git.concept);
});

test("every pack entry is complete", () => {
  for (const [bin, c] of Object.entries(CONTENT)) {
    assert.ok(c.concept && c.summary, bin);
    assert.ok(c.pitfalls.length >= 2, `${bin} needs pitfalls worth reading`);
    assert.ok(c.docs.length >= 1, bin);
    for (const level of ["Junior", "Mid", "Senior"] as const) {
      const l = c.lens[level];
      assert.ok(l.what.length > 60, `${bin} ${level} What is too thin to be a lesson`);
      assert.ok(l.how.length > 40, `${bin} ${level} How is too thin`);
      assert.ok(l.tradeoffs.length > 40, `${bin} ${level} Trade-offs are too thin`);
    }
  }
});
