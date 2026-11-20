# Changelog

## 0.7.3

### Changed

- **A clearer tool page.** It opens with a before and after: your project without the tool and with it, side by side, with the "without" written by your AI for your project. Then:
  - **How it fits** as a timeline.
  - **How it bites** as a card per risk, labelled Security, Cost, Reliability or Setup by your AI.
  - **Prove it works** as a checklist with a copyable command.
- **The links at the bottom** (docs, a question for your AI, remove from the feed) are now full-width rows, each with a one-line hint, and "Why this tool?" is a card with one button.

## 0.7.2

### Changed

- **The day starts with a greeting, not a to-do list.** The Now tab opens with good morning (or afternoon), a quote about the craft that changes daily, what is waiting below, and the one skill to focus on. The × hides it until tomorrow.
- **Questions come after the cards.** "Check what you just saw" sits at the end of the feed: one question for each idea in the last day's cards (up to five), asked after you have read them. Answers count toward review like any other.

## 0.7.1

### Added

- **Cards that talk about your code.** When you open a card, your AI rewrites its hook, "Know this" and "How it bites" around the lines it was seen in, naming your own functions and values instead of a textbook example.
  - Every name in backticks and every "line N" is checked against your lines. A part that mentions something not there is dropped, and Miyagi's general text shows for that part instead.
  - Saved per card and redone only when those lines change, so reopening a card costs nothing.
  - **Show the general lesson** switches back on any card.
  - New setting `miyagi.ai.tailorCards`: `onOpen` (default), `always` (also the first three cards of each change as they arrive), or `off`.

## 0.7.0

### Added

- **Your first five minutes.** Once a day the Now tab opens with three steps:
  1. Recall what is due, with yesterday's misses named.
  2. Read one function you did not write.
  3. The one skill to work on next.

  **Done for today** hides it until tomorrow; **Show Today's First Five Minutes** brings it back.
- **Read it cold.** Miyagi picks a function from the files changed most recently and shows only its name and signature. You say what it does, then the body appears. Your AI compares your prediction with the code: what the name told you, what it hid, and the one line most worth noticing. Without an AI you judge it yourself. "Read code you did not write" is a new skill on the map.
- **Guardrails before you commit.** Staging a change now checks it for what it could cost:
  - a committed env file
  - a secret behind a `NEXT_PUBLIC_`/`VITE_` prefix
  - a service-role key in client code
  - open Firebase rules or a wildcard CORS origin
  - unescaped HTML
  - an unsigned webhook
  - a secret in a log line
  - a 100% trace sample rate
  - a query with no limit
  - an AI call with no output cap
  - a job that runs every minute

  Each finding asks you a question about its line before it shows the answer and the fix, and you can mark it as intended. The idea it is an instance of comes up for review that day. It never blocks a commit.
- **Major version upgrades.** When a dependency jumps a major version (or a 0.x minor), a card asks what you think might break, then your AI explains what changed, where it touches your code, and what to check, with a question you can put on review. Without an AI it points you to the changelog.
- **Mock interview.** Four questions in the Grow tab:
  - two on ideas you hold
  - one on a tool your project uses
  - one "tell me about a time" from your own story

  You type your answers against a soft timer, and each one is judged as an interviewer would. At the end you see what to work on, and ideas that did not land come back for review today.

### Fixed

- Questions from decisions, incidents and saved alternatives disappeared from review after the editor restarted. They are now kept in `~/.miyagi/coach-ideas.json` and registered at startup.

## 0.6.0

### Added

- **Why not another way?** A button on an idea's page. You name another way the code could have been written, or skip, and your AI shows two real alternatives: a short sketch, what each does better, what it would cost in your project, and when it would be the better pick, plus a verdict on the choice that was made and a note on your own idea. One click saves it to your decision log, where it comes back on review.
- **Your project's glossary.** The words that belong to your project, found by your AI from its models, schemas and types (the Dojo's **Find words in this project**) or from one change (**Project words in it**). Each word has a page: guess what it means first, then see the meaning, how the code represents it, the files it lives in, and related words. Add a word to your review and its question comes back like any other. Words are kept per project in `~/.miyagi/glossary.json`, and files the AI was not shown are never listed.

## 0.5.1

### Removed

