import { MONTH_NAMES, aggregateRows, buildCumulModel } from "./reporting-cumul-model.js";

const root = document.querySelector("[data-cumul-app]");
if (root) initCumul(root);

function initCumul(root) {
  const $ = selector => root.querySelector(selector);
  const form = $("[data-cumul-filters]");
  const yearInput = form.elements.year;
  const monthInput = form.elements.month;
  const managerInput = form.elements.manager;
  const searchInput = form.elements.search;
  const state = { payload: null, settings: null, model: null, expanded: new Set(), details: new Set(), request: 0, controller: null };
  const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat("fr-FR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat("fr-FR");
  const today = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const currentYear = Number(today.year);
  const currentMonth = Number(today.month);
  const defaultYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  yearInput.innerHTML = Array.from({ length: currentYear - 2019 }, (_, index) => currentYear - index)
    .map(year => `<option value="${year}">${year}</option>`).join("");
  yearInput.value = String(defaultYear);
  monthInput.innerHTML = MONTH_NAMES.map((name, index) => `<option value="${index + 1}">${name}</option>`).join("");
  monthInput.value = String(currentMonth === 1 ? 12 : currentMonth - 1);
  updateMonthOptions();

  document.addEventListener("kent:admin-view", event => {
    if (event.detail?.view === "reporting-cumul") load();
  });
  form.addEventListener("submit", event => event.preventDefault());
  yearInput.addEventListener("change", () => { updateMonthOptions(); load(); });
  monthInput.addEventListener("change", render);
  managerInput.addEventListener("change", render);
  let searchTimer;
  searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
  $("[data-cumul-refresh]").addEventListener("click", load);
  $("[data-cumul-limit]").addEventListener("change", renderTables);
  $("[data-cumul-export]").addEventListener("click", exportExcel);
  $("[data-cumul-expand]").addEventListener("click", () => {
    if (!state.model) return;
    const allOpen = state.model.groups.every(group => state.expanded.has(group.id));
    state.model.groups.forEach(group => allOpen ? state.expanded.delete(group.id) : state.expanded.add(group.id));
    renderTables();
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-cumul-group], [data-cumul-seller]");
    if (!button || !state.model) return;
    const isGroup = button.hasAttribute("data-cumul-group");
    const id = isGroup ? button.dataset.cumulGroup : button.dataset.cumulSeller;
    const set = isGroup ? state.expanded : state.details;
    set.has(id) ? set.delete(id) : set.add(id);
    const origin = button.closest("[data-reporting-cumul-panel]");
    renderTables();
    const attribute = isGroup ? "data-cumul-group" : "data-cumul-seller";
    [...origin.querySelectorAll(`[${attribute}]`)].find(item => item.getAttribute(attribute) === id)?.focus({ preventScroll: true });
  });
  if (root.closest("[data-admin-view]").classList.contains("active")) load();

  function updateMonthOptions() {
    const max = Number(yearInput.value) === currentYear ? currentMonth : 12;
    for (const option of monthInput.options) option.disabled = Number(option.value) > max;
    if (Number(monthInput.value) > max) monthInput.value = String(max);
  }

  async function api(url, signal) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
    let payload;
    try { payload = await response.json(); } catch { throw new Error("Réponse indisponible. Vérifie ta connexion et ta session administrateur."); }
    if (!response.ok) throw new Error([401, 403].includes(response.status)
      ? "Session administrateur requise. Reconnecte-toi avant de charger le reporting."
      : payload.error || "Le reporting n’a pas pu être chargé.");
    return payload;
  }

  async function load() {
    const request = ++state.request;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    const year = Number(yearInput.value);
    const month = Number(monthInput.value);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
    clearResults();
    status("Chargement du CA et des budgets…");
    root.setAttribute("aria-busy", "true");
    try {
      const [payload, settings] = await Promise.all([
        api(`/api/responsable-dashboard?year=${year}&month=${month}&day=${day}&mode=cumul`, controller.signal),
        api(`/api/admin-finance-settings?year=${year}`, controller.signal)
      ]);
      if (request !== state.request) return;
      if (!Array.isArray(payload.commercials) || !Array.isArray(payload.errors) || !Array.isArray(settings.settings)
        || Number(payload.period?.year) !== year || Number(settings.year) !== year) {
        throw new Error("Le serveur n’a pas renvoyé le reporting attendu. Actualise après le déploiement de la nouvelle version.");
      }
      if (payload.errors.length) throw new Error(`Calcul suspendu : une source n’a pas pu charger. ${payload.errors.join(" · ")}`);
      state.payload = payload;
      state.settings = settings;
      render();
    } catch (error) {
      if (request !== state.request) return;
      controller.abort();
      clearResults();
      status(error.name === "AbortError" ? "Le chargement a pris trop de temps. Réessaie avec Actualiser." : error.message, true);
    } finally {
      clearTimeout(timeout);
      if (request === state.request) root.setAttribute("aria-busy", "false");
    }
  }

  function clearResults() {
    state.payload = null;
    state.settings = null;
    state.model = null;
    $("[data-cumul-result]").hidden = true;
    $("[data-cumul-projection]").replaceChildren();
    $("[data-cumul-ranking]").replaceChildren();
    $("[data-cumul-export]").disabled = true;
    $("[data-cumul-expand]").disabled = true;
  }

  function status(message, error = false) {
    $("[data-cumul-status]").textContent = message;
    $("[data-cumul-status]").classList.toggle("cumul-error", error);
  }

  function render() {
    if (!state.payload) return;
    try {
      const model = buildCumulModel({
        commercials: state.payload.commercials, settings: state.settings.settings,
        year: Number(yearInput.value), month: Number(monthInput.value),
        managerId: managerInput.value, search: searchInput.value
      });
      state.model = model;
      const manager = managerInput.value;
      managerInput.innerHTML = '<option value="">Tous les responsables</option>'
        + model.managers.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
      managerInput.value = model.managers.some(item => item.id === manager) ? manager : "";
      // A removed assignment must not leave an invisible filter active after a refresh.
      if (manager && !managerInput.value) return render();
      const date = new Date(Date.UTC(model.year, model.month, 0));
      const closing = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(date);
      const currentPartial = model.year === currentYear && model.month === currentMonth;
      $("[data-cumul-period]").innerHTML = `<strong>Janvier → ${MONTH_NAMES[model.month - 1]} ${model.year}</strong>
        <span>${model.rows.length} / ${model.totalCommercials} commerciaux actifs · Automobile + Industrie</span>
        ${currentPartial ? '<span class="cumul-warning">Mois en cours : données partielles, projection indicative</span>' : `<span>Cumul au ${closing}</span>`}`;
      $("[data-cumul-kpis]").innerHTML = [
        kpi("CA cumulé", euro.format(model.total.actual), `${model.month} mois pris en compte`),
        kpi("Budget cumulé", euro.format(model.total.budget), model.total.achievement === null ? "Taux non calculable sans budget positif" : `${rate(model.total.achievement)} d’atteinte`),
        kpi("Écart au budget", signed(model.total.gap), `${rate(model.total.gapRate, true)} vs budget cumulé`, tone(model.total.gap)),
        kpi("Projection annuelle", euro.format(model.total.projection), `Objectif annuel : ${euro.format(model.total.annualBudget)}`, "cumul-accent")
      ].join("");
      renderMethod(model);
      renderTables();
      $("[data-cumul-result]").hidden = false;
      $("[data-cumul-export]").disabled = !model.rows.length;
      $("[data-cumul-expand]").disabled = !model.rows.length;
      const loaded = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(state.payload.period.generatedAt));
      status(`Données chargées à ${loaded} · Lecture seule · Totaux calculés sur le périmètre filtré.`);
    } catch (error) {
      clearResults();
      status(error.message, true);
    }
  }

  function kpi(label, value, hint, className = "") {
    return `<article class="cumul-kpi ${className}"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`;
  }

  function renderMethod(model) {
    const notes = [];
    if (model.missingImportCount) notes.push(`${model.missingImportCount} commercial(aux) sans import actif sur au moins un mois réglé sur « Réel importé ». Les montants absents comptent pour 0 € : la projection est indicative. La présence d’un import ne garantit pas que toutes les entités soient couvertes.`);
    if (model.missingBudgetCount) notes.push(`${model.missingBudgetCount} commercial(aux) sans budget actif. Les taux sans budget positif sont affichés « — », jamais 0 %.`);
    if (state.settings.ready === false) notes.push("Les réglages de source Finance ne sont pas disponibles : ventes saisies utilisées par défaut, comme dans Reporting.");
    for (const warning of state.payload.warnings || []) notes.push(warning.message || warning.label);
    $("[data-cumul-check]").textContent = notes.length ? `· ${notes.length} point(s) à vérifier` : "· Sources Finance";
    $("[data-cumul-check]").className = notes.length ? "cumul-warning" : "";
    $("[data-cumul-method]").innerHTML = `
      <p><strong>CA :</strong> mêmes choix mensuels que Finance → Reporting. Pour chaque mois, une seule source : réel importé ou ventes saisies. Les deux ne sont jamais additionnés.</p>
      <div class="cumul-sources">${model.sources.slice(0, model.month).map((source, index) => `<span>${MONTH_NAMES[index]} : <b>${source === "real" ? "Réel importé" : "Ventes saisies"}</b></span>`).join("")}</div>
      <p><strong>Projection au rythme moyen :</strong> CA cumulé × 12 ÷ ${model.month} mois. C’est le prorata du modèle Excel, sans correction de saisonnalité. Le budget restant n’est pas ajouté à cette projection.</p>
      <p><strong>Objectif annuel :</strong> somme des 12 budgets mensuels actifs. <strong>Budget cumulé :</strong> janvier au mois sélectionné inclus. <strong>Reste objectif :</strong> objectif annuel − CA cumulé ; un montant négatif indique un objectif déjà dépassé.</p>
      <p><strong>Taux d’atteinte :</strong> somme du CA ÷ somme du budget. Aucune moyenne de pourcentages. Les arrondis de projection sont répartis au centime pour conserver l’égalité entre les lignes et leurs totaux.</p>
      <p><strong>Périmètre :</strong> commerciaux actifs, chacun compté une seule fois, sous son responsable principal actuel. Les rattachements exceptionnels ne doublonnent pas les ventes. Les comptes masqués ou inactifs sont exclus, comme dans Reporting.</p>
      ${notes.length ? `<ul class="cumul-notes">${notes.map(note => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}`;
  }

  function valuesCells(values) {
    return `<td class="cumul-number cumul-strong">${euro.format(values.actual)}</td>
      <td class="cumul-number">${euro.format(values.budget)}</td>
      <td class="cumul-number">${rate(values.achievement)}</td>
      <td class="cumul-number ${tone(values.gap)}">${signed(values.gap)}</td>
      <td class="cumul-number">${euro.format(values.annualBudget)}</td>
      <td class="cumul-number cumul-strong">${euro.format(values.projection)}<small>${rate(values.projectionRate)} de l’objectif</small></td>
      <td class="cumul-number">${euro.format(values.remaining)}</td>`;
  }

  function renderTables() {
    const model = state.model;
    if (!model) return;
    if (!model.rows.length) {
      const empty = '<div class="cumul-empty">Aucun commercial dans ce périmètre. Modifie le responsable ou la recherche.</div>';
      $("[data-cumul-projection]").innerHTML = empty;
      $("[data-cumul-ranking]").innerHTML = empty;
      return;
    }
    $("[data-cumul-expand]").textContent = model.groups.every(group => state.expanded.has(group.id)) ? "Replier les équipes" : "Déplier les équipes";
    const projectionBody = model.groups.map((group, groupIndex) => {
      const open = state.expanded.has(group.id);
      return `<tbody><tr class="cumul-group"><th scope="row"><button class="cumul-row-button" data-cumul-group="${escapeHtml(group.id)}" aria-expanded="${open}" aria-controls="cumul-team-${groupIndex}">
        <span class="cumul-chevron" aria-hidden="true">${open ? "−" : "+"}</span><span>${escapeHtml(group.name)}<small>${group.rows.length} commercial(aux)</small></span></button></th>${valuesCells(group.values)}</tr></tbody>
        <tbody id="cumul-team-${groupIndex}" ${open ? "" : "hidden"}>${open ? group.rows.map((row, index) => `<tr class="cumul-seller"><th scope="row">${sellerButton(row, `projection-${groupIndex}-${index}`)}</th>${valuesCells(row.values)}</tr>${sellerDetail(row, 8, `projection-${groupIndex}-${index}`)}`).join("") : ""}</tbody>`;
    }).join("");
    $("[data-cumul-projection]").innerHTML = `<div class="cumul-table-wrap" tabindex="0" role="region" aria-label="Projection par responsable et commercial"><table class="cumul-table">
      <caption class="cumul-sr-only">Projection annuelle, cumul de janvier à ${MONTH_NAMES[model.month - 1]} ${model.year}</caption>
      <thead><tr><th scope="col" class="cumul-name-col">Responsable / Commercial</th><th scope="col">CA cumulé</th><th scope="col">Budget cumulé</th><th scope="col">Atteinte</th><th scope="col">Écart €</th><th scope="col">Objectif annuel</th><th scope="col">Projection annuelle</th><th scope="col">Reste objectif</th></tr></thead>
      ${projectionBody}<tfoot><tr><th scope="row">Total du périmètre</th>${valuesCells(model.total)}</tr></tfoot></table></div>`;
    renderRanking(model);
  }

  function sellerButton(row, key) {
    return `<button class="cumul-row-button" data-cumul-seller="${escapeHtml(row.id)}" aria-expanded="${state.details.has(row.id)}" aria-controls="cumul-detail-${key}">
      <span class="cumul-chevron" aria-hidden="true">${state.details.has(row.id) ? "−" : "+"}</span><span>${escapeHtml(row.name)}<small>${escapeHtml(row.identifier)}${row.missingImports.length ? ' <span class="cumul-warning" title="Un import manque sur au moins un mois du cumul">· Import à vérifier</span>' : ""}</small></span></button>`;
  }

  function sellerDetail(row, colspan, key) {
    if (!state.details.has(row.id)) return `<tr id="cumul-detail-${key}" hidden><td colspan="${colspan}"></td></tr>`;
    const model = state.model;
    return `<tr class="cumul-detail" id="cumul-detail-${key}"><td colspan="${colspan}"><div class="cumul-detail-head"><strong>Détail mensuel · ${escapeHtml(row.name)}</strong><span>${escapeHtml(row.managerName)}${row.sector ? ` · ${escapeHtml(row.sector)}` : ""}</span></div>
      <table class="cumul-month-table"><caption class="cumul-sr-only">CA et budget mensuels de ${escapeHtml(row.name)}</caption>
        <thead><tr><th scope="col">Mois ${model.year}</th><th scope="col">Source du CA</th><th scope="col">CA</th><th scope="col">Budget</th><th scope="col">Écart €</th><th scope="col">Atteinte</th></tr></thead>
        <tbody>${MONTH_NAMES.map((name, index) => {
          const included = index < model.month;
          const actual = row.values.monthlyActual[index];
          const budget = row.values.monthlyBudget[index];
          return `<tr ${included ? "" : 'class="cumul-future"'}><th scope="row">${name}${included ? "" : " · hors cumul"}</th>
            <td>${included ? model.sources[index] === "real" ? row.missingImports.includes(index + 1) ? '<span class="cumul-warning">Aucun import actif</span>' : "Réel importé" : "Ventes saisies" : "Hors période"}</td>
            <td class="cumul-number">${included ? euro.format(actual) : "—"}</td><td class="cumul-number">${euro.format(budget)}</td>
            <td class="cumul-number ${included ? tone(actual - budget) : ""}">${included ? signed(actual - budget) : "—"}</td><td class="cumul-number">${included ? rate(budget > 0 ? actual / budget : null) : "—"}</td></tr>`;
        }).join("")}</tbody></table></td></tr>`;
  }

  function renderRanking(model) {
    const shown = $("[data-cumul-limit]").value === "all" ? model.rows : model.rows.slice(0, 100);
    const subtotal = aggregateRows(shown, model.month);
    const totalPositive = model.total.actual > 0;
    $("[data-cumul-ranking]").innerHTML = `<p class="cumul-ranking-count">${shown.length} / ${model.rows.length} commerciaux affichés. Les indicateurs du haut portent sur tout le périmètre filtré, pas seulement le Top 100.</p>
      <div class="cumul-table-wrap" tabindex="0" role="region" aria-label="Classement des commerciaux par CA"><table class="cumul-table cumul-ranking-table">
      <caption class="cumul-sr-only">Classement CA cumulé de janvier à ${MONTH_NAMES[model.month - 1]} ${model.year}</caption>
      <thead><tr><th scope="col">Rang</th><th scope="col" class="cumul-name-col">Commercial</th><th scope="col">Responsable</th><th scope="col">CA cumulé</th><th scope="col">Budget cumulé</th><th scope="col">Atteinte</th><th scope="col">Écart €</th><th scope="col">Part du CA</th></tr></thead>
      <tbody>${shown.map((row, index) => `<tr><td><span class="cumul-rank">${integer.format(row.rank)}</span></td><th scope="row">${sellerButton(row, `rank-${index}`)}</th>
        <td class="cumul-manager-name">${escapeHtml(row.managerName)}</td><td class="cumul-number cumul-strong">${euro.format(row.values.actual)}</td><td class="cumul-number">${euro.format(row.values.budget)}</td><td class="cumul-number">${rate(row.values.achievement)}</td><td class="cumul-number ${tone(row.values.gap)}">${signed(row.values.gap)}</td><td class="cumul-number">${rate(totalPositive ? row.values.actual / model.total.actual : null)}</td></tr>${sellerDetail(row, 8, `rank-${index}`)}`).join("")}</tbody>
      <tfoot><tr><th colspan="3" scope="row">Total des ${shown.length} commerciaux affichés</th><td class="cumul-number">${euro.format(subtotal.actual)}</td><td class="cumul-number">${euro.format(subtotal.budget)}</td><td class="cumul-number">${rate(subtotal.achievement)}</td><td class="cumul-number ${tone(subtotal.gap)}">${signed(subtotal.gap)}</td><td class="cumul-number">${rate(totalPositive ? subtotal.actual / model.total.actual : null)}</td></tr></tfoot></table></div>`;
  }

  function exportExcel() {
    render();
    const model = state.model;
    if (!model?.rows.length) return;
    try {
      const XLSX = window.XLSX;
      if (!XLSX?.utils) throw new Error("L’export Excel n’a pas pu se charger. Vérifie ta connexion puis actualise la page.");
      const workbook = XLSX.utils.book_new();
      const headings = ["Rang CA", "Identifiant", "Commercial", "Responsable", "Secteur", "CA cumulé", "Budget cumulé", "Atteinte", "Écart €", "Objectif annuel", "Projection annuelle", "Projection / objectif", "Reste objectif"];
      const toValues = values => [values.actual, values.budget, values.achievement, values.gap, values.annualBudget, values.projection, values.projectionRate, values.remaining];
      const data = [headings, ...model.rows.map(row => [row.rank, row.identifier, row.name, row.managerName, row.sector, ...toValues(row.values)]), [null, null, "Total du périmètre", null, null, ...toValues(model.total)]];
      addSheet("Commerciaux", data, [7, 11], [5, 6, 8, 9, 10, 12]);
      addSheet("Responsables", [["Responsable", "Commerciaux", ...headings.slice(5)], ...model.groups.map(group => [group.name, group.rows.length, ...toValues(group.values)]), ["Total du périmètre", model.rows.length, ...toValues(model.total)]], [4, 8], [2, 3, 5, 6, 7, 9]);
      addSheet("Mensuel", [["Identifiant", "Commercial", "Responsable", "Mois", "Inclus dans le cumul", "Source", "CA", "Budget", "Écart €", "Atteinte"], ...model.rows.flatMap(row => MONTH_NAMES.map((name, index) => {
        const included = index < model.month;
        const actual = row.values.monthlyActual[index];
        const budget = row.values.monthlyBudget[index];
        return [row.identifier, row.name, row.managerName, name, included ? "Oui" : "Non", included ? model.sources[index] === "real" ? "Réel importé" : "Ventes saisies" : "Hors période", included ? actual : null, budget, included ? actual - budget : null, included && budget > 0 ? actual / budget : null];
      }))], [9], [6, 7, 8]);
      addSheet("Méthode", [
        ["Reporting cumul", `Janvier à ${MONTH_NAMES[model.month - 1]} ${model.year}`],
        ["Responsable", managerInput.selectedOptions[0].textContent], ["Recherche", searchInput.value],
        ["Chargement", state.payload.period.generatedAt], ["Périmètre", "Commerciaux actifs, automobile et industrie, rattachement principal actuel. Export complet du filtre, au-delà du Top 100 si nécessaire."],
        ["CA", "Une source par mois, conformément aux réglages Finance. Aucune addition du réel importé et des ventes saisies."],
        ["Projection", `CA cumulé × 12 / ${model.month}. Prorata indicatif sans saisonnalité. Arrondis répartis au centime.`],
        ["Atteinte", "Somme du CA / somme du budget. Taux non calculé si budget nul ou négatif. Aucune moyenne de moyennes."],
        ["Reste objectif", "Objectif annuel - CA cumulé. Négatif si l’objectif est déjà dépassé."],
        ...model.sources.slice(0, model.month).map((source, index) => [MONTH_NAMES[index], source === "real" ? "Réel importé" : "Ventes saisies"]),
        ...model.rows.filter(row => row.missingImports.length).map(row => [row.identifier, `Import actif absent : ${row.missingImports.map(month => MONTH_NAMES[month - 1]).join(", ")}. Montants absents comptés pour 0 €. Projection indicative.`]),
        ...model.rows.filter(row => !row.hasBudget).map(row => [row.identifier, "Aucun budget actif."]),
        ...(model.year === currentYear && model.month === currentMonth ? [["Attention", "Mois en cours incomplet, compté comme un mois entier dans le prorata."]] : []),
        ...(state.settings.ready === false ? [["Attention", "Réglages Finance indisponibles : ventes saisies utilisées par défaut."]] : []),
        ...(state.payload.warnings || []).map(warning => ["Attention", warning.message || warning.label])
      ], [], []);
      XLSX.writeFile(workbook, `KENTIX_Reporting_cumul_${model.year}_${String(model.month).padStart(2, "0")}.xlsx`);

      function addSheet(name, rows, rates, amounts) {
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        for (let row = 1; row < rows.length; row++) {
          for (const col of rates) if (sheet[XLSX.utils.encode_cell({ r: row, c: col })]) sheet[XLSX.utils.encode_cell({ r: row, c: col })].z = "0.0%";
          for (const col of amounts) if (sheet[XLSX.utils.encode_cell({ r: row, c: col })]) sheet[XLSX.utils.encode_cell({ r: row, c: col })].z = '#,##0.00 "€"';
        }
        sheet["!cols"] = rows[0].map((_, index) => ({ wch: name === "Méthode" ? index ? 110 : 24 : index < 5 ? 24 : 19 }));
        sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: name === "Commerciaux" || name === "Responsables" ? rows.length - 2 : rows.length - 1, c: rows[0].length - 1 }) };
        XLSX.utils.book_append_sheet(workbook, sheet, name);
      }
    } catch (error) { status(error.message, true); }
  }

  function signed(value) { return `${value > 0 ? "+" : ""}${euro.format(value)}`; }
  function rate(value, sign = false) { return value === null ? "—" : `${sign && value > 0 ? "+" : ""}${percent.format(value)}`; }
  function tone(value) { return value > 0 ? "cumul-positive" : value < 0 ? "cumul-negative" : ""; }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
