/**
 * Idea packs: concepts a person adds without touching the source.
 *
 * The built-in pack teaches what most projects share. It will never know the
 * payment provider one team uses or the house rule another has about feature
 * flags. A pack is a JSON file under `~/.miyagi/ideas/` holding concepts in the
 * same shape as the built-ins, and it follows the conventions user tracks
 * already set in `roadmaps.ts`: one directory under the profile, every
 * `*.json` in name order, and a report that names each file that did not load.
 *
 * That last part is the point. A pack that is silently ignored looks, to its
 * author, exactly like a pack whose patterns never matched, and they will
 * spend an afternoon on the patterns. So nothing here throws and nothing is
 * dropped quietly: every file yields a result saying what was registered, what
 * was rejected and why.
 *
 * The file is untrusted input. It is size-capped before it is read, and every
 * concept in it goes through `registerConcepts`, which is where the real
 * validation lives.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { profileDir } from "./profile.js";
import { registerConcepts } from "./concepts.js";

/** Far more than a pack of hand-written lessons needs, and small enough to parse without a pause at startup. */
const MAX_PACK_BYTES = 500_000;
const MAX_CONCEPTS_PER_PACK = 200;

export function ideaPacksDir(): string {
  return path.join(profileDir(), "ideas");
}

export interface PackLoad {
  /** The file's basename, which is also what its concepts' origin is built from. */
  file: string;
  /** The pack's own name, or the file name without its extension. */
  name: string;
  added: string[];
  rejected: Array<{ id: string; reason: string }>;
  /** Set when the file as a whole could not be used. Nothing from it was registered. */
  error?: string;
}

/**
 * Reads every `*.json` under the ideas directory and registers what is valid.
 *
 * A missing directory is the normal case and yields an empty list. Files load
 * in name order, so when two packs define the same id the later file wins, the
 * same way a re-registered concept replaces its earlier self.
 *
 * This is meant to run once at startup. Loading again picks up edits and new
 * files, but a concept whose file has since been deleted stays registered
 * until the server restarts.
 */
export async function loadIdeaPacks(): Promise<PackLoad[]> {
  const dir = ideaPacksDir();
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith(".json"));
  } catch {
    return [];
  }

  const loads: PackLoad[] = [];
  for (const file of names.sort()) {
    const load: PackLoad = {
      file,
      name: path.basename(file, path.extname(file)),
      added: [],
      rejected: [],
    };
    loads.push(load);
    try {
      const full = path.join(dir, file);
      // Checked before reading, so a mistaken multi-gigabyte file costs a stat and not the memory.
      const { size } = await fs.stat(full);
      if (size > MAX_PACK_BYTES) {
        load.error = `larger than ${MAX_PACK_BYTES / 1000} kB`;
        continue;
      }
      const parsed: unknown = JSON.parse(await fs.readFile(full, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        load.error = 'not a pack: expected { "name": ..., "concepts": [...] }';
        continue;
      }
      const o = parsed as Record<string, unknown>;
      if (typeof o.name === "string" && o.name.trim()) load.name = o.name.trim().slice(0, 120);
      if (!Array.isArray(o.concepts)) {
        load.error = "no `concepts` list";
        continue;
      }
      const result = registerConcepts(o.concepts.slice(0, MAX_CONCEPTS_PER_PACK), `pack:${file}`);
      load.added = result.added;
      load.rejected = result.rejected;
      const over = o.concepts.length - MAX_CONCEPTS_PER_PACK;
      if (over > 0) {
        load.rejected.push({
          id: "(pack)",
          reason: `${over} concept${over === 1 ? "" : "s"} past the limit of ${MAX_CONCEPTS_PER_PACK} per pack were not read`,
        });
      }
    } catch (err) {
      load.error = String((err as Error)?.message ?? err).slice(0, 80);
    }
  }
  return loads;
}

/**
 * Everything that did not load, one line per problem, for the startup log and
 * the doctor. Empty when every pack loaded cleanly.
 */
export function packProblems(loads: readonly PackLoad[]): string[] {
  const problems: string[] = [];
  for (const load of loads) {
    if (load.error) problems.push(`${load.file} (${load.error})`);
    for (const r of load.rejected) problems.push(`${load.file}: ${r.id} (${r.reason})`);
  }
  return problems;
}
