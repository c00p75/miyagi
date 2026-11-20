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
    {
      tab: "now",
      open: {},
      more: {},
      practice: {},
      lesson: {},
      idea: null,
      depthNote: "unseen",
      // The list row whose preview is showing. One at a time.
      expanded: null,
      // The card page being shown on the Now tab, like items/[id] in a web app.
      cardKey: null,
      // Where an idea page was opened from, so Back returns there.
      ideaFrom: "dojo",
      // Which lesson sections are open on a card page, by `<key>|<section>`.
      sections: {},
      scroll: {},
      // "Why not another way?" opened on a card, by key.
      altOpen: {},
      // The glossary word whose page is showing, and words revealed without a guess.
      term: null,
      termRevealed: {},
      // Grow tab: which skill row is open, and whether the decision form is.
      skill: null,
      decisionForm: false,
    },
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
  /** Review runs in short sets so a long queue never feels like a wall. */
  const SET_SIZE = 5;
  const SECONDS_PER_QUESTION = 25;
  let review = { asked: false, quiz: null, answer: null, picked: -1, cleared: 0, setSize: 0, setAnswered: 0, setDone: false };
  /** @type {{rows: any[], belts: string[]} | null} */
  let dojo = null;
  /** The Grow tab's data, fetched when the tab opens. */
  /** @type {any} */
  let grow = null;
  /** A message to show once in the Grow tab (incident saved, decision problem). */
  let growNote = "";
  let growAsked = 0;
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
        <div class="who" title="${esc(s.rank)}">
          <span class="level">Level ${s.level}</span>
          <span class="xp">· ${s.xp} XP</span>
        </div>
        <progress max="100" value="${s.intoLevel}" aria-label="${s.intoLevel} of 100 XP to level ${s.level + 1}"></progress>
        ${banner}
      </header>`;
  }

  /** Topic and depth. They shape the lists, so they sit above them, not on every page. */
  function filters() {
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
    return `
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
      }`;
  }

  function tabs() {
    const tab = (/** @type {string} */ id, /** @type {string} */ label, count = 0) => `
      <button role="tab" class="tab${ui.tab === id ? " on" : ""}" aria-selected="${ui.tab === id}" data-action="tab" data-tab="${id}">
        ${label}${count ? `<span class="count">${count}</span>` : ""}
      </button>`;
    return `<nav class="tabs" role="tablist">${tab("now", "Now")}${tab("review", "Review", dueCount())}${tab("dojo", "Dojo")}${tab("grow", "Grow")}</nav>`;
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

    // From green belt up, some review questions are answered in the learner's
    // own words and judged by their AI: producing an answer, not recognising it.
    if (scope === "review" && quiz.explainBack && state.explainBack && !answer && !entry.choicesInstead) {
      const slotOwn = "review|own";
      return `<div class="quiz own-words">${top}
        <p class="muted">You hold this at green belt or above, so answer in your own words. Producing it from memory is stronger evidence than picking it out.</p>
        ${
          busy(slotOwn)
            ? `<p class="asked">${esc(drafts[slotOwn + ".sent"] || "")}</p>${waiting(slotOwn)}`
            : `<form data-submit="answerOwn" data-key="review">
                 <textarea data-draft="${slotOwn}" rows="3" placeholder="In a sentence or two…" aria-label="Your answer" maxlength="800">${esc(drafts[slotOwn] || "")}</textarea>
                 <div class="actions">
                   <button type="submit" class="primary">Check my answer</button>
                   <button type="button" class="link" data-action="showChoices">Show the choices instead</button>
                 </div>
               </form>`
        }
        ${problem(slotOwn)}
      </div>`;
    }

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
    if (answer && answer.ownWords) {
      const label = { right: "You had it", partly: "Partly", wrong: "Not yet" }[answer.ownWords.verdict];
      const again = answer.nextDueAt ? ` · back in ${until(answer.nextDueAt)}` : "";
      return `<div class="quiz own-words">${top}
        <p class="asked">${esc(drafts["review|own.sent"] || "")}</p>
        <div class="result ${answer.correct ? "ok" : "miss"}">
          <p><span class="tag verdict-${esc(answer.ownWords.verdict)}">${label}</span> <span class="muted">+${answer.xpAwarded} XP${again}</span></p>
          ${prose(answer.ownWords.feedback)}
          <p><span class="muted">Expected:</span> ${inline(quiz.choices[answer.answerIndex] || "")}</p>
          <p class="extra">${inline(answer.explanation)}</p>
          ${answer.ownWords.verdict === "partly" ? `<p class="extra">Partly right counts, but the belt holds until it comes out whole.</p>` : ""}
          <p class="by">Judged by ${esc(answer.ownWords.by)}</p>
        </div></div>`;
    }
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

  /**
   * Why not another way? The learner names one first (or skips), then sees
   * two real alternatives with what each would win and cost here.
   */
  function alternativesBlock(/** @type {any} */ c) {
    const slot = `${c.key}|alternatives`;
    const alt = (state.extras[c.key] || {}).alternatives;
    if (alt) {
      const options = alt.alternatives
        .map(
          (/** @type {any} */ a) => `<li class="alt">
            <strong>${esc(a.name)}</strong>
            ${a.sketch ? `<pre><code>${esc(a.sketch)}</code></pre>` : ""}
            <dl class="alt-facts">
              ${a.wins ? `<dt>Better at</dt><dd>${inline(a.wins)}</dd>` : ""}
              <dt>Costs here</dt><dd>${inline(a.costs)}</dd>
              ${a.when ? `<dt>Pick it when</dt><dd>${inline(a.when)}</dd>` : ""}
            </dl>
          </li>`,
        )
        .join("");
      const mine = alt.guess
        ? `<div class="hint"><span class="muted">Your idea</span><p class="asked">${esc(alt.guess)}</p>${alt.onGuess ? `<p>${inline(alt.onGuess)}</p>` : ""}</div>`
        : "";
      return `<div class="block alternatives">
        <h4>Why not another way?</h4>
        ${mine}
        <p><span class="muted">What this code does:</span> <strong>${esc(alt.chosen)}</strong></p>
        <p>${inline(alt.why)}</p>
        <ul class="alts">${options}</ul>
        ${alt.verdict ? `<p class="verdict-line">${inline(alt.verdict)}</p>` : ""}
        ${
          alt.saved
            ? `<p class="muted">Saved to your decision log. It comes back on review, so you can still say why later.</p>`
            : `<div class="actions"><button data-action="saveAlternative" data-key="${esc(c.key)}">Save to my decision log</button></div>`
        }
        ${problem(slot)}
        <p class="by">Options by ${esc(alt.by)}. They are suggestions from your AI: check them against your project.</p>
      </div>`;
    }
    if (busy(slot)) return waiting(slot);
    if (!ui.altOpen[c.key]) return problem(slot);
    const draft = `${c.key}|alternatives`;
    return `<div class="block">
      <h4>Why not another way?</h4>
      <p>Before you look: how else could this have been written? One line is enough.</p>
      <form data-submit="alternatives" data-key="${esc(c.key)}">
        <textarea data-draft="${esc(draft)}" rows="2" placeholder="It could also have…" aria-label="Another way it could have been written" maxlength="600">${esc(drafts[draft] || "")}</textarea>
        <div class="actions">
          <button type="submit" class="primary">Compare with the real options</button>
          <button type="button" class="link" data-action="alternatives" data-key="${esc(c.key)}">Skip, just show me</button>
        </div>
      </form>
      ${problem(slot)}
    </div>`;
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
    // On a card page the lesson folds into three sections, so the first thing
    // on screen is something to do, not something to read.
    const section = (/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ body) =>
      `<details class="section" data-section="${esc(c.key)}|${id}"${ui.sections[`${c.key}|${id}`] ? " open" : ""}>
        <summary>${title}</summary><div>${inline(body)}</div>
      </details>`;
    const lesson = lessonOpen && pinned
      ? `<div class="sections">
          ${section("what", "What it is", c.what)}
          ${section("know", "Know this", c.lens[state.status.depth] || c.lens.Junior)}
          ${section("bites", "How it bites", c.pitfall)}
        </div>`
      : lessonOpen
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
      // Only on an idea's own page, where there is room to compare.
      pinned && c.file && state.ai.label && !(state.extras[c.key] || {}).alternatives && !ui.altOpen[c.key] && !busy(`${c.key}|alternatives`)
        ? `<button data-action="altOpen" data-key="${esc(c.key)}">Why not another way?</button>`
        : "",
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
      <article class="card${pinned ? " page" : ""}">
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
        ${pinned && c.file ? alternativesBlock(c) : ""}
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
          <h2>${setLabel(due)}</h2>
          <p>Nothing new from your assistant right now, so this is a good use of a couple of minutes: answer them from memory.</p>
          <button class="primary" data-action="startReview">Start</button>
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

  /** Every card the Now list shows, newest lesson first, with the lesson it came from. */
  function visibleCards() {
    /** @type {Array<{ c: any, lesson: any }>} */
    const out = [];
    for (const lesson of state.lessons) {
      for (const c of lesson.cards) if (inTopic(c)) out.push({ c, lesson });
    }
    return out;
  }

  function dayLabel(/** @type {string} */ iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Earlier";
    const today = new Date();
    const yesterday = new Date(today.getTime() - 864e5);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  }

  function tagFor(/** @type {any} */ c) {
    const main =
      c.status === "new"
        ? `<span class="tag new">New</span>`
        : c.status === "locked"
        ? `<span class="tag">Locked</span>`
        : `<span class="tag belt belt-${esc(c.belt)}">${esc(c.belt)}</span>`;
    return main + (c.risk ? `<span class="tag risk" title="Misunderstanding this one costs data, money or a breach">Risk</span>` : "");
  }

  /** One line per idea. Tapping it shows a preview; "Open" goes to its page. */
  function row(/** @type {any} */ c, /** @type {any} */ lesson) {
    const open = ui.expanded === c.key;
    // Rows sit under a day heading, so the time alone is enough.
    const at = new Date(lesson.at);
    const time = Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const where = [c.file, time].filter(Boolean).map(esc).join(" · ");
    return `
      <li class="row${open ? " open" : ""}">
        <button class="row-head" data-action="expand" data-key="${esc(c.key)}" aria-expanded="${open}">
          <span class="emoji" aria-hidden="true">${esc(c.emoji)}</span>
          <span class="row-main">
            <span class="row-title">${esc(c.title)}</span>
            <span class="row-sub">${where}</span>
          </span>
          <span class="tags">${tagFor(c)}</span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
        ${
          open
            ? `<div class="preview">
                 <p class="hook">${inline(c.hook)}</p>
                 <p>${inline(c.what)}</p>
                 <div class="actions"><button class="primary" data-action="openCard" data-key="${esc(c.key)}">Open ›</button></div>
               </div>`
            : ""
        }
      </li>`;
  }

  function nowList() {
    const cards = visibleCards();
    const entries = feedEntries();
    const total = state.lessons.reduce((/** @type {number} */ n, /** @type {any} */ l) => n + l.cards.length, 0);
    let body = filters() + offerBanner() + pulse() + teachMeBox();
    if (!entries.length) {
      body += emptyNow();
    } else {
      /** @type {Map<string, string[]>} */
      const days = new Map();
      for (const e of entries) {
        const label = dayLabel(e.at);
        if (!days.has(label)) days.set(label, []);
        /** @type {string[]} */ (days.get(label)).push(e.kind === "card" ? row(e.c, e.lesson) : itemRow(e.item));
      }
      body += [...days.entries()]
        .map(([label, rows]) => `<section class="day"><h3>${esc(label)}</h3><ul class="rows">${rows.join("")}</ul></section>`)
        .join("");
    }
    if (total > cards.length) {
      const hidden = total - cards.length;
      body += `<p class="muted">${plural(hidden, "card")} in other topics ${hidden === 1 ? "is" : "are"} hidden. <button class="link" data-action="allTopics">Show all topics</button></p>`;
    }
    if (state.lessons.length) {
      body += `<p class="tail"><button class="link" data-action="command" data-id="miyagi.clearFeed">Clear the feed</button></p>`;
    }
    return `${body}${commands()}${footer()}`;
  }

  /** The bar at the top of any page: back on the left, position and arrows on the right. */
  function pageBar(/** @type {string} */ back, /** @type {string} */ backLabel, /** @type {string} */ right = "") {
    return `<nav class="pagebar" aria-label="Card navigation">
      <button class="link back" data-action="${back}">‹ ${esc(backLabel)}</button>
      <span class="pager">${right}</span>
    </nav>`;
  }

  /** The things that belong to a whole change, not one idea. */
  function changeSection(/** @type {any} */ lesson) {
    const extra = state.lessonExtras[lesson.id] || {};
    const tools = [
      !extra.walk && !busy(`${lesson.id}|walk`) ? `<button data-action="walk" data-lesson="${esc(lesson.id)}">Walk me through it</button>` : "",
      !extra.risks && !busy(`${lesson.id}|risks`) ? `<button data-action="risks" data-lesson="${esc(lesson.id)}">Check it for risks</button>` : "",
      !extra.turn && state.turnsLeft && !busy(`${lesson.id}|turn`) ? `<button data-action="turn" data-lesson="${esc(lesson.id)}">Your turn</button>` : "",
      !state.lessonDecisions[lesson.id] && !busy(`${lesson.id}|decisions`) && state.ai.label
        ? `<button data-action="lessonDecisions" data-lesson="${esc(lesson.id)}">Decisions in it</button>`
        : "",
      !state.lessonTerms[lesson.id] && !busy(`${lesson.id}|terms`) && state.ai.label
        ? `<button data-action="findTerms" data-lesson="${esc(lesson.id)}">Project words in it</button>`
        : "",
    ]
      .filter(Boolean)
      .join("");
    const packages = (state.coach.packages || {})[lesson.id] || [];
    return `
      <section class="change">
        <h3>This change</h3>
        <p class="muted">From <strong>${esc(lesson.source)}</strong>${lesson.by ? `, written by ${esc(lesson.by)}` : ""} · ${esc(clock(lesson.at))}</p>
        ${tools ? `<div class="actions">${tools}</div>` : ""}
        ${walkBlock(lesson)}
        ${risksBlock(lesson)}
        ${turnBlock(lesson)}
        ${lessonDecisionsBlock(lesson)}
        ${lessonTermsBlock(lesson)}
        ${
          packages.length
            ? `<p class="chips"><span class="muted">New packages:</span> ${packages
                .map((/** @type {string} */ n) => `<button class="chip" data-action="learnName" data-name="${esc(n)}" title="Learn what ${esc(n)} is and how this project uses it">📦 ${esc(n)}</button>`)
                .join("")}</p>`
            : ""
        }
        ${chips("Also in there:", lesson.later)}
        ${chips("Already yours:", lesson.solid)}
      </section>`;
  }

  /** The project words found in one change, each a link to its glossary page. */
  function lessonTermsBlock(/** @type {any} */ lesson) {
    const slot = `${lesson.id}|terms`;
    const found = state.lessonTerms[lesson.id];
    if (!found) return waiting(slot) + problem(slot);
    const terms = found.ids.map((/** @type {string} */ id) => termById(id)).filter(Boolean);
    if (!terms.length) return problem(slot);
    return `<div class="block"><h4>Project words in this change</h4>
      <p class="chips">${terms
        .map((/** @type {any} */ t) => `<button class="chip" data-action="term" data-id="${esc(t.id)}">📖 ${esc(t.term)}</button>`)
        .join("")}</p>
      <p class="by">Added to your glossary by ${esc(found.by)}. Find them all in the Dojo.</p></div>`;
  }

  function cardPage(/** @type {string} */ key) {
    const entries = feedEntries();
    const at = entries.findIndex((x) => x.key === key);
    // A tool opened from the Grow tab need not be in the feed.
    if (at === -1) {
      const tool = coachItem(key);
      return tool ? `${pageBar("closeCard", "Back")}${itemPage(tool)}` : null;
    }
    const entry = entries[at];
    const prev = at > 0 ? entries[at - 1].key : "";
    const next = at < entries.length - 1 ? entries[at + 1].key : "";
    const arrows = entries.length > 1
      ? `${at + 1} of ${entries.length}
         <button class="icon" data-action="openCard" data-key="${esc(prev)}" aria-label="Previous"${prev ? "" : " disabled"}>‹</button>
         <button class="icon" data-action="openCard" data-key="${esc(next)}" aria-label="Next"${next ? "" : " disabled"}>›</button>`
      : "";
    if (entry.kind === "item") return `${pageBar("closeCard", "Back", arrows)}${itemPage(entry.item)}`;
    return `${pageBar("closeCard", "Back", arrows)}${card(entry.c, true, true)}${changeSection(entry.lesson)}`;
  }

  function nowTab() {
    if (ui.cardKey) {
      const page = cardPage(ui.cardKey);
      if (page) return page;
      // The card is gone (feed cleared, or filtered out): fall back to the list.
      ui.cardKey = null;
      remember();
    }
    return nowList();
  }

  /* ---- the coach: items in the feed ------------------------------ */

  /** Cards and coach items together, newest first, as one list for the feed and its arrows. */
  function feedEntries() {
    /** @type {Array<any>} */
    const out = visibleCards().map(({ c, lesson }) => ({ kind: "card", key: c.key, at: lesson.at, c, lesson }));
    for (const item of (state.coach && state.coach.items) || []) out.push({ kind: "item", key: item.key, at: item.at, item });
    // Stable within a lesson: cards of one lesson share a time and keep their order.
    return out.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1));
  }

  function coachItem(/** @type {string} */ key) {
    const c = state.coach || {};
    return (c.items || []).find((/** @type {any} */ i) => i.key === key) || (c.tools || []).find((/** @type {any} */ t) => t.key === key) || null;
  }

  const VERDICT = { right: "You had it", partly: "Partly", wrong: "Not yet" };

  function itemSummary(/** @type {any} */ i) {
    const time = (() => {
      const d = new Date(i.at);
      return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    })();
    if (i.kind === "tool") {
      const tag = i.adopted
        ? `<span class="tag belt">${i.held} of ${i.terms.length} terms</span>`
        : `<span class="tag new">New tool</span>`;
      return { emoji: i.emoji, title: i.name, sub: [i.job, time].filter(Boolean).join(" · "), tag, hook: (i.spec && i.spec.oneLiner) || i.job, open: "Get to know it ›" };
    }
    if (i.kind === "debug") {
      const v = i.result && i.result.verdict;
      const tag = v
        ? `<span class="tag verdict-${esc(v)}">${VERDICT[v]}</span>`
        : i.result || i.revealed
        ? `<span class="tag">Read</span>`
        : `<span class="tag risk">Read it</span>`;
      const who = i.by === "you" ? "your terminal" : i.by;
      return { emoji: "🩺", title: `Something broke: ${i.command}`, sub: [who, i.repeats > 1 ? `${i.repeats} times` : "", time].filter(Boolean).join(" · "), tag, hook: "Read the error before your AI fixes it. One minute, and the next one costs less.", open: "Read it ›" };
    }
    const tag = i.committed && !i.answered ? `<span class="tag">Committed</span>` : i.answered ? `<span class="tag verdict-${i.correct ? "right" : "wrong"}">${i.correct ? "Ready" : "Re-read"}</span>` : `<span class="tag new">1 question</span>`;
    return { emoji: "🚦", title: `Before you commit: ${i.lines} lines`, sub: [`${i.files.length} file${i.files.length === 1 ? "" : "s"} staged`, time].join(" · "), tag, hook: "One question about what you are about to commit. About thirty seconds.", open: "Ask me ›" };
  }

  function itemRow(/** @type {any} */ i) {
    const open = ui.expanded === i.key;
    const m = itemSummary(i);
    return `
      <li class="row coach-row${open ? " open" : ""}">
        <button class="row-head" data-action="expand" data-key="${esc(i.key)}" aria-expanded="${open}">
          <span class="emoji" aria-hidden="true">${esc(m.emoji)}</span>
          <span class="row-main">
            <span class="row-title">${esc(m.title)}</span>
            <span class="row-sub">${esc(m.sub)}</span>
          </span>
          <span class="tags">${m.tag}</span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
        ${
          open
            ? `<div class="preview">
                 <p class="hook">${inline(m.hook)}</p>
                 <div class="actions"><button class="primary" data-action="openCard" data-key="${esc(i.key)}">${esc(m.open)}</button>
                 <button class="link" data-action="dismissItem" data-key="${esc(i.key)}">Remove</button></div>
               </div>`
            : ""
        }
      </li>`;
  }

  function itemPage(/** @type {any} */ i) {
    if (i.kind === "tool") return toolPage(i);
    if (i.kind === "debug") return debugPage(i);
    return gatePage(i);
  }

  function pageHead(/** @type {string} */ emoji, /** @type {string} */ title, /** @type {string} */ tags) {
    return `<div class="card-head static"><span class="emoji" aria-hidden="true">${esc(emoji)}</span><span class="card-title">${esc(title)}</span><span class="tags">${tags}</span></div>`;
  }

  /* ---- a tool ---- */

  function toolPage(/** @type {any} */ t) {
    const spec = t.spec || { oneLiner: "", flow: [], risks: [], verify: "", terms: [], docs: "" };
    const primer = t.primer;
    const tags = t.adopted ? `<span class="tag belt">${t.held} of ${t.terms.length} terms held</span>` : `<span class="tag new">New tool</span>`;
    const seen = t.evidence
      ? `<div class="where">${t.file ? fileLink(t.root, t.file, null) : ""}<code class="evidence">${esc(t.evidence)}</code></div>`
      : "";
    const head = `${pageHead(t.emoji, t.name, tags)}<p class="hook">${esc(t.job)}</p>${seen}`;

    // Step one: guess before reading. Even a wrong guess makes the answer stick.
    if (!t.guessDone) {
      const d = `${t.key}|guess`;
      return `<article class="card page tool">${head}
        <div class="block first">
          <h4>Before you read: what do you think ${esc(t.name)} is for?</h4>
          <p class="muted">A guess in a few words. Being wrong is fine; guessing first is what makes the real answer stick.</p>
          <form data-submit="toolGuess" data-key="${esc(t.key)}">
            <input type="text" data-draft="${esc(d)}" value="${esc(drafts[d] || "")}" placeholder="I think it…" aria-label="Your guess" maxlength="300">
            <div class="actions"><button type="submit" class="primary">Lock in my guess</button>
            <button type="button" class="link" data-action="toolGuessSkip" data-key="${esc(t.key)}">Skip, just show me</button></div>
          </form>
        </div></article>`;
    }

    const primerSlot = `${t.key}|primer`;
    const guess = t.guess
      ? `<div class="block"><p><span class="muted">You guessed:</span> ${esc(t.guess)}</p>${primer && primer.guessFeedback ? prose(primer.guessFeedback) : ""}</div>`
      : "";
    const flow = (primer && primer.flow.length ? primer.flow : spec.flow) || [];
    const risks = primer && primer.risks.length ? primer.risks.map((/** @type {any} */ r) => `<li><strong>${esc(r.title)}</strong> ${inline(r.why)}</li>`) : (spec.risks || []).map((/** @type {string} */ r) => `<li>${inline(r)}</li>`);
    const project = primer
      ? `<div class="block mine"><h4>In your project</h4>${prose(primer.summary)}
          ${primer.wired.length ? `<ul class="wired">${primer.wired.map((/** @type {any} */ w) => `<li>${fileLink(t.root, w.file, w.line)} ${inline(w.what)}</li>`).join("")}</ul>` : ""}
          <p class="by">Written by ${esc(primer.by)} from the files that mention ${esc(t.name)}.</p></div>`
      : busy(primerSlot)
      ? waiting(primerSlot)
      : state.ai.label
      ? `<div class="actions"><button class="primary" data-action="toolPrimer" data-key="${esc(t.key)}">Show me ${esc(t.name)} in my project</button></div>${problem(primerSlot)}`
      : "";

    const terms = t.terms
      .map((/** @type {any} */ x) => {
        const slot = `${t.key}|${x.id}`;
        const q = quizzes[slot];
        const belt = x.seen ? `<span class="tag belt belt-${esc(beltName(x.box))}">${esc(beltName(x.box))}</span>` : "";
        return `<li class="term">
          <div class="term-head"><strong>${esc(x.term)}</strong>${belt}
            ${!q && !busy(slot) ? `<button class="link" data-action="termQuiz" data-slot="${esc(slot)}" data-id="${esc(x.id)}">Check me</button>` : ""}</div>
          ${
            // Once on review, the meaning hides: checking yourself with the answer in view is reading, not recall.
            t.adopted && !q
              ? `<details class="meaning"><summary class="muted">Show what it means</summary><p>${inline(x.meaning)}</p></details>`
              : t.adopted
              ? ""
              : `<p>${inline(x.meaning)}</p>`
          }
          ${q ? quizBlock(q, "card", slot) : ""}
        </li>`;
      })
      .join("");
    const pct = t.terms.length ? Math.round((t.held / t.terms.length) * 100) : 0;
    const vocab = t.terms.length
      ? `<div class="block vocab">
          <h4>The words you need (${t.terms.length})</h4>
          ${
            t.adopted
              ? `<p class="muted">On your review schedule. Say what each one means before you peek. Conversant means every term at green belt: ${t.held} of ${t.terms.length} so far.</p>
                 <progress max="100" value="${pct}" aria-label="${t.held} of ${t.terms.length} terms held"></progress>`
              : `<p class="muted">Read them once, then put them on review. They come back in 10 minutes, then 1, 3, 7 and 16 days, until you can recall each cold.</p>`
          }
          <ul class="terms">${terms}</ul>
          ${t.adopted ? "" : `<div class="actions"><button class="primary" data-action="toolAdopt" data-key="${esc(t.key)}">Add these ${t.terms.length} terms to my reviews</button></div>`}
        </div>`
      : "";

    const dSlot = `${t.key}|decision`;
    const d = t.decision;
    const decision = d
      ? `<div class="block decision"><h4>Why ${esc(t.name)}?</h4>
          <p><strong>${esc(d.chose)}</strong>${d.over.length ? ` <span class="muted">over</span> ${esc(d.over.join(", "))}` : ""}</p>
          <p>${inline(d.because)}</p>
          ${d.tradeoff ? `<p><span class="muted">Given up:</span> ${inline(d.tradeoff)}</p>` : ""}
          ${d.revisit ? `<p><span class="muted">Revisit when:</span> ${inline(d.revisit)}</p>` : ""}
          ${d.saved ? `<p class="muted">Saved to your decision log, with a question that comes back to check you still know why.</p>` : `<div class="actions"><button class="primary" data-action="saveDecision" data-key="${esc(t.key)}">Save to my decision log</button></div>`}
          <p class="by">Suggested by ${esc(d.by)}. Edit it in your head if your reason was different; the reason is what matters.</p></div>`
      : busy(dSlot)
      ? waiting(dSlot)
      : state.ai.label
      ? `<p><button class="link" data-action="toolDecision" data-key="${esc(t.key)}">Why ${esc(t.name)} and not something else? Log the decision</button></p>${problem(dSlot)}`
      : "";

    return `<article class="card page tool">${head}
      ${guess}
      ${project}
      <dl>
        <dt>What it does</dt><dd>${inline(spec.oneLiner || t.job)}${spec.analogy ? `<br><span class="muted">${inline(spec.analogy)}</span>` : ""}</dd>
        ${flow.length ? `<dt>How it fits</dt><dd><ol class="flow">${flow.map((/** @type {string} */ f) => `<li>${inline(f)}</li>`).join("")}</ol></dd>` : ""}
        ${risks.length ? `<dt>How it bites</dt><dd><ul class="bites">${risks.join("")}</ul></dd>` : ""}
        ${(primer && primer.verify) || spec.verify ? `<dt>Prove it works</dt><dd>${inline((primer && primer.verify) || spec.verify)}</dd>` : ""}
      </dl>
      ${vocab}
      ${decision}
      <div class="more"><div class="more-list">
        ${spec.docs ? `<button class="link" data-action="link" data-url="${esc(spec.docs)}">${esc(t.name)} docs</button>` : ""}
        <button class="link" data-action="copy" data-text="${esc(`Walk me through how ${t.name} is set up in this project: where it is configured, what it sends and when, and how I can see it working.`)}">Copy a question for your AI</button>
        ${t.inFeed ? `<button class="link" data-action="dismissItem" data-key="${esc(t.key)}">Remove from the feed</button>` : ""}
      </div></div>
    </article>`;
  }

  function beltName(/** @type {number} */ box) {
    return (dojo && dojo.belts[box]) || ["White", "Yellow", "Orange", "Green", "Brown", "Black"][box] || "White";
  }

  /* ---- something broke ---- */

  function debugPage(/** @type {any} */ i) {
    const r = i.result;
    const clue = r ? r.clue : i.revealed || null;
    const done = Boolean(r || i.revealed);
    const who = i.by === "you" ? "in your terminal" : `by ${i.by}`;
    const lines = i.lines
      .map((/** @type {string} */ line, /** @type {number} */ k) => {
        const n = k + 1;
        let cls = "codeline";
        if (done && n === clue) cls += " right";
        else if (done && n === i.picked) cls += " wrong";
        else if (!done && n === i.picked) cls += " picked";
        return `<button class="${cls}" data-action="debugPick" data-key="${esc(i.key)}" data-line="${n}"${done ? " disabled" : ""} aria-pressed="${n === i.picked}"><span class="ln">${n}</span><code>${esc(line) || " "}</code></button>`;
      })
      .join("");
    const tag = r && r.verdict ? `<span class="tag verdict-${esc(r.verdict)}">${VERDICT[r.verdict]}</span>` : done ? `<span class="tag">Read</span>` : `<span class="tag risk">Read it</span>`;
    const head = `${pageHead("🩺", "Something broke", tag)}
      <p class="muted"><code>${esc(i.command)}</code> failed ${esc(who)} · ${esc(clock(i.at))}${i.repeats > 1 ? ` · ${i.repeats} times` : ""}</p>`;
    const slot = `${i.key}|diagnose`;
    const hintSlot = `${i.key}|hint`;
    const recurring =
      i.repeats >= 3
        ? `<div class="note"><p>This has failed ${i.repeats} times. A failure that keeps coming back is worth a lesson of its own. <button class="link" data-action="debugLesson" data-key="${esc(i.key)}">Turn it into a lesson</button></p></div>`
        : "";

    if (!done) {
      const hints = i.hints || {};
      const shown = [
        hints.nudge ? `<div class="hint"><span class="muted">Nudge</span>${prose(hints.nudge)}</div>` : "",
        hints.pointer ? `<div class="hint"><span class="muted">Pointer</span>${prose(hints.pointer)}</div>` : "",
      ].join("");
      const nextHint = !state.ai.label || busy(hintSlot)
        ? ""
        : !hints.nudge
        ? `<button class="link" data-action="debugHint" data-key="${esc(i.key)}" data-step="nudge">Stuck? A nudge</button>`
        : !hints.pointer
        ? `<button class="link" data-action="debugHint" data-key="${esc(i.key)}" data-step="pointer">Point me at the line</button>`
        : "";
      const d = `${i.key}|read`;
      return `<article class="card page debug">${head}
        <div class="block first">
          <h4>Read it before your AI fixes it</h4>
          <p class="muted">Tap the line that tells you the most. Then say what you think broke.</p>
          <div class="code">${lines}</div>
          ${shown}${waiting(hintSlot)}${problem(hintSlot)}
          ${
            busy(slot)
              ? `<p class="asked">${esc(drafts[d + ".sent"] || "")}</p>${waiting(slot)}`
              : `<form data-submit="debugSubmit" data-key="${esc(i.key)}">
                   <textarea data-draft="${esc(d)}" rows="3" placeholder="It broke because… I would look at…" aria-label="Your read of the error" maxlength="800">${esc(drafts[d] || "")}</textarea>
                   <div class="actions">
                     <button type="submit" class="primary">Check my read</button>
                     ${nextHint}
                     <button type="button" class="link" data-action="debugSkip" data-key="${esc(i.key)}">Skip, show me</button>
                   </div>
                 </form>`
          }
          ${problem(slot)}
        </div>
        ${recurring}
      </article>`;
    }

    if (r) {
      const copy = `My read of this error: ${i.guess || "(none)"}. I think the cause is: ${r.cause} Fix it, and tell me which line of the error told you.`;
      return `<article class="card page debug">${head}
        <div class="code">${lines}</div>
        ${clue ? `<p class="muted">The clue is line ${clue}${i.picked && i.picked !== clue ? `; you picked line ${i.picked}` : i.picked === clue ? ", the one you picked" : ""}.</p>` : ""}
        ${i.guess ? `<p><span class="muted">Your read:</span> ${esc(i.guess)}</p>` : ""}
        ${r.verdict ? `<div class="result ${r.verdict === "wrong" ? "miss" : "ok"}"><strong>${VERDICT[r.verdict]}</strong>${prose(r.feedback)}</div>` : ""}
        <dl>
          <dt>What broke</dt><dd>${inline(r.cause)}</dd>
          ${r.where ? `<dt>Where to look</dt><dd>${fileLink(i.root, r.where.file, r.where.line)}</dd>` : ""}
          ${r.fix ? `<dt>The fix</dt><dd>${inline(r.fix)}</dd>` : ""}
        </dl>
        ${r.habit ? `<div class="hint habit"><span class="muted">Next time</span><p>${inline(r.habit)}</p></div>` : ""}
        <p class="by">Read by ${esc(r.by)}. Check it against the code before you trust it.</p>
        <div class="actions"><button data-action="copy" data-text="${esc(copy)}">Copy for your AI</button></div>
        ${recurring}
      </article>`;
    }

    // No AI: where to look, a habit, and the learner's own check.
    return `<article class="card page debug">${head}
      <div class="code">${lines}</div>
      <div class="block">
        <h4>Where to look first: line ${esc(clue)}</h4>
        <p>It is the first line that names one of your own files (not a library), or failing that, the first that says what went wrong.</p>
        <ol class="flow">
          <li>Read the message: what value or thing was missing or wrong?</li>
          <li>Open the first frame in your code, at that line.</li>
          <li>Ask what that line assumed that was not true.</li>
        </ol>
      </div>
      ${
        i.guess && !i.self
          ? `<p><span class="muted">Your read:</span> ${esc(i.guess)}</p>
             <p>Did your read point at the same place? <button class="link" data-action="debugSelf" data-key="${esc(i.key)}" data-right="1">I had it</button> <button class="link" data-action="debugSelf" data-key="${esc(i.key)}" data-right="0">I missed it</button></p>`
          : i.self
          ? `<p class="muted">${i.self === "right" ? "Counted as read right." : "Counted. The habit above is the one to try next time."}</p>`
          : ""
      }
      ${recurring}
    </article>`;
  }

  /* ---- before you commit ---- */

  function gatePage(/** @type {any} */ g) {
    const q = quizzes[g.key];
    const slot = `${g.key}|ask`;
    const files = g.files.slice(0, 6).map((/** @type {string} */ f) => `<li>${fileLink(g.root, f, null)}</li>`).join("");
    const after = q && q.answer
      ? `<p class="muted">${q.answer.correct ? "Ready to commit." : "Worth one more read of the diff before you commit. Nothing is blocked; it is your call."}</p>`
      : "";
    return `<article class="card page gate">
      ${pageHead("🚦", "Before you commit", `<span class="tag">${g.lines} lines</span>`)}
      <p class="hook">One question to check you know what you are about to commit. About thirty seconds. Nothing is blocked.</p>
      <ul class="files">${files}${g.files.length > 6 ? `<li class="muted">and ${g.files.length - 6} more</li>` : ""}</ul>
      ${g.committed && !q ? `<p class="muted">Already committed. The question still works as practice.</p>` : ""}
      ${g.noQuestion ? `<p class="muted">No question for this one: nothing in it matches an idea Miyagi knows, and no AI is set up to write one.</p>` : ""}
      ${q ? quizBlock(q, "card", g.key) : busy(slot) ? waiting(slot) : g.noQuestion ? "" : `<div class="actions"><button class="primary" data-action="gateAsk" data-key="${esc(g.key)}">Ask me</button><button class="link" data-action="dismissItem" data-key="${esc(g.key)}">Not this time</button></div>`}
      ${problem(slot)}
      ${after}
    </article>`;
  }

  /* ---- the strip, the box, the offer ---- */

  function teachMeBox() {
    const slot = "learn|about";
    return `<form class="ask learn" data-submit="learnAbout" data-key="learn">
        <input type="text" data-draft="learn|about" value="${esc(drafts["learn|about"] || "")}" placeholder="Learn a tool or idea: Sentry, Zod, webhooks…" aria-label="Learn a tool or idea" maxlength="80">
        <button type="submit">Learn</button>
      </form>${waiting(slot)}${problem(slot)}`;
  }

  function offerBanner() {
    if (!state.coach || !state.coach.offerAi || state.ai.label) return "";
    return `<div class="banner offer">Miyagi found no AI it can use, so it can only teach its built-in ideas, not what your assistant is building. Connect one to learn from your own code.
      <button class="link" data-action="aiOffer" data-accept="1">Choose an AI</button>
      <button class="link" data-action="aiOffer" data-accept="0">Use built-in ideas</button></div>`;
  }

  function lessonDecisionsBlock(/** @type {any} */ lesson) {
    const slot = `${lesson.id}|decisions`;
    const found = state.lessonDecisions[lesson.id];
    if (!found) return waiting(slot) + problem(slot);
    if (!found.items.length) return `<div class="block"><h4>Decisions</h4><p class="muted">${esc(found.by)} found no real choice between alternatives in this change.</p></div>`;
    const items = found.items
      .map(
        (/** @type {any} */ d, /** @type {number} */ k) => `<li>
          <strong>${esc(d.title)}</strong>
          <p>${esc(d.chose)}${d.over.length ? ` <span class="muted">over</span> ${esc(d.over.join(", "))}` : ""}</p>
          <p>${inline(d.because)}</p>
          ${d.tradeoff ? `<p><span class="muted">Given up:</span> ${inline(d.tradeoff)}</p>` : ""}
          ${d.saved ? `<p class="muted">Saved to your decision log.</p>` : `<button class="link" data-action="saveDecision" data-lesson="${esc(lesson.id)}" data-index="${k}">Save to my decision log</button>`}
        </li>`,
      )
      .join("");
    return `<div class="block risks"><h4>Decisions in this change</h4><ul>${items}</ul><p class="by">Found by ${esc(found.by)}. Seniors are mostly people who remember why.</p></div>`;
  }

  /* ---- the Grow tab ------------------------------------------------ */

  function growTab() {
    if (!grow) return `<div class="empty"><p class="muted">Loading…</p></div>`;
    const g = grow;
    const note = growNote ? `<div class="banner" role="status">${esc(growNote)} <button class="link" data-action="growNoteOk">OK</button></div>` : "";
    return `<section class="grow">${note}
      ${trendBlock(g)}
      ${mapBlock(g)}
      ${toolsBlock(g)}
      ${decisionsBlock(g)}
      ${incidentBlock(g)}
      ${storyBlock(g)}
      <p class="muted tail">${g.gates.asked ? `Commit checks: ${g.gates.right} of ${g.gates.asked} right. ` : ""}Everything here stays on this machine, in ~/.miyagi/growth.json.</p>
    </section>`;
  }

  function trendBlock(/** @type {any} */ g) {
    const t = g.trend;
    const w = t.thisWeek;
    const bars = t.weeks
      .map((/** @type {any} */ wk) => {
        const pct = wk.wentFirst === null ? 0 : Math.round(wk.wentFirst * 100);
        const label = new Date(wk.week + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
        const short = new Date(wk.week + "T00:00:00").toLocaleDateString([], { day: "numeric" });
        return `<div class="bar${wk.wentFirst === null ? " empty" : ""}" title="${esc(label)}: ${wk.wentFirst === null ? `${wk.moves} moves, too few to say` : `went first ${pct}% of ${wk.moves} moves`}">
          <span class="fill h${wk.wentFirst === null ? 0 : Math.max(1, Math.round(pct / 10))}"></span><span class="wk">${esc(short)}</span></div>`;
      })
      .join("");
    const moves = [
      w.explainedTried ? `${plural(w.explainedTried, "explanation")} in your words` : "",
      w.debugReads ? `${plural(w.debugReads, "error")} read` : "",
      w.unaided ? `${plural(w.unaided, "piece")} written unaided` : "",
    ]
      .filter(Boolean)
      .map((label) => `<span class="chip static">${esc(label)}</span>`)
      .join("");
    return `<div class="block trend"><h4>Going first</h4>
      <p>${t.sentence ? esc(t.sentence) : "How often you try before your AI explains: explaining a card yourself, reading an error, writing a piece unaided. Make a few of those moves and your trend shows here."}</p>
      <div class="bars" aria-label="Share of moves where you went first, by week">${bars}</div>
      ${moves ? `<p class="chips"><span class="muted">This week:</span> ${moves}</p>` : ""}
    </div>`;
  }

  function mapBlock(/** @type {any} */ g) {
    const levels = ["Junior", "Mid", "Senior"];
    const dot = { held: "●", started: "◐", untouched: "○" };
    const names = { held: "Held", started: "Started", untouched: "Not met yet" };
    const rows = (/** @type {string} */ level) =>
      g.map.skills
        .filter((/** @type {any} */ k) => k.level === level)
        .map((/** @type {any} */ k) => {
          const open = ui.skill === k.id;
          const ex = g.exercise[k.id];
          const slot = `grow|skill|${k.id}`;
          return `<li class="skill ${esc(k.status)}${open ? " open" : ""}">
            <button class="skill-head" data-action="skill" data-id="${esc(k.id)}" aria-expanded="${open}">
              <span class="status" aria-label="${names[k.status]}">${dot[k.status]}</span>
              <span class="skill-title">${esc(k.title)}</span>
              <span class="muted skill-progress">${esc(k.progress)}</span>
            </button>
            ${
              open
                ? `<div class="skill-body">
                    <p>${esc(k.why)}</p>
                    ${
                      ex
                        ? `<div class="block turn"><h4>Try it in your project</h4><p>${inline(ex.task)}</p>${ex.file ? `<p>${fileLink(ex.root || "", ex.file, null)}</p>` : ""}
                            ${ex.done ? `<p class="muted">Done when: ${inline(ex.done)}</p>` : ""}
                            ${ex.hint ? `<details><summary class="muted">A hint</summary><p>${inline(ex.hint)}</p></details>` : ""}
                            ${ex.completed ? `<p class="muted">Marked done. It is in your story.</p>` : `<div class="actions"><button class="primary" data-action="skillDone" data-id="${esc(k.id)}">I did it</button></div>`}
                            <p class="by">Suggested by ${esc(ex.by)}. Do this one without your assistant.</p></div>`
                        : busy(slot)
                        ? waiting(slot)
                        : `<p><span class="muted">Try:</span> ${esc(k.tryIt)}</p>
                           ${state.ai.label ? `<button data-action="skillExercise" data-id="${esc(k.id)}">Suggest one in my project</button>` : ""}`
                    }
                    ${problem(slot)}
                  </div>`
                : ""
            }
          </li>`;
        })
        .join("");
    const held = g.map.skills.filter((/** @type {any} */ k) => k.status === "held").length;
    return `<div class="block map"><h4>Your map</h4>
      <p class="muted">${held} of ${g.map.skills.length} skills held. Belts show what you can recall; this shows what your projects have not asked of you yet.</p>
      ${g.map.next ? `<p class="next">${esc(g.map.next.sentence)} <button class="link" data-action="skill" data-id="${esc(g.map.next.id)}">Start here</button></p>` : `<p class="next">Every skill on the map is held. Time to pick harder projects.</p>`}
      ${levels
        .map((l) => {
          const skills = g.map.skills.filter((/** @type {any} */ k) => k.level === l);
          const heldHere = skills.filter((/** @type {any} */ k) => k.status === "held").length;
          // The level holding the next skill, or the one open in the UI, starts open; the rest wait one tap away.
          const open = skills.some((/** @type {any} */ k) => (g.map.next && k.id === g.map.next.id) || k.id === ui.skill);
          return `<details class="level"${open ? " open" : ""}><summary><h5>${l} <span class="muted">${heldHere} of ${skills.length}</span></h5></summary><ul class="skills">${rows(l)}</ul></details>`;
        })
        .join("")}
    </div>`;
  }

  function toolsBlock(/** @type {any} */ g) {
    const tools = g.tools
      .map((/** @type {any} */ t) => {
        const pct = t.terms.length ? Math.round((t.held / t.terms.length) * 100) : 0;
        return `<li><button class="idea" data-action="openTool" data-key="${esc(t.key)}">
          <span class="idea-name"><span aria-hidden="true">${esc(t.emoji)}</span> ${esc(t.name)} <span class="muted">${esc(t.job)}</span></span>
          ${t.conversant ? `<span class="tag verdict-right">Conversant</span>` : t.adopted ? `<span class="tag">${t.held}/${t.terms.length}</span>` : `<span class="tag new">Not started</span>`}
          ${t.adopted ? `<progress max="100" value="${pct}" aria-label="${t.held} of ${t.terms.length} terms held"></progress>` : ""}
        </button></li>`;
      })
      .join("");
    return `<div class="block tools"><h4>Tools</h4>
      ${tools ? `<ul class="ideas">${tools}</ul>` : `<p class="muted">When your project adopts a library or service (Sentry, Stripe, Prisma…), it shows up here with a short track to become conversant in it.</p>`}
      ${teachMeBox()}
    </div>`;
  }

  function decisionsBlock(/** @type {any} */ g) {
    const items = g.decisions
      .slice(0, 12)
      .map(
        (/** @type {any} */ d) => `<li>
          <strong>${esc(d.title)}</strong> <span class="muted">${esc(new Date(d.at).toLocaleDateString([], { month: "short", day: "numeric" }))}</span>
          <p>${esc(d.chose)}${d.over.length ? ` <span class="muted">over</span> ${esc(d.over.join(", "))}` : ""}: ${inline(d.because)}</p>
          ${d.revisit ? `<p class="muted">Revisit when: ${inline(d.revisit)}</p>` : ""}
          <button class="link" data-action="copyDecision" data-id="${esc(d.id)}">Copy as a decision record</button>
        </li>`,
      )
      .join("");
    const f = (/** @type {string} */ k, /** @type {string} */ label, /** @type {string} */ hint) =>
      `<label class="field"><span>${label}</span><input type="text" data-draft="decision|${k}" value="${esc(drafts["decision|" + k] || "")}" placeholder="${esc(hint)}" maxlength="300"></label>`;
    const form = ui.decisionForm
      ? `<form data-submit="decisionTyped" data-key="decision">
          ${f("chose", "We chose", "Postgres")}
          ${f("over", "Over (optional)", "MongoDB, SQLite")}
          ${f("because", "Because", "our data is relational and we need transactions")}
          ${f("title", "Title (optional)", "Database for orders")}
          <div class="actions"><button type="submit" class="primary">Save</button><button type="button" class="link" data-action="decisionForm">Cancel</button></div>
        </form>`
      : `<p><button class="link" data-action="decisionForm">Log a decision yourself</button></p>`;
    return `<details class="block decisions"${g.decisions.length ? " open" : ""}><summary><h4>Decisions (${g.decisions.length})</h4></summary>
      <p class="muted">Why your project is the way it is. Each saved decision with a question comes back on review, so the reason stays yours.</p>
      ${items ? `<ul class="log">${items}</ul>` : ""}
      ${form}
    </details>`;
  }

  function incidentBlock(/** @type {any} */ g) {
    const slot = "grow|incident";
    const items = g.incidents
      .slice(0, 8)
      .map((/** @type {any} */ x) => `<li><strong>${esc(x.title)}</strong><p>${inline(x.cause)}</p>${x.prevention ? `<p class="muted">Would have caught it: ${inline(x.prevention)}</p>` : ""}</li>`)
      .join("");
    return `<details class="block incidents" id="incident"${g.incidents.length || drafts["grow|incident"] ? " open" : ""}><summary><h4>Learn from something that broke</h4></summary>
      <p class="muted">Paste an error, a bug report or your notes about something that went wrong for real. It becomes a lesson and a question, and the idea it was an instance of comes up for review today.</p>
      ${
        busy(slot)
          ? waiting(slot)
          : state.ai.label
          ? `<form data-submit="incident" data-key="grow">
              <textarea data-draft="grow|incident" rows="4" placeholder="Users saw a blank page after login. The console said…" aria-label="What broke" maxlength="4000">${esc(drafts["grow|incident"] || "")}</textarea>
              <div class="actions"><button type="submit" class="primary">Turn it into a lesson</button></div>
            </form>`
          : `<p class="muted">This needs an AI to read the report. <button class="link" data-action="command" data-id="miyagi.chooseAi">Choose an AI</button></p>`
      }
      ${problem(slot)}
      ${items ? `<ul class="log">${items}</ul>` : ""}
    </details>`;
  }

  function storyBlock(/** @type {any} */ g) {
    const p = g.practice || {};
    const items = g.story
      .slice(0, 8)
      .map((/** @type {any} */ e) => `<li><strong>${inline(e.title)}</strong> <span class="muted">${esc(new Date(e.at).toLocaleDateString([], { month: "short", day: "numeric" }))}</span><p>${inline(e.detail)}</p></li>`)
      .join("");
    const ask = "grow|story";
    const ans = "grow|storyAnswer";
    const practice = p.question
      ? `<div class="block"><h4>${esc(p.question)}</h4>
          <p class="muted">Answer as you would out loud: the situation, what you did (not the AI), the result, what you learned.</p>
          ${
            p.feedback
              ? `<p><span class="tag verdict-${esc(p.feedback.verdict)}">${VERDICT[p.feedback.verdict]}</span></p>${prose(p.feedback.feedback)}<p class="by">Coached by ${esc(p.feedback.by)}</p>
                 <button class="link" data-action="storyAsk">Another question</button>`
              : busy(ans)
              ? waiting(ans)
              : `<form data-submit="storyAnswer" data-key="grow">
                  <textarea data-draft="grow|storyAnswer" rows="5" placeholder="We had…" aria-label="Your answer" maxlength="1500">${esc(drafts["grow|storyAnswer"] || "")}</textarea>
                  <div class="actions"><button type="submit" class="primary">Coach my answer</button></div>
                </form>`
          }
          ${problem(ans)}</div>`
      : busy(ask)
      ? waiting(ask)
      : "";
    return `<div class="block story"><h4>Your story (${g.storyCount})</h4>
      <p class="muted">Things you did or can recall without help: tools learned, decisions, errors read, belts earned. The raw material for a portfolio or an interview.</p>
      ${items ? `<ul class="log">${items}</ul>` : `<p class="muted">Empty so far. It fills itself as you go.</p>`}
      ${practice}${problem(ask)}
      <div class="actions">
        ${g.storyCount && state.ai.label && !p.question && !busy(ask) ? `<button data-action="storyAsk">Practise an interview question</button>` : ""}
        ${g.storyCount ? `<button class="link" data-action="command" data-id="miyagi.story">Export as Markdown</button>` : ""}
      </div>
    </div>`;
  }

  /* ---- Review and Dojo ------------------------------------------- */

  /** "5 questions, about 2 minutes": the size of the next set, never the whole queue. */
  function setLabel(/** @type {number} */ due) {
    const n = Math.min(SET_SIZE, due);
    const minutes = Math.max(1, Math.round((n * SECONDS_PER_QUESTION) / 60));
    return `${plural(n, "question")}, about ${plural(minutes, "minute")}`;
  }

  function reviewTab() {
    const s = state.status;
    const due = dueCount();
    const scope = state.topic ? ` in ${esc(state.topic)}` : "";
    if (review.quiz) {
      const inCheck = state.check;
      const setOver = !inCheck && (review.setAnswered >= review.setSize || !due);
      const label = inCheck ? (inCheck.asked < inCheck.of ? "Next question" : "See the result") : setOver ? "Finish" : "Next question";
      const next = review.answer
        ? `<div class="actions"><button class="primary" data-action="${setOver ? "finishSet" : "nextReview"}">${label}</button></div>`
        : "";
      const n = Math.min(review.setAnswered + (review.answer ? 0 : 1), review.setSize);
      const right = inCheck ? `Unaided check: ${inCheck.asked} of ${inCheck.of}` : `${n} of ${review.setSize}`;
      const ideaLink =
        review.answer && review.quiz.conceptId && !inCheck
          ? `<p><button class="link" data-action="idea" data-id="${esc(review.quiz.conceptId)}" data-from="review">Open this idea ›</button></p>`
          : "";
      return `
        <section class="review">
          ${inCheck ? `<p class="muted">No hints, no explanations, no AI. Just what you can recall.</p>` : ""}
          <h3><span>${inline(review.quiz.about)}</span><span class="muted">${right}</span></h3>
          ${quizBlock(review, "review", "")}
          ${ideaLink}
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
    if (review.setDone && due) {
      return `
        <div class="empty">
          <h2>Set done: ${plural(review.setAnswered, "question")}</h2>
          <p>${plural(due, "question")} still due${scope}. They stay queued; there is no rush to clear them.</p>
          <div class="actions center">
            <button class="primary" data-action="startReview">Keep going</button>
            <button data-action="tab" data-tab="now">Done for now</button>
          </div>
        </div>`;
    }
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
        <h2>${due ? setLabel(due) : `Nothing is due${scope}`}</h2>
        <p>Each idea you were shown left one question behind. Answering it from memory, later, is the part that makes it stick.</p>
        ${due ? `<button class="primary" data-action="startReview">Start</button>` : ""}
        ${due > SET_SIZE ? `<p class="muted">${due} due in total${scope}. The rest stay queued for the next set.</p>` : ""}
        ${drills}
        <p><button class="link" data-action="command" data-id="miyagi.weeklyReport">See how your week went</button></p>
      </div>`;
  }

  const termById = (/** @type {string} */ id) => state.glossary.terms.find((/** @type {any} */ t) => t.id === id);

  /** The Dojo's glossary: every open project's own words, searchable. */
  function glossaryBlock() {
    const g = state.glossary;
    if (!g.projects.length) return "";
    const query = (drafts["glossary|search"] || "").trim().toLowerCase();
    const matches = g.terms.filter(
      (/** @type {any} */ t) => !query || t.term.toLowerCase().includes(query) || t.meaning.toLowerCase().includes(query),
    );
    const many = g.projects.length > 1;
    const rows = matches
      .map(
        (/** @type {any} */ t) => `<li class="row">
          <button class="row-head" data-action="term" data-id="${esc(t.id)}">
            <span class="emoji" aria-hidden="true">📖</span>
            <span class="row-main">
              <span class="row-title">${esc(t.term)}</span>
              <span class="row-sub">${esc(t.meaning)}</span>
            </span>
            ${t.onReview ? `<span class="tags"><span class="tag">On review</span></span>` : ""}
            <span class="chev" aria-hidden="true">›</span>
          </button>
        </li>`,
      )
      .join("");
    const find = g.projects
      .map((/** @type {any} */ p) => {
        const slot = `glossary|${p.name}`;
        if (busy(slot)) return waiting(slot);
        return `<button data-action="findTerms" data-root="${esc(p.root)}"${state.ai.label ? "" : " disabled title=\"Choose an AI first\""}>Find words in ${many ? esc(p.name) : "this project"}</button>${problem(slot)}`;
      })
      .join("");
    return `<section class="glossary">
      <h3>Glossary <span class="muted">${g.terms.length ? `${g.terms.length} word${g.terms.length === 1 ? "" : "s"}` : ""}</span></h3>
      <p class="muted">The words that belong to your project: what a tenant, an invoice or a settlement means here, and where it lives in the code.</p>
      ${
        g.terms.length > 6
          ? `<input type="search" class="search" data-draft="glossary|search" value="${esc(drafts["glossary|search"] || "")}" placeholder="Search the glossary" aria-label="Search the glossary">`
          : ""
      }
      ${rows ? `<ul class="rows">${rows}</ul>` : g.terms.length ? `<p class="muted">No word matches "${esc(query)}".</p>` : ""}
      <div class="actions">${find}</div>
    </section>`;
  }

  /** One word's page: guess first, then what it means and where it lives. */
  function termPage(/** @type {any} */ t) {
    const back = pageBar("closeTerm", "Back");
    if (!t) return `${back}<div class="empty"><p class="muted">This word is no longer in the glossary.</p></div>`;
    const revealed = t.guess || ui.termRevealed[t.id];
    const head = `<h2 class="term-title">📖 ${esc(t.term)}</h2>
      <p class="muted">A word from ${esc(t.project)}${t.onReview ? " · on your review" : ""}</p>`;
    if (!revealed) {
      const draft = `term|${t.id}`;
      return `${back}<article class="card page">${head}
        <div class="block">
          <h4>What do you think it means here?</h4>
          <p class="muted">A guess in your own words first. It does not have to be right.</p>
          <form data-submit="termGuess" data-key="${esc(t.id)}">
            <textarea data-draft="${esc(draft)}" rows="2" placeholder="A ${esc(t.term)} is…" aria-label="What you think it means" maxlength="600">${esc(drafts[draft] || "")}</textarea>
            <div class="actions">
              <button type="submit" class="primary">Compare</button>
              <button type="button" class="link" data-action="termReveal" data-id="${esc(t.id)}">Skip, just show me</button>
            </div>
          </form>
        </div>
      </article>`;
    }
    const related = t.related
      .map((/** @type {string} */ name) => {
        const other = state.glossary.terms.find((/** @type {any} */ x) => x.project === t.project && x.term.toLowerCase() === name.toLowerCase());
        return other ? `<button class="chip" data-action="term" data-id="${esc(other.id)}">${esc(other.term)}</button>` : `<span class="chip">${esc(name)}</span>`;
      })
      .join("");
    const where = t.where.map((/** @type {string} */ f) => `<li>${fileLink(t.root, f, null)}</li>`).join("");
    const slot = `term|${t.id}`;
    return `${back}<article class="card page">${head}
      ${t.guess ? `<div class="hint"><span class="muted">You thought</span><p class="asked">${esc(t.guess)}</p></div>` : ""}
      <div class="block">
        <h4>What it means</h4>
        <p>${inline(t.meaning)}</p>
        ${t.inProject ? `<h4>In this code</h4><p>${inline(t.inProject)}</p>` : ""}
        ${where ? `<h4>Where it lives</h4><ul class="files">${where}</ul>` : ""}
        ${related ? `<h4>Goes with</h4><p class="chips">${related}</p>` : ""}
      </div>
      <div class="actions">
        ${
          t.onReview
            ? `<span class="muted">On your review. It comes back like any other question.</span>`
            : t.canReview
            ? `<button class="primary" data-action="termReview" data-id="${esc(t.id)}">Add to my review</button>`
            : ""
        }
        <button class="link" data-action="termRemove" data-id="${esc(t.id)}">Remove from glossary</button>
      </div>
      ${problem(slot)}
      <p class="by">Written by ${esc(t.by)} from your code. Check anything that matters.</p>
    </article>`;
  }

  function dojoTab() {
    if (ui.term) return termPage(termById(ui.term));
    if (ui.idea) {
      const back = pageBar("closeIdea", ui.ideaFrom === "review" ? "Back to review" : "All ideas");
      if (!ideaCard || ideaCard.conceptId !== ui.idea) return `${back}<div class="empty"><p class="muted">Loading…</p></div>`;
      return `${back}${card(ideaCard, true, true)}`;
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
    const w = state.week;
    // A weekly target with slack in it, rather than a streak one missed day destroys.
    const week = w
      ? `<span>${w.days} of ${w.goal} days this week${w.weeksRunning ? `, ${plural(w.weeksRunning, "week")} running` : ""}</span>`
      : "";
    return `
      ${filters()}
      <section class="dojo">
        <div class="stats">
          <span><strong>${seen.length} of ${all.length}</strong> ideas found${scope}</span>
          ${week}
        </div>
        <ul class="ideas">${seen.map(row).join("")}</ul>
        ${glossaryBlock()}
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

    const body = ui.tab === "review" ? reviewTab() : ui.tab === "dojo" ? dojoTab() : ui.tab === "grow" ? growTab() : nowTab();
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
    // Choosing a tab, including the one already open, always lands on its list.
    if (tab === "now") ui.cardKey = null;
    ui.tab = tab;
    if (tab === "dojo") {
      // Clicking the tab again returns from a lesson or a word to the list.
      ui.idea = null;
      ui.term = null;
      send({ type: "dojo" });
    }
    if (tab === "grow") send({ type: "grow" });
    remember();
    render();
  }

  function openIdea(/** @type {string} */ id, from = "dojo") {
    if (ui.tab === "dojo" && !ui.idea) ui.scroll.dojo = window.scrollY;
    ui.tab = "dojo";
    ui.idea = id;
    ui.ideaFrom = from;
    remember();
    send({ type: "idea", id });
    render();
    window.scrollTo(0, 0);
  }

  function startCheck() {
    ui.tab = "review";
    remember();
    checked = null;
    review = { asked: true, quiz: null, answer: null, picked: -1, cleared: 0, setSize: 0, setAnswered: 0, setDone: false };
    send({ type: "check" });
    render();
  }

  /** `fresh` starts a new set of five; otherwise this is the next question in the current one. */
  function startReview(fresh = true) {
    ui.tab = "review";
    checked = null;
    remember();
    const setSize = fresh ? Math.max(1, Math.min(SET_SIZE, dueCount())) : review.setSize;
    const setAnswered = fresh ? 0 : review.setAnswered;
    review = { asked: true, quiz: null, answer: null, picked: -1, cleared: review.cleared, setSize, setAnswered, setDone: false };
    send({ type: "review" });
    render();
  }

  /** Back lands where the learner was in the list, not at the top. */
  function restoreScroll(/** @type {string} */ where) {
    const y = ui.scroll[where] || 0;
    window.requestAnimationFrame(() => window.scrollTo(0, y));
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
      case "expand":
        ui.expanded = ui.expanded === key ? null : key;
        remember();
        return render();
      case "openCard":
        if (!key) return;
        if (!ui.cardKey) ui.scroll.now = window.scrollY;
        ui.cardKey = key;
        ui.expanded = key;
        remember();
        render();
        return window.scrollTo(0, 0);
      case "closeCard":
        ui.cardKey = null;
        remember();
        render();
        return restoreScroll("now");
      case "finishSet":
        review = Object.assign({}, review, { quiz: null, answer: null, setDone: true });
        return render();
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
      case "altOpen":
        ui.altOpen[key] = true;
        remember();
        return render();
      case "alternatives":
        // "Skip, just show me": no guess.
        delete drafts[`${key}|alternatives`];
        return send({ type: "alternatives", key, guess: "" });
      case "saveAlternative":
        return send({ type: "saveAlternative", key });
      case "findTerms":
        return send({ type: "findTerms", lesson: d.lesson || undefined, root: d.root || undefined });
      case "term":
        if (!ui.term) ui.scroll.dojoList = window.scrollY;
        ui.tab = "dojo";
        ui.idea = null;
        ui.term = d.id || null;
        remember();
        render();
        return window.scrollTo(0, 0);
      case "closeTerm":
        ui.term = null;
        remember();
        send({ type: "dojo" });
        render();
        return restoreScroll("dojoList");
      case "termReveal":
        ui.termRevealed[d.id || ""] = true;
        remember();
        return render();
      case "termReview":
        return send({ type: "termReview", id: d.id });
      case "termRemove":
        ui.term = null;
        remember();
        send({ type: "termRemove", id: d.id });
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
        return startReview(true);
      case "nextReview":
        return startReview(false);
      case "idea":
        return openIdea(d.id || "", d.from || "dojo");
      case "closeIdea":
        ui.idea = null;
        if (ui.ideaFrom === "review") {
          ui.tab = "review";
          remember();
          return render();
        }
        remember();
        send({ type: "dojo" });
        render();
        return restoreScroll("dojo");
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
      case "showChoices":
        review.choicesInstead = true;
        return render();
      case "toolGuessSkip":
        return send({ type: "toolGuess", key, text: "" });
      case "toolPrimer":
      case "toolAdopt":
      case "toolDecision":
      case "debugSkip":
      case "gateAsk":
      case "debugLesson":
        return send({ type: d.action, key });
      case "dismissItem":
        if (ui.cardKey === key) ui.cardKey = null;
        ui.expanded = null;
        remember();
        return send({ type: "dismissItem", key });
      case "termQuiz":
        return send({ type: "termQuiz", slot: d.slot, id: d.id });
      case "saveDecision":
        return send({ type: "saveDecision", key: key || undefined, lesson: d.lesson || undefined, index: d.index ? Number(d.index) : undefined });
      case "lessonDecisions":
        return send({ type: "lessonDecisions", lesson: d.lesson });
      case "copyDecision":
        return send({ type: "copyDecision", id: d.id });
      case "debugPick":
        return send({ type: "debugPick", key, line: Number(d.line) });
      case "debugHint":
        return send({ type: "debugHint", key, step: d.step });
      case "debugSelf":
        return send({ type: "debugSelf", key, right: d.right === "1" });
      case "aiOffer":
        return send({ type: "aiOffer", accept: d.accept === "1" });
      case "learnName":
        return send({ type: "learnAbout", text: d.name });
      case "openTool":
        ui.tab = "now";
        ui.cardKey = key;
        remember();
        render();
        return window.scrollTo(0, 0);
      case "skill":
        ui.skill = ui.skill === d.id ? null : d.id;
        remember();
        return render();
      case "skillExercise":
      case "skillDone":
        return send({ type: d.action, id: d.id });
      case "storyAsk":
        return send({ type: "storyAsk" });
      case "decisionForm":
        ui.decisionForm = !ui.decisionForm;
        remember();
        return render();
      case "growNoteOk":
        growNote = "";
        return render();
      case "command":
        return send({ type: "command", id: d.id });
      case "link":
        return send({ type: "openLink", url: d.url });
      case "copy":
        return send({ type: "copy", text: d.text });
    }
  });

  app.addEventListener(
    "toggle",
    (event) => {
      const el = /** @type {HTMLDetailsElement} */ (event.target);
      if (!el.dataset || !el.dataset.section) return;
      ui.sections[el.dataset.section] = el.open;
      remember();
    },
    true,
  );

  app.addEventListener("input", (event) => {
    const el = /** @type {HTMLInputElement} */ (event.target);
    if (el.dataset && el.dataset.draft) drafts[el.dataset.draft] = el.value;
    // The glossary filters as you type; the redraw keeps the caret where it was.
    if (el.dataset && el.dataset.draft === "glossary|search") render();
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
    // The coach's forms each keep their text under their own draft id.
    const take = (/** @type {string} */ id) => {
      const text = (drafts[id] || "").trim();
      delete drafts[id];
      return text;
    };
    switch (kind) {
      case "learnAbout": {
        const text = take("learn|about");
        return text ? send({ type: "learnAbout", text }) : undefined;
      }
      case "toolGuess":
        return send({ type: "toolGuess", key, text: take(`${key}|guess`) });
      case "debugSubmit": {
        const text = take(`${key}|read`);
        drafts[`${key}|read.sent`] = text;
        return send({ type: "debugSubmit", key, text });
      }
      case "answerOwn": {
        const text = take("review|own");
        if (!text || !review.quiz) return;
        drafts["review|own.sent"] = text;
        return send({ type: "answerOwn", token: review.quiz.token, text, confidence: review.confidence || null });
      }
      case "incident": {
        const text = (drafts["grow|incident"] || "").trim();
        return text ? send({ type: "incident", text }) : undefined;
      }
      case "storyAnswer": {
        const text = (drafts["grow|storyAnswer"] || "").trim();
        return text ? send({ type: "storyAnswer", text }) : undefined;
      }
      case "alternatives": {
        const draft = `${key}|alternatives`;
        const guess = (drafts[draft] || "").trim();
        delete drafts[draft];
        return send({ type: "alternatives", key, guess });
      }
      case "termGuess": {
        const draft = `term|${key}`;
        const text = (drafts[draft] || "").trim();
        if (!text) {
          ui.termRevealed[key] = true;
          remember();
          return render();
        }
        delete drafts[draft];
        return send({ type: "termGuess", id: key, text });
      }
      case "decisionTyped": {
        const typed = { title: take("decision|title"), chose: take("decision|chose"), over: take("decision|over"), because: take("decision|because") };
        ui.decisionForm = false;
        remember();
        return send({ type: "saveDecision", typed });
      }
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
      review = { asked: false, quiz: null, answer: null, picked: -1, cleared: 0, setSize: 0, setAnswered: 0, setDone: false };
      send({ type: "setTopic", topic: el.value });
    }
  });

  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "state":
        state = m;
        // The Grow tab reads computed data; refresh it when the state moves, at most every few seconds.
        if (ui.tab === "grow" && Date.now() - growAsked > 3000) {
          growAsked = Date.now();
          send({ type: "grow" });
        }
        break;
      case "tab":
        if (m.tab === "review") return startReview(true);
        return setTab(m.tab);
      case "quiz":
        if (m.quiz) quizzes[m.key] = { quiz: m.quiz, answer: null, picked: -1 };
        break;
      case "answered": {
        const entries = [review, ...Object.values(quizzes)];
        const entry = entries.find((e) => e.quiz && e.quiz.token === m.token);
        if (entry && m.answer) {
          entry.answer = m.answer;
          if (entry === review) {
            review.cleared += 1;
            review.setAnswered += 1;
            delete drafts["review|own"];
          }
          // The belt on an open dojo lesson just changed.
          if (ui.idea) send({ type: "idea", id: ui.idea });
        }
        break;
      }
      case "review":
        review = Object.assign({}, review, { asked: true, quiz: m.quiz, answer: null, picked: -1, setDone: false, choicesInstead: false, confidence: undefined });
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
      case "grow":
        grow = m.data;
        // A finished story answer no longer needs its draft.
        if (grow && grow.practice && grow.practice.feedback) delete drafts["grow|storyAnswer"];
        break;
      case "openItem":
        ui.tab = "now";
        ui.cardKey = m.key;
        ui.expanded = m.key;
        remember();
        render();
        return window.scrollTo(0, 0);
      case "openIdea":
        return openIdea(m.id, "dojo");
      case "openLesson": {
        // "Why did it touch these?": the lesson's first card, where the walkthrough lives.
        const lesson = state && state.lessons.find((/** @type {any} */ l) => l.id === m.lesson);
        if (lesson && lesson.cards[0]) {
          ui.tab = "now";
          ui.cardKey = lesson.cards[0].key;
          remember();
          render();
          return window.scrollTo(0, 0);
        }
        break;
      }
      case "incidentPrefill":
        drafts["grow|incident"] = m.text || "";
        ui.tab = "grow";
        ui.cardKey = null;
        remember();
        send({ type: "grow" });
        break;
      case "incidentDone":
        delete drafts["grow|incident"];
        growNote = `Saved: "${m.title}". ${m.related ? `"${m.related}" is up for review today.` : "Its question is on your review schedule."}`;
        break;
      case "decisionProblem":
        growNote = m.problem;
        ui.decisionForm = true;
        break;
    }
    render();
  });

  if (!ui.sections) ui.sections = {};
  if (!ui.altOpen) ui.altOpen = {};
  if (!ui.termRevealed) ui.termRevealed = {};
  if (!ui.scroll) ui.scroll = {};
  render();
  send({ type: "ready" });
  if (ui.tab === "dojo") send({ type: "dojo" });
  if (ui.tab === "grow") send({ type: "grow" });
  if (ui.tab === "dojo" && ui.idea) send({ type: "idea", id: ui.idea });
})();
