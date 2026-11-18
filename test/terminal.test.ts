/**
 * The terminal tutor, driven the way a person drives it: text out, typed
 * answers in. Scratch MIYAGI_HOME and a scratch repository, removed after.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { questionById } from "../src/quiz.js";
import {
  parseTerminalCommand,
  plain,
  renderCard,
  runDojo,
  runReview,
  runWatch,
  teachChanges,
  wrap,
  type TerminalIo,
} from "../src/terminal.js";

let root = "";
let work = "";
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-terminal-"));
  work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  process.env.MIYAGI_HOME = path.join(root, "home");
});
after(async () => {
  delete process.env.MIYAGI_HOME;
  await fs.rm(root, { recursive: true, force: true });
});

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", ...args], { cwd: work, stdio: "pipe" });

/** An io that records output and answers prompts from a script, or from a function of what was printed. */
function scripted(answers: Array<string | null | ((sofar: string) => string)>): TerminalIo & { out: string } {
  const io = {
    out: "",
    width: 80,
    colour: false,
    write(text: string) {
      io.out += text;
    },
    async ask(prompt: string) {
      io.out += prompt;
      const next = answers.length ? answers.shift()! : null;
      const value = typeof next === "function" ? next(io.out) : next;
      io.out += `${value ?? ""}\n`;
      return value;
    },
  };
  return io;
}

test("arguments choose a terminal command, or none", () => {
  assert.deepEqual(parseTerminalCommand(["watch"], "/repo"), { name: "watch", dir: "/repo" });
  assert.deepEqual(parseTerminalCommand(["watch", "app"], "/repo"), { name: "watch", dir: "/repo/app" });
  assert.deepEqual(parseTerminalCommand(["--watch", "--verbose"], "/repo"), { name: "watch", dir: "/repo" });
  assert.deepEqual(parseTerminalCommand(["review"], "/repo"), { name: "review" });
  assert.deepEqual(parseTerminalCommand(["dojo"], "/repo"), { name: "dojo" });
  assert.equal(parseTerminalCommand([], "/repo"), null, "no arguments is the MCP server");
  assert.equal(parseTerminalCommand(["--doctor"], "/repo"), null);
});

test("text is wrapped on words and stripped of markdown", () => {
  assert.equal(plain("Use `$1` and **never** _escape_ by hand."), "Use $1 and never escape by hand.");
  const wrapped = wrap("one two three four five six seven eight nine ten eleven twelve", 24, "  ");
  for (const line of wrapped.split("\n")) {
    assert.ok(line.length <= 24, `"${line}" is too long`);
    assert.ok(line.startsWith("  "));
  }
  assert.equal(wrapped.replace(/\s+/g, " ").trim(), "one two three four five six seven eight nine ten eleven twelve");
});

