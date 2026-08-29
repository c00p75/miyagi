/**
 * `--doctor`.
 *
 * A stdio server is a bad place to debug an install: everything worth showing
 * would either be invisible or corrupt the protocol. So the doctor is a
 * separate mode, and what matters is that it *finds* the problems rather than
 * reporting a cheerful all-clear over a broken install.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "miyagi.js");

async function doctor(home: string): Promise<{ out: string; code: number }> {
  try {
    const { stdout } = await exec(process.execPath, [entry, "--doctor"], {
      env: { ...process.env, MIYAGI_HOME: home },
    });
    return { out: stdout, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; code?: number };
    return { out: e.stdout ?? "", code: typeof e.code === "number" ? e.code : 1 };
  }
}

test("a clean install reports all checks passing", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-doctor-clean-"));
  const { out, code } = await doctor(home);
  assert.equal(code, 0);
  assert.match(out, /doctor/);
  assert.match(out, /Node version/);
  assert.match(out, /Command execution/);
  assert.match(out, /Roadmap tracks: 6 tracks/);
  assert.match(out, /checkpointed steps/);
  assert.match(out, /All checks passed|All required checks passed/);
});

test("a corrupt profile is reported as a warning, not a silent replacement", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-doctor-corrupt-"));
  await fs.writeFile(path.join(home, "profile.json"), '{"version":1,"player":{"xp":3', "utf8");
  const { out, code } = await doctor(home);
  assert.match(out, /Saved profile/);
  assert.match(out, /could not be used/);
  assert.equal(code, 0, "a warning is a working install");
});

test("a broken track file is named, because a skipped track is invisible otherwise", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-doctor-track-"));
  await fs.mkdir(path.join(home, "roadmaps"), { recursive: true });
  await fs.writeFile(path.join(home, "roadmaps", "broken.json"), "{ nope", "utf8");
  const { out } = await doctor(home);
  assert.match(out, /Track files skipped/);
  assert.match(out, /broken\.json/);
});

test("a healthy profile is summarised rather than just declared fine", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-doctor-summary-"));
  process.env.MIYAGI_HOME = home;
  const { saveProfile, normaliseProfile, PROFILE_VERSION } = await import("../src/profile.js");
  const profile = normaliseProfile({
    version: PROFILE_VERSION,
    player: { xp: 420 },
    settings: {},
    roadmap: {},
    verified: { "Command Line Basics#4": new Date().toISOString() },
    review: [
      {
        id: "quiz:x",
        kind: "quiz",
        ref: "x",
        label: "x",
        dueAt: new Date().toISOString(),
        box: 1,
        reps: 1,
        lapses: 0,
      },
    ],
  });
  assert.ok(profile);
  await saveProfile(profile);

  const { out } = await doctor(home);
  assert.match(out, /420 XP/);
  assert.match(out, /1 scheduled items/);
  assert.match(out, /1 verified checkpoints/);
});

test("the doctor writes to stdout only in doctor mode, where there is no protocol to corrupt", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "miyagi-doctor-stdout-"));
  const { out } = await doctor(home);
  // Not a JSON-RPC frame in sight; this is a human report.
  assert.ok(!out.trim().startsWith("{"), "doctor output is prose, not frames");
  assert.ok(out.split("\n").length > 6);
});

test("--version prints just the version", async () => {
  const { stdout } = await exec(process.execPath, [entry, "--version"]);
  const { VERSION } = await import("../src/version.js");
  assert.equal(stdout.trim(), VERSION);
});
