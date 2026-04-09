
(function(){
  /* =======================
     CONFIG
  ======================= */
  const CONFIG = {
    LABEL: "DIRECT",
    YEAR_MIN: 2024,
    YEAR_MAX: 2028,

    BUDGET_FILES: {
    2024: "budgetdirect.xlsx",
    2025: "budgetdirect.xlsx",
    2026: "budgetdirect.xlsx",
    2027: "budgetdirect.xlsx",
    2028: "budgetdirect.xlsx",
    },

    REAL_FILE: "activitereeldirect.xlsx",

    // âœ… Direct = Date commande
    REAL_DATE_COL: "Date commande",

    EVOL_REPORT_PAGE: "evol-reporting-direct.html",
    WEEK_VIEW_PAGE: "vue_semaine.html",

    COMMENT_CACHE_PREFIX: "EVOL_ANALYSE_DIRECT_COMMENTS_",
  };

  const MONTHS = [
    "Janvier","FÃ©vrier","Mars","Avril","Mai","Juin",
    "Juillet","AoÃ»t","Septembre","Octobre","Novembre","DÃ©cembre"
  ];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth();

  const el = {
    yearSelect: document.getElementById("yearSelect"),
    btnReload: document.getElementById("btnReload"),
    btnOpenEvol: document.getElementById("btnOpenEvol"),
    tbl: document.getElementById("tbl"),

    dotBudget: document.getElementById("dotBudget"),
    budgetText: document.getElementById("budgetText"),
    dotReal: document.getElementById("dotReal"),
    realText: document.getElementById("realText"),
    yearText: document.getElementById("yearText"),

    dotUrlBudget: document.getElementById("dotUrlBudget"),
    urlBudgetText: document.getElementById("urlBudgetText"),
    dotUrlReal: document.getElementById("dotUrlReal"),
    urlRealText: document.getElementById("urlRealText"),

    drawerOverlay: document.getElementById("drawerOverlay"),
    drawer: document.getElementById("drawer"),
    btnCloseDrawer: document.getElementById("btnCloseDrawer"),
    drawerTitle: document.getElementById("drawerTitle"),
    drawerSub: document.getElementById("drawerSub"),
    drawerBody: document.getElementById("drawerBody"),
    drawerActions: document.getElementById("drawerActions"),
  };

  let selectedYear = (currentYear>=CONFIG.YEAR_MIN && currentYear<=CONFIG.YEAR_MAX) ? currentYear : CONFIG.YEAR_MAX;
  let budgetMonthly = new Array(12).fill(0);
  let realMonthly = new Array(12).fill(0);

  // {monthIdx, weekIdx, date, clientInternal, clientName, amount, ref, des, qty}
  let realRows = [];

  let comments = {};

  initYearSelect();
  loadComments(selectedYear);
  bindDrawer();
  refreshAll(false);

  el.yearSelect.addEventListener("change", async () => {
    selectedYear = Number(el.yearSelect.value);
    loadComments(selectedYear);
    await refreshAll(false);
  });

  el.btnReload.addEventListener("click", async () => { await refreshAll(true); });

  el.btnOpenEvol.addEventListener("click", () => {
    window.location.href = `${CONFIG.EVOL_REPORT_PAGE}?year=${encodeURIComponent(selectedYear)}`;
  });

  async function refreshAll(){
    el.yearText.textContent = `AnnÃ©e : ${selectedYear}`;
    await loadBudgetForYear(selectedYear);
    await loadRealForYear(selectedYear);
    renderTable();
  }

  function initYearSelect(){
    const years = [];
    for(let y=CONFIG.YEAR_MIN;y<=CONFIG.YEAR_MAX;y++) years.push(y);
    el.yearSelect.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
    el.yearSelect.value = String(selectedYear);
    el.yearText.textContent = `AnnÃ©e : ${selectedYear}`;
  }

  /* =========================
     BUDGET
  ========================= */
  async function loadBudgetForYear(year){
    const file = CONFIG.BUDGET_FILES[year] || "budgetdirect.xlsx";
    el.budgetText.textContent = `Budget : chargementâ€¦ (${file})`;
    setDot(el.dotBudget, "warn");
    setDot(el.dotUrlBudget, "warn");
    el.urlBudgetText.textContent = `URL budget : â€”`;

    try{
      const {buffer, usedUrl} = await fetchXlsxWithFallback(file);
      el.urlBudgetText.textContent = `URL budget : ${usedUrl}`;
      setDot(el.dotUrlBudget, "ok");

      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = pickBestSheet(wb);
      const ws = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (!raw.length){
        budgetMonthly = new Array(12).fill(0);
        el.budgetText.textContent = `Budget : fichier vide`;
        setDot(el.dotBudget, "bad");
        return;
      }

      const headerMap = buildHeaderMap(raw[0]);
      const monthCols = MONTHS.map(m => findCol(headerMap, [m]));
      const missing = monthCols.map((c,i)=>!c?MONTHS[i]:null).filter(Boolean);
      if (missing.length){
        budgetMonthly = new Array(12).fill(0);
        el.budgetText.textContent = `Budget : colonnes mois manquantes (${missing.join(", ")})`;
        setDot(el.dotBudget, "bad");
        return;
      }

      const sums = new Array(12).fill(0);
      for (const r of raw){
        for (let i=0;i<12;i++) sums[i] += toNumber(r[monthCols[i]]);
      }
      budgetMonthly = sums;

      el.budgetText.textContent = `Budget : OK (${file}) â€” sheet: ${sheetName}`;
      setDot(el.dotBudget, "ok");
    }catch(err){
      console.error(err);
      budgetMonthly = new Array(12).fill(0);
      el.budgetText.textContent = `Budget : fetch/lecture impossible`;
      setDot(el.dotBudget, "bad");
      setDot(el.dotUrlBudget, "bad");
      el.urlBudgetText.textContent = `URL budget : erreur`;
    }
  }

  /* =========================
     REAL
     âœ… FIX PRODUIT : colDes inclut "Description produit"
  ========================= */
  async function loadRealForYear(year){
    const file = CONFIG.REAL_FILE;

    el.realText.textContent = `RÃ©alisÃ© : chargementâ€¦ (${file})`;
    setDot(el.dotReal, "warn");
    setDot(el.dotUrlReal, "warn");
    el.urlRealText.textContent = `URL rÃ©alisÃ© : â€”`;

    try{
      const {buffer, usedUrl} = await fetchXlsxWithFallback(file);
      el.urlRealText.textContent = `URL rÃ©alisÃ© : ${usedUrl}`;
      setDot(el.dotUrlReal, "ok");

      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = pickBestSheet(wb);
      const ws = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (!raw.length){
        realMonthly = new Array(12).fill(0);
        realRows = [];
        el.realText.textContent = `RÃ©alisÃ© : fichier vide`;
        setDot(el.dotReal, "bad");
        return;
      }

      const headerMap = buildHeaderMap(raw[0]);

      const colDate = findCol(headerMap, [CONFIG.REAL_DATE_COL, "date commande", "date vente", "date"]);
      const colMonth = findCol(headerMap, ["mois","mois2","month"]);
      const colAmt = findCol(headerMap, ["ca total","ca","montant","montant ca","chiffre d'affaire"]);

      const colClientInt = findCol(headerMap, [
        "nÂ° client interne","no client interne","n client interne","numero client interne",
        "nÂ° client","code livrÃ©","code livre","code"
      ]);
      const colClientName = findCol(headerMap, ["nom du client","nom client","client"]);

      const colRef = findCol(headerMap, [
        "reference produits","rÃ©fÃ©rence produits","reference produit","rÃ©fÃ©rence produit","ref produit","ref",
        "code produit","code article","article"
      ]);

      // âœ… FIX : Description produit
      const colDes = findCol(headerMap, [
        "description produit",
        "description",
        "libelle produit","libellÃ© produit",
        "dÃ©signation","designation","design",
        "produit","article libelle","article libellÃ©"
      ]);

      const colQty = findCol(headerMap, ["quantitÃ© payante servie","quantite payante servie","quantitÃ©","quantite","qte","qtÃ©"]);

      if (!colAmt || (!colDate && !colMonth)){
        realMonthly = new Array(12).fill(0);
        realRows = [];
        el.realText.textContent = `RÃ©alisÃ© : colonnes Date/Mois ou CA introuvables`;
        setDot(el.dotReal, "bad");
        return;
      }

      const sums = new Array(12).fill(0);
      const rows = [];

      for (const r of raw){
        const amount = toNumber(r[colAmt]);
        if (!amount) continue;

        let dt = null;
        if (colDate) dt = parseAnyDate(r[colDate]);
        if (dt && dt.getFullYear() !== year) continue;

        let mi = -1;
        if (dt) mi = dt.getMonth();
        if (mi < 0 && colMonth) mi = monthToIndex(String(r[colMonth] ?? "").trim());
        if (mi < 0) continue;

        sums[mi] += amount;

        rows.push({
          monthIdx: mi,
          weekIdx: dt ? weekBucket(dt) : -1,
          date: dt,
          clientInternal: colClientInt ? String(r[colClientInt] ?? "").trim() : "",
          clientName: colClientName ? String(r[colClientName] ?? "").trim() : "",
          amount,
          ref: colRef ? String(r[colRef] ?? "").trim() : "",
          des: colDes ? String(r[colDes] ?? "").trim() : "",
          qty: colQty ? toNumber(r[colQty]) : 0,
        });
      }

      realMonthly = sums;
      realRows = rows;

      const dateInfo = colDate ? `Date OK (${CONFIG.REAL_DATE_COL})` : `Sans date (mode mois2)`;
      const prodInfo = (colDes || colRef) ? `Produit OK (${colDes || colRef})` : `Produit: non dÃ©tectÃ©`;
      el.realText.textContent = `RÃ©alisÃ© : OK (${file}) â€” sheet: ${sheetName} â€” ${dateInfo} â€” ${prodInfo}`;
      setDot(el.dotReal, "ok");
    }catch(err){
      console.error(err);
      realMonthly = new Array(12).fill(0);
      realRows = [];
      el.realText.textContent = `RÃ©alisÃ© : erreur fetch/lecture`;
      setDot(el.dotReal, "bad");
      setDot(el.dotUrlReal, "bad");
      el.urlRealText.textContent = `URL rÃ©alisÃ© : erreur`;
    }
  }

  /* =========================
     TABLE
  ========================= */
  function renderTable(){
    const prevMonthIdx = computePrevMonthIdx(selectedYear);

    const rows = MONTHS.map((m, idx) => {
      const budget = budgetMonthly[idx] || 0;
      const real = realMonthly[idx] || 0;
      const ecart = real - budget;
      const comment = comments[idx] || "";
      return { idx, mois: m, real, budget, ecart, comment };
    });

    const totalBudget = rows.reduce((s,r)=>s+r.budget,0);
    const totalReal = rows.reduce((s,r)=>s+r.real,0);
    const totalEcart = totalReal - totalBudget;

    const cumBudget = (prevMonthIdx >= 0) ? rows.slice(0, prevMonthIdx+1).reduce((s,r)=>s+r.budget,0) : 0;
    const cumReal = (prevMonthIdx >= 0) ? rows.slice(0, prevMonthIdx+1).reduce((s,r)=>s+r.real,0) : 0;
    const cumEcart = cumReal - cumBudget;

    el.tbl.innerHTML = `
      <thead>
        <tr>
          <th style="text-align:left;min-width:190px">Mois</th>
          <th style="min-width:150px">CA RÃ©alisÃ©</th>
          <th style="min-width:150px">Budget</th>
          <th style="min-width:150px">Ã‰cart</th>
          <th style="text-align:left;min-width:340px">Commentaire</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="clickable" data-month-row="${r.idx}">
            <td style="text-align:left">
              <div class="moCell">
                <span>${esc(r.mois)}</span>
                <button class="wkMini" type="button"
                  data-weekbtn="1"
                  data-mi="${r.idx}"
                  data-mlabel="${escAttr(r.mois)}"
                  title="Voir semaine par semaine">
                  Sem.
                </button>
              </div>
            </td>
            <td>${fmt(r.real)}</td>
            <td>${fmt(r.budget)}</td>
            <td>${fmtEcart(r.ecart)}</td>
            <td style="text-align:left">
              <input class="comment" data-month="${r.idx}" placeholder="Note / analyseâ€¦" value="${escAttr(r.comment)}" />
            </td>
          </tr>
        `).join("")}

        <tr class="rowTotal">
          <td style="text-align:left">TOTAL</td>
          <td>${fmt(totalReal)}</td>
          <td>${fmt(totalBudget)}</td>
          <td>${fmtEcart(totalEcart)}</td>
          <td class="muted" style="text-align:left">Somme annuelle</td>
        </tr>

        <tr class="rowCum">
          <td style="text-align:left">CUMUL M-1</td>
          <td>${fmt(cumReal)}</td>
          <td>${fmt(cumBudget)}</td>
          <td>${fmtEcart(cumEcart)}</td>
          <td class="muted" style="text-align:left">
            ${prevMonthIdx >= 0 ? `Somme Jan â†’ ${MONTHS[prevMonthIdx]}` : `Aucun mois Ã  cumuler (annÃ©e future)`}
          </td>
        </tr>
      </tbody>
    `;

    // comments
    el.tbl.querySelectorAll("input[data-month]").forEach(inp => {
      inp.addEventListener("input", () => {
        const mi = Number(inp.getAttribute("data-month"));
        comments[mi] = inp.value || "";
        saveComments(selectedYear);
      });
    });

    // Sem. -> vue semaine
    el.tbl.querySelectorAll("button[data-weekbtn='1']").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();

        const mi = Number(btn.getAttribute("data-mi"));
        const monthLabel = btn.getAttribute("data-mlabel") || "";
        const mk = monthIdxToKey(mi);

        const qs = new URLSearchParams({
          entity: CONFIG.LABEL,
          month: mk,
          monthLabel,
          realFile: CONFIG.REAL_FILE,
          dateCol: CONFIG.REAL_DATE_COL,
          amountColHint: "CA Total",
          year: String(selectedYear),
      budgetFile: (CONFIG.BUDGET_FILES[selectedYear] || "budgetdirect.xlsx")
        });

        window.location.href = `${CONFIG.WEEK_VIEW_PAGE}?${qs.toString()}`;
      });
    });

    // click mois -> drilldown clients
    el.tbl.querySelectorAll("tr[data-month-row]").forEach(tr => {
      tr.addEventListener("click", (e) => {
        if (e.target && (e.target.tagName === "INPUT" || e.target.closest("button"))) return;
        const mi = Number(tr.getAttribute("data-month-row"));
        openMonthDetails(mi);
      });
    });
  }

  function fmtEcart(v){
    const cls = v > 0 ? "pos" : v < 0 ? "neg" : "zero";
    return `<span class="${cls}">${fmt(v)}</span>`;
  }

  /* =========================
     Drilldown: Month -> Clients
  ========================= */
  function openMonthDetails(monthIdx){
    const monthName = MONTHS[monthIdx];

    const rows = realRows.filter(r => r.monthIdx === monthIdx);
    const agg = new Map();

    for (const r of rows){
      const key = makeClientId(r.clientInternal, r.clientName);
      if (!agg.has(key)){
        agg.set(key, { clientInternal: r.clientInternal, clientName: r.clientName, amount: 0, lines: 0 });
      }
      const it = agg.get(key);
      it.amount += r.amount;
      it.lines += 1;
    }

    let clients = Array.from(agg.values()).sort((a,b)=>b.amount-a.amount);
    const total = clients.reduce((s,x)=>s+x.amount,0);

    showDrawer({
      title: `DÃ©tail clients â€” ${monthName}`,
      sub: `${CONFIG.LABEL} â€¢ ${selectedYear} â€¢ ${clients.length} clients â€¢ CA ${fmt(total)}`,
      actions: [
        { label: "Ã‰vol Report vs Budget", onClick: () => goEvolReport(monthIdx) },
        { label: "Fermer", onClick: closeDrawer },
      ],
      bodyHtml: `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <input id="clientSearch" type="text" placeholder="Rechercher un clientâ€¦" style="flex:1;min-width:220px;">
          <button class="pill" id="sortClientBtn">Tri CA: â–¼</button>
        </div>
        <div id="clientList">
          ${clients.length ? clients.map(c => clientCardHtml(c)).join("") : `<div class="empty">Aucune ligne rÃ©el pour ce mois.</div>`}
        </div>
      `,
      afterRender: () => {
        const search = document.getElementById("clientSearch");
        const list = document.getElementById("clientList");
        const sortBtn = document.getElementById("sortClientBtn");
        let desc = true;

        function render(listData){
          list.innerHTML = listData.length
            ? listData.map(c => clientCardHtml(c)).join("")
            : `<div class="empty">Aucun client.</div>`;

          list.querySelectorAll("[data-client]").forEach(card => {
            card.addEventListener("click", () => {
              const cid = card.getAttribute("data-client");
              const obj = listData.find(x => makeClientId(x.clientInternal, x.clientName) === cid);
              if (obj) openClientDetails(monthIdx, obj.clientInternal, obj.clientName);
            });
          });
        }

        function apply(){
          const q = norm(search.value || "");
          let filtered = clients.filter(c => {
            const a = norm(c.clientInternal);
            const b = norm(c.clientName);
            return !q || a.includes(q) || b.includes(q);
          });

          filtered.sort((a,b)=> desc ? (b.amount-a.amount) : (a.amount-b.amount));
          render(filtered);
        }

        sortBtn.addEventListener("click", () => {
          desc = !desc;
          sortBtn.textContent = `Tri CA: ${desc ? "â–¼" : "â–²"}`;
          apply();
        });

        search.addEventListener("input", () => apply());
        apply();
      }
    });

    function clientCardHtml(c){
      const id = makeClientId(c.clientInternal, c.clientName);
      return `
        <div class="listCard" data-client="${escAttr(id)}">
          <div class="listTop">
            <div class="name">${esc(c.clientName || "â€”")}</div>
            <div class="val">${fmt(c.amount)}</div>
          </div>
          <div class="listSub">
            <span class="tag">NÂ°: <b>${esc(c.clientInternal || "â€”")}</b></span>
            <span class="tag">Lignes: <b>${c.lines}</b></span>
          </div>
        </div>
      `;
    }
  }

  /* =========================
     Drilldown: Client -> Purchases
  ========================= */
  function openClientDetails(monthIdx, clientInternal, clientName){
    const monthName = MONTHS[monthIdx];

    const rows = realRows.filter(r =>
      r.monthIdx === monthIdx &&
      norm(r.clientInternal) === norm(clientInternal) &&
      norm(r.clientName) === norm(clientName)
    );

    const total = rows.reduce((s,x)=>s+x.amount,0);

    const hasProduct = rows.some(r => (r.ref || r.des));
    let blocksHtml = "";

    if (hasProduct){
      const agg = new Map();
      for (const r of rows){
        const k = (r.ref || "") + "||" + (r.des || "");
        if (!agg.has(k)){
          agg.set(k, { ref: r.ref, des: r.des, qty: 0, amount: 0, lines: 0 });
        }
        const it = agg.get(k);
        it.qty += (r.qty || 0);
        it.amount += r.amount;
        it.lines += 1;
      }
      const items = Array.from(agg.values()).sort((a,b)=>b.amount-a.amount);

      blocksHtml = `
        ${items.map(it => `
          <div class="listCard" style="cursor:default;">
            <div class="listTop">
              <div class="name">${esc(it.des || it.ref || "â€”")}</div>
              <div class="val">${fmt(it.amount)}</div>
            </div>
            <div class="listSub">
              <span class="tag">Ref: <b>${esc(it.ref || "â€”")}</b></span>
              <span class="tag">QtÃ©: <b>${fmt(it.qty)}</b></span>
              <span class="tag">Lignes: <b>${it.lines}</b></span>
            </div>
          </div>
        `).join("")}
      `;
    } else {
      blocksHtml = `
        <div class="empty">Pas de colonnes produit dÃ©tectÃ©es â†’ vÃ©rifie "Description produit" / "Ref".</div>
        ${rows.slice(0, 200).map(r => `
          <div class="listCard" style="cursor:default;">
            <div class="listTop">
              <div class="name">Ligne</div>
              <div class="val">${fmt(r.amount)}</div>
            </div>
          </div>
        `).join("")}
      `;
    }

    showDrawer({
      title: `Achats â€” ${monthName}`,
      sub: `${esc(clientName || "â€”")} â€¢ ${esc(clientInternal || "â€”")} â€¢ CA ${fmt(total)}`,
      actions: [
        { label: "â† Clients", onClick: () => openMonthDetails(monthIdx) },
        { label: "Ã‰vol Report vs Budget", onClick: () => goEvolReport(monthIdx) },
        { label: "Fermer", onClick: closeDrawer },
      ],
      bodyHtml: blocksHtml
    });
  }

  function goEvolReport(monthIdx){
    window.location.href = `${CONFIG.EVOL_REPORT_PAGE}?year=${encodeURIComponent(selectedYear)}&month=${encodeURIComponent(monthIdx+1)}`;
  }

  /* =========================
     Drawer helpers
  ========================= */
  function bindDrawer(){
    el.btnCloseDrawer.addEventListener("click", closeDrawer);
    el.drawerOverlay.addEventListener("click", closeDrawer);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
    window.addEventListener("pageshow", () => closeDrawer());
  }

  function showDrawer({title, sub, actions, bodyHtml, afterRender}){
    el.drawerTitle.textContent = title || "â€”";
    el.drawerSub.textContent = sub || "â€”";
    el.drawerBody.innerHTML = bodyHtml || "";
    el.drawerActions.innerHTML = (actions || []).map((a, i) =>
      `<button class="pill" data-act="${i}">${esc(a.label)}</button>`
    ).join("");

    el.drawerActions.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-act"));
        const a = actions[idx];
        if (a && typeof a.onClick === "function") a.onClick();
      });
    });

    el.drawerOverlay.classList.add("show");
    el.drawer.classList.add("show");
    if (typeof afterRender === "function") afterRender();
  }

  function closeDrawer(){
    el.drawerOverlay.classList.remove("show");
    el.drawer.classList.remove("show");
  }

  /* =========================
     CUMUL M-1 logic
  ========================= */
  function computePrevMonthIdx(year){
    if (year < currentYear) return 11;
    if (year > currentYear) return -1;
    return Math.max(-1, currentMonthIdx - 1);
  }

  /* =========================
     Comments cache
  ========================= */
  function commentsKey(year){ return CONFIG.COMMENT_CACHE_PREFIX + String(year); }
  function loadComments(year){
    comments = {};
    try{
      const raw = localStorage.getItem(commentsKey(year));
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") comments = obj;
    }catch{}
  }
  function saveComments(year){
    try{ localStorage.setItem(commentsKey(year), JSON.stringify(comments || {})); }catch{}
  }

  /* =========================
     Fetch helpers (GitHub safe)
  ========================= */
  async function fetchXlsxWithFallback(fileName){
    const pageDir = location.href.replace(/[#?].*$/,"").replace(/\/[^\/]*$/, "/");
    const urlSame = new URL(fileName, pageDir).toString();
    const urlData = new URL("data/" + fileName, pageDir).toString();

    const candidates = [urlSame, urlData];
    let lastErr = "";

    for (const u of candidates){
      const url = u + (u.includes("?") ? "&" : "?") + "v=" + Date.now();
      const res = await fetch(url, { cache: "no-store" });
      const buf = await res.arrayBuffer();

      if (!res.ok){
        lastErr = `HTTP ${res.status} sur ${u}`;
        continue;
      }

      const sniff = sniffBuffer(buf);
      if (sniff.looksHtml || !sniff.isZip){
        lastErr = `Contenu invalide sur ${u} (HTML/404 ou pas XLSX)`;
        continue;
      }

      return { buffer: buf, usedUrl: u };
    }

    throw new Error(lastErr || "fetchXlsxWithFallback failed");
  }

  function sniffBuffer(arrayBuffer){
    const u8 = new Uint8Array(arrayBuffer);
    const a = u8[0], b = u8[1];
    const isZip = (a === 0x50 && b === 0x4B); // PK
    const head = u8.slice(0, Math.min(220, u8.length));
    let preview = "";
    try{ preview = new TextDecoder("utf-8").decode(head).trim(); }catch{ preview = ""; }
    const p = (preview || "").toLowerCase();
    const looksHtml = p.startsWith("<") || p.includes("<!doctype html") || p.includes("<html");
    return { isZip, looksHtml };
  }

  function pickBestSheet(wb){
    let best = wb.SheetNames[0];
    let bestScore = -1;
    for (const name of wb.SheetNames){
      const ws = wb.Sheets[name];
      const ref = ws && ws["!ref"];
      if (!ref) continue;
      const range = XLSX.utils.decode_range(ref);
      const rows = (range.e.r - range.s.r + 1);
      const cols = (range.e.c - range.s.c + 1);
      const score = rows * cols;
      if (score > bestScore){
        bestScore = score;
        best = name;
      }
    }
    return best;
  }

  /* =========================
     Header tolerant helpers
  ========================= */
  function buildHeaderMap(sampleRow){
    const map = {};
    for (const k of Object.keys(sampleRow || {})) map[norm(k)] = k;
    return map;
  }
  function findCol(headerMap, candidates){
    for (const c of candidates){
      const nk = norm(c);
      if (headerMap[nk]) return headerMap[nk];
    }
    return null;
  }
  function norm(s){
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  }
  function toNumber(v){
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v).trim();
    if (!s) return 0;
    const n = Number(s.replace(/\s/g,"").replace(",","."));
    return isFinite(n) ? n : 0;
  }
  function fmt(n){
    const x = Number(n) || 0;
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(x);
  }
  function setDot(dotEl, type){
    dotEl.className = "dot " + (type === "ok" ? "ok" : type === "bad" ? "bad" : "warn");
  }
  function esc(str){
    return String(str ?? "").replace(/[&<>"']/g, s => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[s]));
  }
  function escAttr(str){
    return esc(str).replace(/"/g, "&quot;");
  }

  function monthToIndex(m){
    const map = {
      "janvier":0,"jan":0,"1":0,
      "fevrier":1,"fÃ©vrier":1,"fev":1,"2":1,
      "mars":2,"3":2,
      "avril":3,"4":3,
      "mai":4,"5":4,
      "juin":5,"6":5,
      "juillet":6,"7":6,
      "aout":7,"aoÃ»t":7,"8":7,
      "septembre":8,"sep":8,"9":8,
      "octobre":9,"oct":9,"10":9,
      "novembre":10,"nov":10,"11":10,
      "decembre":11,"dÃ©cembre":11,"dec":11,"12":11
    };
    return map[norm(m)] ?? -1;
  }

  function monthIdxToKey(i){
    const keys = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    return keys[i] || "jan";
  }

  function weekBucket(date){
    const d = date.getDate();
    if (d <= 7) return 0;
    if (d <= 14) return 1;
    if (d <= 21) return 2;
    return 3;
  }

  function parseAnyDate(v){
    if (!v && v !== 0) return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;

    // Excel serial
    if (typeof v === "number" && isFinite(v)){
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return null;
      const dt = new Date(d.y, (d.m||1)-1, d.d||1);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const s = String(v).trim();
    if (!s) return null;

    // âœ… YYYY-MM-DD
    const iso = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (iso){
      const yyyy = Number(iso[1]);
      const mm = Number(iso[2]);
      const dd = Number(iso[3]);
      const dt = new Date(yyyy, mm-1, dd);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // dd/mm/yyyy fallback
    const fr = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (fr){
      const dd = Number(fr[1]), mm = Number(fr[2]), yy = Number(fr[3]);
      const yyyy = yy < 100 ? 2000 + yy : yy;
      const dt = new Date(yyyy, mm-1, dd);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }

  function makeClientId(clientInternal, clientName){
    const a = norm(clientInternal).replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
    const b = norm(clientName).replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
    return (a || "noid") + "__" + (b || "noname");
  }
})();

