/**
 * The code-concept pack.
 *
 * The command pack teaches what a shell command does. That is the wrong unit
 * for someone building with an AI assistant: the assistant runs the commands,
 * and the thing the person does not understand is the four hundred lines it
 * just wrote. So this pack teaches at the level of the idea a change relies
 * on — state, effects, secrets, parameterised queries — and is keyed by what
 * can be *seen* in a diff rather than by what was typed in a terminal.
 *
 * Four constraints shape it:
 *
 * 1. Detection is a regular expression over added lines, not a parser. It has
 *    to run inside an editor hook in a few milliseconds, with no dependencies,
 *    on languages it has never heard of. It will miss things. It must not
 *    claim things: a pattern loose enough to fire on prose is worse than no
 *    pattern, because a tutor that explains something you did not do stops
 *    being read.
 *
 * 2. Every concept carries its own recall question. Explaining is exposure;
 *    the question that comes back next week is the part that teaches.
 *
 * 3. Evidence is a single line, capped and scrubbed. The observation log lives
 *    in the learner's home directory, and a line that matched "hard-coded
 *    secret" is exactly the line that must never be copied there.
 *
 * 4. It has to be worth reading mid-task. The reader came to ship something,
 *    not to study, so every entry opens with a hook, says the thing in plain
 *    words, and tells the story of how it goes wrong. A lesson that reads like
 *    a manual page is skipped, and a skipped lesson teaches nothing.
 */

import type { QuizQuestion } from "./quiz.js";
import { analyse } from "./structure.js";

export type ConceptLevel = "Junior" | "Mid" | "Senior";

export interface CodeConcept {
  id: string;
  title: string;
  emoji: string;
  /**
   * How much it matters that the person understands this, 0-100. Security
   * outranks syntax: nobody was ever breached by a misunderstood `.map()`.
   */
  weight: number;
  /** Only consider files whose path matches. Null means any file. */
  files: RegExp | null;
  /** Any one matching an added line is a hit. */
  patterns: RegExp[];
  /** The opener: one line that makes someone want the next one. */
  hook: string;
  /** One plain sentence: what this thing is. */
  what: string;
  /** The same idea at three depths. */
  lens: Record<ConceptLevel, string>;
  /** The way this goes wrong, told as what actually happens. */
  pitfall: string;
  /** A question worth putting to the assistant that wrote the code. */
  askTheAi: string;
  docs: { label: string; url: string };
}

const CODE = /\.(jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|swift|vue|svelte)$/i;
const JS = /\.(jsx?|tsx?|mjs|cjs|vue|svelte)$/i;
/** Code, plus the template files where markup is written by hand. */
const MARKUP = /\.(jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|swift|vue|svelte|html?|erb|ejs|hbs|jinja2?|j2|twig|njk)$/i;

