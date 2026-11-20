/**
 * Tools: the libraries and services a project adopts.
 *
 * The concept pack teaches ideas you meet again in any code: state, effects,
 * secrets. A learner whose assistant just installed Sentry needs something
 * else as well: what Sentry is for, where it sits in their app, and the five
 * words they will meet in its dashboard. Without that vocabulary they cannot
 * read its docs, its errors, or the assistant's explanation of it.
 *
 * So a tool is taught as a small track: a primer (the job it does, how it
 * fits, how it bites, how to prove it works) and its vocabulary, each term
 * registered as an idea with its own question, belt and review schedule.
 * "Conversant" has a definition: every term at green belt.
 *
 * Detection is deliberately narrow: an exact package name, a config file, a
 * distinctive environment variable prefix, or a setup command. A tool card
 * that appears for something the project did not adopt teaches the learner to
 * ignore tool cards.
 *
 * No `vscode` import.
 */

import { registerConcepts, type ConceptDefinition } from "../../src/concepts.js";
import { assignTopic, parseTopic, type Topic } from "./topics.js";
import { TOOL_CATALOG, type CatalogTool, type ToolTerm } from "./toolCatalog.js";

export { TOOL_CATALOG, type CatalogTool, type ToolTerm };

/** A tool described at runtime: catalogued, or written by the learner's AI for one that is not. */
export interface ToolSpec {
  id: string;
  name: string;
  emoji: string;
  job: string;
  oneLiner: string;
  analogy?: string;
  flow: string[];
  terms: ToolTerm[];
  risks: string[];
  verify: string;
  docs: string;
  topic: Topic;
  /** True when it came from the built-in catalogue, so its text was reviewed by a person. */
  builtIn: boolean;
}

export interface ToolHit {
  id: string;
  /** What gave it away: the package line, the file, the command. Scrubbed by the caller's source. */
  evidence: string;
  file: string;
}

const MANIFEST = /(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.cfg)$/i;

/** Package names an added manifest line names. Empty for anything that is not a dependency line. */
export function packagesInLine(file: string, line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (/package\.json$/i.test(file)) {
    const m = /^"((?:@[\w.-]+\/)?[\w.-]+)"\s*:\s*"[\^~>=<*]?\s*(\d|workspace:|npm:|latest|next|\*)/.exec(trimmed);
    return m && m[1] !== "version" && m[1] !== "node" ? [m[1].toLowerCase()] : [];
  }
  // requirements.txt, Pipfile, pyproject (PEP 621 list entries and poetry tables).
  const py = /^["']?([A-Za-z][\w.-]*)(\[[\w,\s-]+\])?["']?\s*(==|>=|~=|<=|>|<|=\s*["'{^~]|\s*$)/.exec(trimmed.replace(/,$/, ""));
  if (py && !/^(name|version|description|python|readme|license|requires-python|authors)$/i.test(py[1])) return [py[1].toLowerCase()];
  return [];
}

