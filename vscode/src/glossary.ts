/**
 * The project's own glossary.
 *
 * Every codebase has words that belong only to it: what a "settlement" is in
 * this payments app, what "tenant" means in that one. Nobody writes them
 * down, and a learner building with an AI meets them as type names they never
 * chose. This keeps them, per project, with what each one means and where it
 * lives in the code.
 *
 * Terms are written by the learner's AI and checked against the files it was
 * shown. A term only joins spaced review when the learner asks for it; then it
 * is registered as an idea like any other, and re-registered at startup so its
 * question survives a restart.
 *
 * Stored in `~/.miyagi/glossary.json`. No `vscode` import, so it is testable.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { profileDir } from "../../src/profile.js";
import { registerConcepts, type ConceptDefinition } from "../../src/concepts.js";
import type { GlossaryTerm, OwnQuestion } from "./prompts.js";
import { assignTopic } from "./topics.js";
import { slugOf } from "./tools.js";

export interface StoredTerm {
  id: string;
  term: string;
  meaning: string;
  inProject: string;
  where: string[];
  related: string[];
  question: OwnQuestion | null;
  /** The project's folder name, which is what the panel shows. */
  project: string;
  /** Where the project is on disk, so file links open. */
  root: string;
  at: string;
  by: string;
  /** What the learner guessed it meant before reading the answer. */
  guess?: string;
  /** Set once the term is on spaced review. */
  conceptId?: string;
}

export interface Glossary {
  version: 1;
  terms: StoredTerm[];
}

const MAX_TERMS = 600;

export function glossaryPath(): string {
  return path.join(profileDir(), "glossary.json");
}

export function emptyGlossary(): Glossary {
  return { version: 1, terms: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, max) : [];

function question(v: unknown): OwnQuestion | null {
  if (!isObj(v)) return null;
  const q = { question: s(v.question, 1_200), answer: s(v.answer, 240), distractors: strings(v.distractors, 4), explanation: s(v.explanation, 600) };
  return q.question && q.answer && q.distractors.length >= 2 ? q : null;
}

/** Hand-editable and crash-truncatable, so read defensively: a bad entry costs only itself. */
export function normaliseGlossary(raw: unknown): Glossary {
  const out = emptyGlossary();
  if (!isObj(raw) || !Array.isArray(raw.terms)) return out;
  for (const t of raw.terms) {
    if (!isObj(t)) continue;
    const term: StoredTerm = {
      id: s(t.id, 80),
      term: s(t.term, 60),
      meaning: s(t.meaning, 400),
      inProject: s(t.inProject, 500),
      where: strings(t.where, 3),
      related: strings(t.related, 3),
      question: question(t.question),
      project: s(t.project, 120),
      root: s(t.root, 1_000),
      at: s(t.at, 40),
      by: s(t.by, 80),
    };
    if (typeof t.guess === "string" && t.guess) term.guess = t.guess.slice(0, 600);
    if (typeof t.conceptId === "string" && t.conceptId) term.conceptId = t.conceptId.slice(0, 80);
    if (term.id && term.term && term.meaning && term.project) out.terms.push(term);
  }
  return out;
}

export async function loadGlossary(): Promise<Glossary> {
  try {
    return normaliseGlossary(JSON.parse(await fs.readFile(glossaryPath(), "utf8")));
  } catch {
    return emptyGlossary();
  }
}

export async function saveGlossary(g: Glossary): Promise<void> {
  const file = glossaryPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(g, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

/** One write at a time, so two quick saves cannot lose each other's terms. */
let chain: Promise<unknown> = Promise.resolve();
export function updateGlossary<T>(change: (g: Glossary) => T): Promise<T> {
  const next = chain.then(async () => {
    const g = await loadGlossary();
    const out = change(g);
    await saveGlossary(g);
    return out;
  });
  chain = next.catch(() => undefined);
  return next;
}

export function termId(project: string, term: string): string {
  return `term-${slugOf(project) || "project"}-${slugOf(term) || Date.now().toString(36)}`;
}

/** Terms for one project, in the order the panel lists them. */
export function termsFor(g: Glossary, project: string): StoredTerm[] {
  return g.terms.filter((t) => t.project === project).sort((a, b) => a.term.localeCompare(b.term));
}

/**
 * Adds what the AI found. A term already in this project's glossary is kept
 * as it was: the learner may have guessed it or put it on review.
 */
export function addTerms(g: Glossary, found: readonly GlossaryTerm[], where: { project: string; root: string; by: string }, now = new Date()): StoredTerm[] {
  const have = new Set(g.terms.filter((t) => t.project === where.project).map((t) => t.term.toLowerCase()));
  const added: StoredTerm[] = [];
  for (const f of found) {
    if (have.has(f.term.toLowerCase())) continue;
    have.add(f.term.toLowerCase());
    const t: StoredTerm = { ...f, id: termId(where.project, f.term), project: where.project, root: where.root, at: now.toISOString(), by: where.by };
    g.terms.push(t);
    added.push(t);
  }
  if (g.terms.length > MAX_TERMS) g.terms.splice(0, g.terms.length - MAX_TERMS);
  return added;
}

/** A term as an idea, so it can be reviewed like any other. */
export function termAsIdea(t: StoredTerm): ConceptDefinition | null {
  if (!t.question) return null;
  return {
    id: t.id,
    title: `"${t.term}" in ${t.project}`.slice(0, 80),
    emoji: "📖",
    weight: 40,
    patterns: [],
    hook: t.meaning.slice(0, 200),
    what: t.meaning,
    lens: (t.inProject || t.meaning).slice(0, 700),
    pitfall:
      "A word you only half know gets used for the wrong thing: a field named after it ends up holding something else, and nobody notices until the numbers disagree.",
    askTheAi: `In this project, what exactly is a ${t.term}, and where in the code is it defined?`,
    questions: [{ ...t.question, distractors: t.question.distractors.slice(0, 4), level: "Junior" }],
  };
}

/** Registers one term as an idea. Returns its id, or null if it has no usable question. */
export function registerTerm(t: StoredTerm): string | null {
  const def = termAsIdea(t);
  if (!def) return null;
  const result = registerConcepts([def], "glossary");
  if (!result.added.includes(def.id)) return null;
  assignTopic(def.id, "Tooling");
  return def.id;
}

/** At startup: every term on review is registered again, or its question would vanish. */
export async function restoreGlossary(): Promise<number> {
  const g = await loadGlossary();
  let n = 0;
  for (const t of g.terms) if (t.conceptId && registerTerm(t)) n++;
  return n;
}

/** Files most likely to name the project's world: models, schemas, types, domain code. */
export function domainFiles(files: readonly string[], limit: number): string[] {
  const score = (f: string): number => {
    const p = f.toLowerCase();
    let n = 0;
    if (/(^|\/)(models?|entities|domain|schema|types?|db|database|prisma)(\/|\.|$)/.test(p)) n += 5;
    if (/schema\.(prisma|sql|graphql|ts)$|\.sql$|models?\.(py|ts|rb)$|types?\.ts$/.test(p)) n += 4;
    if (/(^|\/)(services?|api|routes?|lib|server|store)(\/|$)/.test(p)) n += 2;
    if (/\.(ts|tsx|js|py|rb|go|java|kt|cs|php|sql|prisma|graphql)$/.test(p)) n += 1;
    if (/(test|spec|fixture|mock|\.d\.ts$|config|\.lock$)/.test(p)) n -= 4;
    return n;
  };
  return [...files]
    .filter((f) => score(f) > 1)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b))
    .slice(0, limit);
}