- **Voice.** "Read it aloud" on cards, the `miyagi.voice.autoRead` and `miyagi.voice.wordsPerMinute` settings, and reading new cards, explanations and walkthrough steps aloud are gone. The system speech engines it used sounded robotic and added little. Remove the two settings from your `settings.json` if you set them; they no longer do anything.

## 0.5.0

Miyagi taught the ideas in the code. This release adds what grows a developer beyond that: the tools a project adopts, reading errors, judging where a change will land, and seeing your own progress. Every new feature asks you to go first, then shows you the answer.

### Added

- **New tool tracks.** When a project adopts one of 49 catalogued tools (Sentry, Stripe, Prisma, Supabase, Zod, Playwright, Docker, FastAPI…), Miyagi notices it from the package, a config file, an environment variable or the setup command. Each tool gets a page: guess what it is for first, then see the job it does, how it fits, how it bites and how to prove it works. Your AI can also show where it is wired into your project. Its 5 or 6 key terms go on spaced review, and you are *conversant* when every term is at green belt.
- **Teach me about…** Type any tool or idea in the Now tab. Tools the catalogue does not know are described by your AI and get the same track.
- **Debugging coach.** When a command fails, in your terminal or your assistant's, a card asks you to read the error first: tap the line that matters, say what broke, then compare your read with the real cause, the fix and a habit for next time. Errors that keep coming back can be turned into a lesson. Reading errors has its own belt.
- **Predict the change.** When Claude Code is given a new task (or when you press the button), say which files it will touch. When the change lands you see what you got right, what you missed, and the surprises.
- **Before you commit.** Stage a large change and you are offered one question about what you are committing. It never blocks the commit.
- **Explain it in your own words.** From green belt up, some review questions ask for a typed answer, judged by your AI. A partly-right answer counts, but the belt holds.
- **Decisions.** Find the design decisions in a change, or log one yourself. Saved decisions come back on review so you can still say why, and copy out as decision records.
- **The Grow tab:**
  - **Going first:** how often you try before your AI explains, week by week.
  - **Your map:** 18 skills across Junior, Mid and Senior, showing what your projects have not asked of you yet, with an exercise in your own project.
  - Tools, decisions, and **learn from something that broke**.
  - **Your story:** what you have done, with interview practice and a Markdown export.
- **New packages** that the catalogue does not know are listed on a change, one click from a lesson.
- A one-time offer to let your AI find ideas and tools in a change when nothing built-in matches.

### Privacy

- The capture hook now also records **failed** commands, keeping up to six scrubbed lines that look like the error. Full output is never kept.
- It also records **that** a new task was given to Claude Code, never what was asked.
- Your own terminal's output is read in memory only while a command runs, and only when it fails.
- New progress lives in `~/.miyagi/growth.json` on your machine.

## 0.4.0

### Added

- **Team mode, with no server.** Share a small summary (ideas and belts only) into a folder in your repository; a team report shows where the team is thin and who to ask.
- **Tour the Ideas in This Codebase**: every idea a repository relies on, in learning order, with the files to start reading.
- **Whole-function context.** Where a language server is running, explanations and exercises are given the function an idea sits in.

### Fixed

- **Commits are now noticed in every editor.** In VS Code neither the git extension nor the file watcher reported them, so held lessons waited for the quiet timer. While anything is held, git is asked directly.

### Verified

- Right-side docking in real VS Code (1.147), and the smoke test in VS Code, Cursor and Antigravity IDE.
- The Ollama provider against a stand-in server speaking its API; the Gemini CLI flags against its own help.

## 0.3.0

Built on what is known about how people learn, and about what goes wrong when an AI does the work: recalling beats rereading, mixed practice beats blocked practice, help that never fades becomes a crutch, and people who let an assistant answer for them retain least.

### Changed

- **XP is paid for recall and unaided work, not for exposure.** An idea merely appearing in your assistant's code no longer pays anything.
- **Recall first.** A question appears without its choices. You answer in your head, tap how sure you are (Sure, Think so, Guessing), and then the choices appear.
- **"Explain in my code" asks you first.** What do you think these lines do? A nudge and a pointer are available before the full explanation, and "Skip, just show me" is always there. Your explanation and the model's are shown together.
- **Cards wait for a stopping point.** New lessons are held until a commit, a test run, or a minute of quiet, instead of arriving mid-task.
- **A weekly goal replaces the daily streak.** "3 of 4 days this week". A week that falls one day short still counts.
- **Review mixes topics.** With a topic chosen, about one question in four still comes from another, labelled as such.
- **Support fades as a belt rises.** From green belt the question comes first and the lesson waits behind a link; at brown and black the idea's hardest question is asked.
- **Black belt needs transfer.** One question about the idea in a different language or framework, before the last step.