test("a card fits the terminal and says where the idea was seen", () => {
  const text = renderCard(
    { id: "password-hashing", file: "src/auth.ts", files: 2, count: 1, evidence: "bcrypt.hash(password, 12)" },
    "Junior",
    { seen: false, box: 0, lapses: 0 },
    { width: 60, colour: false },
  );
  assert.match(text, /Storing passwords as hashes {2}\[new\]/);
  assert.match(text, /src\/auth\.ts and 1 more/);
  assert.match(text, /What it is\n {2}\S/);
  assert.doesNotMatch(text, /\u001b\[/, "no colour codes when colour is off");
  for (const line of text.split("\n")) assert.ok(line.length <= 62 || /https?:/.test(line), `"${line}" overflows`);
  const coloured = renderCard({ id: "password-hashing", file: "a.ts", files: 1, count: 1, evidence: "" }, "Mid", { seen: true, box: 2, lapses: 0 }, { width: 80, colour: true });
  assert.match(coloured, /\u001b\[1m/);
  assert.match(coloured, /Orange belt/);
});

test("a change is taught once, and its questions are queued", async () => {
  const io = scripted([]);
  const shown = new Set<string>();
  const change = { file: "src/auth.ts", added: "const hash = await bcrypt.hash(password, 12);", addedLines: 1 };
  const first = await teachChanges([change], shown, io);
  assert.ok(first.cards >= 1);
  assert.equal(first.discovered, first.cards);
  assert.match(io.out, /Storing passwords as hashes/);
  const again = await teachChanges([change], shown, io);
  assert.equal(again.cards, 0, "the same idea is not carded twice in one sitting");
  const profile = JSON.parse(await fs.readFile(path.join(process.env.MIYAGI_HOME!, "profile.json"), "utf8"));
  assert.ok(profile.review.some((r: { ref: string }) => /^c-password-hashing/.test(r.ref)));
  assert.equal(profile.player.xp, 0, "seeing an idea pays nothing");
});

test("review shows the question alone first, grades a typed letter, and saves", async () => {
  // Make what was queued due now.
  const file = path.join(process.env.MIYAGI_HOME!, "profile.json");
  const profile = JSON.parse(await fs.readFile(file, "utf8"));
  for (const item of profile.review) item.dueAt = new Date(Date.now() - 60_000).toISOString();
  profile.review = profile.review.filter((r: { ref: string }) => /^c-password-hashing/.test(r.ref)).slice(0, 1);
  await fs.writeFile(file, JSON.stringify(profile));
  const question = questionById(profile.review[0].ref)!;

  // The right letter is read off the choices as printed, the way a person would.
  const letterOf = (sofar: string) => {
    const lines = sofar.split("\n").map((l) => l.trim());
    const hit = lines.find((l) => /^[A-H]\. /.test(l) && question.answer.startsWith(l.slice(3).slice(0, 20)));
    return hit ? hit[0] : "A";
  };
  const io = scripted(["", "Z", letterOf]);
  const result = await runReview(io);
  assert.deepEqual({ asked: result.asked, correct: result.correct }, { asked: 1, correct: 1 });
  assert.equal(result.xp, 30, "a review answer pays 30");
  const before = io.out.indexOf("press Enter");
  assert.ok(io.out.indexOf("A. ") > before, "the choices come after the pause for recall");
  assert.match(io.out, /Type one of A, B, C, D\./, "a letter that is not a choice is asked again, not graded");
  assert.match(io.out, /Correct/);
  assert.match(io.out, /1 of 1 from memory, \+30 XP/);

  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.review[0].box, 1);
  assert.equal(saved.player.xp, 30);

  const empty = scripted([]);
  assert.equal((await runReview(empty)).asked, 0);
  assert.match(empty.out, /Nothing is due/);
});

test("ending the input in the middle of a review stops it cleanly", async () => {
  const file = path.join(process.env.MIYAGI_HOME!, "profile.json");
  const profile = JSON.parse(await fs.readFile(file, "utf8"));
  for (const item of profile.review) item.dueAt = new Date(Date.now() - 60_000).toISOString();
  await fs.writeFile(file, JSON.stringify(profile));
  const io = scripted(["", "q"]);
  const result = await runReview(io);
  assert.equal(result.asked, 0, "a question that was quit is not counted or graded");
  assert.match(io.out, /Stopped\. \d+ questions? (is|are) still due\./, "stopping early is not reported as nothing being due");
  const closed = await runReview(scripted([null]));
  assert.equal(closed.asked, 0);
});

test("the dojo lists what has been found with its belt", async () => {
  const io = scripted([]);
  assert.equal(await runDojo(io), 0);
  assert.match(io.out, /The Dojo/);
  assert.match(io.out, /Storing passwords as hashes/);
  assert.match(io.out, /still locked/);
  assert.match(io.out, /Level 1, 30 XP/);
});

test("watch refuses a folder that is not a repository", async () => {
  const io = scripted([]);
  assert.equal(await runWatch(io, { cwd: root, pollMs: 10, quietMs: 10 }), 1);
  assert.match(io.out, /is not a git repository/);
});

test("watch treats what was already there as old, and teaches a change once the work pauses", async () => {
  git("init", "-q");
  await fs.writeFile(path.join(work, "old.ts"), "useEffect(() => { load(); }, []);\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  // Uncommitted before the watcher starts: this is the baseline.
  await fs.writeFile(path.join(work, "pending.tsx"), "const [n, setN] = useState(0);\n");

  const io = scripted([]);
  const abort = new AbortController();
  const running = runWatch(io, { cwd: work, pollMs: 60, quietMs: 150, signal: abort.signal });
  await new Promise((r) => setTimeout(r, 400));
  assert.doesNotMatch(io.out, /React state/, "the baseline is not taught");

  await fs.writeFile(path.join(work, "api.ts"), "app.get('/users', async (req, res) => { res.json(await db.users.findMany()); });\n");
  const deadline = Date.now() + 8_000;
  while (!/An API endpoint/.test(io.out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 60));
  abort.abort();
  assert.equal(await running, 0);
  assert.match(io.out, /An API endpoint/);
  assert.match(io.out, /1 file changed \(api\.ts\)/);
  assert.match(io.out, /miyagi review/);
});
