// @ts-check
/*
 * The panel's renderer. It holds no teaching logic: the extension host decides
 * what is taught, how answers are graded and what any model is asked, and
 * sends the whole state each time something changes. This file draws it.
 *
 * Everything is rendered from data through `esc`, and the page's CSP allows no
 * inline script or style, so text from a model or a source file can only ever
 * arrive as text.
 *
 * The only things kept here are the ones that belong to this view alone: which
 * tab is showing, which cards are open, what is half-typed in a text box, and
 * the questions currently on screen.
 */
(function () {
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));

  /** @type {any} */
  let state = null;
  const ui = Object.assign(
    { tab: "now", open: {}, more: {}, practice: {}, lesson: {}, idea: null, depthNote: "unseen" },
    vscode.getState() || {},
  );
  /** slot -> { quiz, answer, picked }. A slot is a card key, or `<key>|own` for a question about its code. */
  const quizzes = {};
  /** Text typed and not yet sent, by draft id, so a redraw does not eat it. */
  const drafts = {};
  /** card key -> true while the "write my own question" form is open */
  const writing = {};
  /** The end-of-session recap: null, "writing", or what came back to compare. */
  let recap = null;
  /** The result of an unaided check that just finished. */
  let checked = null;
  /** lesson id -> which walkthrough step is showing */
  const walkAt = {};
  let review = { asked: false, quiz: null, answer: null, picked: -1, cleared: 0 };
  /** @type {{rows: any[], belts: string[]} | null} */
  let dojo = null;
  /** The lesson opened from the dojo, when one is. */
  let ideaCard = null;

  const send = (/** @type {any} */ message) => vscode.postMessage(message);
  const remember = () => vscode.setState(ui);

  /* ---- text ------------------------------------------------------ */

  function esc(/** @type {unknown} */ value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** `code`, **bold** and _italic_, applied after escaping. */
  function inline(/** @type {string} */ text) {
    return esc(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  }

  /** Paragraphs and fenced code. Enough for a short explanation, nothing more. */
  function prose(/** @type {string} */ text) {
    const out = [];
    String(text)
      .split(/```[a-zA-Z0-9]*\n?/)
      .forEach((part, i) => {
        if (i % 2 === 1) {
          out.push(`<pre><code>${esc(part.replace(/\n$/, ""))}</code></pre>`);
          return;
        }
        for (const para of part.split(/\n\s*\n/)) {
          const trimmed = para.trim();
          if (trimmed) out.push(`<p>${inline(trimmed).replace(/\n/g, "<br>")}</p>`);
        }
      });
    return out.join("");
  }

  function clock(/** @type {string} */ iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const today = new Date().toDateString() === d.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return today ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  }

  function until(/** @type {string | null} */ iso) {
    if (!iso) return "";
    const ms = Date.parse(iso) - Date.now();
    if (!Number.isFinite(ms)) return "";
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const list = (/** @type {string[]} */ items) =>
    items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

  /** Due questions, narrowed to the chosen topic when there is one. */
  function dueCount() {
    const s = state.status;
    return state.topic ? s.dueByTopic[state.topic] || 0 : s.dueQuestions;
  }

  const inTopic = (/** @type {any} */ item) => !state.topic || item.topic === state.topic;
  const busy = (/** @type {string} */ slot) => state.busy[slot];
  const failed = (/** @type {string} */ slot) => state.errors[slot];

  function waiting(/** @type {string} */ slot) {
    return busy(slot) ? `<div class="note busy"><span class="spinner" aria-hidden="true"></span>Asking ${esc(busy(slot))}…</div>` : "";
  }

  function problem(/** @type {string} */ slot) {
    if (!failed(slot)) return "";
    const choose = state.ai.label ? "" : ` <button class="link" data-action="command" data-id="miyagi.chooseAi">Choose an AI</button>`;
    return `<div class="note error"><p>${esc(failed(slot))}${choose}</p></div>`;
  }

  /* ---- header ---------------------------------------------------- */

  function header() {
    const s = state.status;
    const depths = ["Junior", "Mid", "Senior"]
      // "Depth:" on every option, so the closed dropdown never reads as a second filter.
      .map((d) => `<option value="${d}"${d === s.depth ? " selected" : ""}>Depth: ${d}</option>`)
      .join("");
    const topics = [`<option value="">All topics</option>`]
      .concat(
        state.topics.map(
          (/** @type {string} */ t) => `<option value="${esc(t)}"${t === state.topic ? " selected" : ""}>${esc(t)}</option>`,
        ),
      )
      .join("");
    const w = state.week;
    // A weekly target with slack in it, rather than a streak one missed day destroys.
    const streak = w
      ? ` · ${w.days} of ${w.goal} days this week${w.weeksRunning ? `, ${plural(w.weeksRunning, "week")} running` : ""}`
      : "";

    let banner = "";
    if (state.quiet) {
      banner =
        state.quiet.why === "paused"
          ? `<div class="banner">Paused until ${esc(clock(state.quiet.until))}. <button class="link" data-action="command" data-id="miyagi.resume">Resume</button></div>`
          : `<div class="banner">Quiet hours. Changes are still read; nothing new is shown until they end.</div>`;
    } else if (s.suggestedDepth) {
      const up = ["Junior", "Mid", "Senior"].indexOf(s.suggestedDepth) > ["Junior", "Mid", "Senior"].indexOf(s.depth);
      banner = `<div class="banner">
        ${up ? "You are answering most questions correctly." : "Most answers are missing at this depth."}
        Try <strong>${esc(s.suggestedDepth)}</strong> explanations?
        <button class="link" data-action="acceptDepth" data-depth="${esc(s.suggestedDepth)}">Switch</button>
        <button class="link" data-action="dismissDepth" data-depth="${esc(s.depth)}&gt;${esc(s.suggestedDepth)}">No thanks</button>
      </div>`;
    }

    return `
      <header class="top">
        <div class="who">
          <span class="level">Level ${s.level}</span>
          <span class="rank">${esc(s.rank)}</span>
        </div>
        <div class="filters">
          <label>
            <span class="sr">Topic</span>
            <select data-change="topic" title="Show, teach first and review one topic">${topics}</select>
          </label>
          <label>
            <span class="sr">Explanation depth</span>
            <select data-change="depth" title="How deep explanations and questions go. Every idea still appears at every depth.">${depths}</select>
          </label>
        </div>
        ${
          ui.depthNote === "showing"
            ? `<div class="banner" role="status">Depth changes how deep explanations and questions go. Every idea still appears, at any depth. <button class="link" data-action="depthNoted">Got it</button></div>`
            : ""
        }
        <progress max="100" value="${s.intoLevel}" aria-label="Progress to next level"></progress>
        <div class="meta">${s.xp} XP${streak} · ${s.discovered} of ${s.concepts} ideas found</div>
        ${banner}
      </header>`;
  }

  function tabs() {
    const tab = (/** @type {string} */ id, /** @type {string} */ label, count = 0) => `
      <button role="tab" class="tab${ui.tab === id ? " on" : ""}" aria-selected="${ui.tab === id}" data-action="tab" data-tab="${id}">
        ${label}${count ? `<span class="count">${count}</span>` : ""}
      </button>`;
    return `<nav class="tabs" role="tablist">${tab("now", "Now")}${tab("review", "Review", dueCount())}${tab("dojo", "Dojo")}</nav>`;
  }

  /* ---- questions ------------------------------------------------- */

  const CONFIDENCE = [
    ["sure", "Sure"],
    ["think", "Think so"],
    ["guess", "Guessing"],
  ];

  function quizBlock(/** @type {any} */ entry, /** @type {string} */ scope, /** @type {string} */ slot, heading = "") {
    const { quiz, answer, picked } = entry;
    const top = `${heading ? `<h4>${esc(heading)}</h4>` : ""}${
      quiz.otherTopic ? `<p class="muted from-other">From another topic, mixed in on purpose.</p>` : ""
    }<div class="question">${prose(quiz.question)}</div>`;

    // Recall before recognition: the choices stay hidden until the learner has
    // tried to answer in their head and said how sure they are. One tap.
    if (state.recallFirst && !entry.confidence && !answer) {
      const taps = CONFIDENCE.map(
        ([level, label]) =>
          `<button data-action="confidence" data-scope="${scope}" data-slot="${esc(slot)}" data-level="${level}">${label}</button>`,
      ).join("");
      return `<div class="quiz">${top}
        <p class="muted">Answer it in your head first. Then: how sure are you?</p>
        <div class="confidence">${taps}</div>
      </div>`;
    }

    const letters = "ABCDEFGH";
    const choices = quiz.choices
      .map((/** @type {string} */ choice, /** @type {number} */ i) => {
        let cls = "choice";
        if (answer) {
          if (i === answer.answerIndex) cls += " right";
          else if (i === answer.chosenIndex) cls += " wrong";
        } else if (i === picked) cls += " pending";
        return `<button class="${cls}" data-action="answer" data-scope="${scope}" data-slot="${esc(slot)}" data-index="${i}"${answer || picked >= 0 ? " disabled" : ""}>
          <span class="letter">${letters[i]}</span><span>${inline(choice)}</span></button>`;
      })
      .join("");
    let result = "";
    if (answer) {
      const again = answer.nextDueAt ? ` · back in ${until(answer.nextDueAt)}` : "";
      const belt = answer.correct && answer.nextDueAt ? ` · ${esc(answer.belt)} belt` : "";
      const notes = [
        answer.confidentMiss ? "You were sure, and it was wrong. Those are the ones that come back, so this one gets an extra review." : "",
        answer.repaysMiss ? "Right this time. You were sure and wrong on this one before, so the belt holds until you are right once more." : "",
        answer.needsTransfer ? "One step from black belt. Black also needs this idea recognised somewhere you did not learn it: open it in the Dojo and take the transfer question." : "",
        answer.transferPassed ? "That was the transfer question. The next correct review takes this idea to black belt." : "",
        answer.leveledUp ? "Level up." : "",
        ...(answer.newBadges || []).map((/** @type {string} */ b) => `Badge: ${b}`),
      ].filter(Boolean);
      result = `
        <div class="result ${answer.correct ? "ok" : "miss"}">
          <strong>${answer.correct ? "Correct" : "Not quite"}</strong>
          <span class="muted">+${answer.xpAwarded} XP${again}${belt}</span>
          <p>${inline(answer.explanation)}</p>
          ${notes.map((n) => `<p class="extra">${esc(n)}</p>`).join("")}
        </div>`;
    }
    return `<div class="quiz">${top}<div class="choices">${choices}</div>${result}</div>`;
  }

  /* ---- one card -------------------------------------------------- */

  function explanationBlock(/** @type {any} */ c) {
    const explanation = state.explanations[c.key];
    const slot = `${c.key}|explain`;
    if (!explanation) return waiting(slot) + problem(slot);
    const extra = state.extras[c.key] || { followUps: [] };
    const asked = extra.followUps
      .map(
        (/** @type {any} */ f) => `<div class="followup"><p class="asked">${esc(f.question)}</p>${prose(f.answer)}<p class="by">${esc(f.by)}</p></div>`,
      )
      .join("");
    const draft = `${c.key}|followUp`;
    const ask = busy(draft)
      ? waiting(draft)
      : `<form class="ask" data-submit="followUp" data-key="${esc(c.key)}">
           <input type="text" data-draft="${esc(draft)}" value="${esc(drafts[draft] || "")}" placeholder="Ask a follow-up about this code" aria-label="Ask a follow-up question" maxlength="600">
           <button type="submit">Ask</button>
         </form>`;
    return `<div class="mine"><h4>In your code</h4>${prose(explanation.text)}<p class="by">Written by ${esc(explanation.by)}</p>${asked}${ask}${problem(draft)}</div>`;
  }

  function attemptBlock(/** @type {any} */ c) {
    const slot = `${c.key}|attempt`;
    const extra = state.extras[c.key] || {};
    const attempt = extra.attempt;
    if (!attempt) return problem(slot);
    if (attempt.verdict) {
      const label = { right: "You had it", partly: "Partly", wrong: "Not yet" }[attempt.verdict];
      return `<div class="block">
        <h4>Your explanation</h4>
        <p class="asked">${esc(attempt.text)}</p>
        <p><span class="tag verdict-${esc(attempt.verdict)}">${label}</span></p>
        ${prose(attempt.feedback)}
        <p class="by">Judged by ${esc(attempt.by)}</p>
      </div>`;
    }
    // Help in three steps, smallest first. The full explanation is the last one.
    const hints = extra.hints || {};
    const hintSlot = `${c.key}|hint`;
    const shown = [
      hints.nudge ? `<div class="hint"><span class="muted">Nudge</span>${prose(hints.nudge)}</div>` : "",
      hints.pointer ? `<div class="hint"><span class="muted">Pointer</span>${prose(hints.pointer)}</div>` : "",
    ].join("");
    const nextHint = busy(hintSlot)
      ? ""
      : !hints.nudge
      ? `<button class="link" data-action="hint" data-key="${esc(c.key)}" data-step="nudge">Stuck? Get a nudge</button>`
      : !hints.pointer
      ? `<button class="link" data-action="hint" data-key="${esc(c.key)}" data-step="pointer">Point me at the line</button>`
      : "";
    return `<div class="block">
      <h4>Your turn first</h4>
      <p>What do you think these lines do? A sentence or two in your own words.</p>
      <pre><code>${esc(attempt.code)}</code></pre>
      ${shown}${waiting(hintSlot)}${problem(hintSlot)}
      ${
        busy(slot)
          ? `<p class="asked">${esc(attempt.text)}</p>${waiting(slot)}`
          : `<form data-submit="attempt" data-key="${esc(c.key)}">
               <textarea data-draft="${esc(slot)}" rows="3" placeholder="These lines…" aria-label="Your explanation" maxlength="800">${esc(drafts[slot] || "")}</textarea>
               <div class="actions">
                 <button type="submit" class="primary">Check my explanation</button>
                 ${nextHint}
                 <button type="button" class="link" data-action="explain" data-key="${esc(c.key)}">Skip, just show me</button>
               </div>
             </form>`
      }
      ${problem(slot)}
    </div>`;
  }

  function bugBlock(/** @type {any} */ c) {
    const slot = `${c.key}|bug`;
    const drill = (state.extras[c.key] || {}).bug;
    if (!drill) return waiting(slot) + problem(slot);
    const lines = drill.lines
      .map((/** @type {string} */ line, /** @type {number} */ i) => {
        const n = i + 1;
        let cls = "codeline";
        if (drill.found && n === drill.bugLine) cls += " right";
        else if (drill.wrong.includes(n)) cls += " wrong";
        return `<button class="${cls}" data-action="bugGuess" data-key="${esc(c.key)}" data-line="${n}"${drill.found ? " disabled" : ""}><span class="ln">${n}</span><code>${esc(line) || " "}</code></button>`;
      })
      .join("");
    const below = drill.found
      ? `<div class="result ok"><strong>Line ${drill.bugLine}</strong> <span class="muted">${drill.wrong.length ? `found after ${plural(drill.wrong.length, "miss")}` : "found"}</span>${prose(drill.explanation)}</div>`
      : `<p class="muted">${drill.wrong.length ? "Not that line. " + esc(drill.hint || "Look again at what each line assumes.") : "This is a copy of your code with one line changed. Click the line you think is wrong."}
          <button class="link" data-action="bugReveal" data-key="${esc(c.key)}">Show me</button></p>`;
    return `<div class="block"><h4>Find the bug</h4><div class="code">${lines}</div>${below}<p class="by">Exercise by ${esc(drill.by)}. Your real file was not changed.</p></div>`;
  }

  function contrastBlock(/** @type {any} */ c) {
    const slot = `${c.key}|contrast`;
    const x = (state.extras[c.key] || {}).contrast;
    if (!x) return waiting(slot) + problem(slot);
    const side = (/** @type {"a" | "b"} */ which) => {
      let cls = "snippet";
      if (x.picked) cls += which === x.flawed ? " right" : which === x.picked ? " wrong" : "";
      return `<button class="${cls}" data-action="contrastPick" data-key="${esc(c.key)}" data-pick="${which}"${x.picked ? " disabled" : ""}>
        <span class="letter">${which.toUpperCase()}</span><pre><code>${esc(x[which])}</code></pre></button>`;
    };
    const below = x.picked
      ? `<div class="result ${x.picked === x.flawed ? "ok" : "miss"}"><strong>${x.picked === x.flawed ? "That is the one" : `It was ${x.flawed.toUpperCase()}`}</strong>${prose(x.explanation)}</div>`
      : "";
    return `<div class="block"><h4>${esc(x.question)}</h4>${side("a")}${side("b")}${below}<p class="by">Exercise by ${esc(x.by)}.</p></div>`;
  }

  function ownCardBlock(/** @type {any} */ c) {
    const own = (state.extras[c.key] || {}).ownCard || {};
    if (own.saved) {
      return `<div class="block"><h4>Your question</h4><p>Saved. It will come back for review like any other, and it is listed in the Dojo.</p></div>`;
    }
    if (!writing[c.key]) return "";
    const d = (/** @type {string} */ f) => `${c.key}|own.${f}`;
    const field = (/** @type {string} */ f, /** @type {string} */ label, /** @type {string} */ hint) =>
      `<label class="field"><span>${label}</span><input type="text" data-draft="${esc(d(f))}" value="${esc(drafts[d(f)] || "")}" placeholder="${esc(hint)}" maxlength="300"></label>`;
    return `<div class="block">
      <h4>Write your own question</h4>
      <p class="muted">Writing the question is half the learning. Good wrong answers are things you might have believed.</p>
      <form data-submit="ownCard" data-key="${esc(c.key)}">
        ${field("question", "Question", "What happens if…")}
        ${field("answer", "Correct answer", "")}
        ${field("wrong1", "A wrong answer", "")}
        ${field("wrong2", "Another wrong answer", "")}
        ${field("wrong3", "One more (optional)", "")}
        ${field("why", "Why (optional)", "One line you will thank yourself for")}
        ${own.problem ? `<div class="note error"><p>${esc(own.problem)}</p></div>` : ""}
        <div class="actions"><button type="submit" class="primary">Save question</button>
        <button type="button" class="link" data-action="writeOwn" data-key="${esc(c.key)}">Cancel</button></div>
      </form>
    </div>`;
  }

  function whyBlock(/** @type {any} */ c) {
    const why = (state.extras[c.key] || {}).why;
    if (!why) return "";
    if (why.missing) {
      return `<div class="block"><h4>What the assistant said</h4><p class="muted">Nothing was found for this file. This reads Claude Code's own session record, so it only works for files Claude Code edited in a session that is still on this machine.</p></div>`;
    }
    return `<div class="block"><h4>What the assistant said when it wrote this</h4>${prose(why.text)}${why.at ? `<p class="by">${esc(clock(why.at))}, in its own words</p>` : ""}</div>`;
  }

  function card(/** @type {any} */ c, /** @type {boolean} */ openByDefault, pinned = false) {
    const isOpen = pinned || (ui.open[c.key] ?? openByDefault);
    const tags = [
      c.status === "new"
        ? `<span class="tag new">New</span>`
        : c.status === "locked"
        ? `<span class="tag">Locked</span>`
        : `<span class="tag belt belt-${esc(c.belt)}">${esc(c.belt)} belt</span>`,
      c.risk ? `<span class="tag risk" title="Misunderstanding this one costs data, money or a breach">Risk</span>` : "",
    ].join("");
    const head = `
      <button class="card-head" data-action="toggle" data-key="${esc(c.key)}" aria-expanded="${isOpen}"${pinned ? " disabled" : ""}>
        <span class="emoji" aria-hidden="true">${esc(c.emoji)}</span>
        <span class="card-title">${esc(c.title)}</span>
        <span class="tags">${tags}</span>
      </button>
      <p class="hook">${inline(c.hook)}</p>`;
    if (!isOpen) return `<article class="card closed">${head}</article>`;

    const others = c.otherFiles > 0 ? `<span class="muted"> and ${plural(c.otherFiles, "other file")}</span>` : "";
    const where = c.file
      ? `<div class="where">
          <button class="link file" data-action="openFile" data-key="${esc(c.key)}" title="Open this file">${esc(c.file)}</button>${others}
          ${c.evidence ? `<code class="evidence">${esc(c.evidence)}</code>` : ""}
        </div>`
      : `<p class="where muted">${
          c.status === "locked"
            ? "Not seen in your code yet. Its question unlocks when your assistant writes code that uses it."
            : "Seen before this panel was installed, so there is no file to point at yet."
        }</p>`;
    const origin =
      c.origin === "own"
        ? `<p class="muted origin">You wrote this one.</p>`
        : c.origin === "ai"
        ? `<p class="muted origin">This lesson was written by your AI from your code, not by Miyagi's authors. Check anything that matters.</p>`
        : c.origin === "pack"
        ? `<p class="muted origin">From one of your idea packs.</p>`
        : "";
    const buildsOn = c.buildsOn
      ? `<p class="builds-on">Builds on <button class="link" data-action="idea" data-id="${esc(c.buildsOn.id)}">${esc(c.buildsOn.emoji)} ${esc(c.buildsOn.title)}</button>, which you have not met yet.</p>`
      : "";

    const idea = quizzes[c.key];
    const extra = state.extras[c.key] || {};
    const explained = Boolean(state.explanations[c.key]) || busy(`${c.key}|explain`);

    // Help that never fades becomes a crutch. From green belt up the question
    // comes first and the lesson waits behind a link.
    const faded = state.fadeSupport && c.status === "learning" && (c.support === "question-first" || c.support === "minimal") && !pinned;
    const lessonOpen = !faded || ui.lesson[c.key];
    const lesson = lessonOpen
      ? `<dl>
          <dt>What it is</dt><dd>${inline(c.what)}</dd>
          <dt>Know this</dt><dd>${inline(c.lens[state.status.depth] || c.lens.Junior)}</dd>
          <dt>How it bites</dt><dd>${inline(c.pitfall)}</dd>
        </dl>`
      : `<p class="faded">You hold a ${esc(c.belt)} belt in this, so the question comes first.
          <button class="link" data-action="showLesson" data-key="${esc(c.key)}">Show the lesson</button></p>`;

    const startExplain = state.explainFirst && !extra.attempt ? "attempt" : "explain";
    const primary = [
      c.hasQuiz && !idea ? `<button class="${faded ? "primary" : ""}" data-action="quiz" data-key="${esc(c.key)}">Check yourself</button>` : "",
      !explained && c.file && !(extra.attempt && !extra.attempt.verdict)
        ? `<button class="${faded ? "" : "primary"}" data-action="${startExplain}" data-key="${esc(c.key)}">Explain in my code</button>`
        : "",
      c.file ? `<button data-action="practice" data-key="${esc(c.key)}" aria-expanded="${Boolean(ui.practice[c.key])}">Practice</button>` : "",
    ].join("");

    // Every other way to practise lives behind that one button.
    const kinds = [
      ["why", "A why question"],
      ["trace", "Trace it by hand"],
      ["contrast", "Spot the difference"],
      ["bug", "Find the bug"],
      ["own", "Quiz me on my code"],
    ]
      .filter(([kind]) => !busy(`${c.key}|${kind === "own" ? "ownQuiz" : kind}`))
      .map(([kind, label]) => `<button class="chip" data-action="practiceKind" data-key="${esc(c.key)}" data-kind="${kind}">${label}</button>`)
      .join("");
    const practice = ui.practice[c.key]
      ? `<div class="practice"><span class="muted">Each one asks your AI for a fresh exercise on these lines.</span><div>${kinds}</div></div>`
      : "";

    const transfer = c.needsTransfer && !quizzes[`${c.key}|transfer`]
      ? `<p class="builds-on">One step from black belt. Black needs this idea recognised somewhere you did not learn it.
          ${busy(`${c.key}|transfer`) ? "" : `<button class="link" data-action="practiceKind" data-key="${esc(c.key)}" data-kind="transfer">Take the transfer question</button>`}</p>`
      : "";

    const claude = state.capture.on.includes("Claude Code");
    const more = [
      !state.explainFirst && c.file && !extra.attempt ? `<button class="link" data-action="attempt" data-key="${esc(c.key)}">Explain it yourself first</button>` : "",
      c.file && claude && !extra.why ? `<button class="link" data-action="why" data-key="${esc(c.key)}">What the assistant said</button>` : "",
      c.origin !== "own" && !(extra.ownCard || {}).saved ? `<button class="link" data-action="writeOwn" data-key="${esc(c.key)}">Write my own question</button>` : "",
      `<button class="link" data-action="speak" data-key="${esc(c.key)}">Read it aloud</button>`,
      `<button class="link" data-action="copy" data-text="${esc(c.askTheAi)}" title="${esc(c.askTheAi)}">Copy a question for your AI</button>`,
      `<button class="link" data-action="link" data-url="${esc(c.docs.url)}">${esc(c.docs.label)}</button>`,
    ]
      .filter(Boolean)
      .join("");
    const moreOpen = Boolean(ui.more[c.key]);
    const asked = ["why", "trace", "transfer", "own"]
      .map((kind) => {
        const q = quizzes[`${c.key}|${kind}`];
        const slot = `${c.key}|${kind === "own" ? "ownQuiz" : kind}`;
        const heading = { why: "Why", trace: "Trace it", transfer: "The same idea, somewhere else", own: "About your code" }[kind];
        return q ? quizBlock(q, "card", `${c.key}|${kind}`, heading) : waiting(slot) + problem(slot);
      })
      .join("");

    return `
      <article class="card">
        ${head}
        ${where}
        ${lesson}
        ${origin}${buildsOn}${transfer}
        ${idea ? quizBlock(idea, "card", c.key) : ""}
        ${attemptBlock(c)}
        ${explanationBlock(c)}
        ${whyBlock(c)}
        ${asked}
        ${contrastBlock(c)}
        ${bugBlock(c)}
        ${ownCardBlock(c)}
        ${primary ? `<div class="actions">${primary}</div>` : ""}
        ${practice}
        <div class="more">
          <button class="link disclose" data-action="more" data-key="${esc(c.key)}" aria-expanded="${moreOpen}">${moreOpen ? "Fewer options" : "More"}</button>
          ${moreOpen ? `<div class="more-list">${more}</div>` : ""}
        </div>
      </article>`;
  }

  /* ---- a whole lesson -------------------------------------------- */

  function fileLink(/** @type {string} */ root, /** @type {string} */ file, /** @type {number | null} */ line) {
    if (!file) return "";
    return `<button class="link file" data-action="openAt" data-root="${esc(root)}" data-file="${esc(file)}" data-line="${line || ""}">${esc(file)}${line ? `:${line}` : ""}</button>`;
  }

  function walkBlock(/** @type {any} */ lesson) {
    const slot = `${lesson.id}|walk`;
    const walk = (state.lessonExtras[lesson.id] || {}).walk;
    if (!walk) return waiting(slot) + problem(slot);
    const at = Math.max(0, Math.min(walk.steps.length - 1, walkAt[lesson.id] || 0));
    const step = walk.steps[at];
    return `<div class="block walk">
      <h4>Step ${at + 1} of ${walk.steps.length}: ${esc(step.title)}</h4>
      ${prose(step.text)}
      <p>${fileLink(lesson.root, step.file, step.line)}</p>
      <div class="actions">
        <button data-action="walkTo" data-lesson="${esc(lesson.id)}" data-index="${at - 1}"${at === 0 ? " disabled" : ""}>Back</button>
        <button class="primary" data-action="walkTo" data-lesson="${esc(lesson.id)}" data-index="${at + 1}"${at === walk.steps.length - 1 ? " disabled" : ""}>Next</button>
        <span class="by">Walkthrough by ${esc(walk.by)}</span>
      </div>
    </div>`;
  }

  function risksBlock(/** @type {any} */ lesson) {
    const slot = `${lesson.id}|risks`;
    const risks = (state.lessonExtras[lesson.id] || {}).risks;
    if (!risks) return waiting(slot) + problem(slot);
    if (!risks.items.length) {
      return `<div class="block"><h4>Risks</h4><p>${esc(risks.by)} found nothing risky in the lines of this change. That is a reading of these lines only, not a security review.</p></div>`;
    }
    const items = risks.items
      .map(
        (/** @type {any} */ r) => `<li>
          <strong>${esc(r.title)}</strong>
          <p>${inline(r.why)}</p>
          ${r.fix ? `<p><span class="muted">Fix:</span> ${inline(r.fix)}</p>` : ""}
          <p>${fileLink(lesson.root, r.file, r.line)}</p>
        </li>`,
      )
      .join("");
    return `<div class="block risks"><h4>${plural(risks.items.length, "risk")} in this change</h4><ul>${items}</ul><p class="by">Found by ${esc(risks.by)}. Check each one against the code before acting on it.</p></div>`;
  }

  function turnBlock(/** @type {any} */ lesson) {
    const slot = `${lesson.id}|turn`;
    const turn = (state.lessonExtras[lesson.id] || {}).turn;
    if (!turn) return waiting(slot) + problem(slot);
    const verdict = {
      done: `<div class="result ok"><strong>Counted</strong> <span class="muted">+40 XP</span><p>You added ${plural(turn.lines || 0, "line")} to ${esc(turn.file)} without your assistant. Miyagi checked who wrote it, not whether it is right: run it and see.</p></div>`,
      nothing: `<div class="result miss"><strong>Nothing new yet</strong><p>${esc(turn.file)} has no new lines since this was set. Save the file and try again.</p></div>`,
      assisted: `<div class="result miss"><strong>Not counted</strong><p>Your assistant edited ${esc(turn.file)} after this was set, so it cannot count as written by you. That is fine; it just is not this exercise.</p></div>`,
    }[turn.verdict] || "";
    return `<div class="block turn">
      <h4>Your turn: write this one yourself</h4>
      <p>${inline(turn.task)}</p>
      <p>${fileLink(lesson.root, turn.file, null)}</p>
      ${turn.done ? `<p class="muted">You are done when: ${inline(turn.done)}</p>` : ""}
      ${turn.hintShown && turn.hint ? `<div class="hint"><span class="muted">Hint</span><p>${inline(turn.hint)}</p></div>` : ""}
      ${verdict}
      ${
        turn.verdict === "done"
          ? ""
          : `<div class="actions">
               <button class="primary" data-action="turnDone" data-lesson="${esc(lesson.id)}">I have written it</button>
               ${turn.hint && !turn.hintShown ? `<button class="link" data-action="turnHint" data-lesson="${esc(lesson.id)}">A hint</button>` : ""}
             </div>`
      }
      <p class="by">Suggested by ${esc(turn.by)}. Close your assistant for this one; Miyagi checks the diff, and never writes the code.</p>
    </div>`;
  }

  function chips(/** @type {string} */ label, /** @type {any[]} */ items) {
    if (!items.length) return "";
    return `<p class="chips"><span class="muted">${label}</span> ${items
      .map((c) => `<button class="chip" data-action="idea" data-id="${esc(c.id)}">${esc(c.emoji)} ${esc(c.title)}</button>`)
      .join("")}</p>`;
  }

  function lessonSection(/** @type {any} */ lesson, /** @type {boolean} */ newest) {
    const extra = state.lessonExtras[lesson.id] || {};
    const found = lesson.discovered && !state.topic ? `<span class="found">${plural(lesson.discovered, "new idea")}${lesson.xpAwarded ? ` · +${lesson.xpAwarded} XP` : ""}</span>` : "";
    const tools = [
      !extra.walk && !busy(`${lesson.id}|walk`) ? `<button class="link" data-action="walk" data-lesson="${esc(lesson.id)}">Walk me through this change</button>` : "",
      !extra.risks && !busy(`${lesson.id}|risks`) ? `<button class="link" data-action="risks" data-lesson="${esc(lesson.id)}">Check it for risks</button>` : "",
      !extra.turn && state.turnsLeft && !busy(`${lesson.id}|turn`) ? `<button class="link" data-action="turn" data-lesson="${esc(lesson.id)}">Your turn</button>` : "",
    ]
      .filter(Boolean)
      .join("");
    return `
      <section class="lesson">
        <h3><span>From <strong>${esc(lesson.source)}</strong>${lesson.by ? `<span class="muted">, written by ${esc(lesson.by)}</span>` : ""}</span><span class="muted">${esc(clock(lesson.at))}</span></h3>
        ${found}
        ${lesson.cards.map((/** @type {any} */ c) => card(c, newest)).join("")}
        ${walkBlock(lesson)}
        ${risksBlock(lesson)}
        ${turnBlock(lesson)}
        ${tools ? `<div class="lesson-tools">${tools}</div>` : ""}
        ${chips("Also in there, for next time:", lesson.later)}
        ${chips("Already yours:", lesson.solid)}
      </section>`;
  }

  /* ---- the Now tab ----------------------------------------------- */

  function pulse() {
    if (!state.watching) return `<p class="pulse">Watching is turned off in settings.</p>`;
    const h = state.heartbeat;
    if (!h) {
      return state.repos.length + state.folders.length
        ? `<p class="pulse"><span class="dot" aria-hidden="true"></span>Watching. No change seen since this window opened.</p>`
        : "";
    }
    const outcome = h.taught
      ? plural(h.taught, "idea") + " carded"
      : h.held && state.holding
      ? "waiting for a commit or a pause before teaching"
      : state.quiet
      ? "not shown while quiet"
      : busy(`${h.root}|findIdeas`)
      ? "nothing in the built-in list; asking your AI"
      : "nothing new to teach";
    return `<p class="pulse"><span class="dot" aria-hidden="true"></span>Last change seen ${esc(clock(h.at))} in ${esc(h.root)}: ${plural(h.files, "file")}, ${outcome}.</p>`;
  }

  function commands() {
    if (!state.commands.length) return "";
    const rows = state.commands
      .map(
        (/** @type {any} */ row) => `
        <li>
          <code>${esc(row.command)}</code>${row.count > 1 ? `<span class="muted"> ×${row.count}</span>` : ""}
          ${row.info ? `<p><strong>${esc(row.info.bin)}</strong> ${esc(row.info.summary)}. ${inline(row.info.what)}</p>` : ""}
        </li>`,
      )
      .join("");
    return `
      <details class="commands">
        <summary>Your assistant ran ${plural(state.commandTotal, "command")}</summary>
        <ul>${rows}</ul>
      </details>`;
  }

  function footer() {
    const ai = state.ai.label
      ? `Explanations are written by <strong>${esc(state.ai.label)}</strong>, on your account.`
      : esc(state.ai.reason || "No AI is set up for explanations.");
    const capture = state.capture.on.length
      ? `<p>Capturing commands from ${esc(list(state.capture.on))}.</p>`
      : state.capture.available.length
      ? `<p>Commands run by ${esc(list(state.capture.available))} are not captured yet. <button class="link" data-action="command" data-id="miyagi.setup">Set up for me</button></p>`
      : "";
    const places = state.repos.concat(state.folders);
    const watching = !places.length
      ? "Nothing is open to watch. Open a folder with code in it."
      : places.length === 1
      ? `Watching ${esc(places[0])}.`
      : `<span title="${esc(places.join(", "))}">Watching ${places.length} projects.</span>`;
    return `
      <footer>
        <p>${ai} <button class="link" data-action="command" data-id="miyagi.chooseAi">Change</button></p>
        <p>${esc(state.meter)}</p>
        ${state.mirror ? `<p>${esc(state.mirror)}</p>` : ""}
        ${capture}
        <p>${state.watching ? watching : "Watching is turned off."} <button class="link" data-action="command" data-id="miyagi.settings">Settings</button></p>
      </footer>`;
  }

  function emptyNow() {
    const due = dueCount();
    const s = state.status;
    if (due) {
      return `
        <div class="empty">
          <h2>${plural(due, "question")} due</h2>
          <p>Nothing new from your assistant right now, so this is the best use of two minutes: answer them from memory.</p>
          <button class="primary" data-action="startReview">Start review</button>
        </div>`;
    }
    const skipped = state.skipped
      ? `<p>${plural(state.skipped, "file")} already had uncommitted changes when this window opened. Miyagi treats those as old and has not taught them.</p>
         <button class="primary" data-action="command" data-id="miyagi.explainChanges">Teach me those</button>`
      : `<button data-action="command" data-id="miyagi.explainChanges">Teach me my uncommitted changes</button>`;
    return `
      <div class="empty">
        <h2>${s.discovered ? "Nothing new right now" : "Nothing to teach yet"}</h2>
        <p>When your assistant writes code that relies on an idea worth understanding, a card appears here. Your assistant is not told and is not slowed down.</p>
        ${skipped}
        ${s.discovered ? `<p><button class="link" data-action="tab" data-tab="dojo">Browse the ${plural(s.discovered, "idea")} you have found</button></p>` : ""}
      </div>`;
  }

  function nowTab() {
    const shown = state.lessons
      .map((/** @type {any} */ l) => Object.assign({}, l, { cards: l.cards.filter(inTopic) }))
      .filter((/** @type {any} */ l) => l.cards.length || (!state.topic && l.solid.length));
    const total = state.lessons.reduce((/** @type {number} */ n, /** @type {any} */ l) => n + l.cards.length, 0);
    const visible = shown.reduce((/** @type {number} */ n, /** @type {any} */ l) => n + l.cards.length, 0);
    let body = pulse();
    if (!shown.length) {
      body += emptyNow();
    } else {
      const due = dueCount();
      if (due) {
        body += `<p class="nudge">${plural(due, "question")} due. <button class="link" data-action="startReview">Review now</button></p>`;
      }
      body += shown.map((/** @type {any} */ l, /** @type {number} */ i) => lessonSection(l, i === 0)).join("");
    }
    if (total > visible) {
      const hidden = total - visible;
      body += `<p class="muted">${plural(hidden, "card")} in other topics ${hidden === 1 ? "is" : "are"} hidden. <button class="link" data-action="allTopics">Show all topics</button></p>`;
    }
    if (state.lessons.length) {
      body += `<p class="tail"><button class="link" data-action="command" data-id="miyagi.clearFeed">Clear the feed</button></p>`;
    }
    return `${body}${commands()}${footer()}`;
  }

  /* ---- Review and Dojo ------------------------------------------- */

  function reviewTab() {
    const s = state.status;
    const due = dueCount();
    const scope = state.topic ? ` in ${esc(state.topic)}` : "";
    if (review.quiz) {
      const inCheck = state.check;
      const next = review.answer
        ? `<div class="actions"><button class="primary" data-action="nextReview">${inCheck ? (inCheck.asked < inCheck.of ? "Next question" : "See the result") : due ? "Next question" : "Finish"}</button></div>`
        : "";
      const right = inCheck ? `Unaided check: ${inCheck.asked} of ${inCheck.of}` : `${plural(due, "question")} due${scope}`;
      return `
        <section class="review">
          ${inCheck ? `<p class="muted">No hints, no explanations, no AI. Just what you can recall.</p>` : ""}
          <h3><span>${inline(review.quiz.about)}</span><span class="muted">${right}</span></h3>
          ${quizBlock(review, "review", "")}
          ${next}
        </section>`;
    }
    if (checked) {
      const pct = Math.round((checked.correct / checked.asked) * 100);
      return `
        <div class="empty">
          <h2>${checked.correct} of ${checked.asked} without help</h2>
          <p>${pct >= 80 ? "What you hold belts for, you can produce on your own." : pct >= 50 ? "Some of what the belts say you know needs help to come out. The misses are back in your review queue." : "Most of this needed help to come out. That is what the check is for: the misses are back in your review queue."}</p>
          <p class="muted">This is shown next to your belts in the Dojo. Another check is worth taking in about a month.</p>
          <button data-action="tab" data-tab="dojo">Go to the Dojo</button>
        </div>`;
    }
    const drills = s.dueCommands
      ? `<p class="muted">${plural(s.dueCommands, "terminal drill")} also due. Those run in the Miyagi MCP tutor (<code>review_due_items</code>).</p>`
      : "";
    if (review.asked && !due) {
      return `
        <div class="empty">
          <h2>${review.cleared ? `${plural(review.cleared, "question")} cleared` : `Nothing is due${scope}`}</h2>
          <p>Questions come back after 10 minutes, then 1, 3, 7, 16 and 35 days. Answering one after a longer gap is what moves its belt up.</p>
          ${drills}
        </div>`;
    }
    return `
      <div class="empty">
        <h2>${due ? `${plural(due, "question")} due${scope}` : `Nothing is due${scope}`}</h2>
        <p>Each idea you were shown left one question behind. Answering it from memory, later, is the part that makes it stick.</p>
        ${due ? `<button class="primary" data-action="nextReview">Start review</button>` : ""}
        ${drills}
        <p><button class="link" data-action="command" data-id="miyagi.weeklyReport">See how your week went</button></p>
      </div>`;
  }

  function dojoTab() {
    if (ui.idea) {
      const back = `<p><button class="link" data-action="closeIdea">← All ideas</button></p>`;
      if (!ideaCard || ideaCard.conceptId !== ui.idea) return `${back}<div class="empty"><p class="muted">Loading…</p></div>`;
      return `${back}<section class="lesson">${card(ideaCard, true, true)}</section>`;
    }
    if (!dojo) return `<div class="empty"><p class="muted">Loading…</p></div>`;
    const all = dojo.rows.filter(inTopic);
    const seen = all.filter((r) => r.seen);
    const locked = all.filter((r) => !r.seen);
    const row = (/** @type {any} */ r) => {
      const dots = dojo.belts.map((_, i) => (r.seen && i <= r.box ? "●" : "○")).join("");
      const tag = r.seen ? `<span class="tag belt belt-${esc(r.belt)}">${esc(r.belt)}</span>` : `<span class="tag">Locked</span>`;
      return `<li>
        <button class="idea${r.seen ? "" : " locked"}" data-action="idea" data-id="${esc(r.id)}" title="Open this lesson">
          <span class="idea-name"><span aria-hidden="true">${esc(r.emoji)}</span> ${esc(r.title)}</span>
          ${tag}
          <span class="dots" aria-hidden="true">${dots}</span>
        </button>
      </li>`;
    };
    const scope = state.topic ? ` in ${esc(state.topic)}` : "";
    return `
      <section class="dojo">
        <h3><span>${seen.length} of ${all.length} ideas found${scope}</span></h3>
        <ul class="ideas">${seen.map(row).join("")}</ul>
        ${independence()}
        ${calibrationBlock()}
        ${mistakesBlock()}
        ${
          locked.length
            ? `<h3><span class="muted">${locked.length} still locked</span></h3>
               <ul class="ideas">${locked.map(row).join("")}</ul>
               <p class="muted">You can read a locked idea now. Its question unlocks when your assistant writes code that uses it.</p>`
            : ""
        }
        <p class="muted">A belt moves up one colour each time you answer its question after a longer gap, and drops when you miss. It measures what you can recall, not how long the panel was open.</p>
        ${recapBlock()}
        <p class="lesson-tools">
          <button class="link" data-action="command" data-id="miyagi.weeklyReport">Your week</button>
          <button class="link" data-action="command" data-id="miyagi.projectMap">How this project works</button>
        </p>
      </section>`;
  }

  function independence() {
    const s = state.status;
    const last = s.independence;
    const line = last
      ? `<p><strong>Without help: ${last.correct} of ${last.asked}</strong> <span class="muted">on ${esc(new Date(last.at).toLocaleDateString([], { month: "short", day: "numeric" }))}</span></p>`
      : "";
    const offer = s.checkDue
      ? `<p>${last ? "It has been a month." : "You hold enough belts for an unaided check:"} about ten questions with every kind of help switched off, to see what you can do alone.
          <button class="link" data-action="startCheck">Take the check</button></p>`
      : last
      ? `<p><button class="link" data-action="startCheck">Take the check again</button></p>`
      : "";
    return line || offer ? `<div class="block"><h4>On your own</h4>${line}${offer}</div>` : "";
  }

  function calibrationBlock() {
    const insight = dojo && dojo.insight;
    if (!insight || !insight.calibration.some((/** @type {any} */ r) => r.answers)) return "";
    const names = { sure: "Sure", think: "Think so", guess: "Guessing" };
    const rows = insight.calibration
      .map((/** @type {any} */ r) => {
        const pct = r.accuracy === null ? null : Math.round(r.accuracy * 100);
        return `<div class="cal-row">
          <span class="cal-name">${names[r.confidence]}</span>
          ${pct === null ? `<span class="muted cal-wait">${r.answers ? `${plural(r.answers, "answer")} so far` : "none yet"}</span>` : `<progress max="100" value="${pct}" aria-label="${names[r.confidence]}: ${pct}% correct"></progress><span class="cal-pct">${pct}%</span>`}
        </div>`;
      })
      .join("");
    return `<div class="block"><h4>When you say you are sure</h4>
      <p class="muted">How often each answer turned out right, by how sure you said you were.</p>
      ${rows}
      ${insight.verdict ? `<p>${esc(insight.verdict)}</p>` : `<p class="muted">A verdict needs at least five answers marked "Sure".</p>`}
    </div>`;
  }

  function mistakesBlock() {
    const insight = dojo && dojo.insight;
    if (!insight || !insight.mistakes.length) return "";
    const items = insight.mistakes
      .slice(0, 12)
      .map(
        (/** @type {any} */ m) => `<li>
          <p class="muted">${esc(m.about)}${m.confident ? ` <span class="tag risk">You were sure</span>` : ""}</p>
          <p>${inline(m.question)}</p>
          <p><span class="muted">You thought:</span> ${inline(m.believed)}</p>
          <p><span class="muted">It is:</span> ${inline(m.truth)}</p>
        </li>`,
      )
      .join("");
    return `<details class="block mistakes"><summary>What you got wrong, and what is true (${insight.mistakes.length})</summary><ul>${items}</ul>
      <p class="muted">Each of these is already back in your review queue. The ones you were sure about come first, because those return most often.</p></details>`;
  }

  function recapBlock() {
    if (!recap) return `<p><button class="link" data-action="startRecap">Wrap up this session</button></p>`;
    if (recap === "writing") {
      return `<div class="block">
        <h4>Before you look: what changed today, and why?</h4>
        <p class="muted">One minute, from memory. Then Miyagi shows what it saw, to compare.</p>
        <form data-submit="recap" data-key="session">
          <textarea data-draft="session|recap" rows="4" placeholder="Today we…" aria-label="Your recap" maxlength="2000">${esc(drafts["session|recap"] || "")}</textarea>
          <div class="actions"><button type="submit" class="primary">Compare</button>
          <button type="button" class="link" data-action="skipRecap">Skip, just show me</button></div>
        </form>
      </div>`;
    }
    const seen = [
      recap.ideas.length ? `<p><span class="muted">Ideas met:</span> ${recap.ideas.map(esc).join(", ")}</p>` : "",
      recap.files.length ? `<p><span class="muted">Files changed:</span> ${recap.files.map(esc).join(", ")}</p>` : "",
      recap.commands ? `<p><span class="muted">Commands your assistant ran:</span> ${recap.commands}</p>` : "",
    ].join("");
    return `<div class="block">
      <h4>Today</h4>
      ${recap.wrote ? `<p class="muted">You wrote</p><p class="asked">${esc(recap.wrote)}</p>` : ""}
      <p class="muted">Miyagi saw</p>
      ${seen || `<p>Nothing was carded today.</p>`}
      <p class="muted">Anything in the second list that is not in the first is worth opening.</p>
    </div>`;
  }

  /* ---- drawing --------------------------------------------------- */

  function render() {
    if (!state) {
      app.innerHTML = `<div class="empty"><p class="muted">Loading…</p></div>`;
      return;
    }
    // A redraw replaces every element, including the one being typed in.
    const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
    const focused = active && active.dataset ? active.dataset.draft : undefined;
    const caret = focused && active ? [active.selectionStart, active.selectionEnd] : null;

    const body = ui.tab === "review" ? reviewTab() : ui.tab === "dojo" ? dojoTab() : nowTab();
    app.innerHTML = `${header()}${tabs()}<main role="tabpanel">${body}</main>`;

    if (focused) {
      const again = /** @type {HTMLInputElement | null} */ (
        [...app.querySelectorAll("[data-draft]")].find((el) => /** @type {HTMLElement} */ (el).dataset.draft === focused)
      );
      if (again) {
        again.focus();
        if (caret && caret[0] !== null) again.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  function setTab(/** @type {string} */ tab) {
    ui.tab = tab;
    if (tab === "dojo") {
      // Clicking the tab again returns from a lesson to the list.
      ui.idea = null;
      send({ type: "dojo" });
    }
    remember();
    render();
  }

  function openIdea(/** @type {string} */ id) {
    ui.tab = "dojo";
    ui.idea = id;
    remember();
    send({ type: "idea", id });
    render();
    window.scrollTo(0, 0);
  }

  function startCheck() {
    ui.tab = "review";
    remember();
    checked = null;
    review = { asked: true, quiz: null, answer: null, picked: -1, cleared: 0 };
    send({ type: "check" });
    render();
  }

  function startReview() {
    ui.tab = "review";
    checked = null;
    remember();
    review = { asked: true, quiz: null, answer: null, picked: -1, cleared: review.cleared };
    send({ type: "review" });
    render();
  }

  /* ---- input ----------------------------------------------------- */

  app.addEventListener("click", (event) => {
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest("[data-action]"));
    if (!el) return;
    const d = el.dataset;
    const key = d.key || "";
    switch (d.action) {
      case "tab":
        return setTab(d.tab || "now");
      case "toggle":
        ui.open[key] = el.getAttribute("aria-expanded") !== "true";
        remember();
        return render();
      case "more":
        ui.more[key] = !ui.more[key];
        remember();
        return render();
      case "openFile":
        return send({ type: "openFile", key });
      case "openAt":
        return send({ type: "openAt", root: d.root, file: d.file, line: d.line ? Number(d.line) : null });
      case "explain":
      case "attempt":
      case "why":
      case "speak":
      case "quiz":
        return send({ type: d.action, key });
      case "hint":
        return send({ type: "hint", key, step: d.step });
      case "practice":
        ui.practice[key] = !ui.practice[key];
        remember();
        return render();
      case "practiceKind":
        ui.practice[key] = false;
        remember();
        send({ type: "practice", key, kind: d.kind });
        return render();
      case "showLesson":
        ui.lesson[key] = true;
        remember();
        return render();
      case "writeOwn":
        writing[key] = !writing[key];
        return render();
      case "contrastPick":
        return send({ type: "contrastPick", key, pick: d.pick });
      case "confidence": {
        const entry = d.scope === "review" ? review : quizzes[d.slot || ""];
        if (entry) entry.confidence = d.level;
        return render();
      }
      case "turn":
      case "turnDone":
      case "turnHint":
        return send({ type: d.action, lesson: d.lesson });
      case "startCheck":
        return startCheck();
      case "startRecap":
        recap = "writing";
        return render();
      case "skipRecap":
        return send({ type: "recap", text: "" });
      case "risks":
      case "walk":
        return send({ type: d.action, lesson: d.lesson });
      case "walkTo": {
        const index = Number(d.index);
        walkAt[d.lesson || ""] = index;
        send({ type: "walkStep", lesson: d.lesson, index });
        return render();
      }
      case "bugGuess":
        return send({ type: "bugGuess", key, line: Number(d.line) });
      case "bugReveal":
        return send({ type: "bugReveal", key });
      case "answer": {
        const index = Number(d.index);
        const entry = d.scope === "review" ? review : quizzes[d.slot || ""];
        if (!entry || !entry.quiz || entry.answer) return;
        entry.picked = index;
        send({ type: "answer", token: entry.quiz.token, index, confidence: entry.confidence || null });
        return render();
      }
      case "startReview":
      case "nextReview":
        return startReview();
      case "idea":
        return openIdea(d.id || "");
      case "closeIdea":
        ui.idea = null;
        remember();
        send({ type: "dojo" });
        return render();
      case "allTopics":
        return send({ type: "setTopic", topic: "" });
      case "depthNoted":
        ui.depthNote = "done";
        remember();
        return render();
      case "acceptDepth":
        return send({ type: "setDepth", depth: d.depth });
      case "dismissDepth":
        return send({ type: "dismissDepth", depth: d.depth });
      case "command":
        return send({ type: "command", id: d.id });
      case "link":
        return send({ type: "openLink", url: d.url });
      case "copy":
        return send({ type: "copy", text: d.text });
    }
  });

  app.addEventListener("input", (event) => {
    const el = /** @type {HTMLInputElement} */ (event.target);
    if (el.dataset && el.dataset.draft) drafts[el.dataset.draft] = el.value;
  });

  app.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = /** @type {HTMLElement} */ (event.target);
    const key = form.dataset.key || "";
    const kind = form.dataset.submit;
    if (kind === "ownCard") {
      const take = (/** @type {string} */ f) => (drafts[`${key}|own.${f}`] || "").trim();
      return send({
        type: "ownCard",
        key,
        question: take("question"),
        answer: take("answer"),
        wrong: [take("wrong1"), take("wrong2"), take("wrong3")].filter(Boolean),
        why: take("why"),
      });
    }
    const draft = `${key}|${kind}`;
    const text = (drafts[draft] || "").trim();
    if (!text) return;
    delete drafts[draft];
    if (kind === "recap") return send({ type: "recap", text });
    send({ type: kind === "attempt" ? "attemptSubmit" : "followUp", key, text });
  });

  app.addEventListener("change", (event) => {
    const el = /** @type {HTMLSelectElement} */ (event.target);
    if (el.dataset.change === "depth") {
      // Explained once, the first time it is used, then never again.
      if (ui.depthNote === "unseen") {
        ui.depthNote = "showing";
        remember();
      }
      send({ type: "setDepth", depth: el.value });
    }
    if (el.dataset.change === "topic") {
      // A review in progress belongs to the old topic.
      review = { asked: false, quiz: null, answer: null, picked: -1, cleared: 0 };
      send({ type: "setTopic", topic: el.value });
    }
  });

  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "state":
        state = m;
        break;
      case "tab":
        if (m.tab === "review") return startReview();
        return setTab(m.tab);
      case "quiz":
        if (m.quiz) quizzes[m.key] = { quiz: m.quiz, answer: null, picked: -1 };
        break;
      case "answered": {
        const entries = [review, ...Object.values(quizzes)];
        const entry = entries.find((e) => e.quiz && e.quiz.token === m.token);
        if (entry && m.answer) {
          entry.answer = m.answer;
          if (entry === review) review.cleared += 1;
          // The belt on an open dojo lesson just changed.
          if (ui.idea) send({ type: "idea", id: ui.idea });
        }
        break;
      }
      case "review":
        review = { asked: true, quiz: m.quiz, answer: null, picked: -1, cleared: review.cleared };
        if (m.checked) checked = m.checked;
        break;
      case "dojo":
        dojo = { rows: m.rows, belts: m.belts, insight: m.insight };
        break;
      case "startCheck":
        return startCheck();
      case "startRecap":
        ui.tab = "dojo";
        ui.idea = null;
        recap = "writing";
        send({ type: "dojo" });
        break;
      case "recap":
        recap = m;
        break;
      case "idea":
        ideaCard = m.card;
        break;
    }
    render();
  });

  render();
  send({ type: "ready" });
  if (ui.tab === "dojo") send({ type: "dojo" });
  if (ui.tab === "dojo" && ui.idea) send({ type: "idea", id: ui.idea });
})();
