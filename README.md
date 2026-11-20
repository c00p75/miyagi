# 🥋 miyagi

**Learn while you vibe code.**
*Your AI writes the code. miyagi makes sure it ends up in your head too.*

[![CI](https://github.com/c00p75/miyagi/actions/workflows/ci.yml/badge.svg)](https://github.com/c00p75/miyagi/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/miyagi-mcp)](https://www.npmjs.com/package/miyagi-mcp)
[![license](https://img.shields.io/npm/l/miyagi-mcp)](./LICENSE)

**[Overview and setup guide](https://www.georgemsapenda.dev/miyagi)** · [How it was built](https://www.georgemsapenda.dev/work/miyagi) · [npm](https://www.npmjs.com/package/miyagi-mcp)

You asked for a checkout page and got four hundred lines back. It works. Could you explain
it? `miyagi` is an MCP server that rides along while you build with Claude Code, Cursor or
any MCP client. It notices what your assistant wrote, picks the two or three ideas in it
actually worth owning, ties each one to a real line in *your* project, and then asks you
about it again next week, right before you would have forgotten.

```text
🥋 Debrief

Since your last debrief, your assistant ran 7 commands and edited 3 files (+212 lines).

1. 🔑 A secret written into the code · 🆕 new technique
   Your house key is now taped to the front door.
   📍 app/api/pay/route.ts
   💥 How it bites. You delete the line, commit, and relax. Bots that scrape public
      repos found the key in the history within minutes…
   🎤 Ask your AI: "Is this a real credential? Move it to an environment variable
      and tell me exactly what I need to rotate."

2. 💉 SQL built by gluing strings together · 🆕 new technique
   You just let strangers finish your sentences — and the database does whatever
   the sentence says.

❓ An API key was committed to git, then deleted in the next commit. What now?

✨ 2 new techniques discovered · XP is earned by answering its question
```

## How it works

1. **It watches, quietly.** One command installs an editor hook. After each command or
   edit your assistant makes, one line goes into a local log: the command, the file name,
   and which ideas the change used. Never file contents, never full output (a failed command
   keeps only its scrubbed error lines), never your prompts, nothing off your
   machine. No hook? It reads `git diff` instead, so it works with zero setup.
2. **It chooses.** A change can touch a dozen ideas. You get the few that matter most:
   new to you first, security before syntax, and nothing you have already proved you know.
3. **It teaches in three lines, not thirty.** A hook, what the thing is, how it bites, and
   a question to put to your assistant. Your assistant then explains it using the code it
   just wrote, not a textbook example.
4. **It comes back.** Every idea has a recall question on a spaced-repetition schedule
   (10 minutes, then 1, 3, 7, 16, 35 days). This is the part that turns "I saw that once"
   into "I know that".
5. **You earn belts, not points for showing up.** Each of the 23 techniques has a belt,
   white to black, that rises only when you answer its question cold after a longer gap,
   and drops when you miss. Techniques unlock when your assistant writes code that uses
   them. You cannot grind the dojo. You have to build something.

It also still does what it started as: guided terminal, git and DevOps tracks where *you*
run the command and a read-only probe checks the outcome really exists on your machine.

## Start in 60 seconds

```bash
claude mcp add miyagi -- npx -y miyagi-mcp     # 1. add the server (Claude Code)
npx -y miyagi-mcp --setup                      # 2. turn on ride-along capture
npx -y miyagi-mcp --rules >> CLAUDE.md         # 3. optional: teach without being asked
```

Restart your editor, build something, then say: ***"miyagi, debrief me."***

- `--setup` writes one hook into `.claude/settings.local.json` (and `.cursor/hooks.json` if
  the project uses Cursor). It merges with what is there, never overwrites, and refuses to
  touch a file it cannot parse. Add `--global` for every project, `--dry-run` to preview,
  `--uninstall` to remove it.
- `--rules` prints a short paragraph for `CLAUDE.md`, `AGENTS.md` or `.cursorrules` that
  tells the assistant to call `explain_change` when it finishes a piece of work.
- Busy? Say "miyagi, focus mode". Ideas are still queued for later; nothing is shown.

## Why it's safe to install

It runs shell commands on your machine, so it's built to be read before it's trusted.

- **Nothing catastrophic executes.** `rm -rf /`, `mkfs`, `dd of=/dev/*`, fork bombs,
  `curl | sh` and history-wiping are pattern-matched and refused *regardless of what the
  calling model claims*. The screen defends against a confused AI, not just a careless
  user, which is why it re-derives the verdict instead of trusting the `is_dangerous` flag
  it was handed.
- **A human confirms destructive commands, not a model.** `confirm_dangerous` used to be a
  flag the assistant filled in, which is not confirmation: a prompt-injected assistant
  sets it as easily as a careful one. Where your client supports elicitation, the server
  asks *you*, shows you the command, and requires you to type `RUN`. The flag survives
  only as the fallback for clients that cannot prompt, and a failed or cancelled prompt
  means no.
- **A denylist is a backstop, not a sandbox.** The real boundary is your MCP client's own
  approval prompt, with you reading the command before it runs. The screen exists for the
  narrower case that prompt handles badly: something obviously destructive proposed to
  someone who is clicking through.
- **Failures teach instead of crashing.** A non-zero exit returns a Hotfix Diagnostic with
  a troubleshooting ladder. The server never throws.
- **Bounded.** 60-second timeout (raise it per call if you know better), 4 MB output cap,
  no network calls, no telemetry, no API keys, no accounts.
- **Interactive commands are refused, not timed out.** `vim`, `npm run dev`, `tail -f` and
  friends are recognised up front and handed back to you, rather than sitting in the queue
  until the timeout makes the tool look broken.
- **Two tiers, not one.** Catastrophic shapes (`rm -rf /`, `mkfs`, `curl | sh`, fork
  bombs, wiping your shell history) never execute, with or without confirmation.
  Merely destructive ones (`rm -rf build`, `git push --force`, `terraform destroy`) are
  explained, dry-run, and executed only if you pass `confirm_dangerous: true`. One tier
  had a cost: a learner who genuinely needed to practise `rm -rf build` had to leave the
  tutor to do it, which teaches working around your own safety rail.
- **It admits what it cannot see.** `sh -c`, `eval` and decoded payloads hide the real
  command from any pattern match, so they are flagged as opaque rather than waved through.
- **Nothing is truncated silently.** Output over the cap, a killed process, and a trimmed
  display all say so on the card. "That is all the output there was" is the one wrong
  conclusion a learner must never be led to.
- **Small enough to audit.** Two runtime dependencies, the MCP SDK and zod. The MCP
  surface, the safety screen, the content pack, the quiz bank, scheduling, persistence,
  execution, rendering and session modes are separate modules.

## Install

Point your MCP client at `npx` and it fetches on first run:

```bash
npx -y miyagi-mcp
```

Or install it globally, which gives you a `miyagi` command:

```bash
npm install -g miyagi-mcp
```

<details>
<summary>Build from source instead</summary>

```bash
git clone https://github.com/c00p75/miyagi.git
cd miyagi
npm install
npm run build      # emits dist/miyagi.js
npm test
```

Then use `"command": "node", "args": ["<ABS_PATH>/dist/miyagi.js"]` in the config below.
</details>

## Configure your MCP client

Three lines, the same everywhere. No keys, no accounts, and it all runs locally.

```json
{
  "mcpServers": {
    "miyagi": {
      "command": "npx",
      "args": ["-y", "miyagi-mcp"]
    }
  }
}
```

Where that goes:

| Client | File |
| --- | --- |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json`, or `~/.cursor/mcp.json` globally |
| AntiGravity / Windsurf | `~/.codeium/windsurf/mcp_config.json` |

For Claude Code, one command does it:

```bash
claude mcp add miyagi -- npx -y miyagi-mcp
```

Restart the client, build something, then try: *"miyagi, debrief me."* Or, for terminal
practice: *"Set my roadmap to Backend Developer and teach me `docker compose config`."*

## What's in it

| Engine | What it does |
| --- | --- |
| **Concept pack** | 23 ideas an assistant commonly writes — hard-coded secrets, SQL built from strings, React state and effects, environment variables, tokens, migrations, CORS, async code and more — each at three depths, with a hook, a pitfall told as a story, a question to ask the AI, and its own recall questions. Detection is a few regular expressions over *added* lines, fast enough for a hook and deliberately conservative: a tutor that explains something you did not do stops being read. |
| **Ride-along capture** | `miyagi-observe`, a separate tiny entry point the editor hook runs (about 0.1s, no MCP SDK loaded). Understands Claude Code `PostToolUse` and Cursor `afterShellExecution` / `afterFileEdit`. Always exits 0 and never prints: a hook must not break the tool call it follows. Secrets are scrubbed from commands, and the line that matched "hard-coded secret" is never stored at all. |
| **Choosing what to teach** | Ideas are ranked by how much a misunderstanding would cost, whether you have seen them, and how often you have missed them. Anything you have recalled cold three times is named, not re-explained. |
| **The dojo** | `miyagi://dojo`: every technique discovered and the belt held in each. A belt is the review box in a costume, so it cannot be farmed and it drops on a miss. A new technique pays 5 XP, once. |
| **Teaching** | A content pack with per-command lessons at three depths for 33 commands, so `pwd`, `git rebase` and `terraform apply` get three different lessons rather than the same boilerplate. A test walks every track step and fails the build if a taught command has no lesson. Anything genuinely uncovered comes with a *tutor brief*: the card tells the model what to teach, with the command, the real output and your depth already in hand. |
| **Checkpoints** | Steps carry a read-only probe and a stated pass criterion, shown *before* you start. `verify_step` runs it, credits the outcome once, and advances. A near-miss command does not claim the XP, and re-passing pays nothing. |
| **Spaced repetition** | Every question you see and every command you run is scheduled on a Leitner ladder — 10 minutes, 1, 3, 7, 16, 35 days. A correct answer promotes it; a slow-but-correct answer holds its box, because hesitant recall is weaker recall; a miss drops it to the front, not to zero. `review_due_items` is what turns the XP into retention. |
| **Model assistance** | Optional, and strictly additive. If your client offers sampling, a prose answer that means the right thing is graded on meaning rather than string comparison — and a model can only ever *upgrade* a verdict, never take away an answer that already matched. For a command the bank has never heard of, it writes a question, validates it as hard as a hand-written one, and caches it so the bank grows towards what you actually practise. |
| **Insights** | `miyagi://insights` answers the question the README used to ask rhetorically: practice cadence by week, first-sight accuracy against *review* accuracy, checkpoint pass rates, and a verdict that refuses to claim anything on thin evidence. |
| **Streaks** | Two of them. The quiz streak drives the XP multiplier; the *practice-day* streak counts consecutive calendar days, which is the habit hook a per-session number cannot be. The card tells you when today is the day you lose it. |
| **Mastery** | Per-command attempt and success counts, so stats can say *"you are 40% on `git rebase` over 8 attempts"* rather than just showing a level. Weaknesses need three attempts before they are called weaknesses; two attempts at 50% is noise. |
| **Roadmap** | Six built-in tracks with 26 checkpointed steps, plus your own: any JSON file in `~/.miyagi/roadmaps/` becomes a track, and one named after a built-in shadows it. An unknown track name is *reported*, not silently swapped for Command Line Basics. Every track declares the shell it was written for. |
| **Windows** | Tracks declare `posix` or `powershell`. On a mismatched host, a step with a PowerShell equivalent is substituted and labelled, then executed through `powershell.exe` — not `cmd.exe`. Checkpoints have PowerShell probes too. A step without an alternative gets an explicit warning instead of a command line that is known to fail. Silence was the bug. |
| **Gamification** | Nothing for a technique merely appearing in code: XP is paid for recall and verified work, not exposure. Attempt XP follows the session mode (10 in drill, 3 in ride-along, 0 in focus), **30 for a verified outcome**, 25 per correct quiz (30 for a review — cold recall is the harder skill) with streak multipliers, `Level = floor(XP/100) + 1`, four titles, streak and practice-day badges. |
| **Progress** | `~/.miyagi/profile.json` for state, plus an append-only `history.jsonl` for the practice log, so a note export after a restart describes what you actually did instead of an empty session. Saves *merge* with what is on disk, so two clients cannot roll each other's XP backwards: counters take the higher total, badges union, and verified checkpoints are never dropped. Parallel sessions that each earn XP from the same baseline keep the larger score, not the sum. |
| **Safety** | Two tiers, screened independently of the caller: catastrophic shapes never run, destructive ones need a human's confirmation. Checkpoint probes are screened too — a "probe" that deletes something is not a probe, and a track file is where one would hide. |
| **Notes** | `ROADMAP_PROGRESS.md` export with quiz accuracy, weak spots, what is due for review, and the full log — session-scoped or lifetime. |

## In a terminal

No MCP client and no editor needed. The same ideas, questions, review schedule and profile:

```bash
npx miyagi-mcp watch      # teach from what changes in this repository, when the work pauses
npx miyagi-mcp review     # answer what is due, from memory
npx miyagi-mcp dojo       # what you have found, and the belt held in each
```

`watch` treats whatever was uncommitted when it started as old, and prints a card once a change has been still for twenty seconds. `review` shows each question alone first and the choices only after Enter. This is the way to use Miyagi beside a terminal agent, or inside JetBrains, Neovim or Zed.

## Tools

For learning from what your assistant built:

- `explain_change`: the ideas behind code that was just written. No arguments reads the
  uncommitted git changes (or the last commit); `diff` takes a diff or a bare snippet;
  `path` takes one file. Returns up to `limit` ideas, each tied to a real line, plus one
  recall question. Read-only.
- `debrief`: what the assistant did since the last debrief — commands run, files touched,
  techniques used — and the few ideas in it worth understanding. Falls back to git when
  capture is not installed. `replay: true` includes everything captured.

For practice, progress and configuration:

- `quick_config`: skill level (Junior/Mid/Senior), category, track, topic, and session
  mode (`drill` / `ride-along` / `focus`), in one call. `reset_progress: true` wipes XP,
  streaks, mastery and the review queue back to first-run state. Call it with no
  arguments to read the current configuration. The default mode is **ride-along**:
  a short card, no inline quiz. Intensity is opted into with `mode: "drill"`.
- `list_roadmaps`: every track, built-in and yours, with step counts and the JSON schema
  for authoring your own. Worth calling before you set a track name.
- `set_active_roadmap`: category, track, topic and step counters. An unknown name is
  reported with suggestions rather than substituted.
- `get_next_roadmap_command`: the next copy-pasteable command, with `advance: true` to
  step forward.
- `run_teaching_command`: execute or dry-run a command and return the teaching card. If the
  command is the current step and that step has a checkpoint, the outcome is verified
  afterwards and credited. `timeout_ms` raises the 60-second cap; `confirm_dangerous` is
  the fallback for clients that cannot prompt you directly.
- `verify_step`: run the current step's read-only probe. Passing credits the outcome once
  and advances; failing says what is missing and leaves the step where it is.
- `verify_quiz_answer`: grade an answer by letter or by text, update streaks, XP, mastery
  and the review schedule. Takes the `quiz_id` from the card, or defaults to the most
  recent question.
- `review_due_items`: the spaced-repetition session — everything whose interval has
  elapsed, most overdue first.
- `get_user_stats`: XP, level, title, both streaks, badges, per-command mastery, weak
  spots, review queue and lifetime totals.
- `export_roadmap_notes`: write `ROADMAP_PROGRESS.md`, session-scoped or lifetime.

All twelve tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`),
so a client can tell `get_user_stats` apart from `run_teaching_command` when it decides
what to prompt about.

> **Voice was removed in 3.1.** `voice_enabled`, `words_per_minute` and `test_phrase` are
> no longer accepted by `quick_config`, `get_user_stats` no longer takes `speak`, and the
> doctor no longer looks for a speech engine. Old profiles load as before; their voice
> settings are ignored.
>
> **Upgrading from 2.x:** XP moved to outcomes. Drill still pays 10 XP for running a
> command (was 15); ride-along pays 3; a verified checkpoint is 30. The default mode is
> ride-along. Old profiles are migrated, not discarded.

## Resources and prompts

Progress is readable without spending a tool call, so a client can render it in a sidebar:

| Resource | What |
| --- | --- |
| `miyagi://profile` | XP, level, badges, both streaks, mastery, review queue |
| `miyagi://roadmap` | Active track, position, next command, full step list |
| `miyagi://review` | Every scheduled item with its box, due date and lapses |
| `miyagi://history` | The durable practice log, most recent 200 events |
| `miyagi://roadmaps/{name}` | One track as markdown; the name autocompletes |
| `miyagi://dojo` | Every technique discovered, and the belt held in each |
| `miyagi://insights` | Cadence by week, review accuracy, checkpoint pass rate, verdict |
| `miyagi://getting-started` | How the tutor works, and the order to do things in |

Subscribed clients get `notifications/resources/updated` when saved state moves, so a
sidebar is never showing a level you passed twenty minutes ago.

And seven prompts, so nobody has to know tool names to start: `debrief` (what did the
assistant just do, and what should I understand?), `teach-me-this-change` (guess first,
then get corrected, on the change just made), `ride-along` (the quiet
default — a short card, no inline quiz), `drill` (pick a track and depth first — from
your XP, what you are building, and an optional placement quiz — then a guided session
with the quiz), `review` (spaced repetition over what is due), `explain-last-error`
(teach from a failure instead of fixing it), and `progress` (where am I, what is weak,
what next). Drill does not dump you onto Command Line Basics at Junior. It recommends
tracks and a depth; you choose. Examples on the card are supposed to be user stories
from the project in front of you.

## Authoring your own track

Drop a JSON file in `~/.miyagi/roadmaps/`. A step can be a bare command string or an
object with its own topic and note:

```json
{
  "name": "My Python Track",
  "category": "Skill Based",
  "description": "What this track teaches, in one line.",
  "shell": "posix",
  "steps": [
    "python3 --version",
    {
      "command": "python3 -m venv .venv && . .venv/bin/activate",
      "topic": "Isolated environments",
      "note": "Never install into the system interpreter.",
      "windows": "python -m venv .venv; .venv\\Scripts\\Activate.ps1",
      "verify": {
        "command": "test -x .venv/bin/python",
        "describe": "a virtualenv exists at .venv"
      }
    }
  ]
}
```

- **`verify`** is what makes a step earnable. It must be read-only: a probe that the danger
  screen objects to is dropped when the file is loaded, because a track file is exactly
  where somebody would hide one. `contains` additionally requires a string in its output.
- **`windows`** is the PowerShell equivalent, used automatically when a `posix` track is
  walked on Windows.
- **`shell`** declares what the commands are written for: `posix`, `powershell` or `any`.

`list_roadmaps` with `reload: true` picks up edits without a restart, and names any file
it had to skip — a track silently ignored is worse than one that fails loudly.

## Where progress lives

`~/.miyagi/profile.json` holds XP, level, both streaks, badges, per-command mastery, the
review queue, your skill level, session mode and roadmap position. `~/.miyagi/history.jsonl`
is the append-only practice log: one line per event, so a crash costs at most the line
being written and one corrupt line costs only itself. Override the directory with
`MIYAGI_HOME`, which is also how the tests keep away from a real profile.

The file is treated as untrusted on the way back in, because it's hand-editable and a
crash can truncate it. Anything that fails to parse is discarded in favour of a fresh
profile rather than raised as an error, values out of range are clamped instead of
rejected, and level is recomputed from XP rather than read, so a file claiming level 99 at
40 XP gets corrected. A review item with an unreadable due date is treated as due now,
which fails safe towards revision, and a streak nobody can date is not counted as a
streak. Writes go to a temp file and are renamed, so an interrupted write leaves the
previous profile intact. A 1.x profile is migrated rather than discarded: losing a
learner's XP on upgrade would be the worse bug.

## When something looks wrong

```bash
npx miyagi-mcp --doctor
```

Checks the Node version, whether ride-along capture is installed and how much is waiting
for a debrief, that commands can actually be executed, that the profile
directory is writable, that a saved profile parses, which track files were skipped and
why, and whether any track is written for the wrong shell for this host. Plain text on stdout — the one mode where that is safe, because there is no
protocol to corrupt. A warning is a working install; only a real failure exits non-zero.

## Development

```bash
npm install
npm run typecheck
npm test           # node:test, no test framework to install
npm run build
```

```bash
npm run eval        # the content rubric, the learner journey, and coverage parity
npm run doctor      # after a build
```

`npm test` runs 300 `node:test` cases. Three layers, and the top two are the ones that
find real bugs:

- **Unit** — persistence, scheduling, safety tiers, quiz selection, platform resolution.
- **End-to-end** — a test client that speaks real MCP over stdio, *including* answering
  elicitation prompts and serving sampling requests, so the human-confirmation and
  model-grading paths are exercised the way a client exercises them. It also throws on any
  non-JSON byte on stdout, which is how a stray `console.log` gets caught.
- **Eval** — a rubric over everything a learner can see: every lesson at every depth
  (boilerplate, specificity, does depth change anything), every question (does the answer
  leak, can it be won by picking the longest choice, does grading round-trip), every card
  every track can render, every diagram, plus a fuzz pass over malformed command lines.

That last layer earns its keep. It found a signed-integer bug in the choice shuffler that
rendered `B. undefined` for *some* seeds and not others — intermittent by construction,
invisible to a single example, and caught immediately by sweeping the whole bank. It also
found that 29 of 35 questions could be answered by picking the longest choice.

CI runs typecheck, tests, a stdio handshake, `--doctor`, and an install-from-tarball check
against Node 18, 20 and 22.

## Limits worth knowing

- Concept detection is pattern matching, not understanding. It recognises 23 common ideas
  by their shape in added lines; it will miss an idea written an unusual way and it says
  nothing about plain business logic. When nothing matches, the card says so rather than
  inventing a lesson.
- Capture needs an editor with hooks (Claude Code, Cursor). Everywhere else, `explain_change`
  and `debrief` read `git diff`, which sees the result but not the commands that produced it.
- The server suggests when to teach (its MCP instructions and `--rules`), but the assistant
  decides whether to call it. If yours stays quiet, ask: "miyagi, debrief me".
- The observation log is plain text in `~/.miyagi/`. It holds commands (scrubbed), file
  names and one scrubbed line per idea. Set `MIYAGI_OBSERVE=off` to pause capture.
- Commands run with your own privileges in your own directory. No container, no restricted
  user, no syscall filter. That's right for a local teaching tool driven by its owner, and
  it's the first thing to change if it ever accepts untrusted input.
- Long-running or interactive commands belong in your own terminal. The common ones are
  recognised and refused; anything else meets the 60-second cap.
- The pattern-based safety screen is a speed bump, not a sandbox. `sh -c "$(...)"` defeats
  any denylist, which is why those shapes are flagged as opaque rather than trusted. The
  real boundary is your client's approval prompt with you reading the command.
- The content pack covers the commands the built-in tracks teach, enforced by a test.
  Everything else leans on the tutor brief and the model reading the card, which is honest
  but not offline.
- A checkpoint proves the outcome exists, not that *you* produced it. Someone determined to
  cheat can create the directory by hand — but at that point they have run a command, which
  was the entire objective.
- Model-assisted grading and question generation need a client that offers sampling. Without
  one, grading is a string comparison and questions come from the bank.
- Whether XP, streaks and spaced repetition actually keep someone on a roadmap is still an
  open question — but it is now a *measured* one. Read `miyagi://insights`: review accuracy
  against first-sight accuracy is the number that matters, and the report says so, including
  when there is not yet enough evidence to say anything at all.

## Learn more

- **[Overview and setup guide](https://www.georgemsapenda.dev/miyagi)** walks through what a
  teaching card contains, the config for each client, and where the safety model stops.
- **[How it was built](https://www.georgemsapenda.dev/work/miyagi)** is the engineering
  write-up: why the danger screen ignores its caller, why it uses a transport that cannot be
  hosted, and what the design gives up.

Issues and pull requests are welcome. If you use it and it teaches you nothing, that is a bug
worth reporting.

## License

MIT
