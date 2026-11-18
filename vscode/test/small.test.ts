/** The small pure modules: cost meter, quiet schedule, ignore globs, prerequisites, ranks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentMeter, describeMeter, emptyMeter, estimatedTokens, recordCall, weekOf } from "../src/meter.js";
import {
  globToRegExp,
  ignoreMatcher,
  inQuietHours,
  parseQuietHours,
  pausedUntil,
  quietNow,
  tomorrowMorning,
} from "../src/schedule.js";
import { orderByPrerequisite, prerequisiteOf } from "../src/topics.js";
import { depthSuggestion, rankForLevel } from "../src/engine.js";
import { DiffTracker } from "../src/tracker.js";
import { chooseFiles, fileInterest } from "../src/reports.js";
import { supportsSecondarySidebar } from "../src/docking.js";

test("the meter counts a week and starts again on Monday", () => {
  const wed = new Date(2026, 10, 18, 12);
  assert.equal(weekOf(wed), "2026-11-16");
  assert.equal(weekOf(new Date(2026, 10, 22, 23)), "2026-11-16", "Sunday belongs to the week that started Monday");
  let m = recordCall(emptyMeter(wed), 3_000, 1_000, wed);
  m = recordCall(m, 3_000, 1_000, wed);
  assert.equal(m.calls, 2);
  assert.equal(estimatedTokens(m), 2_000);
  assert.equal(describeMeter(m), "2 AI calls this week, about 2,000 tokens.");
  const nextWeek = new Date(2026, 10, 24, 9);
  assert.equal(currentMeter(m, nextWeek).calls, 0);
  assert.equal(recordCall(m, 400, 0, nextWeek).calls, 1);
  assert.equal(currentMeter({ week: "2026-11-16", calls: "many" }, wed).calls, 0, "unreadable state is discarded");
  assert.equal(describeMeter(emptyMeter()), "No AI calls this week.");
});

test("quiet hours can cross midnight", () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m);
  const night = parseQuietHours("22:00-07:00");
  assert.ok(night);
  assert.equal(inQuietHours(night, at(23)), true);
  assert.equal(inQuietHours(night, at(6, 59)), true);
  assert.equal(inQuietHours(night, at(7)), false);
  assert.equal(inQuietHours(night, at(12)), false);
  const lunch = parseQuietHours(" 12:00 - 13:30 ");
  assert.equal(inQuietHours(lunch, at(13, 29)), true);
  assert.equal(inQuietHours(lunch, at(13, 30)), false);
  for (const bad of ["", "25:00-07:00", "9-5", "09:00-09:00", null, 12]) assert.equal(parseQuietHours(bad), null);
});

test("a pause ends by itself, and outranks quiet hours while it lasts", () => {
  const now = new Date(2026, 10, 18, 23, 30);
  const later = new Date(now.getTime() + 60_000).toISOString();
  assert.equal(pausedUntil(new Date(now.getTime() - 1).toISOString(), now), null);
  assert.equal(pausedUntil("not a date", now), null);
  assert.deepEqual(quietNow({ pausedUntil: later, quietHours: "22:00-07:00" }, now), { quiet: true, why: "paused", until: new Date(later) });
  assert.deepEqual(quietNow({ pausedUntil: undefined, quietHours: "22:00-07:00" }, now), { quiet: true, why: "hours" });
  assert.deepEqual(quietNow({ pausedUntil: undefined, quietHours: "" }, now), { quiet: false });
  const morning = tomorrowMorning(now);
  assert.equal(morning.getHours(), 7);
  assert.equal(morning.getDate(), 19);
  assert.equal(tomorrowMorning(new Date(2026, 10, 18, 3)).getDate(), 18, "at 3 a.m. the next morning is today");
});

test("ignore patterns behave like .gitignore lines", () => {
  const ignored = ignoreMatcher(["**/*.test.ts", "migrations/**", "*.generated.*", "docs/api.md", 42, ""]);
  assert.equal(ignored("src/a.test.ts"), true);
  assert.equal(ignored("a.test.ts"), true);
  assert.equal(ignored("src/a.ts"), false);
  assert.equal(ignored("migrations/001_init.sql"), true);
  assert.equal(ignored("src/migrations/001.sql"), false, "a pattern with a slash is anchored");
  assert.equal(ignored("src/deep/types.generated.ts"), true, "a pattern without a slash matches at any depth");
  assert.equal(ignored("docs/api.md"), true);
  assert.equal(ignored("src\\win\\a.test.ts"), true, "Windows separators");
  assert.equal(globToRegExp("a+b(c).ts")?.test("a+b(c).ts"), true, "regex characters in a name are literal");
  assert.equal(globToRegExp("x".repeat(300)), null);
});

test("an idea is taught after the idea it builds on", () => {
  assert.equal(prerequisiteOf("react-effect"), "react-state");
  assert.equal(prerequisiteOf("hardcoded-secret"), null);
  const order = (ids: string[]) => orderByPrerequisite(ids.map((id) => ({ id }))).map((x) => x.id);
  assert.deepEqual(order(["react-effect", "tests", "react-state"]), ["react-state", "react-effect", "tests"]);
  assert.deepEqual(order(["react-effect", "react-state", "react-props"]), ["react-props", "react-state", "react-effect"]);
  assert.deepEqual(order(["tests", "cors"]), ["tests", "cors"], "nothing moves when the prerequisite is absent");
});

test("ranks and depth suggestions", () => {
  assert.deepEqual([1, 2, 3, 6, 10, 15, 40].map(rankForLevel), ["Novice", "Novice", "Apprentice", "Practitioner", "Adept", "Sensei", "Sensei"]);
  assert.equal(depthSuggestion("Junior", { attempts: 9, correct: 9 }), null, "not enough answers to say");
  assert.equal(depthSuggestion("Junior", { attempts: 12, correct: 11 }), "Mid");
  assert.equal(depthSuggestion("Senior", { attempts: 12, correct: 12 }), null, "nowhere higher to go");
  assert.equal(depthSuggestion("Mid", { attempts: 10, correct: 3 }), "Junior");
  assert.equal(depthSuggestion("Mid", { attempts: 10, correct: 6 }), null);
});

test("a file in a folder without git: first sight is a baseline unless it was just created", () => {
  const t = new DiffTracker();
  assert.equal(t.deltaFile("/plain", "a.py", "x = 1\ny = 2", false), null);
  const second = t.deltaFile("/plain", "a.py", "x = 1\ny = 2\nz = hash(pw)", false);
  assert.equal(second?.added, "z = hash(pw)");
  assert.equal(t.deltaFile("/plain", "a.py", "x = 1\ny = 2\nz = hash(pw)", false), null);
  const created = t.deltaFile("/plain", "new.py", "import bcrypt\n\nbcrypt.hashpw(p, s)", true);
  assert.equal(created?.addedLines, 2);
});

test("the files shown for a project map: one per folder first, telling names first", () => {
  assert.ok(fileInterest("README.md") > fileInterest("src/index.ts"));
  assert.ok(fileInterest("src/index.ts") > fileInterest("src/utils/format.ts"));
  assert.ok(fileInterest("src/api/users.test.ts") < 0);
  const files = ["README.md", "package.json", "src/index.ts", "src/a.ts", "src/b.ts", "src/api/users.ts", "src/api/orders.ts", "test/a.test.ts"];
  const chosen = chooseFiles(files, { tree: 5, heads: 3 });
  assert.equal(chosen.tree.length, 5);
  for (const folderRep of ["README.md", "src/index.ts", "src/api/orders.ts"]) assert.ok(chosen.tree.includes(folderRep), folderRep);
  assert.deepEqual(chosen.heads, ["README.md", "package.json", "src/index.ts"]);
});

test("only VS Code itself gets the panel docked on the right automatically", () => {
  assert.equal(supportsSecondarySidebar("Visual Studio Code", "1.106.0"), true);
  assert.equal(supportsSecondarySidebar("Visual Studio Code - Insiders", "1.120.1"), true);
  assert.equal(supportsSecondarySidebar("Visual Studio Code", "1.105.2"), false);
  assert.equal(supportsSecondarySidebar("Cursor", "1.128.0"), false, "Cursor reserves that side bar");
  assert.equal(supportsSecondarySidebar("Antigravity", "1.110.0"), false);
});
