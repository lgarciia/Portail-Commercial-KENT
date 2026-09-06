(function(){
  const API_URL = "/api/admin-tarifs-conditionnements";
  const SECTOR_LABELS = { auto: "Automobile", industrie: "Industrie" };
  const state = {
    catalog: null,
    tariffRows: [],
    tariffPreview: [],
    tariffMeta: emptyMeta(),
    conditionRows: [],
    conditionPreview: [],
    conditionMeta: emptyMeta(),
    loading: false
  };

  function $(selector){ return document.querySelector(selector); }
  function $all(selector){ return Array.from(document.querySelectorAll(selector)); }

  function init(){
    bindEvents();
    renderTariffPreview();
    renderConditionPreview();
    setSaveDisabled("[data-tariff-save]", true);
    setSaveDisabled("[data-cond-save]", true);
    loadCatalog(false);
  }

  function bindEvents(){
    $all("[data-ref-admin-refresh]").forEach(button => button.addEventListener("click", () => loadCatalog(true)));
    $all("[data-tariff-sector]").forEach(select => select.addEventListener("change", () => { renderTariffPlaques(); resetTariffPreview(); }));
    $all("[data-tariff-plaque]").forEach(select => select.addEventListener("change", resetTariffPreview));
    $all("[data-tariff-file]").forEach(input => input.addEventListener("change", resetTariffPreview));
    $all("[data-tariff-template]").forEach(button => button.addEventListener("click", downloadTariffTemplate));
    $all("[data-tariff-preview]").forEach(button => button.addEventListener("click", previewTariffFile));
    $all("[data-tariff-save]").forEach(button => button.addEventListener("click", saveTariffs));

    $all("[data-cond-sector]").forEach(select => select.addEventListener("change", resetConditionPreview));
    $all("[data-cond-file]").forEach(input => input.addEventListener("change", resetConditionPreview));
    $all("[data-cond-template]").forEach(button => button.addEventListener("click", downloadConditioningTemplate));
    $all("[data-cond-preview]").forEach(button => button.addEventListener("click", previewConditionFile));
    $all("[data-cond-save]").forEach(button => button.addEventListener("click", saveConditionings));

    $all("[data-ref-plaque-sector]").forEach(select => select.addEventListener("change", renderPlaqueList));
    $all("[data-ref-create-plaque]").forEach(button => button.addEventListener("click", createPlaque));
    $all("[data-ref-access-commercial]").forEach(select => select.addEventListener("change", renderAccessList));
    $all("[data-ref-access-sector]").forEach(select => select.addEventListener("change", renderAccessList));
    $all("[data-ref-save-access]").forEach(button => button.addEventListener("click", saveAccess));

    document.addEventListener("click", event => {
      const tab = event.target.closest("[data-admin-subtab]");
      if (!tab) return;
      window.setTimeout(() => {
        if (["tarifs-admin", "conditionnements-admin", "referentiels-admin"].includes(tab.dataset.adminSubtab)) {
          loadCatalog(false);
        }
      }, 30);
    });
  }

  async function loadCatalog(showSuccess){
    if (state.loading) return;
    state.loading = true;
    setBusy(true);
    try{
      state.catalog = await apiGet();
      renderTariffPlaques();
      renderPlaqueList();
      renderCommercials();
      renderAccessList();
      if (showSuccess) notify("Référentiels synchronisés.");
    }catch(error){
      console.error("Chargement référentiels admin:", error);
      notify(error.message || "Impossible de charger les référentiels.", true);
      renderWarning("Impossible de charger les référentiels admin.");
    }finally{
      state.loading = false;
      setBusy(false);
    }
  }

  async function apiGet(){
    const response = await fetch(API_URL, { credentials: "same-origin", cache: "no-store" });
    return parseApiResponse(response);
  }

  async function apiPost(body){
    const response = await fetch(API_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    return parseApiResponse(response);
  }

  async function parseApiResponse(response){
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || payload?.message || `Erreur HTTP ${response.status}`);
    }
    return payload;
  }

  function renderTariffPlaques(){
    const sector = currentValue("[data-tariff-sector]", "auto");
    const plaques = getPlaques(sector);
    $all("[data-tariff-plaque]").forEach(select => {
      const previous = select.value;
      select.innerHTML = plaques.length
        ? plaques.map(plaque => `<option value="${escapeHtml(plaque.id)}">${escapeHtml(plaque.name)}</option>`).join("")
        : `<option value="">Aucune plaque</option>`;
      if (previous && plaques.some(plaque => plaque.id === previous)) select.value = previous;
    });
    renderTariffHint();
  }

  function renderTariffHint(){
    const box = $("[data-tariff-hint]");
    if (!box) return;
    const plaque = getSelectedTariffPlaque();
    const sector = currentValue("[data-tariff-sector]", "auto");
    if (!plaque) {
      box.innerHTML = "Crée ou sélectionne une plaque avant d'importer un tarif.";
      return;
    }
    const strategy = resolveTariffStrategy(plaque.name, sector);
    box.innerHTML = [
      `Plaque cible : <b>${escapeHtml(plaque.name)}</b>.`,
      `Lecture : ${escapeHtml(strategy.label)}.`,
      "L'import remplace uniquement les tarifs de cette plaque. Les clients, visites, budgets et historiques ne sont pas modifiés."
    ].join("<br>");
  }

  function renderPlaqueList(){
    const sector = currentValue("[data-ref-plaque-sector]", "auto");
    const list = $("[data-ref-plaque-list]");
    if (!list) return;
    const plaques = getPlaques(sector);
    if (!plaques.length) {
      list.innerHTML = `<div class="empty">Aucune plaque ${escapeHtml(SECTOR_LABELS[sector] || sector)}.</div>`;
      return;
    }
    list.innerHTML = plaques.map(plaque => `
      <div class="ref-admin-row">
        <div>
          <strong>${escapeHtml(plaque.name)}</strong>
          <span>${escapeHtml(SECTOR_LABELS[sector] || sector)}</span>
        </div>
        <span class="budget-chip open">Plaque</span>
      </div>
    `).join("");
  }

  function renderCommercials(){
    const commercials = getCommercials();
    $all("[data-ref-access-commercial]").forEach(select => {
      const previous = select.value;
      select.innerHTML = commercials.length
        ? commercials.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.displayName)}</option>`).join("")
        : `<option value="">Aucun commercial</option>`;
      if (previous && commercials.some(user => user.id === previous)) select.value = previous;
    });
  }

  function renderAccessList(){
    const warningBox = $("[data-ref-access-warning]");
    const list = $("[data-ref-access-list]");
    if (!list) return;

    const accessReady = state.catalog?.accessReady !== false;
    if (warningBox) {
      warningBox.hidden = accessReady;
      warningBox.textContent = state.catalog?.accessWarning || "Lance le SQL droits plaques avant d'utiliser ce bloc.";
    }
    setSaveDisabled("[data-ref-save-access]", !accessReady);

    const commercialId = currentValue("[data-ref-access-commercial]", "");
    const sector = currentValue("[data-ref-access-sector]", "auto");
    const plaques = getPlaques(sector);
    const allowed = new Set((state.catalog?.access || [])
      .filter(row => row.commercialId === commercialId && row.sector === sector)
      .map(row => row.plaqueId));

    if (!commercialId) {
      list.innerHTML = `<div class="empty">Sélectionne un commercial pour gérer ses plaques.</div>`;
      return;
    }
    if (!plaques.length) {
      list.innerHTML = `<div class="empty">Aucune plaque disponible pour ce secteur.</div>`;
      return;
    }

    list.innerHTML = plaques.map(plaque => `
      <label class="plaque-access-option">
        <input type="checkbox" value="${escapeHtml(plaque.id)}" ${allowed.has(plaque.id) ? "checked" : ""} ${accessReady ? "" : "disabled"}>
        <span>
          <strong>${escapeHtml(plaque.name)}</strong>
          <small>${escapeHtml(SECTOR_LABELS[sector] || sector)}</small>
        </span>
      </label>
    `).join("");
  }

  async function createPlaque(){
    const nameInput = $("[data-ref-plaque-name]");
    const sector = currentValue("[data-ref-plaque-sector]", "auto");
    const name = normalizeText(nameInput?.value);
    if (!name) {
      notify("Nom de plaque obligatoire.", true);
      return;
    }
    setBusy(true);
    try{
      const result = await apiPost({ action: "createPlaque", sector, name });
      if (nameInput) nameInput.value = "";
      await loadCatalog(false);
      notify(result.message || "Plaque créée.");
    }catch(error){
      notify(error.message || "Création de plaque impossible.", true);
    }finally{
      setBusy(false);
    }
  }

  async function saveAccess(){
    const commercialId = currentValue("[data-ref-access-commercial]", "");
    const sector = currentValue("[data-ref-access-sector]", "auto");
    if (!commercialId) {
      notify("Commercial obligatoire.", true);
      return;
    }
    const plaqueIds = $all("[data-ref-access-list] input[type='checkbox']:checked").map(input => input.value);
    const confirmed = await confirmDialog(
      `Valider ${plaqueIds.length} plaque(s) pour ce commercial ?\n\nCette action ne supprime aucun client, aucune vente et aucun tarif. Elle modifie uniquement les droits d'accès aux plaques.`,
      { title: "Confirmer les droits plaques", confirmText: "Valider" }
    );
    if (!confirmed) return;

    setBusy(true);
    try{
      const result = await apiPost({ action: "setCommercialPlaques", commercialId, sector, plaqueIds });
      await loadCatalog(false);
      notify(result.message || "Droits plaques enregistrés.");
    }catch(error){
      notify(error.message || "Droits plaques impossibles à enregistrer.", true);
    }finally{
      setBusy(false);
    }
  }

  async function previewTariffFile(){
    const file = $("[data-tariff-file]")?.files?.[0];
    const plaque = getSelectedTariffPlaque();
    const sector = currentValue("[data-tariff-sector]", "auto");
    if (!plaque) {
      notify("Sélectionne une plaque avant de lire le fichier.", true);
      return;
    }
    if (!file) {
      notify("Choisis un fichier Excel avant la prévisualisation.", true);
      return;
    }
    setBusy(true);
    try{
      const workbook = await readWorkbook(file);
      const analysis = analyzeTariffWorkbook(workbook, plaque, sector);
      state.tariffRows = analysis.rows;
      state.tariffPreview = analysis.preview;
      state.tariffMeta = analysis.meta;
      renderTariffPreview();
      setSaveDisabled("[data-tariff-save]", !state.tariffRows.length);
      notify(`${state.tariffRows.length.toLocaleString("fr-FR")} référence(s) prête(s) à importer.`);
    }catch(error){
      console.error("Prévisualisation tarif:", error);
      state.tariffRows = [];
      state.tariffPreview = [];
      state.tariffMeta = emptyMeta();
      renderTariffPreview(error.message || "Fichier tarif illisible.");
      setSaveDisabled("[data-tariff-save]", true);
      notify(error.message || "Fichier tarif illisible.", true);
    }finally{
      setBusy(false);
    }
  }

  async function saveTariffs(){
    const plaque = getSelectedTariffPlaque();
    const sector = currentValue("[data-tariff-sector]", "auto");
    if (!plaque || !state.tariffRows.length) return;
    const confirmed = await confirmDialog(
      `Importer ${state.tariffRows.length.toLocaleString("fr-FR")} référence(s) pour ${plaque.name} ?\n\nCela remplace uniquement les tarifs de cette plaque. Les clients, visites, budgets et historiques ne sont pas modifiés.`,
      { title: "Confirmer l'import tarif", confirmText: "Importer" }
    );
    if (!confirmed) return;

    setBusy(true);
    setSaveDisabled("[data-tariff-save]", true);
    try{
      const result = await apiPost({ action: "importTarifs", sector, plaqueId: plaque.id, rows: state.tariffRows });
      await loadCatalog(false);
      notify(result.message || "Tarif importé.");
      await alertDialog(
        `${result.imported.toLocaleString("fr-FR")} tarif(s) importé(s).\n${result.productsCreated.toLocaleString("fr-FR")} produit(s) créé(s), ${result.productsUpdated.toLocaleString("fr-FR")} produit(s) mis à jour.\nAnciens tarifs remplacés : ${result.oldTariffs.toLocaleString("fr-FR")}.`,
        { title: "Import tarif terminé" }
      );
    }catch(error){
      notify(error.message || "Import tarif impossible.", true);
      setSaveDisabled("[data-tariff-save]", !state.tariffRows.length);
    }finally{
      setBusy(false);
    }
  }

  async function previewConditionFile(){
    const file = $("[data-cond-file]")?.files?.[0];
    const sector = currentValue("[data-cond-sector]", "auto");
    if (!file) {
      notify("Choisis un fichier Excel avant la prévisualisation.", true);
      return;
    }
    setBusy(true);
    try{
      const workbook = await readWorkbook(file);
      const analysis = analyzeConditionWorkbook(workbook);
      state.conditionRows = analysis.rows;
      state.conditionPreview = analysis.preview;
      state.conditionMeta = analysis.meta;
      renderConditionPreview();
      setSaveDisabled("[data-cond-save]", !state.conditionRows.length);
      notify(`${state.conditionRows.length.toLocaleString("fr-FR")} conditionnement(s) prêt(s) pour ${SECTOR_LABELS[sector]}.`);
    }catch(error){
      console.error("Prévisualisation conditionnement:", error);
      state.conditionRows = [];
      state.conditionPreview = [];
      state.conditionMeta = emptyMeta();
      renderConditionPreview(error.message || "Fichier conditionnement illisible.");
      setSaveDisabled("[data-cond-save]", true);
      notify(error.message || "Fichier conditionnement illisible.", true);
    }finally{
      setBusy(false);
    }
  }

  async function saveConditionings(){
    const sector = currentValue("[data-cond-sector]", "auto");
    if (!state.conditionRows.length) return;
    const confirmed = await confirmDialog(
      `Remplacer les conditionnements ${SECTOR_LABELS[sector]} par ${state.conditionRows.length.toLocaleString("fr-FR")} ligne(s) ?\n\nCette action remplace uniquement la table de conditionnements du secteur. Les clients, visites, budgets, produits et tarifs ne sont pas modifiés.`,
      { title: "Confirmer l'import conditionnement", confirmText: "Remplacer" }
    );
    if (!confirmed) return;

    setBusy(true);
    setSaveDisabled("[data-cond-save]", true);
    try{
      const result = await apiPost({ action: "importConditionnements", sector, rows: state.conditionRows });
      notify(result.message || "Conditionnements importés.");
      await alertDialog(
        `${result.imported.toLocaleString("fr-FR")} conditionnement(s) importé(s).\nAnciennes lignes remplacées : ${result.oldRows.toLocaleString("fr-FR")}.`,
        { title: "Import conditionnement terminé" }
      );
    }catch(error){
      notify(error.message || "Import conditionnement impossible.", true);
      setSaveDisabled("[data-cond-save]", !state.conditionRows.length);
    }finally{
      setBusy(false);
    }
  }

  function renderTariffPreview(errorMessage){
    const box = $("[data-tariff-preview-box]");
    if (!box) return;
    if (errorMessage) {
      box.innerHTML = `<div class="ref-admin-warning">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    const meta = state.tariffMeta;
    const rows = state.tariffPreview.slice(0, 12);
    if (!rows.length) {
      box.innerHTML = `
        <div class="import-preview-head">
          <strong>Aucun fichier prévisualisé</strong>
          <span class="budget-chip open">En attente</span>
        </div>
        <p>Choisis un fichier Excel puis lance la prévisualisation.</p>
      `;
      return;
    }
    box.innerHTML = `
      <div class="import-preview-head">
        <strong>${meta.uniqueRefs.toLocaleString("fr-FR")} référence(s) unique(s)</strong>
        <span class="budget-chip ${meta.errors ? "wait" : "valid"}">${meta.errors ? "À contrôler" : "Prêt"}</span>
      </div>
      ${renderMetaGrid([
        ["Feuilles", meta.sheetsUsed],
        ["Lues", meta.rowsRead],
        ["Valides", meta.validRows],
        ["Doublons", meta.duplicates]
      ])}
      ${renderPreviewTable(rows, ["Feuille", "Référence", "Désignation", "Tarif", "Statut"], row => [
        row.sheetName,
        row.reference,
        row.designation,
        formatCurrency(row.price),
        row.detail
      ])}
    `;
  }

  function renderConditionPreview(errorMessage){
    const box = $("[data-cond-preview-box]");
    if (!box) return;
    if (errorMessage) {
      box.innerHTML = `<div class="ref-admin-warning">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    const meta = state.conditionMeta;
    const rows = state.conditionPreview.slice(0, 12);
    if (!rows.length) {
      box.innerHTML = `
        <div class="import-preview-head">
          <strong>Aucun fichier prévisualisé</strong>
          <span class="budget-chip open">En attente</span>
        </div>
        <p>Le module lit toutes les feuilles et cherche les colonnes <b>Ref.</b> et <b>Embal.</b>.</p>
      `;
      return;
    }
    box.innerHTML = `
      <div class="import-preview-head">
        <strong>${meta.uniqueRefs.toLocaleString("fr-FR")} référence(s) unique(s)</strong>
        <span class="budget-chip ${meta.errors ? "wait" : "valid"}">${meta.errors ? "À contrôler" : "Prêt"}</span>
      </div>
      ${renderMetaGrid([
        ["Feuilles", meta.sheetsUsed],
        ["Lues", meta.rowsRead],
        ["Valides", meta.validRows],
        ["Doublons", meta.duplicates]
      ])}
      ${renderPreviewTable(rows, ["Feuille", "Ref.", "Embal.", "Description", "Statut"], row => [
        row.sheetName,
        row.ref_5,
        row.emballage,
        row.description,
        row.detail
      ])}
    `;
  }

  function renderMetaGrid(items){
    return `<div class="import-mini-kpis ref-admin-metrics">${items.map(([label, value]) => `
      <article class="import-mini-kpi"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toLocaleString("fr-FR")}</strong></article>
    `).join("")}</div>`;
  }

  function renderPreviewTable(rows, headers, pick){
    return `
      <div class="ref-admin-table-wrap">
        <table class="ref-admin-preview-table">
          <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map(row => `<tr>${pick(row).map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function resetTariffPreview(){
    state.tariffRows = [];
    state.tariffPreview = [];
    state.tariffMeta = emptyMeta();
    renderTariffHint();
    renderTariffPreview();
    setSaveDisabled("[data-tariff-save]", true);
  }

  function resetConditionPreview(){
    state.conditionRows = [];
    state.conditionPreview = [];
    state.conditionMeta = emptyMeta();
    renderConditionPreview();
    setSaveDisabled("[data-cond-save]", true);
  }

  async function readWorkbook(file){
    if (!window.XLSX) throw new Error("Librairie Excel indisponible sur la page.");
    const buffer = await file.arrayBuffer();
    return window.XLSX.read(buffer, { type: "array" });
  }

  function analyzeTariffWorkbook(workbook, plaque, sector){
    const strategy = resolveTariffStrategy(plaque.name, sector);
    const allRows = [];
    const sheetNames = strategy.singleSheet ? (workbook.SheetNames || []).slice(0, 1) : (workbook.SheetNames || []);
    let sheetsUsed = 0;

    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
      const header = findTariffHeader(rows, strategy);
      if (!header) continue;
      let sheetHasData = false;
      for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const rawRow = rows[rowIndex] || [];
        const reference = normalizeText(rawRow[header.refIndex]);
        const designation = normalizeText(rawRow[header.designationIndex]);
        const price = parsePrice(rawRow[header.tarifIndex]);
        const hasAnyData = Boolean(reference || designation || normalizeText(rawRow[header.tarifIndex]));
        if (!hasAnyData) continue;
        sheetHasData = true;
        const errors = [];
        if (!reference) errors.push("Référence manquante");
        if (!designation) errors.push("Désignation manquante");
        if (!Number.isFinite(price) || price < 0) errors.push("Tarif invalide");
        allRows.push({
          sheetName,
          rowNumber: rowIndex + 1,
          reference,
          designation,
          referenceKey: normalizeReferenceKey(reference),
          price,
          status: errors.length ? "error" : "ok",
          detail: errors.length ? errors.join(" | ") : "Ligne valide",
          keepForImport: errors.length === 0
        });
      }
      if (sheetHasData) sheetsUsed += 1;
    }

    if (!allRows.length) throw new Error("Aucune ligne exploitable détectée dans le fichier tarif.");
    return finalizeTariffRows(allRows, sheetNames.length, sheetsUsed, strategy.duplicatePolicy || "first");
  }

  function finalizeTariffRows(allRows, sheetsScanned, sheetsUsed, duplicatePolicy){
    const validRows = allRows.filter(row => row.status === "ok" && row.referenceKey);
    const selectedIndexByKey = new Map();
    validRows.forEach((row, index) => {
      if (duplicatePolicy === "first" && selectedIndexByKey.has(row.referenceKey)) return;
      selectedIndexByKey.set(row.referenceKey, index);
    });
    let duplicates = 0;
    const counts = new Map();
    validRows.forEach(row => counts.set(row.referenceKey, (counts.get(row.referenceKey) || 0) + 1));
    validRows.forEach((row, index) => {
      const selected = selectedIndexByKey.get(row.referenceKey) === index;
      if (!selected) {
        row.keepForImport = false;
        row.status = "warn";
        row.detail = duplicatePolicy === "first" ? "Doublon ignoré, première ligne conservée" : "Doublon ignoré, dernière ligne conservée";
        duplicates += 1;
      } else if ((counts.get(row.referenceKey) || 0) > 1) {
        row.detail = duplicatePolicy === "first" ? "Doublon détecté, première ligne conservée" : "Doublon détecté, dernière ligne conservée";
      }
    });
    const importRows = validRows.filter(row => row.keepForImport).map(row => ({
      reference: row.reference,
      designation: row.designation,
      price: row.price
    }));
    return {
      preview: allRows,
      rows: importRows,
      meta: {
        sheetsScanned,
        sheetsUsed,
        rowsRead: allRows.length,
        validRows: validRows.length,
        uniqueRefs: importRows.length,
        duplicates,
        errors: allRows.filter(row => row.status === "error").length
      }
    };
  }

  function analyzeConditionWorkbook(workbook){
    const allRows = [];
    let sheetsUsed = 0;
    const sheetNames = workbook.SheetNames || [];
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
      const header = findConditionHeader(rows);
      if (!header) continue;
      let sheetHasData = false;
      for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const rawRow = rows[rowIndex] || [];
        const ref = normalizeText(rawRow[header.map.ref_5]);
        const emballage = normalizeText(rawRow[header.map.emballage]);
        const hasAnyData = Object.values(header.map).some(index => normalizeText(rawRow[index]));
        if (!hasAnyData) continue;
        sheetHasData = true;
        const errors = [];
        if (!ref) errors.push("Ref. manquante");
        if (!emballage) errors.push("Embal. manquant");
        allRows.push({
          sheetName,
          rowNumber: rowIndex + 1,
          ref_5: ref,
          code_produit: normalizeText(rawRow[header.map.code_produit]),
          categorie: normalizeText(rawRow[header.map.categorie]),
          famille: normalizeText(rawRow[header.map.famille]),
          sous_famille: normalizeText(rawRow[header.map.sous_famille]),
          description: normalizeText(rawRow[header.map.description]),
          grains: normalizeText(rawRow[header.map.grains]),
          emballage,
          tarif_revente: parsePrice(rawRow[header.map.tarif_revente]),
          referenceKey: normalizeReferenceKey(ref),
          status: errors.length ? "error" : "ok",
          detail: errors.length ? errors.join(" | ") : "Ligne valide"
        });
      }
      if (sheetHasData) sheetsUsed += 1;
    }
    if (!allRows.length) throw new Error("Aucune feuille exploitable détectée. Colonnes attendues : Ref. et Embal.");

    const latestByRef = new Map();
    let duplicates = 0;
    const validRows = allRows.filter(row => row.status === "ok" && row.referenceKey);
    validRows.forEach(row => {
      if (latestByRef.has(row.referenceKey)) duplicates += 1;
      latestByRef.set(row.referenceKey, row);
    });
    const importRows = Array.from(latestByRef.values()).map(row => ({
      ref_5: row.ref_5,
      code_produit: row.code_produit || null,
      categorie: row.categorie || null,
      famille: row.famille || null,
      sous_famille: row.sous_famille || null,
      description: row.description || null,
      grains: row.grains || null,
      emballage: row.emballage,
      tarif_revente: Number.isFinite(row.tarif_revente) ? row.tarif_revente : null
    }));
    return {
      preview: allRows,
      rows: importRows,
      meta: {
        sheetsScanned: sheetNames.length,
        sheetsUsed,
        rowsRead: allRows.length,
        validRows: validRows.length,
        uniqueRefs: importRows.length,
        duplicates,
        errors: allRows.filter(row => row.status === "error").length
      }
    };
  }

  function resolveTariffStrategy(plaqueName, sector){
    const label = normalizeComparable(plaqueName);
    if (sector === "auto" && label.includes("psa") && label.includes("revente")) {
      return { key: "psa-revente", label: "Code Stellantis + Description + Tarif Revente", singleSheet: true, duplicatePolicy: "first" };
    }
    if (sector === "auto" && label.includes("ford")) {
      return { key: "ford", label: label.includes("achat") ? "Ford achat" : "Ford revente", targetTarif: label.includes("achat") ? "achat" : "revente", duplicatePolicy: "last" };
    }
    if (sector === "auto" && label.includes("gueudet")) {
      return { key: "gueudet", label: "Gueudet professionnel", duplicatePolicy: "last" };
    }
    return { key: "default", label: "Référence + Désignation produit + Tarif", duplicatePolicy: "first" };
  }

  function findTariffHeader(rows, strategy){
    if (strategy.key === "psa-revente") return findPsaHeader(rows);
    if (strategy.key === "ford") return findFordHeader(rows, strategy.targetTarif || "revente") || findGenericTariffHeader(rows);
    if (strategy.key === "gueudet") return findGueudetHeader(rows) || findGenericTariffHeader(rows);
    return findGenericTariffHeader(rows);
  }

  function findGenericTariffHeader(rows){
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
      const tokens = (rows[rowIndex] || []).map(normalizeHeaderToken);
      const refIndex = findTokenIndex(tokens, ["reference", "ref", "refproduit", "referenceproduit", "codeproduit", "code"]);
      const designationIndex = findTokenIndex(tokens, ["designation", "designationproduit", "description", "libelle", "nomproduit"]);
      const tarifIndex = findTokenIndex(tokens, ["tarif", "prix", "prixvente", "tarifrevente"]);
      if (refIndex >= 0 && designationIndex >= 0 && tarifIndex >= 0) return { rowIndex, refIndex, designationIndex, tarifIndex };
    }
    return null;
  }

  function findPsaHeader(rows){
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
      const tokens = (rows[rowIndex] || []).map(normalizeHeaderToken);
      let refIndex = -1;
      let designationIndex = -1;
      let tarifIndex = -1;
      tokens.forEach((token, index) => {
        if (refIndex === -1 && (token.includes("stellantis") || token.includes("stelantis") || token.includes("stellar") || token.includes("clantif"))) refIndex = index;
        if (designationIndex === -1 && ["description", "designation", "designationproduit", "libelle"].some(value => token.includes(value))) designationIndex = index;
        if (tarifIndex === -1 && token.includes("tarif") && (token.includes("revente") || token.includes("vente"))) tarifIndex = index;
      });
      if (refIndex >= 0 && designationIndex >= 0 && tarifIndex >= 0) return { rowIndex, refIndex, designationIndex, tarifIndex };
    }
    return null;
  }

  function findFordHeader(rows, target){
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
      const tokens = (rows[rowIndex] || []).map(normalizeHeaderToken);
      const refIndex = findTokenIndex(tokens, ["codeproduit", "reference", "ref", "refproduit"]);
      const designationIndex = findTokenIndex(tokens, ["description", "designation", "libelle"]);
      const tarifIndex = tokens.findIndex(token => token.includes("tarif") && token.includes(target));
      if (refIndex >= 0 && designationIndex >= 0 && tarifIndex >= 0) return { rowIndex, refIndex, designationIndex, tarifIndex };
    }
    if (target === "revente") return { rowIndex: -1, refIndex: 0, designationIndex: 5, tarifIndex: 9 };
    return null;
  }

  function findGueudetHeader(rows){
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
      const tokens = (rows[rowIndex] || []).map(normalizeHeaderToken);
      const refIndex = findTokenIndex(tokens, ["reference", "ref", "referenceproduit", "refproduit", "codeproduit"]);
      const designationIndex = findTokenIndex(tokens, ["description", "designation", "libelle"]);
      const tarifIndex = tokens.findIndex(token => token.includes("tarif") && (token.includes("professionnel") || token.includes("revente")));
      if (refIndex >= 0 && designationIndex >= 0 && tarifIndex >= 0) return { rowIndex, refIndex, designationIndex, tarifIndex };
    }
    return null;
  }

  function findConditionHeader(rows){
    const aliases = {
      ref_5: ["ref", "ref.", "ref 5", "ref5", "reference", "reference 5", "reference5", "reference produit", "reference article"],
      code_produit: ["code produit", "codeproduit", "ref kent", "ref. kent"],
      categorie: ["categorie", "catégorie", "categorie famille", "cat"],
      famille: ["famille"],
      sous_famille: ["sous famille", "sous-famille", "sousfamille"],
      description: ["description", "designation", "désignation", "designation produit", "designation produits kent"],
      grains: ["grains", "grain"],
      emballage: ["embal", "embal.", "emballage", "conditionnement", "packaging"],
      tarif_revente: ["tarif revente", "prix revente", "tarif", "prix"]
    };
    const normalizedAliases = Object.fromEntries(Object.entries(aliases).map(([field, list]) => [field, list.map(normalizeHeaderToken)]));
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
      const tokens = (rows[rowIndex] || []).map(normalizeHeaderToken);
      const map = {};
      Object.entries(normalizedAliases).forEach(([field, list]) => {
        const index = tokens.findIndex(token => list.includes(token));
        if (index >= 0) map[field] = index;
      });
      if (Number.isInteger(map.ref_5) && Number.isInteger(map.emballage)) return { rowIndex, map };
    }
    return null;
  }

  function findTokenIndex(tokens, aliases){
    const normalized = aliases.map(normalizeHeaderToken);
    return tokens.findIndex(token => normalized.includes(token));
  }

  function downloadTariffTemplate(){
    const plaque = getSelectedTariffPlaque();
    const sector = currentValue("[data-tariff-sector]", "auto");
    const strategy = resolveTariffStrategy(plaque?.name || "", sector);
    if (strategy.key === "psa-revente") {
      writeWorkbook([
        ["UPE STELLANTIS 2026 - REVENTE", "", "", "", "", "", "", "", "", ""],
        ["Code Produit", "Code Stellantis", "Catégorie", "Famille", "Sous-Famille", "Description", "Grains", "Emballage", "Tarif Achat", "Tarif Revente"],
        ["BC720 24", "LKENBC720", "CHIMIQUES", "B TO C", "BIKE", "ALL SEASON CHAIN LUBE", "", "AER 500 ML", 11.70, 14.63]
      ], "modele_import_psa_tarif_revente.xlsx", "PSA Revente");
      return;
    }
    writeWorkbook([
      ["Référence", "Désignation produit", "Tarif"],
      ["LKEN12345", "Produit exemple", 12.50]
    ], "modele_import_tarif_plaque.xlsx", "Tarif");
  }

  function downloadConditioningTemplate(){
    const sector = currentValue("[data-cond-sector]", "auto");
    writeWorkbook([
      ["Ref.", "Code Produit", "Catégorie", "Famille", "Sous-Famille", "Description", "Grains", "Embal.", "Tarif Revente"],
      ["83980", "", "", "", "", "Produit exemple", "", "AER 500 ML", 14.63]
    ], `modele_conditionnements_${sector}.xlsx`, "Conditionnements");
  }

  function writeWorkbook(rows, filename, sheetName){
    if (!window.XLSX) {
      notify("Librairie Excel indisponible.", true);
      return;
    }
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName || "Import");
    window.XLSX.writeFile(wb, filename);
  }

  function getSelectedTariffPlaque(){
    const sector = currentValue("[data-tariff-sector]", "auto");
    const id = currentValue("[data-tariff-plaque]", "");
    return getPlaques(sector).find(plaque => plaque.id === id) || null;
  }

  function getPlaques(sector){
    return (state.catalog?.plaques?.[sector] || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "fr", { sensitivity: "base" }));
  }

  function getCommercials(){
    return (state.catalog?.commercials || []).slice().sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), "fr", { sensitivity: "base" }));
  }

  function currentValue(selector, fallback){
    const value = $(selector)?.value;
    return value || fallback;
  }

  function setSaveDisabled(selector, disabled){
    $all(selector).forEach(button => { button.disabled = Boolean(disabled); });
  }

  function setBusy(active){
    $all("[data-ref-admin-refresh], [data-tariff-preview], [data-tariff-template], [data-cond-preview], [data-cond-template], [data-ref-create-plaque], [data-ref-save-access]")
      .forEach(button => { button.disabled = Boolean(active); });
    if (!active) {
      setSaveDisabled("[data-tariff-save]", !state.tariffRows.length);
      setSaveDisabled("[data-cond-save]", !state.conditionRows.length);
      setSaveDisabled("[data-ref-save-access]", state.catalog?.accessReady === false);
    }
  }

  function renderWarning(message){
    $all("[data-ref-access-warning]").forEach(box => {
      box.hidden = false;
      box.textContent = message;
    });
  }

  function emptyMeta(){
    return { sheetsScanned: 0, sheetsUsed: 0, rowsRead: 0, validRows: 0, uniqueRefs: 0, duplicates: 0, errors: 0 };
  }

  function normalizeText(value){ return String(value ?? "").trim(); }

  function normalizeComparable(value){
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function normalizeHeaderToken(value){
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function normalizeReferenceKey(value){
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function parsePrice(value){
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
    let cleaned = String(value)
      .trim()
      .replace(/\s/g, "")
      .replace(/[€£$]/g, "")
      .replace(/[^0-9,.\-]/g, "");
    if (!cleaned) return NaN;
    const hasComma = cleaned.includes(",");
    const hasDot = cleaned.includes(".");
    if (hasComma && hasDot) {
      cleaned = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
    } else if (hasComma) {
      cleaned = cleaned.replace(",", ".");
    }
    const number = Number(cleaned);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
  }

  function formatCurrency(value){
    return Number.isFinite(Number(value))
      ? Number(value).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
      : "-";
  }

  function escapeHtml(value){
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function notify(message, isError){
    const toast = $("[data-toast]");
    if (toast) {
      toast.textContent = message;
      toast.classList.toggle("show", true);
      toast.classList.toggle("error", Boolean(isError));
      window.setTimeout(() => toast.classList.remove("show", "error"), 2800);
      return;
    }
    if (isError) console.error(message); else console.log(message);
  }

  function confirmDialog(message, options){
    if (typeof window.kentConfirm === "function") return window.kentConfirm(message, options || {});
    return Promise.resolve(window.confirm(message));
  }

  function alertDialog(message, options){
    if (typeof window.kentAlert === "function") return window.kentAlert(message, options || {});
    window.alert(message);
    return Promise.resolve();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
