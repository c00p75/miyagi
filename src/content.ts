/**
 * Teaching content.
 *
 * The original card printed the same three sentences for `pwd`, `kubectl get
 * pods` and `terraform apply`: a description of what an explanation would
 * cover rather than an explanation. Two things replace it.
 *
 * First, a content pack keyed by binary, so the common commands get real
 * prose that is deterministic and works offline. Second, a teaching brief:
 * the card is read by a model, so where the pack has nothing specific to say
 * the card asks the host model to teach the gap, with the real stdout and the
 * learner's depth already in hand. Boilerplate is the one thing neither path
 * produces.
 */

export type SkillLevel = "Junior" | "Mid" | "Senior";

export interface Lens {
  what: string;
  how: string;
  tradeoffs: string;
}

export interface CommandContent {
  concept: string;
  /** One-line summary of the binary's job, used in speech and headings. */
  summary: string;
  lens: Record<SkillLevel, Lens>;
  pitfalls: string[];
  docs: Array<{ label: string; url: string }>;
  /** Command-specific mental model. Falls back to the process-lifecycle diagram. */
  diagram?: (command: string) => string;
}

/** What the generic lens says. Kept honest: it describes the shell, not the command. */
const GENERIC_LENS: Record<SkillLevel, Lens> = {
  Junior: {
    what: "The shell splits your line into a command and its arguments, finds the program on PATH, and runs it as a new process. Whatever it prints comes back to you; whatever it exits with the shell remembers in `$?`.",
    how: "Type the smallest version that could work, look at the output, then add one flag at a time. `--help` is faster than guessing.",
    tradeoffs: "A terminal command is exact and repeatable, which is its advantage over clicking, and unforgiving, which is its cost. Nothing asks you twice.",
  },
  Mid: {
    what: "A process with three streams (stdin, stdout, stderr), an argument vector, an environment, and an exit code. Everything composable about the shell follows from those five things.",
    how: "Compose with pipes and redirects, and branch on exit codes rather than on parsed output. Quote every expansion; assume any filename can contain a space.",
    tradeoffs: "Text streams make anything interoperable and nothing type-safe. Parsing human-formatted output is the fragility you are trading for reach.",
  },
  Senior: {
    what: "fork/exec against the kernel: inherited file descriptors, signal disposition, cgroup and namespace membership, and an exit status that is the only contract callers can rely on.",
    how: "Harden it: `set -euo pipefail`, `--` before user-controlled arguments, explicit `PATH`, least privilege, and machine-readable output flags rather than scraping.",
    tradeoffs: "Weigh the operational cost against a purpose-built tool. Shell is unbeatable for glue and a liability as a system of record.",
  },
};

const lens = (j: Lens, m: Lens, s: Lens): Record<SkillLevel, Lens> => ({
  Junior: j,
  Mid: m,
  Senior: s,
});

const man = (bin: string) => ({
  label: `man page: ${bin}`,
  url: `https://man7.org/linux/man-pages/man1/${bin}.1.html`,
});