### Added

- **Confident misses get an extra review**, and are marked as such: being sure and wrong is the error most likely to return.
- **Practice**, one button per card: a why question, trace it by hand, spot the difference, find the bug, a question on your own code.
- **Your turn**: a five-line follow-up for you to write without the assistant. Miyagi checks the diff to confirm who wrote it, and never writes the code.
- **The unaided check**: about ten questions with every kind of help off, and a plain "7 of 10 without help" beside your belts.
- **When you say you are sure**: how often each level of confidence turned out right.
- **What you got wrong, and what is true**: a journal of misses, confident ones first.
- **Write my own question** on any card, scheduled like the rest.
- **A mirror**: "You opened 6 of the 14 files your assistant changed this week." A description, not a score.
- **Wrap up this session**: say what changed today from memory, then compare with what Miyagi saw.
- **Review after your first commit of the day** (off by default): up to three questions.
- Settings for each of the above.

### Fixed

- Commits are noticed from the repository's own HEAD log as well as from the editor's git extension, which did not report them reliably.

## 0.2.0

### Fixed

- The empty feed no longer says "Nothing to teach yet" while questions are due. It leads with the review.
- A "last change seen" line shows that the watcher is alive and what it made of the last change.
- Uncommitted changes that already existed when the window opened are counted and offered, instead of silently skipped.
- The footer says "Watching 7 projects" instead of listing every name.
- The level title uses dojo ranks (Novice, Apprentice, Practitioner, Adept, Sensei) instead of the terminal-track titles.
- A lesson says which assistant wrote the change, when command capture saw it.
- Folders that are not git repositories are watched file by file.
- The SQL injection pattern catches values wrapped in SQL quotes.
- The capture tests no longer touch the developer's real home directory.

### Added

- **Open Beside the Editor**: the panel as a tab, for editors whose right side bar is taken.
- **Toolbar** on the panel: review, pause, open beside, settings, and a menu with everything else.
- **Status bar item** with the number of questions due.
- **Pause** (30 minutes to tomorrow morning) and **quiet hours**.
- **Topics**: filter the feed, the dojo and review to one shelf; ideas in the chosen topic are taught first.
- **A browsable dojo**: every idea is a button that opens its lesson. Locked ideas can be read.
- **Ask a follow-up** under any explanation.
- **Explain it yourself first**: write what the lines do, then have it judged.
- **Quiz me on my code**: a question about your own lines.
- **Find the bug**: a copy of your code with one line changed. Your file is never touched.
- **What the assistant said**: Claude Code's own words from when it wrote the file. No model call.
- **Walk me through this change**: steps in reading order, each highlighted in the editor.
- **Check it for risks**: up to three real risks in a change, with the line and the fix.
- **Find ideas with AI** (opt-in, rate-limited): lessons for ideas the built-in list does not know.
- **Idea packs**: JSON files in `~/.miyagi/ideas/` add your own ideas.
- **Nine more built-in ideas**: raw HTML injection, rate limiting, transactions, caching, pagination, file uploads, webhooks, React props, background jobs.
- **Explain How This Project Works**: a map of the repository written by your AI.
- **Show My Week**: a report from your history. No model call.
- **Teach Me a Branch or Pull Request**.
- **Ollama** as a provider, for code that must not leave the machine.
- **Read it aloud**, and optional automatic reading.
- **A cost meter**: AI calls and estimated tokens this week.
- **Depth suggestion** when your answers say the current depth is wrong.
- **"Builds on"** links to the idea a card leans on, and lesson cards ordered accordingly.
- **Risk tag** on ideas where a misunderstanding costs data, money or a breach.
- Settings: ignore patterns, excluded repositories, notification level, review reminder, quiet hours, status bar, voice.
- **Show Diagnostics**: what Miyagi found on this machine and why.

### Decided

- No telemetry. The cost meter and the weekly report are computed and kept on your machine.

## 0.1.0

- First version: a side panel that watches git for code your assistant wrote, cards for the ideas in it, "Explain in my code" on your own AI, a review queue, a dojo, and optional command capture for Claude Code and Cursor.
