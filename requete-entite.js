(function(){
  const PAGE_PARAMS = new URLSearchParams(location.search);
  const Config = window.KentDataConfig || {
    getActiveYear: () => new Date().getFullYear(),
    setActiveYear: (year) => Number.isFinite(Number(year)) ? Number(year) : new Date().getFullYear(),
    fillYearSelect: (select, options = {}) => {
      const selected = Number(options.selectedYear) || new Date().getFullYear();
      if (!select) return;
      select.innerHTML = "";
      for (let year = selected - 2; year <= selected + 3; year += 1){
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        option.selected = year === selected;
        select.appendChild(option);
      }
    },
    applyYearToLinks: () => {}
  };

  const $ = (id) => document.getElementById(id);
  const normalize = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  function normalizeEntityKey(value){
    return normalize(value)
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  let APP_YEAR = Config.setActiveYear(Number(PAGE_PARAMS.get("year")) || Config.getActiveYear());
  let ENTITY_KEY = normalizeEntityKey(PAGE_PARAMS.get("entity") || "psa");
  let entities = [];

  const COLS = {
    YEAR: "Année",
    MONTH: "Mois",
    SELLER: "Vendeur",
    CLIENT_INT: "N° client Interne",
    CLIENT: "Clients",
    REF: "Reference Produits",
    DES: "Désignations",
    QTY: "Quantité Payante servie",
    CA: "Montant prix achat KENT"
  };

  const TARGETS = {
    SELLER: ["Vendeur", "VENDEUR", "Vendeur KENT", "Vendeur PSA", "Commercial"],
    REF: ["Reference Produits", "Référence Produits", "Reference Produit", "Référence Produit", "Ref Produits", "Réf Produits", "Nos réf kent", "Nos ref kent", "reference", "référence", "ref"],
    DES: ["Désignations", "Designations", "Désignation", "Designation", "Designation produit", "Désignation produit"],
    QTY: ["Quantité Payante servie", "Quantite Payante servie", "Quantité", "Quantite", "Qte", "Qté"],
    MONTH: ["Mois", "mois", "Mois2", "mois2"]
  };

  const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  const numberFmt = new Intl.NumberFormat("fr-FR");

  function escapeHtml(value){
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toNumber(value){
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value).replace(",", ".").replace(/\s/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function setStatus(type, text){
    const dot = $("dotStatus");
    dot.classList.remove("ok", "warn");
    if (type === "ok") dot.classList.add("ok");
    if (type === "warn") dot.classList.add("warn");
    $("status").textContent = text;
  }

  function uniq(values){
    return [...new Set(values.filter(value => value !== "" && value !== null && value !== undefined))];
  }

  function sortNumIfPossible(a, b){
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b), "fr", { numeric: true, sensitivity: "base" });
  }

  function monthLabel(value){
    const raw = String(value ?? "").trim();
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 12) return MONTHS_FR[numeric - 1];
    const match = raw.match(/^0?(\d{1,2})$/);
    if (match){
      const month = Number(match[1]);
      if (month >= 1 && month <= 12) return MONTHS_FR[month - 1];
    }
    return raw;
  }

  function selectedEntity(){
    return entities.find(entity => String(entity.key) === String(ENTITY_KEY))
      || entities[0]
      || { key: ENTITY_KEY || "psa", libelle: ENTITY_KEY || "PSA" };
  }

  function updateUrl(){
    const url = new URL(location.href);
    url.searchParams.set("entity", ENTITY_KEY);
    url.searchParams.set("year", String(APP_YEAR));
    history.replaceState(null, "", url);
    Config.applyYearToLinks(document, APP_YEAR);
  }

  function updatePageLabels(){
    const entity = selectedEntity();
    const label = entity.libelle || entity.key || "Entité";
    document.title = `Requête ${label} ${APP_YEAR}`;
    $("pageTitle").textContent = `Requête ${label}`;
    $("pageSubtitle").textContent = `Réel Supabase ${APP_YEAR} - sélection en colonnes + cumul + export`;
  }

  function rawValue(line, candidates){
    const raw = line && line.raw_data && typeof line.raw_data === "object" ? line.raw_data : {};
    const entries = Object.keys(raw).map(key => ({ key, normalized: normalize(key), value: raw[key] }));
    for (const candidate of candidates || []){
      const normalized = normalize(candidate);
      const exact = entries.find(entry => entry.normalized === normalized);
      if (exact && String(exact.value ?? "").trim()) return exact.value;
    }
    for (const candidate of candidates || []){
      const normalized = normalize(candidate);
      const partial = entries.find(entry => entry.normalized.includes(normalized) || normalized.includes(entry.normalized));
      if (partial && String(partial.value ?? "").trim()) return partial.value;
    }
    return "";
  }

  function mapSupabaseLine(line){
    const month = Number(line.mois || line.mois_source || rawValue(line, TARGETS.MONTH) || 0);
    const seller = rawValue(line, TARGETS.SELLER) || "-";
    return {
      [COLS.YEAR]: String(line.annee || APP_YEAR),
      [COLS.MONTH]: month ? String(month) : "-",
      [COLS.SELLER]: String(seller || "-").trim() || "-",
      [COLS.CLIENT_INT]: String(line.client_code || "-").trim() || "-",
      [COLS.CLIENT]: String(line.client_nom || "Client inconnu").trim() || "Client inconnu",
      [COLS.REF]: String(line.reference || rawValue(line, TARGETS.REF) || "-").trim() || "-",
      [COLS.DES]: String(line.designation || rawValue(line, TARGETS.DES) || "-").trim() || "-",
      [COLS.QTY]: toNumber(line.quantite || rawValue(line, TARGETS.QTY) || 0),
      [COLS.CA]: toNumber(line.montant || 0)
    };
  }

  function buildListBox(mountId, title){
    const mount = $(mountId);
    mount.innerHTML = `
      <div class="fhead">
        <div class="headLeft">
          <div>${title}</div>
          <div class="badge" id="${mountId}_badge">—</div>
        </div>
        <div class="headBtns">
          <button class="miniBtn" type="button" id="${mountId}_all">Tout</button>
          <button class="miniBtn" type="button" id="${mountId}_none">Aucun</button>
        </div>
      </div>
      <select id="${mountId}_sel" multiple></select>
      <div class="cumulRow">
        <input type="checkbox" id="${mountId}_cumul">
        <label for="${mountId}_cumul">Cumul</label>
      </div>
    `;

    const sel = $(`${mountId}_sel`);
    const cumul = $(`${mountId}_cumul`);
    const badge = $(`${mountId}_badge`);
    const btnAll = $(`${mountId}_all`);
    const btnNone = $(`${mountId}_none`);

    function syncFilterVisualState(){
      const total = sel.options.length;
      const selected = sel.selectedOptions.length;
      const filtered = total > 0 && selected > 0 && selected < total;
      const empty = total > 0 && selected === 0;
      mount.classList.toggle("is-filtered", filtered);
      mount.classList.toggle("is-empty", empty);
      sel.classList.toggle("has-filter", filtered);
      sel.classList.toggle("has-empty", empty);
    }

    function updateBadge(){
      const total = sel.options.length;
      const selected = sel.selectedOptions.length;
      badge.textContent = total ? `${selected}/${total}` : "0/0";
      syncFilterVisualState();
    }

    function selectAll(){
      [...sel.options].forEach(option => option.selected = true);
      updateBadge();
    }

    function selectNone(){
      [...sel.options].forEach(option => option.selected = false);
      updateBadge();
    }

    function setOptions(values, { labelFn = null, preserve = true, sortFn = null } = {}){
      const previous = preserve ? new Set(getSelected()) : null;
      let nextValues = uniq(values.map(value => String(value ?? "").trim()).filter(Boolean));
      if (sortFn) nextValues.sort(sortFn);
      else nextValues.sort(sortNumIfPossible);

      sel.innerHTML = nextValues.map(value => {
        const label = labelFn ? labelFn(value) : value;
        return `<option value="${escapeHtml(value)}">${escapeHtml(label ?? "")}</option>`;
      }).join("");

      selectAll();

      if (previous && previous.size){
        const available = new Set(nextValues);
        const intersection = [...previous].filter(value => available.has(value));
        if (intersection.length) setSelected(intersection);
      }
      updateBadge();
    }

    function getSelected(){
      return [...sel.selectedOptions].map(option => option.value);
    }

    function setSelected(values){
      const selected = new Set(values);
      [...sel.options].forEach(option => option.selected = selected.has(option.value));
      updateBadge();
    }

    sel.addEventListener("change", () => {
      updateBadge();
      cascadeFrom(mountId);
    });
    btnAll.addEventListener("click", () => {
      selectAll();
      cascadeFrom(mountId);
    });
    btnNone.addEventListener("click", () => {
      selectNone();
      cascadeFrom(mountId);
    });

    return {
      id: mountId,
      setOptions,
      getSelected,
      setSelected,
      selectAll,
      selectNone,
      getCumul: () => cumul.checked,
      setCumul: (checked) => cumul.checked = Boolean(checked)
    };
  }

  let rows = [];
  const cols = { ...COLS };
  let lastResult = [];
  let lastHeaders = [];
  let sortKey = "ca";
  let sortAsc = false;

  const boxYear = buildListBox("boxYear", "Année *");
  const boxMonth = buildListBox("boxMonth", "Mois *");
  const boxSeller = buildListBox("boxSeller", "Vendeur");
  const boxClientInt = buildListBox("boxClientInt", "N° client Interne");
  const boxClient = buildListBox("boxClient", "Clients");
  const boxRef = buildListBox("boxRef", "Reference Produits");
  const boxDes = buildListBox("boxDes", "Désignations");

  const chain = [
    { box: boxYear, key: "YEAR", labelFn: null, sortFn: (a,b) => Number(a) - Number(b) },
    { box: boxMonth, key: "MONTH", labelFn: monthLabel, sortFn: (a,b) => Number(a) - Number(b) },
    { box: boxSeller, key: "SELLER", labelFn: null, sortFn: null },
    { box: boxClientInt, key: "CLIENT_INT", labelFn: null, sortFn: sortNumIfPossible },
    { box: boxClient, key: "CLIENT", labelFn: null, sortFn: null },
    { box: boxRef, key: "REF", labelFn: null, sortFn: null },
    { box: boxDes, key: "DES", labelFn: null, sortFn: null }
  ];

  function filterRowsUpTo(index){
    let filtered = rows;
    for (let i = 0; i <= index; i += 1){
      const colName = cols[chain[i].key];
      const selected = new Set(chain[i].box.getSelected());
      if (!colName || selected.size === 0) return [];
      filtered = filtered.filter(row => selected.has(String(row[colName] ?? "").trim()));
    }
    return filtered;
  }

  function cascadeFrom(changedBoxId){
    const index = chain.findIndex(item => item.box.id === changedBoxId);
    if (index < 0) return;
    for (let next = index + 1; next < chain.length; next += 1){
      const base = filterRowsUpTo(next - 1);
      const colName = cols[chain[next].key];
      const values = colName ? base.map(row => row[colName]) : [];
      chain[next].box.setOptions(values, {
        labelFn: chain[next].labelFn,
        preserve: true,
        sortFn: chain[next].sortFn
      });
    }
  }

  function buildKey(row, colsList){
    return colsList.map(col => `${col}=${row[col] ?? ""}`).join("||");
  }

  function generate(){
    if (!rows.length) return;

    let filtered = rows;
    for (const item of chain){
      const colName = cols[item.key];
      const selected = new Set(item.box.getSelected());
      if (!colName || selected.size === 0){
        renderEmpty("Sélection vide sur une colonne.");
        return;
      }
      filtered = filtered.filter(row => selected.has(String(row[colName] ?? "").trim()));
    }

    if (!filtered.length){
      renderEmpty("Aucune donnée pour cette requête.");
      return;
    }

    const groupCols = chain
      .filter(item => !item.box.getCumul())
      .map(item => cols[item.key])
      .filter(Boolean);
    const colQ = cols.QTY;
    const colCA = cols.CA;
    const aggregate = new Map();
    let totalQty = 0;
    let totalCA = 0;

    for (const row of filtered){
      const qty = toNumber(row[colQ]);
      const ca = toNumber(row[colCA]);
      totalQty += qty;
      totalCA += ca;

      const keyRow = {};
      for (const col of groupCols) keyRow[col] = String(row[col] ?? "").trim();
      const key = buildKey(keyRow, groupCols);

      if (!aggregate.has(key)){
        const nextRow = {};
        for (const col of groupCols) nextRow[col] = String(row[col] ?? "").trim();
        nextRow[colQ] = 0;
        nextRow[colCA] = 0;
        aggregate.set(key, nextRow);
      }
      const current = aggregate.get(key);
      current[colQ] += qty;
      current[colCA] += ca;
    }

    const result = [...aggregate.values()].sort((a,b) => (b[colCA] - a[colCA]) || (b[colQ] - a[colQ]));
    sortKey = "ca";
    sortAsc = false;
    lastResult = result;
    lastHeaders = [...groupCols, colQ, colCA];

    renderTable(groupCols, colQ, colCA, result, totalQty, totalCA);
    $("exportBtn").disabled = result.length === 0;
  }

  function renderEmpty(message){
    $("thead").innerHTML = "";
    $("tbody").innerHTML = `<tr><td style="color:rgba(255,255,255,.6)">${escapeHtml(message)}</td></tr>`;
    $("kpiRows").textContent = "—";
    $("kpiQty").textContent = "—";
    $("kpiCA").textContent = "—";
    $("exportBtn").disabled = true;
    lastResult = [];
    lastHeaders = [];
  }

  function sortKeyForColumn(col, colQ, colCA){
    if (col === colQ) return "qty";
    if (col === colCA) return "ca";
    return `col:${encodeURIComponent(String(col))}`;
  }

  function columnFromSortKey(key, colCA, colQ){
    if (key === "qty") return colQ;
    if (key === "ca") return colCA;
    if (key && key.startsWith("col:")) return decodeURIComponent(key.slice(4));
    return colCA;
  }

  function isNumericSortKey(key){
    return key === "qty" || key === "ca";
  }

  function compareSortValues(a, b, key, asc){
    const base = isNumericSortKey(key)
      ? toNumber(a) - toNumber(b)
      : sortNumIfPossible(a ?? "", b ?? "");
    return asc ? base : -base;
  }

  function compareSortFallback(a, b, colCA, colQ, groupCols){
    const ca = toNumber(b[colCA]) - toNumber(a[colCA]);
    if (ca) return ca;
    const qty = toNumber(b[colQ]) - toNumber(a[colQ]);
    if (qty) return qty;
    const firstGroup = groupCols[0];
    return firstGroup ? sortNumIfPossible(a[firstGroup] ?? "", b[firstGroup] ?? "") : 0;
  }

  function renderTable(groupCols, colQ, colCA, result, totalQty, totalCA){
    const headers = [
      ...groupCols.map(col => ({ label: col, col, right: false, kind: "text", sortable: true, sortKey: sortKeyForColumn(col, colQ, colCA) })),
      { label: colQ, col: colQ, right: true, kind: "num", sortable: true, sortKey: "qty" },
      { label: colCA, col: colCA, right: true, kind: "eur", sortable: true, sortKey: "ca" }
    ];
    const iconFor = key => sortKey === key ? (sortAsc ? "▲" : "▼") : "↕";

    $("thead").innerHTML = `
      <tr>
        ${headers.map(header => {
          const cls = header.sortable ? "sortable" : "";
          const icon = header.sortable ? `<span class="sortIcon">${iconFor(header.sortKey)}</span>` : "";
          return `<th class="${cls} ${header.right ? "right" : ""}" data-sort="${escapeHtml(header.sortKey || "")}">${escapeHtml(header.label)}${icon}</th>`;
        }).join("")}
      </tr>
    `;

    $("tbody").innerHTML = result.map(row => `
      <tr>
        ${headers.map(header => {
          let value = row[header.col];
          if (header.col === cols.MONTH) value = monthLabel(value);
          if (header.kind === "num") return `<td class="right">${numberFmt.format(Math.round(toNumber(value) * 100) / 100)}</td>`;
          if (header.kind === "eur") return `<td class="right">${eur.format(toNumber(value))}</td>`;
          return `<td>${escapeHtml(value ?? "")}</td>`;
        }).join("")}
      </tr>
    `).join("");

    $("kpiRows").textContent = numberFmt.format(result.length);
    $("kpiQty").textContent = numberFmt.format(Math.round(totalQty * 100) / 100);
    $("kpiCA").textContent = eur.format(totalCA);

    $("thead").querySelectorAll("th[data-sort]").forEach(th => {
      if (!th.dataset.sort) return;
      th.onclick = () => toggleSort(th.dataset.sort, colCA, colQ, groupCols);
    });
  }

  function toggleSort(nextSortKey, colCA, colQ, groupCols){
    if (!lastResult.length) return;
    if (sortKey === nextSortKey) sortAsc = !sortAsc;
    else {
      sortKey = nextSortKey;
      sortAsc = !isNumericSortKey(nextSortKey);
    }
    const primaryCol = columnFromSortKey(sortKey, colCA, colQ);
    const sorted = [...lastResult].sort((a,b) => {
      const primary = compareSortValues(a[primaryCol], b[primaryCol], sortKey, sortAsc);
      if (primary !== 0) return primary;
      return compareSortFallback(a, b, colCA, colQ, groupCols);
    });
    const totalQty = sorted.reduce((sum,row) => sum + toNumber(row[colQ]), 0);
    const totalCA = sorted.reduce((sum,row) => sum + toNumber(row[colCA]), 0);
    lastResult = sorted;
    renderTable(groupCols, colQ, colCA, sorted, totalQty, totalCA);
  }

  function exportCSV(){
    if (!lastResult.length) return;
    const headers = lastHeaders;
    const lines = [];
    lines.push(headers.map(header => `"${String(header).replaceAll('"', '""')}"`).join(";"));

    for (const row of lastResult){
      lines.push(headers.map(header => {
        let value = row[header] ?? "";
        if (header === cols.MONTH) value = monthLabel(value);
        return `"${String(value).replaceAll('"', '""')}"`;
      }).join(";"));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `requete_${ENTITY_KEY}_${APP_YEAR}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function refreshEntities(){
    entities = await window.ReelSupabase.listEntities();
    if (!entities.length) throw new Error("Aucune entité active trouvée dans Supabase.");
    if (!entities.some(entity => String(entity.key) === String(ENTITY_KEY))) {
      ENTITY_KEY = String(entities[0].key || "");
    }
    $("entitySelect").innerHTML = entities
      .map(entity => `<option value="${escapeHtml(entity.key)}">${escapeHtml(entity.libelle || entity.key)}</option>`)
      .join("");
    $("entitySelect").value = ENTITY_KEY;
    updatePageLabels();
  }

  function initFilterOptions(){
    boxYear.setOptions(rows.map(row => row[cols.YEAR]), { preserve: false, sortFn: (a,b) => Number(a) - Number(b) });
    const base1 = filterRowsUpTo(0);
    boxMonth.setOptions(base1.map(row => row[cols.MONTH]), { labelFn: monthLabel, preserve: false, sortFn: (a,b) => Number(a) - Number(b) });
    const base2 = filterRowsUpTo(1);
    boxSeller.setOptions(base2.map(row => row[cols.SELLER]), { preserve: false });
    const base3 = filterRowsUpTo(2);
    boxClientInt.setOptions(base3.map(row => row[cols.CLIENT_INT]), { preserve: false, sortFn: sortNumIfPossible });
    const base4 = filterRowsUpTo(3);
    boxClient.setOptions(base4.map(row => row[cols.CLIENT]), { preserve: false });
    const base5 = filterRowsUpTo(4);
    boxRef.setOptions(base5.map(row => row[cols.REF]), { preserve: false });
    const base6 = filterRowsUpTo(5);
    boxDes.setOptions(base6.map(row => row[cols.DES]), { preserve: false });

    boxYear.setCumul(false);
    boxMonth.setCumul(false);
    boxSeller.setCumul(false);
    boxClientInt.setCumul(false);
    boxClient.setCumul(true);
    boxRef.setCumul(false);
    boxDes.setCumul(false);
  }

  async function loadSupabase(){
    const entity = selectedEntity();
    const label = entity.libelle || entity.key || "Entité";
    setStatus("warn", `Chargement Supabase ${label} ${APP_YEAR}...`);
    renderEmpty("Chargement Supabase...");
    $("fileNameLabel").textContent = "Supabase réel actif";

    try{
      const supabaseRows = await window.ReelSupabase.getActiveLinesByEntityYear(ENTITY_KEY, APP_YEAR);
      rows = supabaseRows.map(mapSupabaseLine).filter(row => row[COLS.CA] || row[COLS.QTY]);
      $("fileNameLabel").textContent = `Supabase réel actif - ${label} ${APP_YEAR}`;
      $("colsDebug").textContent = "Colonnes détectées : Année=Supabase | Mois=Supabase | Vendeur=raw_data | N° client Interne=client_code | Client=client_nom | Ref=reference | Désignation=designation | Qte=quantite | CA=montant";

      if (!rows.length){
        setStatus("warn", `Aucun réel actif pour ${label} ${APP_YEAR}.`);
        renderEmpty("Aucune ligne réelle active trouvée dans Supabase pour cette entité et cette année.");
        return;
      }

      initFilterOptions();
      setStatus("ok", `Base Supabase chargée : ${numberFmt.format(rows.length)} lignes - ${label} ${APP_YEAR}`);
      renderEmpty("Prêt : sélectionne puis clique Générer.");
    }catch(error){
      console.error(error);
      setStatus("warn", `Impossible de charger Supabase pour ${label}`);
      renderEmpty(error?.message || "Impossible de charger le réel Supabase.");
    }
  }

  async function init(){
    try{
      Config.fillYearSelect($("yearSelect"), { selectedYear: APP_YEAR });
      $("yearSelect").value = String(APP_YEAR);
      await refreshEntities();
      updateUrl();
      await loadSupabase();
    }catch(error){
      console.error(error);
      setStatus("warn", "Initialisation impossible.");
      renderEmpty(error?.message || "Impossible d'initialiser la requête.");
    }
  }

  $("reloadBtn").addEventListener("click", loadSupabase);
  $("genBtn").addEventListener("click", generate);
  $("exportBtn").addEventListener("click", exportCSV);
  $("entitySelect").addEventListener("change", async () => {
    ENTITY_KEY = String($("entitySelect").value || "");
    updatePageLabels();
    updateUrl();
    await loadSupabase();
  });
  $("yearSelect").addEventListener("change", async () => {
    APP_YEAR = Config.setActiveYear(Number($("yearSelect").value));
    $("yearSelect").value = String(APP_YEAR);
    updatePageLabels();
    updateUrl();
    await loadSupabase();
  });

  init();
})();
