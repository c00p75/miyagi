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
      // Cards switched back to Miyagi's general lesson, by key.
      generic: {},
      // The glossary word whose page is showing, and words revealed without a guess.
      term: null,
      termRevealed: {},
      // Grow tab: which skill row is open, and whether the decision form is.
      skill: null,
      decisionForm: false,
      // The depth chosen on one card, when it differs from the learner's default.
      lessonDepth: {},
      // Which type of further reading is showing on each card.
      lessonTab: {},
      // Hashes of the "Did you know" facts already shown, so the next one is new.
      factsSeen: [],
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
  /** Lessons received, by `<card key>|<depth>`; which have been asked for; what was picked and done. */
  /** @type {Record<string, any>} */
  const lessons = {};
  const lessonAsked = new Set();
  /** Rows whose hook has been asked for in this sitting. */
  const hookAsked = new Set();
  /** Rows whose hook request has finished, written or not; and written hooks already shown once. */
  const hookDone = new Set();
  const hookShown = new Set();
  /** "Did you know" facts, sent once by the host: several per idea or tool, and general ones. */
  /** @type {{ byId: Record<string, string[]>, general: string[] }} */
  let facts = { byId: {}, general: [] };
  /** When each row's loading first showed; rows whose fact the learner chose to leave; rows with a redraw scheduled. */
  /** @type {Record<string, number>} */
  const hookLoadAt = {};
  const hookSkip = new Set();
  /** The fact chosen for each row's wait, so it does not change while it is on screen. */
  /** @type {Record<string, string>} */
  const hookFact = {};
  const hookTimers = new Set();
  /** @type {Record<string, number>} */
  const lessonPicks = {};
  /** @type {Record<string, boolean>} */
  const lessonDone = {};
  let growAsked = 0;
  /** The lesson opened from the dojo, when one is. */
  let ideaCard = null;

  const send = (/** @type {any} */ message) => vscode.postMessage(message);
  // Cards whose page has asked the host to fit the lesson to the code, this session.
  // The host answers at once when the lines have not changed, so once is enough.
  const tailorAsked = new Set();
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
    // The lesson rewritten around the learner's own lines, part by part. A part
    // that failed Miyagi's check is empty and the general text shows instead.
    const fitted = (state.tailored || {})[c.key];
    const t = fitted && !ui.generic[c.key] ? fitted : null;
    const hook = (t && t.hook) || c.hook;
    const lens = (t && t.lens) || c.lens[state.status.depth] || c.lens.Junior;
    const pitfall = (t && t.pitfall) || c.pitfall;
    if (pinned && c.file && c.status !== "locked" && state.tailorMode !== "off" && state.ai.label && !tailorAsked.has(c.key)) {
      tailorAsked.add(c.key);
      queueMicrotask(() => send({ type: "tailor", key: c.key }));
    }
    const tailorNote = !pinned || !c.file
      ? ""
      : busy(`${c.key}|tailor`) && !fitted
      ? `<p class="tailor-note muted"><span class="spinner" aria-hidden="true"></span> Fitting this lesson to your code…</p>`
      : fitted
      ? `<p class="tailor-note muted">${
          t
            ? `Written about your code by ${esc(fitted.by)}. <button class="link" data-action="genericLesson" data-key="${esc(c.key)}">Show the general lesson</button>`
            : `Miyagi's general lesson. <button class="link" data-action="genericLesson" data-key="${esc(c.key)}">Show it for your code</button>`
        }</p>`
      : "";
    const head = `
      <button class="card-head" data-action="toggle" data-key="${esc(c.key)}" aria-expanded="${isOpen}"${pinned ? " disabled" : ""}>
        <span class="emoji" aria-hidden="true">${esc(c.emoji)}</span>
        <span class="card-title">${esc(c.title)}</span>
        <span class="tags">${tags}</span>
      </button>
      <p class="hook">${inline(hook)}</p>${tailorNote}`;
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
      ? lessonBlock(c.key)
      : lessonOpen
      ? `<dl>
          <dt>What it is</dt><dd>${inline(c.what)}</dd>
          <dt>Know this</dt><dd>${inline(lens)}</dd>
          <dt>How it bites</dt><dd>${inline(pitfall)}</dd>
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
                 ${hookPreview(c.key, cardHook(c))}
               </div>`
            : ""
        }
      </li>`;
  }

  function nowList() {
    const cards = visibleCards();
    const entries = feedEntries();
    const total = state.lessons.reduce((/** @type {number} */ n, /** @type {any} */ l) => n + l.cards.length, 0);
    let body = filters() + offerBanner() + todayCard() + pulse() + teachMeBox();
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
    body += cardQuizBlock();
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
    if (i.kind === "read") {
      const v = i.result && i.result.verdict;
      const tag = v ? `<span class="tag verdict-${esc(v)}">${VERDICT[v]}</span>` : i.revealed ? `<span class="tag">Read</span>` : `<span class="tag new">Predict it</span>`;
      return { emoji: "📖", title: `Read it cold: ${i.name}`, sub: [i.file, time].filter(Boolean).join(" · "), tag, hook: "A function you did not write. Say what it does from its name, then read it.", open: "Read it ›" };
    }
    if (i.kind === "upgrade") {
      const tag = i.lesson ? `<span class="tag">Read</span>` : `<span class="tag risk">Major</span>`;
      return { emoji: "⬆️", title: `${i.name}: ${i.from} → ${i.to}`, sub: [i.file, time].filter(Boolean).join(" · "), tag, hook: "A major version: things may have changed underneath your code without an error.", open: "What changed? ›" };
    }
    if (i.kind === "gate" && i.findings && i.findings.length) {
      const sec = i.findings.filter((/** @type {any} */ f) => f.kind === "security").length;
      const left = i.findings.filter((/** @type {any} */ _f, /** @type {number} */ n) => !(i.shown || []).includes(n)).length;
      const tag = left ? `<span class="tag risk">${plural(i.findings.length, sec ? "risk" : "cost")}</span>` : `<span class="tag">Checked</span>`;
      return { emoji: sec ? "🔐" : "💸", title: `Before you commit: ${plural(i.findings.length, "thing")} to check`, sub: [`${i.files.length} file${i.files.length === 1 ? "" : "s"} staged`, time].join(" · "), tag, hook: sec ? "Something in what you staged could leak or let someone in." : "Something in what you staged could cost you money or time later.", open: "Check it ›" };
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
                 ${
                   i.kind === "tool"
                     ? hookPreview(i.key, toolHook(i), `<button class="link" data-action="dismissItem" data-key="${esc(i.key)}">Remove</button>`)
                     : `<p class="hook">${inline(m.hook)}</p>
                        <div class="actions"><button class="primary" data-action="openCard" data-key="${esc(i.key)}">${esc(m.open)}</button>
                        <button class="link" data-action="dismissItem" data-key="${esc(i.key)}">Remove</button></div>`
                 }
               </div>`
            : ""
        }
      </li>`;
  }



  /* ---- the lesson: eight sections, one depth switch ---------------- */

  const LESSON_SECTIONS = [
    ["problem", "The problem", "Why does it exist?"],
    ["concept", "The concept", "What is it?"],
    ["how", "How it works", "What happens inside?"],
    ["architecture", "Architecture", "Where does it fit in your project?"],
    ["implementation", "Implementation", "How is it used here?"],
    ["practical", "Practical considerations", "What to watch for"],
    ["application", "Application", "Your turn"],
    ["check", "Knowledge check", "Can you explain it?"],
  ];

  function lessonDepth(/** @type {string} */ key) {
    return ui.lessonDepth[key] || state.status.depth;
  }

  function lessonVisual(/** @type {any} */ v) {
    if (!v) return "";
    if (v.type === "compare") {
      return `<div class="ls-cmp">${v.cols
        .map(
          (/** @type {any} */ c) => `<div class="ls-col ${c.good ? "ok" : "bad"}"><b>${esc(c.title)}</b>${c.rows
            .map((/** @type {string} */ r, /** @type {number} */ i) => `<span${i === c.diff ? ' class="diff"' : ""}>${inline(r)}</span>`)
            .join("")}${c.result ? `<em>${c.good ? "✓" : "✗"} ${esc(c.result)}</em>` : ""}</div>`,
        )
        .join("")}</div>`;
    }
    if (v.type === "flow") {
      return `<div class="ls-flow">${v.steps
        .map((/** @type {any} */ st, /** @type {number} */ i) => `${i ? '<b aria-hidden="true">→</b>' : ""}<span>${esc(st.label)}${st.note ? `<i>${esc(st.note)}</i>` : ""}</span>`)
        .join("")}</div>`;
    }
    if (v.type === "parts") {
      return `<div class="ls-parts">${v.items.map((/** @type {any} */ p) => `<span>${esc(p.name)}<i>${esc(p.role)}</i></span>`).join("")}</div>`;
    }
    if (v.type === "terms") {
      return `<div class="ls-terms">${v.items.map((/** @type {any} */ p) => `<div><b>${esc(p.term)}</b><span>${inline(p.meaning)}</span></div>`).join("")}</div>`;
    }
    if (v.type === "code") {
      return `<div class="ls-code">${v.lines
        .map((/** @type {any} */ l) => `<details><summary><code>${esc(l.code)}</code></summary><p>${inline(l.why)}</p></details>`)
        .join("")}</div><p class="muted ls-small">Tap a line to see why it is there.</p>`;
    }
    if (v.type === "signal") {
      // Mark each explained part where it appears in the text.
      let html = esc(v.text);
      v.notes.forEach((/** @type {any} */ n, /** @type {number} */ i) => {
        html = html.replace(esc(n.part), `<mark class="m${i}">${esc(n.part)}</mark>`);
      });
      return `<div class="ls-signal"><code>${html}</code>${v.notes
        .map((/** @type {any} */ n, /** @type {number} */ i) => `<p><mark class="m${i}">${esc(n.part)}</mark> ${inline(n.meaning)}</p>`)
        .join("")}</div>`;
    }
    return "";
  }

  function lessonSection(/** @type {string} */ key, /** @type {string} */ depth, /** @type {any} */ sec, /** @type {number} */ i, /** @type {any} */ L) {
    const id = `${key}|${depth}|${i}`;
    const picked = lessonPicks[id];
    const p = sec.predict;
    const answered = !p || picked !== undefined;
    const predict = p
      ? `<div class="ls-ask"><p class="ls-q">${inline(p.question)}</p><div class="ls-picks">${p.options
          .map((/** @type {string} */ opt, /** @type {number} */ n) => {
            const cls = picked === undefined ? "" : n === p.answer ? " right" : n === picked ? " wrong" : "";
            return `<button class="${cls}" data-action="lessonPick" data-id="${esc(id)}" data-index="${n}"${picked === undefined ? "" : " disabled"}>${inline(opt)}</button>`;
          })
          .join("")}</div></div>
          ${picked === undefined ? "" : `<p class="ls-verdict">${picked === p.answer ? "Right." : "Not quite."} ${inline(p.why || p.options[p.answer])}</p>`}`
      : "";
    const draft = `${id}|say`;
    const t = sec.task;
    const task = t
      ? `<div class="ls-task"><p><b>Your goal:</b> ${inline(t.goal)}</p>${t.where ? `<p><b>Where:</b> ${inline(t.where)}</p>` : ""}<p><b>Done when:</b> ${inline(t.doneWhen)}</p>
          ${t.hint ? `<details><summary>Stuck? A hint</summary><p>${inline(t.hint)}</p></details>` : ""}
          ${lessonDone[id] ? `<p class="muted">Marked done.</p>` : `<button class="primary" data-action="lessonDone" data-id="${esc(id)}">I did it</button>`}
          <p class="muted ls-small">Do this one without your assistant.</p></div>
          ${t.experiments.length ? `<p class="ls-kicker">Then experiment: what happens if…</p><ul class="ls-list">${t.experiments.map((/** @type {string} */ e) => `<li>${inline(e)}</li>`).join("")}</ul><p class="muted ls-small">Guess first, then try it.</p>` : ""}`
      : "";
    const concepts = i === 1 && L.concepts.length
      ? `<p class="ls-kicker">Concepts · tap to open</p><div class="ls-chips">${L.concepts.map((/** @type {string} */ c) => `<button class="chip" data-action="learnName" data-name="${esc(c)}">${esc(c)} ›</button>`).join("")}</div>`
      : "";
    const after = answered
      ? `${lessonVisual(sec.reveal)}
         ${sec.explain ? prose(sec.explain) : ""}
         ${sec.oneLine ? `<p class="ls-one"><b>In one line:</b> ${inline(sec.oneLine)}</p>` : ""}
         ${concepts}
         ${sec.sayIt ? `<div class="ls-ask"><p class="ls-q">${inline(sec.sayIt)}</p><input type="text" data-draft="${esc(draft)}" value="${esc(drafts[draft] || "")}" placeholder="In your own words…" aria-label="Your answer" maxlength="600"><p class="muted ls-small">Saying it yourself is what makes it stick. Nobody grades this.</p></div>` : ""}
         ${sec.remember ? `<div class="ls-remember"><b>Remember</b><ul>${sec.remember.map((/** @type {string} */ r) => `<li>${inline(r)}</li>`).join("")}</ul></div>` : ""}
         ${sec.bridge && i < 7 ? `<p class="ls-bridge">${inline(sec.bridge)} <button class="link" data-action="lessonNext" data-key="${esc(key)}" data-index="${i}">Next section ›</button></p>` : ""}`
      : "";
    const body = `${sec.hook ? prose(sec.hook) : ""}${lessonVisual(sec.show)}${task}${predict}${after}`;
    const sid = `${key}|L${i}`;
    // Every section starts open: the lesson reads top to bottom without a tap. A closed one stays closed.
    const open = ui.sections[sid] === undefined ? true : ui.sections[sid];
    const [, title, asks] = LESSON_SECTIONS[i];
    const done = (p && picked !== undefined) || lessonDone[id];
    return `<details class="ls-sec${done ? " done" : ""}" data-section="${esc(sid)}"${open ? " open" : ""}>
      <summary><span class="ls-n">${done ? "✓" : i + 1}</span><span class="ls-t"><span>${title}</span><span>${asks}</span></span><span class="chev" aria-hidden="true">›</span></summary>
      <div class="ls-body">${body.trim() ? body : `<p class="muted">Nothing for this section yet.</p>`}</div>
    </details>`;
  }

  /** The whole lesson for a card or a tool: depth switch, eight sections, further reading. */
  function lessonBlock(/** @type {string} */ key) {
    const depth = lessonDepth(key);
    const id = `${key}|${depth}`;
    const L = lessons[id];
    if (!L && !lessonAsked.has(id)) {
      lessonAsked.add(id);
      queueMicrotask(() => send({ type: "lesson", key, depth }));
    }
    const seg = `<div class="ls-seg" role="group" aria-label="Depth">${["Junior", "Mid", "Senior"]
      .map((d) => `<button class="${d === depth ? "on" : ""}" data-action="lessonDepth" data-key="${esc(key)}" data-depth="${d}" aria-pressed="${d === depth}">${d}</button>`)
      .join("")}</div>`;
    if (!L) return `<div class="ls">${seg}<p class="muted">Loading the lesson…</p></div>`;
    const slot = `${key}|lesson|${depth}`;
    const note = busy(slot) || busy(`${L.root || ""}|profile`)
      ? `<p class="ls-note muted"><span class="spinner" aria-hidden="true"></span> ${esc(busy(slot) || "Your AI")} is writing this lesson for your project. Miyagi's built-in lesson shows meanwhile.</p>`
      : L.by
      ? `<p class="ls-note muted">Written for your project by ${esc(L.by)}. Check anything that matters.</p>`
      : state.ai.label
      ? failed(slot) ? `<p class="ls-note muted">${esc(failed(slot))}</p>` : ""
      : `<p class="ls-note muted">Miyagi's built-in lesson. <button class="link" data-action="command" data-id="miyagi.chooseAi">Choose an AI</button> for one written about your project.</p>`;
    // Further reading, always shown at the end: one tab per type, each with its count.
    const TABS = [
      ["video", "Videos", "▶"],
      ["article", "Articles", "📄"],
      ["site", "Sites", "🌐"],
      ["book", "Books", "📘"],
    ];
    // Official documentation is a site.
    const typeOf = (/** @type {any} */ r) => (r.kind === "docs" ? "site" : r.kind);
    const present = TABS.filter(([k]) => L.deeper.some((/** @type {any} */ r) => typeOf(r) === k));
    const tab = present.some(([k]) => k === ui.lessonTab[key]) ? ui.lessonTab[key] : present.length ? present[0][0] : "";
    const deeper = present.length
      ? `<section class="ls-end" aria-label="Keep learning">
          <h3>Keep learning</h3>
          <div class="ls-tabs" role="tablist">${present
            .map(([k, label]) => {
              const n = L.deeper.filter((/** @type {any} */ r) => typeOf(r) === k).length;
              return `<button role="tab" class="${k === tab ? "on" : ""}" aria-selected="${k === tab}" data-action="lessonTab" data-key="${esc(key)}" data-tab="${k}">${label} <i>${n}</i></button>`;
            })
            .join("")}</div>
          <div class="ls-reslist" role="tabpanel">${L.deeper
            .filter((/** @type {any} */ r) => typeOf(r) === tab)
            .map((/** @type {any} */ r) => {
              const icon = r.kind === "docs" ? "📚" : (TABS.find(([k]) => k === r.kind) || [])[2] || "↗";
              return `<button class="ls-res" data-action="link" data-url="${esc(r.url)}"><span aria-hidden="true">${icon}</span><span><span>${esc(r.title)}</span><span>${esc(r.by)}</span></span><span aria-hidden="true">↗</span></button>`;
            })
            .join("")}</div>
          <p class="muted ls-small">Links open in your browser. Except for official documentation, each opens a search for that title, so it never leads to a dead page.</p>
        </section>`
      : "";
    return `<div class="ls">${seg}${note}
      <div class="ls-secs">${LESSON_SECTIONS.map(([sidName], i) => lessonSection(key, depth, L.sections[sidName], i, L)).join("")}</div>
      ${deeper}
    </div>`;
  }

  /* ---- the hook in a row's preview ---- */

  /** The first sentence of a text, so a preview stays a glance. */
  function firstSentence(/** @type {string} */ text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    const m = /^(.{20,220}?[.!?])(\s|$)/.exec(t);
    return m ? m[1] : t.length > 220 ? t.slice(0, 219) + "…" : t;
  }

  /** The first `n` sentences, when they fit in a preview; otherwise just the first. */
  function firstSentences(/** @type {string} */ text, /** @type {number} */ n) {
    const parts = String(text || "").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+/g) || [];
    const joined = parts.slice(0, n).join(" ").trim();
    return joined && joined.length <= 200 ? joined : firstSentence(text);
  }

  /**
   * What an expanded row shows: a hook, not a summary. A question for most
   * cards, what is at stake for the ones tagged Risk (docs/TEACHING.md). The
   * built-in text shows at once; the one written about the learner's app
   * replaces it when their AI has written it.
   */
  function hookPreview(/** @type {string} */ key, /** @type {{ style: string, lead: string, tease: string, button: string, file?: string, factId?: string }} */ builtIn, extra = "") {
    const written = (state.hooks || {})[key];
    const canAsk = Boolean(state.ai.label) && state.tailorMode !== "off";
    if (!written && canAsk && !hookAsked.has(key)) {
      hookAsked.add(key);
      queueMicrotask(() => send({ type: "hook", key }));
      // If no answer ever comes, stop waiting and show Miyagi's own line.
      setTimeout(() => {
        if (!hookDone.has(key)) {
          hookDone.add(key);
          render();
        }
      }, 40000);
    }
    const waiting = !written && canAsk && hookAsked.has(key) && !hookDone.has(key);
    // A true fact while the hook is written, chosen once when the wait begins.
    if (waiting && hookFact[key] === undefined) hookFact[key] = nextFact(builtIn.factId);
    const fact = hookFact[key] || "";
    if (waiting && !hookLoadAt[key]) hookLoadAt[key] = Date.now();
    // The fact stays long enough to be read, even when the hook arrives sooner:
    // about a third of a second per word, between five and twelve seconds.
    const readMs = Math.max(5000, Math.min(12000, fact.split(/\s+/).length * 330 + 1500));
    const left = hookLoadAt[key] && !hookSkip.has(key) ? hookLoadAt[key] + readMs - Date.now() : 0;
    const holding = !waiting && Boolean(fact) && left > 0;
    if (holding && !hookTimers.has(key)) {
      hookTimers.add(key);
      setTimeout(render, left + 60);
    }
    // Text that silently changes reads as a glitch, so the row says what is happening.
    if (waiting || holding) {
      return `<div class="hk-load" role="status" aria-label="${holding ? "Your card is ready" : "Your AI is writing this card for your project"}">
          ${
            holding
              ? `<p class="hk-writing hk-ready">Your card is ready.</p>`
              : `<p class="hk-writing"><span class="hk-shine">Writing this card for your project…</span></p>
                 <div class="hk-skel" aria-hidden="true"><i></i><i></i></div>`
          }
          ${fact ? `<p class="hk-wait"><span>Did you know, while you wait</span>${inline(fact)}</p>` : ""}
        </div>
        <div class="hk-foot">${holding ? `<button class="primary" data-action="hookShow" data-key="${esc(key)}">Show it ›</button>` : ""}<button data-action="openCard" data-key="${esc(key)}">Open now ›</button>${extra}</div>`;
    }
    const h = written || builtIn;
    // The written hook fades in once, the first time it is drawn.
    const fresh = written && hookAsked.has(key) && !hookShown.has(key);
    if (written) hookShown.add(key);
    const lead = h.style === "stake"
      ? `<p class="hk-stake"><span>The risk</span>${inline(h.lead)}</p>`
      : `<p class="hk-lead">${inline(h.lead)}</p>`;
    return `<div class="hk${fresh ? " hk-in" : ""}">${lead}
      ${h.tease ? `<p class="hk-tease">${inline(h.tease)}</p>` : ""}
      ${written && written.general ? `<p class="hk-note">This card matched your code by pattern, and may not apply to it. Open it to check.</p>` : ""}
      </div>
      <div class="hk-foot"><button class="primary" data-action="openCard" data-key="${esc(key)}">${esc(h.button)} ›</button>
        <span class="hk-meta">8 short steps</span>${extra}</div>`;
  }

  /** A short, stable number for a fact's text, so "seen" can be remembered without storing the text. */
  function factHash(/** @type {string} */ text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h;
  }

  /**
   * The next fact to show: one the learner has not seen yet. The idea's or
   * tool's own facts come first; when those are used up, a general one; when
   * every fact has been seen, the cycle starts again. What has been seen is
   * remembered across restarts.
   */
  function nextFact(/** @type {string | undefined} */ id) {
    const seen = new Set(ui.factsSeen);
    const unseen = (/** @type {string[]} */ pool) => pool.filter((f) => !seen.has(factHash(f)));
    const own = (id && facts.byId[id]) || [];
    let pool = unseen(own);
    if (!pool.length) pool = unseen(facts.general);
    if (!pool.length) {
      // Everything has been shown: forget, and go round again.
      const all = own.concat(facts.general);
      const hashes = new Set(all.map(factHash));
      ui.factsSeen = ui.factsSeen.filter((/** @type {number} */ h) => !hashes.has(h));
      pool = own.length ? own : facts.general;
    }
    if (!pool.length) return "";
    const pick = pool[Math.floor(Math.random() * pool.length)];
    ui.factsSeen = ui.factsSeen.concat(factHash(pick)).slice(-3000);
    remember();
    return pick;
  }

  /** An idea card's built-in hook: its pitfall as the stake on Risk cards, its hook line otherwise. */
  function cardHook(/** @type {any} */ c) {
    return c.risk
      ? { factId: c.conceptId, file: c.file, style: "stake", lead: firstSentences(c.pitfall, 2), tease: "See where this is in your code, and how to close it.", button: "See how to avoid it" }
      : { factId: c.conceptId, file: c.file, style: "question", lead: c.hook, tease: firstSentence(c.what), button: "Find out" };
  }

  /** A tool's built-in hook: what it does, and where it arrived. */
  function toolHook(/** @type {any} */ t) {
    const spec = t.spec || {};
    return {
      factId: t.toolId,
      file: t.file,
      style: "question",
      lead: spec.analogy || spec.oneLiner || t.job,
      tease: t.file ? `It arrived in \`${t.file}\`. See what it is doing for your app.` : "See what it is doing for your app.",
      button: "Find out",
    };
  }

  function itemPage(/** @type {any} */ i) {
    if (i.kind === "tool") return toolPage(i);
    if (i.kind === "debug") return debugPage(i);
    if (i.kind === "read") return readPage(i);
    if (i.kind === "upgrade") return upgradePage(i);
    return gatePage(i);
  }

  /* ---- today ---- */

  // Said about the craft by people who practised it: computer science, software
  // engineering, programming, and building tech products, mostly from books. Checked wording and attribution only:
  // a misattributed quote in a learning tool teaches the wrong thing twice.
  // [quote, who said it, where it comes from (when it is one book or essay)]
  const QUOTES = [
    ["Programs must be written for people to read, and only incidentally for machines to execute.", "Harold Abelson and Gerald Jay Sussman", "Structure and Interpretation of Computer Programs"],
    ["Everyone knows that debugging is twice as hard as writing a program in the first place. So if you're as clever as you can be when you write it, how will you ever debug it?", "Brian Kernighan and P. J. Plauger", "The Elements of Programming Style"],
    ["The only way to learn a new programming language is by writing programs in it.", "Brian Kernighan and Dennis Ritchie", "The C Programming Language"],
    ["Controlling complexity is the essence of computer programming.", "Brian Kernighan", "Software Tools"],
    ["Adding manpower to a late software project makes it later.", "Fred Brooks", "The Mythical Man-Month"],
    ["Plan to throw one away; you will, anyhow.", "Fred Brooks", "The Mythical Man-Month"],
    ["Show me your tables, and I won't usually need your flowcharts; they'll be obvious.", "Fred Brooks", "The Mythical Man-Month"],
    ["Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", "Martin Fowler", "Refactoring"],
    ["When you feel the need to write a comment, first try to refactor the code so that any comment becomes superfluous.", "Martin Fowler and Kent Beck", "Refactoring"],
    ["Clean code always looks like it was written by someone who cares.", "Michael Feathers", "quoted in Clean Code"],
    ["The ratio of time spent reading versus writing is well over 10 to 1.", "Robert C. Martin", "Clean Code"],
    ["Functions should do one thing. They should do it well. They should do it only.", "Robert C. Martin", "Clean Code"],
    ["Leave the campground cleaner than you found it.", "Robert C. Martin", "Clean Code"],
    ["It is not enough for code to work. Code that works is often badly broken.", "Robert C. Martin", "Clean Code"],
    ["Don't live with broken windows.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Fix the problem, not the blame.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Don't program by coincidence.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["\"select\" isn't broken.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Every piece of knowledge must have a single, unambiguous, authoritative representation within a system.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Complexity is anything related to the structure of a software system that makes it hard to understand and modify the system.", "John Ousterhout", "A Philosophy of Software Design"],
    ["Working code isn't enough.", "John Ousterhout", "A Philosophy of Software Design"],
    ["To me, legacy code is simply code without tests.", "Michael Feathers", "Working Effectively with Legacy Code"],
    ["Optimism is an occupational hazard of programming; feedback is the treatment.", "Kent Beck", "Extreme Programming Explained"],
    ["Make the change easy (warning: this may be hard), then make the easy change.", "Kent Beck"],
    ["Make it work, make it right, make it fast.", "Kent Beck"],
    ["We should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil.", "Donald Knuth", "Structured Programming with go to Statements"],
    ["Beware of bugs in the above code; I have only proved it correct, not tried it.", "Donald Knuth"],
    ["Program testing can be used to show the presence of bugs, but never to show their absence!", "Edsger W. Dijkstra", "Notes on Structured Programming"],
    ["Simplicity is prerequisite for reliability.", "Edsger W. Dijkstra"],
    ["There are two ways of constructing a software design: one way is to make it so simple that there are obviously no deficiencies, and the other way is to make it so complicated that there are no obvious deficiencies.", "C. A. R. Hoare", "The Emperor's Old Clothes"],
    ["Inside every large program, there is a small program trying to get out.", "C. A. R. Hoare"],
    ["Measure. Don't tune for speed until you've measured, and even then don't unless one part of the code overwhelms the rest.", "Rob Pike", "Notes on Programming in C"],
    ["Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident.", "Rob Pike", "Notes on Programming in C"],
    ["Clear is better than clever.", "Rob Pike", "Go Proverbs"],
    ["A little copying is better than a little dependency.", "Rob Pike", "Go Proverbs"],
    ["Bad programmers worry about the code. Good programmers worry about data structures and their relationships.", "Linus Torvalds"],
    ["Talk is cheap. Show me the code.", "Linus Torvalds"],
    ["Given enough eyeballs, all bugs are shallow.", "Eric S. Raymond", "The Cathedral and the Bazaar"],
    ["Every good work of software starts by scratching a developer's personal itch.", "Eric S. Raymond", "The Cathedral and the Bazaar"],
    ["When you must fail, fail noisily and as soon as possible.", "Eric S. Raymond", "The Art of Unix Programming"],
    ["When in doubt, use brute force.", "Ken Thompson"],
    ["One of my most productive days was throwing away 1,000 lines of code.", "Ken Thompson"],
    ["Errors should never pass silently.", "Tim Peters", "The Zen of Python"],
    ["In the face of ambiguity, refuse the temptation to guess.", "Tim Peters", "The Zen of Python"],
    ["Explicit is better than implicit.", "Tim Peters", "The Zen of Python"],
    ["Easy things should be easy, and hard things should be possible.", "Larry Wall", "Programming Perl"],
    ["Organizations which design systems are constrained to produce designs which are copies of the communication structures of these organizations.", "Melvin Conway", "How Do Committees Invent?"],
    ["It always takes longer than you expect, even when you take into account Hofstadter's Law.", "Douglas Hofstadter", "Gödel, Escher, Bach"],
    ["The first 90 percent of the code accounts for the first 90 percent of the development time. The remaining 10 percent of the code accounts for the other 90 percent.", "Tom Cargill", "quoted in Programming Pearls"],
    ["The cheapest, fastest, and most reliable components are those that aren't there.", "Gordon Bell"],
    ["The most dangerous phrase in the language is \"We've always done it this way.\"", "Grace Hopper"],
    ["The best way to predict the future is to invent it.", "Alan Kay"],
    ["Before software can be reusable it first has to be usable.", "Ralph Johnson"],
    ["The function of good software is to make the complex appear to be simple.", "Grady Booch"],
    ["Walking on water and developing software from a specification are easy if both are frozen.", "Edward V. Berard"],
    ["Make something people want.", "Paul Graham", "Y Combinator"],
    ["Do things that don't scale.", "Paul Graham", "Do Things That Don't Scale"],
    ["It's better to make a few users love you than a lot ambivalent.", "Paul Graham", "Do Things That Don't Scale"],
    ["Live in the future, then build what's missing.", "Paul Graham", "How to Get Startup Ideas"],
    ["If you are not embarrassed by the first version of your product, you've launched too late.", "Reid Hoffman"],
    ["Every moment in business happens only once.", "Peter Thiel", "Zero to One"],
    ["What important truth do very few people agree with you on?", "Peter Thiel", "Zero to One"],
    ["The only way to win is to learn faster than anyone else.", "Eric Ries", "The Lean Startup"],
    ["If we do not know who the customer is, we do not know what quality is.", "Eric Ries", "The Lean Startup"],
    ["The hard thing about hard things is that there is no formula for dealing with them.", "Ben Horowitz", "The Hard Thing About Hard Things"],
    ["Get out of the building.", "Steve Blank", "The Four Steps to the Epiphany"],
    ["No business plan survives first contact with customers.", "Steve Blank"],
    ["Your most unhappy customers are your greatest source of learning.", "Bill Gates", "Business @ the Speed of Thought"],
    ["Ideas are easy. Execution is everything.", "John Doerr", "Measure What Matters"],
    ["Real artists ship.", "Steve Jobs"],
    ["Simple can be harder than complex: you have to work hard to get your thinking clean to make it simple.", "Steve Jobs"],
    ["Software is eating the world.", "Marc Andreessen", "Why Software Is Eating the World"],
    ["If you can't solve a problem, then there is an easier problem you can solve: find it.", "George Pólya", "How to Solve It"],
    ["A problem well stated is a problem half solved.", "Charles Kettering"],
    ["The question of whether a computer can think is no more interesting than the question of whether a submarine can swim.", "Edsger W. Dijkstra"],
    ["The competent programmer is fully aware of the strictly limited size of his own skull.", "Edsger W. Dijkstra", "The Humble Programmer"],
    ["The purpose of abstraction is not to be vague, but to create a new semantic level in which one can be absolutely precise.", "Edsger W. Dijkstra", "The Humble Programmer"],
    ["Elegance is not a dispensable luxury but a quality that decides between success and failure.", "Edsger W. Dijkstra"],
    ["An algorithm must be seen to be believed.", "Donald Knuth", "The Art of Computer Programming"],
    ["Instead of imagining that our main task is to instruct a computer what to do, let us concentrate rather on explaining to human beings what we want a computer to do.", "Donald Knuth", "Literate Programming"],
    ["Science is what we understand well enough to explain to a computer. Art is everything else we do.", "Donald Knuth"],
    ["There are only two hard things in Computer Science: cache invalidation and naming things.", "Phil Karlton"],
    ["All problems in computer science can be solved by another level of indirection.", "David Wheeler"],
    ["Software gets slower faster than hardware gets faster.", "Niklaus Wirth", "A Plea for Lean Software"],
    ["Algorithms + Data Structures = Programs.", "Niklaus Wirth", "Algorithms + Data Structures = Programs"],
    ["Point of view is worth 80 IQ points.", "Alan Kay"],
    ["People who are really serious about software should make their own hardware.", "Alan Kay"],
    ["I invented the term object-oriented, and I can tell you I did not have C++ in mind.", "Alan Kay"],
    ["Any sufficiently advanced technology is indistinguishable from magic.", "Arthur C. Clarke", "Profiles of the Future"],
    ["UNIX was not designed to stop its users from doing stupid things, as that would also stop them from doing clever things.", "Doug Gwyn"],
    ["Write programs that do one thing and do it well. Write programs to work together. Write programs to handle text streams, because that is a universal interface.", "Doug McIlroy", "quoted in A Quarter Century of Unix"],
    ["Fancy algorithms are slow when n is small, and n is usually small.", "Rob Pike", "Notes on Programming in C"],
    ["Simplicity is complicated.", "Rob Pike"],
    ["Errors are values.", "Rob Pike", "Go Proverbs"],
    ["Don't communicate by sharing memory, share memory by communicating.", "Rob Pike", "Go Proverbs"],
    ["The bigger the interface, the weaker the abstraction.", "Rob Pike", "Go Proverbs"],
    ["Make the zero value useful.", "Rob Pike", "Go Proverbs"],
    ["Readability counts.", "Tim Peters", "The Zen of Python"],
    ["Simple is better than complex.", "Tim Peters", "The Zen of Python"],
    ["Flat is better than nested.", "Tim Peters", "The Zen of Python"],
    ["If the implementation is hard to explain, it's a bad idea.", "Tim Peters", "The Zen of Python"],
    ["Now is better than never.", "Tim Peters", "The Zen of Python"],
    ["Code is read much more often than it is written.", "Guido van Rossum", "PEP 8"],
    ["There's more than one way to do it.", "Larry Wall"],
    ["The three chief virtues of a programmer are: Laziness, Impatience and Hubris.", "Larry Wall", "Programming Perl"],
    ["It's harder to read code than to write it.", "Joel Spolsky", "Things You Should Never Do"],
    ["The single worst strategic mistake that any software company can make: they decided to rewrite the code from scratch.", "Joel Spolsky", "Things You Should Never Do"],
    ["All non-trivial abstractions, to some degree, are leaky.", "Joel Spolsky", "The Law of Leaky Abstractions"],
    ["Theory and practice sometimes clash. And when that happens, theory loses. Every single time.", "Linus Torvalds"],
    ["Release early. Release often. And listen to your customers.", "Eric S. Raymond", "The Cathedral and the Bazaar"],
    ["Smart data structures and dumb code works a lot better than the other way around.", "Eric S. Raymond", "The Cathedral and the Bazaar"],
    ["Good programmers know what to write. Great ones know what to rewrite (and reuse).", "Eric S. Raymond", "The Cathedral and the Bazaar"],
    ["Clarity is better than cleverness.", "Eric S. Raymond", "The Art of Unix Programming"],
    ["In interface design, always do the least surprising thing.", "Eric S. Raymond", "The Art of Unix Programming"],
    ["When a program has nothing surprising to say, it should say nothing.", "Eric S. Raymond", "The Art of Unix Programming"],
    ["Prototype before polishing. Get it working before you optimize it.", "Eric S. Raymond", "The Art of Unix Programming"],
    ["Truth can only be found in one place: the code.", "Robert C. Martin", "Clean Code"],
    ["The only way to go fast, is to go well.", "Robert C. Martin"],
    ["The first rule of functions is that they should be small. The second rule of functions is that they should be smaller than that.", "Robert C. Martin", "Clean Code"],
    ["A long descriptive name is better than a short enigmatic name.", "Robert C. Martin", "Clean Code"],
    ["Always use version control.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Test your software, or your users will.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Don't assume it. Prove it.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Crash early.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Invest regularly in your knowledge portfolio.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Refactor early, refactor often.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Don't gather requirements. Dig for them.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Prototype to learn.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Program close to the problem domain.", "Andrew Hunt and David Thomas", "The Pragmatic Programmer"],
    ["Before you start refactoring, make sure you have a solid suite of tests. These tests must be self-checking.", "Martin Fowler", "Refactoring"],
    ["When you have to add a feature to a program but the code is not structured in a convenient way, first refactor the program to make it easy to add the feature, then add the feature.", "Martin Fowler", "Refactoring"],
    ["Comments are often used as a deodorant.", "Martin Fowler and Kent Beck", "Refactoring"],
    ["If it hurts, do it more often.", "Martin Fowler", "Frequency Reduces Difficulty"],
    ["Duplication is far cheaper than the wrong abstraction.", "Sandi Metz", "The Wrong Abstraction"],
    ["A language that doesn't affect the way you think about programming is not worth knowing.", "Alan Perlis", "Epigrams on Programming"],
    ["Simplicity does not precede complexity, but follows it.", "Alan Perlis", "Epigrams on Programming"],
    ["It is easier to write an incorrect program than understand a correct one.", "Alan Perlis", "Epigrams on Programming"],
    ["Fools ignore complexity. Pragmatists suffer it. Some can avoid it. Geniuses remove it.", "Alan Perlis", "Epigrams on Programming"],
    ["If you have a procedure with ten parameters, you probably missed some.", "Alan Perlis", "Epigrams on Programming"],
    ["There are two ways to write error-free programs; only the third one works.", "Alan Perlis", "Epigrams on Programming"],
    ["Every program has (at least) two purposes: the one for which it was written, and another for which it wasn't.", "Alan Perlis", "Epigrams on Programming"],
    ["Optimization hinders evolution.", "Alan Perlis", "Epigrams on Programming"],
    ["I think that it's extraordinarily important that we in computer science keep fun in computing.", "Alan Perlis", "dedication in Structure and Interpretation of Computer Programs"],
    ["The hardest single part of building a software system is deciding precisely what to build.", "Fred Brooks", "No Silver Bullet"],
    ["The bearing of a child takes nine months, no matter how many women are assigned.", "Fred Brooks", "The Mythical Man-Month"],
    ["Conceptual integrity is the most important consideration in system design.", "Fred Brooks", "The Mythical Man-Month"],
    ["How does a project get to be a year late? One day at a time.", "Fred Brooks", "The Mythical Man-Month"],
    ["Within C++, there is a much smaller and cleaner language struggling to get out.", "Bjarne Stroustrup", "The Design and Evolution of C++"],
    ["There are only two kinds of languages: the ones people complain about and the ones nobody uses.", "Bjarne Stroustrup"],
    ["Ruby is designed to make programmers happy.", "Yukihiro Matsumoto"],
    ["Write tests. Not too many. Mostly integration.", "Guillermo Rauch"],
    ["Make illegal states unrepresentable.", "Yaron Minsky"],
    ["Parse, don't validate.", "Alexis King", "Parse, Don't Validate"],
    ["Choose boring technology.", "Dan McKinley", "Choose Boring Technology"],
    ["You aren't gonna need it.", "Ron Jeffries"],
    ["Do the simplest thing that could possibly work.", "Ward Cunningham"],
    ["Shipping first time code is like going into debt. A little debt speeds development so long as it is paid back promptly with a rewrite.", "Ward Cunningham", "The WyCash Portfolio Management System"],
    ["If you think good architecture is expensive, try bad architecture.", "Brian Foote and Joseph Yoder", "Big Ball of Mud"],
    ["Architecture represents the significant design decisions that shape a system, where significant is measured by cost of change.", "Grady Booch"],
    ["A distributed system is one in which the failure of a computer you didn't even know existed can render your own computer unusable.", "Leslie Lamport"],
    ["If you're thinking without writing, you only think you're thinking.", "Leslie Lamport"],
    ["Be conservative in what you do, be liberal in what you accept from others.", "Jon Postel", "RFC 793"],
    ["We reject kings, presidents and voting. We believe in rough consensus and running code.", "David Clark"],
    ["When a measure becomes a target, it ceases to be a good measure.", "Marilyn Strathern", "stating Goodhart's law"],
    ["In software, the most beautiful code, the most beautiful functions, and the most beautiful programs are sometimes not there at all.", "Jon Bentley", "Beautiful Code"],
    ["Hope is not a strategy.", "Google SRE", "Site Reliability Engineering"],
    ["You build it, you run it.", "Werner Vogels"],
    ["Everything fails all the time.", "Werner Vogels"],
    ["Security is a process, not a product.", "Bruce Schneier"],
    ["Amateurs hack systems, people hack people.", "Bruce Schneier"],
    ["Anyone, from the most clueless amateur to the best cryptographer, can create an algorithm that he himself can't break.", "Bruce Schneier"],
    ["Focus is a matter of deciding what things you're not going to do.", "John Carmack"],
    ["The way to get startup ideas is not to try to think of startup ideas.", "Paul Graham", "How to Get Startup Ideas"],
    ["Startup = growth.", "Paul Graham", "Startup = Growth"],
    ["Be relentlessly resourceful.", "Paul Graham", "A Word to the Resourceful"],
    ["It's hard to do a really good job on anything you don't think about in the shower.", "Paul Graham", "The Top Idea in Your Mind"],
    ["Keep your identity small.", "Paul Graham", "Keep Your Identity Small"],
    ["Writing doesn't just communicate ideas; it generates them.", "Paul Graham", "Writing, Briefly"],
    ["Fall in love with the problem, not the solution.", "Uri Levine", "Fall in Love with the Problem, Not the Solution"],
    ["Done is better than perfect.", "Facebook office poster"],
    ["We are stubborn on vision. We are flexible on details.", "Jeff Bezos"],
    ["It's always Day 1.", "Jeff Bezos", "letter to shareholders"],
    ["Disagree and commit.", "Jeff Bezos", "2016 letter to shareholders"],
    ["Most decisions should probably be made with somewhere around 70% of the information you wish you had.", "Jeff Bezos", "2016 letter to shareholders"],
    ["If you double the number of experiments you do per year you're going to double your inventiveness.", "Jeff Bezos"],
    ["Your margin is my opportunity.", "Jeff Bezos"],
    ["Success breeds complacency. Complacency breeds failure. Only the paranoid survive.", "Andy Grove", "Only the Paranoid Survive"],
    ["Design is not just what it looks like and feels like. Design is how it works.", "Steve Jobs"],
    ["You've got to start with the customer experience and work back toward the technology.", "Steve Jobs"],
    ["People don't know what they want until you show it to them.", "Steve Jobs"],
    ["You can't connect the dots looking forward; you can only connect them looking backwards.", "Steve Jobs", "Stanford commencement address"],
    ["The minimum viable product is that version of a new product which allows a team to collect the maximum amount of validated learning about customers with the least effort.", "Eric Ries", "The Lean Startup"],
    ["It's not about ideas. It's about making ideas happen.", "Scott Belsky", "Making Ideas Happen"],
    ["Build something 100 people love, not something 1 million people kind of like.", "Brian Chesky"],
    ["There is nothing so useless as doing efficiently that which should not be done at all.", "Peter Drucker"],
    ["Efficiency is doing things right; effectiveness is doing the right things.", "Peter Drucker", "The Effective Executive"],
    ["All happy companies are different: each one earns a monopoly by solving a unique problem.", "Peter Thiel", "Zero to One"],
    ["Brilliant thinking is rare, but courage is in even shorter supply than genius.", "Peter Thiel", "Zero to One"],
    ["There are no silver bullets for this, only lead bullets.", "Ben Horowitz", "The Hard Thing About Hard Things"],
    ["Take care of the people, the products, and the profits, in that order.", "Ben Horowitz", "The Hard Thing About Hard Things"],
    ["A startup is a temporary organization designed to search for a repeatable and scalable business model.", "Steve Blank"],
    ["In a startup no facts exist inside the building, only opinions.", "Steve Blank"],
    ["The first principle is that you must not fool yourself, and you are the easiest person to fool.", "Richard Feynman", "Cargo Cult Science"],
    ["What I cannot create, I do not understand.", "Richard Feynman"],
    ["I learned very early the difference between knowing the name of something and knowing something.", "Richard Feynman"],
    ["Study hard what interests you the most in the most undisciplined, irreverent and original manner possible.", "Richard Feynman"],
  ];

  /** The same quote all day, a different one tomorrow. */
  // Stepping 23 at a time (the list length is not a multiple of 23) visits every
  // quote before repeating, and keeps neighbouring days on different shelves.
  function quoteOfTheDay() {
    const now = new Date();
    const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
    return QUOTES[(day * 23) % QUOTES.length];
  }

  /**
   * Once a day, a greeting before the work: a quote and the one thing worth
   * focusing on. Nothing here asks for anything; the questions
   * wait at the bottom of the feed, after the cards they are about.
   */
  function todayCard() {
    const t = state.coach && state.coach.today;
    if (!t) return "";
    const hour = new Date().getHours();
    const hello = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    // A sun by day, a moon once it is dark.
    const icon = hour < 5 || hour >= 18 ? "🌙" : hour < 12 ? "☀️" : "🌤️";
    const [quote, author, source] = quoteOfTheDay();
    const extras = [
      t.canRead && !t.readToday ? `<li><button class="link" data-action="readStart">Read one function you did not write</button> <span class="muted">· 3 min</span></li>` : "",
    ].filter(Boolean);
    return `<section class="today greeting" aria-label="Today">
      <div class="greet-head">
        <h3><span class="greet-icon" aria-hidden="true">${icon}</span>${hello}.</h3>
        <button class="icon" data-action="todayDone" aria-label="Hide until tomorrow" title="Hide until tomorrow">×</button>
      </div>
      <figure class="quote">
        <blockquote>${esc(quote)}</blockquote>
        <figcaption>${esc(author)}${source ? `, <cite>${esc(source)}</cite>` : ""}</figcaption>
      </figure>
      ${extras.length ? `<ul class="greet-links">${extras.join("")}</ul>` : ""}
    </section>`;
  }

  /**
   * "Check what you just saw": one question per idea from recent cards, at the
   * end of the feed, so it comes after the reading it is about.
   */
  function cardQuizBlock() {
    const since = Date.now() - 24 * 3600000;
    /** @type {Map<string, any>} */
    const ideas = new Map();
    for (const { c, lesson } of visibleCards()) {
      if (Date.parse(lesson.at) <= since || !c.hasQuiz || c.status === "locked" || ideas.has(c.conceptId)) continue;
      ideas.set(c.conceptId, c);
    }
    const picked = [...ideas.values()].slice(0, 5);
    if (!picked.length) return "";
    const sig = picked.map((c) => c.conceptId).join(",");
    const done = ui.cardQuizDone === `${new Date().toDateString()}|${sig}`;
    return `<section class="card-quiz" aria-label="Check what you just saw">
      <h3>${done ? "✓ Checked today" : "Check what you just saw"}</h3>
      <p class="muted">${
        done
          ? "Those ideas are in your review now, and come back when they are about to fade."
          : `${plural(picked.length, "question")}, one per idea in your recent cards. Recalling it now, while it is fresh, is what makes it stay.`
      }</p>
      <div class="chips">${picked.map((c) => `<span class="chip">${esc(c.emoji)} ${esc(c.title)}</span>`).join("")}</div>
      <div class="actions"><button class="${done ? "" : "primary"}" data-action="cardQuiz" data-ids="${esc(sig)}">${done ? "Ask me again" : "Quiz me"}</button></div>
    </section>`;
  }

  /* ---- reading code cold ---- */

  function readPage(/** @type {any} */ r) {
    const tag = r.result ? `<span class="tag verdict-${esc(r.result.verdict)}">${VERDICT[r.result.verdict]}</span>` : r.revealed ? `<span class="tag">Read</span>` : `<span class="tag new">Predict it</span>`;
    const head = `${pageHead("📖", `Read it cold: ${r.name}`, tag)}
      <div class="where">${fileLink(r.root, r.file, r.start)}</div>
      <pre class="signature"><code>${esc(r.signature)}</code></pre>`;
    if (!r.revealed) {
      const d = `${r.key}|guess`;
      return `<article class="card page read">${head}
        <div class="block first">
          <h4>From the name and signature alone: what does it do?</h4>
          <p class="muted">Say what goes in, what comes out, and anything it changes along the way. The body is hidden until you commit to a guess; reading code starts with guessing what it is for.</p>
          <form data-submit="readSubmit" data-key="${esc(r.key)}">
            <textarea data-draft="${esc(d)}" rows="3" placeholder="It takes… and returns… along the way it…" aria-label="Your prediction" maxlength="800">${esc(drafts[d] || "")}</textarea>
            <div class="actions">
              <button type="submit" class="primary">Show me the code</button>
              <button type="button" class="link" data-action="readSkip" data-key="${esc(r.key)}">Skip, just show me</button>
            </div>
          </form>
        </div></article>`;
    }
    const slot = `${r.key}|read`;
    const res = r.result;
    const judge = res
      ? `<div class="result ${res.verdict === "wrong" ? "miss" : "ok"}"><strong>${VERDICT[res.verdict]}</strong>${prose(res.feedback)}</div>
         <dl><dt>What it really does</dt><dd>${inline(res.summary)}</dd>${res.notice ? `<dt>Worth noticing</dt><dd>${inline(res.notice)}</dd>` : ""}</dl>
         <p class="by">Judged by ${esc(res.by)}</p>`
      : busy(slot)
      ? waiting(slot)
      : r.guess && !r.self
      ? `${problem(slot)}<p>Read the code against your prediction. Did it hold?
           <button class="link" data-action="readSelf" data-key="${esc(r.key)}" data-right="1">Mostly, yes</button>
           <button class="link" data-action="readSelf" data-key="${esc(r.key)}" data-right="0">No, it surprised me</button></p>`
      : r.self
      ? `<p class="muted">${r.self === "right" ? "Counted as read right." : "Counted. The surprises are where the learning is: what did the name hide?"}</p>`
      : "";
    return `<article class="card page read">${head}
      ${r.guess ? `<p><span class="muted">You predicted:</span> ${esc(r.guess)}</p>` : ""}
      <pre class="excerpt"><code>${esc(r.code)}</code></pre>
      ${judge}
      <div class="actions"><button data-action="readStart">Another one</button>
      <button class="link" data-action="openAt" data-root="${esc(r.root)}" data-file="${esc(r.file)}" data-line="${r.start}">Open it in the editor</button></div>
    </article>`;
  }

  /* ---- a major upgrade ---- */

  function upgradePage(/** @type {any} */ u) {
    const head = `${pageHead("⬆️", `${u.name}: ${u.from} → ${u.to}`, `<span class="tag risk">Major version</span>`)}
      <p class="hook">A major version is the maintainers telling you something changed in a way that can break code like yours, sometimes without any error.</p>
      <div class="where">${fileLink(u.root, u.file, null)}</div>`;
    if (!u.guessDone) {
      const d = `${u.key}|guess`;
      return `<article class="card page upgrade">${head}
        <div class="block first">
          <h4>Before you read: what might have changed that could break your code?</h4>
          <p class="muted">A guess in a few words: an API renamed, a default flipped, something removed. Guessing first makes the real list stick.</p>
          <form data-submit="upgradeGuess" data-key="${esc(u.key)}">
            <input type="text" data-draft="${esc(d)}" value="${esc(drafts[d] || "")}" placeholder="Probably…" aria-label="Your guess" maxlength="400">
            <div class="actions"><button type="submit" class="primary">Lock in my guess</button>
            <button type="button" class="link" data-action="upgradeSkip" data-key="${esc(u.key)}">Skip, just show me</button></div>
          </form>
        </div></article>`;
    }
    const slot = `${u.key}|lesson`;
    const l = u.lesson;
    const npm = `https://www.npmjs.com/package/${encodeURIComponent(u.name).replace("%40", "@").replace("%2F", "/")}?activeTab=versions`;
    const body = l
      ? `${u.guess ? `<div class="block"><p><span class="muted">You guessed:</span> ${esc(u.guess)}</p>${l.guessFeedback ? prose(l.guessFeedback) : ""}</div>` : ""}
         <div class="block mine"><h4>What changed</h4>${prose(l.summary)}</div>
         ${l.changes.length ? `<div class="block risks"><h4>What could touch your code</h4><ul>${l.changes.map((/** @type {any} */ c) => `<li><strong>${esc(c.title)}</strong><p>${inline(c.why)}</p>${c.file ? `<p>${fileLink(u.root, c.file, c.line)}</p>` : ""}</li>`).join("")}</ul></div>` : ""}
         ${l.checklist.length ? `<div class="block"><h4>Check before you trust it</h4><ol class="flow">${l.checklist.map((/** @type {string} */ c) => `<li>${inline(c)}</li>`).join("")}</ol></div>` : ""}
         ${u.conceptId ? (u.adopted ? `<p class="muted">Its question is on your review schedule.</p>` : `<div class="actions"><button class="primary" data-action="upgradeAdopt" data-key="${esc(u.key)}">Add a question to my reviews</button></div>`) : ""}
         <p class="by">Written by ${esc(l.by)}. Version details can be wrong; the changelog is the source of truth.</p>`
      : busy(slot)
      ? waiting(slot)
      : state.ai.label
      ? `<div class="actions"><button class="primary" data-action="upgradeLesson" data-key="${esc(u.key)}">What changed, for my code?</button></div>${problem(slot)}`
      : `<div class="block"><h4>Read the changelog</h4><p>Look for a "Breaking changes" or "Migration" section between ${esc(u.from)} and ${esc(u.to)}, then search your project for each thing it names. Run your tests and click through the screens that use it.</p></div>`;
    return `<article class="card page upgrade">${head}${body}
      <div class="more"><div class="more-list">
        ${/^[\w@/.-]+$/.test(u.name) ? `<button class="link" data-action="link" data-url="${esc(npm)}">Versions on npm</button>` : ""}
        <button class="link" data-action="copy" data-text="${esc(`We upgraded ${u.name} from ${u.from} to ${u.to}. What breaking changes affect this project, and where?`)}">Copy a question for your AI</button>
        <button class="link" data-action="dismissItem" data-key="${esc(u.key)}">Remove from the feed</button>
      </div></div>
    </article>`;
  }

  function pageHead(/** @type {string} */ emoji, /** @type {string} */ title, /** @type {string} */ tags) {
    return `<div class="card-head static"><span class="emoji" aria-hidden="true">${esc(emoji)}</span><span class="card-title">${esc(title)}</span><span class="tags">${tags}</span></div>`;
  }

  /* ---- a tool ---- */

  function toolPage(/** @type {any} */ t) {
    const spec = t.spec || { docs: "" };
    const tags = t.adopted ? `<span class="tag belt">${t.held} of ${t.terms.length} concepts held</span>` : `<span class="tag new">New tool</span>`;
    const seen = t.file ? `<div class="where">${fileLink(t.root, t.file, null)}</div>` : "";
    const head = `${pageHead(t.emoji, t.name, tags)}<p class="hook">${esc(t.job)}</p>${seen}`;

    // The tool's own concepts: each is an idea with a belt and a question.
    const concepts = t.terms
      .map((/** @type {any} */ x) => {
        const slot = `${t.key}|${x.id}`;
        const q = quizzes[slot];
        const belt = x.seen ? `<span class="tag belt belt-${esc(beltName(x.box))}">${esc(beltName(x.box))}</span>` : "";
        return `<li class="term">
          <div class="term-head"><button class="link term-open" data-action="idea" data-id="${esc(x.id)}" data-from="now">${esc(x.term)} ›</button>${belt}
            ${!q && !busy(slot) ? `<button class="link" data-action="termQuiz" data-slot="${esc(slot)}" data-id="${esc(x.id)}">Check me</button>` : ""}</div>
          ${t.adopted && !q ? "" : q ? "" : `<p>${inline(x.meaning)}</p>`}
          ${q ? quizBlock(q, "card", slot) : ""}
        </li>`;
      })
      .join("");
    const pct = t.terms.length ? Math.round((t.held / t.terms.length) * 100) : 0;
    const vocab = t.terms.length
      ? `<div class="block vocab">
          <h4>Its concepts (${t.terms.length})</h4>
          ${
            t.adopted
              ? `<p class="muted">On your review schedule. Conversant means every concept at green belt: ${t.held} of ${t.terms.length} so far.</p>
                 <progress max="100" value="${pct}" aria-label="${t.held} of ${t.terms.length} concepts held"></progress>`
              : `<p class="muted">Tap one to open it. Put them on review and each comes back in 10 minutes, then 1, 3, 7 and 16 days.</p>`
          }
          <ul class="terms">${concepts}</ul>
          ${t.adopted ? "" : `<div class="actions"><button class="primary" data-action="toolAdopt" data-key="${esc(t.key)}">Add these ${t.terms.length} concepts to my reviews</button></div>`}
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
      ? `<div class="tool-why">
           <div><strong>Why ${esc(t.name)} and not something else?</strong>
           <p class="muted">Write down the reason now, so you can still give it in six months.</p></div>
           <button data-action="toolDecision" data-key="${esc(t.key)}">Log the decision</button>
         </div>${problem(dSlot)}`
      : "";

    return `<article class="card page tool">${head}
      ${lessonBlock(t.key)}
      ${vocab}
      ${decision}
      ${toolFoot(t, spec)}
    </article>`;
  }

  /**
   * The links at the bottom of a tool page: full-width rows, each saying what
   * it does, which reads well in a narrow panel.
   */
  function toolFoot(/** @type {any} */ t, /** @type {any} */ spec) {
    const ask = `Walk me through how ${t.name} is set up in this project: where it is configured, what it sends and when, and how I can see it working.`;
    const I = {
      docs: '<path d="M9 3h4v4M13 3L7 9M11 9v4H3V5h4"/>',
      copy: '<rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10V4a1 1 0 0 1 1-1h6"/>',
      remove: '<path d="M4 4l8 8M12 4l-8 8"/>',
    };
    const rows = [
      spec.docs ? { k: "docs", label: `${t.name} docs`, hint: "Opens the official documentation", attrs: `data-action="link" data-url="${esc(spec.docs)}"` } : null,
      { k: "copy", label: "Copy a question for your AI", hint: "Paste it into your assistant to see how it is set up here", attrs: `data-action="copy" data-text="${esc(ask)}"` },
      t.inFeed ? { k: "remove", label: "Remove from the feed", hint: "It stays in the Grow tab", attrs: `data-action="dismissItem" data-key="${esc(t.key)}"`, quiet: true } : null,
    ].filter(Boolean);
    return `<div class="tf tf-list">${rows
      .map(
        (/** @type {any} */ x) =>
          `<button class="tf-row${x.quiet ? " quiet" : ""}" ${x.attrs}><svg viewBox="0 0 16 16" aria-hidden="true">${I[/** @type {keyof typeof I} */ (x.k)]}</svg><span><span class="tf-row-l">${esc(x.label)}</span><span class="tf-row-h">${esc(x.hint)}</span></span><span class="chev" aria-hidden="true">›</span></button>`,
      )
      .join("")}</div>`;
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
    const findings = (g.findings || [])
      .map((/** @type {any} */ f, /** @type {number} */ n) => {
        const shown = (g.shown || []).includes(n);
        const kept = (g.kept || []).includes(n);
        return `<li class="finding ${esc(f.kind)}${kept ? " kept" : ""}">
          <p><span class="tag ${f.kind === "security" ? "risk" : "cost"}">${f.kind === "security" ? "Security" : "Cost"}</span> ${fileLink(g.root, f.file, f.line)}</p>
          <pre><code>${esc(f.code)}</code></pre>
          ${
            shown
              ? `<p><strong>${esc(f.title)}.</strong> ${inline(f.why)}</p><p><span class="muted">Fix:</span> ${inline(f.fix)}</p>
                 ${kept ? `<p class="muted">Marked as intended.</p>` : `<button class="link" data-action="findingKeep" data-key="${esc(g.key)}" data-index="${n}">It is intended</button>`}`
              : `<p class="ask-first">${esc(f.ask)}</p>
                 <button data-action="findingReveal" data-key="${esc(g.key)}" data-index="${n}">Think about it, then show me</button>`
          }
        </li>`;
      })
      .join("");
    const findingsBlock = findings
      ? `<div class="block findings"><h4>What these lines could cost you</h4>
          <p class="muted">Look at each line before you read the answer: spotting it yourself is the habit that matters at the next commit.</p>
          <ul>${findings}</ul></div>`
      : "";
    return `<article class="card page gate">
      ${pageHead("🚦", "Before you commit", `<span class="tag">${g.lines} lines</span>`)}
      ${findingsBlock}
      ${g.noQuestion && findings ? "" : `<p class="hook">One question to check you know what you are about to commit. About thirty seconds. Nothing is blocked.</p>`}
      ${g.noQuestion && findings ? "" : `<ul class="files">${files}${g.files.length > 6 ? `<li class="muted">and ${g.files.length - 6} more</li>` : ""}</ul>`}
      ${g.committed && !q ? `<p class="muted">Already committed. The question still works as practice.</p>` : ""}
      ${g.noQuestion && !findings ? `<p class="muted">No question for this one: nothing in it matches an idea Miyagi knows, and no AI is set up to write one.</p>` : ""}
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
    if (g.interview) return `<section class="grow">${note}${interviewPage(g.interview)}</section>`;
    return `<section class="grow">${note}
      ${trendBlock(g)}
      ${mapBlock(g)}
      ${toolsBlock(g)}
      ${decisionsBlock(g)}
      ${incidentBlock(g)}
      ${practiceBlock(g)}
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

  /** Reading code cold, and the mock interview: practice you start yourself. */
  function practiceBlock(/** @type {any} */ g) {
    const last = (g.interviews || [])[0];
    return `<div class="block practice-block"><h4>Practise</h4>
      <div class="practice-row">
        <div><strong>Read a function cold</strong><p class="muted">Name and signature first, body after your guess. ${g.reads ? `${plural(g.reads, "function")} read so far.` : ""}</p></div>
        <button data-action="readStart">Start</button>
      </div>
      <div class="practice-row">
        <div><strong>Mock interview</strong><p class="muted">Four questions from what you hold, a tool you use and your own story. About ten minutes, typed answers, a soft timer.${last ? ` Last time: ${last.right} of ${last.asked}.` : ""}</p></div>
        <button data-action="interviewStart"${busy("grow|interviewQ") ? " disabled" : ""}>Start</button>
      </div>
    </div>`;
  }

  function interviewPage(/** @type {any} */ iv) {
    const n = iv.questions.length;
    if (iv.done) {
      const right = iv.answers.filter((/** @type {any} */ a) => a && a.verdict === "right").length;
      const rows = iv.questions
        .map((/** @type {any} */ q, /** @type {number} */ i) => {
          const a = iv.answers[i] || {};
          const tag = a.verdict ? `<span class="tag verdict-${esc(a.verdict)}">${VERDICT[a.verdict]}</span>` : `<span class="tag">${a.skipped ? "Skipped" : "Not judged"}</span>`;
          return `<li><p>${tag} <span class="muted">${esc(q.about)} · ${a.seconds ? `${Math.round(a.seconds / 60 * 10) / 10} min` : ""}</span></p><p>${inline(q.prompt)}</p>${a.feedback ? prose(a.feedback) : ""}</li>`;
        })
        .join("");
      const weakest = iv.questions.find((/** @type {any} */ _q, /** @type {number} */ i) => !iv.answers[i] || iv.answers[i].verdict !== "right");
      return `<div class="block interview">
        <h4>Mock interview: ${right} of ${n}</h4>
        <p>${right === n ? "Every answer would have landed." : weakest ? `Work on: <strong>${esc(weakest.about)}</strong>. Ideas that did not land are back in your reviews today.` : ""}</p>
        <ul class="log">${rows}</ul>
        <div class="actions"><button class="primary" data-action="interviewStart">Another interview</button><button class="link" data-action="interviewClose">Back to Grow</button></div>
      </div>`;
    }
    const q = iv.questions[iv.at];
    const a = iv.answers[iv.at];
    const slot = "grow|interview";
    const kind = { idea: "Technical", tool: "Your stack", story: "Behavioural" }[q.kind] || "";
    const answered = a && (a.verdict || a.skipped);
    return `<div class="block interview">
      <p class="interview-bar"><span class="muted">Question ${iv.at + 1} of ${n} · ${kind}</span>
        ${answered ? "" : `<span class="timer" data-timer="${iv.shownAt}" data-soft="${iv.seconds}">0:00</span>`}</p>
      ${q.prompt ? `<h4 class="interview-q">${inline(q.prompt)}</h4>` : waiting("grow|interviewQ") || `<p class="muted">Preparing the question…</p>`}
      ${
        answered
          ? `${a.text ? `<p class="asked">${esc(a.text)}</p>` : ""}
             ${a.verdict ? `<div class="result ${a.verdict === "wrong" ? "miss" : "ok"}"><strong>${VERDICT[a.verdict]}</strong>${prose(a.feedback || "")}<p class="by">Judged by ${esc(a.by || "")}</p></div>` : `<p class="muted">Skipped.</p>`}
             <div class="actions"><button class="primary" data-action="interviewNext">${iv.at + 1 < n ? "Next question" : "See how it went"}</button></div>`
          : busy(slot)
          ? `<p class="asked">${esc(drafts["grow|interview.sent"] || "")}</p>${waiting(slot)}`
          : q.prompt
          ? `<p class="muted">${q.kind === "story" ? "Situation, what you did (not the AI), the result, what you learned." : "Answer as you would out loud: say what it is, then why it matters, with an example."}</p>
             <form data-submit="interviewAnswer" data-key="grow">
               <textarea data-draft="grow|interview" rows="6" placeholder="I would say…" aria-label="Your answer" maxlength="2000">${esc(drafts["grow|interview"] || "")}</textarea>
               <div class="actions"><button type="submit" class="primary">${state.ai.label ? "Submit answer" : "Done with this one"}</button>
               <button type="button" class="link" data-action="interviewSkip">Skip</button></div>
             </form>${!state.ai.label ? `<p class="muted">No AI is set up, so answers are not judged; the practice of answering out loud is still the point.</p>` : ""}`
          : ""
      }
      ${problem(slot)}
      <p class="tail"><button class="link" data-action="interviewClose">End the interview</button></p>
    </div>`;
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
      const setOver = !inCheck && (review.setAnswered >= review.setSize || (!due && !review.cardQuiz));
      const label = inCheck ? (inCheck.asked < inCheck.of ? "Next question" : "See the result") : setOver ? "Finish" : "Next question";
      const next = review.answer
        ? `<div class="actions"><button class="primary" data-action="${setOver ? "finishSet" : "nextReview"}">${label}</button></div>`
        : "";
      const n = Math.min(review.setAnswered + (review.answer ? 0 : 1), review.setSize);
      const right = inCheck ? `Unaided check: ${inCheck.asked} of ${inCheck.of}` : review.cardQuiz ? `From your cards: ${n} of ${review.setSize}` : `${n} of ${review.setSize}`;
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
    if (review.cardQuiz && review.cardQuizEnded && !review.quiz) {
      return `
        <div class="empty">
          <h2>Checked: ${plural(review.setAnswered, "idea")} from your cards</h2>
          <p>They are in your review now, and come back just before you would forget them.</p>
          <div class="actions center">
            <button class="primary" data-action="tab" data-tab="now">Back to the feed</button>
          </div>
        </div>`;
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
      const back = pageBar("closeIdea", ui.ideaFrom === "review" ? "Back to review" : ui.ideaFrom === "now" ? "Back" : "All ideas");
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
    const cardQuiz = fresh ? false : review.cardQuiz;
    review = { asked: true, quiz: null, answer: null, picked: -1, cleared: review.cleared, setSize: cardQuiz ? review.setSize : setSize, setAnswered, setDone: false, cardQuiz };
    send({ type: "review", fresh });
    render();
  }

  function startCardQuiz(/** @type {string} */ ids) {
    const list = ids.split(",").filter(Boolean);
    if (!list.length) return;
    ui.tab = "review";
    ui.cardQuizSig = `${new Date().toDateString()}|${ids}`;
    checked = null;
    remember();
    review = { asked: true, quiz: null, answer: null, picked: -1, cleared: 0, setSize: list.length, setAnswered: 0, setDone: false, cardQuiz: true };
    send({ type: "cardQuiz", ids: list });
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
      case "genericLesson":
        ui.generic[key] = !ui.generic[key];
        remember();
        return render();
      case "closeCard":
        ui.cardKey = null;
        remember();
        render();
        return restoreScroll("now");
      case "finishSet":
        if (review.cardQuiz) {
          review = Object.assign({}, review, { quiz: null, answer: null, cardQuizEnded: true });
          ui.cardQuizDone = ui.cardQuizSig;
          remember();
          return render();
        }
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
      case "cardQuiz":
        return startCardQuiz(d.ids || "");
      case "nextReview":
        return startReview(false);
      case "idea":
        return openIdea(d.id || "", d.from || "dojo");
      case "closeIdea":
        ui.idea = null;
        if (ui.ideaFrom === "now") {
          // Opened from a tool's page: go back to it.
          ui.tab = "now";
          remember();
          return render();
        }
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
      case "todayDone":
      case "readStart":
      case "interviewStart":
      case "interviewSkip":
      case "interviewNext":
      case "interviewClose":
        return send({ type: d.action });
      case "readSkip":
      case "upgradeLesson":
      case "upgradeAdopt":
        return send({ type: d.action, key });
      case "upgradeSkip":
        return send({ type: "upgradeGuess", key, text: "" });
      case "readSelf":
        return send({ type: "readSelf", key, right: d.right === "1" });
      case "findingReveal":
      case "findingKeep":
        return send({ type: d.action, key, index: Number(d.index) });
      case "openSkill":
        ui.tab = "grow";
        ui.skill = d.id;
        ui.cardKey = null;
        remember();
        send({ type: "grow" });
        return render();
      case "hookShow":
        hookSkip.add(key);
        return render();
      case "lessonTab":
        ui.lessonTab[key] = d.tab;
        remember();
        return render();
      case "lessonDepth":
        ui.lessonDepth[key] = d.depth;
        remember();
        return render();
      case "lessonPick": {
        const id = d.id || "";
        if (lessonPicks[id] !== undefined) return;
        lessonPicks[id] = Number(d.index);
        send({ type: "lessonMove" });
        return render();
      }
      case "lessonDone":
        lessonDone[d.id || ""] = true;
        send({ type: "lessonMove" });
        return render();
      case "lessonNext": {
        const i = Number(d.index);
        // Sections stay open; this only moves on to the next one (opening it if it was closed).
        ui.sections[`${key}|L${i + 1}`] = true;
        remember();
        render();
        const next = app.querySelector(`[data-section="${CSS.escape(`${key}|L${i + 1}`)}"]`);
        if (next) next.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
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
      case "readSubmit":
        return send({ type: "readSubmit", key, text: take(`${key}|guess`) });
      case "upgradeGuess":
        return send({ type: "upgradeGuess", key, text: take(`${key}|guess`) });
      case "interviewAnswer": {
        const text = take("grow|interview");
        if (!text) return;
        drafts["grow|interview.sent"] = text;
        return send({ type: "interviewAnswer", text });
      }
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
        if (!m.quiz && review.cardQuiz) {
          review.cardQuizEnded = true;
          ui.cardQuizDone = ui.cardQuizSig;
          remember();
        }
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
      case "lesson":
        // The built-in lesson arrives first; one written by the learner's AI replaces it.
        if (m.lesson && (!lessons[`${m.key}|${m.depth}`] || m.lesson.by || !lessons[`${m.key}|${m.depth}`].by)) lessons[`${m.key}|${m.depth}`] = m.lesson;
        break;
      case "facts":
        facts = { byId: m.facts || {}, general: m.general || [] };
        break;
      case "hookDone":
        hookDone.add(m.key);
        break;
      case "growNote":
        growNote = m.text || "";
        break;
      case "decisionProblem":
        growNote = m.problem;
        ui.decisionForm = true;
        break;
    }
    render();
  });

  // The interview's soft timer: only its own text changes, so typing is never interrupted.
  setInterval(() => {
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (app.querySelectorAll("[data-timer]"))) {
      const secs = Math.max(0, Math.floor((Date.now() - Number(el.dataset.timer)) / 1000));
      el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      el.classList.toggle("over", secs > Number(el.dataset.soft || 150));
      el.title = secs > Number(el.dataset.soft || 150) ? "Past the suggested time. Finish your thought; nothing is cut off." : "Time on this question";
    }
  }, 1000);

  if (!ui.sections) ui.sections = {};
  if (!ui.lessonDepth) ui.lessonDepth = {};
  if (!ui.lessonTab) ui.lessonTab = {};
  if (!Array.isArray(ui.factsSeen)) ui.factsSeen = [];
  if (!ui.altOpen) ui.altOpen = {};
  if (!ui.termRevealed) ui.termRevealed = {};
  if (!ui.scroll) ui.scroll = {};
  render();
  send({ type: "ready" });
  if (ui.tab === "dojo") send({ type: "dojo" });
  if (ui.tab === "grow") send({ type: "grow" });
  if (ui.tab === "dojo" && ui.idea) send({ type: "idea", id: ui.idea });
})();
