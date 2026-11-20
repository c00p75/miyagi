# Miyagi

Miyagi teaches people the ideas in the code their AI assistant writes. This
repository holds the MCP server (`src/`) and the editor extension (`vscode/`).

## Teaching standard: read before writing anything a learner will see

`docs/TEACHING.md` is the standard for all learner-facing content: cards,
lessons, explanations, questions, feedback and interface text. Follow it when
you:

- write or change a prompt in `vscode/src/prompts.ts` or `vscode/src/lesson.ts`
- write built-in lesson text (`src/concepts.ts`, `vscode/src/toolCatalog.ts`)
- write interface copy in `vscode/media/panel.js`
- design or mock up a card or screen

The short form the prompts use lives in `vscode/src/standards.ts`. Keep it in
step with `docs/TEACHING.md`.

The essentials:

- Explain through the learner's own project, starting from something they know.
- The learner predicts or guesses before being told.
- Explain every error, output and code line that is shown.
- One idea at a time; define every term at Junior depth.
- End each part with the point in one line, and have the learner say it back.
- Lessons have eight fixed sections; only the depth (Junior, Mid, Senior) changes.
- Never invent links, versions, files or line numbers.

## Working here

- Extension: `cd vscode && npm run typecheck && npm test`. Preview the panel in
  a browser with `npm run harness`.
- Server: `npm run typecheck && npm test` in the repository root. One terminal
  test ("watch treats what was already there…") is timing-sensitive and can
  fail under full-suite load; it passes alone.
- A model's reply is untrusted input: every prompt has a parser that returns a
  typed value or null.
