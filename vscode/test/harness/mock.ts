/**
 * Real engine data for the browser harness (`npm run harness`).
 *
 * The panel is a plain web page that draws whatever state it is sent, so it
 * can be looked at in a browser without an editor. This writes that state from
 * the real engine against a scratch profile, so what is on screen is what the
 * engine actually produces, not a hand-written imitation of it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectConcepts } from "../../../src/concepts.js";
import * as engine from "../../src/engine.js";

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-harness-"));
  process.env.MIYAGI_HOME = path.join(root, "home");
  const src = 'import bcrypt from "bcrypt";\nconst hash = await bcrypt.hash(password, 12);\nawait db.query(`INSERT INTO users (email) VALUES (\'${email}\')`);';
  const ui = "const [open, setOpen] = useState(false);\nuseEffect(() => { load(); }, []);";
  const lesson = (await engine.teach({
    changes: [
      { file: "src/api/auth.ts", concepts: detectConcepts("src/api/auth.ts", src) },
      { file: "src/ui/Menu.tsx", concepts: detectConcepts("src/ui/Menu.tsx", ui) },
    ],
    root,
    source: "src/api/auth.ts and 1 other file",
    limit: 2,
  }))!;
  lesson.by = "Claude Code";
  const first = lesson.cards[0];
  const state = {
    type: "state",
    status: await engine.status(),
    topics: engine.TOPICS,
    topic: null,
    lessons: [lesson],
    explanations: {},
    extras: {},
    lessonExtras: {},
    busy: {},
    errors: {},
    commands: [{ command: "git status", count: 3, info: engine.commandInfo("git status", "Junior") }],
    commandTotal: 3,
    ai: { label: "Claude Code (haiku)" },
    capture: { on: ["Claude Code"], available: [] },
    watching: true,
    repos: ["shop-api", "shop-web"],
    folders: [],
    heartbeat: { root: "shop-api", at: new Date().toISOString(), files: 2, taught: 2, held: false },
    skipped: 0,
    quiet: null,
    meter: "7 AI calls this week, about 9,400 tokens.",
    findIdeas: "off",
    recallFirst: true,
    explainFirst: true,
    fadeSupport: true,
    holding: false,
    week: { days: 3, goal: 4, weeksRunning: 2 },
    mirror: "You opened 6 of the 14 files your assistant changed this week.",
    check: null,
    turnsLeft: true,
  };
  const out = {
    state,
    quiz: await engine.quizForConcept(first.conceptId),
    dojo: await engine.dojo(),
    insight: await engine.insight(),
    belts: engine.BELT_NAMES,
    first: first.key,
    lessonId: lesson.id,
  };
  await fs.writeFile(process.argv[2], "window.MOCK = " + JSON.stringify(out) + ";");
  await fs.rm(root, { recursive: true, force: true });
})();
