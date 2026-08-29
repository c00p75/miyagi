/**
 * The quiz bank and its selection rules.
 *
 * The original engine had three questions, all about exit codes, chosen by
 * `bin.length + step_index % 3`. That is deterministic, which means a learner
 * sees the same question for the same command forever and starts answering by
 * remembering the letter rather than the concept. Two things fix that: a bank
 * large enough to have something topical to say, and a selection rule that
 * remembers what it has already asked.
 *
 * Choice order is shuffled per asking, so the answer is not always B.
 */

export interface QuizQuestion {
  id: string;
  /** Binaries this question is about. Empty means it applies to any command. */
  bins: string[];
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
  /** Rough difficulty, matched against the learner's configured depth. */
  level: "Junior" | "Mid" | "Senior";
}

export interface AskedQuiz {
  id: string;
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
  /** Which binary prompted it, for mastery accounting. */
  bin: string;
  /** True when this asking came out of the spaced-repetition queue. */
  review: boolean;
  askedAt: string;
}

const q = (
  id: string,
  bins: string[],
  level: QuizQuestion["level"],
  question: string,
  answer: string,
  distractors: string[],
  explanation: string,
): QuizQuestion => ({
  id,
  bins,
  level,
  question,
  answer,
  choices: [answer, ...distractors],
  explanation,
});

