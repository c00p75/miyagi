import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONCEPTS, detectConcepts } from "../../src/concepts.js";
import { TOPICS, hasTopic, parseTopic, topicOf } from "../src/topics.js";
import * as engine from "../src/engine.js";

before(async () => {
  process.env.MIYAGI_HOME = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-topics-")), "home");
  engine.forgetSession();
});

test("every concept in the pack has been given a topic", () => {
  const missing = CONCEPTS.filter((c) => !hasTopic(c.id)).map((c) => c.id);
  assert.deepEqual(missing, [], "add these to vscode/src/topics.ts");
  for (const topic of TOPICS) {
    assert.ok(CONCEPTS.some((c) => topicOf(c.id) === topic), `${topic} has no ideas`);
  }
});

test("a topic is parsed from saved state, and anything else means all topics", () => {
  assert.equal(parseTopic("Security"), "Security");
  assert.equal(parseTopic(""), null);
  assert.equal(parseTopic("Cooking"), null);
  assert.equal(parseTopic(undefined), null);
});

test("an idea can be opened from the dojo without being discovered by looking", async () => {
  const locked = await engine.ideaCard("password-hashing");
  assert.ok(locked);
  assert.equal(locked.status, "locked");
  assert.equal(locked.topic, "Security");
  assert.equal(locked.hasQuiz, false, "no question until it is met in real code");
  assert.equal(locked.file, "");
  const status = await engine.status();
  assert.equal(status.discovered, 0, "reading a lesson is not discovering it");
  assert.equal(status.xp, 0);
  assert.equal(await engine.ideaCard("not-a-concept"), null);
});

test("once met in code, the dojo lesson has a question and points at the file", async () => {
  const source = "const hash = await bcrypt.hash(password, 12);\nconst [open, setOpen] = useState(false);";
  await engine.teach({
    changes: [{ file: "app.tsx", concepts: detectConcepts("app.tsx", source) }],
    root: "/repo",
    source: "app.tsx",
    limit: 5,
  });
  const where = { root: "/repo", file: "app.tsx", otherFiles: 0, evidence: "bcrypt.hash" };
  const card = await engine.ideaCard("password-hashing", where);
  assert.ok(card);
  assert.equal(card.status, "learning");
  assert.equal(card.hasQuiz, true);
  assert.equal(card.file, "app.tsx");
  assert.equal(card.key, "dojo:password-hashing");

  const rows = await engine.dojo();
  assert.equal(rows.find((r) => r.id === "react-state")?.topic, "Frontend");
});

test("a review can be narrowed to one topic", async () => {
  // Make both questions due now by answering nothing and rewinding their dates.
  const file = path.join(process.env.MIYAGI_HOME!, "profile.json");
  const profile = JSON.parse(await fs.readFile(file, "utf8"));
  for (const item of profile.review) item.dueAt = new Date(Date.now() - 60_000).toISOString();
  await fs.writeFile(file, JSON.stringify(profile));

  const status = await engine.status();
  assert.equal(status.dueByTopic.Security, 1);
  assert.equal(status.dueByTopic.Frontend, 1);
  assert.equal(status.dueByTopic.Data, 0);

  const security = await engine.nextReview([], "Security");
  assert.equal(security?.about, "Storing passwords as hashes");
  const frontend = await engine.nextReview([], "Frontend");
  assert.equal(frontend?.about, "React state");
  assert.equal(await engine.nextReview([], "Data"), null);
  assert.ok(await engine.nextReview([]), "no topic means everything due");
});
