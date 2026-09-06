export const MONTH_NAMES = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
export const UNASSIGNED = "__sans_responsable__";

const sum = values => values.reduce((total, value) => total + value, 0);
const compareNames = (a, b) => a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id);
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const money = cents => cents / 100;
const ratio = (amount, budget) => budget > 0 ? amount / budget : null;

function cents(value) {
  if (value === null || value === "" || !Number.isFinite(Number(value))) {
    throw new Error("Un montant est invalide. Le reporting n’a pas été calculé.");
  }
  const number = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(number)) throw new Error("Un montant dépasse la précision autorisée.");
  return number;
}

function monthly(values) {
  if (!Array.isArray(values) || values.length !== 12) {
    throw new Error("Les douze montants mensuels sont nécessaires au calcul.");
  }
  return values.map(cents);
}

export function sourcesForYear(settings, year) {
  const sources = Array(12).fill("sales");
  const seen = new Set();
  for (const setting of settings || []) {
    if (Number(setting.year) !== year) continue;
    const month = Number(setting.month);
    if (!Number.isInteger(month) || month < 1 || month > 12 || seen.has(month) || !["real", "sales"].includes(setting.source)) {
      throw new Error("Les sources Finance de cette année sont incohérentes.");
    }
    seen.add(month);
    sources[month - 1] = setting.source;
  }
  return sources;
}

function metrics(actual, budget, month, projection) {
  const actualYtd = sum(actual.slice(0, month));
  const budgetYtd = sum(budget.slice(0, month));
  const annualBudget = sum(budget);
  return {
    actual: money(actualYtd),
    budget: money(budgetYtd),
    gap: money(actualYtd - budgetYtd),
    achievement: ratio(actualYtd, budgetYtd),
    gapRate: ratio(actualYtd - budgetYtd, budgetYtd),
    annualBudget: money(annualBudget),
    remaining: money(annualBudget - actualYtd),
    projection: money(projection),
    projectionRate: ratio(projection, annualBudget),
    projectionGap: money(projection - annualBudget),
    monthlyActual: actual.map(money),
    monthlyBudget: budget.map(money)
  };
}

// Distribute sub-cent projection remainders so each subtotal equals its displayed lines.
// Ratios always come from summed amounts, never from averaging seller percentages.
function allocateProjections(rows, month) {
  const parts = rows.map(row => {
    const numerator = sum(row.actualCents.slice(0, month)) * 12;
    const floor = Math.floor(numerator / month);
    return { row, floor, remainder: numerator - floor * month };
  });
  const target = Math.round(sum(rows.map(row => sum(row.actualCents.slice(0, month)))) * 12 / month);
  let extras = target - sum(parts.map(part => part.floor));
  parts.sort((a, b) => b.remainder - a.remainder || a.row.id.localeCompare(b.row.id));
  for (const part of parts) {
    part.row.projectionCents = part.floor + (extras-- > 0 ? 1 : 0);
  }
}

export function aggregateRows(rows, month) {
  const actual = Array(12).fill(0);
  const budget = Array(12).fill(0);
  let projection = 0;
  for (const row of rows) {
    row.actualCents.forEach((value, index) => { actual[index] += value; });
    row.budgetCents.forEach((value, index) => { budget[index] += value; });
    projection += row.projectionCents;
  }
  if ([...actual, ...budget, projection].some(value => !Number.isSafeInteger(value))) {
    throw new Error("Le total dépasse la précision autorisée.");
  }
  return metrics(actual, budget, month, projection);
}

export function buildCumulModel({ commercials, settings = [], year, month, managerId = "", search = "" }) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Sélectionne une année et un mois valides.");
  }
  if (!Array.isArray(commercials)) throw new Error("La liste des commerciaux est indisponible.");
  const sources = sourcesForYear(settings, year);
  const seen = new Set();
  const managers = new Map();
  const allRows = commercials.filter(item => item.active !== false && !item.hidden).map(item => {
    const id = String(item.id || "");
    if (!id || seen.has(id)) throw new Error("Commercial manquant ou en double : calcul interrompu pour éviter un double comptage.");
    seen.add(id);
    const parentId = item.relationType === "principal" && item.responsableId ? String(item.responsableId) : UNASSIGNED;
    const parent = (item.responsables || []).find(manager => String(manager.id) === parentId);
    const managerName = parentId === UNASSIGNED ? "Sans responsable principal" : parent?.displayName || parent?.display_name || "Responsable non disponible";
    managers.set(parentId, { id: parentId, name: managerName });
    const values = item.metrics || {};
    const sales = monthly(values.caMensuel);
    const real = monthly(values.reelMensuel);
    const actualCents = sources.map((source, index) => source === "real" ? real[index] : sales[index]);
    const budgetCents = monthly(values.budgetMensuel);
    const imported = new Set((values.reelMoisImportes || []).map(Number));
    return {
      id, name: item.displayName || item.identifier || "Commercial", identifier: item.identifier || "",
      managerId: parentId, managerName, sector: item.sectorName || "",
      actualCents, budgetCents, projectionCents: 0,
      missingImports: sources.slice(0, month).flatMap((source, index) => source === "real" && !imported.has(index + 1) ? [index + 1] : []),
      hasBudget: Number(values.budgetsActifs || 0) > 0 || budgetCents.some(value => value !== 0)
    };
  });
  const query = normalize(search).trim();
  const rows = allRows.filter(row => (!managerId || row.managerId === managerId)
    && (!query || normalize([row.name, row.identifier, row.managerName, row.sector].join(" ")).includes(query)));
  allocateProjections(rows, month);
  rows.forEach(row => { row.values = metrics(row.actualCents, row.budgetCents, month, row.projectionCents); });
  rows.sort((a, b) => b.values.actual - a.values.actual || compareNames(a, b));
  rows.forEach((row, index) => { row.rank = index && row.values.actual === rows[index - 1].values.actual ? rows[index - 1].rank : index + 1; });
  const groupMap = new Map();
  for (const row of rows) {
    if (!groupMap.has(row.managerId)) groupMap.set(row.managerId, { ...managers.get(row.managerId), rows: [] });
    groupMap.get(row.managerId).rows.push(row);
  }
  const groups = [...groupMap.values()].map(group => ({ ...group, values: aggregateRows(group.rows, month) }))
    .sort((a, b) => a.id === UNASSIGNED ? 1 : b.id === UNASSIGNED ? -1 : b.values.actual - a.values.actual || compareNames(a, b));
  return {
    year, month, sources, rows, groups, total: aggregateRows(rows, month),
    managers: [...managers.values()].sort(compareNames),
    totalCommercials: allRows.length,
    missingImportCount: rows.filter(row => row.missingImports.length).length,
    missingBudgetCount: rows.filter(row => !row.hasBudget).length
  };
}
