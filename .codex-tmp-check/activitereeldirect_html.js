
(function(){
  // =========================
  // CONFIG
  // =========================
  const FILE_NAME = "activitereeldirect.xlsx"; // â† mets le nom exact de ton fichier si diffÃ©rent

  // Pivot historique
  const STORAGE_KEY_PIVOT = "ACTIVITE_REEL_DIRECT_2026_V1";

  // âœ… ClÃ© attendue par ton reporting annuel Direct
  const STORAGE_KEY_REPORTING_DIRECT = "ACTIVITEREEL_DIRECT_V1";

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
    syncLabel: document.getElementById("syncLabel"),

    search: document.getElementById("search"),
    dropZone: document.getElementById("dropZone"),
    dropHint: document.getElementById("dropHint"),
    table: document.getElementById("pivotTable"),
  };

  // =========================
  // STATE
  // =========================
  let pivot = loadJSON(STORAGE_KEY_PIVOT, null);
  let filterText = "";
  let sortTotalDir = null;

  // =========================
  // INIT
  // =========================
  if (pivot?.clients?.length) {
    render();
    updateSyncLabel();
  } else {
    renderEmpty("Aucune donnÃ©e. Charge le fichier.");
    updateSyncLabel();
  }

  autoFetchExcel();

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
    if (!confirm("Supprimer les donnÃ©es ActivitÃ© RÃ©elle Direct stockÃ©es en local ?")) return;
    localStorage.removeItem(STORAGE_KEY_PIVOT);
    localStorage.removeItem(STORAGE_KEY_REPORTING_DIREC);
    pivot = null;
    sortTotalDir = null;
    renderEmpty("DonnÃ©es locales supprimÃ©es. Recharge le fichier.");
    updateSyncLabel();
  });

  el.btnExportJson.addEventListener("click", exportJSON);
  el.btnExportCsv.addEventListener("click", exportCSV);
  el.btnExportXlsx.addEventListener("click", exportXLSX);

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
  // AUTO FETCH
  // =========================
  async function autoFetchExcel(){
    try{
      const res = await fetch(FILE_NAME, { cache: "no-store" });
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      parseAndBuildPivot(buf, `auto (${FILE_NAME})`);
    }catch{
      // silent
    }
  }

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
  // PARSE + PIVOT
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

    // âœ… Colonnes Direct
    const colCodeLivre = findCol(headerMap, ["code livrÃ©","code livre","code"]);
    const colNomClient = findCol(headerMap, ["nom client","nom du client","client"]);
    const colCA = findCol(headerMap, ["ca total","ca","chiffre d'affaires","chiffre daffaires"]);
    const colMois = findCol(headerMap, ["mois2","mois"]);

    if (!colCodeLivre || !colNomClient || !colCA || !colMois){
      const missing = [
        !colCodeLivre ? "Code livrÃ©" : null,
        !colNomClient ? "Nom client" : null,
        !colCA ? "CA Total" : null,
        !colMois ? "mois2" : null,
      ].filter(Boolean).join(", ");
      renderEmpty("Colonnes manquantes : " + missing);
      return;
    }

    const agg = new Map();

    for (const r of rows){
      const clientInternal = String(r[colCodeLivre] ?? "").trim();
      const clientName = String(r[colNomClient] ?? "").trim();
      const moisRaw = String(r[colMois] ?? "").trim();
      if (!clientInternal && !clientName) continue;

      const mk = normalizeMonthToKey(moisRaw);
      if (!mk) continue;

      const montant = toNumber(r[colCA]);
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

    saveJSON(STORAGE_KEY_PIVOT, pivot);

    // âœ… Bridge vers reporting annuel Direct (format identique PSA)
    saveActiviteReelDirectFromPivot(pivot);

    sortTotalDir = null;
    render();
    updateSyncLabel();
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
  // âœ… BRIDGE vers reporting annuel Direct
  // =========================
  function saveActiviteReelDirectFromPivot(p){
    const nowIso = new Date().toISOString();
    const clients = (p?.clients || []).map(c => ({
      clientKey: makeReportingClientKey(c.clientInternal, c.clientName),
      nclient: String(c.clientInternal || "").trim(), // âœ… clÃ© stable = Code livrÃ©
      name: String(c.clientName || "").trim(),
      months: {
        jan: toNumber(c.months?.jan), feb: toNumber(c.months?.feb), mar: toNumber(c.months?.mar),
        apr: toNumber(c.months?.apr), may: toNumber(c.months?.may), jun: toNumber(c.months?.jun),
        jul: toNumber(c.months?.jul), aug: toNumber(c.months?.aug), sep: toNumber(c.months?.sep),
        oct: toNumber(c.months?.oct), nov: toNumber(c.months?.nov), dec: toNumber(c.months?.dec),
      }
    }));

    const payload = {
      meta: {
        source: "activitereeldirect.html",
        updatedAt: nowIso,
        fromPivotKey: STORAGE_KEY_PIVOT,
        sheet: p?.meta?.sheet || "",
        file: p?.meta?.file || FILE_NAME
      },
      clients
    };

    localStorage.setItem(STORAGE_KEY_REPORTING_DIRECT, JSON.stringify(payload));
    return payload;
  }

  function updateSyncLabel(){
    const payload = loadJSON(STORAGE_KEY_REPORTING_DIRECT, null);
    if (payload?.clients?.length){
      el.syncLabel.textContent = `OK (${payload.clients.length})`;
    } else {
      el.syncLabel.textContent = "â€”";
    }
  }

  // =========================
  // TOTAL
  // =========================
  function getClientTotal(c){
    let t = 0;
    for (const m of MONTHS) t += toNumber(c.months?.[m.key]);
    return t;
  }

  // =========================
  // RENDER
  // =========================
  function renderEmpty(msg){
    el.clientsCount.textContent = "0";
    el.srcLabel.textContent = pivot?.meta?.source || "â€”";
    el.lastUpdate.textContent = "â€”";

    el.table.innerHTML = `
      <thead>
        <tr>
          <th class="col-sticky" style="min-width:160px;">Code livrÃ©</th>
          <th class="col-sticky2" style="min-width:360px;">Nom client</th>
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
      renderEmpty("Aucune donnÃ©e. Charge le fichier.");
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

    if (sortTotalDir === "desc"){
      clients = clients.slice().sort((a,b) => getClientTotal(b) - getClientTotal(a));
    } else if (sortTotalDir === "asc"){
      clients = clients.slice().sort((a,b) => getClientTotal(a) - getClientTotal(b));
    }

    const colSums = {};
    for (const m of MONTHS) colSums[m.key] = 0;
    let grandTotal = 0;

    const sortArrow = sortTotalDir === "desc" ? "â–¼" : (sortTotalDir === "asc" ? "â–²" : "â†•");
    const thead = `
      <thead>
        <tr>
          <th class="col-sticky" style="min-width:160px;">Code livrÃ©</th>
          <th class="col-sticky2" style="min-width:360px;">Nom client</th>
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

    const thTotal = document.getElementById("thTotal");
    if (thTotal){
      thTotal.addEventListener("click", () => {
        if (sortTotalDir === null) sortTotalDir = "desc";
        else if (sortTotalDir === "desc") sortTotalDir = "asc";
        else sortTotalDir = "desc";
        render();
      }, { passive:true });
    }
  }

  // =========================
  // EXPORTS
  // =========================
  function exportJSON(){
    if (!pivot?.clients?.length) { alert("Rien Ã  exporter."); return; }
    downloadBlob(
      new Blob([JSON.stringify(pivot, null, 2)], { type: "application/json" }),
      `activite_reelle_direct_${stamp()}.json`
    );
  }

  function exportCSV(){
    if (!pivot?.clients?.length) { alert("Rien Ã  exporter."); return; }

    const rows = pivot.clients.map(c => {
      const r = {
        "Code livrÃ©": c.clientInternal || "",
        "Nom client": c.clientName || "",
      };
      for (const m of MONTHS) r[m.label] = Math.round(toNumber(c.months?.[m.key]));
      r["TOTAL"] = Math.round(getClientTotal(c));
      return r;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";", RS: "\n" });
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `activite_reelle_direct_${stamp()}.csv`);
  }

  function exportXLSX(){
    if (!pivot?.clients?.length) { alert("Rien Ã  exporter."); return; }

    const rows = pivot.clients.map(c => {
      const r = {
        "Code livrÃ©": c.clientInternal || "",
        "Nom client": c.clientName || "",
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
      `activite_reelle_direct_${stamp()}.xlsx`
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

  function saveJSON(key, val){
    localStorage.setItem(key, JSON.stringify(val));
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
    const val = Math.round(toNumber(n));
    return new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
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

  function makeReportingClientKey(clientInternal, clientName){
    const a = normalizeKey(clientInternal).replace(/[^a-z0-9]+/g,"").slice(0, 60);
    const b = normalizeKey(clientName).replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0, 80);
    if (a && b) return `code_${a}__${b}`;
    if (a) return `code_${a}`;
    if (b) return `name_${b}`;
    return "";
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