export const CONTENT: Record<string, CommandContent> = {
  pwd: {
    concept: "Locating yourself in the filesystem",
    summary: "prints the absolute path of the current working directory",
    lens: lens(
      {
        what: "`pwd` prints the full path of the directory you are currently in, starting from `/`. It is the answer to 'where am I', and it never changes anything.",
        how: "Run it with no arguments. Run it right before and right after any `cd` until relative paths stop surprising you.",
        tradeoffs: "There is no risk and no alternative worth learning. The mistake is not running it, then blaming a command for a path you got wrong.",
      },
      {
        what: "The shell tracks cwd per process. `pwd` reports the shell's logical path, which can differ from the physical one when you arrived through a symlink.",
        how: "`pwd -P` resolves symlinks to the physical path; `pwd -L` (the default) keeps the logical one. Scripts that compare paths need `-P`.",
        tradeoffs: "Logical paths read better in prompts; physical paths compare correctly. Pick deliberately, because a symlinked repo makes the two diverge silently.",
      },
      {
        what: "cwd is kernel state on the process, inherited across fork and unaffected by the parent. A subshell's `cd` cannot leak out, which is the property scripts rely on.",
        how: "In scripts prefer `cd -- \"$dir\" || exit` over bare `cd`, and derive locations from `$(cd \"$(dirname \"$0\")\" && pwd -P)` rather than assuming the caller's cwd.",
        tradeoffs: "Depending on cwd makes a script position-dependent and hard to call from cron or CI. Absolute paths derived at start-up cost two lines and remove a class of bug.",
      },
    ),
    pitfalls: [
      "A symlinked path means `pwd` and `pwd -P` disagree, and only one of them compares correctly.",
      "Every relative path in the command you are about to run resolves against this directory, not the one your editor has open.",
    ],
    docs: [man("pwd"), { label: "Bash: Directory Stack", url: "https://www.gnu.org/software/bash/manual/bash.html#The-Directory-Stack" }],
  },

  ls: {
    concept: "Reading a directory listing",
    summary: "lists directory contents and file metadata",
    lens: lens(
      {
        what: "`ls` shows what is in a directory. With `-l` each line becomes mode, link count, owner, group, size, modification time, name. `-a` includes dotfiles, `-h` makes sizes readable.",
        how: "`ls -lah` is the everyday form. Read the first column left to right: type, then owner/group/other permissions in `rwx` triples.",
        tradeoffs: "It is safe and read-only. The only cost is habit: people run `ls` and skip the metadata that would have answered their actual question.",
      },
      {
        what: "`ls` reads the directory entries and stats each one. Sorting, colour and column layout are presentation, applied after the syscalls, and vary between GNU and BSD builds.",
        how: "`-t` sorts by mtime, `-S` by size, `-r` reverses. `ls -ld dir` inspects the directory itself rather than its contents, which is what you want when a write is being refused.",
        tradeoffs: "Never parse `ls` output: filenames can contain newlines. Use `find -print0` or a glob when a script needs the list.",
      },
      {
        what: "One `getdents` plus an `lstat` per entry, so cost scales with entry count and inode cache state. On a cold, million-entry directory it is an IO event, not a query.",
        how: "For scripts use `find`, `stat --format`, or shell globs. For triage `ls -ld`, `ls -i`, and `ls -l --time-style=full-iso` give the unambiguous forms.",
        tradeoffs: "Human-formatted output is the trap: locale changes date formats, and colour codes end up in captured output. Machine paths need machine tools.",
      },
    ),
    pitfalls: [
      "Parsing `ls` in a script breaks on any filename containing a space or a newline. Use a glob or `find -print0`.",
      "`ls dir` lists the contents; `ls -ld dir` describes the directory. Permission questions almost always need the second one.",
    ],
    docs: [man("ls"), { label: "Coreutils: ls", url: "https://www.gnu.org/software/coreutils/manual/html_node/ls-invocation.html" }],
  },

  rm: {
    concept: "Irreversible deletion",
    summary: "unlinks files and directories, with no trash and no undo",
    lens: lens(
      {
        what: "`rm` deletes files immediately. There is no recycle bin, no confirmation unless you ask for one, and no way to get the file back afterwards.",
        how: "Use `rm -i` while you are learning: it asks per file. Run `ls` on the same pattern first so you can see exactly what is about to go.",
        tradeoffs: "The whole trade is speed against safety. Until deleting feels boring, take the prompt.",
      },
      {
        what: "`rm` unlinks a directory entry. The data goes when the last link and the last open file descriptor are gone, which is why a running process can still hold a deleted log.",
        how: "Preview with `ls <glob>` or `find ... -print`, then delete. `-r` recurses, `-f` suppresses errors and prompts, and combining them removes every guard at once.",
        tradeoffs: "`-f` in a script means failures are silent. That is usually wrong: you want to know that the thing you meant to delete was not there.",
      },
      {
        what: "Removal is a directory-entry operation, not a data operation. Nothing is overwritten, so recovery depends entirely on backups, snapshots, or a still-open fd via `/proc/<pid>/fd`.",
        how: "In automation delete explicit paths, never an interpolated glob. Guard with `[ -n \"$dir\" ]` before `rm -rf \"$dir\"/*`, because an empty variable turns that into `rm -rf /*`.",
        tradeoffs: "`rm -rf` in a pipeline is a blast-radius decision, not a cleanup detail. Prefer a per-run temp directory you can drop whole.",
      },
    ),
    pitfalls: [
      "`rm -rf` has no undo and no trash. Dry-run the glob with `ls` first, every time.",
      "A stray space turns `rm -rf /path` into `rm -rf / path`, which starts at the root before it fails.",
      "An unset variable in `rm -rf \"$DIR\"/` expands to `/`. Guard the variable, not the command.",
    ],
    docs: [man("rm"), { label: "Coreutils: rm", url: "https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html" }],
  },

  grep: {
    concept: "Searching text with patterns",
    summary: "prints lines matching a pattern",
    lens: lens(
      {
        what: "`grep pattern file` prints every line containing the pattern. `-n` adds line numbers, `-i` ignores case, `-r` searches a whole directory tree.",
        how: "Quote the pattern so the shell does not expand it: `grep -n 'hello' notes.txt`. Start with a plain word before reaching for regex syntax.",
        tradeoffs: "It reads and never writes, so experimenting is free. The cost is precision: a loose pattern buries the answer in matches.",
      },
      {
        what: "Basic regex by default, extended with `-E`, fixed strings with `-F`. Exit code 0 means at least one match, 1 means none, 2 means an error, which makes it usable as a condition.",
        how: "`grep -rn --include='*.ts' 'pattern' .` for code. `-c` counts, `-l` lists filenames only, `-v` inverts, `-A/-B/-C` add context lines.",
        tradeoffs: "`if grep -q x file` is the cheap existence test. Just remember 'no match' is exit 1, so `set -e` will kill a script on a legitimately empty search.",
      },
      {
        what: "A line-oriented DFA/NFA matcher over a byte stream. Performance turns on `-F` versus regex, locale (`LC_ALL=C` is materially faster), and whether the input is memory-mapped.",
        how: "`grep -q` short-circuits on first match. Combine with `--null-data` or `-z` for NUL-delimited records, and prefer `-F` for literal patterns in hot loops.",
        tradeoffs: "For structured input, a parser beats a pattern: grep on JSON or XML is a heuristic that will eventually match the wrong thing. Reach for `jq` when structure matters.",
      },
    ),
    pitfalls: [
      "An unquoted pattern is glob-expanded by the shell before grep ever sees it.",
      "Under `set -e`, a grep that finds nothing exits 1 and takes the script down. Use `|| true` when no match is a valid outcome.",
      "`grep` on JSON works until a value spans two lines. Use `jq` for structure.",
    ],
    docs: [man("grep"), { label: "GNU grep manual", url: "https://www.gnu.org/software/grep/manual/grep.html" }],
  },

  git: {
    concept: "Distributed version control",
    summary: "records snapshots of your work and moves them between repositories",
    lens: lens(
      {
        what: "Git stores snapshots. Files move working tree → index (staging) → commit, and `git status` tells you which stage everything is in. A commit is a permanent, named point you can return to.",
        how: "`git status` constantly, `git add -p` to stage deliberately, `git commit -m` with a message that says why, `git log --oneline` to read back. Branch before experimenting.",
        tradeoffs: "Committing often costs nothing and buys you every undo you will ever want. The mistake is treating git as a backup you push at the end of the day.",
      },
      {
        what: "A DAG of commits, each pointing at a tree and its parents. Branches and tags are just movable pointers; HEAD says where you are. Almost every git command is moving a pointer or building a tree.",
        how: "`switch`/`restore` for branches and files (safer than the overloaded `checkout`), `rebase -i` to clean local history, `revert` for anything already shared. `reflog` finds what you think you lost.",
        tradeoffs: "Rewriting local history is free and makes review possible. Rewriting shared history breaks everyone downstream. The branch's audience is the whole decision.",
      },
      {
        what: "A content-addressed object store (blob/tree/commit/tag) plus refs. Immutability is the safety property: rewriting creates new objects and moves a ref, and the old objects survive until gc.",
        how: "`--force-with-lease` over `--force`, signed tags for releases, `merge --no-ff` when you want the topology to record the branch. Protect shared refs on the server, not by convention.",
        tradeoffs: "Rebase gives linear, bisectable history at the cost of losing the real integration record. Merge preserves the record at the cost of a noisier graph. Pick per repo and enforce it.",
      },
    ),
    pitfalls: [
      "`git push --force` rewrites shared history and can delete a colleague's commits. Use `--force-with-lease`.",
      "Commits made in a detached HEAD belong to no branch and are eventually garbage collected. Branch first.",
      "`git stash` skips untracked files unless you pass `-u`, so a new file can survive a stash and then be lost to a `clean -fd`.",
      "`git clean -fdx` deletes ignored files too, including `.env`. Run `git clean -nd` first.",
    ],
    docs: [
      { label: "Pro Git (free book)", url: "https://git-scm.com/book/en/v2" },
      { label: "git reference", url: "https://git-scm.com/docs" },
    ],
    diagram: (command) => {
      const sub = command.trim().split(/\s+/)[1]?.replace(/^-+/, "") ?? "status";
      return [
        "flowchart LR",
        '    W["Working tree"] -->|"git add"| I["Index (staged)"]',
        '    I -->|"git commit"| L["Local branch"]',
        '    L -->|"git push"| R["Remote branch"]',
        '    R -->|"git fetch"| L',
        '    L -->|"git restore"| W',
        `    L --- N["you ran: git ${sub}"]`,
      ].join("\n");
    },
  },

  docker: {
    concept: "Containerised processes",
    summary: "builds images and runs processes in isolated namespaces",
    lens: lens(
      {
        what: "An image is a frozen filesystem plus a default command. A container is one running instance of it. Containers are disposable: delete one and anything it wrote inside is gone.",
        how: "`docker ps` to see what is running, `docker logs -f` to watch output, `docker exec -it <name> sh` to get a shell inside a running one. `docker compose up -d --build` for a whole stack.",
        tradeoffs: "You get an environment that behaves the same everywhere. You pay in a layer of indirection: every path, port and file lives inside the container until you deliberately expose it.",
      },
      {
        what: "Layered union filesystem plus namespaces (pid, net, mount, uts) and cgroups. The writable layer is per container and dies with it; volumes and bind mounts are the only durable storage.",
        how: "Pin image tags or digests. `compose config` renders the resolved file. Map ports explicitly, mount volumes for anything stateful, and keep build context small with `.dockerignore`.",
        tradeoffs: "Layer caching makes rebuilds fast but hides staleness, which is why `--build` exists. `latest` is not a version and makes a build unreproducible.",
      },
      {
        what: "A container is a process with a different view of the kernel, not a VM. Shared kernel means shared kernel vulnerabilities, and root inside is root-adjacent outside without user namespaces.",
        how: "Multi-stage builds, non-root `USER`, read-only root filesystem, dropped capabilities, pinned digests, and a healthcheck that actually fails. Scan images in CI.",
        tradeoffs: "Isolation is real but weaker than virtualisation. For hostile multi-tenancy you want a VM boundary or gVisor/Kata, and you should decide that before it matters.",
      },
    ),
    pitfalls: [
      "Anything written inside a container without a volume dies with the container.",
      "`latest` is a mutable tag, not a version. Pin a tag or a digest for anything reproducible.",
      "`docker compose down -v` deletes named volumes, and with them your database.",
      "`docker run` starts a new container; to enter a running one you want `docker exec`.",
    ],
    docs: [
      { label: "Docker CLI reference", url: "https://docs.docker.com/reference/cli/docker/" },
      { label: "Dockerfile best practices", url: "https://docs.docker.com/build/building/best-practices/" },
    ],
    diagram: () =>
      [
        "flowchart LR",
        '    D["Dockerfile"] -->|"docker build"| I["Image (layers)"]',
        '    I -->|"docker run / compose up"| C["Container"]',
        '    C -->|"writable layer"| X["Discarded on rm"]',
        '    C -->|"volume mount"| V["Volume (survives)"]',
        '    C -->|"docker logs"| O["stdout / stderr"]',
      ].join("\n"),
  },

  npm: {
    concept: "Node package management",
    summary: "installs dependencies and runs project scripts",
    lens: lens(
      {
        what: "`package.json` lists what your project needs; `package-lock.json` records the exact versions that were installed. `npm install` reads the first, `npm ci` obeys the second.",
        how: "`npm ci` to install, `npm run <script>` to run something from the scripts block, `npm ls --depth=0` to see your direct dependencies.",
        tradeoffs: "Commit the lockfile. Without it, 'it worked yesterday' becomes unanswerable.",
      },
      {
        what: "A resolver producing a tree in `node_modules` from semver ranges. `install` may resolve new versions and rewrite the lock; `ci` deletes `node_modules` and installs the lock exactly, failing if it disagrees with package.json.",
        how: "`ci` in CI, `install` only when you intend to change dependencies. `npx` runs a local binary without a global install. `--omit=dev` for production images.",
        tradeoffs: "Ranges get you patches for free and make builds non-deterministic. The lockfile buys determinism at the cost of deliberate upgrades.",
      },
      {
        what: "Lifecycle scripts execute arbitrary code from arbitrary authors at install time, which makes install a supply-chain event. Provenance and integrity hashes in the lock are the mitigations.",
        how: "`--ignore-scripts` where it is viable, pin with the lock, audit in CI, and keep publish tokens out of developer machines. Verify provenance for anything critical.",
        tradeoffs: "`npm audit fix --force` accepts semver-major upgrades to close advisories, so it trades a known vulnerability for an unknown break. Read the diff.",
      },
    ),
    pitfalls: [
      "`npm install` can rewrite the lockfile; use `npm ci` in CI so builds are reproducible.",
      "Global installs mean every project shares one tool version, which is how machines drift from the repo.",
      "Install-time lifecycle scripts run untrusted code. `--ignore-scripts` is worth knowing about.",
    ],
    docs: [
      { label: "npm CLI docs", url: "https://docs.npmjs.com/cli/v10/commands" },
      { label: "npm ci", url: "https://docs.npmjs.com/cli/v10/commands/npm-ci" },
    ],
  },

  curl: {
    concept: "HTTP from the command line",
    summary: "transfers data to and from a URL",
    lens: lens(
      {
        what: "`curl <url>` fetches a URL and prints the body. `-o file` saves it, `-I` fetches only headers, `-L` follows redirects.",
        how: "Add `-fsS`: fail on HTTP errors, stay silent, but still show real errors. That combination is what you want in almost every script.",
        tradeoffs: "It is the fastest way to check whether a service answers. It is also the fastest way to run someone else's code, if you pipe it to a shell.",
      },
      {
        what: "Without `-f`, curl reports transport success: an HTTP 500 exits 0 and prints the error body. `-w '%{http_code}'` extracts the status for scripting.",
        how: "`curl -fsS -o /dev/null -w '%{http_code}\\n' <url>` is the canonical health check. `--max-time` and `--retry` bound the failure. `-H` sets headers, `--data` posts.",
        tradeoffs: "curl is perfect for probing and poor as an API client: no schema, no typed errors. Once you are parsing responses, move into code.",
      },
      {
        what: "Exit codes distinguish DNS, TLS, connect and timeout failures, which is exactly what you need for actionable alerting. `--write-out` exposes per-phase timings.",
        how: "Pin TLS expectations (`--cacert`, `--pinnedpubkey`), set `--max-time` always, and use `--fail-with-body` so a failure still gives you the diagnostic body.",
        tradeoffs: "Credentials on the command line land in shell history and process listings. Use `--netrc` or a config file for anything real.",
      },
    ),
    pitfalls: [
      "Without `-f`, curl exits 0 on an HTTP 500, so a script believes it succeeded.",
      "Piping curl straight into a shell executes code you have not read, over a connection that can serve a pipe different bytes.",
      "Secrets passed as `-H 'Authorization: ...'` are visible in `ps` and saved in shell history.",
    ],
    docs: [
      { label: "curl manual", url: "https://curl.se/docs/manpage.html" },
      { label: "Everything curl (free book)", url: "https://everything.curl.dev/" },
    ],
    diagram: () =>
      [
        "flowchart TD",
        '    A["curl <url>"] --> B{"DNS resolves?"}',
        '    B -- "no" --> E["exit 6: could not resolve host"]',
        '    B -- "yes" --> C{"TLS handshake OK?"}',
        '    C -- "no" --> F["exit 35/60: TLS or cert failure"]',
        '    C -- "yes" --> D["Request sent, response received"]',
        '    D --> G{"HTTP status >= 400?"}',
        '    G -- "yes, and -f given" --> H["exit 22: HTTP error"]',
        '    G -- "yes, no -f" --> I["exit 0 with error body (the trap)"]',
        '    G -- "no" --> J["exit 0 with body"]',
      ].join("\n"),
  },

  chmod: {
    concept: "File permissions",
    summary: "changes the mode bits on files and directories",
    lens: lens(
      {
        what: "Every file has read, write and execute bits for its owner, its group, and everyone else. `chmod +x file` makes a script runnable; `chmod 644 file` means owner read/write, everyone else read.",
        how: "Read the octal as three digits, one per audience: 4 read, 2 write, 1 execute, added together. 755 is the normal mode for a script, 644 for a plain file.",
        tradeoffs: "Narrow permissions are inconvenient exactly once, when you hit them. Wide permissions are convenient right up until they are the incident.",
      },
      {
        what: "On a directory, execute means 'may traverse' and write means 'may create or delete entries', which is why deleting a file needs write on the directory rather than on the file.",
        how: "Prefer symbolic modes for intent: `chmod u+rw,go-rwx secrets.env`. `-R` recurses, and `find -type d -exec chmod 755` plus `-type f -exec chmod 644` avoids marking every file executable.",
        tradeoffs: "`chmod -R 777` fixes access by removing the control, permanently, on every file it touches. The real fix is nearly always ownership or group.",
      },
      {
        what: "Mode bits plus setuid/setgid/sticky, evaluated against process uid/gid, and possibly overridden by ACLs or SELinux. The umask decides what new files get.",
        how: "Least privilege, group ownership for shared access, sticky bit on shared temp directories, and setuid only when you can defend the binary. Audit with `find -perm`.",
        tradeoffs: "POSIX modes are coarse; ACLs are precise and invisible to anyone reading `ls -l`. Choose the one your team will actually understand six months later.",
      },
    ),
    pitfalls: [
      "`chmod 777` is almost never the fix. Narrow the owner or group instead.",
      "`chmod -R 755` on a source tree marks every file executable, including ones that should not be.",
      "Deleting a file needs write on its *directory*, not on the file.",
    ],
    docs: [man("chmod"), { label: "Coreutils: chmod", url: "https://www.gnu.org/software/coreutils/manual/html_node/chmod-invocation.html" }],
  },

  kubectl: {
    concept: "Kubernetes control plane operations",
    summary: "reads and mutates cluster state through the API server",
    lens: lens(
      {
        what: "`kubectl` talks to a cluster's API server. Your kubeconfig context decides *which* cluster, and it persists between sessions, so the same command can hit staging today and production tomorrow.",
        how: "`kubectl config current-context` first, always. Then `get pods -A` to see state, `describe pod <name>` for events, `logs <pod>` for output.",
        tradeoffs: "Enormous reach, no confirmation prompts. The habit of checking your context is the only thing between you and the wrong cluster.",
      },
      {
        what: "A declarative API: you submit desired state, controllers reconcile towards it. `apply` is the declarative path, `edit` and `delete` are imperative and leave no record.",
        how: "`apply -f` from files in version control, `diff -f` before applying, `-o yaml` to see what the server actually stored, `--dry-run=server` to validate against admission control.",
        tradeoffs: "Imperative commands are fast and untracked; declarative manifests are slower and auditable. Anything that outlives the incident belongs in a file.",
      },
      {
        what: "Every action is an authenticated, RBAC-checked API call, audit-logged server side. Reconciliation is eventually consistent, so a successful command means accepted, not applied.",
        how: "Least-privilege RBAC per human and per pipeline, no shared admin kubeconfigs, `--dry-run=server` in review, and separate contexts with names that make production obvious.",
        tradeoffs: "Direct kubectl access is the fastest incident tool and the weakest change control. GitOps trades minutes of latency for a reviewable history.",
      },
    ),
    pitfalls: [
      "The context persists between sessions. Check `current-context` before anything destructive.",
      "A command that returns successfully means the API accepted it, not that the cluster has converged.",
      "`delete` on a resource managed by a controller may just get recreated, or may cascade further than you expect.",
    ],
    docs: [
      { label: "kubectl reference", url: "https://kubernetes.io/docs/reference/kubectl/" },
      { label: "kubectl cheat sheet", url: "https://kubernetes.io/docs/reference/kubectl/quick-reference/" },
    ],
  },

  terraform: {
    concept: "Declarative infrastructure",
    summary: "plans and applies changes to real infrastructure from configuration",
    lens: lens(
      {
        what: "You describe the infrastructure you want; terraform compares that to its state file and tells you what it would change. `plan` proposes, `apply` executes.",
        how: "`terraform plan -out=tfplan`, read every line of the plan, then `terraform apply tfplan`. Never apply something you have not read.",
        tradeoffs: "Repeatable infrastructure with a reviewable diff. The cost is that the state file becomes a critical asset in its own right.",
      },
      {
        what: "State maps configuration to real resource ids. Drift is any difference between the three. `plan` output is a diff between config and state, refreshed against the provider.",
        how: "Remote state with locking, a saved plan file for every apply, `-target` only in emergencies, and modules for anything used twice.",
        tradeoffs: "A bare `apply` re-plans against the world as it is now, so what you reviewed is not necessarily what runs. That is the whole reason to save the plan.",
      },
      {
        what: "Provider graph resolution, dependency ordering, and a state lock as the concurrency control. `destroy` and `replace` are irreversible against real infrastructure.",
        how: "Policy as code in the pipeline, plan artefacts attached to the change record, state encrypted with restricted access, and no human credentials that can apply directly to production.",
        tradeoffs: "Terraform is excellent at converging declared resources and poor at orchestrating sequenced operational change. Know which one you are doing.",
      },
    ),
    pitfalls: [
      "`apply` without a saved plan file re-plans, so what runs may not be what you reviewed.",
      "The state file is as sensitive as the infrastructure it describes; it often contains secrets.",
      "`-target` hides drift rather than resolving it, and leaves state further from config than when you started.",
    ],
    docs: [
      { label: "Terraform CLI docs", url: "https://developer.hashicorp.com/terraform/cli" },
      { label: "Terraform: plan and apply", url: "https://developer.hashicorp.com/terraform/cli/commands/plan" },
    ],
  },

  cd: {
    concept: "Changing the working directory",
    summary: "moves the shell's current directory",
    lens: lens(
      {
        what: "`cd path` moves you into a directory so relative paths resolve from there. `cd ..` goes up one, `cd` alone goes home, `cd -` goes back to where you just were.",
        how: "Follow every `cd` with `pwd` until relative paths stop surprising you. Chain them (`cd dir && ls`) so a failed move does not silently run the next command somewhere else.",
        tradeoffs: "There is nothing to weigh; the mistake is assuming the move worked. `cd` into a missing directory fails and leaves you where you were.",
      },
      {
        what: "`cd` is a shell builtin, not a program: it has to be, because a child process cannot change its parent's directory. That is why a script's `cd` never affects the shell that ran it.",
        how: "In scripts, `cd -- \"$dir\" || exit 1`. Use a subshell `( cd dir && cmd )` when you want the move scoped to one command, and `pushd`/`popd` when you need a stack.",
        tradeoffs: "`cd` in a script makes it position-dependent. Deriving absolute paths once at start-up costs two lines and removes a class of bug.",
      },
      {
        what: "It mutates kernel-held cwd on the shell process, inherited by every child thereafter. `CDPATH` can make it resolve somewhere unexpected, which is a genuine scripting hazard.",
        how: "`unset CDPATH` at the top of a script, prefer absolute paths derived from `$(cd \"$(dirname \"$0\")\" && pwd -P)`, and never let an unquoted variable reach `cd`.",
        tradeoffs: "Relying on the caller's cwd is convenient interactively and fragile in cron, CI or a systemd unit, where cwd is whatever the launcher chose.",
      },
    ),
    pitfalls: [
      "`cd` in a script cannot change the directory of the shell that ran the script; only a sourced file can.",
      "A failed `cd` leaves you where you were, so an unchecked `cd` followed by `rm -rf *` runs in the wrong place.",
      "`CDPATH` can silently send `cd foo` somewhere other than `./foo`.",
    ],
    docs: [{ label: "Bash: cd", url: "https://www.gnu.org/software/bash/manual/bash.html#index-cd" }],
  },

  mkdir: {
    concept: "Creating directories",
    summary: "makes directories, optionally with parents",
    lens: lens(
      {
        what: "`mkdir name` creates one directory. `mkdir -p a/b/c` creates the whole chain and does not complain if it already exists.",
        how: "Use `-p` almost always: it is the difference between a command you can run twice and one that errors the second time.",
        tradeoffs: "`-p` hides the case where the directory already existed. That is usually what you want, and occasionally the thing you needed to know.",
      },
      {
        what: "Creates a directory entry with a mode of 0777 masked by your umask, so the result is normally 0755. `-p` makes intermediate directories and turns 'already exists' into success.",
        how: "`mkdir -p` for idempotence, `-m` when the mode matters (a secrets directory should be `-m 700`), and `mkdir -p \"$(dirname \"$file\")\"` before writing a file to a path that may not exist.",
        tradeoffs: "Two processes racing to `mkdir -p` the same tree both succeed, which is why it is safe in parallel builds. Plain `mkdir` failing is sometimes the lock you want.",
      },
      {
        what: "A single `mkdirat` per component. Non-atomic across a chain with `-p`, so the tree can be partially built if it fails midway. Plain `mkdir` *is* atomic, which makes it a valid lock primitive.",
        how: "`mkdir -m 700` rather than mkdir-then-chmod, which leaves a window where the directory is world-readable. For temp space use `mktemp -d`, never a predictable name in `/tmp`.",
        tradeoffs: "A predictable directory name in a shared location is a symlink-attack surface. `mktemp -d` costs nothing and closes it.",
      },
    ),
    pitfalls: [
      "Without `-p`, a missing parent is an error and running the command twice is also an error.",
      "The new directory's permissions come from your umask, so `mkdir` then `chmod` leaves a brief window where it is too open. Use `-m`.",
      "Creating a directory needs write permission on its *parent*.",
    ],
    docs: [man("mkdir")],
  },

  touch: {
    concept: "Creating files and updating timestamps",
    summary: "creates an empty file, or updates an existing file's timestamps",
    lens: lens(
      {
        what: "`touch file` creates the file if it does not exist, and if it does, leaves the contents alone and just updates its modification time.",
        how: "Use it to create a file you are about to write to, or to check you have permission to write in a directory at all.",
        tradeoffs: "It is safe on an existing file: nothing is overwritten. That is precisely the difference between `touch file` and `> file`.",
      },
      {
        what: "Updates atime and mtime to now, creating the file with an empty size if needed. `-t`/`-d` set an explicit time, `-c` skips creation, `-r` copies another file's timestamps.",
        how: "In builds, `touch` is how you invalidate or satisfy a timestamp-based dependency. `touch -c` when you only want to bump something that already exists.",
        tradeoffs: "Timestamp-driven builds are fast and fragile: a clock skew or a restored backup can make a stale artefact look fresh. Content hashing is slower and correct.",
      },
      {
        what: "A `utimensat` call, plus an `openat` with O_CREAT when the file is absent. mtime is what make and rsync compare; ctime changes too but cannot be set.",
        how: "Never use `touch` as a lock: create-if-absent is not atomic here. Use `mkdir` or `set -o noclobber` with `>` for that, or `flock` where available.",
        tradeoffs: "Because ctime cannot be forged, timestamp manipulation is detectable. Auditability argues for content-addressed builds over mtime.",
      },
    ),
    pitfalls: [
      "`touch file` preserves contents; `> file` destroys them. They look similarly harmless and are not.",
      "`touch` is not a lock: the check and the create are not atomic, so two processes can both think they won.",
      "Updating mtime can make a stale build artefact look current.",
    ],
    docs: [man("touch")],
  },

  cat: {
    concept: "Reading and concatenating files",
    summary: "writes files to stdout, in order",
    lens: lens(
      {
        what: "`cat file` prints a file. Given several files it prints them one after another, which is where the name comes from: concatenate.",
        how: "Fine for short files. For anything long use `less` (scrollable, quits with `q`), and for the start or end use `head` or `tail`.",
        tradeoffs: "`cat` on a huge file floods your terminal, and on a binary file can leave it in a broken state. `reset` fixes the terminal if that happens.",
      },
      {
        what: "Copies bytes from each argument to stdout with no interpretation. `-n` numbers lines, `-A` reveals tabs, line endings and non-printing characters.",
        how: "`cat -A` is the fastest way to find a stray carriage return or trailing whitespace. Prefer `cmd < file` over `cat file | cmd`: the redirect does the same thing with one process.",
        tradeoffs: "`cat file | grep x` works but spawns a process for nothing. It is harmless at the prompt and worth avoiding in a loop.",
      },
      {
        what: "A byte pump. It does not buffer whole files, so it streams safely, and it will happily emit control sequences your terminal will act on.",
        how: "Use `--` before untrusted filenames. For structured data reach for a parser; `cat` plus `grep` on JSON is a heuristic that eventually matches the wrong line.",
        tradeoffs: "Streaming bytes is universal and type-blind. That is the entire trade the Unix pipeline makes, and it is why output parsing is the fragile part of any shell pipeline.",
      },
    ),
    pitfalls: [
      "`cat` on a binary file can leave your terminal unusable; `reset` recovers it.",
      "`cat file | cmd` spawns a process to do what `cmd < file` does for free.",
      "For files that will not fit on a screen, `less` is the tool you actually wanted.",
    ],
    docs: [man("cat")],
  },

  cp: {
    concept: "Copying files",
    summary: "copies files and directory trees",
    lens: lens(
      {
        what: "`cp source dest` makes a copy. If `dest` is an existing directory the copy goes inside it; otherwise `dest` is the new file's name. `-r` copies a whole directory.",
        how: "Copy before you edit anything you care about: `cp config.yml config.yml.bak`. Use `-i` while you are learning, so an existing destination prompts instead of vanishing.",
        tradeoffs: "`cp` overwrites the destination silently by default. That default is why `-i` and `-n` exist.",
      },
      {
        what: "Reads and writes contents, creating a new inode. Metadata is not preserved unless you ask: `-p` keeps mode and timestamps, `-a` keeps essentially everything including symlinks.",
        how: "`-a` for backups and deploys, `-n` to refuse overwriting, `-u` to copy only when newer. A trailing slash on the source matters to `rsync`, not to `cp`.",
        tradeoffs: "For anything large or repeated, `rsync -a` beats `cp -a`: it is resumable, reports progress, and can verify. `cp` is fine for one file.",
      },
      {
        what: "Not atomic. A destination is truncated then written, so a reader can observe a partial file and an interrupted copy leaves one behind. Sparse files and hard links need explicit flags.",
        how: "For an atomic replace, copy to a temp name in the same filesystem then `mv` over the target: rename is atomic, write is not. `--reflink=auto` on CoW filesystems makes large copies nearly free.",
        tradeoffs: "Atomic-replace-by-rename needs both paths on one filesystem and doubles peak space. The alternative is a window where the file is half written.",
      },
    ),
    pitfalls: [
      "`cp` overwrites the destination without asking. `-i` prompts, `-n` refuses.",
      "Without `-p` or `-a`, the copy gets fresh timestamps and your current umask, not the original's metadata.",
      "A copy is not atomic: interrupt it and you have a partial file where the old one used to be.",
    ],
    docs: [man("cp")],
  },

  mv: {
    concept: "Moving and renaming",
    summary: "renames a path, or moves it between directories",
    lens: lens(
      {
        what: "`mv old new` renames. `mv file dir/` moves it into a directory. There is no separate rename command in Unix, because renaming and moving are the same operation.",
        how: "Check the destination first with `ls`. If `new` already exists as a file, it is replaced without a word; `-i` makes it ask.",
        tradeoffs: "Renaming is instant within a filesystem and a full copy across one. That is why moving a large directory to another disk is slow and interruptible.",
      },
      {
        what: "Within one filesystem it is a `rename` syscall: atomic, and the inode does not change. Across filesystems it degrades to copy-then-delete, which is neither atomic nor cheap.",
        how: "`mv -n` never overwrites, `-i` prompts, `-v` shows what moved. Use `mv` to publish a file you wrote under a temp name: the rename is the atomic swap.",
        tradeoffs: "Same-filesystem moves are free and safe. Cross-filesystem moves can half-fail and leave the source in place, which your script should check for.",
      },
      {
        what: "`rename(2)` atomically replaces the destination entry, so readers see either the old file or the new one and never a partial state. Open file descriptors on the replaced file keep working.",
        how: "Write-temp-then-rename is the standard durable-update pattern; add an `fsync` on the file and its directory if the update must survive a power cut.",
        tradeoffs: "Atomicity is confined to a single filesystem. Anything crossing a mount point needs the copy-verify-delete dance done explicitly.",
      },
    ),
    pitfalls: [
      "`mv` replaces an existing destination without asking. `-n` refuses, `-i` prompts.",
      "Across filesystems it is a copy, so it is slow, not atomic, and can leave the source behind on failure.",
      "`mv dir1 dir2` where `dir2` exists moves dir1 *inside* dir2 rather than renaming it.",
    ],
    docs: [man("mv")],
  },

  printf: {
    concept: "Formatted, portable output",
    summary: "writes formatted text, without echo's portability traps",
    lens: lens(
      {
        what: "`printf '%s\\n' hello` prints `hello` and a newline. Unlike `echo`, you say explicitly where newlines go, so the output is exactly what you asked for.",
        how: "Learn two things: `%s` for a string, `\\n` for a newline. `printf '%s\\n' a b c` reuses the format for each argument, printing one per line.",
        tradeoffs: "It is a little more typing than `echo`, and in exchange it behaves the same in every shell on every machine.",
      },
      {
        what: "The format string is reused until the arguments run out. `%d`, `%s`, `%q` (shell-quoted) and width/precision specifiers all work as in C.",
        how: "Never put data in the format string: `printf '%s\\n' \"$var\"`, not `printf \"$var\"`. A `%` inside a variable would otherwise be interpreted as a specifier.",
        tradeoffs: "`echo` is shorter and its handling of `-n`, `-e` and backslashes differs between bash, zsh, dash and /bin/echo. That inconsistency is the whole reason to use printf.",
      },
      {
        what: "A shell builtin in practice, so no fork. `%b` interprets escapes in the argument, `%q` emits reusably-quoted output — the correct way to generate shell code from data.",
        how: "Use `printf '%q'` when generating commands, `%s` with an explicit `\\0` for NUL-delimited pipelines, and keep the format a literal so untrusted input cannot become a specifier.",
        tradeoffs: "printf formatting in a hot loop is still a shell loop. Past a few thousand lines, awk or a real language wins.",
      },
    ),
    pitfalls: [
      "Never pass data as the format string: a `%` in the value gets interpreted. `printf '%s\\n' \"$var\"`.",
      "`echo`'s treatment of `-n`, `-e` and backslashes is not portable; printf's is.",
      "The format repeats until arguments are exhausted, which is a feature and a surprise the first time.",
    ],
    docs: [man("printf"), { label: "POSIX printf", url: "https://pubs.opengroup.org/onlinepubs/9699919799/utilities/printf.html" }],
  },

  set: {
    concept: "Shell options and strict mode",
    summary: "sets shell behaviour flags for the current shell or script",
    lens: lens(
      {
        what: "`set -e` makes the shell exit as soon as a command fails, instead of carrying on. `set -u` treats an unset variable as an error. `set -o pipefail` makes a pipeline fail if any stage fails.",
        how: "Put `set -euo pipefail` at the top of every script you write. It turns silent, cascading failure into a clear stop at the line that broke.",
        tradeoffs: "Without it, a script that fails halfway keeps running against a broken state, which is how a backup script cheerfully uploads nothing.",
      },
      {
        what: "Options for the current shell. `-e` exits on non-zero (with a long list of exemptions: conditions, `&&` chains, `!`), `-u` errors on unset expansion, `-x` traces every command, `pipefail` propagates the leftmost failure in a pipeline.",
        how: "`set -x` to debug a script, `set +x` to stop. Guard expected failures explicitly with `|| true` or `if cmd; then`, since those are exempt from `-e` anyway.",
        tradeoffs: "`-e` has genuinely surprising exemptions, so it is a safety net rather than a guarantee. `-u` breaks on `\"$1\"` when a script is called with no arguments, which is usually a bug it just found.",
      },
      {
        what: "Flags on the shell execution environment, inherited by subshells but not by executed programs. `-e` does not fire inside a command substitution used in an assignment, which is the classic silent hole.",
        how: "Combine with `trap 'code' ERR` for diagnostics, `set -o noclobber` to make `>` refuse to truncate, and `IFS=$'\\n\\t'` alongside strict mode to defang word splitting.",
        tradeoffs: "Strict mode changes control flow, so retrofitting it onto an old script will surface failures it has been swallowing for years. That is the point, and it should be done deliberately.",
      },
    ),
    pitfalls: [
      "`set -e` does not fire in a condition, in an `&&` chain's left side, or in an assignment's command substitution.",
      "`set -u` makes `\"$1\"` an error when no argument was passed. Use `\"${1:-}\"` where absence is legitimate.",
      "Without `pipefail`, `false | true` succeeds and your script never notices.",
    ],
    docs: [{ label: "Bash: The Set Builtin", url: "https://www.gnu.org/software/bash/manual/bash.html#The-Set-Builtin" }],
  },

  trap: {
    concept: "Cleanup and signal handling",
    summary: "runs code when the shell exits or receives a signal",
    lens: lens(
      {
        what: "`trap 'rm -f \"$tmp\"' EXIT` runs that command whenever the script finishes, whether it succeeded, failed, or was interrupted. It is how a script cleans up after itself.",
        how: "Create your temp file, set the trap immediately, then get on with the work. Setting the trap after the risky part defeats the purpose.",
        tradeoffs: "There is no cost worth mentioning. A script without cleanup leaves temp files behind on every failure, and failures are the common case.",
      },
      {
        what: "Registers a handler per signal or pseudo-signal. `EXIT` fires on any exit, `ERR` on a failing command under `-e`, `INT`/`TERM` on interruption. A later `trap` for the same signal replaces the earlier one.",
        how: "One `EXIT` trap calling a `cleanup()` function, rather than several traps overwriting each other. `trap - EXIT` clears it. Quote with single quotes so the body expands when it runs, not when it is set.",
        tradeoffs: "Traps do not fire on SIGKILL, so cleanup is best-effort. Anything that must not leak needs a reaper elsewhere.",
      },
      {
        what: "Handlers run between commands, not preemptively, so a long-running child delays them until it returns. In a pipeline, each stage is a subshell with its own trap state.",
        how: "Make handlers idempotent and fast, forward signals to children explicitly (`trap 'kill -TERM $child' TERM`), and remember `wait` is what lets a handler run while a child is alive.",
        tradeoffs: "Signal handling in shell is coarse compared with a real supervisor. For anything that needs reliable lifecycle management, systemd or a process manager is the right tool.",
      },
    ),
    pitfalls: [
      "Set the trap *before* the code that needs cleaning up, or the window it was meant to cover is the window it misses.",
      "SIGKILL cannot be trapped, so cleanup is best-effort by nature.",
      "Double-quoting a trap body expands the variables when the trap is set, not when it fires.",
    ],
    docs: [{ label: "Bash: Signals and trap", url: "https://www.gnu.org/software/bash/manual/bash.html#Signals" }],
  },

  test: {
    concept: "Conditions and exit codes",
    summary: "evaluates a condition and exits 0 for true",
    lens: lens(
      {
        what: "`test -f file` (also written `[ -f file ]`) checks whether something is true and says so through its exit code: 0 for yes. That is what `if` reads.",
        how: "`-f` file exists, `-d` directory, `-z` empty string, `-n` non-empty, `=` strings equal, `-eq` numbers equal. Combine with `&&` and `||`.",
        tradeoffs: "The syntax is fussy about spaces — `[ -f x ]` needs both — because `[` is a command, not punctuation.",
      },
      {
        what: "`[` is a program (and a builtin) whose last argument must be `]`. Unquoted empty variables collapse the argument list and change the expression's meaning, which is the classic source of `[: too many arguments`.",
        how: "Always quote: `[ -n \"$var\" ]`. In bash prefer `[[ ... ]]`, which does not word-split, supports `&&`/`||` inside, and adds pattern and regex matching.",
        tradeoffs: "`[[ ]]` is safer and bash-specific; `[ ]` is portable to any POSIX shell. Choose per script and say which shell it needs in the shebang.",
      },
      {
        what: "String comparison with `=` and numeric with `-eq` are different operators over different types; using the wrong one silently compares the wrong thing. `-a`/`-o` inside `test` have surprising precedence.",
        how: "Use separate `[ ]` invocations joined by `&&`/`||` rather than `-a`/`-o`. Prefer `[[ ]]` with `==` for patterns and `=~` for regex when the shell is known to be bash.",
        tradeoffs: "Shell conditionals are untyped and fail open. Anything with real logic in it belongs in a language with types, not in a longer chain of brackets.",
      },
    ),
    pitfalls: [
      "`[` is a command, so `[-f x]` and `[ -f x]` are both syntax errors. The spaces are mandatory.",
      "An unquoted empty variable makes `[ -n $var ]` true, because the argument disappears entirely.",
      "`=` compares strings and `-eq` compares numbers; `[ 01 -eq 1 ]` is true while `[ 01 = 1 ]` is false.",
    ],
    docs: [man("test"), { label: "Bash: Conditional Constructs", url: "https://www.gnu.org/software/bash/manual/bash.html#Conditional-Constructs" }],
  },

  command: {
    concept: "Looking up and bypassing commands",
    summary: "resolves a command name, ignoring shell functions and aliases",
    lens: lens(
      {
        what: "`command -v git` prints where `git` would come from, or nothing and a non-zero exit if it is not installed. It is the portable way to ask 'do I have this?'",
        how: "`command -v tool >/dev/null || echo 'install tool'` is the standard availability check. It works in every POSIX shell.",
        tradeoffs: "`which` looks friendlier and is not standardised: its exit codes and output differ between systems, and it does not see shell builtins.",
      },
      {
        what: "Also runs a command while ignoring shell functions and aliases, which is how a wrapper function calls the real thing without recursing forever.",
        how: "`command -v` to test, `command -p` to use a guaranteed-sane PATH, and `command ls` inside a function named `ls` to reach the real binary.",
        tradeoffs: "`type -a` (bash) tells you *everything* a name resolves to, which is more informative for debugging and less scriptable.",
      },
      {
        what: "Resolution order is alias, then function, then builtin, then PATH. `command` skips the first two, `enable -n` disables a builtin, and `env`/absolute paths bypass everything.",
        how: "In hardened scripts, resolve tools once into variables with `command -v`, set an explicit `PATH`, and fail fast when something is missing rather than mid-run.",
        tradeoffs: "Pinning absolute paths is reproducible and brittle across distributions. Resolving via `command -v` at start-up is the usual compromise.",
      },
    ),
    pitfalls: [
      "`which` is not POSIX and its exit code cannot be relied on; `command -v` can.",
      "`command -v` finds builtins and functions too, so a hit does not always mean an executable file exists.",
      "Checking for a tool at the point of use means failing halfway through. Check everything up front.",
    ],
    docs: [{ label: "POSIX command", url: "https://pubs.opengroup.org/onlinepubs/9699919799/utilities/command.html" }],
  },

  sh: {
    concept: "Invoking a shell",
    summary: "runs a shell, a script, or a command string",
    lens: lens(
      {
        what: "`sh script.sh` runs a script with the system shell, and `sh -n script.sh` checks it for syntax errors without running any of it. Running via `sh` needs only read permission, not the execute bit.",
        how: "`sh -n` before you run anything you just wrote. `sh -x script.sh` traces each line as it executes, which is usually faster than adding echoes.",
        tradeoffs: "`sh script.sh` ignores the script's own shebang, so a bash script run this way loses every bash feature it depends on.",
      },
      {
        what: "`/bin/sh` is a POSIX shell, which on Debian is dash and on macOS is bash in POSIX mode. Anything bash-specific — arrays, `[[ ]]`, `local` — may or may not exist.",
        how: "Declare the interpreter in the shebang and invoke the script directly. Use `sh -c 'cmd'` only when you genuinely need a shell for redirection or expansion.",
        tradeoffs: "Targeting `sh` maximises portability and costs you arrays, process substitution and safer conditionals. Targeting bash is convenient and needs bash present.",
      },
      {
        what: "`sh -c` is also the shape that defeats every static safety check: the command is data, invisible until it runs. That is exactly why this server's screen flags it rather than trusting it.",
        how: "Avoid building `sh -c` strings from variables. Pass an argv array from your language's process API instead, so no shell parses attacker-influenced text.",
        tradeoffs: "A shell buys you globbing, pipes and expansion. It also buys you an injection surface. If you do not need the features, do not spawn the shell.",
      },
    ),
    pitfalls: [
      "`sh script.sh` overrides the shebang, so bash-only syntax fails in confusing ways.",
      "`/bin/sh` is not bash on most Linux distributions; `[[ ]]` and arrays may not exist.",
      "`sh -c \"$untrusted\"` is command injection by construction. Pass an argument array instead.",
    ],
    docs: [man("sh"), { label: "POSIX shell", url: "https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html" }],
  },

  node: {
    concept: "The Node.js runtime",
    summary: "runs JavaScript outside a browser",
    lens: lens(
      {
        what: "`node file.js` runs a JavaScript file. `node --version` tells you which Node you have, which matters because tools declare a minimum and fail confusingly below it.",
        how: "Check the version first when anything in a JS project misbehaves. `node -e 'console.log(1)'` runs a one-liner without a file.",
        tradeoffs: "Node is the runtime; npm is the package manager. Confusing the two is the source of a lot of early frustration.",
      },
      {
        what: "A V8 event loop with a single JS thread, plus a thread pool for filesystem and crypto work. Version differences change available syntax, native module ABI, and default global fetch.",
        how: "Pin the version with `.nvmrc` or `engines`, and use `nvm`/`fnm` locally so projects do not fight. `node --enable-source-maps` makes stack traces readable in TypeScript builds.",
        tradeoffs: "The single thread makes concurrency cheap for IO and useless for CPU. Anything compute-heavy needs worker threads or another process.",
      },
      {
        what: "Native modules bind to a specific ABI, so a Node upgrade can break `node_modules` in ways only a rebuild fixes. ESM and CJS resolution differ, and `type` in package.json decides which applies.",
        how: "Match CI's Node to production's exactly. `--max-old-space-size` for heap limits, `--experimental-*` flags only behind a documented decision, and `node --test` for a dependency-free test runner.",
        tradeoffs: "Node's release cadence buys you a fast-moving standard library and a maintenance burden. LTS-only is the boring, correct policy for anything shipped.",
      },
    ),
    pitfalls: [
      "A native module built for one Node major version breaks on another; delete `node_modules` and reinstall rather than debugging the symptom.",
      "`node --version` and the version your CI uses drifting apart is a whole class of 'works locally' bug.",
      "Node is not npm. A missing `npm` does not mean Node is missing.",
    ],
    docs: [
      { label: "Node.js CLI docs", url: "https://nodejs.org/api/cli.html" },
      { label: "Node.js releases", url: "https://nodejs.org/en/about/previous-releases" },
    ],
  },

  tsc: {
    concept: "TypeScript type checking and compilation",
    summary: "type-checks TypeScript and optionally emits JavaScript",
    lens: lens(
      {
        what: "`tsc` reads `tsconfig.json`, checks your types and writes JavaScript. `tsc --noEmit` does the checking without producing files, which is what you want as a fast correctness check.",
        how: "Run `npx tsc --noEmit` before you commit. Read the first error, not the last: later errors are often consequences of the first.",
        tradeoffs: "Type checking catches a whole category of bug for free. It costs a build step and some annotations.",
      },
      {
        what: "A whole-program checker: configuration decides module resolution, target, and strictness, and those choices change what compiles. `--noEmit` separates checking from building, which lets a bundler own emit.",
        how: "Turn `strict` on. Use `--noEmit` in CI plus a bundler for output, or project references for a monorepo. `--watch` for a fast local loop.",
        tradeoffs: "`skipLibCheck` speeds up builds by not checking dependency types, at the cost of missing genuine conflicts between them. Most projects take that trade knowingly.",
      },
      {
        what: "Types are erased at runtime: nothing tsc checks survives into the JavaScript, so no type is a validation boundary. Module resolution mode has to match the runtime's or imports resolve differently at build and run time.",
        how: "Validate untrusted input at the edges with a schema library rather than a cast. Keep `moduleResolution` aligned with the runtime, and treat `any` and non-null assertions as review-worthy.",
        tradeoffs: "Stricter settings surface real bugs and slow down migration. Ratcheting strictness per directory beats a big-bang flag flip nobody has time for.",
      },
    ),
    pitfalls: [
      "Types vanish at runtime, so a type is never input validation.",
      "`tsc` with no `tsconfig.json` in scope uses defaults that are almost never what the project wants.",
      "Fix the first error first; the rest are frequently downstream of it.",
    ],
    docs: [
      { label: "tsc CLI options", url: "https://www.typescriptlang.org/docs/handbook/compiler-options.html" },
      { label: "tsconfig reference", url: "https://www.typescriptlang.org/tsconfig" },
    ],
  },

  eslint: {
    concept: "Static analysis for JavaScript and TypeScript",
    summary: "reports and fixes code-quality and correctness issues",
    lens: lens(
      {
        what: "`eslint .` checks your code against a set of rules and prints what it does not like. `--fix` corrects the mechanical ones automatically.",
        how: "`npx eslint . --max-warnings=0` in CI. Fix the errors; if a warning is never going to be fixed, either promote it to an error or delete the rule.",
        tradeoffs: "A linter catches real bugs (unused variables, unreachable code, bad awaits) alongside style opinions. The style ones are worth automating, not arguing about.",
      },
      {
        what: "Rules operate on the AST; type-aware rules need a parser project and are much slower. Warnings are advisory by default, which means CI passes with a growing pile of them.",
        how: "`--max-warnings=0` so warnings cannot accumulate, `--cache` for speed, and a formatter (Prettier or `eslint --fix`) owning formatting so review is about behaviour.",
        tradeoffs: "Type-aware linting finds more and costs minutes on a large repo. Splitting a fast pre-commit pass from a full CI pass is the usual answer.",
      },
      {
        what: "Config resolution (flat config versus eslintrc, plugin peer versions) is where most 'works on my machine' lint failures come from. `--fix` rewrites source, so it must not run on a dirty tree unattended.",
        how: "Pin plugin versions, commit the config, run `--fix` only in a clean tree or as its own commit, and treat rule changes as a codebase-wide migration, not a config tweak.",
        tradeoffs: "Rules that fire on legitimate patterns train people to add disable comments, which is worse than not having the rule. Prune aggressively.",
      },
    ),
    pitfalls: [
      "Warnings nobody fails on are warnings nobody reads. Use `--max-warnings=0`.",
      "`--fix` rewrites files, so run it on a clean tree or you cannot tell your changes from its changes.",
      "Type-aware rules need the TypeScript project wired into the config, or they silently do less than you think.",
    ],
    docs: [
      { label: "ESLint CLI", url: "https://eslint.org/docs/latest/use/command-line-interface" },
      { label: "Configuring ESLint", url: "https://eslint.org/docs/latest/use/configure/" },
    ],
  },

  lsof: {
    concept: "Which process holds a file or port",
    summary: "lists open files, including sockets",
    lens: lens(
      {
        what: "`lsof -nP -iTCP -sTCP:LISTEN` lists what is listening on which port. It is the answer to 'address already in use': something already has the port you want.",
        how: "Read the PID and COMMAND columns, then decide. `-n` skips DNS lookups and `-P` skips port-name lookups, which is why the command is fast in that form.",
        tradeoffs: "It tells you what to kill; it does not tell you whether killing it is safe. Look at the command name before you act.",
      },
      {
        what: "Everything in Unix is a file descriptor, so one tool covers regular files, sockets, pipes and deleted-but-open files. `lsof +D dir` finds who holds a directory; `lsof -p PID` inventories one process.",
        how: "`lsof | grep deleted` finds the deleted log still consuming disk — the reason `df` and `du` disagree. On Linux `ss -ltnp` is faster for sockets alone.",
        tradeoffs: "A full `lsof` scan walks every process's fd table and needs privileges to see other users'. Targeted queries are orders of magnitude cheaper.",
      },
      {
        what: "Reads `/proc` (or kernel structures) per process, so output is a snapshot that can be stale by the time you read it. Unprivileged runs silently omit other users' descriptors, which reads as 'nothing found'.",
        how: "For monitoring, prefer `ss`/`netstat` with explicit filters or a supervisor's own state. Use `fuser -k` deliberately, never as reflex, and prefer SIGTERM before SIGKILL.",
        tradeoffs: "Diagnosing by fd inventory is powerful and racy. If you need certainty about who owns a port, own it explicitly with a supervisor.",
      },
    ),
    pitfalls: [
      "Without root you only see your own processes, and an empty result looks like 'nothing is listening'.",
      "A deleted-but-open file still occupies disk, which is why `df` and `du` can disagree by gigabytes.",
      "The output is a snapshot; the PID may be gone before you type `kill`.",
    ],
    docs: [man("lsof"), { label: "ss (iproute2)", url: "https://man7.org/linux/man-pages/man8/ss.8.html" }],
  },

  df: {
    concept: "Filesystem capacity",
    summary: "reports free and used space per mounted filesystem",
    lens: lens(
      {
        what: "`df -h` shows how full each disk is, in human-readable units. A full disk causes bugs that look like anything except a full disk, so this is an early check.",
        how: "Look at the Use% and Mounted-on columns together: it matters which filesystem is full, not that some filesystem is.",
        tradeoffs: "Read-only and instant. There is no reason not to run it when something inexplicable is happening.",
      },
      {
        what: "Reports per-mount statistics from the filesystem itself, not by walking files, so it is O(1) rather than O(files). `df -i` reports inodes, a separate exhaustible resource.",
        how: "`df -h` for space, `df -i` when writes fail with space apparently free, and `df -h /path` to find which mount a path actually lives on.",
        tradeoffs: "`df` counts blocks the filesystem has allocated; `du` counts what files claim. Deleted-but-open files and reserved blocks make them disagree, and `df` is the one that decides whether writes fail.",
      },
      {
        what: "Reserved blocks (typically 5% on ext4) mean 100% for a normal user is not 100% for root, so a service can start failing while root can still write. Snapshots and thin provisioning break the mental model further.",
        how: "Alert on both space and inodes, per mount, with headroom above the reserve. Monitor the growth rate, not just the level: a disk at 60% filling 10%/hour is the incident.",
        tradeoffs: "Filesystem-reported space is authoritative for writes and misleading about what is consuming it. Pair with `du` and `lsof` for causes.",
      },
    ),
    pitfalls: [
      "`df` and `du` disagree when a deleted file is still held open by a process. `df` is the one that decides whether writes fail.",
      "A filesystem can be out of inodes with space free. `df -i` is the check.",
      "Reserved blocks mean root can still write when everyone else is getting ENOSPC.",
    ],
    docs: [man("df")],
  },

  du: {
    concept: "What is consuming space",
    summary: "sums disk usage per directory or file",
    lens: lens(
      {
        what: "`du -sh dir` prints one human-readable total for a directory. It is the follow-up to `df`: the disk is full, and this is what is filling it.",
        how: "`du -sh *` in a directory ranks its children, then descend into the biggest one. Repeat until you find the culprit.",
        tradeoffs: "It has to walk every file, so it is slow on large trees. `df` is instant but only tells you the total.",
      },
      {
        what: "Sums allocated blocks per file, so it reflects sparse files and block size rather than apparent length. `--apparent-size` reports the other number, and `-x` keeps it on one filesystem.",
        how: "`du -xh --max-depth=1 / | sort -h` is the standard 'what filled the root disk' sweep. `-x` is what stops it wandering into `/proc` and network mounts.",
        tradeoffs: "Walking a tree costs IO and cache pressure on a machine that is already unhealthy. `ncdu` is nicer interactively; `du` is what is installed.",
      },
      {
        what: "Hard links are counted once per invocation, so summing subdirectories separately double-counts them. It cannot see deleted-but-open files at all, which is the gap `lsof` fills.",
        how: "For repeated monitoring, prefer filesystem quotas or a periodic snapshot over walking the tree. On btrfs/ZFS, snapshots hold space `du` will never attribute to anything.",
        tradeoffs: "`du` explains space attributable to files. Anything else — snapshots, deleted-open files, reserved blocks — needs a different tool, and assuming otherwise sends you hunting the wrong thing.",
      },
    ),
    pitfalls: [
      "`du` walks the whole tree, so it is slow exactly when the machine is already struggling.",
      "Without `-x` it crosses into other filesystems and network mounts, and the numbers stop meaning anything.",
      "It cannot see space held by deleted-but-open files, which is often the missing gigabytes.",
    ],
    docs: [man("du")],
  },

  free: {
    concept: "Memory pressure",
    summary: "reports memory and swap usage",
    lens: lens(
      {
        what: "`free -m` shows memory in megabytes. The number to read is 'available', not 'free': Linux deliberately uses spare memory for cache, so low 'free' is normal and healthy.",
        how: "`free -m` on Linux, `vm_stat` on macOS. That is why the roadmap writes `free -m || vm_stat` — the `||` covers both hosts with one line.",
        tradeoffs: "Read-only and instant. Misreading it is the risk, not running it.",
      },
      {
        what: "buff/cache is reclaimable, so 'available' is the honest figure for how much a new process can get. Swap in use is not itself a problem; swap actively paging is.",
        how: "Watch 'available' and swap activity over time (`vmstat 1`) rather than one snapshot. In containers, cgroup limits matter more than host totals.",
        tradeoffs: "Host-level memory says little about a container's headroom. Read `/sys/fs/cgroup/memory.max` and `memory.current` for that.",
      },
      {
        what: "Numbers come from `/proc/meminfo`. Inside a container `free` typically reports the *host's* memory, not the cgroup limit, so it will happily tell you there are gigabytes free right up to an OOM kill.",
        how: "Alert on cgroup usage against the limit, watch `dmesg` for OOM kills, and set container limits explicitly rather than inheriting the host's.",
        tradeoffs: "The kernel's caching policy makes memory accounting genuinely ambiguous. Pick 'available' plus swap-in rate and stop trying to find one true number.",
      },
    ),
    pitfalls: [
      "Low 'free' is normal: Linux uses idle memory as cache. Read 'available' instead.",
      "Inside a container, `free` usually reports the host's memory, not your cgroup limit.",
      "`free` does not exist on macOS; `vm_stat` is the equivalent, with different units.",
    ],
    docs: [man("free"), { label: "/proc/meminfo", url: "https://man7.org/linux/man-pages/man5/proc.5.html" }],
  },

  uname: {
    concept: "Identifying the host",
    summary: "prints kernel, architecture and hostname information",
    lens: lens(
      {
        what: "`uname -a` prints the kernel, its version, and the machine architecture. It answers 'what am I actually on', which decides what binaries will even run.",
        how: "Run it first when a downloaded binary refuses to execute, or when instructions assume Linux and you might be on macOS.",
        tradeoffs: "Read-only. Its only weakness is that kernel identity is not the same as distribution identity.",
      },
      {
        what: "`-s` kernel name, `-r` release, `-m` machine hardware. On macOS `-m` reports `arm64`, on Linux `aarch64` — the same silicon under two names, which breaks naive download URLs.",
        how: "For distribution and version, read `/etc/os-release`, not `uname`. For portable scripts, branch on `uname -s` and normalise `uname -m` explicitly.",
        tradeoffs: "`uname` is universally available and coarse. `/etc/os-release` is precise and Linux-only.",
      },
      {
        what: "Reports the kernel's uname struct, which a container inherits from the host: a Debian container on a Fedora host reports the host kernel. Emulation layers can also report a translated architecture.",
        how: "For build matrices, drive from an explicit target triple rather than probing. Detect emulation (Rosetta, qemu-user) deliberately if the answer matters for performance.",
        tradeoffs: "Runtime probing is convenient and lies in containers and under emulation. Explicit declared targets are more work and reproducible.",
      },
    ),
    pitfalls: [
      "`uname -m` says `arm64` on macOS and `aarch64` on Linux for the same hardware.",
      "In a container, `uname` reports the *host* kernel, not the image's distribution.",
      "Kernel version is not distribution version; read `/etc/os-release` for that.",
    ],
    docs: [man("uname")],
  },

  systemctl: {
    concept: "Service state on systemd hosts",
    summary: "inspects and controls systemd units",
    lens: lens(
      {
        what: "`systemctl --failed` lists units systemd already knows are broken, which is the fastest possible start to triage. `status <unit>` shows one service's state and its last few log lines.",
        how: "Start with `--failed`, then `status` the interesting one, then `journalctl -u <unit>` for its full log. Read before you restart.",
        tradeoffs: "Restarting clears the symptom and destroys the evidence. Read the logs first, every time.",
      },
      {
        what: "Units are declarative: state, dependencies and restart policy come from unit files, not from your last command. `enable` affects boot, `start` affects now, and confusing the two is why a service comes back dead after a reboot.",
        how: "`systemctl cat <unit>` to see the effective unit, `edit --full` for an override, `daemon-reload` after any change, `is-enabled` to check boot behaviour separately from running state.",
        tradeoffs: "Declarative supervision gives you restart policies and ordering for free, at the cost of a config language to learn. Ad-hoc `nohup` gives you neither.",
      },
      {
        what: "systemd owns cgroups, so unit limits are the real resource boundary. A restart loop with `Restart=always` and no backoff can mask a failure indefinitely while burning the host.",
        how: "Set `RestartSec` and `StartLimitBurst`, run services as dedicated users, use `systemd-analyze verify` in CI, and prefer drop-ins under `/etc/systemd/system/<unit>.d/` over editing vendor files.",
        tradeoffs: "Deep systemd integration buys sandboxing and accounting and ties the service to Linux. Containers move that boundary elsewhere for the same reasons.",
      },
    ),
    pitfalls: [
      "`start` is now; `enable` is at boot. A service you only started disappears on reboot.",
      "Editing a unit file without `daemon-reload` means systemd keeps using the old one.",
      "`systemctl` does not exist on macOS or on non-systemd distributions; the roadmap's `|| launchctl list` fallback exists for that reason.",
    ],
    docs: [
      { label: "systemctl(1)", url: "https://man7.org/linux/man-pages/man1/systemctl.1.html" },
      { label: "systemd.unit(5)", url: "https://man7.org/linux/man-pages/man5/systemd.unit.5.html" },
    ],
  },

  journalctl: {
    concept: "Reading system logs",
    summary: "queries the systemd journal",
    lens: lens(
      {
        what: "`journalctl -p err -n 50 --no-pager` shows the last 50 error-or-worse log lines. `--no-pager` matters: without it the output opens in a pager and a script would hang.",
        how: "Filter before you scroll: `-u <unit>` for one service, `-p err` for severity, `-n` for how many, `-f` to follow live (in your own terminal, not through a tool with a timeout).",
        tradeoffs: "Everything is in one place, which is powerful and overwhelming. Unfiltered `journalctl` is unreadable by design.",
      },
      {
        what: "A structured, indexed binary log, so filters are cheap and grep-free: `-S`/`-U` for time windows, `_PID=`, `_UID=`, `-k` for kernel messages, `-o json` for machine consumption.",
        how: "`journalctl -u web -S '1 hour ago' -p warning` is the shape of most real queries. `-b -1` reads the previous boot, which is where a crash's evidence lives.",
        tradeoffs: "Structured logs query far better than text files and need journalctl to read at all. Text logs are greppable anywhere and lose the metadata.",
      },
      {
        what: "Persistence is configuration: without `/var/log/journal` the journal is in-memory and gone on reboot, which is how post-mortem evidence quietly disappears. Rate limiting can also drop bursts.",
        how: "Ensure persistent storage, set retention (`SystemMaxUse`) deliberately, ship logs off-host for anything that matters, and check `journalctl --disk-usage` before an incident rather than during one.",
        tradeoffs: "On-host logs are immediate and lost with the host. Central shipping is durable and adds a dependency exactly when the network is the problem. Do both.",
      },
    ),
    pitfalls: [
      "Without `--no-pager`, output goes to a pager and a script or tool call appears to hang.",
      "If the journal is not persistent, the evidence for the crash you are investigating was destroyed by the reboot.",
      "`-f` follows forever; it belongs in your terminal, not behind a 60-second timeout.",
    ],
    docs: [{ label: "journalctl(1)", url: "https://man7.org/linux/man-pages/man1/journalctl.1.html" }],
  },
};

