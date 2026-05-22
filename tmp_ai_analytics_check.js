const dom = {
      questionInput: document.getElementById("questionInput"),
      limitInput: document.getElementById("limitInput"),
      askBtn: document.getElementById("askBtn"),
      loadingBox: document.getElementById("loadingBox"),
      statusBox: document.getElementById("statusBox"),
      quickQuestions: document.getElementById("quickQuestions"),
      resetSeenQuestionsBtn: document.getElementById("resetSeenQuestionsBtn"),
      chatThread: document.getElementById("chatThread"),
      summaryBox: document.getElementById("summaryBox"),
      finalBox: document.getElementById("finalBox"),
      metaBox: document.getElementById("metaBox"),
      insightsList: document.getElementById("insightsList"),
      recommendationsList: document.getElementById("recommendationsList"),
      followUpList: document.getElementById("followUpList"),
      thead: document.getElementById("thead"),
      tbody: document.getElementById("tbody")
    };

    const SEEN_QUESTIONS_KEY = "analyse_co_seen_questions_v1";

    const defaultQuickQuestions = [
      "Quel est mon top 10 produit sur ce mois ?",
      "Quels clients ont le plus fort CA sur ce mois ?",
      "Compare ce mois avec le mois dernier.",
      "Quels clients sont inactifs depuis 2 mois ?",
      "Donne-moi les produits qui performent le moins cette periode.",
      "Quelles actions urgentes recommandes-tu cette semaine ?"
    ];

    const seenQuestions = loadSeenQuestions();

    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function setLoading(loading) {
      dom.askBtn.disabled = loading;
      dom.loadingBox.classList.toggle("active", loading);
    }

    function setStatus(message, kind = "") {
      dom.statusBox.className = "status" + (kind ? " " + kind : "");
      dom.statusBox.textContent = message;
    }

    function normalizeQuestionKey(question) {
      return String(question || "").trim().toLowerCase();
    }

    function loadSeenQuestions() {
      try {
        const raw = localStorage.getItem(SEEN_QUESTIONS_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map(normalizeQuestionKey).filter(Boolean));
      } catch {
        return new Set();
      }
    }

    function saveSeenQuestions() {
      try {
        localStorage.setItem(SEEN_QUESTIONS_KEY, JSON.stringify(Array.from(seenQuestions)));
      } catch {}
    }

    function markQuestionAsSeen(question) {
      const key = normalizeQuestionKey(question);
      if (!key) return;
      seenQuestions.add(key);
      saveSeenQuestions();
    }

    function isQuestionSeen(question) {
      return seenQuestions.has(normalizeQuestionKey(question));
    }

    function addChatMessage(role, message, meta = "") {
      const row = document.createElement("div");
      row.className = "chat-row " + (role === "user" ? "user" : "assistant");
      const safeMessage = esc(message || "-");
      const safeMeta = meta ? `<span class="chat-meta">${esc(meta)}</span>` : "";
      row.innerHTML = `<div class="chat-bubble">${safeMessage}${safeMeta}</div>`;
      dom.chatThread.appendChild(row);

      while (dom.chatThread.children.length > 24) {
        dom.chatThread.removeChild(dom.chatThread.firstChild);
      }
      dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
    }

    function formatCurrency(value) {
      return Number(value || 0).toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function formatNumber(value) {
      return Number(value || 0).toLocaleString("fr-FR", {
        minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
        maximumFractionDigits: 2
      });
    }

    function looksLikeMoneyColumn(columnName) {
      return /(ca|chiffre|euro|eur|montant|prix|panier|total)/i.test(String(columnName || ""));
    }

    function looksLikeNumericText(value) {
      if (typeof value !== "string") return false;
      const trimmed = value.trim();
      if (!trimmed) return false;
      return /^-?\d+(?:[.,]\d+)?$/.test(trimmed);
    }

    function formatCellValue(columnName, rawValue) {
      if (rawValue == null) return "";
      const column = String(columnName || "");
      if (/id|compte|numero|reference|ref/i.test(column)) {
        return String(rawValue);
      }

      const numericCandidate =
        typeof rawValue === "number"
          ? rawValue
          : looksLikeNumericText(rawValue)
            ? Number(String(rawValue).replace(",", "."))
            : NaN;

      if (!Number.isFinite(numericCandidate)) return String(rawValue);
      if (looksLikeMoneyColumn(column)) return formatCurrency(numericCandidate);
      return formatNumber(numericCandidate);
    }

    function renderQuickQuestionButtons(questions) {
      const list = Array.isArray(questions) && questions.length ? questions : defaultQuickQuestions;
      const filtered = list.filter(question => !isQuestionSeen(question));
      if (!filtered.length) {
        dom.quickQuestions.hidden = true;
        return;
      }

      dom.quickQuestions.hidden = false;
      dom.quickQuestions.innerHTML = filtered.slice(0, 8).map(question => {
        return `<button type="button" class="q-chip" data-question="${esc(question)}">${esc(question)}</button>`;
      }).join("");

      dom.quickQuestions.querySelectorAll("[data-question]").forEach(button => {
        button.addEventListener("click", () => {
          const question = button.getAttribute("data-question") || "";
          markQuestionAsSeen(question);
          dom.questionInput.value = question;
          ask();
        });
      });
    }

    function renderTable(columns, rows) {
      if (!columns.length) {
        dom.thead.innerHTML = "";
        dom.tbody.innerHTML = `<tr><td class="muted">Aucune colonne.</td></tr>`;
        return;
      }

      dom.thead.innerHTML = `<tr>${columns.map(col => `<th>${esc(col)}</th>`).join("")}</tr>`;

      if (!rows.length) {
        dom.tbody.innerHTML = `<tr><td colspan="${columns.length}" class="muted">Aucune ligne retournee.</td></tr>`;
        return;
      }

      dom.tbody.innerHTML = rows.map(row => {
        return `<tr>${columns.map(col => `<td>${esc(formatCellValue(col, row[col]))}</td>`).join("")}</tr>`;
      }).join("");
    }

    function renderList(target, items, fallback) {
      if (!Array.isArray(items) || !items.length) {
        target.innerHTML = `<li class="muted">${esc(fallback)}</li>`;
        return;
      }
      target.innerHTML = items.map(item => `<li>${esc(item)}</li>`).join("");
    }

    function renderFollowUpButtons(questions) {
      const list = Array.isArray(questions) && questions.length ? questions : [];
      const filtered = list.filter(question => !isQuestionSeen(question));
      if (!filtered.length) {
        dom.followUpList.innerHTML = `<button type="button">Pose une question plus specifique pour generer des relances.</button>`;
        return;
      }

      dom.followUpList.innerHTML = filtered.slice(0, 8).map(question => {
        return `<button type="button" data-followup="${esc(question)}">${esc(question)}</button>`;
      }).join("");

      dom.followUpList.querySelectorAll("[data-followup]").forEach(button => {
        button.addEventListener("click", () => {
          const question = button.getAttribute("data-followup") || "";
          markQuestionAsSeen(question);
          dom.questionInput.value = question;
          ask();
        });
      });
    }

    async function ask() {
      const question = dom.questionInput.value.trim();
      const limit = Math.min(1000, Math.max(1, Number(dom.limitInput.value || 10)));

      if (!question) {
        setStatus("Saisis une question.", "err");
        return;
      }

      try {
        setLoading(true);
        setStatus("Analyse en cours...", "");
        markQuestionAsSeen(question);
        addChatMessage("user", question);

        const res = await fetch("/api/ai-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, limit })
        });

        const data = await res.json();

        if (!res.ok || !data?.ok) {
          const msg = data?.message || "Requete impossible.";
          const code = data?.errorCode ? ` [${data.errorCode}]` : "";
          throw new Error(msg + code);
        }

        renderTable(data.columns || [], data.rows || []);

        const analysis = data.analysis || {};
        dom.summaryBox.textContent = data.summary || "Analyse terminee.";
        dom.finalBox.textContent = data.finalResult || "-";
        dom.metaBox.textContent = `Intent: ${data.intent || "-"} | Lignes: ${(data.rows || []).length} | Periode: ${data.meta?.period || "-"}`;
        addChatMessage("assistant", data.summary || "Analyse terminee.", data.finalResult || "");

        renderList(dom.insightsList, analysis.insights || [], "Aucun insight disponible.");
        renderList(dom.recommendationsList, analysis.recommendations || [], "Aucune recommandation disponible.");
        renderFollowUpButtons(analysis.followUpQuestions || []);
        renderQuickQuestionButtons([...(analysis.followUpQuestions || []), ...defaultQuickQuestions]);

        setStatus("Analyse terminee.", "ok");
      } catch (error) {
        console.error(error);
        dom.finalBox.textContent = "-";
        addChatMessage("assistant", "Je n'ai pas pu terminer l'analyse.", error.message || "Erreur technique");
        renderList(dom.insightsList, [], "Aucun insight disponible.");
        renderList(dom.recommendationsList, [], "Aucune recommandation disponible.");
        renderFollowUpButtons([]);
        setStatus(error.message || "Erreur pendant l'analyse.", "err");
      } finally {
        setLoading(false);
      }
    }

    renderQuickQuestionButtons(defaultQuickQuestions);

    dom.askBtn.addEventListener("click", ask);
    dom.resetSeenQuestionsBtn.addEventListener("click", () => {
      seenQuestions.clear();
      saveSeenQuestions();
      renderQuickQuestionButtons(defaultQuickQuestions);
      setStatus("Suggestions reaffichees.", "");
    });
    dom.questionInput.addEventListener("keydown", event => {
      if (event.key === "Enter") ask();
    });
