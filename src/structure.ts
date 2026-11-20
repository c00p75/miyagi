/**
 * Just enough structure to stop a pattern matcher lying.
 *
 * Detection is a regular expression over added lines. That is fast, has no
 * dependencies and works on languages nobody anticipated, and it has two
 * failure modes that no amount of tightening a pattern can fix, because the
 * information is not on the line:
 *
 * 1. A line of prose. `// await the result before returning` contains `await`
 *    and is not asynchronous code. The pattern cannot know it is in a comment.
 *
 * 2. A statement written across several lines. `LIMIT ${n}` on one line and
 *    `OFFSET ${skip}` on the next is pagination, and neither line says so.
 *
 * A parser would solve both, and would also mean a grammar per language, a
 * megabyte of WebAssembly each, and a tool that fails on a file it has no
 * grammar for. This is the part of a parser those two problems need: a lexer
 * that knows where comments and strings start and stop in the common syntax
 * families, and how deep in brackets it is. From that come two views of the
 * same lines: with comments blanked out, and grouped into statements.
 *
 * It is deliberately forgiving. Its input is the added lines of a diff, which
 * can begin in the middle of a block comment or a template literal, so every
 * piece of state resets rather than poisoning the lines after it.
 */

type Family = "c" | "hash" | "sql" | "markup" | "none";

const FAMILIES: Array<[RegExp, Family]> = [
  [/\.(jsx?|tsx?|mjs|cjs|java|kt|kts|go|rs|cs|swift|php|c|h|cc|cpp|hpp|scss|less|css|dart|scala)$/i, "c"],
  [/\.(vue|svelte|html?|astro)$/i, "markup"],
  [/\.(py|rb|sh|bash|zsh|ya?ml|toml|ini|cfg|conf|r|pl|ex|exs|tf)$/i, "hash"],
  [/(^|\/)(Dockerfile|Makefile|\.env[^/]*|\.gitignore|\.dockerignore|Gemfile|requirements[^/]*\.txt)$/i, "hash"],
  [/\.sql$/i, "sql"],
];

export function familyOf(filePath: string): Family {
  const p = filePath.replace(/\\/g, "/");
  for (const [re, family] of FAMILIES) if (re.test(p)) return family;
  return "none";
}

export interface Structure {
  /** The input lines with every comment replaced by spaces. Same count, same length. */
  code: string[];
  /**
   * For each line, the whole statement it belongs to when that statement
   * spans several lines, joined with single spaces. Empty for a line that is a
   * statement on its own.
   */
  statement: string[];
}

const MAX_STATEMENT_LINES = 8;
const MAX_STATEMENT_CHARS = 600;
/** A template literal open for this many lines is a fragment that began mid-string, not a string. */
const MAX_TEMPLATE_LINES = 40;

const blank = (s: string) => s.replace(/[^\t]/g, " ");

export function analyse(filePath: string, lines: readonly string[]): Structure {
  const family = familyOf(filePath);
  const code: string[] = [];
  const depthAfter: number[] = [];
  const inTemplateAfter: boolean[] = [];

  let block = false; // inside /* */ or <!-- -->
  let blockEnd = "*/";
  let template = false; // inside a backtick string
  let templateLines = 0;
  let depth = 0;

  for (const line of lines) {
    if (family === "none") {
      code.push(line);
      depthAfter.push(0);
      inTemplateAfter.push(false);
      continue;
    }
    // A diff can start inside a doc comment: ` * like this`.
    if (family === "c" && !block && !template && /^\s*\*(\s|\/|$)/.test(line)) {
      code.push(blank(line));
      depthAfter.push(depth);
      inTemplateAfter.push(false);
      continue;
    }
    let out = "";
    let quote = ""; // ' or " : never survives the end of a line
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      const two = line.slice(i, i + 2);
      if (block) {
        const end = line.indexOf(blockEnd, i);
        if (end === -1) {
          out += blank(line.slice(i));
          i = line.length;
        } else {
          out += blank(line.slice(i, end + blockEnd.length));
          i = end + blockEnd.length;
          block = false;
        }
        continue;
      }
      if (quote) {
        out += ch;
        if (ch === "\\") {
          out += line[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (ch === quote) quote = "";
        i++;
        continue;
      }
      if (template) {
        out += ch;
        if (ch === "\\") {
          out += line[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (ch === "`") template = false;
        i++;
        continue;
      }
      // Outside every string and comment.
      if (family === "c" || family === "markup") {
        // `://` is a URL in JSX text or an unquoted attribute, not a comment.
        if (two === "//" && line[i - 1] !== ":" && line[i - 1] !== "\\") {
          out += blank(line.slice(i));
          break;
        }
        if (two === "/*") {
          block = true;
          blockEnd = "*/";
          continue;
        }
      }
      if (family === "markup" && line.startsWith("<!--", i)) {
        block = true;
        blockEnd = "-->";
        continue;
      }
      if (family === "sql") {
        if (two === "--") {
          out += blank(line.slice(i));
          break;
        }
        if (two === "/*") {
          block = true;
          blockEnd = "*/";
          continue;
        }
      }
      // `#` starts a comment at the start of a line or after a space: `a#b` and `"#fff"` do not.
      if (family === "hash" && ch === "#" && (i === 0 || /\s/.test(line[i - 1])) && line[i + 1] !== "!") {
        out += blank(line.slice(i));
        break;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "`" && family !== "hash" && family !== "sql") {
        template = true;
        templateLines = 0;
      } else if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      out += ch;
      i++;
    }
    if (template && ++templateLines > MAX_TEMPLATE_LINES) template = false;
    // A block comment that never closes in this fragment must not swallow the rest of it.
    if (block && !line.includes(blockEnd === "*/" ? "/*" : "<!--") && code.length > 60) block = false;
    code.push(out.length < line.length ? out + blank(line.slice(out.length)) : out);
    depthAfter.push(depth);
    inTemplateAfter.push(template);
    // Depth that never returns to zero is a fragment that began mid-expression.
    if (depth > 12) depth = 0;
  }

  // Group lines into statements: a line that ends inside brackets or inside a
  // template literal continues on the next one.
  const statement: string[] = new Array(lines.length).fill("");
  let start = 0;
  while (start < lines.length) {
    let end = start;
    while (
      end + 1 < lines.length &&
      end - start + 1 < MAX_STATEMENT_LINES &&
      (depthAfter[end] > (start > 0 ? depthAfter[start - 1] : 0) || inTemplateAfter[end])
    ) {
      end++;
    }
    if (end > start) {
      const joined = code
        .slice(start, end + 1)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
      if (joined.length <= MAX_STATEMENT_CHARS) for (let k = start; k <= end; k++) statement[k] = joined;
    }
    start = end + 1;
  }
  return { code, statement };
}