/** Aliases, so `docker-compose` and `python3` find the right entry. */
const ALIASES: Record<string, string> = {
  // Shell control flow is one lesson, not three missing ones.
  for: "set",
  while: "set",
  until: "set",
  if: "set",
  case: "set",
  echo: "printf",
  "[": "test",
  bash: "sh",
  zsh: "sh",
  dash: "sh",
  which: "command",
  type: "command",
  vm_stat: "free",
  launchctl: "systemctl",
  service: "systemctl",
  dmesg: "journalctl",
  ss: "lsof",
  netstat: "lsof",
  fuser: "lsof",
  head: "cat",
  tail: "cat",
  less: "cat",
  rmdir: "rm",
  chown: "chmod",
  tsx: "tsc",
  prettier: "eslint",
  "docker-compose": "docker",
  podman: "docker",
  pnpm: "npm",
  yarn: "npm",
  k: "kubectl",
  tf: "terraform",
  egrep: "grep",
  rgrep: "grep",
  ll: "ls",
  unlink: "rm",
};

/** Shell keywords are their own lesson, not a binary lookup that fails. */
const SHELL_KEYWORDS = new Set([
  "for", "while", "until", "if", "case", "select",
  "set", "trap", "test", "command", "eval", "exec", "source", "export", "unset",
]);

