/**
 * Practice that comes from the learner's own project, worked out without a
 * model: what a staged change could cost them, which dependency just jumped a
 * major version, which function is worth reading cold, and which questions
 * make a fair mock interview.
 *
 * Each detector is narrow on purpose. A guardrail that fires on ordinary code
 * teaches the learner to dismiss guardrails; a "read this function" that
 * lands on generated code teaches nothing. When in doubt, say nothing.
 *
 * No `vscode` import: all of this is tested from the command line.
 */

import { CONCEPTS, conceptById, questionsForConcept, scrub } from "../../src/concepts.js";

/* ------------------------------------------------------------------ *
 * Reading a diff with its line numbers
 * ------------------------------------------------------------------ */

export interface DiffLine {
  file: string;
  /** Line number in the new file, for added lines; in the old file, for removed ones. */
  line: number;
  text: string;
  sign: "+" | "-";
}

/** Added and removed lines of a unified diff, with real line numbers. */
export function diffLines(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let file = "";
  let oldAt = 0;
  let newAt = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "").trim();
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldAt = Number(hunk[1]);
      newAt = Number(hunk[2]);
      continue;
    }
    if (!file || file === "/dev/null") continue;
    if (raw.startsWith("+")) out.push({ file, line: newAt++, text: raw.slice(1), sign: "+" });
    else if (raw.startsWith("-")) out.push({ file, line: oldAt++, text: raw.slice(1), sign: "-" });
    else if (raw.startsWith(" ")) {
      oldAt++;
      newAt++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Guardrails: what a commit could cost
 * ------------------------------------------------------------------ */

export interface Guardrail {
  id: string;
  kind: "security" | "cost";
  title: string;
  /** How it goes wrong, told as what actually happens. */
  why: string;
  fix: string;
  /** The question asked before the answer is shown. */
  ask: string;
  /** Only these files. */
  files?: RegExp;
  /** Never these files. */
  skip?: RegExp;
  /** Any added line matching one of these is a hit. */
  match: RegExp[];
  /** The hit does not count when any added line in the same file matches this (the safeguard is there). */
  unless?: RegExp;
  /** A built-in idea this is an instance of, to bring forward for review. */
  idea?: string;
}

const TESTS = /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|mocks?)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$|_test\.(go|py)$/i;
const DOCS = /\.(md|mdx|txt|rst)$/i;
const CLIENT = /(^|\/)(app|pages|components|src\/components|src\/app|src\/pages|public|client|frontend)\//i;
const SERVER = /(^|\/)(api|server|routes?|functions|backend|lib\/server|actions?)\/|route\.[cm]?[jt]s$|\.server\.[cm]?[jt]sx?$/i;

