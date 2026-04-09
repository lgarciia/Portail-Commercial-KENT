
(function(){
  // =========================
  // CONFIG
  // =========================
  const FILE_NAME = "activitereelgueudet.xlsx"; // nom exact sur GitHub Pages

  // Pivot page ActivitÃ© RÃ©elle
  const STORAGE_KEY_PIVOT = "ACTIVITE_REEL_GUEUDET_2026_V1";

  // âœ… ClÃ© attendue par ton reporting annuel Gueudet
  const STORAGE_KEY_REPORTING_GUEUDET = "ACTIVITEREEL_GUEUDET_V1";

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
    if (!confirm("Supprimer les donnÃ©es ActivitÃ© RÃ©elle Gueudet stockÃ©es en local ?")) return;
    localStorage.removeItem(STORAGE_KEY_PIVOT);
    localStorage.removeItem(STORAGE_KEY_REPORTING_GUEUDET);
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
  // AUTO FETCH (GitHub-safe + anti-cache)
  // =========================
  async function autoFetchExcel(){
    try{
      const url = `${FILE_NAME}?v=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const buf = await res.arrayBuffer();

      // petit check "PK" (zip) pour Ã©viter de parser une 404 html
      if (!looksLikeZip(buf)) return;

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

    // âœ… Colonnes attendues (format PSA-like)
    const colClientInterne = findCol(headerMap, [
      "nÂ° client interne","no client interne","n client interne","numero client interne",
      // parfois juste n client
      "nÂ° client","no client","n client","numero client","nclient"
    ]);

    const colNomClient = findCol(headerMap, [
      "nom du client","nom client","client"
    ]);

    const colMontant = findCol(headerMap, [
      "montant prix achat kent","montant achat kent","montant",
      // parfois ca
      "ca total","ca","chiffre d'affaires","chiffre daffaires"
    ]);

    const colMois = findCol(headerMap, [
      "mois2","mois","month"
    ]);

    if (!colClientInterne || !colNomClient || !colMontant || !colMois){
      const missing = [
        !colClientInterne ? "NÂ° client Interne" : null,
        !colNomClient ? "Nom du client" : null,
        !colMontant ? "Montant prix achat KENT" : null,
        !colMois ? "Mois2" : null,
      ].filter(Boolean).join(", ");
      renderEmpty("Colonnes manquantes : " + missing);
      return;
    }

    const agg = new Map();

    for (const r of rows){
      // âœ… FIX: on utilise les bonnes colonnes (plus de colCodeLivre / colCA fantÃ´mes)
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

    saveJSON(STORAGE_KEY_PIVOT, pivot);

    // âœ… Bridge vers reporting annuel Gueudet
    saveActiviteReelGueudetFromPivot(pivot);

    sortTotalDir = null;
    render();
    updateSyncLabel();
  }

  function normalizeMonthToKey(value){
    // âœ… support Mois2 numÃ©rique (1..12)
    const n = Number(String(value || "").trim());
    if (Number.isFinite(n) && n >= 1 && n <= 12) return MONTHS[n-1].key;

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
  // âœ… BRIDGE vers reporting annuel GUEUDET
  // =========================
  function saveActiviteReelGueudetFromPivot(p){
    const nowIso = new Date().toISOString();
    const clients = (p?.clients || []).map(c => ({
      clientKey: makeReportingClientKey(c.clientInternal, c.clientName),
      nclient: String(c.clientInternal || "").trim(), // âœ… clÃ© stable
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
        source: "activitereelgueudet.html",
        updatedAt: nowIso,
        fromPivotKey: STORAGE_KEY_PIVOT,
        sheet: p?.meta?.sheet || "",
        file: p?.meta?.file || FILE_NAME
      },
      clients
    };

    localStorage.setItem(STORAGE_KEY_REPORTING_GUEUDET, JSON.stringify(payload));
    return payload;
  }

  function updateSyncLabel(){
    const payload = loadJSON(STORAGE_KEY_REPORTING_GUEUDET, null);
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

    el.table.innerHTML = `
      <thead>
        <tr>
          <th class="col-sticky">Code livrÃ©</th>
          <th class="col-sticky2">Nom client</th>
          ${MONTHS.map(m => `<th>${escapeHtml(m.label)}</th>`).join("")}
          <th class="col-total clickable" id="thTotal">TOTAL ${sortArrow}</th>
        </tr>
      </thead>
      <tbody>
        ${clients.map(c => {
          let t = 0;
          const cells = MONTHS.map(m => {
            const v = Math.round(toNumber(c.months?.[m.key]));
            colSums[m.key] += v;
            t += v;
            return `<td class="num">${formatInt(v)}</td>`;
          }).join("");
          grandTotal += t;
          return `
            <tr>
              <td class="col-sticky">${escapeHtml(c.clientInternal || "â€”")}</td>
              <td class="col-sticky2">${escapeHtml(c.clientName || "â€”")}</td>
              ${cells}
              <td class="num col-total">${formatInt(t)}</td>
            </tr>
          `;
        }).join("")}

        <tr>
          <td class="col-sticky">TOTAL</td>
          <td class="col-sticky2">â€”</td>
          ${MONTHS.map(m => `<td class="num col-total">${formatInt(colSums[m.key])}</td>`).join("")}
          <td class="num col-total">${formatInt(grandTotal)}</td>
        </tr>
      </tbody>
    `;

    const thTotal = document.getElementById("thTotal");
    if (thTotal){
      thTotal.addEventListener("click", () => {
        sortTotalDir = sortTotalDir === "desc" ? "asc" : (sortTotalDir === "asc" ? null : "desc");
        render();
      });
    }
  }

  // =========================
  // EXPORTS
  // =========================
  function exportJSON(){
    if (!pivot?.clients?.length) return alert("Aucune donnÃ©e.");
    downloadBlob(JSON.stringify(pivot, null, 2), `activitereel-gueudet-pivot.json`, "application/json");
  }

  function exportCSV(){
    if (!pivot?.clients?.length) return alert("Aucune donnÃ©e.");
    const headers = ["Code livrÃ©","Nom client", ...MONTHS.map(m=>m.label), "TOTAL"];
    const lines = [headers.join(";")];
    for (const c of pivot.clients){
      const row = [];
      row.push(csvEscape(c.clientInternal || ""));
      row.push(csvEscape(c.clientName || ""));
      let total = 0;
      for (const m of MONTHS){
        const v = Math.round(toNumber(c.months?.[m.key]));
        total += v;
        row.push(String(v));
      }
      row.push(String(total));
      lines.push(row.join(";"));
    }
    downloadBlob(lines.join("\n"), `activitereel-gueudet-pivot.csv`, "text/csv;charset=utf-8");
  }

  function exportXLSX(){
    if (!pivot?.clients?.length) return alert("Aucune donnÃ©e.");
    const aoa = [];
    aoa.push(["Code livrÃ©","Nom client", ...MONTHS.map(m=>m.label), "TOTAL"]);
    for (const c of pivot.clients){
      const row = [c.clientInternal || "", c.clientName || ""];
      let total = 0;
      for (const m of MONTHS){
        const v = Math.round(toNumber(c.months?.[m.key]));
        total += v;
        row.push(v);
      }
      row.push(total);
      aoa.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pivot");
    XLSX.writeFile(wb, "activitereel-gueudet-pivot.xlsx");
  }

  // =========================
  // HELPERS (structure propre)
  // =========================
  function buildHeaderMap(rowObj){
    const map = new Map();
    for (const k of Object.keys(rowObj || {})){
      map.set(normalizeKey(k), k);
    }
    return map;
  }

  function findCol(headerMap, candidates){
    for (const c of candidates){
      const key = normalizeKey(c);
      if (headerMap.has(key)) return headerMap.get(key);
    }
    return null;
  }

  function normalizeKey(str){
    return String(str || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[â€™'"]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function makeClientId(code, name){
    const a = normalizeKey(code);
    const b = normalizeKey(name);
    return (a || b || "client") + "::" + (b || a || "");
  }

  function makeReportingClientKey(code, name){
    const a = normalizeKey(code).replace(/[^a-z0-9]+/g,"").slice(0, 40);
    const b = normalizeKey(name).replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0, 60);
    if (a && b) return `client_${a}__${b}`;
    if (a) return `nclient_${a}`;
    if (b) return `name_${b}`;
    return "";
  }

  function toNumber(v){
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const s = String(v ?? "").trim();
    if (!s) return 0;
    const clean = s.replace(/\s/g, "").replace(/\u00A0/g,"").replace(",", ".");
    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  }

  function formatInt(n){
    const x = Math.round(toNumber(n));
    return x.toLocaleString("fr-FR", { maximumFractionDigits:0 });
  }

  function formatDateTime(iso){
    if (!iso) return "â€”";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "â€”";
    return d.toLocaleString("fr-FR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }

  function escapeHtml(str){
    return String(str ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function csvEscape(str){
    const s = String(str ?? "");
    if (/[;"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }

  function downloadBlob(content, filename, mime){
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function saveJSON(key, obj){
    localStorage.setItem(key, JSON.stringify(obj));
  }

  function loadJSON(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    }catch{
      return fallback;
    }
  }

  function looksLikeZip(arrayBuffer){
    try{
      const u8 = new Uint8Array(arrayBuffer);
      return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4B; // 'PK'
    }catch{
      return false;
    }
  }

})();