/** Wrappers that stand in front of the command actually being taught. */
const WRAPPERS = new Set(["sudo", "doas", "env", "time", "nice", "nohup", "xargs", "npx", "pnpx"]);

/**
 * The binary a command line is really about.
 *
 * Harder than it looks, and worth getting right: this key selects the lesson,
 * the quiz topic and the mastery row. It has to see through leading variable
 * assignments (`f=x cmd`), privilege and runner wrappers (`sudo`, `npx`), path
 * prefixes, and compound lines whose first segment is only an assignment —
 * `f=my\ file.txt; touch "$f"` is a lesson about `touch`, not about `file.txt`.
 */
export function binOf(command: string): string {
  // Split on the operators that separate commands, keeping order.
  const segments = command
    .split(/(?:\|\||&&|;|\||&)+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments.length ? segments : [command.trim()]) {
    // A trailing backslash escapes the space that follows, so the next token is
    // a continuation of this word: `f=my\ file.txt` is one assignment, not two.
    const tokens: string[] = [];
    for (const raw of segment.split(/\s+/).filter(Boolean)) {
      const previous = tokens[tokens.length - 1];
      if (previous !== undefined && previous.endsWith("\\")) {
        tokens[tokens.length - 1] = `${previous.slice(0, -1)} ${raw}`;
      } else {
        tokens.push(raw);
      }
    }
    let i = 0;
    while (
      i < tokens.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || WRAPPERS.has(tokens[i].replace(/^.*\//, "")))
    ) {
      i++;
    }
    if (i >= tokens.length) continue; // the whole segment was assignments or wrappers
    const bare = tokens[i].replace(/^.*\//, "").replace(/[;&]+$/, "");
    if (!bare) continue;
    if (SHELL_KEYWORDS.has(bare)) return bare;
    // A token that is only punctuation or a variable is not a command name.
    if (/^[^A-Za-z0-9_.-]/.test(bare)) continue;
    return bare;
  }

  // Nothing command-shaped: the lesson is about the shell itself.
  const first = command.trim().split(/\s+/)[0]?.replace(/^.*\//, "") ?? "";
  return WRAPPERS.has(first) || !first ? "shell" : first;
}

export function contentFor(command: string): { bin: string; content: CommandContent | null } {
  const bin = binOf(command);
  const key = ALIASES[bin] ?? bin;
  return { bin, content: CONTENT[key] ?? null };
}

export function lensFor(command: string, level: SkillLevel): Lens {
  const { content } = contentFor(command);
  return content ? content.lens[level] : GENERIC_LENS[level];
}

export function conceptFor(command: string): string {
  const { bin, content } = contentFor(command);
  return content ? content.concept : `\`${bin}\` at the shell`;
}

/** The generic process-lifecycle diagram, used when a command has no specific one. */
function genericDiagram(command: string, ok: boolean, topic: string): string {
  const bin = binOf(command);
  return [
    "flowchart TD",
    `    A["Shell parses: ${bin}"] --> B{"Binary on PATH?"}`,
    '    B -- "no" --> E["127: command not found"]',
    '    B -- "yes" --> C["fork + execve"]',
    '    C --> D{"Args & permissions valid?"}',
    '    D -- "no" --> F["non-zero exit + stderr"]',
    '    D -- "yes" --> G["Process runs, writes stdout"]',
    `    G --> H["Exit code ${ok ? "0 (success)" : "non-zero"}"]`,
    `    H --> I["Roadmap: ${topic.replace(/"/g, "'")}"]`,
  ].join("\n");
}

export function diagramFor(command: string, ok: boolean, topic: string): string {
  const { content } = contentFor(command);
  return content?.diagram ? content.diagram(command) : genericDiagram(command, ok, topic);
}

const GENERIC_PITFALLS = [
  'Unquoted variables split on whitespace, so always quote `"$VAR"`.',
  "Relative paths depend on your current directory; confirm with `pwd` first.",
  "A zero exit code inside a pipeline can hide an earlier failure. Use `set -o pipefail`.",
];

export function pitfallsFor(command: string): string[] {
  const { content } = contentFor(command);
  const specific = content?.pitfalls ?? [];
  const extra: string[] = [];
  // Pitfalls that come from the shape of this particular command line, not the binary.
  if (/\|/.test(command)) extra.push("This is a pipeline, so only the last command's exit code is reported unless `pipefail` is set.");
  if (/(^|\s)>[^>]/.test(command)) extra.push("`>` truncates its target before the command runs. `>>` appends.");
  if (/\$\w+|\$\{/.test(command) && !/"\$/.test(command)) extra.push("There is an unquoted variable expansion here; quote it before it meets a filename with a space.");
  if (/\bsudo\b/.test(command)) extra.push("This runs as root, so every guard that depends on your user's permissions is gone.");
  return [...specific, ...extra, ...GENERIC_PITFALLS].slice(0, 5);
}

export function docsFor(command: string): Array<{ label: string; url: string }> {
  const { bin, content } = contentFor(command);
  return [
    ...(content?.docs ?? []),
    man(bin),
    { label: "Bash Reference Manual", url: "https://www.gnu.org/software/bash/manual/bash.html" },
    { label: "roadmap.sh (all roadmaps)", url: "https://roadmap.sh/roadmaps" },
  ].slice(0, 4);
}

/**
 * The teaching brief.
 *
 * A card the pack has no entry for used to print boilerplate. Instead it now
 * addresses the model reading the card and tells it exactly what to teach,
 * with the command, the real output and the learner's depth already supplied.
 * The pack covers the common commands offline; the brief covers everything
 * else without pretending to.
 */
export function teachingBrief(args: {
  command: string;
  level: SkillLevel;
  topic: string;
  track: string;
  hasContent: boolean;
  outcome: "success" | "failure" | "dry-run";
  stdoutExcerpt: string;
}): string {
  const lines = [
    "> **Tutor brief — for the assistant reading this card, not the learner.**",
    `> The learner is at **${args.level}** depth, on _${args.track}_, topic _${args.topic}_.`,
    `> They ran \`${args.command}\` (${args.outcome}).`,
  ];
  if (args.hasContent) {
    lines.push(
      "> The Concept section below is authored and correct: build on it rather than repeating it.",
      "> Add what is specific to **this invocation** — the flags actually used, and what the output above does and does not prove.",
    );
  } else {
    lines.push(
      "> There is no authored lesson for this command, so the Concept section below is the generic shell model.",
      `> Teach \`${args.command}\` yourself, at ${args.level} depth, in three short parts: **What** it is and what state it touches, **How** to invoke it well (the flags used here, and the ones they should have used), and **Trade-offs** — when to reach for something else.`,
      "> Be concrete about the flags in the command above. Do not restate the generic model.",
    );
  }
  if (args.stdoutExcerpt.trim()) {
    lines.push("> Reference the actual output when you explain it; do not describe output in the abstract.");
  }
  lines.push("> Then hand back to the quiz. Do not answer the quiz for them, and do not run the next command on their behalf.");
  return lines.join("\n");
}