export const QUIZ_BANK: QuizQuestion[] = [
  /* ---- shell fundamentals ---- */
  q("sh-exit-var", [], "Junior",
    "Which shell variable holds the exit code of the command that just finished?",
    "$?", ["$!", "$0", "$#"],
    "`$?` is the exit status of the most recently completed foreground command. 0 means success."),
  q("sh-pipeline-status", [], "Mid",
    "In `foo | grep x`, which exit code does the shell report by default?",
    "grep's, the last command in the pipeline",
    [
      "foo's, the first command in the pipeline, because it produced the data",
      "The highest of the two statuses, so the worst failure always wins",
      "Always 0, because a pipeline is a single compound command to the shell",
    ],
    "Without `set -o pipefail` only the final command's status propagates, so earlier failures are masked."),
  q("sh-strict-mode", [], "Mid",
    "What does `set -euo pipefail` change about a script?",
    "Exit on error, treat unset variables as errors, and propagate pipeline failures",
    [
      "Enables verbose tracing, printing every command and its expansion before running it",
      "Runs the whole script inside a subshell, so nothing it sets can escape to the caller",
      "Disables globbing and word splitting, so every expansion stays a single argument",
    ],
    "`-e` exits on a non-zero status, `-u` errors on unset variables, `-o pipefail` stops a failing stage being hidden by a succeeding one."),
  q("sh-quoting", [], "Junior",
    "Why write `\"$VAR\"` rather than `$VAR`?",
    "Unquoted, the value is split on whitespace and glob-expanded",
    [
      "Quoting makes the expansion faster, because the shell can skip re-scanning the value",
      "Unquoted variables are not expanded at all, so the literal name reaches the command",
      "POSIX requires quotes around every expansion, and unquoted ones are undefined behaviour",
    ],
    "Word splitting turns `my file.txt` into two arguments. Quoting is the difference between one filename and two."),
  q("sh-double-dash", [], "Mid",
    "What does a bare `--` do in `rm -- \"$f\"`?",
    "Ends option parsing, so a filename starting with `-` is treated as a file",
    [
      "Suppresses all output from the command, including anything written to stderr",
      "Elevates the command, running the remaining arguments with root privileges",
      "Reads the remaining arguments from standard input rather than the command line",
    ],
    "Without `--`, a file called `-rf` is parsed as flags. It is the cheapest injection defence in shell."),
  q("sh-redirect-truncate", [], "Junior",
    "What is the difference between `>` and `>>`?",
    "`>` truncates the file, `>>` appends to it",
    [
      "`>` redirects stdout while `>>` redirects stderr to the same destination",
      "`>>` behaves identically to `>` but buffers the writes for performance",
      "`>` creates the file when absent, while `>>` requires it to exist already",
    ],
    "`>` destroys existing content before the command even runs. A misplaced `>` on a config file is unrecoverable."),
  q("sh-stderr-redirect", [], "Mid",
    "How do you send both stdout and stderr to the same file, portably?",
    "`cmd > file 2>&1`, redirecting stdout first",
    [
      "`cmd 2>&1 > file`, pointing stderr at stdout before the redirect",
      "`cmd >> file 2>>`, appending both streams to the same file",
      "`cmd | tee file 2`, piping through tee with the second descriptor",
    ],
    "Order matters: `2>&1` copies wherever stdout currently points, so it must come after the redirect."),
  q("sh-dry-run", [], "Junior",
    "Before running a destructive command for the first time, what is the safest first move?",
    "Preview the affected set with a dry-run or list flag",
    [
      "Run it as root, so it cannot fail halfway through and leave a partial change",
      "Run it twice, since a second run confirms the first one took effect",
      "Redirect stderr to /dev/null, so the important output is not buried in noise",
    ],
    "Previewing (`--dry-run`, `-n`, or an `ls` on the same glob) turns an irreversible action into a reviewable one."),
  q("sh-path-lookup", [], "Junior",
    "Which command tells you whether a binary is on your PATH, and where?",
    "`command -v name`, which is POSIX and covers builtins too",
    [
      "`echo $name`, which prints the resolved path when the binary exists",
      "`man name`, since only an installed program has a manual page",
      "`ls -l name`, which lists the executable wherever it happens to be",
    ],
    "`command -v` is the POSIX form and works in any shell, unlike `which`, which is not standardised."),
  q("sh-exit-127", [], "Mid",
    "A command exits 127. What does that conventionally mean?",
    "The command was not found",
    [
      "Permission was denied, so the binary was found but could not be executed",
      "The process was killed by a signal before it could report its own status",
      "The arguments were invalid, which every well-behaved tool reports as 127",
    ],
    "127 means not found, 126 means found but not executable, and 128+N means killed by signal N."),
  q("sh-relative-path", [], "Junior",
    "Why can the same relative path work in one terminal and fail in another?",
    "It resolves against the current working directory, which differs per shell",
    [
      "Relative paths are cached per user, so a stale cache can point at the wrong directory",
      "Some shells disable relative path resolution entirely when running non-interactively",
      "Relative paths only resolve inside your home directory; elsewhere they need to be absolute",
    ],
    "Confirm with `pwd` before trusting a relative path. Most 'file not found' bugs are cwd bugs."),

  /* ---- filesystem and permissions ---- */
  q("fs-rm-undo", ["rm"], "Junior",
    "You ran `rm -rf build` and needed it. What recovers it?",
    "Nothing in the shell; only a backup or version control",
    [
      "`rm --undo`, which replays the last unlink from the filesystem journal",
      "The desktop trash folder, where the shell moves anything it deletes",
      "`fg`, which brings the deletion back to the foreground before it completes",
    ],
    "`rm` unlinks immediately with no trash and no journal. The recovery plan has to exist before the deletion."),
  q("perm-777", ["chmod"], "Mid",
    "Why is `chmod 777` almost never the right fix?",
    "It grants write and execute to everyone, so it fixes access by removing the control",
    [
      "It can only be applied by root, so it fails silently for an ordinary user",
      "It is measurably slower than a narrower mode, because every bit is rewritten in turn",
      "It resets the file's owner and group to root as an undocumented side effect",
    ],
    "The real fix is normally ownership or group membership. 777 is a permanent hole left behind by a temporary problem."),
  q("perm-denied", ["chmod", "chown"], "Junior",
    "You get 'permission denied' writing a file you own. What do you check first?",
    "The file mode and the directory's write bit with `ls -l` and `ls -ld`",
    [
      "Whether your login password has expired, which revokes write access until you reset it",
      "Whether the filesystem supports permissions at all, as FAT and exFAT volumes do not",
      "Whether another user currently has the file open, which locks it against writes",
    ],
    "Creating or deleting a file needs write on the *directory*, not the file. That asymmetry catches everyone once."),
  q("fs-exec-bit", ["chmod"], "Junior",
    "A script fails with 'permission denied' when run as `./script.sh`. Why?",
    "The execute bit is not set; `chmod +x script.sh` fixes it",
    [
      "The shebang line is missing its trailing newline, so the interpreter is not found",
      "Executable scripts have to live in /usr/local/bin to be runnable by path",
      "The file is owned by root, and only its owner may execute a script",
    ],
    "Alternatively run it as `sh script.sh`, which needs only read permission because the interpreter is the thing being executed."),

  /* ---- git ---- */
  q("git-force-lease", ["git"], "Mid",
    "What does `--force-with-lease` do that `--force` does not?",
    "Refuses the push if the remote moved since you last fetched",
    [
      "Creates a backup branch on the remote before it rewrites anything",
      "Pushes only the commits you authored, leaving other people's commits in place",
      "Prompts for interactive confirmation before it rewrites any shared history",
    ],
    "It turns 'overwrite whatever is there' into 'overwrite only what I have seen', which is what saves a colleague's commits."),
  q("git-reset-vs-revert", ["git"], "Mid",
    "You need to undo a commit that is already pushed to a shared branch. Which?",
    "`git revert`, which adds a new commit undoing the change",
    [
      "`git reset --hard` back one commit, then force push over the shared branch",
      "`git commit --amend` to drop the change, then force push the rewritten commit",
      "`git checkout` the previous commit and push from that detached position",
    ],
    "Revert is additive, so nobody else's history breaks. Reset plus force push rewrites history others have already built on."),
  q("git-detached-head", ["git"], "Mid",
    "You committed in a detached HEAD state. What is the risk?",
    "The commit is unreachable from any branch and will eventually be garbage collected",
    [
      "The commit is pushed to the tracking remote immediately, with no chance to review it",
      "The commit cannot be viewed with `git log`, because it has no branch to be reachable from",
      "The working tree becomes read-only until you check a named branch back out",
    ],
    "`git reflog` can still find it, for a while. Branch first and the problem never exists."),
  q("git-add-p", ["git"], "Mid",
    "What is `git add -p` for?",
    "Staging selected hunks of a file so one commit says one thing",
    [
      "Adding files in parallel, which is faster on a large tree",
      "Adding every file matching a pattern, without listing them individually",
      "Previewing what the next commit would contain, without staging anything",
    ],
    "The index exists so a commit can be smaller than your working tree. `-p` is how you use it."),
  q("git-stash-untracked", ["git"], "Senior",
    "You stash your work and switch branches. Which files does a plain `git stash` leave behind in the working tree?",
    "Anything git is not yet tracking, unless you passed `-u`",
    [
      "Nothing at all; the tree is left exactly as HEAD",
      "Only files larger than one megabyte, which are skipped",
      "Only files listed in .gitignore, which are never stashable",
    ],
    "A plain stash skips untracked files. The classic loss: stash, clean checkout, and the new file you never added is still sitting there, or is gone with the next `clean -fd`."),
  q("git-clean-fdx", ["git"], "Senior",
    "What does `git clean -fdx` remove?",
    "All untracked and ignored files and directories, irreversibly",
    [
      "Only the files listed in .gitignore, leaving other untracked files alone",
      "Only empty directories, which git cannot track and therefore prunes",
      "Untracked files, but it moves them into .git/trash so they can be restored",
    ],
    "That includes `.env` and local build caches. Run `git clean -nd` first: `-n` shows what would go."),

  /* ---- containers ---- */
  q("docker-latest", ["docker"], "Mid",
    "Why is depending on the `latest` tag a reproducibility problem?",
    "The tag is mutable, so the same command can pull different images over time",
    [
      "Images tagged `latest` are built without layer compression, so they are always larger",
      "The `latest` tag disables layer caching, so every build starts from scratch",
      "The `latest` tag is only readable by authenticated users, so CI pulls fail without login",
    ],
    "Pin a version, or a digest if you need certainty. `latest` means 'whatever was pushed most recently'."),
  q("docker-volume-data", ["docker"], "Mid",
    "Where does data written inside a container go when the container is removed?",
    "It is lost, unless it was written to a mounted volume",
    [
      "It is written back into the image, so the next container starts with it present",
      "It is moved to the host's /tmp directory, where it survives until the next reboot",
      "It is committed to a new image layer automatically when the container stops",
    ],
    "The container filesystem is a disposable layer. Anything you want to keep needs a volume or a bind mount."),
  q("docker-down-v", ["docker"], "Senior",
    "What is the difference between `docker compose down` and `down -v`?",
    "`-v` also deletes named volumes, and with them your data",
    [
      "`-v` only makes the teardown verbose, printing each container as it stops",
      "`-v` validates the compose file before tearing anything down, and stops on error",
      "`-v` removes anonymous volumes only, and never touches a named one",
    ],
    "It is one character between 'stop the stack' and 'destroy the database'."),
  q("docker-exec-vs-run", ["docker"], "Junior",
    "You want a shell inside an already-running container. Which?",
    "`docker exec -it <container> sh`",
    [
      "`docker run -it <container> sh`, which attaches to the container by name",
      "`docker attach --shell <container>`, which opens a shell on the running process",
      "`docker start -i <container> sh`, which restarts it with an interactive shell",
    ],
    "`run` creates a new container from an image. `exec` enters the one that is already running."),

  /* ---- node and npm ---- */
  q("npm-ci-vs-install", ["npm"], "Mid",
    "Why does CI use `npm ci` rather than `npm install`?",
    "`ci` installs exactly the lockfile and fails if package.json disagrees",
    [
      "`ci` is the only install command that works with no network access at all",
      "`ci` skips devDependencies by default, which is why CI installs are faster",
      "`ci` installs into a global prefix, so later pipeline steps can reuse the tree",
    ],
    "`install` may resolve new versions and rewrite the lockfile, which makes a green build unreproducible."),
  q("npm-global-install", ["npm"], "Mid",
    "What is the drawback of installing a project's tools globally?",
    "Every project shares one version, so a machine's tooling drifts from the repo",
    [
      "Global installs bypass the cache, so every install re-downloads the whole package",
      "Global installs cannot be removed again without deleting the Node installation",
      "Global installs ignore your registry configuration and always use the public registry",
    ],
    "`npx` or a devDependency keeps the version in the repo, where it can be reviewed and pinned."),
  q("npm-audit-fix-force", ["npm"], "Senior",
    "What can `npm audit fix --force` do that plain `audit fix` will not?",
    "Install semver-major upgrades, which can break your build",
    [
      "Patch the dependency tree in place without ever touching the lockfile",
      "Reach into globally installed packages, which a plain audit fix ignores",
      "Bypass the registry and patch the files in node_modules directly",
    ],
    "`--force` accepts breaking changes to close an advisory. Run it, then run your tests before believing it."),

  /* ---- http ---- */
  q("curl-fail-flag", ["curl"], "Mid",
    "Without `-f`, what does curl do on an HTTP 500?",
    "Exits 0 and prints the error body, so a script thinks it succeeded",
    [
      "Exits 22 with no output at all, which is why the error body is never seen",
      "Retries the request three times and then exits 1 with a summary of the attempts",
      "Prints a warning to stderr and exits 1, leaving the response body on stdout",
    ],
    "curl reports transport success, not HTTP success. `-f` (or `--fail-with-body`) is what makes the exit code mean what you assumed."),
  q("curl-pipe-shell", ["curl"], "Senior",
    "Why is `curl https://example.com/install.sh | sh` risky even from a site you trust?",
    "You execute code you have not read, and the server can serve different bytes to a pipe",
    [
      "Piping through a shell silently disables TLS certificate verification for the transfer",
      "`sh` reads a piped script one line at a time, so a long installer can be truncated midway",
      "curl strips the shebang line when writing to a pipe, so the wrong interpreter runs it",
    ],
    "Download, read, then run. The gap between inspection and execution is the whole attack."),

  /* ---- orchestration ---- */
  q("k8s-context", ["kubectl"], "Senior",
    "Before deleting a resource in a cluster, why is `kubectl config current-context` worth running?",
    "The target cluster comes from saved state that persists across sessions, so it may not be the one you assume",
    [
      "The context expires hourly, so a stale one silently falls back to the default cluster",
      "A context selects the namespace rather than the cluster, so the target is always local",
      "kubectl refuses to act without an explicit --context flag on every invocation",
    ],
    "There is no confirmation prompt telling you that `delete` just landed in production."),
  q("tf-plan-file", ["terraform"], "Senior",
    "Why `terraform plan -out=tfplan` then `terraform apply tfplan`?",
    "Apply executes exactly the reviewed plan, with no chance to re-resolve differently",
    [
      "It is faster, because the saved plan is a cache that skips the provider refresh",
      "It is the only way to apply without provider credentials present on the machine",
      "The plan file is what implements state locking, so a bare apply cannot be safe",
    ],
    "A bare `apply` re-plans against whatever the world looks like now, so what you reviewed is not necessarily what runs."),

  /* ---- process and inspection ---- */
  q("ps-port-holder", ["lsof", "netstat", "ss"], "Mid",
    "'Address already in use' on port 3000. What finds the holder?",
    "`lsof -nP -iTCP:3000 -sTCP:LISTEN` (or `ss -ltnp` on Linux)",
    [
      "`ps aux | grep 3000`, which searches process names and arguments for the port",
      "`kill -9 3000`, which signals whatever process has claimed that port number",
      "`netstat -r`, which prints the routing table the connection would take",
    ],
    "Find the PID before you kill anything. `kill -9` on a guess is how you lose unsaved state."),
  q("kill-9-last", [], "Senior",
    "Why is `kill -9` a last resort rather than a first move?",
    "SIGKILL cannot be handled, so the process cannot flush buffers or clean up",
    [
      "It requires root on most systems, so an ordinary user cannot rely on it working",
      "It always kills the entire process group, taking unrelated children with it",
      "It discards the exit status, so the parent can never learn how the child ended",
    ],
    "Try SIGTERM first and let the process shut down properly. Reach for -9 when it will not."),
  q("df-inodes", ["df"], "Senior",
    "`df -h` shows free space but writes still fail with ENOSPC. What next?",
    "Check inode exhaustion with `df -i`",
    [
      "Reboot to flush the page cache, which is holding the free blocks unavailable",
      "Check the per-process file size limit with `ulimit -f`, which caps writes",
      "Remount the filesystem read-write, since a read-only remount reports space normally",
    ],
    "A filesystem can run out of inodes with gigabytes free. Millions of tiny files is the usual cause."),
];

