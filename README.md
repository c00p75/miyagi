# 🥋 miyagi

**A patient, gamified, voice-enabled MCP coding tutor.**
*You run the commands. It drills, corrects, catches the falls, and keeps score.*

[![CI](https://github.com/c00p75/miyagi/actions/workflows/ci.yml/badge.svg)](https://github.com/c00p75/miyagi/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/miyagi-mcp)](https://www.npmjs.com/package/miyagi-mcp)

Wax on, wax off. `miyagi` never does the work for you. It hands you the next command,
explains it at your level, and turns every result into a lesson. Each run comes back as a
teaching card: where you are on the roadmap, a What/How/Trade-offs breakdown pitched at
your experience, a Mermaid mental model, the pitfalls that bite people, curated docs, and
an active-recall quiz. All of it narrated through your OS's own speech engine.

## Why it's safe to install

It runs shell commands on your machine, so it's built to be read before it's trusted.

- **Nothing catastrophic executes.** `rm -rf`, `dd of=/dev/*`, fork bombs, `curl | sh`,
  force pushes and `chmod -R 777` are pattern-matched and forced into dry-run *regardless
  of what the calling model claims*. The screen defends against a confused AI, not just a
  careless user, which is why it re-derives the verdict instead of trusting the
  `is_dangerous` flag it was handed.
- **A denylist is a backstop, not a sandbox.** The real boundary is your MCP client's own
  approval prompt, with you reading the command before it runs. The screen exists for the
  narrower case that prompt handles badly: something obviously destructive proposed to
  someone who is clicking through.
- **Failures teach instead of crashing.** A non-zero exit returns a Hotfix Diagnostic with
  a troubleshooting ladder. The server never throws.
- **Bounded.** 60-second timeout, 4 MB output cap, no network calls, no telemetry, no API
  keys, no accounts.
- **Small enough to audit.** Two runtime dependencies, the MCP SDK and zod, in one source
  file you can read in a sitting.

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

Restart the client, then try: *"Set my roadmap to Backend Developer and teach me
`docker compose config`."*

## What's in it

| Engine | What it does |
| --- | --- |
| **Audio** | A non-blocking FIFO queue, so lines never talk over each other. Markdown, URLs and emoji are stripped before anything is spoken, and the OS engine is probed before it's called, so a missing binary goes quiet instead of taking the server down. |
| **Roadmap** | Track state as category, roadmap, topic, step N of M, with the next command suggested for wherever you are. |
| **Gamification** | 15 XP per command, 25 per correct quiz with streak multipliers, `Level = floor(XP/100) + 1`, four titles and streak badges. |
| **Progress** | Saved to `~/.miyagi/profile.json`, so XP, streaks, badges and your track survive a client restart. |
| **Safety** | Nine catastrophe classes screened independently of the caller, all forced into dry-run. |
| **Notes** | `ROADMAP_PROGRESS.md` export with quiz accuracy and the full session log. |

### Speech engines

| Platform | Engine |
| --- | --- |
| macOS | `say -r <wpm>` |
| Windows | PowerShell `System.Speech.Synthesis.SpeechSynthesizer` |
| Linux | `spd-say`, falling back to `espeak-ng`, `espeak` then `festival` |

Linux users who want audio: `sudo apt install speech-dispatcher`.

## Tools

- `quick_config`: switch skill level (Junior/Mid/Senior), category, track, topic or voice
  in one call. Pass `reset_progress: true` to wipe saved XP back to first-run state.
- `set_active_roadmap`: set category, roadmap, topic and step counters
- `get_next_roadmap_command`: the next copy-pasteable command, with `advance: true` to
  step forward
- `configure_voice`: toggle audio, set words per minute, speak a test phrase
- `get_user_stats`: XP, level, title, streaks, badges, title ladder
- `run_teaching_command`: execute or dry-run a command and return the teaching card
- `verify_quiz_answer`: grade the quiz, update streak and XP, speak the feedback
- `export_roadmap_notes`: write `ROADMAP_PROGRESS.md`

## Where progress lives

`~/.miyagi/profile.json`, holding XP, level, streaks, badges, your skill level, voice
settings and roadmap position. Override the directory with `MIYAGI_HOME`, which is also
how the tests keep away from a real profile.

The file is treated as untrusted on the way back in, because it's hand-editable and a
crash can truncate it. Anything that fails to parse is discarded in favour of a fresh
profile rather than raised as an error, values out of range are clamped instead of
rejected, and level is recomputed from XP rather than read, so a file claiming level 99 at
40 XP gets corrected. Writes go to a temp file and are renamed, so an interrupted write
leaves the previous profile intact.

## Development

```bash
npm install
npm run typecheck
npm test           # node:test, no test framework to install
npm run build
```

CI runs typecheck, tests and a real stdio handshake against Node 18, 20 and 22.

## Limits worth knowing

- Commands run with your own privileges in your own directory. No container, no restricted
  user, no syscall filter. That's right for a local teaching tool driven by its owner, and
  it's the first thing to change if it ever accepts untrusted input.
- Long-running or interactive commands belong in your own terminal. The 60-second cap will
  cut them off.
- Whether XP and streaks actually keep someone on a roadmap is an open question. The
  progress file is what makes it answerable.

## License

MIT