/** Package names an install command adds. */
export function packagesInCommand(command: string): string[] {
  const out: string[] = [];
  const install =
    /\b(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+add|bun\s+(?:add|i|install)|pip3?\s+install|uv\s+(?:add|pip\s+install)|poetry\s+add)\s+([^;&|]+)/gi;
  for (const m of command.matchAll(install)) {
    for (const token of m[1].trim().split(/\s+/)) {
      if (!token || token.startsWith("-") || token.startsWith(".") || token.startsWith("/")) continue;
      // `@scope/name@1.2.3` and `name==1.0`: keep the name.
      const name = token.replace(/^(@[^/@]+\/[^@]+|[^@=<>~!\[]+).*$/, "$1").replace(/\[.*$/, "");
      if (/^(@[\w.-]+\/)?[\w.-]+$/.test(name)) out.push(name.toLowerCase());
    }
  }
  return out;
}

function packageMatches(tool: CatalogTool, name: string): boolean {
  return tool.packages.some((p) => (p.endsWith("/") ? name.startsWith(p.toLowerCase()) : name === p.toLowerCase()));
}

const compiled = new Map<string, { files: RegExp[]; commands: RegExp[]; env: RegExp | null }>();
function patternsOf(tool: CatalogTool) {
  let c = compiled.get(tool.id);
  if (!c) {
    const safe = (src: string) => {
      try {
        return new RegExp(src, "i");
      } catch {
        return null;
      }
    };
    c = {
      files: (tool.files ?? []).map(safe).filter((r): r is RegExp => r !== null),
      commands: (tool.commands ?? []).map(safe).filter((r): r is RegExp => r !== null),
      env: tool.env?.length ? new RegExp(`\\b(${tool.env.map((e) => e.replace(/[^\w]/g, "")).join("|")})[A-Z0-9_]*\\b`) : null,
    };
    compiled.set(tool.id, c);
  }
  return c;
}

/**
 * Tools a change or a run of commands brings in. One hit per tool, the most
 * telling evidence first (a package beats a file beats an env var).
 */
export function detectTools(
  changes: ReadonlyArray<{ file: string; added: string }>,
  commands: readonly string[] = [],
): ToolHit[] {
  const hits = new Map<string, ToolHit & { rank: number }>();
  const offer = (id: string, rank: number, evidence: string, file: string) => {
    const was = hits.get(id);
    if (!was || rank < was.rank) hits.set(id, { id, evidence: evidence.trim().slice(0, 140), file, rank });
  };
  for (const change of changes) {
    const file = change.file.replace(/\\/g, "/");
    const lines = change.added.split(/\r?\n/).slice(0, 4_000);
    const manifest = MANIFEST.test(file);
    for (const tool of TOOL_CATALOG) {
      const p = patternsOf(tool);
      if (p.files.some((re) => re.test(file))) offer(tool.id, 1, file, file);
    }
    for (const line of lines) {
      if (line.length > 400) continue;
      if (manifest) {
        for (const name of packagesInLine(file, line)) {
          for (const tool of TOOL_CATALOG) if (packageMatches(tool, name)) offer(tool.id, 0, line, file);
        }
      }
      for (const tool of TOOL_CATALOG) {
        const env = patternsOf(tool).env;
        if (env && env.test(line)) offer(tool.id, 2, line, file);
      }
    }
  }
  for (const command of commands) {
    for (const name of packagesInCommand(command)) {
      for (const tool of TOOL_CATALOG) if (packageMatches(tool, name)) offer(tool.id, 0, command, "");
    }
    for (const tool of TOOL_CATALOG) {
      if (patternsOf(tool).commands.some((re) => re.test(command))) offer(tool.id, 1, command, "");
    }
  }
  return [...hits.values()].sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...hit }) => hit);
}

