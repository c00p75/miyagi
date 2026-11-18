// @ts-check
/*
 * The panel's renderer. It holds no teaching logic: the extension host decides
 * what is taught and how answers are graded, and this file draws it.
 *
 * Everything is rendered from data through `esc`, and the page's CSP allows no
 * inline script or style, so text from a model or a source file can only ever
 * arrive as text.
 */
(function () {
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));

  /** @type {any} */
  let state = null;
  const ui = Object.assign({ tab: "now", open: {} }, vscode.getState() || {});
  /** key -> { quiz, answer, picked } for card questions */
  const cardQuiz = {};
  /** key -> error string from the last explain attempt */
  const explainError = {};
  /** key -> provider label while a request is in flight */
  const explaining = {};
  let review = { asked: false, quiz: null, answer: null, picked: -1, cleared: 0 };
  /** @type {{rows: any[], belts: string[]} | null} */
  let dojo = null;

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
    const parts = String(text).split(/```[a-zA-Z0-9]*\n?/);
    parts.forEach((part, i) => {
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

  /* ---- pieces ---------------------------------------------------- */

  function header() {
    const s = state.status;
    const depths = ["Junior", "Mid", "Senior"]
      .map((d) => `<option value="${d}"${d === s.depth ? " selected" : ""}>${d}</option>`)
      .join("");
    const streak = s.dayStreak > 1 ? ` · ${s.dayStreak}-day streak` : "";
    return `
      <header class="top">
        <div class="who">
          <span class="level">Level ${s.level}</span>
          <span class="rank">${esc(s.title)}</span>
          <label class="depth">
            <span class="sr">Explanation depth</span>
            <select data-change="depth" title="How deep explanations go">${depths}</select>
          </label>
        </div>
        <progress max="100" value="${s.intoLevel}" aria-label="Progress to next level"></progress>
        <div class="meta">${s.xp} XP${streak} · ${s.discovered} of ${s.concepts} ideas found</div>
      </header>`;
  }

  function tabs() {
    const due = state.status.dueQuestions;
    const tab = (/** @type {string} */ id, /** @type {string} */ label, count = 0) => `
      <button role="tab" class="tab${ui.tab === id ? " on" : ""}" aria-selected="${ui.tab === id}" data-action="tab" data-tab="${id}">
        ${label}${count ? `<span class="count">${count}</span>` : ""}
      </button>`;
    return `<nav class="tabs" role="tablist">${tab("now", "Now")}${tab("review", "Review", due)}${tab("dojo", "Dojo")}</nav>`;
  }

  function quizBlock(/** @type {any} */ entry, /** @type {string} */ scope, /** @type {string} */ key) {
    const { quiz, answer, picked } = entry;
    const letters = "ABCDEFGH";
    const choices = quiz.choices
      .map((/** @type {string} */ choice, /** @type {number} */ i) => {
        let cls = "choice";
        if (answer) {
          if (i === answer.answerIndex) cls += " right";
          else if (i === answer.chosenIndex) cls += " wrong";
        } else if (i === picked) cls += " pending";
        return `<button class="${cls}" data-action="answer" data-scope="${scope}" data-key="${esc(key)}" data-index="${i}"${answer || picked >= 0 ? " disabled" : ""}>
          <span class="letter">${letters[i]}</span><span>${inline(choice)}</span></button>`;
      })
      .join("");
    let result = "";
    if (answer) {
      const again = answer.nextDueAt ? ` · back in ${until(answer.nextDueAt)}` : "";
      const extras = [
        answer.leveledUp ? `Level up: ${esc(answer.title)}` : "",
        ...(answer.newBadges || []).map((/** @type {string} */ b) => `Badge: ${esc(b)}`),
      ].filter(Boolean);
      result = `
        <div class="result ${answer.correct ? "ok" : "miss"}">
          <strong>${answer.correct ? "Correct" : "Not quite"}</strong>
          <span class="muted">+${answer.xpAwarded} XP${again}${answer.correct ? ` · ${esc(answer.belt)} belt` : ""}</span>
          <p>${inline(answer.explanation)}</p>
          ${extras.map((e) => `<p class="extra">${e}</p>`).join("")}
        </div>`;
    }
    return `<div class="quiz"><p class="question">${inline(quiz.question)}</p><div class="choices">${choices}</div>${result}</div>`;
  }

  function card(/** @type {any} */ c, /** @type {boolean} */ openByDefault) {
    const isOpen = ui.open[c.key] ?? openByDefault;
    const tag =
      c.status === "new"
        ? `<span class="tag new">New</span>`
        : `<span class="tag belt belt-${esc(c.belt)}">${esc(c.belt)} belt</span>`;
    const head = `
      <button class="card-head" data-action="toggle" data-key="${esc(c.key)}" aria-expanded="${isOpen}">
        <span class="emoji" aria-hidden="true">${esc(c.emoji)}</span>
        <span class="card-title">${esc(c.title)}</span>
        ${tag}
      </button>
      <p class="hook">${inline(c.hook)}</p>`;
    if (!isOpen) return `<article class="card closed">${head}</article>`;

    const others = c.otherFiles > 0 ? `<span class="muted"> and ${plural(c.otherFiles, "other file")}</span>` : "";
    const evidence = c.evidence ? `<code class="evidence">${esc(c.evidence)}</code>` : "";
    const explanation = state.explanations[c.key];
    const busy = explaining[c.key];
    const error = explainError[c.key];
    let mine = "";
    if (explanation) {
      mine = `<div class="mine"><h4>In your code</h4>${prose(explanation.text)}<p class="by">Written by ${esc(explanation.by)}</p></div>`;
    } else if (busy) {
      mine = `<div class="mine busy"><span class="spinner" aria-hidden="true"></span>Asking ${esc(busy)}…</div>`;
    } else if (error) {
      mine = `<div class="mine error"><p>${esc(error)}</p><button class="link" data-action="command" data-id="miyagi.chooseAi">Choose an AI</button></div>`;
    }

    const quiz = cardQuiz[c.key];
    const actions = [
      !explanation && !busy
        ? `<button class="primary" data-action="explain" data-key="${esc(c.key)}"${state.ai.label ? "" : ` title="${esc(state.ai.reason || "")}"`}>Explain in my code</button>`
        : "",
      c.hasQuiz && !quiz ? `<button data-action="quiz" data-key="${esc(c.key)}">Check yourself</button>` : "",
      `<button data-action="copy" data-text="${esc(c.askTheAi)}" title="${esc(c.askTheAi)}">Copy a question for your AI</button>`,
      `<button class="link" data-action="link" data-url="${esc(c.docs.url)}">${esc(c.docs.label)}</button>`,
    ].join("");

    return `
      <article class="card">
        ${head}
        <div class="where">
          <button class="link file" data-action="openFile" data-key="${esc(c.key)}" title="Open this file">${esc(c.file)}</button>${others}
          ${evidence}
        </div>
        <dl>
          <dt>What it is</dt><dd>${inline(c.what)}</dd>
          <dt>Know this</dt><dd>${inline(c.lens[state.status.depth] || c.lens.Junior)}</dd>
          <dt>How it bites</dt><dd>${inline(c.pitfall)}</dd>
        </dl>
        ${mine}
        ${quiz ? quizBlock(quiz, "card", c.key) : ""}
        <div class="actions">${actions}</div>
      </article>`;
  }

  function chips(/** @type {string} */ label, /** @type {any[]} */ list) {
    if (!list.length) return "";
    return `<p class="chips"><span class="muted">${label}</span> ${list
      .map((c) => `<span class="chip">${esc(c.emoji)} ${esc(c.title)}</span>`)
      .join("")}</p>`;
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
    // Only shown when there is something left to turn on.
    const capture = state.capture.on.length
      ? `<p>Capturing commands from ${state.capture.on.map(esc).join(" and ")}.</p>`
      : state.capture.available.length
      ? `<p>Commands run by ${state.capture.available.map(esc).join(" and ")} are not captured yet. <button class="link" data-action="command" data-id="miyagi.setup">Set up for me</button></p>`
      : "";
    const repos = state.repos.length
      ? state.watching
        ? `Watching ${state.repos.map(esc).join(", ")}.`
        : "Watching is turned off in settings."
      : "No git repository is open, so there is nothing to watch.";
    return `
      <footer>
        <p>${ai} <button class="link" data-action="command" data-id="miyagi.chooseAi">Change</button></p>
        ${capture}
        <p>${repos}</p>
      </footer>`;
  }

  function nowTab() {
    const lessons = state.lessons;
    let body;
    if (!lessons.length) {
      body = `
        <div class="empty">
          <h2>Nothing to teach yet</h2>
          <p>When your assistant writes code that relies on an idea worth understanding, a card appears here. Your assistant is not told and is not slowed down.</p>
          <button class="primary" data-action="command" data-id="miyagi.explainChanges">Teach me my uncommitted changes</button>
        </div>`;
    } else {
      body = lessons
        .map((/** @type {any} */ lesson, /** @type {number} */ i) => {
          const found = lesson.discovered
            ? `<span class="found">${plural(lesson.discovered, "new idea")} · +${lesson.xpAwarded} XP</span>`
            : "";
          return `
          <section class="lesson">
            <h3><span>From <strong>${esc(lesson.source)}</strong></span><span class="muted">${esc(clock(lesson.at))}</span></h3>
            ${found}
            ${lesson.cards.map((/** @type {any} */ c) => card(c, i === 0)).join("")}
            ${chips("Also in there, for next time:", lesson.later)}
            ${chips("Already yours:", lesson.solid)}
          </section>`;
        })
        .join("");
      body += `<p class="tail"><button class="link" data-action="command" data-id="miyagi.clearFeed">Clear the feed</button></p>`;
    }
    return `${body}${commands()}${footer()}`;
  }

  function reviewTab() {
    const s = state.status;
    if (review.quiz) {
      const next = review.answer
        ? `<div class="actions"><button class="primary" data-action="nextReview">${s.dueQuestions ? "Next question" : "Finish"}</button></div>`
        : "";
      return `
        <section class="review">
          <h3><span>${inline(review.quiz.about)}</span><span class="muted">${plural(s.dueQuestions, "question")} due</span></h3>
          ${quizBlock(review, "review", "")}
          ${next}
        </section>`;
    }
    const commandsDue = s.dueCommands
      ? `<p class="muted">${plural(s.dueCommands, "terminal drill")} also due. Those run in the Miyagi MCP tutor (<code>review_due_items</code>).</p>`
      : "";
    if (review.asked && !s.dueQuestions) {
      return `
        <div class="empty">
          <h2>${review.cleared ? `${plural(review.cleared, "question")} cleared` : "Nothing is due"}</h2>
          <p>Questions come back after 10 minutes, then 1, 3, 7, 16 and 35 days. Answering one after a longer gap is what moves its belt up.</p>
          ${commandsDue}
        </div>`;
    }
    return `
      <div class="empty">
        <h2>${s.dueQuestions ? `${plural(s.dueQuestions, "question")} due` : "Nothing is due"}</h2>
        <p>Each idea you were shown left one question behind. Answering it from memory, later, is the part that makes it stick.</p>
        ${s.dueQuestions ? `<button class="primary" data-action="nextReview">Start review</button>` : ""}
        ${commandsDue}
      </div>`;
  }

  function dojoTab() {
    if (!dojo) return `<div class="empty"><p class="muted">Loading…</p></div>`;
    const seen = dojo.rows.filter((r) => r.seen);
    const locked = dojo.rows.length - seen.length;
    const rows = seen
      .map((r) => {
        const dots = dojo.belts.map((_, i) => (i <= r.box ? "●" : "○")).join("");
        return `<tr>
          <td><span aria-hidden="true">${esc(r.emoji)}</span> ${esc(r.title)}</td>
          <td><span class="tag belt belt-${esc(r.belt)}">${esc(r.belt)}</span></td>
          <td class="dots" aria-hidden="true">${dots}</td>
        </tr>`;
      })
      .join("");
    return `
      <section class="dojo">
        <h3><span>${seen.length} of ${dojo.rows.length} ideas found</span></h3>
        ${seen.length ? `<table><tbody>${rows}</tbody></table>` : ""}
        ${locked ? `<p class="muted">${locked} still locked. An idea unlocks when your assistant writes code that uses it, so the only way to find them is to build something.</p>` : ""}
        <p class="muted">A belt moves up one colour each time you answer its question after a longer gap, and drops when you miss. It measures what you can recall, not how long the panel was open.</p>
      </section>`;
  }

  function render() {
    if (!state) {
      app.innerHTML = `<div class="empty"><p class="muted">Loading…</p></div>`;
      return;
    }
    const body = ui.tab === "review" ? reviewTab() : ui.tab === "dojo" ? dojoTab() : nowTab();
    app.innerHTML = `${header()}${tabs()}<main role="tabpanel">${body}</main>`;
  }

  function setTab(/** @type {string} */ tab) {
    ui.tab = tab;
    remember();
    if (tab === "dojo") send({ type: "dojo" });
    render();
  }

  /* ---- input ----------------------------------------------------- */

  app.addEventListener("click", (event) => {
    const el = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest("[data-action]")
    );
    if (!el) return;
    const d = el.dataset;
    switch (d.action) {
      case "tab":
        return setTab(d.tab || "now");
      case "toggle": {
        const expanded = el.getAttribute("aria-expanded") === "true";
        ui.open[d.key || ""] = !expanded;
        remember();
        return render();
      }
      case "openFile":
        return send({ type: "openFile", key: d.key });
      case "explain":
        delete explainError[d.key || ""];
        return send({ type: "explain", key: d.key });
      case "quiz":
        return send({ type: "quiz", key: d.key });
      case "answer": {
        const index = Number(d.index);
        const entry = d.scope === "review" ? review : cardQuiz[d.key || ""];
        if (!entry || !entry.quiz || entry.answer) return;
        entry.picked = index;
        send({ type: "answer", token: entry.quiz.token, index });
        return render();
      }
      case "nextReview":
        review = { asked: true, quiz: null, answer: null, picked: -1, cleared: review.cleared };
        send({ type: "review" });
        return render();
      case "command":
        return send({ type: "command", id: d.id });
      case "link":
        return send({ type: "openLink", url: d.url });
      case "copy":
        return send({ type: "copy", text: d.text });
    }
  });

  app.addEventListener("change", (event) => {
    const el = /** @type {HTMLSelectElement} */ (event.target);
    if (el.dataset.change === "depth") send({ type: "setDepth", depth: el.value });
  });

  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "state":
        state = m;
        for (const key of Object.keys(explaining)) if (!m.explaining.includes(key)) delete explaining[key];
        break;
      case "tab":
        return setTab(m.tab);
      case "explaining":
        explaining[m.key] = m.by;
        break;
      case "explained":
        delete explaining[m.key];
        if (m.error) explainError[m.key] = m.error;
        else if (state) state.explanations[m.key] = m.explanation;
        break;
      case "quiz":
        if (m.quiz) cardQuiz[m.key] = { quiz: m.quiz, answer: null, picked: -1 };
        break;
      case "answered": {
        const entries = [review, ...Object.values(cardQuiz)];
        const entry = entries.find((e) => e.quiz && e.quiz.token === m.token);
        if (entry && m.answer) {
          entry.answer = m.answer;
          if (entry === review) review.cleared += 1;
        }
        break;
      }
      case "review":
        review = { asked: true, quiz: m.quiz, answer: null, picked: -1, cleared: review.cleared };
        break;
      case "dojo":
        dojo = { rows: m.rows, belts: m.belts };
        break;
    }
    render();
  });

  render();
  send({ type: "ready" });
  if (ui.tab === "dojo") send({ type: "dojo" });
})();