/* ------------------------------------------------------------------ *
 * Generated questions
 *
 * Model-authored questions, validated in sampling.ts, live alongside the bank
 * so selection, review scheduling and grading treat them identically. They are
 * kept in a separate list purely so the hand-written bank stays a fixed,
 * inspectable thing.
 * ------------------------------------------------------------------ */

const GENERATED: QuizQuestion[] = [];

export function registerGenerated(questions: readonly QuizQuestion[]): number {
  let added = 0;
  for (const q of questions) {
    if (GENERATED.some((g) => g.id === q.id) || QUIZ_BANK.some((b) => b.id === q.id)) continue;
    GENERATED.push(q);
    added++;
  }
  return added;
}

/** Every question available to selection, hand-written and generated. */
export function allQuestions(): QuizQuestion[] {
  return [...QUIZ_BANK, ...GENERATED];
}

export function generatedCount(): number {
  return GENERATED.length;
}

/** Test seam: forget generated questions between cases. */
export function clearGenerated(): void {
  GENERATED.length = 0;
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/** A tiny string hash, so choice order is stable per asking without Math.random. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Fisher-Yates driven by the seed, so a question's answer is not always in one
 * slot.
 *
 * The unsigned coercion is load-bearing. `Math.imul` returns a *signed* 32-bit
 * integer, so without it the state could go negative, `j` with it, and
 * `out[j] = ...` would write to a negative property and drop a real choice:
 * cards rendered "B. undefined" for some seeds and not others. Intermittent by
 * construction, and exactly the kind of thing a rubric over the whole bank
 * catches and a single example does not.
 */
export function shuffleChoices(choices: readonly string[], seed: string): string[] {
  const out = [...choices];
  let h = hash(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 48271) >>> 0) % 0x7fffffff || 1;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const LEVEL_ORDER: Record<QuizQuestion["level"], number> = { Junior: 0, Mid: 1, Senior: 2 };

export function questionById(id: string): QuizQuestion | undefined {
  return allQuestions().find((x) => x.id === id);
}

export interface PickOptions {
  bin: string;
  skillLevel: "Junior" | "Mid" | "Senior";
  /** Ids asked recently. Avoided unless nothing else is left. */
  recentIds: readonly string[];
  /** Rotates choice order between askings of the same question. */
  salt?: string;
}

/**
 * Picks a question, preferring ones about this binary, then ones at or below
 * the learner's depth, then anything unasked. Recency is a filter, not a
 * ranking: the point is that the next question is not the last one.
 */
export function pickQuestion(opts: PickOptions): QuizQuestion {
  const bin = opts.bin.toLowerCase();
  const maxLevel = LEVEL_ORDER[opts.skillLevel];
  const recent = new Set(opts.recentIds);
  const pool = allQuestions();

  const specific = pool.filter((x) => x.bins.includes(bin));
  const generic = pool.filter((x) => x.bins.length === 0);
  const atLevel = (pool: QuizQuestion[]) =>
    pool.filter((x) => LEVEL_ORDER[x.level] <= maxLevel);
  const fresh = (pool: QuizQuestion[]) => pool.filter((x) => !recent.has(x.id));

  const tiers = [
    fresh(atLevel(specific)),
    fresh(specific),
    fresh(atLevel(generic)),
    fresh(generic),
    fresh(atLevel(pool)),
    fresh(pool),
    // Everything has been asked recently, so allow a repeat rather than fail.
    atLevel(specific).length ? atLevel(specific) : specific,
    pool,
  ];

  for (const tier of tiers) {
    if (tier.length) {
      const seed = hash(`${bin}:${opts.salt ?? ""}:${recent.size}`);
      return tier[seed % tier.length];
    }
  }
  return QUIZ_BANK[0];
}

/** Materialises a question into an asking, with choices shuffled for this attempt. */
export function ask(
  question: QuizQuestion,
  bin: string,
  opts: { review?: boolean; salt?: string } = {},
): AskedQuiz {
  return {
    id: question.id,
    question: question.question,
    choices: shuffleChoices(question.choices, `${question.id}:${opts.salt ?? ""}`),
    answer: question.answer,
    explanation: question.explanation,
    bin,
    review: opts.review ?? false,
    askedAt: new Date().toISOString(),
  };
}

/**
 * Grades an answer. Accepts a letter against the shuffled order, or the answer
 * text; a learner who types the concept should not be marked wrong for not
 * knowing which letter it landed on this time.
 */
export function grade(quiz: AskedQuiz, given: string): { correct: boolean; chosen: string | null } {
  const trimmed = given.trim();
  const letter = trimmed.replace(/[).\s]/g, "").toUpperCase();
  let chosen: string | null = null;
  if (/^[A-Z]$/.test(letter)) {
    chosen = quiz.choices[letter.charCodeAt(0) - 65] ?? null;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$?!#]/g, "");
  const target = norm(quiz.answer);
  if (!target) return { correct: false, chosen };
  const givenNorm = norm(trimmed);
  const correct =
    (chosen !== null && norm(chosen) === target) ||
    givenNorm === target ||
    // A long free-text answer that contains the exact answer string counts.
    (givenNorm.length > 8 && givenNorm.includes(target)) ||
    // A substantial substring of the official answer also counts.
    (givenNorm.length > 3 && target.includes(givenNorm) && givenNorm.length >= target.length * 0.6);
  return { correct, chosen };
}