/** Packages added that the catalogue does not know: offered as "learn it?", never taught unasked. */
export function unknownPackages(changes: ReadonlyArray<{ file: string; added: string }>): string[] {
  const out = new Set<string>();
  for (const change of changes) {
    const file = change.file.replace(/\\/g, "/");
    if (!MANIFEST.test(file)) continue;
    for (const line of change.added.split(/\r?\n/).slice(0, 2_000)) {
      for (const name of packagesInLine(file, line)) {
        if (/^@types\//.test(name)) continue;
        if (!TOOL_CATALOG.some((t) => packageMatches(t, name))) out.add(name);
      }
    }
  }
  return [...out].slice(0, 8);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The catalogued tool a learner means by a name they typed, if any. */
export function findTool(query: string): CatalogTool | null {
  const q = norm(query);
  if (q.length < 2) return null;
  return (
    TOOL_CATALOG.find((t) => norm(t.name) === q || norm(t.id) === q) ??
    TOOL_CATALOG.find((t) => t.packages.some((p) => norm(p.replace(/\/$/, "")) === q)) ??
    TOOL_CATALOG.find((t) => q.length >= 4 && (norm(t.name).startsWith(q) || norm(t.name).includes(q))) ??
    null
  );
}

export function toolById(id: string): CatalogTool | null {
  return TOOL_CATALOG.find((t) => t.id === id) ?? null;
}

export function specOf(tool: CatalogTool): ToolSpec {
  return {
    id: tool.id,
    name: tool.name,
    emoji: tool.emoji,
    job: tool.job,
    oneLiner: tool.oneLiner,
    analogy: tool.analogy,
    flow: tool.flow,
    terms: tool.terms,
    risks: tool.risks,
    verify: tool.verify,
    docs: tool.docs,
    topic: tool.topic,
    builtIn: true,
  };
}

/* ------------------------------------------------------------------ *
 * The vocabulary as ideas
 * ------------------------------------------------------------------ */

export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
}

export function termId(toolId: string, term: string): string {
  return `tool-${slugOf(toolId).slice(0, 20)}-${slugOf(term) || "term"}`.replace(/-+/g, "-").slice(0, 60).replace(/-+$/, "");
}

/** Wrong answers for one term: the other terms' meanings, closest in length first, so length gives nothing away. */
function distractorsFor(target: ToolTerm, others: readonly ToolTerm[]): string[] {
  return [...others]
    .sort((a, b) => Math.abs(a.meaning.length - target.meaning.length) - Math.abs(b.meaning.length - target.meaning.length))
    .slice(0, 3)
    .map((t) => t.meaning);
}

/**
 * One idea per term, each with two questions: what the term means (its
 * neighbours' meanings as the wrong answers, which are exactly the things a
 * newcomer confuses), and the reverse, which term a description belongs to.
 */
export function termDefinitions(spec: ToolSpec): ConceptDefinition[] {
  return spec.terms.map((t, i) => {
    const others = spec.terms.filter((o) => o !== t);
    const risk = spec.risks[i % Math.max(1, spec.risks.length)] ?? `Misreading what "${t.term}" means is how ${spec.name} gets set up wrong.`;
    const otherTerms = [...others]
      .sort((a, b) => Math.abs(a.term.length - t.term.length) - Math.abs(b.term.length - t.term.length))
      .slice(0, 3)
      .map((o) => o.term);
    const questions: NonNullable<ConceptDefinition["questions"]> = [];
    if (others.length >= 2) {
      questions.push({
        question: `In ${spec.name}, what is "${t.term}"?`,
        answer: t.meaning,
        distractors: distractorsFor(t, others),
        explanation: `${t.term}: ${t.meaning}`,
        level: "Junior",
      });
      questions.push({
        question: `Which ${spec.name} term matches this? ${t.meaning}`,
        answer: t.term,
        distractors: otherTerms,
        explanation: `That describes ${t.term}. The others are different parts of ${spec.name}.`,
        level: "Mid",
      });
    }
    return {
      id: termId(spec.id, t.term),
      title: `${spec.name}: ${t.term}`.slice(0, 80),
      emoji: spec.emoji,
      weight: 40,
      patterns: [],
      hook: `Part of ${spec.name}'s vocabulary. You will meet it in its docs, its dashboard and its errors.`.slice(0, 200),
      what: t.meaning.slice(0, 400),
      lens: `${t.meaning} It is one of the words you need to read ${spec.name}'s docs and dashboard: ${spec.job.toLowerCase()}.`.slice(0, 700),
      pitfall: risk.slice(0, 500),
      askTheAi: `Where does "${t.term}" show up in my project's ${spec.name} setup, and what would break if it were wrong?`.slice(0, 300),
      docs: { label: `${spec.name} docs`, url: spec.docs },
      questions,
    };
  });
}

/**
 * Registers a tool's vocabulary as ideas. A term whose questions fail the
 * quality bar is still registered, without them: the lesson is worth having
 * even when its question is not. Returns the ids that are now live.
 */
export function registerTool(spec: ToolSpec): string[] {
  const ids: string[] = [];
  for (const def of termDefinitions(spec)) {
    let ok = registerConcepts([def], `tool:${spec.id}`).added.includes(def.id);
    if (!ok) {
      // Usually one question failed; try each alone, then none.
      for (const q of def.questions ?? []) {
        if ((ok = registerConcepts([{ ...def, questions: [q] }], `tool:${spec.id}`).added.includes(def.id))) break;
      }
      if (!ok) ok = registerConcepts([{ ...def, questions: [] }], `tool:${spec.id}`).added.includes(def.id);
    }
    if (ok) {
      assignTopic(def.id, spec.topic);
      ids.push(def.id);
    }
  }
  return ids;
}

/** Validates a tool a model described. Null when it is not usable as a lesson. */
export function specFromModel(raw: {
  name: string;
  emoji?: string;
  job?: string;
  oneLiner?: string;
  flow?: string[];
  terms?: ToolTerm[];
  risks?: string[];
  verify?: string;
  topic?: string;
}): ToolSpec | null {
  const name = raw.name.trim().slice(0, 60);
  const terms = (raw.terms ?? [])
    .filter((t) => t && typeof t.term === "string" && typeof t.meaning === "string" && t.term.trim() && t.meaning.trim().length >= 20)
    .map((t) => ({ term: t.term.trim().slice(0, 40), meaning: t.meaning.trim().slice(0, 200) }))
    .slice(0, 6);
  if (!name || terms.length < 3 || !raw.oneLiner) return null;
  const id = slugOf(name);
  if (id.length < 2) return null;
  return {
    id,
    name,
    emoji: (raw.emoji ?? "").trim().slice(0, 8) || "🧰",
    job: (raw.job ?? "").trim().slice(0, 60) || "A tool in your project",
    oneLiner: raw.oneLiner.trim().slice(0, 200),
    flow: (raw.flow ?? []).map((s) => s.trim().slice(0, 140)).filter(Boolean).slice(0, 5),
    terms,
    risks: (raw.risks ?? []).map((s) => s.trim().slice(0, 200)).filter(Boolean).slice(0, 3),
    verify: (raw.verify ?? "").trim().slice(0, 240),
    docs: `https://duckduckgo.com/?q=${encodeURIComponent(name + " documentation")}`,
    topic: parseTopic(raw.topic) ?? "Tooling",
    builtIn: false,
  };
}
