/** Team summaries, the team report, the codebase tour, and the Ollama wire format. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { buildSummary, fileNameFor, parseSummary, readSummaries, renderTour, teamReport, tourStops, type TeamSummary } from "../src/team.js";
import { ollamaModels, ollamaProvider, resolveProvider } from "../src/ai.js";
import type { DojoRowView, StatusView } from "../src/engine.js";

let root = "";
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-team-"));
});
after(() => fs.rm(root, { recursive: true, force: true }));

const row = (id: string, title: string, box: number, lapses = 0, seen = true): DojoRowView => ({
  id, title, emoji: "x", topic: "Security", seen, box, belt: "", lapses,
});
const status = { level: 3, independence: { at: "2026-11-10T00:00:00Z", asked: 10, correct: 7 } } as unknown as StatusView;
const now = new Date("2026-11-18T12:00:00Z");

const person = (name: string, ideas: Array<[string, string, number, number?]>, at = "2026-11-18T09:00:00Z"): TeamSummary =>
  buildSummary({
    name,
    status,
    dojo: ideas.map(([id, title, box, lapses]) => row(id, title, box, lapses)),
    week: { days: 3, goal: 4 },
    now: new Date(at),
  });

test("a summary holds ideas and belts and nothing else", () => {
  const s = buildSummary({
    name: "  Amara Okafor  ",
    status,
    dojo: [row("sql-interpolation", "SQL", 4, 1), row("cors", "CORS", 0, 0, false)],
    week: { days: 3, goal: 4 },
    now,
  });
  assert.equal(s.name, "Amara Okafor");
  assert.deepEqual(s.ideas, [{ id: "sql-interpolation", title: "SQL", box: 4, lapses: 1 }], "an idea never met is not shared");
  assert.deepEqual(Object.keys(s).sort(), ["at", "ideas", "level", "name", "unaided", "version", "week"]);
  assert.equal(fileNameFor("Amara Okafor"), "amara-okafor.json");
  assert.equal(fileNameFor("李雷"), "member.json", "a name with no ASCII letters still gets a file");
  assert.deepEqual(parseSummary(JSON.parse(JSON.stringify(s))), s, "what is written can be read back");
});

test("a teammate's file is validated like any other input", () => {
  assert.equal(parseSummary({ name: "", at: "2026-01-01", ideas: [] }), null);
  assert.equal(parseSummary({ name: "A", at: "not a date", ideas: [] }), null);
  assert.equal(parseSummary("x"), null);
  const odd = parseSummary({
    name: "A",
    at: "2026-01-01T00:00:00Z",
    level: -4,
    unaided: { asked: 5, correct: 9, at: "x" },
    ideas: [{ id: "a", title: "A", box: 9 }, { id: "b", title: "B", box: 2, lapses: "many" }, "junk"],
  });
  assert.deepEqual(odd?.ideas, [{ id: "b", title: "B", box: 2, lapses: 0 }]);
  assert.equal(odd?.level, 1);
  assert.equal(odd?.unaided, null, "more correct than asked is not a result");
});

test("the report says where the team is thin and who to ask, without ranking anyone", () => {
  const report = teamReport(
    [
      person("Bola", [["sql-interpolation", "SQL built by gluing strings together", 4], ["react-effect", "React effects", 1, 3]]),
      person("Amara", [["sql-interpolation", "SQL built by gluing strings together", 2], ["react-effect", "React effects", 0, 2]], "2026-10-01T00:00:00Z"),
    ],
    ["broken.json"],
    now,
  );
  assert.match(report, /\| Amara \| 48 days ago \(stale\) \| 2 \| 0 \| 3 of 4 days \| 7 of 10 \|/);
  assert.match(report, /\| Bola \| today \|/);
  assert.ok(report.indexOf("| Amara") < report.indexOf("| Bola"), "people are listed by name, not by score");
  assert.match(report, /## Where the team is thin[\s\S]*React effects\*\*: met by 2, held firmly by 0, missed 5 times/);
  assert.match(report, /## Who to ask[\s\S]*SQL built by gluing strings together\*\*: Bola \(Brown\)/);
  assert.doesNotMatch(report.split("## Who to ask")[1].split("##")[0], /React effects/, "nobody to ask about what nobody holds");
  assert.match(report, /## Not met by anyone[\s\S]*A secret written into the code/);
  assert.match(report, /not to rank anyone/);
  assert.match(report, /Could not read: broken\.json/);
  assert.match(teamReport([], [], now), /No summaries were found/);
});

test("summaries are read from the shared folder, and a bad file is named rather than fatal", async () => {
  const folder = path.join(root, "team");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "bola.json"), JSON.stringify(person("Bola", [["cors", "CORS", 3]])));
  await fs.writeFile(path.join(folder, "broken.json"), "{ not json");
  await fs.writeFile(path.join(folder, "empty.json"), "{}");
  await fs.writeFile(path.join(folder, "notes.txt"), "ignored");
  const { summaries, skipped } = await readSummaries(folder);
  assert.deepEqual(summaries.map((s) => s.name), ["Bola"]);
  assert.deepEqual(skipped, ["broken.json", "empty.json"]);
  assert.deepEqual(await readSummaries(path.join(root, "nowhere")), { summaries: [], skipped: [] });
});

test("the tour lists the ideas a codebase relies on, dangerous first and prerequisites before dependents", async () => {
  const repo = path.join(root, "repo");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.writeFile(path.join(repo, "src/Menu.tsx"), "const [open, setOpen] = useState(false);\nuseEffect(() => { load(); }, []);\nuseEffect(() => {}, [open]);\n");
  await fs.writeFile(path.join(repo, "src/auth.ts"), "const hash = await bcrypt.hash(password, 12);\n");
  await fs.writeFile(path.join(repo, "src/db.ts"), "db.query(`SELECT * FROM users WHERE id = ${id}`);\n");
  await fs.writeFile(path.join(repo, "logo.bin"), Buffer.from([0, 1, 2, 0]));
  const files = ["src/Menu.tsx", "src/auth.ts", "src/db.ts", "logo.bin", "gone.ts"];
  const tour = await tourStops(repo, files);
  const ids = tour.stops.map((s) => s.id);
  assert.equal(tour.read, 3, "binary and missing files are skipped");
  assert.equal(ids[0], "sql-interpolation", "what can hurt most comes first");
  assert.ok(ids.indexOf("react-state") < ids.indexOf("react-effect"), "state before the effects that depend on it");
  const effect = tour.stops.find((s) => s.id === "react-effect")!;
  assert.deepEqual(effect.files, [{ file: "src/Menu.tsx", count: 2 }]);

  const text = renderTour("shop", tour, 5);
  assert.match(text, /^# The ideas shop relies on/);
  assert.match(text, /reading 3 of 5 tracked files/);
  assert.match(text, /`src\/Menu\.tsx` \(2 places\)/);
  assert.match(text, /No model was involved/);
  assert.match(renderTour("empty", { stops: [], read: 0 }, 0), /None of the ideas Miyagi knows were found/);
});

/* ---- Ollama, against a stand-in that speaks its HTTP API ---------- */

