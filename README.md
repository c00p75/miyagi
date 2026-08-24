# 🥋 miyagi

**A patient, gamified, voice-enabled MCP coding tutor.**
*You run the commands. It drills, corrects, catches the falls, and keeps score.*

Wax on, wax off. `miyagi` never does the work for you — it hands you the next command,
explains it at your level, and turns every result into a lesson. Each run comes back as a
teaching card: roadmap alignment, level-appropriate What/How/Trade-offs, a Mermaid mental
model, common pitfalls, curated docs, and an active-recall quiz — narrated aloud through
your OS's native speech engine.

## Why it's safe to install

It runs shell commands on your machine, so it's built to be read before it's trusted:

- **Nothing dangerous executes.** `rm -rf`, `dd of=/dev/*`, fork bombs, `curl | sh`, `--force`
  pushes and `chmod -R 777` are pattern-matched and forced into dry-run — *regardless* of what
  the calling model claims. The screen defends against a confused AI, not just a careless user.
- **Failures teach instead of crashing.** A non-zero exit returns a *Hotfix Diagnostic* with a
  troubleshooting ladder. The server never throws.
- **Bounded.** 60-second timeout, 4 MB output cap, no network calls, no telemetry, no API keys.
- **Small.** ~25 kB packed, two runtime dependencies (the MCP SDK and zod).

## Features

| Engine | What it does |
| --- | --- |
| **Audio** | Non-blocking FIFO queue (no overlapping voices), markdown/URL/emoji stripped before speech, per-OS engine with graceful fallbacks — a missing TTS binary degrades silently instead of crashing |
| **Roadmap** | In-memory track state: category → roadmap → topic → step N of M, with auto-suggested next commands |
| **Gamification** | XP (+15 per execution, +25 per correct quiz with streak multipliers), `Level = floor(XP/100)+1`, four unlockable titles, streak badges |
| **Safety** | Pattern screen for `rm -rf`, `dd of=/dev/*`, fork bombs, `curl \| sh`, force pushes — auto-forced into dry-run |
| **Hotfix** | Failed commands return a *Tutor Hotfix Diagnostic* with a troubleshooting ladder, never an exception |
| **Notes** | `ROADMAP_PROGRESS.md` export with quiz accuracy and full session log |

### Speech engines by platform

| Platform | Engine |
| --- | --- |
| macOS | `say -r <wpm>` |
| Windows | PowerShell `System.Speech.Synthesis.SpeechSynthesizer` |
| Linux | `spd-say` → falls back to `espeak-ng` / `espeak` / `festival`, probed with `command -v` before use |

## Tools

- `quick_config` — switch skill level (Junior/Mid/Senior), category, track, topic, voice, in one call
- `set_active_roadmap` — set category, roadmap, topic node, and step counters
- `get_next_roadmap_command` — copy-pasteable next command for the current milestone (`advance: true` to step forward)
- `configure_voice` — toggle audio, set words-per-minute, speak a test phrase
- `get_user_stats` — XP, level, title, streaks, badges, title ladder
- `run_teaching_command` — execute or dry-run a command and return the full teaching card
- `verify_quiz_answer` — grade the quiz, update streak/XP/badges, speak feedback
- `export_roadmap_notes` — write `ROADMAP_PROGRESS.md`

## Install

Nothing to install ahead of time — point your MCP client at `npx` and it fetches on first run:

```bash
npx -y miyagi
```

Or pin it globally:

```bash
npm install -g miyagi
```

<details>
<summary>Build from source instead</summary>

```bash
git clone https://github.com/c00p75/miyagi.git
cd miyagi
npm install
npm run build      # emits dist/miyagi.js
```
Then use `"command": "node", "args": ["<ABS_PATH>/dist/miyagi.js"]` below.
</details>

Linux users who want audio:

```bash
sudo apt install speech-dispatcher   # provides spd-say
```

## Configure your MCP client

Every client uses the same three lines. No API keys, no accounts — the server runs entirely on your machine.

### Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
`%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "miyagi": {
      "command": "npx",
      "args": ["-y", "miyagi"]
    }
  }
}
```

### Cursor
`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global) — same shape:

```json
{
  "mcpServers": {
    "miyagi": {
      "command": "npx",
      "args": ["-y", "miyagi"]
    }
  }
}
```

### AntiGravity / Windsurf
`~/.codeium/windsurf/mcp_config.json` — same `mcpServers` shape.

### Claude Code
```bash
claude mcp add miyagi -- npx -y miyagi
```

Restart the client, then try: *"Set my roadmap to Backend Developer, then teach me `docker compose config`."*

## Notes & limits

- State is **in-memory per session** — XP and streaks reset when the client restarts. Export notes before you finish.
- Commands run with a 60s timeout and a 4 MB output buffer; interactive/long-running commands should be run in your own terminal.
- The server only writes to `stderr` for diagnostics, keeping `stdout` clean for MCP frames.