export const CONCEPTS: CodeConcept[] = [
  {
    id: "hardcoded-secret",
    title: "A secret written into the code",
    emoji: "🔑",
    weight: 100,
    files: null,
    patterns: [
      /\b(api[_-]?key|secret|token|passw(or)?d|private[_-]?key)\b\s*[:=]\s*["'`][A-Za-z0-9_\-+/=.]{16,}["'`]/i,
      /["'`](sk|pk|rk)[-_](live|test|proj)[-_][A-Za-z0-9]{12,}/,
      /\b(ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}/,
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /\bAKIA[0-9A-Z]{16}\b/,
      // A password inside a connection string. A `${...}` or `<placeholder>` is not one.
      /:\/\/[^/\s:@]+:[^@\s$<{/]{6,}@/,
    ],
    hook: "Your house key is now taped to the front door.",
    what: "A real credential typed straight into a source file, so everyone who can read the code can use the key.",
    lens: {
      Junior:
        "Code travels: GitHub, screenshots, chat pastes, the browser. A key inside the code goes on every one of those trips. Keys live in the environment; the code only mentions the variable's name.",
      Mid:
        "Git never forgets. Deleting the line in a later commit leaves the key in every clone, forever. Once it has been committed there is one fix: revoke it and issue a new one.",
      Senior:
        "Treat a committed credential as already stolen and rotate it. Then add the control that would have caught it — a pre-commit secret scan and push protection — because no reviewer reliably spots a forty-character string.",
    },
    pitfall:
      "You delete the line, commit, and relax. Bots that scrape public repos found the key in the history within minutes, and the bill arrives at the end of the month.",
    askTheAi: "Is this a real credential? Move it to an environment variable and tell me exactly what I need to rotate.",
    docs: { label: "OWASP: Secrets Management", url: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html" },
  },
  {
    id: "sql-interpolation",
    title: "SQL built by gluing strings together",
    emoji: "💉",
    weight: 95,
    files: CODE,
    patterns: [
      /["'`]\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"'`]*\$\{/i,
      // The same, where the value is wrapped in SQL quotes: `... VALUES ('${email}')`.
      // The quote is inside the template literal, so only the backtick ends the search.
      /`\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^`]*\$\{/i,
      /["'](SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"']*["']\s*\+/i,
      /\bf["'](SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"']*\{/i,
      /\bf"(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"]*'\{/i,
      /["'](SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"']*%s[^"']*["']\s*%/i,
      // A double-quoted query that opens an SQL quote before the value:
      // `"... WHERE name = '" + name + "'"` and `"... = '%s'" % name`. The
      // single quote belongs to the SQL, so only the double quote ends the string.
      /"(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"]*"\s*\+/i,
      /"(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"]*%s[^"]*"\s*%/i,
      // PHP joins strings with a dot.
      /["'](SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"']*["']\s*\.\s*\$\w/i,
    ],
    hook: "You just let strangers finish your sentences — and the database does whatever the sentence says.",
    what: "A database query assembled by dropping a value directly into the query text.",
    lens: {
      Junior:
        "The database cannot tell your words from the user's. If someone types a bit of SQL into your form, it runs. Placeholders (`?` or `$1`) hand the value over separately, so it can only ever be data.",
      Mid:
        "Parameterised queries send the statement and the values down separate channels. Nothing is escaped, so nothing can be forgotten. Hand-rolled escaping fails on the one input nobody imagined.",
      Senior:
        "Placeholders cover values, not identifiers: a user-chosen table or sort column still needs an allow-list. ORMs are safe right up until someone reaches for the raw-string escape hatch.",
    },
    pitfall:
      "It passes every test you write, because you never type a quote into your own form. The first person who does can read the whole users table.",
    askTheAi: "Rewrite this query with placeholders and show me which values are now passed separately.",
    docs: { label: "OWASP: SQL Injection Prevention", url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html" },
  },
  {
    id: "password-hashing",
    title: "Storing passwords as hashes",
    emoji: "🧂",
    weight: 90,
    files: CODE,
    patterns: [/\b(bcrypt|argon2|scrypt)\b/i, /\b(hashpw|hashSync|password_hash|pbkdf2)\b/],
    hook: "The best way to keep a password safe is to never actually have it.",
    what: "Passwords are stored as a one-way scramble, so the database never holds the password itself.",
    lens: {
      Junior:
        "A hash is a blender: password in, smoothie out, no way back. At login the app blends what was typed and compares smoothies. If the database leaks, the passwords are not in it.",
      Mid:
        "Password hashes are slow and salted on purpose. Slow, so a billion guesses costs real money. Salted, so two users with the same password get different hashes. A fast hash like SHA-256 is the wrong tool.",
      Senior:
        "The cost factor is yours to own: aim for about a quarter second on production hardware and raise it over time, re-hashing at login. Compare in constant time, and cap input length so hashing cannot be used to burn your CPU.",
    },
    pitfall:
      "MD5 and SHA-256 look identical in code and can be guessed billions of times a second. After a leak, most of your users' passwords are cracked before lunch.",
    askTheAi: "Which algorithm and cost factor is this using, and where does the comparison at login happen?",
    docs: { label: "OWASP: Password Storage", url: "https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html" },
  },
  {
    id: "auth-token",
    title: "Sessions and tokens",
    emoji: "🎟️",
    weight: 85,
    files: CODE,
    patterns: [
      /\bjwt\.(sign|verify|decode)\b/,
      /\b(jsonwebtoken|jose|next-auth|getServerSession|lucia|passport)\b/,
      /\bAuthorization\b.{0,20}\bBearer\b/i,
      /\bcookies\(\)\.(set|get)\b|\bres\.cookie\(|\bset_cookie\(/,
    ],
    hook: "A token is a festival wristband: whoever is wearing it gets in.",
    what: "How the server recognises that a request comes from someone who already logged in.",
    lens: {
      Junior:
        "After login the server hands the browser a wristband, and the browser shows it on every request. Whoever holds it is treated as you, so where it is kept and how long it lasts both matter.",
      Mid:
        "A JWT is signed, not encrypted: anyone can read it, and only the signature stops them editing it. `verify` checks the signature. `decode` does not — trusting a decoded token is trusting whatever the caller typed.",
      Senior:
        "A stateless token cannot be revoked before it expires, so keep access tokens short and pair them with a revocable refresh token or a server-side session. Pin the algorithm; set cookies HttpOnly, Secure and SameSite.",
    },
    pitfall:
      "The code checks that a token exists, not that it verifies. Anyone can now write their own wristband saying \"admin\" and walk straight in.",
    askTheAi: "Where is the token verified on each request, how long does it last, and how would I log a user out everywhere?",
    docs: { label: "OWASP: Session Management", url: "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html" },
  },
  {
    id: "input-validation",
    title: "Validating input at the door",
    emoji: "🚪",
    weight: 80,
    files: CODE,
    patterns: [
      /\bz\.(object|string|number|array|enum|coerce)\(/,
      /\b(safeParse|parseAsync)\(/,
      /\b(Joi|yup)\.(object|string|number)\(/,
      /\bclass \w+\(BaseModel\)/,
    ],
    hook: "Every form field is a stranger at the door. This is the bouncer.",
    what: "Checking that data arriving from outside has the shape the code expects before anything uses it.",
    lens: {
      Junior:
        "Anything from a form, a URL or another service can be missing, misspelled or malicious. A schema says what is allowed, and whatever does not fit is turned away at the door with a clear message.",
      Mid:
        "TypeScript types vanish when the code runs, so a type on a request body is a wish, not a check. A runtime schema is what makes the type true — and the parsed value is the only one the rest of the code should touch.",
      Senior:
        "Validate once at the trust boundary and pass parsed values inward, instead of re-checking in every layer. Browser validation is a courtesy; the server repeats it, because the client belongs to the caller.",
    },
    pitfall:
      "The form checks everything beautifully. Then someone skips the form, calls the API directly, and sends a price of minus one.",
    askTheAi: "Which inputs to this endpoint are validated on the server, and what happens to a request that fails?",
    docs: { label: "OWASP: Input Validation", url: "https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html" },
  },
  {
    id: "env-vars",
    title: "Environment variables",
    emoji: "🌱",
    weight: 75,
    files: null,
    patterns: [
      /\bprocess\.env\.[A-Z_]{2,}/,
      /\bimport\.meta\.env\.[A-Z_]{2,}/,
      /\bos\.(environ|getenv|Getenv|LookupEnv)\b/,
      /\benv::var\(|\$_ENV\[|\bgetenv\(/,
      /\bENV\[["'][A-Z_]+["']\]/,
      /\bDeno\.env\.get\(/,
    ],
    hook: "Same code, different costume: this is how your app knows whether it is on your laptop or live.",
    what: "Settings the program reads from its surroundings when it starts, rather than from its own source code.",
    lens: {
      Junior:
        "The same code runs on your laptop and on a server, but the database address and the keys differ. Each place supplies its own values. Locally they usually come from a `.env` file that is never committed.",
      Mid:
        "They are read once, at startup, so editing `.env` needs a restart. And in frontend frameworks, anything with a public prefix (`NEXT_PUBLIC_`, `VITE_`) is copied into the JavaScript sent to every browser. Not secret. At all.",
      Senior:
        "Validate the whole environment at startup and fail loudly, rather than meeting `undefined` in a request an hour later. Build-time and run-time variables differ: a value inlined at build is frozen into the artefact.",
    },
    pitfall:
      "A missing variable is not an error, it is just `undefined`. The app starts happily and falls over later, somewhere that looks completely unrelated.",
    askTheAi: "List every environment variable this code reads, which ones are secret, and which end up in the browser.",
    docs: { label: "The Twelve-Factor App: Config", url: "https://12factor.net/config" },
  },
  {
    id: "cors",
    title: "CORS",
    emoji: "🛂",
    weight: 70,
    files: null,
    patterns: [
      /\bAccess-Control-Allow-(Origin|Credentials|Headers)\b/i,
      /\bcors\(|\bcors\.(New|Default|AllowAll)\(/,
      /\bCORSMiddleware\b|@CrossOrigin\b/,
    ],
    hook: "The most-googled error in web development is the browser doing its job.",
    what: "The rule a server publishes about which other websites' pages may read its responses in a browser.",
    lens: {
      Junior:
        "Browsers stop a page on one site from reading data from another, unless that other site says it is fine. CORS headers are the server saying so. The browser is the one enforcing it.",
      Mid:
        "CORS loosens the browser's same-origin rule; it does not protect the API. curl ignores it completely. And a wildcard origin cannot be combined with credentials, which is why \"just allow everything\" stops working once cookies are involved.",
      Senior:
        "Echoing the request's Origin back while allowing credentials makes every website an authorised caller of your API as the logged-in user. Allow-list exact origins, and remember preflight responses are cached.",
    },
    pitfall:
      "You set the origin to `*` to make the red error go away. Now any website your user visits can read your API's responses from their browser.",
    askTheAi: "Which origins does this allow, does it allow credentials, and why is each origin on the list?",
    docs: { label: "MDN: Cross-Origin Resource Sharing", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS" },
  },
  {
    id: "client-server-boundary",
    title: "Server code versus browser code",
    emoji: "🧱",
    weight: 70,
    files: JS,
    patterns: [/^\s*["']use (client|server)["'];?\s*$/, /\bgetServerSideProps\b|\bserver-only\b/],
    hook: "Half of this app runs on your computer. The other half you hand to strangers.",
    what: "The line between code that runs on your server and code that is downloaded and run in the visitor's browser.",
    lens: {
      Junior:
        "Some of this app runs on a machine you control, and some is sent to every visitor. Anything sent to the browser can be read by the visitor, so secrets and database access stay on the server's side of the line.",
      Mid:
        "`\"use client\"` marks a file — and everything it imports — as shipped to the browser. Server components can fetch data and hold secrets but cannot use state or click handlers. Only serialisable props cross the line.",
      Senior:
        "A server action is a public endpoint wearing friendly syntax: it needs the same authentication, authorisation and validation as any API route. Push the client boundary down the tree to keep the bundle small.",
    },
    pitfall:
      "A client file imports a server helper \"just for one function\". The bundler ships the helper, and the key it references, to every visitor's browser.",
    askTheAi: "Which parts of this feature run in the browser, and is there anything on that side that should be private?",
    docs: { label: "Next.js: Server and Client Components", url: "https://nextjs.org/docs/app/getting-started/server-and-client-components" },
  },
  {
    id: "db-schema",
    title: "Database schema and migrations",
    emoji: "🏗️",
    weight: 65,
    files: null,
    patterns: [
      /\b(CREATE|ALTER|DROP)\s+TABLE\b/i,
      /^\s*model\s+\w+\s*\{/,
      /\b(pgTable|sqliteTable|mysqlTable)\(/,
      /\b(add_column|create_table|op\.add_column|op\.create_table)\b/,
      /\bclass \w+\(models\.Model\)/,
    ],
    hook: "Code you can rewrite on a whim. Data remembers everything you ever did to it.",
    what: "The declared shape of the stored data, and the ordered steps that change that shape over time.",
    lens: {
      Junior:
        "A table is a spreadsheet with fixed columns. A migration is a recorded change to those columns, so every copy of the database — yours and production's — reaches the same shape by replaying the same steps.",
      Mid:
        "Migrations run against real rows, not an empty database. A new required column fails on a table that already has data unless it has a default. Applied migrations are history: change things with a new one, never by editing an old one.",
      Senior:
        "Deploys are not atomic: old code runs against the new schema for a while. Change in compatible steps (add, backfill, switch, remove), and know which statements take a lock that blocks writes on a big table.",
    },
    pitfall:
      "You tidy up a migration that already ran. Your database and everyone else's now disagree about the past, and the next deploy fails in a way nobody can trace.",
    askTheAi: "What does this change do to rows that already exist, and how would I undo it?",
    docs: { label: "Prisma: Migrations mental model", url: "https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/mental-model" },
  },
  {
    id: "api-route",
    title: "An API endpoint",
    emoji: "📮",
    weight: 60,
    files: CODE,
    patterns: [
      /\bexport\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/,
      /\b(app|router)\.(get|post|put|patch|delete)\(\s*["'`]\//,
      /@(app|router|bp|api|blueprint)\.(get|post|put|patch|delete|route)\(/,
      // NestJS and Spring name the method in a decorator.
      /^\s*@(Get|Post|Put|Patch|Delete)\(|@(Get|Post|Put|Patch|Delete|Request)Mapping\b/,
      /\bhttp\.HandleFunc\(|\b(r|router|e|g|mux)\.(GET|POST|PUT|PATCH|DELETE)\(\s*"/,
      /\bNextResponse\.json\(|\bres\.status\(\d+\)/,
    ],
    hook: "You just opened a door onto the internet. Doors do not check who is knocking.",
    what: "A function the server runs when a request arrives at a particular address with a particular method.",
    lens: {
      Junior:
        "The frontend asks, the endpoint answers. The method says what kind of ask: GET reads, POST creates, PUT or PATCH changes, DELETE removes. The status code in the reply says how it went.",
      Mid:
        "An endpoint is public the moment it deploys; hiding the button that calls it hides nothing. Every handler answers for itself: who is calling, are they allowed, is the input valid.",
      Senior:
        "GET must be safe to repeat, and writes idempotent wherever a retry is possible, because networks retry. Settle the error contract once, with status codes that mean what they say.",
    },
    pitfall:
      "The handler returns 200 with `{ error: \"failed\" }` in the body. Every client, retry and dashboard reads that as success, and the failures pile up unseen.",
    askTheAi: "Who is allowed to call this endpoint, where is that checked, and what does it return when something fails?",
    docs: { label: "MDN: HTTP request methods", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods" },
  },
  {
    id: "react-effect",
    title: "React effects",
    emoji: "🌀",
    weight: 60,
    files: JS,
    patterns: [/\buse(Layout)?Effect\(/],
    hook: "The most over-used hook in React, and the number one cause of \"why is this running forever\".",
    what: "Code that React runs after rendering, to connect a component to something outside React.",
    lens: {
      Junior:
        "An effect runs after the component shows up on screen. The list at the end (the dependency array) says when to run it again: empty means once, listed values mean whenever one of them changes.",
      Mid:
        "Dependencies are compared by identity, so an object or function created during render is brand new every time and re-runs the effect forever. Return a cleanup for anything you start: timers, subscriptions, requests.",
      Senior:
        "Most effects should not exist. Deriving state, reacting to an event and fetching data all have better homes (render, the handler, a data library). Keep effects for real synchronisation with an outside system.",
    },
    pitfall:
      "The effect sets state it also depends on. Render, effect, set state, render, effect… the tab freezes and your API gets a thousand requests a minute.",
    askTheAi: "What outside thing is this effect synchronising with, and could it be done without an effect?",
    docs: { label: "React: You Might Not Need an Effect", url: "https://react.dev/learn/you-might-not-need-an-effect" },
  },
  {
    id: "error-handling",
    title: "Handling failure",
    emoji: "🪂",
    weight: 60,
    files: CODE,
    patterns: [
      /\bcatch\s*(\(|\{)/,
      /\.catch\(/,
      /^\s*except\b.*:/,
      /\bthrow\s+new\s+\w*Error\(/,
      /^\s*raise\s+\w+/,
      /\bif err != nil\b/,
      /^\s*rescue\b/,
    ],
    hook: "The happy path is a demo. This is the part that decides what Monday looks like.",
    what: "The code that decides what happens when an operation does not succeed.",
    lens: {
      Junior:
        "Things fail: the network drops, a file is missing. `try` says \"attempt this\", `catch` says what to do when it goes wrong. Good handling tells the user something useful and writes down what happened.",
      Mid:
        "Catch an error only where you can do something about it; otherwise let it travel up to somewhere that can. An empty catch block does not handle the error. It destroys the evidence.",
      Senior:
        "Separate expected failures (bad input, not found) from bugs. The first are part of the interface and deserve specific responses; the second should surface loudly with context. Never return internal error text to a caller.",
    },
    pitfall:
      "The catch logs the error and carries on. The user sees a green tick, nothing was saved, and you find out three weeks later from an angry email.",
    askTheAi: "For each catch here, what does the user see, and what gets recorded so I can find the cause later?",
    docs: { label: "MDN: Control flow and error handling", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Control_flow_and_error_handling" },
  },
  {
    id: "browser-storage",
    title: "Storing data in the browser",
    emoji: "🗄️",
    weight: 60,
    files: JS,
    patterns: [/\b(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(/],
    hook: "A sticky note on the visitor's own fridge: handy, and they can rewrite it whenever they like.",
    what: "A small key-value store the browser keeps for a site on the visitor's own device.",
    lens: {
      Junior:
        "It survives a reload, which makes it great for preferences. It lives on one device in one browser, holds only strings, and the visitor can open developer tools and read or edit it.",
      Mid:
        "Every script on the page can read it, including a third-party one or one injected through a cross-site scripting bug. That is why session tokens are safer in an HttpOnly cookie, which scripts cannot see.",
      Senior:
        "It is synchronous, absent during server rendering, can throw in private modes, and is capped at a few megabytes. Wrap access, version the stored shape, and never trust what comes back.",
    },
    pitfall:
      "It works locally, then the page crashes on the server with \"localStorage is not defined\" — because the server has no browser, and so no fridge.",
    askTheAi: "What exactly is stored here, and what happens if it is missing, out of date, or edited by the user?",
    docs: { label: "MDN: Web Storage API", url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API" },
  },
  {
    id: "react-state",
    title: "React state",
    emoji: "🧠",
    weight: 55,
    files: JS,
    patterns: [/\buse(State|Reducer)\b\s*(<[^>]*>)?\(/],
    hook: "Components have amnesia. State is the one thing they are allowed to remember.",
    what: "A value a component remembers between renders, where changing it makes React draw the component again.",
    lens: {
      Junior:
        "An ordinary variable resets every time the component function runs. State survives. Calling the setter is what tells React something changed; assigning to the variable directly changes nothing on screen.",
      Mid:
        "Setting state does not change the variable in the code that is running; it books a new render with the new value. That is why reading state straight after setting it gives the old value.",
      Senior:
        "Keep the minimum state and compute the rest during render: duplicated state drifts. Lift it to the nearest common owner, and treat it as immutable, because React decides whether to re-render by comparing references.",
    },
    pitfall:
      "You push onto the array and call the setter with the same array. React compares, sees the same reference, shrugs, and the screen stays stale.",
    askTheAi: "Which component owns this state, and is any of it something that could be calculated instead of stored?",
    docs: { label: "React: State, a component's memory", url: "https://react.dev/learn/state-a-components-memory" },
  },
  {
    id: "async-await",
    title: "Asynchronous code",
    emoji: "⏳",
    weight: 55,
    files: CODE,
    patterns: [
      /\bawait\s+\w/,
      /\basync\s+(function|def|\(|\w+\s*=>)/,
      /\bPromise\.(all|allSettled|race)\(/,
      // Rust writes it after the call: `client.get(url).send().await?`.
      /\)\.await\b/,
    ],
    hook: "Ordering coffee: you get a buzzer, not a coffee. `await` is standing there until it buzzes.",
    what: "Code that starts something slow, such as a network request, and continues when the answer arrives.",
    lens: {
      Junior:
        "Asking a server takes time. `await` pauses this function until the answer is back, while the rest of the program keeps going. Without it you are holding a promise — the buzzer — not the value.",
      Mid:
        "Awaits in a row queue up, so three independent requests take the sum of their times. Start them together with `Promise.all` and they take only as long as the slowest.",
      Senior:
        "`Promise.all` rejects on the first failure and leaves the rest running unobserved; use `allSettled` when partial results matter. Anything awaited without a timeout can hang for as long as the other side likes.",
    },
    pitfall:
      "A missing `await` is not an error. The code strolls on holding a promise, the save fails in the background, and nothing ever catches it.",
    askTheAi: "Which of these awaits depend on each other, and which could run at the same time?",
    docs: { label: "MDN: async function", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function" },
  },
  {
    id: "dependency-added",
    title: "A new dependency",
    emoji: "📦",
    weight: 55,
    files: /(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Gemfile|go\.mod|Cargo\.toml)$/,
    patterns: [
      // The project's own `"version": "1.0.0"` has the same shape and is not a dependency.
      /^\s*"(?!version")[@\w][\w./-]*"\s*:\s*"[\^~]?\d+\.\d+/,
      /^[A-Za-z][\w.-]*\s*(==|>=|~=)\s*\d/,
      /^\s*gem\s+["']\w/,
      /^\s*(?!version\b)[\w-]+\s*=\s*["'][\^~>=<]*\d+\.\d+/,
      // Cargo's table form, and a PEP 621 dependency list in pyproject.toml.
      /^\s*[\w-]+\s*=\s*\{\s*version\s*=/,
      /^\s*["'][A-Za-z][\w.-]*(\[[\w,-]+\])?\s*(==|>=|~=)\s*\d/,
      // go.mod: a module path and a version, with or without a leading `require`.
      /^\s*(require\s+)?[\w.-]+\.[a-z]{2,}\/[\w./-]+\s+v\d+\.\d+/,
    ],
    hook: "You just invited a stranger's code to live in your app — along with all of its friends.",
    what: "Someone else's code that this project now downloads and runs as part of itself.",
    lens: {
      Junior:
        "A package saves you writing something yourself. It also means your app now contains code you have not read, plus everything that package depends on. The lock file records exact versions so everyone gets the same ones.",
      Mid:
        "`^1.2.3` accepts any 1.x release, so installing on another day can bring different code. The lock file pins it, and it belongs in git. Check a package is maintained and widely used before taking it on.",
      Senior:
        "Every dependency is supply-chain exposure and a future upgrade bill. Install scripts run with your privileges. For something small, prefer the platform or ten lines of your own.",
    },
    pitfall:
      "AI assistants sometimes invent a package name that sounds right. Attackers register those names. You run install, and their code runs on your machine.",
    askTheAi: "Why this package rather than what is already installed, and is it actively maintained?",
    docs: { label: "npm: About semantic versioning", url: "https://docs.npmjs.com/about-semantic-versioning" },
  },
  {
    id: "orm-query",
    title: "Database queries through a client library",
    emoji: "🛒",
    weight: 50,
    files: CODE,
    patterns: [
      /\bprisma\.\w+\.(findMany|findUnique|findFirst|create|update|delete|upsert)\(/,
      /\bsupabase\s*\.from\(/,
      /\.(objects\.(filter|get|all)|query\(\w+\)\.filter)\(/,
      /\bdb\.(select|insert|update|delete)\(/,
      // Model classes are capitalised: `User.findOne(...)`, `Order.find_by(...)`.
      /\b[A-Z]\w+\.(findOne|findById|findByPk|findAll|find_by|where)\(|\.query\.filter_by\(/,
    ],
    hook: "Every one of these calls is a drive to the shop. The question is how many trips you are making.",
    what: "Code that reads or writes the database through a library instead of hand-written SQL.",
    lens: {
      Junior:
        "The library turns a function call into a database query and the rows back into objects. Each call is a trip across the network — far slower than anything happening in memory.",
      Mid:
        "A query inside a loop is the classic N+1: one trip for the list, then one more per item. Ask for related data in the same query (`include`, a join) and select only the columns you use.",
      Senior:
        "The library hides the SQL, not its cost. Log the generated queries, check filters hit an index, paginate anything unbounded, and wrap multi-step writes in a transaction.",
    },
    pitfall:
      "No limit on the query. Lovely with ten test rows; with real data it loads the entire table into memory and the server falls over.",
    askTheAi: "How many database queries does this page make, and what happens when this table has a million rows?",
    docs: { label: "Prisma: Query optimization", url: "https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance" },
  },
  {
    id: "http-fetch",
    title: "Calling another service over HTTP",
    emoji: "📡",
    weight: 50,
    files: CODE,
    patterns: [
      // The global function, not a method that shares its name: `Rails.cache.fetch(...)` is a cache read.
      /(?<![.\w])fetch\(\s*["'`(\w]|\b(window|globalThis|self)\.fetch\(/,
      /\baxios\.(get|post|put|patch|delete)\(|\baxios\(/, /\b(requests|httpx)\.(get|post|put|delete)\(/, /\bhttp\.(Get|Post)\(/],
    hook: "A reply arriving and a request succeeding are two different things.",
    what: "Code that sends a request to another server and uses what comes back.",
    lens: {
      Junior:
        "The code asks an address for data and waits. The reply has a status (did it work?) and a body (the data). Both need looking at.",
      Mid:
        "`fetch` only rejects when the network itself fails. A 404 or 500 resolves normally, so without checking `response.ok` the code will happily treat an error page as data.",
      Senior:
        "Every outbound call needs a timeout, a retry policy (only for requests safe to repeat, with backoff) and a plan for the dependency being down. The response is untrusted input: validate it.",
    },
    pitfall:
      "Nobody checks the status. A failed request gets parsed as real data, and the bug surfaces later as `undefined` three files away from the cause.",
    askTheAi: "What happens here if this request is slow, returns an error status, or returns something unexpected?",
    docs: { label: "MDN: Using the Fetch API", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch" },
  },
  {
    id: "tests",
    title: "Automated tests",
    emoji: "🧪",
    weight: 50,
    files: CODE,
    patterns: [/\b(describe|it|test)\(\s*["'`]/, /\bexpect\(.+\)\.(to|not)\w*/, /^\s*def test_\w+\(/, /\bassert\.(equal|ok|deepEqual|strictEqual|throws)\(/, /^func Test\w+\(t \*testing\.T\)/, /^\s*#\[(tokio::)?test\]/, /\bself\.assert[A-Z]\w+\(/],
    hook: "A test that cannot fail is a smoke alarm with no battery.",
    what: "Code whose only job is to run other code and check that it still does what it should.",
    lens: {
      Junior:
        "A test calls a function with known input and checks the answer. Once written, it re-checks that answer on every change, which is how you learn a change broke something before a user does.",
      Mid:
        "See it fail first — break the code on purpose — and assert on behaviour a user would notice, not on how the code happens to be arranged inside.",
      Senior:
        "Generated tests tend to restate the implementation, so they pass by construction and lock bugs in. Ask what would have to be wrong for each to fail. Heavy mocking tests the mock.",
    },
    pitfall:
      "The AI writes the code, then writes tests from the code. Everything is green, the logic is wrong, and now the bug has a test defending it.",
    askTheAi: "Break the code on purpose and show me this test failing, so I know it checks something.",
    docs: { label: "Node.js: Test runner", url: "https://nodejs.org/api/test.html" },
  },
  {
    id: "gitignore",
    title: "What git is told to ignore",
    emoji: "🙈",
    weight: 50,
    files: /(^|\/)\.gitignore$/,
    patterns: [/^\s*[^#\s].*$/],
    hook: "The guest list for your repository: who is not getting in.",
    what: "A list of files and folders git should never start tracking.",
    lens: {
      Junior:
        "Some files do not belong in the repository: downloaded packages, build output, and files holding secrets like `.env`. Listing them here keeps them out when you `git add .`.",
      Mid:
        "It only affects files git is not already tracking. A file committed before the rule existed stays tracked until you remove it from the index with `git rm --cached`.",
      Senior:
        "Ignore rules prevent accidents; they are not a security control and do nothing for history. Keep editor noise in a global ignore file, and commit lock files rather than ignoring them.",
    },
    pitfall:
      "You add `.env` to the list after committing it. Git keeps tracking the file anyway, and the secrets are still sitting in the history.",
    askTheAi: "Is anything that should be ignored already tracked in this repository?",
    docs: { label: "Git: gitignore", url: "https://git-scm.com/docs/gitignore" },
  },
  {
    id: "type-escape",
    title: "Switching the type checker off",
    emoji: "🔇",
    weight: 45,
    files: /\.tsx?$/i,
    patterns: [/:\s*any\b/, /\bas\s+any\b/, /@ts-(ignore|expect-error|nocheck)/, /\bas\s+unknown\s+as\b/, /\b(Record<\w+,\s*any>|Array<any>|Promise<any>)/],
    hook: "Tape over the check-engine light. The dashboard looks great now.",
    what: "A place where the code tells TypeScript to stop checking, usually to make an error go away.",
    lens: {
      Junior:
        "TypeScript warns you before the code runs when something does not fit. `any` means \"do not check this\". The warning disappears; the mistake it was pointing at is still there, waiting for a real user.",
      Mid:
        "`any` spreads: everything computed from an `any` value is unchecked too. `unknown` is the honest alternative, because it forces a check before use. An `as` cast is a claim the compiler takes on trust.",
      Senior:
        "Escape hatches are fair at boundaries with untyped data, paired with runtime validation and kept to one line. Count them: a rising number of `any` is the type system being switched off quietly.",
    },
    pitfall:
      "The AI hit a type error, could not fix it, and wrote `as any`. That error was the compiler finding a real bug — which now ships.",
    askTheAi: "What was the type error this is hiding, and what would the properly typed version look like?",
    docs: { label: "TypeScript: any", url: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#any" },
  },
  {
    id: "container-image",
    title: "A container image recipe",
    emoji: "🐳",
    weight: 45,
    files: /(^|\/)(Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml)$/i,
    patterns: [/^\s*(FROM|RUN|COPY|ENTRYPOINT|CMD|EXPOSE)\s+\S/, /^\s*(image|build|ports|volumes)\s*:/],
    hook: "\"It works on my machine\" — so we ship the machine.",
    what: "The list of steps that builds a self-contained package of an app together with everything it needs to run.",
    lens: {
      Junior:
        "A Dockerfile is a recipe: start from a base system, copy the code in, install what it needs, say how to start it. The result runs the same way anywhere Docker runs.",
      Mid:
        "Each instruction makes a cached layer, and a change throws away every layer after it. Copy the dependency manifest and install before copying the source, so editing code does not reinstall the world.",
      Senior:
        "Use multi-stage builds so compilers stay out of the final image, pin the base by digest, run as non-root, and keep secrets out of layers: anything copied in can be recovered even if a later step deletes it.",
    },
    pitfall:
      "`COPY . .` with no `.dockerignore` bakes your local `.env` into the image. Everyone who pulls it gets your keys as a free gift.",
    askTheAi: "What ends up inside this image, and which user does the app run as?",
    docs: { label: "Docker: Building best practices", url: "https://docs.docker.com/build/building/best-practices/" },
  },
  {
    id: "css-layout",
    title: "Layout with flexbox and grid",
    emoji: "📐",
    weight: 35,
    files: /\.(css|scss|jsx|tsx|vue|svelte|html)$/i,
    patterns: [
      /\bdisplay\s*:\s*["']?(flex|grid)\b/,
      /\bclass(Name)?=["'`{][^"'`]*\b(flex|grid)\b[^"'`]*\b(items-|justify-|gap-|grid-cols-|flex-col)/,
    ],
    hook: "Centering a div: a rite of passage, finally solved by these two.",
    what: "The two CSS systems for arranging elements: flexbox along one line, grid across rows and columns.",
    lens: {
      Junior:
        "Flexbox lines children up in a row or a column and shares out the space. Grid places them in rows and columns at once. You set the layout on the parent; the children follow.",
      Mid:
        "Flex has a main axis and a cross axis, and they swap when the direction changes: `justify` works along the main one, `align` across it. Flex children refuse to shrink below their content unless given `min-width: 0`.",
      Senior:
        "Choose by who is in charge: grid when the container defines the tracks, flex when the content sizes itself. Prefer `gap` to margins, and intrinsic sizing (`minmax`, `auto-fit`) to breakpoints.",
    },
    pitfall:
      "One long word in a flex child and the whole row bursts out of its container on phones, because flex items will not shrink below their content.",
    askTheAi: "Which element is the layout container here, and what happens to this layout on a narrow phone screen?",
    docs: { label: "MDN: CSS layout", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout" },
  },
  {
    id: "xss-html-injection",
    title: "Raw HTML put into the page",
    emoji: "🎭",
    weight: 92,
    files: MARKUP,
    patterns: [
      /\bdangerouslySetInnerHTML\b/,
      // Assignment only, and not the `el.innerHTML = ""` idiom for emptying an element.
      /\.(innerHTML|outerHTML)\s*\+?=(?!=)(?!\s*(""|''|``)\s*;?\s*$)/,
      /\.insertAdjacentHTML\(/,
      /\bdocument\.write(ln)?\(/,
      /\bv-html\s*=/,
      /\{@html\s/,
      /\{\{[^}]*\|\s*safe\b/,
      /\bmark_safe\(|\.html_safe\b|<%=\s*raw\b/,
      /\[innerHTML\]\s*=/,
      // jQuery's `.html(value)`. With no argument it reads, which is harmless.
      /\$\([^)]*\)\.html\(\s*[^)\s]/,
      /\becho\s+\$_(GET|POST|REQUEST)\b/,
      /\{\{\{\s*[\w.]+\s*\}\}\}/,
    ],
    hook: "You handed a stranger a pen and let them write on your page, in your handwriting.",
    what: "Text is being inserted into the page as live HTML, so any markup inside it is built and run by the browser.",
    lens: {
      Junior:
        "Normally a framework shows text as text: type `<b>` and you see `<b>`. This switches that off. If any part of the string came from a user, they can add their own script, and it runs for everyone who opens the page.",
      Mid:
        "Injected script runs with the page's full rights: it reads the session, calls your API as the visitor, rewrites the form they are typing into. Escaping by default is the protection, and this line is the opt-out. Sanitise with a real library, never a regex.",
      Senior:
        "Sanitise at output, for the context it lands in: HTML, attribute and URL each have different rules. Add a Content-Security-Policy as the second wall, and treat stored rich text as hostile every time it is rendered, not only when it was saved.",
    },
    pitfall:
      "You render a user's bio as HTML so the line breaks show. Someone saves a bio with a script in it, and every visitor to their profile quietly sends them a session.",
    askTheAi: "Where does this HTML string come from, could a user have written any part of it, and what sanitises it?",
    docs: { label: "OWASP: Cross Site Scripting Prevention", url: "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html" },
  },
  {
    id: "file-upload",
    title: "Accepting files from users",
    emoji: "📎",
    weight: 80,
    files: MARKUP,
    patterns: [
      /\b(multer|formidable|busboy)\s*\(|["'](multer|formidable|busboy|express-fileupload|uploadthing[\w/]*|@uploadthing\/[\w-]+)["']/,
      /\bupload\.(single|array|fields|any)\(/,
      /\b(UploadFile|FileField|ImageField|FileStorage|MultipartFile|IFormFile)\b/,
      /\b(req|request)\.files?\b|\brequest\.FILES\b|\$_FILES\b/,
      /\btype=\{?["']file["']/,
      /\bformData\.get(All)?\(\s*["'](file|files|image|avatar|upload|attachment|photo|document)s?["']\s*\)/i,
      /\.get(All)?\([^)]*\)\s+as\s+File\b|\binstanceof\s+File\b/,
      /\b(target|currentTarget|input)\.files\b|\buseDropzone\(/,
      /\.FormFile\(|->file\(\s*["']|\bhas_(one|many)_attached\b/,
      /\b(createPresignedPost|generate_presigned_post|createSignedUploadUrl|PutObjectCommand)\b/,
      /\bgenerate_presigned_url\(\s*["']put_object["']/,
      /\.storage\s*\.from\([^)]*\)\s*\.upload\(/,
      /\bmultipart\/form-data\b/,
    ],
    hook: "A text box takes words. This takes anything at all, in any size, with any name.",
    what: "The app now receives whole files chosen by a visitor and has to decide where to put them and what to trust about them.",
    lens: {
      Junior:
        "A file arrives with a name, a type and contents, and the sender controls all three. The server decides the size limit, which types are welcome and where the file is stored. The form's own checks are only a hint.",
      Mid:
        "The declared type is a label the sender wrote. Check the real content, cap the size before reading the body, and store under a name you generate, outside any folder the web server will run or serve as a page.",
      Senior:
        "Prefer direct-to-storage uploads with a short-lived signed URL, so large bodies never pass through the app. Pin the size and content type in the signature, serve from a separate origin, and scan or re-encode before anyone else can fetch the file.",
    },
    pitfall:
      "The form only offers images, so nobody checks on the server. Someone posts a four-gigabyte file straight to the endpoint, the disk fills, and the whole site goes down with it.",
    askTheAi: "What limits the size and type of an upload on the server, where is the file stored, and what name is it stored under?",
    docs: { label: "OWASP: File Upload", url: "https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html" },
  },
  {
    id: "webhook",
    title: "A webhook: another service calling you",
    emoji: "🪝",
    weight: 78,
    files: CODE,
    patterns: [
      /\bconstruct_?[eE]vent(Async)?\(/,
      /\bnew\s+Webhook\(|["']svix["']|\bfrom\s+svix\b|\bsvix-(id|signature|timestamp)\b/,
      /["'](stripe-signature|x-hub-signature(-256)?|x-shopify-hmac-sha256|x-slack-signature|x-twilio-signature|x-webhook-signature)["']/i,
      /\b[A-Z][A-Z0-9_]*WEBHOOK_(SIGNING_)?(SECRET|KEY)\b/,
      // A route path, or a handler named for the job. A variable holding an
      // outgoing webhook URL is the opposite direction and is left alone.
      /\.(post|route|all)\(\s*["'`]\/[\w/-]*webhooks?\b/i,
      /\b(function|def|func)\s+\w*[wW]ebhook\w*/,
      /\b(verify|validate)_?[wW]ebhook\w*\(|\bwebhooks?\.(verify|constructEvent|unwrap)\(/,
    ],
    hook: "A doorbell anyone can ring. The signature is how you know it was the postman.",
    what: "An endpoint that another company's servers call to tell this app something happened, such as a payment going through.",
    lens: {
      Junior:
        "Instead of asking a service over and over whether the payment is done, you give it an address and it calls you. That address is public, so the service signs each call with a shared secret and the code checks the signature first.",
      Mid:
        "The signature is computed over the exact bytes that were sent. Parse the body as JSON first and the bytes change, so verification fails: read the raw body, verify, then parse. Reply 2xx quickly; a slow handler is treated as a failure and retried.",
      Senior:
        "Delivery is at least once and in no promised order. Record event ids to drop duplicates, fetch current state rather than trusting an old payload, reject stale timestamps to stop replays, and hand the real work to a queue so the reply stays fast.",
    },
    pitfall:
      "The handler trusts whatever arrives. Someone finds the URL, posts a hand-written \"payment succeeded\" for their own order, and the app ships it for free.",
    askTheAi: "Where is the signature on this webhook verified, against which secret, and what happens if the same event arrives twice?",
    docs: { label: "Stripe: Receive events in your webhook endpoint", url: "https://docs.stripe.com/webhooks" },
  },
  {
    id: "db-transaction",
    title: "A database transaction",
    emoji: "🤝",
    weight: 75,
    files: /\.(jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|swift|sql)$/i,
    patterns: [
      /\b(BEGIN|START)\s+TRANSACTION\b/,
      /^\s*(BEGIN|COMMIT|ROLLBACK)(\s+TRANSACTION)?\s*;/i,
      // Upper case only: `["commit"]` is an argument to git far more often than it is SQL.
      /["'`]\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*["'`]/,
      /(\.|::)\$?transaction\s*\(|\.transaction\s+do\b/,
      /\btransaction\.atomic\b|\bwith\s+[\w.]+\.begin(_nested)?\(/,
      /@Transactional\b/,
      /\b(BeginTx|beginTransaction|startTransaction|start_transaction|begin_transaction|withTransaction)\s*\(/,
      /\b(conn|connection|session|db|tx|trx|client)\w*\.(commit|rollback)\(/,
    ],
    hook: "Money leaves one account and never arrives in the other. This is the thing that prevents that.",
    what: "A group of database writes that either all take effect or none do, even if the program stops halfway through.",
    lens: {
      Junior:
        "Some changes only make sense together: take stock away and create the order. A transaction wraps them, so if the second step fails the first is undone and the data never sits half-changed.",
      Mid:
        "Only queries sent through the transaction's own handle belong to it; one sent through the ordinary client commits by itself. Keep the block short and never wait on a network call inside it, because it holds locks and a connection the whole time.",
      Senior:
        "Atomic is not the same as isolated. At the default level two transactions can both read a balance and both spend it. Choose the isolation level or lock the row on purpose, expect serialisation failures, and make the whole block safe to retry.",
    },
    pitfall:
      "Order saved, then the payment call throws. With no transaction the order row stays, the customer sees an error, tries again, and now there are two orders and one very confused support inbox.",
    askTheAi: "Which writes here must succeed or fail together, and is every one of them sent through the transaction?",
    docs: { label: "PostgreSQL: Transactions", url: "https://www.postgresql.org/docs/current/tutorial-transactions.html" },
  },
  {
    id: "rate-limiting",
    title: "Rate limiting",
    emoji: "🚦",
    weight: 70,
    files: CODE,
    patterns: [
      /\b(rateLimit|rate_limit|ratelimit|throttle|slowDown)\s*\(/,
      /\bnew\s+(Ratelimit|RateLimiter\w*|Bottleneck)\(|\brate\.NewLimiter\(/,
      /\bRatelimit\.(slidingWindow|fixedWindow|tokenBucket)\(|\b\w*[rR]ate_?[lL]imit\w*\.(limit|check|consume)\(/,
      /["'](express-rate-limit|rate-limiter-flexible|@upstash\/ratelimit|@nestjs\/throttler|bottleneck)["']/,
      /\b(slowapi|flask_limiter|django_ratelimit)\b/,
      /@(limiter\.limit|ratelimit|Throttle|throttle|RateLimiter)\(/,
      /\b(throttle_classes|ThrottlerGuard|ThrottlerModule|UserRateThrottle|AnonRateThrottle)\b/,
      /["']throttle:\d+/,
      /["'](X-RateLimit-(Limit|Remaining|Reset)|Retry-After)["']/i,
    ],
    hook: "Without this, the only thing between your login form and a million guesses is the attacker's patience.",
    what: "A cap on how many times one caller may do something within a stretch of time, with the extra attempts turned away.",
    lens: {
      Junior:
        "A person signs in a few times a day. A script can try ten thousand passwords a minute. A limit lets through what a person would do and refuses the rest, usually with status 429, \"too many requests\".",
      Mid:
        "What you count by matters. Per IP address punishes a whole office behind one router and is dodged by rotating addresses; per account lets one attacker lock a victim out. Sensitive routes usually need both, and a `Retry-After` header for honest clients.",
      Senior:
        "A counter in process memory resets on deploy and multiplies with every instance, so keep it in a shared store. Behind a proxy the client address comes from a forwarded header that is only trustworthy when your own proxy set it.",
    },
    pitfall:
      "The endpoint that calls a paid AI model has no limit. One visitor writes a loop, runs it overnight, and you wake up to a four-figure bill for answers nobody read.",
    askTheAi: "What is being counted here (address, user, key), where is the count stored, and which endpoints still have no limit?",
    docs: { label: "MDN: 429 Too Many Requests", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429" },
  },
  {
    id: "caching",
    title: "Caching",
    emoji: "🧊",
    weight: 60,
    files: CODE,
    patterns: [
      /\bredis\w*\.(get|set|setex|getex|mget|hget|hset|expire)\(/i,
      // A thing called cache being read or written. `cached` on its own is just a name.
      /\b\w*[cC]ache(\.|::)(get|set|put|setex|remember|get_or_set|fetch|wrap|invalidate)\(/,
      /\b(revalidatePath|revalidateTag|unstable_cache)\(|\bexport\s+const\s+revalidate\s*=|\brevalidate:\s*\d+|["']use cache["']/,
      /\bcache:\s*["'](no-store|force-cache|no-cache|reload)["']/,
      /^\s*@(functools\.)?(lru_cache|cache|cached|cache_page)\b/,
      /@(Cacheable|CacheEvict|CachePut)\b/,
      /\bCache-Control\b/i,
      /\b(s-maxage|max-age|stale-while-revalidate)=\d+/,
      /\bnew\s+(LRUCache|NodeCache|Keyv)\(|\bcaches\.open\(/,
    ],
    hook: "The fastest query is the one you never run. The hardest bug is the answer you forgot you kept.",
    what: "Keeping the result of slow work so the next request can reuse it instead of doing the work again.",
    lens: {
      Junior:
        "Fetching from a database or another service is slow, so the app keeps a copy of the answer for a while. Fast, but the copy can be out of date: someone changes their name and the old one keeps showing until the copy is refreshed.",
      Mid:
        "Every cache needs two decisions: the key and the lifetime. The key must include everything the answer depends on, including who is asking. And every write needs to clear what it changed, or readers are served the past.",
      Senior:
        "When a popular entry expires, every waiting request recomputes it at once; stagger lifetimes or serve stale while one refreshes. Know each layer between you and the user (browser, CDN, framework, store), because a purge has to reach all of them.",
    },
    pitfall:
      "The dashboard is cached to make it fast, keyed by the URL. The first person to load it is an admin, and for the next hour everyone who visits sees the admin's numbers.",
    askTheAi: "What is the cache key here, how long does an entry live, and what clears it when the underlying data changes?",
    docs: { label: "MDN: HTTP caching", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching" },
  },
  {
    id: "background-job",
    title: "Work done in the background",
    emoji: "⏰",
    weight: 55,
    files: /\.(jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|swift)$|(^|\/)vercel\.json$/i,
    patterns: [
      /\bcron\.(schedule|New)\(|\bnew\s+CronJob\(|["'](node-cron|cron|node-schedule)["']|@Cron\(|"crons"\s*:/,
      // Five cron fields in a string, at least one of them a star: "0 3 * * *".
      /["'`](?=[^"'`]*\*)(\*|\d+|\*\/\d+)(\s+(\*|[\d,-]+|\*\/\d+)){4}["'`]/,
      /\bsetInterval\(/,
      /\b\w*[qQ]ueue\.(add|addBulk|enqueue|publish)\(|\bnew\s+Queue\(/,
      /["'](bullmq|bull|bee-queue|agenda|pg-boss|inngest)["']/,
      /\binngest\.(createFunction|send)\(|\bnew\s+Inngest\(/,
      /@(celery|celery_app|app)\.task\b|@shared_task\b|\.(apply_async|send_task)\(|\bfrom\s+celery\b|\bCelery\(/,
      /\.add_job\(|\bagenda\.(every|schedule|define)\(|::dispatch\(|\$schedule->(command|call|job)\(/,
      /@Scheduled\b/,
      /\bperform_(async|later|in)\b|\binclude\s+Sidekiq::(Worker|Job)\b|<\s*ApplicationJob\b/,
      /\b(BackgroundTasks|BackgroundScheduler|AsyncIOScheduler)\b|\bbackground_tasks\.add_task\(|\bschedule\.every\(/,
      /\bwaitUntil\(/,
    ],
    hook: "The request said \"done\" and went home. This is the work still going on after the lights are off.",
    what: "Code that runs on a timer or from a queue, instead of running while a visitor waits for a reply.",
    lens: {
      Junior:
        "Some work is too slow to do while someone waits (sending email, resizing video), and some has to happen with nobody there (a nightly clean-up). A job is that work, written down to be run later or on a schedule.",
      Mid:
        "Nobody is watching when a job fails, so the failure has to go somewhere: retries with a limit, a log, an alert. A timer inside the web process disappears on every deploy and never fires on a serverless host that has gone to sleep.",
      Senior:
        "Queues deliver at least once, so a job must be safe to run twice. Guard scheduled work against overlapping with its own previous run and against firing once per instance, and move what keeps failing to a dead-letter queue instead of retrying forever.",
    },
    pitfall:
      "The nightly job starts failing in March. It has no alert, so the first anyone hears of it is in June, when a customer asks why their invoices stopped.",
    askTheAi: "What runs this job and how often, what happens when it fails, and is it safe if it runs twice?",
    docs: { label: "BullMQ: documentation", url: "https://docs.bullmq.io/" },
  },
  {
    id: "pagination",
    title: "Results a page at a time",
    emoji: "📄",
    weight: 50,
    files: /\.(jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|php|cs|swift|vue|svelte|sql)$/i,
    patterns: [
      /\bLIMIT\s+(\d+|\$\d+|\?|:\w+|%s|\$\{[^}]+\}|\{\w+\})\s+OFFSET\b/i,
      /\bOFFSET\s+(\d+|\$\d+|\?|:\w+|%s)\s+(ROWS\b|LIMIT\b)/i,
      /\.(skip|offset)\([^)]*\)\s*\.(take|limit)\(|\.(take|limit)\([^)]*\)\s*\.(skip|offset)\(/,
      // The arithmetic that turns a page number into an offset.
      /\(\s*\w*[pP]age\w*\s*-\s*1\s*\)\s*\*\s*\w/,
      /\bcursor\s*:\s*\{/,
      /\b(nextCursor|next_cursor|endCursor|hasNextPage|has_next_page|nextPageToken|next_page_token)\b/,
      /\b(searchParams|query_params|args|GET)\.get\(\s*["'](page|page_size|pageSize|per_page|perPage|cursor|offset)["']/,
      /\b(req|request|ctx)\.query\.(page|pageSize|page_size|per_page|perPage|cursor|offset)\b/,
      /\b(pageSize|page_size|per_page|perPage|paginate_by|PageNumberPagination|CursorPagination|LimitOffsetPagination)\b/,
      /(\.|->)paginate\(|\bPaginator\(|\bPageRequest\.of\(|\bPageable\b|\bparams\[:page\]/,
    ],
    hook: "Nobody reads ten thousand rows. Sending them anyway is how a list page takes the site down.",
    what: "Returning a long list in fixed-size slices, with a way to ask for the next slice.",
    lens: {
      Junior:
        "A list that is short today will not stay short. Instead of sending everything, the server sends the first twenty and a way to ask for the next twenty. The size of a page is the server's decision, not the caller's.",
      Mid:
        "Offset paging (skip 40, take 20) is simple, but the database still walks past every skipped row, and rows shift when something is inserted. Cursor paging asks for rows after the last one seen: stable, and just as fast on page 500.",
      Senior:
        "A cursor needs a stable, unique sort; add the id as a tie-breaker. Cap the page size on the server whatever the caller asks for, treat a total count as a second, often expensive, query, and keep the cursor opaque so the sort can change later.",
    },
    pitfall:
      "The page size comes straight from the URL with no ceiling. Someone asks for a page of ten million, and the server tries its best to oblige.",
    askTheAi: "What is the largest page a caller can ask for, what is the list sorted by, and is that sort unique?",
    docs: { label: "Prisma: Pagination", url: "https://www.prisma.io/docs/orm/prisma-client/queries/pagination" },
  },
  {
    id: "react-props",
    title: "Props: passing data into a component",
    emoji: "🎁",
    weight: 40,
    files: /\.(jsx?|tsx?|vue|svelte)$/i,
    patterns: [
      /\b(interface|type)\s+\w*Props\b/,
      // Components are capitalised; an ordinary function taking an options object is not one.
      /\bfunction\s+[A-Z]\w*\s*\(\s*(\{|props\b)/,
      /\bconst\s+[A-Z]\w*\s*(:\s*[\w.]+(<[^=]*>)?\s*)?=\s*\(\s*(\{|props\b)/,
      /:\s*(React\.)?(FC|FunctionComponent)\s*</,
      /\b(this\.)?props\.[A-Za-z_]/,
      /\bchildren\s*\??:\s*(React\.)?(ReactNode|ReactElement|JSX\.Element)\b|\bPropsWithChildren\b/,
      />\s*\{children\}\s*<|^\s*\{children\}\s*$/,
      /\bdefineProps\s*[<(]|\$props\(\)/,
    ],
    hook: "A component is a function. Props are its arguments, with one rule: look, do not touch.",
    what: "The values a parent component hands to a child so the child knows what to show and what to call.",
    lens: {
      Junior:
        "Props are how one component configures another, like attributes on an HTML tag. They travel one way, from parent to child, and the child must not change them. To send something back up, the parent passes a function and the child calls it.",
      Mid:
        "A component re-renders when its parent does, and a memoised one whenever a prop is a different reference. An object or function written inline in JSX is new on every render. `children` is an ordinary prop, and often tidier than passing data through five layers.",
      Senior:
        "Props are a component's public interface: keep them few and hard to combine wrongly, with one variant prop rather than three booleans. Copying a prop into state forks the source of truth. When several layers only pass a prop along, reach for composition before context.",
    },
    pitfall:
      "A prop is copied into state \"as the starting value\". The parent later sends a new one, the child goes on showing the old, and the bug report says the screen is haunted.",
    askTheAi: "Which component owns this data, which props are passed along without being used, and could any of them be removed?",
    docs: { label: "React: Passing Props to a Component", url: "https://react.dev/learn/passing-props-to-a-component" },
  },
];

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

export function conceptById(id: string): CodeConcept | undefined {
  return BY_ID.get(id);
}

/** The key a concept is filed under wherever a command would use its binary. */
export function conceptBin(id: string): string {
  return `concept:${id}`;
}

export function isConceptBin(bin: string): boolean {
  return bin.startsWith("concept:");
}

/* ------------------------------------------------------------------ *
 * Belts
 *
 * A level number says how long someone has had the tool open. A belt per
 * concept says what they can actually recall, and it is earned the only way
 * recall can be: by answering the question again after time has passed. The
 * colour is just the review box wearing a costume, so it cannot be farmed and
 * it drops when an answer is missed.
 * ------------------------------------------------------------------ */

export const BELTS = [
  { name: "White", emoji: "⬜" },
  { name: "Yellow", emoji: "🟨" },
  { name: "Orange", emoji: "🟧" },
  { name: "Green", emoji: "🟩" },
  { name: "Brown", emoji: "🟫" },
  { name: "Black", emoji: "⬛" },
] as const;

export function beltForBox(box: number): (typeof BELTS)[number] {
  return BELTS[Math.max(0, Math.min(BELTS.length - 1, Math.floor(box)))];
}

/* ------------------------------------------------------------------ *
 * Recall questions
 *
 * Kept out of QUIZ_BANK so the command bank stays a fixed, inspectable thing
 * and command quizzes never draw a question about React. They share its shape,
 * its grading and its review schedule.
 * ------------------------------------------------------------------ */

const cq = (
  concept: string,
  n: number,
  level: ConceptLevel,
  question: string,
  answer: string,
  distractors: string[],
  explanation: string,
): QuizQuestion => ({
  id: `c-${concept}-${n}`,
  bins: [conceptBin(concept)],
  level,
  question,
  answer,
  choices: [answer, ...distractors],
  explanation,
});

export const CONCEPT_QUESTIONS: QuizQuestion[] = [
  cq("hardcoded-secret", 1, "Junior",
    "An API key was committed to git, then deleted in the next commit. What now?",
    "Revoke the key and issue a new one",
    [
      "Nothing more, because the newest commit no longer contains the key anywhere",
      "Make the repository private, which hides the old commits from everyone else",
      "Rename the variable so automated scanners stop recognising it as a credential",
    ],
    "Git keeps every version, so the key is in every clone. Rotating it is the only move that makes the leaked copy worthless."),
  cq("hardcoded-secret", 2, "Mid",
    "Where should a server-side API key live so the code can use it without containing it?",
    "In an environment variable set outside the repository",
    [
      "In a constants file that is imported only by server modules and never by pages",
      "In the source, base64-encoded so it cannot be read by someone glancing at it",
      "In a comment at the top of the file, so it is documented but never executed",
    ],
    "The code names the variable; each environment supplies the value. Base64 is a costume, not a lock, and any file in the repo travels with it."),
  cq("sql-interpolation", 1, "Junior",
    "Why is dropping a user's input directly into the text of an SQL query dangerous?",
    "The database may run the input as part of the command",
    [
      "The query runs more slowly because the database has to parse a longer piece of text",
      "Special characters in the input are stripped out, so the wrong rows are returned",
      "The database rejects any query whose text was assembled while the program ran",
    ],
    "Query text is code. Input pasted into it can end your statement and start its own. Placeholders keep input as data, full stop."),
  cq("sql-interpolation", 2, "Senior",
    "Placeholders protect values. What do they NOT protect?",
    "Table and column names chosen from user input",
    [
      "String values that contain quote characters or semicolons typed by a user",
      "Numeric values, which have to be escaped by hand before they are bound",
      "Queries that are sent over an encrypted connection to a remote database",
    ],
    "Identifiers cannot be bound as parameters, so a user-chosen sort column has to be checked against an allow-list of known names."),
  cq("password-hashing", 1, "Mid",
    "Why are password hashing algorithms like bcrypt deliberately slow?",
    "To make guessing many candidates expensive",
    [
      "To give the database enough time to write the row safely before the user logs in",
      "Because a slow algorithm produces a longer output that takes more space to store",
      "To stop users from logging in too quickly and overloading the sign-in endpoint",
    ],
    "One login never notices a quarter second. An attacker trying a billion guesses against a leaked table notices about eight years."),
  cq("auth-token", 1, "Mid",
    "What is the difference between verifying a JWT and decoding one?",
    "One checks the signature; the other only reads",
    [
      "Decoding is the more secure of the two, because it also decrypts the hidden payload",
      "There is none: both functions refuse a token that has been altered in any way",
      "Verifying is for refresh tokens only, and decoding is used for access tokens",
    ],
    "Anyone can write a token that says anything. Only a checked signature shows your server was the one who issued it."),
  cq("auth-token", 2, "Senior",
    "Why keep stateless access tokens short-lived?",
    "They cannot be revoked before they expire",
    [
      "Long-lived tokens grow larger with each request until they exceed the header limit",
      "Browsers automatically delete any token that is older than twenty-four hours",
      "Signature checks become slower as a token ages, which adds latency to every call",
    ],
    "No server-side record means nothing to delete, so a stolen token works until it expires. A short lifetime caps the damage."),
  cq("env-vars", 1, "Junior",
    "You edit `.env` while the dev server is running and nothing changes. Why?",
    "The values are read when the process starts",
    [
      "The file is only read in production, so local edits to it are always ignored",
      "Environment files are cached by the browser and need a hard refresh to update",
      "The variable names must be lower case before the server will pick them up",
    ],
    "The environment is handed to a process at launch, like a packed lunch. Restart, and it gets the new one."),
  cq("env-vars", 2, "Mid",
    "In a Next.js or Vite app, what is special about a variable prefixed `NEXT_PUBLIC_` or `VITE_`?",
    "Its value is bundled into JavaScript sent to browsers",
    [
      "It is encrypted at build time, so it is safe to use for private credentials",
      "It is available on the server only and is stripped out of the client bundle",
      "It is shared automatically with every other project deployed to the same host",
    ],
    "The prefix is you opting in to exposure. Every visitor can read it, so it must never hold a secret."),
  cq("input-validation", 1, "Mid",
    "A request body is typed with a TypeScript interface. Why add a runtime schema as well?",
    "Types are erased, so nothing checks real data",
    [
      "A schema makes the endpoint respond faster, because the body is parsed only once",
      "Interfaces only apply to classes, and a request body arrives as a plain object",
      "The compiler refuses to build an endpoint unless a schema library is installed",
    ],
    "TypeScript describes what you hope for at build time. Only a check that runs on each request can turn away what actually arrives."),
  cq("input-validation", 2, "Junior",
    "A form checks the email field in the browser. Why must the server check it too?",
    "The server can be called without the form",
    [
      "Browsers switch off their own checks whenever the connection uses HTTPS",
      "Checks in the browser only run for visitors who are using a mobile device",
      "The browser check runs after the request is sent, so it always arrives late",
    ],
    "Anyone can send a request straight to the endpoint. Browser checks are manners for honest users; the server's check is the law."),
  cq("cors", 1, "Mid",
    "What actually enforces a CORS policy?",
    "The visitor's browser",
    [
      "The API server, which refuses to process any request from an unlisted origin",
      "The DNS provider, which blocks lookups coming from sites that are not allowed",
      "The TLS certificate, which lists the sites permitted to open a connection",
    ],
    "The server only publishes the rule. Browsers honour it; curl and other servers ignore it, so it is never access control for your API."),
  cq("api-route", 1, "Junior",
    "An endpoint has no button or link pointing to it anywhere in the app. Who can call it?",
    "Anyone who knows or guesses its address",
    [
      "Nobody, because an endpoint only becomes reachable once a page links to it",
      "Only signed-in users, since the framework hides unlinked routes from guests",
      "Only requests that come from the same server the application is hosted on",
    ],
    "A deployed route answers to its URL. Hiding the button hides nothing, so each handler has to check who is asking."),
  cq("api-route", 2, "Mid",
    "Why should a failed request return a 4xx or 5xx status rather than 200 with an error message?",
    "Clients decide success from the status code",
    [
      "A 200 response cannot carry a JSON body, so the error message would be dropped",
      "Browsers refuse to display any response whose body contains the word error",
      "Error statuses are cached by the browser, which makes repeated failures cheaper",
    ],
    "Libraries, retries and monitoring all read the status. A 200 tells every one of them that things went fine."),
  cq("db-schema", 1, "Mid",
    "A migration adds a required column with no default to a table that already has rows. What happens?",
    "It fails, since existing rows have no value",
    [
      "It succeeds, and existing rows are silently filled with an empty string or zero",
      "It succeeds, but the existing rows are deleted to keep the table consistent",
      "It is skipped without an error, and the column appears once the table is empty",
    ],
    "A required column needs a value in every row. Add it with a default or as optional, backfill, then tighten it."),
  cq("db-schema", 2, "Junior",
    "A migration has already run on the production database and needs changing. What do you do?",
    "Write a new migration that makes the change",
    [
      "Edit the original file, since the tool re-runs changed migrations on its own",
      "Delete the original file and recreate the production database from scratch",
      "Alter the table by hand in production and leave the migration files as they are",
    ],
    "Applied migrations are shared history. Edit one and databases start disagreeing about what has already happened."),
  cq("orm-query", 1, "Mid",
    "A page loads 50 posts, then runs one query per post to fetch its author. What is this called?",
    "The N+1 query problem",
    [
      "A race condition between the posts query and the authors query",
      "Connection pool exhaustion caused by long transactions",
      "A cache stampede on the first request after a deploy",
    ],
    "One query for the list plus one per item is 51 trips to the shop. Loading the related rows in the same query makes it one or two."),
  cq("react-effect", 1, "Junior",
    "What does an empty dependency array `[]` tell `useEffect`?",
    "Run once, after the first render",
    [
      "Run after every render, because there is nothing listed to compare against",
      "Never run at all, because the effect has been given nothing to depend on",
      "Run only when the component is removed, as a cleanup step for the page",
    ],
    "The array lists what the effect watches. Nothing to watch means nothing can trigger a re-run after mount."),
  cq("react-effect", 2, "Mid",
    "An effect lists an object created inside the component as a dependency and now runs on every render. Why?",
    "It gets a fresh identity every time",
    [
      "Effects always run on every render once they have more than a single dependency",
      "Objects are not allowed in the array, so React falls back to running it always",
      "The object is deep-compared on each render, and that comparison always fails",
    ],
    "React compares dependencies with `Object.is`. A fresh literal is never the same reference as the last one, however alike they look."),
  cq("react-state", 1, "Junior",
    "You call `setCount(count + 1)` and log `count` on the next line. What is logged?",
    "The old value",
    [
      "The new value, because the setter updates the variable right away",
      "`undefined`, because the variable is cleared while React re-renders",
      "A promise that resolves to the new value after the next paint",
    ],
    "Setting state books a new render. The variable in the function that is running is a snapshot, and snapshots do not change."),
  cq("react-state", 2, "Mid",
    "You push to an array held in state and call the setter with the same array. Why does the screen not update?",
    "The reference is unchanged, so React sees no difference",
    [
      "Arrays cannot be stored in state and have to be turned into objects first",
      "The setter runs asynchronously and has not finished when the render happens",
      "React only re-renders when the length of an array in state gets smaller",
    ],
    "React compares old and new state by reference. Hand it a new array (`[...items, x]`) and it notices."),
  cq("client-server-boundary", 1, "Junior",
    "Why must a database password never be used in a file marked `\"use client\"`?",
    "That file is downloaded by every visitor",
    [
      "Client files run more slowly, so the database connection would time out",
      "The marker switches off environment variables for the whole application",
      "Passwords are only valid when they are read from inside a test file",
    ],
    "Client code ships to browsers, where anyone can open it and read. Secrets stay in code that only ever runs on the server."),
  cq("client-server-boundary", 2, "Senior",
    "How should a server action be treated from a security point of view?",
    "As a public endpoint needing its own checks",
    [
      "As private code, since only your own components are able to import and call it",
      "As safe by default, because the framework validates every argument passed in",
      "As a build-time function that never runs once the site has been deployed",
    ],
    "It compiles to an HTTP endpoint anyone can post to, so it needs authentication, authorisation and validation like any route."),
  cq("browser-storage", 1, "Mid",
    "Why is an HttpOnly cookie safer than localStorage for a session token?",
    "Scripts on the page cannot read it",
    [
      "Cookies are encrypted by the browser, while localStorage is kept as plain text",
      "localStorage is cleared every time the tab is closed, which logs the user out",
      "Cookies are never sent over the network, so they cannot be intercepted",
    ],
    "An injected script can read all of localStorage. An HttpOnly cookie is sent by the browser but invisible to JavaScript."),
  cq("async-await", 1, "Junior",
    "What do you get if you call an async function and forget `await`?",
    "A promise, not the value",
    [
      "The value, slightly later than it would have arrived with the keyword",
      "A syntax error that stops the file from running at all",
      "`null`, until the function has been called a second time",
    ],
    "An async function always returns a promise. `await` is what unwraps it; without it you are holding the buzzer, not the coffee."),
  cq("async-await", 2, "Mid",
    "Three independent requests are awaited one after another. How do you make them faster?",
    "Start all three, then await them together",
    [
      "Wrap each one in its own try block, so the runtime is able to schedule them in parallel",
      "Remove the async keyword from the function, so they all run synchronously",
      "Add a short delay between them, so the server is not handling two at once",
    ],
    "Sequential awaits cost the sum of the times. `Promise.all` on already-started requests costs only the slowest one."),
  cq("error-handling", 1, "Junior",
    "What is wrong with an empty `catch` block?",
    "The failure disappears and the code carries on",
    [
      "It is a syntax error, and the file will refuse to run until it has a body",
      "It makes the error be thrown twice, once inside the block and once after it",
      "It slows the program down, because the runtime retries the failed call",
    ],
    "Swallowing the error shreds the only evidence. The next line runs as if the operation had worked."),
  cq("http-fetch", 1, "Mid",
    "A `fetch` call receives a 500 response. What happens to the promise?",
    "It resolves normally; you must check the status",
    [
      "It rejects, and the error lands in the nearest catch block automatically",
      "It retries the request three times before it finally gives up and rejects",
      "It resolves with `null`, so that the calling code can tell it failed",
    ],
    "`fetch` rejects only when the network fails. HTTP errors are ordinary responses, which is exactly why `response.ok` exists."),
  cq("dependency-added", 1, "Junior",
    "What is the lock file (`package-lock.json`, `poetry.lock`) for?",
    "Recording exact versions so installs are repeatable",
    [
      "Stopping two developers from editing the dependency list at the same time",
      "Encrypting the downloaded packages so that they cannot be tampered with",
      "Listing the packages that are banned from being installed in the project",
    ],
    "Version ranges allow different code on different days. The lock file pins what was actually resolved, so it belongs in git."),
  cq("dependency-added", 2, "Mid",
    "An assistant suggests installing a package you have never heard of. What is worth checking first?",
    "That it exists and is the one intended",
    [
      "That its name is short, since shorter names are reserved for official packages",
      "That it was published within the last week, so it is certain to be up to date",
      "That it has no dependencies of its own, as packages with any are unsafe",
    ],
    "Models sometimes invent plausible names, and attackers register them. Ten seconds on the registry page catches both."),
  cq("type-escape", 1, "Junior",
    "What does annotating a value as `any` do?",
    "Turns off type checking for it",
    [
      "Makes the value accept any input while still checking how it is used",
      "Converts the value to a string at runtime so that it always prints",
      "Tells the compiler to infer the most specific type that it can",
    ],
    "`any` opts out in both directions, and the opt-out spreads to everything computed from that value."),
  cq("tests", 1, "Mid",
    "How do you know a newly written test actually checks something?",
    "Break the code and watch it fail",
    [
      "Run it several times and confirm that it passes on every single run",
      "Check that it executes every line of the function it was written for",
      "Make sure it contains at least one assertion for each of the arguments",
    ],
    "A test that cannot fail is decoration. Watching it go red for the right reason is the only proof it is wired to the behaviour."),
  cq("css-layout", 1, "Junior",
    "In a flex row, which property spaces items along the row?",
    "`justify-content`",
    ["`align-items`", "`flex-wrap`", "`align-content`"],
    "`justify-content` works along the main axis, `align-items` across it. Switch to a column and the two directions swap."),
  cq("container-image", 1, "Mid",
    "Why copy `package.json` and install dependencies before copying the rest of the source?",
    "So code edits reuse the cached install layer",
    [
      "Because Docker refuses to copy source files before the dependencies exist",
      "So the final image is smaller, as the source is then stored only once",
      "Because the install step deletes any source files that are already present",
    ],
    "A changed layer throws away everything after it. Put the slow, rarely-changing step first and rebuilds stay fast."),
  cq("gitignore", 1, "Mid",
    "`.env` was committed last week. Today you add it to `.gitignore`. Is it still tracked?",
    "Yes, until removed with `git rm --cached`",
    [
      "No, git stops tracking a file the moment a matching ignore rule exists",
      "No, and the earlier commits that contained it are rewritten automatically",
      "Yes, and it cannot be untracked without deleting the whole repository",
    ],
    "Ignore rules only apply to untracked files. The old commits still hold the contents, so those secrets need rotating too."),
  cq("xss-html-injection", 1, "Junior",
    "A user's comment contains `<img src=x onerror=...>` and the page inserts it with `innerHTML`. What happens?",
    "The handler runs as the site's own code",
    [
      "The tag is shown as plain text, because markup inside a string is never executed",
      "The browser strips the attribute automatically before adding it to the document",
      "The whole page is blocked, and the comment is reported to the owner of the site",
    ],
    "Raw HTML is parsed, not displayed. The broken image fires its error handler, and that script can do anything the logged-in visitor can."),
  cq("xss-html-injection", 2, "Mid",
    "React escapes text rendered in JSX. Why is `dangerouslySetInnerHTML` different?",
    "It skips that escaping entirely",
    [
      "It escapes the string twice, which makes special characters show up doubled",
      "It renders on the server only, so the markup never reaches a visitor's browser",
      "It sanitises the markup first and removes anything that looks like a script",
    ],
    "The prop hands your string to the browser as markup. Anything a user could have typed into it needs a real sanitiser first."),
  cq("file-upload", 1, "Junior",
    "An upload form only offers `.png` files in the file picker. Why is that not enough?",
    "The server can be sent anything directly",
    [
      "PNG files can be larger than the limit that most browsers allow for a single form",
      "The picker checks the size of a file but never looks at what the file is called",
      "Visitors on phones are shown a different picker that ignores the accepted types",
    ],
    "The `accept` attribute is a convenience inside the form. A request made without the form skips it, so type and size are checked again on the server."),
  cq("file-upload", 2, "Senior",
    "Uploaded files are saved under the filename the user supplied. What does a name like `../../app/config.js` do?",
    "Writes outside the upload folder",
    [
      "Nothing, because operating systems reject any filename that contains a dot",
      "It is renamed to `config.js` and stored safely alongside all of the others",
      "It fails validation, since a slash is not allowed to appear in form data",
    ],
    "A supplied name is input like any other. Generate your own, and keep uploads somewhere the server will never run or serve as code."),
  cq("webhook", 1, "Junior",
    "A webhook endpoint has a public URL. Who can send it a request claiming to be a payment confirmation?",
    "Anyone who finds the address",
    [
      "Only the payment provider, because a webhook URL is private to the two parties",
      "Only servers in the same region, since providers restrict where calls come from",
      "Nobody, until the URL has been registered with the browser as a trusted origin",
    ],
    "The URL is not a secret. The signature header is what proves the provider sent the call, so check it before believing the body."),
  cq("webhook", 2, "Mid",
    "A provider delivers the same webhook event twice because the first reply was slow. What should the handler do?",
    "Recognise the event id and skip it",
    [
      "Process both, because a provider only repeats an event when the first one was lost",
      "Return an error for the second, so that the provider stops sending any duplicates",
      "Wait for a third delivery, and then act on whichever two of the copies agree",
    ],
    "Providers retry until they get a quick 2xx, so duplicates are normal. Record the ids you have handled, or the customer gets two orders."),
  cq("db-transaction", 1, "Junior",
    "A transfer subtracts from one account, then the server crashes before adding to the other. What would a transaction have done?",
    "Undone the subtraction as well",
    [
      "Finished the second write automatically as soon as the server came back up",
      "Saved the first write and emailed an administrator about the missing second one",
      "Stopped the server from crashing until both of the writes had been completed",
    ],
    "Inside a transaction the writes land together or not at all. A crash halfway rolls back the part that happened, so no money vanishes."),
  cq("db-transaction", 2, "Mid",
    "Inside a Prisma `$transaction` callback, one query uses the global `prisma` client instead of the `tx` argument. What happens to it?",
    "It runs outside and is not rolled back",
    [
      "It is rejected, because the global client is locked while a transaction is open",
      "It joins the transaction anyway, since both clients share a single connection",
      "It runs twice, once inside the transaction and once more after it commits",
    ],
    "Only queries sent through the transaction's own handle belong to it. The stray one commits by itself, even when everything else is undone."),
  cq("rate-limiting", 1, "Junior",
    "A login endpoint puts no limit on attempts. What does that let an attacker do?",
    "Try passwords until one works",
    [
      "Read the password table directly, because unlimited requests bypass the hashing",
      "Sign in as any user with no password once a thousand requests have been sent",
      "Slow the endpoint down for themselves only, which does no harm to anyone else",
    ],
    "Guessing is only slow if something makes it slow. A cap per account and per address turns a million tries into a handful."),
  cq("rate-limiting", 2, "Senior",
    "A rate limiter counts requests in the server's memory. The app then scales to four instances. What changes?",
    "Each instance keeps its own count",
    [
      "Nothing, since instances share memory whenever they are running the same code",
      "The limit becomes four times stricter, as every request is counted on all four",
      "Requests are refused until the counters on every instance are reset by hand",
    ],
    "Four separate counters means four times the allowance, and a restart wipes them. A shared store such as Redis gives one count for all."),
  cq("caching", 1, "Junior",
    "A user updates their profile, and the page keeps showing the old name for several minutes. What is the likeliest cause?",
    "A stored copy is being served",
    [
      "The database is still writing the change and has not yet finished saving it",
      "The browser refuses to redraw a page that it has already displayed once",
      "The update was sent to a different account because of a typing mistake",
    ],
    "A cache answers from memory until the copy expires or is cleared. A write has to clear what it changed, or readers see the past."),
  cq("caching", 2, "Senior",
    "A response containing one user's account details is cached under the URL alone. What goes wrong?",
    "Other people are served that data",
    [
      "Nothing, as long as the cached copy is set to expire within an hour of being stored",
      "The response is stored twice, which doubles the memory that the cache needs",
      "The first user is logged out as soon as a second person requests the same page",
    ],
    "The cache key has to include everything the answer depends on. Leave out who is asking and the first visitor's page becomes everyone's."),
  cq("background-job", 1, "Junior",
    "Sending a welcome email takes five seconds. Why hand it to a background job instead of sending it during the signup request?",
    "The user gets a reply right away",
    [
      "Emails sent from inside a request are always flagged as spam by mail providers",
      "A background job is able to send the email without needing any credentials",
      "A request is not allowed to make a network call to any other service",
    ],
    "The request only has to record that the email is owed. A worker sends it afterwards, and can try again if the mail service is down."),
  cq("background-job", 2, "Senior",
    "A job charges a card, crashes before marking itself done, and the queue retries it. What must be true of the job?",
    "Running it twice has the same effect as once",
    [
      "It must finish within one second, so that a crash can never interrupt it midway",
      "It must run on the same server each time, so the retry can see the first attempt",
      "It must delete itself from the queue before starting, so no retry can ever happen",
    ],
    "Queues deliver at least once, so a retry after a half-finished run is normal. An idempotency key lets the second run see the charge already happened."),
  cq("pagination", 1, "Junior",
    "Why return a list endpoint's results in pages instead of all at once?",
    "The table will not stay small",
    [
      "Browsers are unable to display more than one hundred rows in a single list",
      "Databases charge per query, and smaller queries are billed at a lower rate",
      "JSON has a fixed size limit that a long list of results would go over",
    ],
    "With ten test rows everything is instant. With a million, one request loads them all into memory and takes the server down with it."),
  cq("pagination", 2, "Mid",
    "With `OFFSET` paging, a new row is inserted at the top while someone is reading page 1. What do they see on page 2?",
    "A row they already saw on page 1",
    [
      "An error, because the total number of rows no longer matches the first request",
      "The same page as before, since the offsets are frozen when the first page loads",
      "An empty page, because inserting a row resets the position to the beginning",
    ],
    "Offsets count from the top, so an insert pushes everything down one place. A cursor (\"rows after this id\") does not shift."),
  cq("react-props", 1, "Junior",
    "A child component assigns a new value to one of its props. What happens in the parent?",
    "Nothing; data only flows down",
    [
      "The parent's state is updated to match, and both components render again",
      "React throws an error and removes the child component from the screen",
      "The parent receives the new value the next time that it happens to render",
    ],
    "Props are read-only inputs. To change the parent's data, the parent passes down a function and the child calls it."),
  cq("react-props", 2, "Mid",
    "A parent passes `style={{ color: \"red\" }}` to a memoised child, and the child still re-renders every time. Why?",
    "The object is new on every render",
    [
      "Memoised components always re-render whenever they are given a style prop",
      "Inline styles are compared as strings, and that comparison is case-sensitive",
      "The child reads the style from context, which ignores memoisation entirely",
    ],
    "Memoisation compares props by reference. An object literal in JSX is created again on each render, so it never equals the last one."),
];

export function questionsForConcept(id: string): QuizQuestion[] {
  const bin = conceptBin(id);
  return CONCEPT_QUESTIONS.filter((q) => q.bins.includes(bin));
}

/* ------------------------------------------------------------------ *
 * Concepts registered at runtime
 *
 * The built-in pack cannot know every library a project uses, so more
 * concepts can be added while the server runs: from JSON idea packs a person
 * writes by hand, and from ideas the host model spots in a change. Both are
 * untrusted in the same way. One is a hand-edited file and the other is model
 * output, and once registered either is indistinguishable from a built-in: its
 * text lands in a card, its patterns run inside an editor hook, and its
 * question ids key the review schedule on disk.
 *
 * So everything is validated, nothing throws, and a definition that fails is
 * rejected whole with a reason an author can act on. Half a concept (a lesson
 * with a truncated pitfall, or with one of its two questions missing) is worse
 * than none, because nobody finds out it is half.
 *
 * CONCEPTS and CONCEPT_QUESTIONS are mutated in place. Other modules hold
 * references to those arrays, and a reassigned array would leave them reading
 * the old one.
 * ------------------------------------------------------------------ */

/** A concept as it can be written in JSON. */
export interface ConceptDefinition {
  /** Kebab-case, 3-60 characters. */
  id: string;
  title: string;
  /** Defaults to 💡. */
  emoji?: string;
  /** 0-100, clamped. Defaults to 50. */
  weight?: number;
  /** Regex source matched against the path, case-insensitively. Null or absent means any file. */
  files?: string | null;
  /** Regex sources. May be empty or absent: such a concept is never auto-detected. */
  patterns?: string[];
  hook: string;
  what: string;
  /** A plain string means the same text at every depth. */
  lens: Record<ConceptLevel, string> | string;
  pitfall: string;
  /** Defaults to a generic question. */
  askTheAi?: string;
  /** The url must be https. Defaults to a web search for the title. */
  docs?: { label: string; url: string };
  questions?: Array<{
    question: string;
    answer: string;
    /** Two to four wrong choices. */
    distractors: string[];
    explanation: string;
    /** Defaults to Junior. */
    level?: ConceptLevel;
  }>;
}

export interface RegisterResult {
  /** Ids now registered, whether new or replacing an earlier registration. */
  added: string[];
  /** The id is "(unknown)" when the definition did not carry a usable one. */
  rejected: Array<{ id: string; reason: string }>;
}

/** Fixed at load, before anything can be registered, so a pack can never join this set. */
const BUILT_IN_IDS: ReadonlySet<string> = new Set(CONCEPTS.map((c) => c.id));

/** Where each runtime concept came from. Built-ins are deliberately absent. */
const ORIGINS = new Map<string, string>();

const LIMITS = {
  title: 80,
  hook: 200,
  what: 400,
  lens: 700,
  pitfall: 500,
  askTheAi: 300,
  docsLabel: 80,
  docsUrl: 500,
  question: 300,
  choice: 200,
  explanation: 500,
  patterns: 8,
  pattern: 300,
  questions: 12,
  origin: 120,
} as const;

const DEFAULT_EMOJI = "💡";
const DEFAULT_WEIGHT = 50;
const DEFAULT_ASK = "What does this part of the change do, and what should I check before relying on it?";

/** Control characters have no business in a card, an id, or a file on disk. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * How much longer than the longest wrong choice an answer may be. Past this a
 * learner can win by picking the longest choice without reading any of them,
 * which is the same thing the built-in bank's rubric guards against in bulk.
 */
const ANSWER_LENGTH_ALLOWANCE = 1.4;

class Rejected extends Error {}
const reject = (reason: string): never => {
  throw new Rejected(reason);
};

/**
 * A required string: present, not blank, and within its cap.
 *
 * Over-long text is rejected rather than cut. A lesson that stops mid-sentence
 * looks finished to the code and broken to the reader, and the author would
 * never be told.
 */
function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") return reject(`${field} is missing or is not text`);
  const clean = value.replace(CONTROL_CHARS, " ").trim();
  if (!clean) return reject(`${field} is empty`);
  if (clean.length > max) return reject(`${field} is longer than ${max} characters`);
  return clean;
}

/**
 * Compiles a pattern from a definition. Only the `i` flag is ever applied: `g`
 * and `y` make `test` remember where it stopped, which would turn detection
 * into something that depends on the previous line.
 */
function compilePattern(source: unknown, field: string): RegExp {
  if (typeof source !== "string" || !source) return reject(`${field} is not a regular expression source`);
  if (source.length > LIMITS.pattern) return reject(`${field} is longer than ${LIMITS.pattern} characters`);
  // A repeated group that itself contains a repeat, `(a+)+`, is the classic
  // shape that takes exponential time on a near miss. Detection runs in an
  // editor hook on every edit, so the cheap check is worth an occasional
  // refusal of a pattern that would have been fine.
  if (/\([^()]*[+*][^()]*\)\s*[+*{]/.test(source)) {
    return reject(`${field} repeats a group that already contains a repeat, which can take too long to run`);
  }
  let compiled: RegExp;
  try {
    compiled = new RegExp(source, "i");
  } catch (err) {
    return reject(`${field} does not compile (${(err as Error).message.slice(0, 80)})`);
  }
  // Detection must not claim things, and this would claim every line of every file.
  if (compiled.test("")) return reject(`${field} matches an empty line, so it would fire on everything`);
  return compiled;
}

function levelOf(value: unknown, field: string): ConceptLevel {
  if (value === undefined || value === null) return "Junior";
  if (value === "Junior" || value === "Mid" || value === "Senior") return value;
  return reject(`${field} must be Junior, Mid or Senior`);
}

/**
 * One registered question, held to the parts of the bank's rubric that can be
 * checked one question at a time. The thresholds for length and for a question
 * that gives itself away are the ones `validateGenerated` applies to
 * model-written questions, so a question is judged the same whichever door it
 * came through.
 */
function parseQuestion(raw: unknown, conceptId: string, n: number): QuizQuestion {
  const at = `question ${n}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject(`${at} is not an object`);
  const o = raw as Record<string, unknown>;

  const question = requiredText(o.question, `${at}: question`, LIMITS.question);
  const answer = requiredText(o.answer, `${at}: answer`, LIMITS.choice);
  const explanation = requiredText(o.explanation, `${at}: explanation`, LIMITS.explanation);
  if (question.length < 15) reject(`${at}: question is too short to be a question`);
  if (explanation.length < 20) reject(`${at}: explanation is too short to teach anything`);
  if (/answer is|correct answer/i.test(question)) reject(`${at}: question gives its own answer away`);

  if (!Array.isArray(o.distractors)) reject(`${at}: distractors must be a list`);
  const rawDistractors = o.distractors as unknown[];
  if (rawDistractors.length < 2 || rawDistractors.length > 4) reject(`${at}: needs 2 to 4 distractors`);
  const distractors = rawDistractors.map((d, i) => requiredText(d, `${at}: distractor ${i + 1}`, LIMITS.choice));

  const norm = (s: string) => s.toLowerCase().trim();
  if (distractors.some((d) => norm(d) === norm(answer))) reject(`${at}: the answer is also listed as a distractor`);
  if (new Set(distractors.map(norm)).size !== distractors.length) reject(`${at}: two choices are the same`);

  const longestWrong = Math.max(...distractors.map((d) => d.length));
  if (answer.length > longestWrong * ANSWER_LENGTH_ALLOWANCE) {
    reject(`${at}: the answer is much longer than every other choice, so it can be picked without reading`);
  }

  return cq(conceptId, n, levelOf(o.level, `${at}: level`), question, answer, distractors, explanation);
}

function parseDefinition(raw: unknown): { concept: CodeConcept; questions: QuizQuestion[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("not an object");
  const o = raw as Record<string, unknown>;

  const id = o.id as string; // shape already checked by the caller
  const title = requiredText(o.title, "title", LIMITS.title);

  let emoji = DEFAULT_EMOJI;
  if (o.emoji !== undefined && o.emoji !== null) {
    if (typeof o.emoji !== "string") reject("emoji is not text");
    const clean = (o.emoji as string).replace(CONTROL_CHARS, "").trim();
    // Sixteen code units is room for a flag or a family; more is not an emoji.
    if (clean.length > 16) reject("emoji is longer than one emoji");
    if (clean) emoji = clean;
  }

  let weight = DEFAULT_WEIGHT;
  if (o.weight !== undefined && o.weight !== null) {
    if (typeof o.weight !== "number" || !Number.isFinite(o.weight)) reject("weight is not a number");
    weight = Math.max(0, Math.min(100, Math.round(o.weight as number)));
  }

  const files = o.files === undefined || o.files === null ? null : compilePattern(o.files, "files");

  let patterns: RegExp[] = [];
  if (o.patterns !== undefined && o.patterns !== null) {
    if (!Array.isArray(o.patterns)) reject("patterns must be a list");
    const sources = o.patterns as unknown[];
    if (sources.length > LIMITS.patterns) reject(`more than ${LIMITS.patterns} patterns`);
    patterns = sources.map((source, i) => compilePattern(source, `pattern ${i + 1}`));
  }

  const hook = requiredText(o.hook, "hook", LIMITS.hook);
  const what = requiredText(o.what, "what", LIMITS.what);
  const pitfall = requiredText(o.pitfall, "pitfall", LIMITS.pitfall);

  let lens: Record<ConceptLevel, string>;
  if (typeof o.lens === "string") {
    const same = requiredText(o.lens, "lens", LIMITS.lens);
    lens = { Junior: same, Mid: same, Senior: same };
  } else if (o.lens && typeof o.lens === "object" && !Array.isArray(o.lens)) {
    const l = o.lens as Record<string, unknown>;
    lens = {
      Junior: requiredText(l.Junior, "lens.Junior", LIMITS.lens),
      Mid: requiredText(l.Mid, "lens.Mid", LIMITS.lens),
      Senior: requiredText(l.Senior, "lens.Senior", LIMITS.lens),
    };
  } else {
    return reject("lens is missing: give one text, or one each for Junior, Mid and Senior");
  }

  const askTheAi =
    o.askTheAi === undefined || o.askTheAi === null ? DEFAULT_ASK : requiredText(o.askTheAi, "askTheAi", LIMITS.askTheAi);

  let docs = {
    label: "Search the docs",
    url: `https://duckduckgo.com/?q=${encodeURIComponent(title)}`,
  };
  if (o.docs !== undefined && o.docs !== null) {
    if (typeof o.docs !== "object" || Array.isArray(o.docs)) reject("docs must be an object with a label and a url");
    const d = o.docs as Record<string, unknown>;
    const url = requiredText(d.url, "docs.url", LIMITS.docsUrl);
    let protocol = "";
    try {
      protocol = new URL(url).protocol;
    } catch {
      reject("docs.url is not a URL");
    }
    // The link is rendered as something to click. Nothing but https belongs there.
    if (protocol !== "https:") reject("docs.url must start with https://");
    docs = {
      label: d.label === undefined || d.label === null ? docs.label : requiredText(d.label, "docs.label", LIMITS.docsLabel),
      url,
    };
  }

  let questions: QuizQuestion[] = [];
  if (o.questions !== undefined && o.questions !== null) {
    if (!Array.isArray(o.questions)) reject("questions must be a list");
    const list = o.questions as unknown[];
    if (list.length > LIMITS.questions) reject(`more than ${LIMITS.questions} questions`);
    questions = list.map((q, i) => parseQuestion(q, id, i + 1));
  }

  return {
    concept: { id, title, emoji, weight, files, patterns, hook, what, lens, pitfall, askTheAi, docs },
    questions,
  };
}

const CONCEPT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Takes a runtime concept and its questions back out. Built-ins are never passed here. */
function unregister(id: string): void {
  const at = CONCEPTS.findIndex((c) => c.id === id);
  if (at !== -1) CONCEPTS.splice(at, 1);
  const bin = conceptBin(id);
  for (let i = CONCEPT_QUESTIONS.length - 1; i >= 0; i--) {
    if (CONCEPT_QUESTIONS[i].bins.includes(bin)) CONCEPT_QUESTIONS.splice(i, 1);
  }
  BY_ID.delete(id);
  ORIGINS.delete(id);
}

/**
 * Adds concepts to the running pack.
 *
 * A built-in id is never shadowed: the built-in lessons are the ones the tests
 * hold to the rubric, and a pack that could quietly replace "hardcoded-secret"
 * could quietly teach the opposite. Registering an id that an earlier call
 * registered replaces that concept and its questions, so an edited pack can be
 * loaded again without restarting.
 *
 * Question ids are `c-<conceptId>-<n>`, the same shape as the built-ins, which
 * is what lets review, selection and lookup treat them identically. It also
 * means renumbering a pack's questions moves their review history, exactly as
 * it would for a built-in.
 */
export function registerConcepts(defs: readonly unknown[], origin: string): RegisterResult {
  const result: RegisterResult = { added: [], rejected: [] };
  if (!Array.isArray(defs)) return result;
  const from =
    (typeof origin === "string" ? origin.replace(CONTROL_CHARS, " ").trim().slice(0, LIMITS.origin) : "") || "runtime";

  for (const raw of defs) {
    let id = "(unknown)";
    try {
      const candidate = raw && typeof raw === "object" ? (raw as Record<string, unknown>).id : undefined;
      if (typeof candidate !== "string" || candidate.length < 3 || candidate.length > 60 || !CONCEPT_ID.test(candidate)) {
        reject(
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? "id must be 3-60 characters of lower-case letters, digits and single hyphens"
            : "not an object",
        );
      }
      id = candidate as string;
      if (BUILT_IN_IDS.has(id)) reject("a built-in idea already has this id, and built-ins cannot be replaced");

      const { concept, questions } = parseDefinition(raw);
      unregister(id);
      CONCEPTS.push(concept);
      CONCEPT_QUESTIONS.push(...questions);
      BY_ID.set(id, concept);
      ORIGINS.set(id, from);
      if (!result.added.includes(id)) result.added.push(id);
    } catch (err) {
      // Anything unexpected (a getter that throws, a proxy) is one more reason
      // to reject, never a reason to take the server down.
      const reason = err instanceof Rejected ? err.message : `could not be read (${String((err as Error)?.message ?? err).slice(0, 80)})`;
      result.rejected.push({ id, reason });
    }
  }
  return result;
}

export function isBuiltInConcept(id: string): boolean {
  return BUILT_IN_IDS.has(id);
}

/** Where a registered concept came from ("pack:<file>", "ai", ...), or null for built-ins and unknown ids. */
export function conceptOrigin(id: string): string | null {
  return ORIGINS.get(id) ?? null;
}

/** Test seam: remove everything registered at runtime. */
export function clearRegisteredConcepts(): void {
  for (const id of [...ORIGINS.keys()]) unregister(id);
}

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

export interface ConceptHit {
  id: string;
  /** How many added lines matched. */
  count: number;
  /** One matching line, scrubbed and capped. */
  evidence: string;
}

const MAX_SCAN_BYTES = 200_000;
const MAX_LINE = 400;
const EVIDENCE_LIMIT = 140;

/** Long opaque tokens and anything assigned to a secret-looking name. */
export function scrub(line: string): string {
  return line
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----.*/g, "«private key»")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9_\-+/=.]{8,}/gi, "$1 «redacted»")
    .replace(
      /\b(api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|authorization|bearer)\b(\s*[:=]\s*|\s+)(["'`]?)[^\s"'`,;)]{6,}\3/gi,
      "$1$2«redacted»",
    )
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "«redacted»")
    .replace(/:\/\/[^/\s:@]+:[^@\s]+@/g, "://«redacted»@");
}

function evidenceOf(line: string): string {
  const clean = scrub(line.trim());
  return clean.length > EVIDENCE_LIMIT ? clean.slice(0, EVIDENCE_LIMIT - 1) + "…" : clean;
}

/**
 * Ideas whose evidence IS a comment or lives equally well in one: an escape
 * hatch like `// @ts-ignore` is written as a comment, and a credential pasted
 * into a comment is still a leaked credential. These are matched against the
 * lines as written. Everything else is matched with comments blanked out, so
 * prose about `await` is not mistaken for asynchronous code.
 */
const MATCH_RAW = new Set(["type-escape", "hardcoded-secret"]);

/**
 * Finds the concepts a block of *added* text relies on.
 *
 * Each pattern is tried against a line with its comments removed and, when
 * the line is part of a statement that runs over several lines, against that
 * whole statement (see structure.ts). A statement is counted once, and its
 * first line is the evidence.
 *
 * Lines over a few hundred characters are skipped: they are minified bundles
 * or data, and running dozens of expressions over them is where a regex-based
 * scanner turns slow.
 */
export function detectConcepts(filePath: string, added: string): ConceptHit[] {
  const text = added.length > MAX_SCAN_BYTES ? added.slice(0, MAX_SCAN_BYTES) : added;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && l.length <= MAX_LINE);
  if (!lines.length) return [];
  const normalisedPath = filePath.replace(/\\/g, "/");
  // Lock files and build output are generated: nobody learns from them.
  if (/(^|\/)(node_modules|dist|build|\.next|vendor)\//.test(normalisedPath)) return [];
  if (/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)|\.map)$/.test(normalisedPath)) return [];

  const { code, statement } = analyse(normalisedPath, lines);

  const hits: ConceptHit[] = [];
  for (const concept of CONCEPTS) {
    if (concept.files && !concept.files.test(normalisedPath)) continue;
    const raw = MATCH_RAW.has(concept.id);
    let count = 0;
    let first = "";
    let counted = "";
    for (let i = 0; i < lines.length; i++) {
      const line = raw ? lines[i] : code[i];
      const whole = raw ? "" : statement[i];
      const onLine = concept.patterns.some((re) => re.test(line));
      const inStatement = !onLine && whole !== "" && whole !== counted && concept.patterns.some((re) => re.test(whole));
      if (!onLine && !inStatement) continue;
      // Every line of a multi-line statement carries the same joined text;
      // once it has matched as a whole it must not match again per line.
      if (inStatement) counted = whole;
      count++;
      if (!first) first = lines[i];
    }
    if (count) {
      hits.push({
        id: concept.id,
        count,
        // The matching line of a secret is the secret. Never keep it.
        evidence: concept.id === "hardcoded-secret" ? "(line withheld: it holds the credential)" : evidenceOf(first),
      });
    }
  }
  return hits;
}

export interface FileChange {
  file: string;
  added: string;
  addedLines: number;
}

/** Splits a unified diff into per-file added text. Tolerant of anything that is not one. */
export function parseUnifiedDiff(diff: string): FileChange[] {
  const out: FileChange[] = [];
  let current: { file: string; lines: string[] } | null = null;
  const flush = () => {
    if (current && current.lines.length) {
      out.push({ file: current.file, added: current.lines.join("\n"), addedLines: current.lines.length });
    }
    current = null;
  };
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      flush();
      const name = line.slice(4).trim().replace(/^b\//, "").replace(/\t.*$/, "");
      current = name === "/dev/null" ? null : { file: name, lines: [] };
    } else if (line.startsWith("diff --git ")) {
      flush();
    } else if (current && line.startsWith("+") && !line.startsWith("+++")) {
      current.lines.push(line.slice(1));
    }
  }
  flush();
  return out;
}
