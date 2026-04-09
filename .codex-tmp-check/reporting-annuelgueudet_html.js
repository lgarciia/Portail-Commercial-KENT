
(async function(){
  const MONTHS = [
    { key: "jan", label: "Janvier", excel: "Janvier" },
    { key: "feb", label: "FÃ©vrier", excel: "FÃ©vrier" },
    { key: "mar", label: "Mars", excel: "Mars" },
    { key: "apr", label: "Avril", excel: "Avril" },
    { key: "may", label: "Mai", excel: "Mai" },
    { key: "jun", label: "Juin", excel: "Juin" },
    { key: "jul", label: "Juillet", excel: "Juillet" },
    { key: "aug", label: "AoÃ»t", excel: "AoÃ»t" },
    { key: "sep", label: "Septembre", excel: "Septembre" },
    { key: "oct", label: "Octobre", excel: "Octobre" },
    { key: "nov", label: "Novembre", excel: "Novembre" },
    { key: "dec", label: "DÃ©cembre", excel: "DÃ©cembre" },
  ];

  const STORAGE = {
    budget: "BUDGET2026_DATA_GUEUDET_V1",
    budgetMeta: "BUDGET2026_META_GUEUDET_V1",
    real: "BUDGET2026_REAL_GUEUDET_V1",
  };

  // âœ… sources fichiers
  const REAL_FILE = "activitereelgueudet.xlsx";
  const BUDGET_FILE = "budgetgueudet.xlsx";

  let budgetData = null;  // { clients: [{id,name,nclient,budget:{jan..dec}}] }
  let realData = loadJSON(STORAGE.real, {}); // sera Ã©crasÃ© par le fetch
  let filterText = "";

  const el = {
    fileBudget: document.getElementById("fileBudget"),
    btnImport: document.getElementById("btnImport"),
    btnExportXlsx: document.getElementById("btnExportXlsx"),
    btnExportCsv: document.getElementById("btnExportCsv"),
    btnExportJson: document.getElementById("btnExportJson"),
    btnResetReal: document.getElementById("btnResetReal"),
    table: document.getElementById("reportTable"),
    budgetFileLabel: document.getElementById("budgetFileLabel"),
    clientsCount: document.getElementById("clientsCount"),
    lastUpdate: document.getElementById("lastUpdate"),
    reelStatus: document.getElementById("reelStatus"),
    search: document.getElementById("search"),
    dropZone: document.getElementById("dropZone"),
    dropHint: document.getElementById("dropHint"),

    tableScroller: document.getElementById("tableScroller"),
    hScroll: document.getElementById("hScroll"),
    hScrollInner: document.getElementById("hScrollInner"),
  };

  const cachedBudget = loadJSON(STORAGE.budget, null);
  const cachedMeta = loadJSON(STORAGE.budgetMeta, null);

  if (cachedBudget && cachedBudget.clients?.length) {
    budgetData = cachedBudget;
    if (normalizeBudgetClientIds(budgetData.clients)) {
      saveJSON(STORAGE.budget, budgetData);
    }
    applyMeta(cachedMeta);
    await loadRealFromFetch();
    render();
  } else {
    renderEmpty();
    updateReelStatus("non chargÃ© (budget absent)");
    syncBottomScrollbar();
    await tryAutoFetchBudget();
  }

  el.btnImport.addEventListener("click", () => el.fileBudget.click());
  el.fileBudget.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    await importBudgetFile(file);
    el.fileBudget.value = "";
  });

  el.search.addEventListener("input", () => {
    filterText = (el.search.value || "").trim().toLowerCase();
    render();
  });

  el.btnResetReal.addEventListener("click", () => {
    if (!confirm("RÃ©initialiser toutes les valeurs RÃ©el (importÃ©es du fichier rÃ©el) ?")) return;
    realData = {};
    saveJSON(STORAGE.real, realData);
    render();
  });

  el.btnExportJson.addEventListener("click", () => exportJSON());
  el.btnExportCsv.addEventListener("click", () => exportCSV());
  el.btnExportXlsx.addEventListener("click", () => exportXLSX());

  ["dragenter","dragover"].forEach(evt => el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    el.dropHint.classList.add("show");
  }));
  ["dragleave","drop"].forEach(evt => el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    el.dropHint.classList.remove("show");
  }));
  el.dropZone.addEventListener("drop", async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      alert("Veuillez dÃ©poser un fichier .xlsx ou .xls");
      return;
    }
    await importBudgetFile(file);
  });

  // âœ… sync scroll horizontal : tableScroller (X hidden) <-> hScroll (X visible)
  let syncing = false;

  el.tableScroller.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    el.hScroll.scrollLeft = el.tableScroller.scrollLeft;
    syncing = false;
  }, { passive:true });

  el.hScroll.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    el.tableScroller.scrollLeft = el.hScroll.scrollLeft;
    syncing = false;
  }, { passive:true });

  window.addEventListener("resize", () => syncBottomScrollbar(), { passive:true });

  async function importBudgetFile(file){
    try{
      const arrayBuffer = await file.arrayBuffer();
      parseBudget(arrayBuffer, file.name || BUDGET_FILE);

      await loadRealFromFetch();
      render();
    }catch(err){
      console.error(err);
      alert("Import impossible : " + (err?.message || err));
    }
  }

  function parseBudget(arrayBuffer, fileLabel){
    const wb = XLSX.read(arrayBuffer, { type: "array" });

    const firstSheetName = wb.SheetNames[0];
    const ws = wb.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (!rows.length) throw new Error("Budget vide");

    const headerMap = buildHeaderMap(rows[0] || {});
    const colClient = findCol(headerMap, ["client", "clients"]);
    if (!colClient) throw new Error("Colonne CLIENT introuvable dans le fichier.");

    const colNClient = findCol(headerMap, ["n client","nÂ° client","no client","numero client","num client","nclient"]);

    const monthCols = {};
    for (const m of MONTHS){
      const col = findCol(headerMap, [normalizeKey(m.excel)]);
      if (!col) throw new Error(`Colonne "${m.excel}" introuvable dans le fichier.`);
      monthCols[m.key] = col;
    }

    const clients = [];
    for (const r of rows){
      const rawName = String(r[colClient] ?? "").trim();
      if (!rawName) continue;

      const nclient = colNClient ? String(r[colNClient] ?? "").trim() : "";
      const id = makeClientKey(rawName, nclient);

      const budget = {};
      for (const m of MONTHS){
        budget[m.key] = Math.round(toNumber(r[monthCols[m.key]]));
      }

      clients.push({ id, name: rawName, nclient, budget });
    }

    budgetData = { clients };

    saveJSON(STORAGE.budget, budgetData);
    const meta = {
      filename: fileLabel,
      updatedAt: new Date().toISOString(),
      sheet: firstSheetName
    };
    saveJSON(STORAGE.budgetMeta, meta);
    applyMeta(meta);
  }

  async function tryAutoFetchBudget(){
    try{
      const { buffer } = await fetchXlsxWithFallback(BUDGET_FILE);
      parseBudget(buffer, BUDGET_FILE);
      await loadRealFromFetch();
      render();
    }catch{
      // silencieux : on laisse l'import manuel
    }
  }

  function applyMeta(meta){
    if (!meta) {
      el.budgetFileLabel.textContent = "non chargÃ©";
      el.lastUpdate.textContent = "â€”";
      return;
    }
    el.budgetFileLabel.textContent = meta.filename || BUDGET_FILE;
    el.lastUpdate.textContent = formatDateTime(meta.updatedAt);
  }

  /* ======================================================
     âœ… FETCH RÃ‰EL (Gueudet)
     Reconstruit realData[clientId][monthKey] = somme CA
  ====================================================== */
  async function loadRealFromFetch(){
    if (!budgetData?.clients?.length){
      updateReelStatus("budget absent");
      return;
    }

    updateReelStatus("chargementâ€¦");

    try{
      const { buffer } = await fetchXlsxWithFallback(REAL_FILE);

      const wb = XLSX.read(buffer, { type:"array" });
      const sheetName = pickBestSheet(wb);
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });

      if (!rows.length){
        realData = {};
        saveJSON(STORAGE.real, realData);
        updateReelStatus("fichier vide");
        return;
      }

      const headerMap = buildHeaderMap(rows[0] || {});

      // âœ… Colonnes attendues Gueudet (avec tolÃ©rance si le fichier est â€œPSA-likeâ€)
      const colClientInt = findCol(headerMap, [
        // Gueudet
        "code livrÃ©","code livre","code",
        // PSA-like (au cas oÃ¹)
        "nÂ° client interne","no client interne","n client interne","numero client interne","nÂ° client"
      ]);

      const colClientName = findCol(headerMap, [
        // Gueudet
        "nom client","nom du client","client",
        // PSA-like
        "nom du client","nom client","client"
      ]);

      const colAmt = findCol(headerMap, [
        // Gueudet
        "ca total","ca","chiffre d'affaires","chiffre daffaires",
        // PSA-like
        "montant prix achat kent","montant"
      ]);

      const colMonth = findCol(headerMap, ["mois2","mois","month"]);

      if (!colAmt || !colMonth){
        realData = {};
        saveJSON(STORAGE.real, realData);
        updateReelStatus("colonnes Mois/CA introuvables");
        return;
      }

      const budgetByExact = new Map();
      const budgetByNClient = new Map();
      const budgetByName = new Map();
      for (const bc of budgetData.clients){
        const exactKey = makeClientMatchKey(bc.name, bc.nclient);
        if (exactKey) budgetByExact.set(exactKey, bc);
        addLookupCandidate(budgetByNClient, compactClientCode(bc.nclient), bc);
        addLookupCandidate(budgetByName, compactClientName(bc.name), bc);
      }

      function ensureBudgetClient(nclientInterne, clientName){
        const knownClient = findMatchedClient(budgetByExact, budgetByNClient, budgetByName, nclientInterne, clientName);
        if (knownClient) return knownClient;

        const rawNClient = String(nclientInterne || "").trim();
        const rawName = String(clientName || "").trim();
        if (!rawNClient && !rawName) return null;

        const name = rawName || `Client ${rawNClient}`;
        const id = makeClientKey(name, rawNClient);

        const budget = {};
        for (const m of MONTHS) budget[m.key] = 0;

        const bc = { id, name, nclient: rawNClient, budget, isUnbudgeted:true };

        budgetData.clients.push(bc);
        const exactKey = makeClientMatchKey(name, rawNClient);
        if (exactKey) budgetByExact.set(exactKey, bc);
        addLookupCandidate(budgetByNClient, compactClientCode(rawNClient), bc);
        addLookupCandidate(budgetByName, compactClientName(name), bc);
        return bc;
      }

      const nextReal = {};

      for (const r of rows){
        const moisStr = String(r[colMonth] ?? "").trim();
        const monthKey = monthNameToKey(moisStr);
        if (!monthKey) continue;

        const amt = Math.round(toNumber(r[colAmt]));
        if (!amt) continue;

        const nclientInterne = colClientInt ? String(r[colClientInt] ?? "").trim() : "";
        const clientName = colClientName ? String(r[colClientName] ?? "").trim() : "";

        const bc = ensureBudgetClient(nclientInterne, clientName);
        if (!bc) continue;

        if (!nextReal[bc.id]) nextReal[bc.id] = {};
        nextReal[bc.id][monthKey] = Math.round(toNumber(nextReal[bc.id][monthKey])) + amt;
      }

      realData = nextReal;
      saveJSON(STORAGE.real, realData);

      const countClients = Object.keys(realData).length;
      updateReelStatus(`OK (${countClients} clients) â€” ${REAL_FILE}`);
    }catch(err){
      console.error(err);
      updateReelStatus("erreur fetch/lecture");
    }
  }

  function monthNameToKey(m){
    const k = normKey(m);
    const map = {
      "janvier":"jan","jan":"jan","janv":"jan","janv.":"jan",
      "fevrier":"feb","fÃ©vrier":"feb","fev":"feb","fÃ©v":"feb","fevr":"feb","fÃ©vr":"feb","fevr.":"feb","fÃ©vr.":"feb",
      "mars":"mar","mar":"mar",
      "avril":"apr","avr":"apr","avr.":"apr",
      "mai":"may",
      "juin":"jun",
      "juillet":"jul","juil":"jul","juil.":"jul",
      "aout":"aug","aoÃ»t":"aug",
      "septembre":"sep","sep":"sep","sept":"sep","sept.":"sep",
      "octobre":"oct","oct":"oct","oct.":"oct",
      "novembre":"nov","nov":"nov","nov.":"nov",
      "decembre":"dec","dÃ©cembre":"dec","dec":"dec","dÃ©c":"dec","dec.":"dec","dÃ©c.":"dec"
    };
    return map[k] || null;
  }

  function updateReelStatus(msg){
    el.reelStatus.textContent = msg || "â€”";
  }

  function renderEmpty(){
    el.clientsCount.textContent = "0";
    el.table.innerHTML = `
      <thead>
        <tr>
          <th class="col-client">Client</th>
          <th class="col-nclient">N CLIENT</th>
          ${MONTHS.map(m => `<th colspan="3">${escapeHtml(m.label)}</th>`).join("")}
          <th class="dividerL" colspan="3">Cumul</th>
        </tr>
        <tr>
          <th class="col-client">â€”</th>
          <th class="col-nclient">â€”</th>
          ${MONTHS.map(() => `<th>RÃ©el</th><th>Budget</th><th>Ã‰cart</th>`).join("")}
          <th class="dividerL">RÃ©el</th><th>Budget</th><th>Ã‰cart</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="col-client">Aucun budget chargÃ©</td>
          <td class="col-nclient">â€”</td>
          ${MONTHS.map(() => `<td class="num">â€”</td><td class="num">â€”</td><td class="num">â€”</td>`).join("")}
          <td class="num dividerL">â€”</td><td class="num">â€”</td><td class="num">â€”</td>
        </tr>
      </tbody>
    `;
  }

  function render(){
    if (!budgetData?.clients?.length){
      renderEmpty();
      syncBottomScrollbar();
      return;
    }

    const clients = budgetData.clients
      .filter(c => !filterText || (c.name||"").toLowerCase().includes(filterText) || String(c.nclient||"").toLowerCase().includes(filterText));

    el.clientsCount.textContent = String(budgetData.clients.length);

    const thead = `
      <thead>
        <tr>
          <th class="col-client">Client</th>
          <th class="col-nclient">N CLIENT</th>
          ${MONTHS.map(m => `<th colspan="3">${escapeHtml(m.label)}</th>`).join("")}
          <th class="dividerL" colspan="3">Cumul</th>
        </tr>
        <tr>
          <th class="col-client">â€”</th>
          <th class="col-nclient">â€”</th>
          ${MONTHS.map(() => `<th>RÃ©el</th><th>Budget</th><th>Ã‰cart</th>`).join("")}
          <th class="dividerL">RÃ©el</th><th>Budget</th><th>Ã‰cart</th>
        </tr>
      </thead>
    `;

    const cumulGlobal = computeCumulRow(clients);

    const tbodyRows = [];
    tbodyRows.push(renderCumulRow(cumulGlobal));
    for (const c of clients) tbodyRows.push(renderClientRow(c));

    el.table.innerHTML = thead + `<tbody>${tbodyRows.join("")}</tbody>`;
    syncBottomScrollbar();
  }

  function computeCumulRow(clients){
    const perMonth = {};
    for (const m of MONTHS){
      let sumBudget = 0;
      let sumReal = 0;
      for (const c of clients){
        sumBudget += Math.round(toNumber(c.budget?.[m.key]));
        sumReal += Math.round(toNumber(realData?.[c.id]?.[m.key]));
      }
      perMonth[m.key] = { real: sumReal, budget: sumBudget, ecart: sumReal - sumBudget };
    }

    const annualReal = MONTHS.reduce((a,m)=>a + perMonth[m.key].real, 0);
    const annualBudget = MONTHS.reduce((a,m)=>a + perMonth[m.key].budget, 0);

    return {
      name: "Cumul",
      perMonth,
      annual: { real: annualReal, budget: annualBudget, ecart: annualReal - annualBudget }
    };
  }

  function renderCumulRow(cumul){
    const cells = MONTHS.map(m => {
      const v = cumul.perMonth[m.key];
      return `
        <td class="num">${fmt(v.real)}</td>
        <td class="num budget">${fmt(v.budget)}</td>
        <td class="num ecart ${ecartClass(v.ecart)}">${fmt(v.ecart)}</td>
      `;
    }).join("");

    return `
      <tr class="row-cumul">
        <td class="col-client">Cumul</td>
        <td class="col-nclient">â€”</td>
        ${cells}
        <td class="num dividerL">${fmt(cumul.annual.real)}</td>
        <td class="num budget">${fmt(cumul.annual.budget)}</td>
        <td class="num ecart ${ecartClass(cumul.annual.ecart)}">${fmt(cumul.annual.ecart)}</td>
      </tr>
    `;
  }

  function renderClientRow(client){
    const annualBudget = MONTHS.reduce((a,m)=>a + Math.round(toNumber(client.budget?.[m.key])), 0);
    const annualReal = MONTHS.reduce((a,m)=>a + Math.round(toNumber(realData?.[client.id]?.[m.key])), 0);
    const annualEcart = annualReal - annualBudget;

    const cells = MONTHS.map(m => {
      const budget = Math.round(toNumber(client.budget?.[m.key]));
      const real = Math.round(toNumber(realData?.[client.id]?.[m.key]));
      const ecart = real - budget;

      return `
        <td class="num">${fmt(real)}</td>
        <td class="num budget">${fmt(budget)}</td>
        <td class="num ecart ${ecartClass(ecart)}">${fmt(ecart)}</td>
      `;
    }).join("");

    return `
      <tr>
        <td class="col-client">${escapeHtml(client.name)}</td>
        <td class="col-nclient">${escapeHtml(client.nclient || "â€”")}</td>
        ${cells}
        <td class="num dividerL">${fmt(annualReal)}</td>
        <td class="num budget">${fmt(annualBudget)}</td>
        <td class="num ecart ${ecartClass(annualEcart)}">${fmt(annualEcart)}</td>
      </tr>
    `;
  }

  function syncBottomScrollbar(){
    const w = el.table?.scrollWidth || 0;
    el.hScrollInner.style.width = w ? (w + "px") : "0px";
    el.hScroll.scrollLeft = el.tableScroller.scrollLeft;
  }

  // EXPORTS
  function buildExportRows(){
    if (!budgetData?.clients?.length) return [];
    const clients = budgetData.clients
      .filter(c => !filterText || (c.name||"").toLowerCase().includes(filterText) || String(c.nclient||"").toLowerCase().includes(filterText));

    const cumul = computeCumulRow(clients);
    const out = [];
    out.push(rowFromCumul(cumul));
    for (const c of clients) out.push(rowFromClient(c));
    return out;

    function rowFromCumul(c){
      const r = { CLIENT: "Cumul", "N CLIENT": "" };
      for (const m of MONTHS){
        const v = c.perMonth[m.key];
        r[`${m.label} RÃ©el`] = v.real;
        r[`${m.label} Budget`] = v.budget;
        r[`${m.label} Ã‰cart`] = v.ecart;
      }
      r["Cumul RÃ©el"] = c.annual.real;
      r["Cumul Budget"] = c.annual.budget;
      r["Cumul Ã‰cart"] = c.annual.ecart;
      return r;
    }

    function rowFromClient(c){
      const r = { CLIENT: c.name, "N CLIENT": c.nclient || "" };
      let annualB = 0, annualR = 0;
      for (const m of MONTHS){
        const b = Math.round(toNumber(c.budget?.[m.key]));
        const rr = Math.round(toNumber(realData?.[c.id]?.[m.key]));
        annualB += b; annualR += rr;
        r[`${m.label} RÃ©el`] = rr;
        r[`${m.label} Budget`] = b;
        r[`${m.label} Ã‰cart`] = rr - b;
      }
      r["Cumul RÃ©el"] = annualR;
      r["Cumul Budget"] = annualB;
      r["Cumul Ã‰cart"] = annualR - annualB;
      return r;
    }
  }

  function exportJSON(){
    const payload = {
      meta: loadJSON(STORAGE.budgetMeta, null),
      budget: budgetData,
      real: realData,
      realSource: REAL_FILE,
      exportedAt: new Date().toISOString()
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `reporting_annuel_gueudet_${stamp()}.json`
    );
  }

  function exportCSV(){
    const rows = buildExportRows();
    if (!rows.length) { alert("Rien Ã  exporter."); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";", RS: "\n" });
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `reporting_annuel_gueudet_${stamp()}.csv`
    );
  }

  function exportXLSX(){
    const rows = buildExportRows();
    if (!rows.length) { alert("Rien Ã  exporter."); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Reporting annuel Gueudet");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadBlob(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `reporting_annuel_gueudet_${stamp()}.xlsx`
    );
  }

  // HELPERS
  function loadJSON(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    }catch{
      return fallback;
    }
  }
  function saveJSON(key, val){
    localStorage.setItem(key, JSON.stringify(val));
  }

  function toNumber(v){
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v).trim();
    if (!s) return 0;
    const norm = s.replace(/\s/g, "").replace(",", ".");
    const n = Number(norm);
    return isFinite(n) ? n : 0;
  }

  function fmt(n){
    const val = Math.round(toNumber(n));
    return new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  }

  function ecartClass(v){
    const n = toNumber(v);
    if (n > 0) return "pos";
    if (n < 0) return "neg";
    return "zero";
  }

  function stamp(){
    const d = new Date();
    const pad = (x)=>String(x).padStart(2,"0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function formatDateTime(iso){
    try{
      const d = new Date(iso);
      return d.toLocaleString("fr-FR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
    }catch{
      return "â€”";
    }
  }

  function normKey(s){
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/\s+/g," ");
  }

  function compactClientCode(value){
    return normKey(value).replace(/[^a-z0-9]+/g,"").slice(0, 40);
  }

  function compactClientName(value){
    return String(value || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/g,"-")
      .replace(/(^-|-$)/g,"")
      .slice(0, 60);
  }

  function makeClientMatchKey(name, nclient){
    const nc = compactClientCode(nclient);
    const nm = compactClientName(name);
    if (nc && nm) return `client_${nc}__${nm}`;
    if (nc) return `nclient_${nc}`;
    if (nm) return `name_${nm}`;
    return "";
  }

  function makeClientKey(name, nclient){
    return makeClientMatchKey(name, nclient);
  }

  function addLookupCandidate(map, key, client){
    if (!key) return;
    const arr = map.get(key);
    if (arr) arr.push(client);
    else map.set(key, [client]);
  }

  function getUniqueLookupCandidate(map, key){
    if (!key) return null;
    const arr = map.get(key);
    return arr && arr.length === 1 ? arr[0] : null;
  }

  function findMatchedClient(exactMap, byCodeMap, byNameMap, nclient, name){
    const exactKey = makeClientMatchKey(name, nclient);
    if (exactKey && exactMap.has(exactKey)) return exactMap.get(exactKey);
    const byCode = getUniqueLookupCandidate(byCodeMap, compactClientCode(nclient));
    if (byCode) return byCode;
    return getUniqueLookupCandidate(byNameMap, compactClientName(name));
  }

  function normalizeBudgetClientIds(clients){
    if (!Array.isArray(clients)) return false;
    let changed = false;
    for (const client of clients){
      const nextId = makeClientKey(client?.name, client?.nclient);
      if (nextId && client.id !== nextId){
        client.id = nextId;
        changed = true;
      }
    }
    return changed;
  }

  function buildHeaderMap(sampleRow){
    const map = {};
    for (const k of Object.keys(sampleRow || {})){
      map[normalizeKey(k)] = k;
    }
    return map;
  }

  function normalizeKey(s){
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  }

  function findCol(headerMap, candidates){
    for (const c of candidates){
      const nk = normalizeKey(c);
      if (headerMap[nk]) return headerMap[nk];
    }
    return null;
  }

  function downloadBlob(blob, filename){
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function escapeHtml(str){
    return String(str ?? "").replace(/[&<>"']/g, s => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[s]));
  }

  /* =========================
     GitHub-safe XLSX fetch
  ========================= */
  async function fetchXlsxWithFallback(fileName){
    const pageDir = location.href.replace(/[#?].*$/,"").replace(/\/[^\/]*$/, "/");
    const urlSame = new URL(fileName, pageDir).toString();
    const urlData = new URL("data/" + fileName, pageDir).toString();

    const candidates = [urlSame, urlData];
    let lastErr = "";

    for (const base of candidates){
      const url = base + (base.includes("?") ? "&" : "?") + "v=" + Date.now();
      const res = await fetch(url, { cache:"no-store" });
      const buf = await res.arrayBuffer();

      if (!res.ok){
        lastErr = `HTTP ${res.status} sur ${base}`;
        continue;
      }

      const sniff = sniffBuffer(buf);
      if (sniff.looksHtml || !sniff.isZip){
        lastErr = `Contenu invalide sur ${base} (HTML/404 ou pas XLSX)`;
        continue;
      }

      return { buffer: buf, usedUrl: base };
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

})();

