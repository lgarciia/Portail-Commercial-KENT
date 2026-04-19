
(function(){
  // =========================
  // CONFIG
  // =========================
  const ENTITY_KEY = "psa";
  const APP_YEAR = KentDataConfig.getActiveYear();
  const PREV_YEAR = KentDataConfig.getPreviousYear(APP_YEAR);
  const FILE_CANDIDATES = KentDataConfig.getEntityFileCandidates(ENTITY_KEY, "realN1", APP_YEAR);
  const FILE_NAME = FILE_CANDIDATES[0];
  const STORAGE = KentDataConfig.getStorageKeys(ENTITY_KEY, APP_YEAR);
  const TARGET_STORAGE = KentDataConfig.getStorageKeys(ENTITY_KEY, PREV_YEAR);
  const STORAGE_KEY = KentDataConfig.buildStorageKey("ACTIVITE_REEL_N1", ENTITY_KEY, APP_YEAR);
  const LEGACY_STORAGE_KEY = `KENT_ACTIVITE_REEL_N1_PSA_${APP_YEAR}_V1`;
  const STORAGE_KEY_CANDIDATES = [
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    TARGET_STORAGE.activityPivot.primary
  ].concat(TARGET_STORAGE.activityPivot.legacy);
  const EXPORT_STEM = `activite_reelle_psa_n1_${PREV_YEAR}`;

  const MONTHS = [
    { key: "jan", label: "Janvier", aliases: ["janvier","jan"] },
    { key: "feb", label: "FÃ©vrier", aliases: ["fÃ©vrier","fevrier","fÃ©v","fev"] },
    { key: "mar", label: "Mars", aliases: ["mars","mar"] },
    { key: "apr", label: "Avril", aliases: ["avril","avr"] },
    { key: "may", label: "Mai", aliases: ["mai"] },
    { key: "jun", label: "Juin", aliases: ["juin"] },
    { key: "jul", label: "Juillet", aliases: ["juillet","juil"] },
    { key: "aug", label: "AoÃ»t", aliases: ["aoÃ»t","aout","aoÃ»","aou"] },
    { key: "sep", label: "Septembre", aliases: ["septembre","sep","sept"] },
    { key: "oct", label: "Octobre", aliases: ["octobre","oct"] },
    { key: "nov", label: "Novembre", aliases: ["novembre","nov"] },
    { key: "dec", label: "DÃ©cembre", aliases: ["dÃ©cembre","decembre","dÃ©c","dec"] },
  ];

  // =========================
  // DOM
  // =========================
  const el = {
    fileInput: document.getElementById("fileInput"),
    btnReload: document.getElementById("btnReload"),
    btnExportXlsx: document.getElementById("btnExportXlsx"),
    btnExportCsv: document.getElementById("btnExportCsv"),
    btnExportJson: document.getElementById("btnExportJson"),
    btnReset: document.getElementById("btnReset"),
    srcLabel: document.getElementById("srcLabel"),
    clientsCount: document.getElementById("clientsCount"),
    lastUpdate: document.getElementById("lastUpdate"),
    title: document.getElementById("pageTitle"),
    subtitle: document.querySelector(".titleWrap .subtitle"),
    note: document.querySelector(".mutedNote"),
    search: document.getElementById("search"),
    dropZone: document.getElementById("dropZone"),
    dropHint: document.getElementById("dropHint"),
    table: document.getElementById("pivotTable"),
  };

  // =========================
  // STATE
  // =========================
  document.title = `RÃ©el N-1 ${PREV_YEAR} â€” PSA`;
  if (el.title) el.title.textContent = "RÃ©el N-1 â€” PSA";
  if (el.subtitle) {
    el.subtitle.textContent = `Budget ${APP_YEAR} â€¢ fichier attendu ${FILE_NAME} â€¢ montants agrÃ©gÃ©s par client et par mois`;
  }
  if (el.note) {
    el.note.innerHTML = `Colonnes acceptÃ©es dans lâ€™Excel : <strong>NÂ° client Interne</strong> ou <strong>Code livrÃ©</strong> â€¢ <strong>Nom du client</strong> ou <strong>Nom client</strong> â€¢ <strong>Montant prix achat KENT</strong> ou <strong>CA Total</strong> â€¢ <strong>Mois2</strong>.<br>Vue N-1 basÃ©e sur le budget ${APP_YEAR}, avec lecture directe de <strong>${FILE_NAME}</strong>.`;
  }
  el.btnReload.textContent = `Charger / Recharger ${FILE_NAME}`;
  el.dropHint.textContent = `DÃ©pose ${FILE_NAME} pour recharger`;

  let pivot = loadJSONAny(STORAGE_KEY_CANDIDATES, null); // { meta, clients: [{id, clientInternal, clientName, months:{jan:number...}}] }
  let filterText = "";
  let sortTotalDir = null; // null => no sort, "desc" or "asc"

  // =========================
  // INIT
  // =========================
  if (pivot?.clients?.length) render();
  else renderEmpty(`Aucune donnÃ©e. Charge ${FILE_NAME}.`);

  autoFetchExcel(); // best effort

  // =========================
  // EVENTS
  // =========================
  el.btnReload.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    el.fileInput.value = "";
    await importFromFile(file);
  });

  el.search.addEventListener("input", () => {
    filterText = (el.search.value || "").trim().toLowerCase();
    render();
  });

  el.btnReset.addEventListener("click", () => {
    if (!confirm(`Supprimer les donnÃ©es RÃ©el N-1 PSA (${PREV_YEAR}) stockÃ©es en local ?`)) return;
    removeStorageKeys(STORAGE_KEY_CANDIDATES);
    pivot = null;
    sortTotalDir = null;
    renderEmpty(`DonnÃ©es locales supprimÃ©es. Recharge ${FILE_NAME}.`);
  });

  el.btnExportJson.addEventListener("click", () => exportJSON());
  el.btnExportCsv.addEventListener("click", () => exportCSV());
  el.btnExportXlsx.addEventListener("click", () => exportXLSX());

  // Drag & drop
  ["dragenter","dragover"].forEach(evt => el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dropHint.classList.add("show");
  }));
  ["dragleave","drop"].forEach(evt => el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
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
    await importFromFile(file);
  });

  // =========================
  // AUTO FETCH FROM REPO
  // =========================
  async function autoFetchExcel(){
    let lastError = "";
    for (const candidate of FILE_CANDIDATES){
      try{
        const res = await fetch(candidate, { cache: "no-store" });
        if (!res.ok){
          lastError = `HTTP ${res.status} sur ${candidate}`;
          continue;
        }
        const buf = await res.arrayBuffer();
        parseAndBuildPivot(buf, `auto (${candidate})`);
        return;
      }catch(err){
        lastError = err?.message || String(err || "");
      }
    }

    if (!pivot?.clients?.length){
      el.srcLabel.textContent = FILE_NAME;
      el.lastUpdate.textContent = "Ã©chec auto";
      renderEmpty(`Aucune donnÃ©e. VÃ©rifie ${FILE_NAME}.`);
      if (lastError) console.warn(lastError);
    }
  }

  // =========================
  // IMPORT FILE
  // =========================
  async function importFromFile(file){
    try{
      const buf = await file.arrayBuffer();
      parseAndBuildPivot(buf, `manuel (${file.name || FILE_NAME})`);
    }catch(err){
      console.error(err);
      alert("Import impossible : " + (err?.message || err));
    }
  }

  // =========================
  // PARSE + PIVOT (SANS QUANTITÃ‰S)
  // =========================
  function parseAndBuildPivot(arrayBuffer, sourceLabel){
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!rows.length){
      renderEmpty("Fichier vide.");
      return;
    }

    const headerMap = buildHeaderMap(rows[0]);

    const colClientInterne = findCol(headerMap, [
      "nÂ° client interne","no client interne","n client interne","nÂ° client","numero client interne",
      "code livrÃ©","code livre","code"
    ]);
    const colNomClient = findCol(headerMap, ["nom du client","nom client","client"]);
    const colMontant = findCol(headerMap, [
      "montant prix achat kent","montant achat kent","montant",
      "ca total","ca","chiffre d'affaires","chiffre daffaires"
    ]);
    const colMois = findCol(headerMap, ["mois2","mois"]);

    if (!colClientInterne || !colNomClient || !colMontant || !colMois){
      const missing = [
        !colClientInterne ? "NÂ° client Interne / Code livrÃ©" : null,
        !colNomClient ? "Nom du client / Nom client" : null,
        !colMontant ? "Montant prix achat KENT / CA Total" : null,
        !colMois ? "Mois2" : null,
      ].filter(Boolean).join(", ");
      renderEmpty("Colonnes manquantes : " + missing);
      return;
    }

    const agg = new Map();

    for (const r of rows){
      const clientInternal = String(r[colClientInterne] ?? "").trim();
      const clientName = String(r[colNomClient] ?? "").trim();
      const moisRaw = String(r[colMois] ?? "").trim();

      if (!clientInternal && !clientName) continue;

      const mk = normalizeMonthToKey(moisRaw);
      if (!mk) continue;

      const montant = toNumber(r[colMontant]);

      const id = makeClientId(clientInternal, clientName);

      if (!agg.has(id)){
        const months = {};
        for (const m of MONTHS) months[m.key] = 0;
        agg.set(id, { id, clientInternal, clientName, months });
      }

      const item = agg.get(id);
      item.months[mk] += montant;
    }

    const clients = Array.from(agg.values())
      .sort((a,b) => (a.clientName || "").localeCompare((b.clientName || ""), "fr"));

    pivot = {
      meta: {
        source: sourceLabel,
        sheet: sheetName,
        updatedAt: new Date().toISOString(),
        file: FILE_NAME
      },
      clients
    };

    saveJSON(STORAGE_KEY, pivot);
    saveJSON(LEGACY_STORAGE_KEY, pivot);
    sortTotalDir = null; // reset tri Ã  l'import
    render();
  }

  function normalizeMonthToKey(value){
    const v = normalizeKey(value);
    if (!v) return null;
    for (const m of MONTHS){
      for (const a of m.aliases){
        if (v === normalizeKey(a)) return m.key;
      }
    }
    return null;
  }

  // =========================
  // TOTAL CALC
  // =========================
  function getClientTotal(c){
    let t = 0;
    for (const m of MONTHS) t += toNumber(c.months?.[m.key]);
    return t;
  }

  // =========================
  // RENDER (2 colonnes sÃ©parÃ©es + TOTAL + ligne total)
  // =========================
  function renderEmpty(msg){
    el.clientsCount.textContent = "0";
    el.srcLabel.textContent = pivot?.meta?.source || `Cible auto : ${FILE_NAME}`;
    el.lastUpdate.textContent = "â€”";

    el.table.innerHTML = `
      <thead>
        <tr>
          <th class="col-sticky" style="min-width:160px;">NÂ° client</th>
          <th class="col-sticky2" style="min-width:360px;">Nom du client</th>
          ${MONTHS.map(m => `<th>${escapeHtml(m.label)}</th>`).join("")}
          <th class="col-total">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="col-sticky">â€”</td>
          <td class="col-sticky2">${escapeHtml(msg || "Aucune donnÃ©e.")}</td>
          ${MONTHS.map(() => `<td class="num">â€”</td>`).join("")}
          <td class="num col-total">â€”</td>
        </tr>
      </tbody>
    `;
  }

  function render(){
    if (!pivot?.clients?.length){
      renderEmpty(`Aucune donnÃ©e. Charge ${FILE_NAME}.`);
      return;
    }

    el.srcLabel.textContent = pivot.meta?.source || "â€”";
    el.lastUpdate.textContent = formatDateTime(pivot.meta?.updatedAt);
    el.clientsCount.textContent = String(pivot.clients.length);

    let clients = pivot.clients.filter(c => {
      if (!filterText) return true;
      const a = (c.clientInternal || "").toLowerCase();
      const b = (c.clientName || "").toLowerCase();
      return a.includes(filterText) || b.includes(filterText);
    });

    // tri si activÃ©
    if (sortTotalDir === "desc"){
      clients = clients.slice().sort((a,b) => getClientTotal(b) - getClientTotal(a));
    } else if (sortTotalDir === "asc"){
      clients = clients.slice().sort((a,b) => getClientTotal(a) - getClientTotal(b));
    }

    // Totaux colonne + total gÃ©nÃ©ral
    const colSums = {};
    for (const m of MONTHS) colSums[m.key] = 0;
    let grandTotal = 0;

    // head (TOTAL clickable)
    const sortArrow = sortTotalDir === "desc" ? "â–¼" : (sortTotalDir === "asc" ? "â–²" : "â†•");
    const thead = `
      <thead>
        <tr>
          <th class="col-sticky" style="min-width:160px;">NÂ° client</th>
          <th class="col-sticky2" style="min-width:360px;">Nom du client</th>
          ${MONTHS.map(m => `<th>${escapeHtml(m.label)}</th>`).join("")}
          <th class="col-total sortable" id="thTotal">
            <span class="sortHint">TOTAL <span class="chev">${sortArrow}</span></span>
          </th>
        </tr>
      </thead>
    `;

    const tbodyRows = clients.map(c => {
      let rowTotal = 0;

      const cells = MONTHS.map(m => {
        const v = toNumber(c.months?.[m.key]);
        colSums[m.key] += v;
        rowTotal += v;
        return `<td class="num">${fmt0(v)}</td>`;
      }).join("");

      grandTotal += rowTotal;

      return `
        <tr>
          <td class="col-sticky">${escapeHtml(c.clientInternal || "")}</td>
          <td class="col-sticky2">${escapeHtml(c.clientName || "")}</td>
          ${cells}
          <td class="num col-total">${fmt0(rowTotal)}</td>
        </tr>
      `;
    }).join("");

    // ligne total en bas
    const footerCells = MONTHS.map(m => `<td class="num">${fmt0(colSums[m.key])}</td>`).join("");
    const tbodyFooter = `
      <tr class="row-total">
        <td class="col-sticky">TOTAL</td>
        <td class="col-sticky2">â€”</td>
        ${footerCells}
        <td class="num col-total">${fmt0(grandTotal)}</td>
      </tr>
    `;

    el.table.innerHTML = thead + `<tbody>${tbodyRows}${tbodyFooter}</tbody>`;

    // bind tri au clic sur TOTAL
    const thTotal = document.getElementById("thTotal");
    if (thTotal){
      thTotal.addEventListener("click", () => {
        // cycle: null -> desc -> asc -> desc ...
        if (sortTotalDir === null) sortTotalDir = "desc";
        else if (sortTotalDir === "desc") sortTotalDir = "asc";
        else sortTotalDir = "desc";
        render();
      }, { passive:true });
    }
  }

  // =========================
  // EXPORTS (inchangÃ©s)
  // =========================
  function exportJSON(){
    if (!pivot?.clients?.length) { alert("Rien Ã  exporter."); return; }
    downloadBlob(
      new Blob([JSON.stringify(pivot, null, 2)], { type: "application/json" }),
      `${EXPORT_STEM}_${stamp()}.json`
    );
  }

  function exportCSV(){
    if (!pivot?.clients?.length) { alert("Rien Ã  exporter."); return; }

    const rows = pivot.clients.map(c => {
      const r = {
        "NÂ° client Interne": c.clientInternal || "",
        "Nom du client": c.clientName || "",
      };
      for (const m of MONTHS) r[m.label] = Math.round(toNumber(c.months?.[m.key]));
      // ajout TOTAL Ã  l'export (logique)
      r["TOTAL"] = Math.round(getClientTotal(c));
      return r;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";", RS: "\n" });
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${EXPORT_STEM}_${stamp()}.csv`);
  }

  function exportXLSX(){
    if (!pivot?.clients?.length) { alert("Rien Ã  exporter."); return; }

    const rows = pivot.clients.map(c => {
      const r = {
        "NÂ° client Interne": c.clientInternal || "",
        "Nom du client": c.clientName || "",
      };
      for (const m of MONTHS) r[m.label] = toNumber(c.months?.[m.key]);
      r["TOTAL"] = getClientTotal(c);
      return r;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "ActivitÃ© RÃ©elle (Pivot)");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadBlob(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${EXPORT_STEM}_${stamp()}.xlsx`
    );
  }

  // =========================
  // HELPERS
  // =========================
  function loadJSON(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    }catch{
      return fallback;
    }
  }

  function loadJSONAny(keys, fallback){
    for (const key of keys){
      const value = loadJSON(key, null);
      if (value) return value;
    }
    return fallback;
  }

  function saveJSON(key, val){
    localStorage.setItem(key, JSON.stringify(val));
  }

  function removeStorageKeys(keys){
    for (const key of keys){
      try{ localStorage.removeItem(key); }catch(e){}
    }
  }

  function toNumber(v){
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v).trim();
    if (!s) return 0;
    const norm = s.replace(/\s/g,"").replace(",",".");
    const n = Number(norm);
    return isFinite(n) ? n : 0;
  }

  function fmt0(n){
    return String(Math.round(toNumber(n)));
  }

  function normalizeKey(s){
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g," ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  }

  function buildHeaderMap(sampleRow){
    const map = {};
    for (const k of Object.keys(sampleRow || {})){
      map[normalizeKey(k)] = k;
    }
    return map;
  }

  function findCol(headerMap, candidates){
    for (const c of candidates){
      const nk = normalizeKey(c);
      if (headerMap[nk]) return headerMap[nk];
    }
    return null;
  }

  function makeClientId(clientInternal, clientName){
    const a = normalizeKey(clientInternal).replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
    const b = normalizeKey(clientName).replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
    return (a || "noid") + "__" + (b || "noname");
  }

  function formatDateTime(iso){
    try{
      const d = new Date(iso);
      return d.toLocaleString("fr-FR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
    }catch{
      return "â€”";
    }
  }

  function stamp(){
    const d = new Date();
    const pad = (x)=>String(x).padStart(2,"0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
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

})();