export const GUARDRAILS: readonly Guardrail[] = [
  {
    id: "env-file",
    kind: "security",
    title: "An environment file is about to be committed",
    why: "Strangers can find your passwords and keys and run up bills in your name. Saved project history keeps them even after you delete the line, and bots look for exactly this within minutes.",
    fix: "Unstage it (`git restore --staged <file>`), add it to .gitignore, and rotate anything real that was in it.",
    ask: "What ends up in your git history if this file is committed?",
    files: /(^|\/)\.env(\.(?!example$|sample$|template$)[\w.-]+)?$/i,
    match: [/\S/],
    idea: "env-vars",
  },
  {
    id: "public-secret",
    kind: "security",
    title: "A secret exposed to the browser",
    why: "Every visitor gets a copy of this secret and can use it as you. Anything named NEXT_PUBLIC_, VITE_ or REACT_APP_ is sent to every visitor's computer.",
    fix: "Keep the secret server-side under a name without the public prefix, and call it from an API route.",
    ask: "Who can read a variable with this prefix once the app is deployed?",
    skip: TESTS,
    match: [/\b(NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|PUBLIC)_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|TOKEN|API_KEY)[A-Z0-9_]*\b/],
    idea: "client-server-boundary",
  },
  {
    id: "service-role-client",
    kind: "security",
    title: "A service-role key in client code",
    why: "Any visitor can read or delete every customer's data. This master key skips all your access rules, and anyone can copy it out of the page in seconds.",
    fix: "Use the anon key in the browser; keep service-role calls in server code only.",
    ask: "What can someone do with this key if they copy it from the browser?",
    files: CLIENT,
    skip: new RegExp(`${SERVER.source}|${TESTS.source}`, "i"),
    match: [/service[_-]?role/i, /SUPABASE_SERVICE_ROLE/],
  },
  {
    id: "open-rules",
    kind: "security",
    title: "Database rules that let anyone in",
    why: "Anyone on the internet can read, change or wipe all your users' data. `if true` lets every visitor in, and people scan for open Firebase databases on purpose.",
    fix: "Require `request.auth != null` and check the user owns the document.",
    ask: "Who is allowed to read and write with this rule?",
    files: /(\.rules|firestore\.rules|storage\.rules|database\.rules\.json)$/i,
    match: [/allow\s+(read|write|read,\s*write)\s*(:\s*)?if\s+true/i, /"\.(read|write)"\s*:\s*true/],
  },
  {
    id: "cors-any",
    kind: "security",
    title: "Any website may call this API",
    why: "A shady website your user visits can quietly use your app as them. Origin `*` (or echoing whatever origin asks) lets any site call your API from their browser.",
    fix: "List the origins you actually serve, and never combine a wildcard with credentials.",
    ask: "Which websites can call your API with this setting?",
    skip: TESTS,
    match: [/origin\s*:\s*["'`]\*["'`]/i, /Access-Control-Allow-Origin["'`]?\s*[,:]\s*["'`]\*["'`]/i, /origin\s*:\s*true\b/],
    idea: "cors",
  },
  {
    id: "raw-html",
    kind: "security",
    title: "HTML put on the page without escaping",
    why: "One person can take over the account of everyone who views their text. If any part of it came from a user, they can hide instructions in it that the page follows for every visitor.",
    fix: "Render text normally, or sanitize with a library like DOMPurify first.",
    ask: "What happens if the text here contains a <script> tag a user typed?",
    skip: TESTS,
    match: [/dangerouslySetInnerHTML/, /\.innerHTML\s*=(?!=)/, /v-html=/],
    idea: "xss-html-injection",
  },
  {
    id: "webhook-unsigned",
    kind: "security",
    title: "A webhook that trusts whoever calls it",
    why: "Someone can get your product without paying. Without checking the signature, anyone who finds the URL can send a fake 'payment succeeded' and your code believes it.",
    fix: "Verify the signature with the provider's helper (for Stripe, `stripe.webhooks.constructEvent` with the signing secret) before reading the body.",
    ask: "How does this endpoint know the request really came from the provider?",
    files: /webhook/i,
    skip: TESTS,
    match: [/\b(req|request)\.(body|json\(\))|await\s+req\.json\(\)|request\.json\(\)/],
    unless: /constructEvent|verifySignature|verify\(|signature|svix|hmac|createHmac|validateRequest|webhookSecret|signing/i,
    idea: "webhook",
  },
  {
    id: "log-secret",
    kind: "security",
    title: "A secret written to the logs",
    why: "People who should never see this password or key will see it. Logs are copied to other services, shared in screenshots and kept for months.",
    fix: "Log that the value exists, or its last four characters, never the value.",
    ask: "Where do these logs end up, and who can read them?",
    skip: TESTS,
    match: [/console\.(log|info|debug)\([^)]*\b(password|passwd|secret|token|apiKey|api_key|authorization)\b/i, /\b(print|logger\.\w+)\([^)]*\b(password|secret|token|api_key)\b/i],
  },
  {
    id: "sample-rate-full",
    kind: "cost",
    title: "Every request recorded",
    why: "A sample rate of 1.0 in production traces or replays every single request. On a paid plan that can use a month's quota in days, then the bill or the blind spot arrives.",
    fix: "Use something like 0.1 in production (and 1.0 only in development), for example `process.env.NODE_ENV === 'production' ? 0.1 : 1.0`.",
    ask: "How many traces does this send on a day with ten thousand requests?",
    skip: TESTS,
    match: [/(traces|replaysSession|profiles)SampleRate\s*[:=]\s*1(\.0+)?\b/, /traces_sample_rate\s*=\s*1(\.0+)?\b/],
  },
  {
    id: "unbounded-query",
    kind: "cost",
    title: "A query with no limit",
    why: "It returns every row. Fine with ten rows in development; with a hundred thousand in production the page times out and the database bill climbs.",
    fix: "Add a limit (`take`, `LIMIT`, `.limit()`) and paginate.",
    ask: "How many rows does this return when the table has a million?",
    skip: new RegExp(`${TESTS.source}|(^|/)(seed|migrations?|scripts)/`, "i"),
    match: [/\.findMany\(\s*\)/, /\.findMany\(\s*\{\s*\}\s*\)/, /\bSELECT\s+\*\s+FROM\s+\w+\s*["'`;]?\s*$/i, /\.find\(\s*\{\s*\}\s*\)(?!\s*\.limit)/, /\.select\(\s*["'`]\*["'`]\s*\)\s*;?\s*$/],
    unless: /\b(take|limit|LIMIT|\.range\(|paginate|cursor|pageSize|per_page)\b/,
    idea: "pagination",
  },
  {
    id: "llm-no-cap",
    kind: "cost",
    title: "An AI call with no output limit",
    why: "Without a cap on output tokens, one bad prompt or a loop can generate very long responses, and you pay per token for every one of them.",
    fix: "Set a max output length (`max_tokens`, `maxOutputTokens`) sized to what you actually need.",
    ask: "What stops this call from generating, and billing, a very long answer?",
    skip: TESTS,
    match: [/chat\.completions\.create\(|responses\.create\(|messages\.create\(|generateText\(|streamText\(|generateContent\(/],
    unless: /max_tokens|maxTokens|max_output_tokens|maxOutputTokens|max_completion_tokens/,
  },
  {
    id: "tight-cron",
    kind: "cost",
    title: "A job that runs every minute",
    why: "That is 1,440 runs a day, 43,000 a month. On serverless platforms each run is billed, and a slow one can overlap the next.",
    fix: "Run it as rarely as the work allows, and make it safe to run twice.",
    ask: "How many times a month does this run, and what does each run cost?",
    match: [/["'`]\*\s+\*\s+\*\s+\*\s+\*["'`]/, /schedule\s*\(\s*["'`]\*\/1\s/, /every\s*\(\s*["'`]?1\s*minute/i],
    idea: "background-job",
  },
];

export interface Finding {
  id: string;
  kind: Guardrail["kind"];
  title: string;
  why: string;
  fix: string;
  ask: string;
  file: string;
  line: number;
  /** The line itself, scrubbed: a finding about a secret must not repeat the secret. */
  code: string;
  idea?: string;
}

/** What a staged change could cost. At most one finding per rule per file, at most eight in all. */
export function checkGuardrails(lines: readonly DiffLine[]): Finding[] {
  const added = lines.filter((l) => l.sign === "+");
  const byFile = new Map<string, DiffLine[]>();
  for (const l of added) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l]);
  const out: Finding[] = [];
  for (const [file, rows] of byFile) {
    if (DOCS.test(file)) continue;
    for (const rule of GUARDRAILS) {
      if (rule.files && !rule.files.test(file)) continue;
      if (rule.skip && rule.skip.test(file)) continue;
      if (rule.unless && rows.some((r) => rule.unless!.test(r.text))) continue;
      const hit = rows.find((r) => r.text.length <= 400 && rule.match.some((re) => re.test(r.text)));
      if (!hit) continue;
      // An environment file's lines are the secrets themselves: keep the name, drop the value before anything else sees it.
      const code = rule.id === "env-file" ? `${scrub(hit.text.trim().replace(/=.*$/, ""))}=…` : scrub(hit.text.trim());
      out.push({
        id: rule.id,
        kind: rule.kind,
        title: rule.title,
        why: rule.why,
        fix: rule.fix,
        ask: rule.ask,
        file,
        line: hit.line,
        // An environment file's lines are the secrets themselves: show the name only.
        code: code.length > 160 ? code.slice(0, 159) + "…" : code,
        ...(rule.idea ? { idea: rule.idea } : {}),
      });
    }
  }
  // Security before cost, then by file.
  return out.sort((a, b) => Number(a.kind === "cost") - Number(b.kind === "cost") || a.file.localeCompare(b.file)).slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * Major version upgrades
 * ------------------------------------------------------------------ */

export interface Upgrade {
  name: string;
  from: string;
  to: string;
  file: string;
}

/** The leading number of a version range, or null for tags, URLs and workspace links. */
export function majorOf(range: string): { major: number; minor: number } | null {
  const m = /^\s*[\^~>=<v]*\s*(\d+)(?:\.(\d+))?/.exec(range);
  return m ? { major: Number(m[1]), minor: Number(m[2] ?? 0) } : null;
}

/** Is this a breaking jump? A new major, or (below 1.0) a new minor, which semver treats the same way. */
export function isBreaking(from: string, to: string): boolean {
  const a = majorOf(from);
  const b = majorOf(to);
  if (!a || !b) return false;
  if (b.major > a.major) return true;
  return a.major === 0 && b.major === 0 && b.minor > a.minor;
}

const PKG_LINE = /^\s*"((?:@[\w.-]+\/)?[\w.-]+)"\s*:\s*"([^"]+)"/;
const PY_LINE = /^\s*["']?([A-Za-z][\w.-]*)(?:\[[^\]]*\])?["']?\s*(?:==|>=|~=|\^|=\s*["'^~]*)\s*["']?v?(\d[\w.]*)/;
const NOT_DEPS = /^(name|version|description|main|module|types|license|author|private|type|packageManager|node|npm|python|requires-python)$/i;

/** Dependencies whose version crossed a major (or 0.x minor) line in a manifest diff. */
export function upgradesIn(lines: readonly DiffLine[]): Upgrade[] {
  const before = new Map<string, { version: string; file: string }>();
  const after = new Map<string, { version: string; file: string }>();
  for (const l of lines) {
    const isPkg = /(^|\/)package\.json$/i.test(l.file);
    const isPy = /(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile)$/i.test(l.file);
    if (!isPkg && !isPy) continue;
    const m = isPkg ? PKG_LINE.exec(l.text) : PY_LINE.exec(l.text);
    if (!m || NOT_DEPS.test(m[1])) continue;
    const key = `${l.file}::${m[1].toLowerCase()}`;
    (l.sign === "-" ? before : after).set(key, { version: m[2], file: l.file });
  }
  const out: Upgrade[] = [];
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was || !isBreaking(was.version, now.version)) continue;
    out.push({ name: key.split("::")[1], from: was.version, to: now.version, file: now.file });
  }
  return out.slice(0, 5);
}

/* ------------------------------------------------------------------ *
 * Reading code you did not write
 * ------------------------------------------------------------------ */

export interface FunctionSpan {
  name: string;
  /** The declaration line, as written. */
  signature: string;
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|py|go|rb|rs|java|kt|php|cs|swift)$/i;
const NOT_WORTH = /(^|\/)(node_modules|dist|build|out|vendor|\.next|coverage|generated|__generated__|migrations?)\/|\.(min|d)\.[jt]s$|\.(test|spec|stories)\.|_test\.(go|py)$|(^|\/)(test_|conftest)/i;

/** Files worth reading a function from: source, not tests, not generated. */
export function readableFile(file: string): boolean {
  return SOURCE.test(file) && !NOT_WORTH.test(file);
}

const DECLARATIONS: RegExp[] = [
  // function name(  /  export async function name(
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/,
  // const name = async (...) =>  /  const name = function
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  // class methods: name(args) {   (not if/for/while/switch/catch)
  /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|return\b|function\b|else\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  // Python
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  // Go
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
  // Ruby
  /^\s*def\s+(?:self\.)?([a-z_]\w*[?!]?)/,
];

/** Where a brace-delimited body ends, from the line it opens on. Null when it never closes within the file. */
function braceEnd(lines: readonly string[], start: number): number | null {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length && i < start + 200; i++) {
    // The body must open on the declaration line, or the next (Allman style).
    // Otherwise this is a one-line arrow, and counting on would swallow the next function.
    if (!opened && i > start + 1) return null;
    if (!opened && i === start + 1 && !/^\s*\{/.test(lines[i])) return null;
    // Strings and comments can hold braces; strip the common cases before counting.
    const text = lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "").replace(/\/\/.*$/, "");
    for (const ch of text) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") {
        depth--;
        if (opened && depth === 0) return i;
      }
    }
  }
  return null;
}

/** Where an indentation-delimited body (Python, Ruby `def … end`) ends. */
function indentEnd(lines: readonly string[], start: number): number {
  const indent = /^\s*/.exec(lines[start])?.[0].length ?? 0;
  let last = start;
  for (let i = start + 1; i < lines.length && i < start + 200; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const here = /^\s*/.exec(line)?.[0].length ?? 0;
    if (here <= indent) return /^\s*end\b/.test(line) ? i : last;
    last = i;
  }
  return last;
}

/**
 * Functions in a file that are worth reading cold: long enough to do
 * something (6 to 45 lines) and short enough to read in three minutes.
 */
export function findFunctions(file: string, text: string): FunctionSpan[] {
  if (text.length > 400_000 || text.includes("\u0000")) return [];
  const lines = text.split(/\r?\n/);
  const indentBased = /\.(py|rb)$/i.test(file);
  const out: FunctionSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 300) continue;
    let name: string | null = null;
    for (const re of DECLARATIONS) {
      const m = re.exec(line);
      if (m) {
        name = m[1];
        break;
      }
    }
    if (!name || /^(constructor|render|get|set|toString|main|init|setup|test|it|describe)$/.test(name)) continue;
    const end = indentBased ? indentEnd(lines, i) : braceEnd(lines, i);
    if (end === null) continue;
    const length = end - i + 1;
    if (length < 6 || length > 45) continue;
    out.push({ name, signature: line.trim().replace(/\s*\{\s*$/, "").slice(0, 200), start: i + 1, end: end + 1 });
    if (!indentBased) i = end; // nested functions are read as part of their parent
  }
  return out;
}

/** The function to read: not read before, from the most recently changed files first. */
export function pickFunction(
  candidates: ReadonlyArray<FunctionSpan & { file: string }>,
  alreadyRead: ReadonlySet<string>,
  seed = Date.now(),
): (FunctionSpan & { file: string }) | null {
  const fresh = candidates.filter((c) => !alreadyRead.has(`${c.file}#${c.name}`));
  if (!fresh.length) return null;
  // Candidates arrive in recency order; pick among the first few so it is not always the same one.
  const pool = fresh.slice(0, Math.min(6, fresh.length));
  return pool[Math.abs(seed) % pool.length];
}

/* ------------------------------------------------------------------ *
 * Mock interview
 * ------------------------------------------------------------------ */

export interface InterviewQuestion {
  kind: "idea" | "tool" | "story";
  /** What is asked. */
  prompt: string;
  /** What a good answer contains, for grading. Empty for a story question, which is graded on its shape. */
  truth: string;
  why: string;
  /** The idea, tool or story entry it is about. */
  about: string;
  /** The idea the answer counts toward, if any. */
  conceptId?: string;
}

/** Turns a recall question's stem into an open interview question. */
function openUp(question: string): string {
  const q = question.replace(/```[\s\S]*?```/g, "").trim();
  return /\?$/.test(q) ? `${q} Explain your reasoning.` : `${q}. Explain.`;
}

/**
 * Four questions, mixed on purpose: two on ideas the learner holds (the
 * strongest belts, since an interview asks what you claim to know), one on a
 * tool they adopted, and one "tell me about a time" from their own story.
 * Fewer when there is less to draw on, and never more than one per idea.
 */
export function planInterview(input: {
  ideas: ReadonlyMap<string, { seen: boolean; box: number }>;
  tools: ReadonlyArray<{ name: string; termIds: string[] }>;
  story: ReadonlyArray<{ kind: string; title: string; detail: string }>;
  seed?: number;
}): InterviewQuestion[] {
  const seed = input.seed ?? Date.now();
  const rotate = <T>(list: readonly T[], n: number) => (list.length ? list.map((_, i) => list[(i + n) % list.length]) : []);
  const out: InterviewQuestion[] = [];

  const held = CONCEPTS.filter(
    (c) => !c.id.startsWith("tool-") && !c.id.startsWith("own-") && !c.id.startsWith("decision-") && !c.id.startsWith("incident-") && !c.id.startsWith("term-"),
  )
    .map((c) => ({ c, s: input.ideas.get(c.id) }))
    .filter((x) => x.s?.seen && questionsForConcept(x.c.id).length)
    .sort((a, b) => (b.s?.box ?? 0) - (a.s?.box ?? 0));
  for (const { c } of rotate(held.slice(0, 6), seed % Math.max(1, Math.min(6, held.length))).slice(0, 2)) {
    const qs = questionsForConcept(c.id);
    const q = qs.find((x) => x.level !== "Junior") ?? qs[0];
    out.push({ kind: "idea", prompt: openUp(q.question), truth: q.answer, why: q.explanation, about: c.title, conceptId: c.id });
  }

  const tool = rotate(input.tools.filter((t) => t.termIds.length), seed)[0];
  if (tool) {
    const id = rotate(tool.termIds, seed)[0];
    const c = conceptById(id);
    if (c) {
      const term = c.title.replace(/^[^:]+:\s*/, "");
      out.push({ kind: "tool", prompt: `Your project uses ${tool.name}. What is "${term}" in ${tool.name}, and why does it matter in a real setup?`, truth: c.what, why: c.lens.Mid, about: tool.name, conceptId: id });
    }
  }

  const entry = rotate(input.story.filter((e) => e.kind !== "belt"), seed)[0];
  if (entry) {
    out.push({ kind: "story", prompt: "", truth: "", why: "", about: entry.title });
  }
  return out;
}