test("the Ollama provider lists models and asks for a completion over its real wire format", async () => {
  const seen: Array<{ url: string; body: unknown }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", body: raw ? JSON.parse(raw) : null });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5-coder:7b" }, { nope: 1 }] }));
      if (req.url === "/api/generate") return res.end(JSON.stringify({ model: "x", response: "  It hashes the password.  ", done: true }));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await ollamaModels(base + "/"), ["llama3.2:latest", "qwen2.5-coder:7b"]);
    const never = new AbortController().signal;
    assert.equal(await ollamaProvider(base, "llama3.2:latest").run({ system: "SYS", user: "USER" }, never), "It hashes the password.");
    assert.deepEqual(seen[seen.length - 1], {
      url: "/api/generate",
      body: { model: "llama3.2:latest", system: "SYS", prompt: "USER", stream: false },
    });

    const options = { setting: "ollama" as const, model: "", customCommand: "", editor: null, bundled: {}, ollamaUrl: base };
    assert.equal((await resolveProvider(options)).provider?.label, "Ollama (llama3.2:latest)", "the first pulled model by default");
    assert.equal((await resolveProvider({ ...options, model: "qwen2.5-coder" })).provider?.label, "Ollama (qwen2.5-coder:7b)", "a model named without its tag");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  // Nothing listening: no models, no hang, and a reason the learner can act on.
  assert.deepEqual(await ollamaModels(base), []);
  assert.deepEqual(await ollamaModels("not a url"), []);
  const none = await resolveProvider({ setting: "ollama", model: "", customCommand: "", editor: null, bundled: {}, ollamaUrl: base });
  assert.match(none.reason ?? "", /No Ollama server/);
});
