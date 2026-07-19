import {
  ROLE_LABELS,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const USER_SELECT = [
  "id",
  "identifier",
  "display_name",
  "role",
  "home_path",
  "active",
  "hidden",
  "created_at",
  "updated_at",
  "last_login_at"
].join(",");

const RELATION_SELECT = [
  "id",
  "responsable_user_id",
  "commercial_user_id",
  "relation_type",
  "active",
  "note",
  "created_at",
  "updated_at"
].join(",");

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABELS = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];
const PAGE_SIZE = 1000;
const PARIS_TIMEZONE = "Europe/Paris";
const VISIT_TYPE_PHONE_ORDER = "commande_telephone";
const PHONE_ORDER_NOTE_MARKER = "[COMMANDE_TELEPHONE]";

const SALES_SOURCES = [
  {
    secteur: "auto",
    label: "Automobile",
    visites: "visites",
    lignes: "visite_commandes",
    clients: "clients",
    produits: "produits"
  },
  {
    secteur: "industrie",
    label: "Industrie",
    visites: "industrie_visites",
    lignes: "industrie_visite_commandes",
    clients: "industrie_clients",
    produits: "industrie_produits"
  }
];

export default async function handler(request, response) {
  const guard = requireRole(request, ["admin", "responsable"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    sendJson(response, 200, await buildDashboard(guard.session, request));
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: error.message || "Dashboard responsable indisponible."
    });
  }
}

async function buildDashboard(session, request) {
  const period = parsePeriod(request);
  const [users, relations] = await Promise.all([listUsers(), listRelations()]);
  const activeUsers = users.filter((user) => user.active && !user.hidden);
  const activeRelations = relations.filter((relation) => relation.active);
  const currentPortalUser = resolveCurrentPortalUser(session, users);

  const visibleCommercials =
    session.role === "admin"
      ? buildAdminCommercialScope(activeUsers, activeRelations, users)
      : buildResponsableCommercialScope(currentPortalUser, activeUsers, activeRelations, users);

  const commercialIds = visibleCommercials.map((item) => item.id).filter(Boolean);
  const warnings = [];

  const [salesBlock, budgetBlock, realBlock, documentsBlock] = await Promise.all([
    safeBlock(() => buildSalesBlock(commercialIds, period), emptySalesBlock(), warnings, "ventes terrain"),
    safeBlock(() => buildBudgetBlock(commercialIds, period), emptyBudgetBlock(), warnings, "budgets"),
    safeBlock(() => buildRealBlock(commercialIds, period), emptyRealBlock(), warnings, "reel importe"),
    safeBlock(() => buildDocumentsBlock(commercialIds, period), emptyDocumentsBlock(), warnings, "BDC / devis")
  ]);

  const enrichedCommercials = visibleCommercials.map((commercial) => enrichCommercial(commercial, {
    salesBlock,
    budgetBlock,
    realBlock,
    documentsBlock
  }));

  const principalRelations = enrichedCommercials.filter((item) => item.relationType === "principal");
  const exceptionalRelations = enrichedCommercials.filter((item) => item.relationType === "exceptionnel");
  const connectedRecently = enrichedCommercials.filter((item) => isRecentLogin(item.lastLoginAt)).length;
  const dataReady = enrichedCommercials.filter((item) => item.metrics.caAnnee || item.metrics.budgetAnnuel || item.metrics.reelReportingAnnee).length;
  const topCommercials = enrichedCommercials
    .slice()
    .sort((a, b) => Number(b.metrics.caMois || 0) - Number(a.metrics.caMois || 0))
    .slice(0, 8);

  return {
    currentUser: {
      id: session.userId,
      dbUserId: session.dbUserId || currentPortalUser?.id || "",
      name: session.name || currentPortalUser?.display_name || "Utilisateur",
      role: session.role,
      roleLabel: ROLE_LABELS[session.role] || session.role,
      source: session.source || "",
      foundInSupabase: Boolean(currentPortalUser)
    },
    period,
    stats: {
      commerciaux: enrichedCommercials.length,
      principal: principalRelations.length,
      exceptionnel: exceptionalRelations.length,
      connectedRecently,
      dataReady,
      caJour: salesBlock.totals.day,
      caMois: salesBlock.totals.month,
      caAnnee: salesBlock.totals.year,
      caAutoMois: salesBlock.totals.monthAuto,
      caIndustrieMois: salesBlock.totals.monthIndustrie,
      budgetAnnuel: budgetBlock.totals.year,
      budgetADate: budgetBlock.totals.toDate,
      reelReportingAnnee: realBlock.totals.year,
      reelReportingADate: realBlock.totals.toDate,
      ecartADate: realBlock.totals.toDate - budgetBlock.totals.toDate,
      documentsEnCours: documentsBlock.totals.enCours,
      bdcEnCours: documentsBlock.totals.bdcEnCours,
      devisEnCours: documentsBlock.totals.devisEnCours,
      visitesMois: salesBlock.totals.visitsMonth,
      commandesTelephoneMois: salesBlock.totals.phoneMonth,
      clientsMois: salesBlock.totals.clientsMonth
    },
    dataScope: buildDataScope(session, currentPortalUser, warnings),
    team: {
      topCommercials,
      alerts: buildAlerts(enrichedCommercials)
    },
    commercials: enrichedCommercials,
    sales: salesBlock,
    budgets: budgetBlock,
    real: realBlock,
    documents: documentsBlock,
    warnings,
    actions: {
      canEditSales: false,
      canReadCommercials: true,
      note: "Lecture seule responsable : aucune modification des ventes ou documents depuis cette vue."
    }
  };
}

function parsePeriod(request) {
  const url = new URL(request.url, "http://localhost");
  const today = getParisParts(new Date());
  const year = clampNumber(url.searchParams.get("year"), 2020, 2100, today.year);
  const month = clampNumber(url.searchParams.get("month"), 1, 12, today.month);
  const rawDay = url.searchParams.get("day") || `${year}-${String(month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : today.isoDate;
  return {
    year,
    month,
    day,
    monthKey: MONTH_KEYS[month - 1],
    monthLabel: MONTH_LABELS[month - 1],
    toDateMonth: month,
    generatedAt: new Date().toISOString()
  };
}

function getParisParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

async function safeBlock(factory, fallback, warnings, label) {
  try {
    return await factory();
  } catch (error) {
    warnings.push({ label, message: error.message || "Chargement impossible." });
    return { ...fallback, error: error.message || "Chargement impossible." };
  }
}

async function listUsers() {
  return supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&order=display_name.asc`
  );
}

async function listRelations() {
  return supabaseAdminFetch(
    `/rest/v1/portal_user_relations?select=${encodeURIComponent(RELATION_SELECT)}&order=created_at.asc`
  );
}

async function buildSalesBlock(commercialIds, period) {
  if (!commercialIds.length) return emptySalesBlock();
  const sourceResults = await Promise.all(
    SALES_SOURCES.map((source) => loadSalesSource(source, commercialIds, period))
  );
  const rows = sourceResults.flatMap((item) => item.rows);
  const visits = sourceResults.flatMap((item) => item.visits);
  return summarizeSalesRows(rows, visits, period);
}

async function loadSalesSource(source, commercialIds, period) {
  const visits = await fetchByCommercialChunks(source.visites, "id,client_id,date_visite,note,type_visite,total_commande,commercial_user_id", commercialIds, {
    date_visite: `gte.${period.year}-01-01`,
    date_visite_lte: `lte.${period.year}-12-31`,
    order: "date_visite.desc,id.asc"
  }, { date_visite_lte: "date_visite" });

  if (!visits.length) return { rows: [], visits: [] };

  const visitIds = visits.map((visit) => visit.id).filter(Boolean);
  const clientIds = unique(visits.map((visit) => visit.client_id).filter(Boolean));
  const [lines, clients] = await Promise.all([
    fetchByChunks(source.lignes, "id,visite_id,produit_id,quantite,stock_client,couleur,prix_unitaire", "visite_id", visitIds, { order: "visite_id.asc,id.asc" }),
    fetchByChunks(source.clients, "id,nom,numero_compte,plaque_id,commercial_user_id", "id", clientIds)
  ]);

  const productIds = unique(lines.map((line) => line.produit_id).filter(Boolean));
  const products = await fetchByChunks(source.produits, "id,nom,reference_produit,prix_vente", "id", productIds);
  const clientById = new Map(clients.map((client) => [String(client.id), client]));
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const visitById = new Map(visits.map((visit) => [String(visit.id), visit]));

  const enrichedVisits = visits.map((visit) => {
    const client = clientById.get(String(visit.client_id));
    return {
      id: visit.id,
      secteur: source.secteur,
      secteurLabel: source.label,
      commercialUserId: visit.commercial_user_id || "",
      clientId: visit.client_id || "",
      clientNom: client?.nom || "Client sans nom",
      numeroCompte: client?.numero_compte || "",
      date: normalizeText(visit.date_visite),
      typeVisite: normalizeVisitType(visit),
      isPhoneOrder: isPhoneOrderVisit(visit),
      totalCommande: toNumber(visit.total_commande)
    };
  });

  const rows = lines.map((line) => {
    const visit = visitById.get(String(line.visite_id));
    const client = clientById.get(String(visit?.client_id));
    const product = productById.get(String(line.produit_id));
    const quantity = toNumber(line.quantite);
    const unitPrice = toNumber(line.prix_unitaire);
    return {
      id: line.id,
      visitId: line.visite_id || "",
      source: source.secteur,
      secteur: source.secteur,
      secteurLabel: source.label,
      commercialUserId: visit?.commercial_user_id || "",
      clientId: visit?.client_id || "",
      clientNom: client?.nom || "Client sans nom",
      numeroCompte: client?.numero_compte || "",
      date: normalizeText(visit?.date_visite),
      typeVisite: normalizeVisitType(visit),
      typeLabel: isPhoneOrderVisit(visit) ? "Commande telephone" : "Visite terrain",
      isPhoneOrder: isPhoneOrderVisit(visit),
      reference: product?.reference_produit || "",
      designation: product?.nom || "Produit sans designation",
      quantite: quantity,
      prixUnitaire: unitPrice,
      montant: roundMoney(quantity * unitPrice)
    };
  }).filter((row) => row.commercialUserId);

  return { rows, visits: enrichedVisits };
}

function summarizeSalesRows(rows, visits, period) {
  const byCommercial = new Map();
  const topClientsMonth = new Map();
  let totals = {
    day: 0,
    month: 0,
    year: 0,
    monthAuto: 0,
    monthIndustrie: 0,
    visitsMonth: 0,
    phoneMonth: 0,
    clientsMonth: 0
  };

  const dayRows = [];
  const monthRows = [];
  const yearRows = [];

  for (const row of rows) {
    const commercial = ensureSalesCommercial(byCommercial, row.commercialUserId);
    commercial.year += row.montant;
    totals.year += row.montant;
    yearRows.push(row);

    if (sameMonth(row.date, period.year, period.month)) {
      commercial.month += row.montant;
      totals.month += row.montant;
      monthRows.push(row);
      if (row.secteur === "industrie") {
        commercial.monthIndustrie += row.montant;
        totals.monthIndustrie += row.montant;
      } else {
        commercial.monthAuto += row.montant;
        totals.monthAuto += row.montant;
      }
      const key = `${row.commercialUserId}::${row.clientId || row.clientNom}`;
      const current = topClientsMonth.get(key) || {
        commercialUserId: row.commercialUserId,
        clientId: row.clientId,
        clientNom: row.clientNom,
        numeroCompte: row.numeroCompte,
        montant: 0,
        lignes: 0
      };
      current.montant += row.montant;
      current.lignes += 1;
      topClientsMonth.set(key, current);
    }

    if (row.date === period.day) {
      commercial.day += row.montant;
      totals.day += row.montant;
      dayRows.push(row);
    }
  }

  const visitKeysMonth = new Set();
  const phoneVisitKeysMonth = new Set();
  const clientKeysMonth = new Set();
  for (const visit of visits) {
    const commercial = ensureSalesCommercial(byCommercial, visit.commercialUserId);
    if (sameMonth(visit.date, period.year, period.month)) {
      visitKeysMonth.add(`${visit.secteur}:${visit.id}`);
      clientKeysMonth.add(`${visit.secteur}:${visit.clientId || visit.clientNom}`);
      commercial.visitsMonth += 1;
      if (visit.isPhoneOrder) {
        phoneVisitKeysMonth.add(`${visit.secteur}:${visit.id}`);
        commercial.phoneMonth += 1;
      } else {
        commercial.terrainMonth += 1;
      }
      commercial.clientsMonthSet.add(`${visit.secteur}:${visit.clientId || visit.clientNom}`);
    }
  }

  totals = mapMoneyTotals({
    ...totals,
    visitsMonth: visitKeysMonth.size,
    phoneMonth: phoneVisitKeysMonth.size,
    clientsMonth: clientKeysMonth.size
  });

  const byCommercialObject = Object.fromEntries(
    Array.from(byCommercial.entries()).map(([id, value]) => [id, {
      day: roundMoney(value.day),
      month: roundMoney(value.month),
      year: roundMoney(value.year),
      monthAuto: roundMoney(value.monthAuto),
      monthIndustrie: roundMoney(value.monthIndustrie),
      visitsMonth: value.visitsMonth,
      phoneMonth: value.phoneMonth,
      terrainMonth: value.terrainMonth,
      clientsMonth: value.clientsMonthSet.size
    }])
  );

  return {
    totals,
    byCommercial: byCommercialObject,
    dailyRows: sortRows(dayRows).slice(0, 400),
    monthlyRows: sortRows(monthRows).slice(0, 1200),
    yearlyRows: sortRows(yearRows).slice(0, 1500),
    topClientsMonth: Array.from(topClientsMonth.values())
      .map((item) => ({ ...item, montant: roundMoney(item.montant) }))
      .sort((a, b) => b.montant - a.montant)
      .slice(0, 30)
  };
}

function ensureSalesCommercial(map, commercialUserId) {
  const key = commercialUserId || "unknown";
  if (!map.has(key)) {
    map.set(key, {
      day: 0,
      month: 0,
      year: 0,
      monthAuto: 0,
      monthIndustrie: 0,
      visitsMonth: 0,
      phoneMonth: 0,
      terrainMonth: 0,
      clientsMonthSet: new Set()
    });
  }
  return map.get(key);
}

async function buildBudgetBlock(commercialIds, period) {
  if (!commercialIds.length) return emptyBudgetBlock();
  const budgets = await fetchByCommercialChunks("budgets", "id,projection_id,entite_id,nom,annee,statut,total_annuel,nb_lignes,validated_at,commercial_user_id,commercial_identifier,commercial_name", commercialIds, {
    annee: `eq.${period.year}`,
    statut: "eq.active",
    order: "validated_at.desc,created_at.desc"
  });
  if (!budgets.length) return emptyBudgetBlock();

  const entityIds = unique(budgets.map((budget) => budget.entite_id).filter(Boolean));
  const budgetIds = unique(budgets.map((budget) => budget.id).filter(Boolean));
  const [entities, lines] = await Promise.all([
    fetchByChunks("budget_entites", "id,key,libelle,ordre,actif,commercial_user_id", "id", entityIds),
    fetchByChunks("budget_lignes", "id,budget_id,client_nom,numero_client,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,total,commercial_user_id", "budget_id", budgetIds, { order: "budget_id.asc,ordre.asc" })
  ]);

  const entityById = new Map(entities.map((entity) => [String(entity.id), entity]));
  const budgetById = new Map(budgets.map((budget) => [String(budget.id), budget]));
  const rows = lines.map((line) => {
    const budget = budgetById.get(String(line.budget_id));
    const entity = entityById.get(String(budget?.entite_id));
    const monthly = monthlyFromRow(line);
    return {
      id: line.id,
      budgetId: line.budget_id,
      commercialUserId: line.commercial_user_id || budget?.commercial_user_id || "",
      commercialName: budget?.commercial_name || "",
      entiteId: budget?.entite_id || "",
      entiteKey: entity?.key || "",
      entiteLibelle: entity?.libelle || "Entite",
      clientNom: line.client_nom || "Client sans nom",
      numeroClient: line.numero_client || "",
      monthly,
      total: roundMoney(monthly.reduce((sum, value) => sum + value, 0)),
      toDate: roundMoney(sumToMonth(monthly, period.toDateMonth))
    };
  });

  const byCommercial = {};
  const byEntity = {};
  const monthlyTotals = emptyMonthlyArray();
  let totalYear = 0;
  let totalToDate = 0;

  for (const row of rows) {
    if (!byCommercial[row.commercialUserId]) byCommercial[row.commercialUserId] = emptyBudgetCommercial();
    byCommercial[row.commercialUserId].year += row.total;
    byCommercial[row.commercialUserId].toDate += row.toDate;
    byCommercial[row.commercialUserId].lines += 1;
    if (!byEntity[row.entiteId]) {
      byEntity[row.entiteId] = {
        id: row.entiteId,
        key: row.entiteKey,
        libelle: row.entiteLibelle,
        total: 0,
        toDate: 0,
        lignes: 0,
        monthly: emptyMonthlyArray()
      };
    }
    byEntity[row.entiteId].total += row.total;
    byEntity[row.entiteId].toDate += row.toDate;
    byEntity[row.entiteId].lignes += 1;
    row.monthly.forEach((value, index) => {
      monthlyTotals[index] += value;
      byEntity[row.entiteId].monthly[index] += value;
    });
    totalYear += row.total;
    totalToDate += row.toDate;
  }

  normalizeBudgetCommercials(byCommercial);
  const entitiesRows = Object.values(byEntity).map((entity) => ({
    ...entity,
    total: roundMoney(entity.total),
    toDate: roundMoney(entity.toDate),
    monthly: entity.monthly.map(roundMoney)
  })).sort((a, b) => b.total - a.total);

  return {
    totals: {
      year: roundMoney(totalYear),
      toDate: roundMoney(totalToDate),
      monthly: monthlyTotals.map(roundMoney)
    },
    byCommercial,
    entities: entitiesRows,
    rows: rows.slice(0, 1500)
  };
}

async function buildRealBlock(commercialIds, period) {
  if (!commercialIds.length) return emptyRealBlock();
  const rows = await fetchByCommercialChunks("v_reel_lignes_actives", "id,commercial_user_id,commercial_identifier,commercial_name,entite_id,entite_key,entite_libelle,annee,mois,client_code,client_nom,montant,quantite,reference,designation,date_piece", commercialIds, {
    annee: `eq.${period.year}`,
    order: "mois.asc,client_nom.asc"
  });

  const byCommercial = {};
  const byEntity = {};
  const monthlyTotals = emptyMonthlyArray();
  const monthlyRows = [];
  let totalYear = 0;
  let totalToDate = 0;

  for (const row of rows) {
    const amount = toNumber(row.montant);
    const monthIndex = clampNumber(row.mois, 1, 12, 1) - 1;
    const commercialId = row.commercial_user_id || "";
    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyRealCommercial();
    byCommercial[commercialId].year += amount;
    byCommercial[commercialId].monthly[monthIndex] += amount;
    byCommercial[commercialId].lines += 1;
    if (monthIndex + 1 <= period.toDateMonth) byCommercial[commercialId].toDate += amount;

    const entityId = row.entite_id || row.entite_key || "sans-entite";
    if (!byEntity[entityId]) {
      byEntity[entityId] = {
        id: entityId,
        key: row.entite_key || "",
        libelle: row.entite_libelle || "Entite",
        total: 0,
        toDate: 0,
        lignes: 0,
        monthly: emptyMonthlyArray()
      };
    }
    byEntity[entityId].total += amount;
    byEntity[entityId].monthly[monthIndex] += amount;
    byEntity[entityId].lignes += 1;
    if (monthIndex + 1 <= period.toDateMonth) byEntity[entityId].toDate += amount;

    monthlyTotals[monthIndex] += amount;
    totalYear += amount;
    if (monthIndex + 1 <= period.toDateMonth) totalToDate += amount;
    if (monthIndex + 1 === period.month) monthlyRows.push(normalizeRealRow(row));
  }

  Object.keys(byCommercial).forEach((id) => {
    byCommercial[id].year = roundMoney(byCommercial[id].year);
    byCommercial[id].toDate = roundMoney(byCommercial[id].toDate);
    byCommercial[id].monthly = byCommercial[id].monthly.map(roundMoney);
  });

  const entitiesRows = Object.values(byEntity).map((entity) => ({
    ...entity,
    total: roundMoney(entity.total),
    toDate: roundMoney(entity.toDate),
    monthly: entity.monthly.map(roundMoney)
  })).sort((a, b) => b.total - a.total);

  return {
    totals: {
      year: roundMoney(totalYear),
      toDate: roundMoney(totalToDate),
      monthly: monthlyTotals.map(roundMoney)
    },
    byCommercial,
    entities: entitiesRows,
    monthlyRows: monthlyRows.slice(0, 1200),
    rows: rows.map(normalizeRealRow).slice(0, 1500)
  };
}

async function buildDocumentsBlock(commercialIds, period) {
  if (!commercialIds.length) return emptyDocumentsBlock();
  const rows = await fetchByCommercialChunks("documents_commerciaux", "id,commercial_user_id,secteur,type_document,client_nom,numero_compte,numero_compte_libelle,date_document,nom_fichier,montant_ht,statut_validation,valide,type_visite,nb_lignes,created_at", commercialIds, {
    date_document: `gte.${period.year}-01-01`,
    date_document_lte: `lte.${period.year}-12-31`,
    order: "date_document.desc,created_at.desc"
  }, { date_document_lte: "date_document" });

  const byCommercial = {};
  const recent = [];
  const totals = {
    total: 0,
    enCours: 0,
    valide: 0,
    nonValide: 0,
    bdcEnCours: 0,
    devisEnCours: 0,
    montantEnCours: 0
  };

  for (const row of rows) {
    const commercialId = row.commercial_user_id || "";
    const status = normalizeDocumentStatus(row);
    const type = normalizeText(row.type_document).toLowerCase();
    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyDocumentCommercial();
    byCommercial[commercialId].total += 1;
    byCommercial[commercialId][status] += 1;
    if (type === "bdc" && status === "enCours") byCommercial[commercialId].bdcEnCours += 1;
    if (type === "devis" && status === "enCours") byCommercial[commercialId].devisEnCours += 1;

    totals.total += 1;
    totals[status] += 1;
    if (type === "bdc" && status === "enCours") totals.bdcEnCours += 1;
    if (type === "devis" && status === "enCours") totals.devisEnCours += 1;
    if (status === "enCours") totals.montantEnCours += toNumber(row.montant_ht);
    recent.push(normalizeDocumentRow(row));
  }

  totals.montantEnCours = roundMoney(totals.montantEnCours);

  return {
    totals,
    byCommercial,
    recent: recent.slice(0, 80),
    rows: recent.slice(0, 1000)
  };
}

function enrichCommercial(commercial, blocks) {
  const sales = blocks.salesBlock.byCommercial[commercial.id] || emptySalesCommercialObject();
  const budget = blocks.budgetBlock.byCommercial[commercial.id] || emptyBudgetCommercialObject();
  const real = blocks.realBlock.byCommercial[commercial.id] || emptyRealCommercialObject();
  const docs = blocks.documentsBlock.byCommercial[commercial.id] || emptyDocumentCommercial();
  return {
    ...commercial,
    metrics: {
      caJour: roundMoney(sales.day),
      caMois: roundMoney(sales.month),
      caAnnee: roundMoney(sales.year),
      caAutoMois: roundMoney(sales.monthAuto),
      caIndustrieMois: roundMoney(sales.monthIndustrie),
      visitesMois: sales.visitsMonth || 0,
      commandesTelephoneMois: sales.phoneMonth || 0,
      terrainMois: sales.terrainMonth || 0,
      clientsMois: sales.clientsMonth || 0,
      budgetAnnuel: roundMoney(budget.year),
      budgetADate: roundMoney(budget.toDate),
      reelReportingAnnee: roundMoney(real.year),
      reelReportingADate: roundMoney(real.toDate),
      ecartADate: roundMoney(real.toDate - budget.toDate),
      tauxAtteinteADate: budget.toDate ? roundMoney((real.toDate / budget.toDate) * 100) : null,
      documentsEnCours: docs.enCours || 0,
      bdcEnCours: docs.bdcEnCours || 0,
      devisEnCours: docs.devisEnCours || 0,
      documentsTotal: docs.total || 0,
      status: "ready"
    }
  };
}

function buildDataScope(session, currentPortalUser, warnings) {
  if (session.role === "admin") {
    return {
      status: warnings.length ? "partial" : "ready",
      title: warnings.length ? "Vue admin partielle" : "Vue admin globale",
      message: warnings.length
        ? "Certaines briques n'ont pas pu charger, mais les donnees disponibles restent affichees."
        : "Tu vois tous les commerciaux actifs. Les donnees sont separees par commercial_user_id."
    };
  }
  return {
    status: warnings.length ? "partial" : "ready",
    title: warnings.length ? "Vue responsable partielle" : "Vue responsable active",
    message: currentPortalUser
      ? "Tu vois uniquement tes commerciaux principaux et tes acces exceptionnels. Vue en lecture seule."
      : "Compte responsable non retrouve dans portal_users : aucun perimetre ne sera affiche."
  };
}

function buildAlerts(commercials) {
  const alerts = [];
  const negative = commercials
    .filter((item) => Number(item.metrics.budgetADate || 0) > 0 && Number(item.metrics.ecartADate || 0) < 0)
    .sort((a, b) => Number(a.metrics.ecartADate || 0) - Number(b.metrics.ecartADate || 0))
    .slice(0, 5);
  negative.forEach((item) => alerts.push({
    type: "gap",
    level: "danger",
    title: `${item.displayName} sous budget a date`,
    message: `Ecart a date ${roundMoney(item.metrics.ecartADate)} EUR. A verifier avec le detail budget / reel.`
  }));

  const docs = commercials
    .filter((item) => Number(item.metrics.documentsEnCours || 0) > 0)
    .sort((a, b) => Number(b.metrics.documentsEnCours || 0) - Number(a.metrics.documentsEnCours || 0))
    .slice(0, 5);
  docs.forEach((item) => alerts.push({
    type: "document",
    level: "warning",
    title: `${item.displayName} a des documents en cours`,
    message: `${item.metrics.documentsEnCours} document(s) BDC/devis a suivre.`
  }));

  return alerts.slice(0, 8);
}

function buildAdminCommercialScope(activeUsers, relations, allUsers) {
  return activeUsers.filter((user) => user.role === "commercial").map((commercial) => {
    const commercialRelations = relations.filter((relation) => relation.commercial_user_id === commercial.id);
    const principal = commercialRelations.find((relation) => relation.relation_type === "principal");
    const representative = principal || commercialRelations[0] || null;
    return commercialSummary({
      commercial,
      relation: representative,
      responsables: commercialRelations.map((relation) => findUser(allUsers, relation.responsable_user_id)),
      scopeLabel: representative
        ? representative.relation_type === "principal"
          ? "Rattache principal"
          : "Acces exceptionnel"
        : "Sans responsable actif"
    });
  });
}

function buildResponsableCommercialScope(currentPortalUser, activeUsers, relations) {
  if (!currentPortalUser) return [];

  return relations
    .filter((relation) => relation.responsable_user_id === currentPortalUser.id)
    .map((relation) => {
      const commercial = activeUsers.find((user) => user.id === relation.commercial_user_id);
      if (!commercial || commercial.role !== "commercial") return null;
      return commercialSummary({
        commercial,
        relation,
        responsables: [userSummary(currentPortalUser)],
        scopeLabel:
          relation.relation_type === "principal"
            ? "Responsable principal"
            : "Acces exceptionnel"
      });
    })
    .filter(Boolean);
}

function commercialSummary({ commercial, relation, responsables, scopeLabel }) {
  return {
    id: commercial.id,
    identifier: commercial.identifier,
    displayName: commercial.display_name,
    role: commercial.role,
    roleLabel: ROLE_LABELS[commercial.role] || "Commercial",
    homePath: commercial.home_path || "/",
    active: Boolean(commercial.active),
    hidden: Boolean(commercial.hidden),
    lastLoginAt: commercial.last_login_at,
    relationId: relation?.id || "",
    relationType: relation?.relation_type || "none",
    relationLabel:
      relation?.relation_type === "principal"
        ? "Principal"
        : relation?.relation_type === "exceptionnel"
          ? "Exceptionnel"
          : "Non rattache",
    scopeLabel,
    relationNote: relation?.note || "",
    responsables: responsables.filter(Boolean),
    metrics: emptyMetrics()
  };
}

function userSummary(user) {
  if (!user) return null;
  return {
    id: user.id,
    identifier: user.identifier,
    displayName: user.display_name,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role
  };
}

function findUser(users, id) {
  return users.find((user) => user.id === id) || null;
}

function resolveCurrentPortalUser(session, users) {
  const dbUserId = normalizeText(session.dbUserId);
  if (dbUserId) {
    const byId = users.find((user) => user.id === dbUserId);
    if (byId) return byId;
  }

  const identifier = normalizeText(session.userId).toLowerCase();
  if (!identifier) return null;
  return users.find((user) => normalizeText(user.identifier).toLowerCase() === identifier) || null;
}

async function fetchByCommercialChunks(table, select, commercialIds, params = {}, aliases = {}) {
  const chunks = chunkArray(unique(commercialIds), 35);
  const results = [];
  for (const chunk of chunks) {
    const rows = await fetchPaged(table, select, {
      ...params,
      commercial_user_id: inFilter(chunk)
    }, aliases);
    results.push(...rows);
  }
  return results;
}

async function fetchByChunks(table, select, column, values, params = {}, aliases = {}) {
  const uniqueValues = unique(values).filter(Boolean);
  if (!uniqueValues.length) return [];
  const chunks = chunkArray(uniqueValues, 120);
  const results = [];
  for (const chunk of chunks) {
    const rows = await fetchPaged(table, select, {
      ...params,
      [column]: inFilter(chunk)
    }, aliases);
    results.push(...rows);
  }
  return results;
}

async function fetchPaged(table, select, params = {}, aliases = {}) {
  const rows = [];
  let offset = 0;
  while (true) {
    const path = buildRestPath(table, select, { ...params, limit: PAGE_SIZE, offset }, aliases);
    const page = await supabaseAdminFetch(path);
    const safePage = Array.isArray(page) ? page : [];
    rows.push(...safePage);
    if (safePage.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

function buildRestPath(table, select, params = {}, aliases = {}) {
  const search = new URLSearchParams();
  search.set("select", select);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.append(aliases[key] || key, String(value));
  });
  return `/rest/v1/${table}?${search.toString()}`;
}

function inFilter(values) {
  return `in.(${values.map((value) => String(value).trim()).filter(Boolean).join(",")})`;
}

function normalizeVisitType(visit) {
  if (typeof visit === "string") return normalizeText(visit).toLowerCase() || "vente";
  return normalizeText(visit?.type_visite).toLowerCase() || "vente";
}

function isPhoneOrderVisit(visit) {
  const type = normalizeVisitType(visit);
  const note = normalizeText(visit?.note).toUpperCase();
  return type === VISIT_TYPE_PHONE_ORDER || note.includes(PHONE_ORDER_NOTE_MARKER);
}

function normalizeDocumentStatus(row) {
  const status = normalizeText(row?.statut_validation).toLowerCase();
  if (status === "valide") return "valide";
  if (status === "non_valide") return "nonValide";
  if (row?.valide === true) return "valide";
  return "enCours";
}

function normalizeDocumentRow(row) {
  return {
    id: row.id,
    commercialUserId: row.commercial_user_id || "",
    secteur: row.secteur || "",
    typeDocument: row.type_document || "",
    clientNom: row.client_nom || "Client sans nom",
    numeroCompte: row.numero_compte || "",
    numeroCompteLibelle: row.numero_compte_libelle || "",
    dateDocument: row.date_document || "",
    nomFichier: row.nom_fichier || "",
    montantHt: roundMoney(toNumber(row.montant_ht)),
    statut: normalizeDocumentStatus(row),
    typeVisite: row.type_visite || "",
    nbLignes: Number(row.nb_lignes || 0),
    createdAt: row.created_at || ""
  };
}

function normalizeRealRow(row) {
  return {
    id: row.id,
    commercialUserId: row.commercial_user_id || "",
    entiteId: row.entite_id || "",
    entiteKey: row.entite_key || "",
    entiteLibelle: row.entite_libelle || "Entite",
    annee: Number(row.annee || 0),
    mois: Number(row.mois || 0),
    clientCode: row.client_code || "",
    clientNom: row.client_nom || "Client sans nom",
    montant: roundMoney(toNumber(row.montant)),
    quantite: toNumber(row.quantite),
    reference: row.reference || "",
    designation: row.designation || "",
    datePiece: row.date_piece || ""
  };
}

function monthlyFromRow(row) {
  return MONTH_KEYS.map((key) => roundMoney(toNumber(row[key])));
}

function sumToMonth(values, month) {
  return values.slice(0, month).reduce((sum, value) => sum + toNumber(value), 0);
}

function sameMonth(dateValue, year, month) {
  return String(dateValue || "").startsWith(`${year}-${String(month).padStart(2, "0")}`);
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.clientNom || "").localeCompare(String(b.clientNom || ""), "fr"));
}

function unique(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "")).filter(Boolean)));
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function toNumber(value) {
  const number = typeof value === "number" ? value : Number(String(value || "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function mapMoneyTotals(totals) {
  return {
    ...totals,
    day: roundMoney(totals.day),
    month: roundMoney(totals.month),
    year: roundMoney(totals.year),
    monthAuto: roundMoney(totals.monthAuto),
    monthIndustrie: roundMoney(totals.monthIndustrie)
  };
}

function isRecentLogin(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

function emptyMonthlyArray() {
  return Array.from({ length: 12 }, () => 0);
}

function emptyMetrics() {
  return {
    caJour: 0,
    caMois: 0,
    caAnnee: 0,
    caAutoMois: 0,
    caIndustrieMois: 0,
    visitesMois: 0,
    commandesTelephoneMois: 0,
    terrainMois: 0,
    clientsMois: 0,
    budgetAnnuel: 0,
    budgetADate: 0,
    reelReportingAnnee: 0,
    reelReportingADate: 0,
    ecartADate: 0,
    tauxAtteinteADate: null,
    documentsEnCours: 0,
    bdcEnCours: 0,
    devisEnCours: 0,
    documentsTotal: 0,
    status: "ready"
  };
}

function emptySalesCommercialObject() {
  return {
    day: 0,
    month: 0,
    year: 0,
    monthAuto: 0,
    monthIndustrie: 0,
    visitsMonth: 0,
    phoneMonth: 0,
    terrainMonth: 0,
    clientsMonth: 0
  };
}

function emptyBudgetCommercial() {
  return { year: 0, toDate: 0, lines: 0 };
}

function emptyBudgetCommercialObject() {
  return { year: 0, toDate: 0, lines: 0 };
}

function emptyRealCommercial() {
  return { year: 0, toDate: 0, lines: 0, monthly: emptyMonthlyArray() };
}

function emptyRealCommercialObject() {
  return { year: 0, toDate: 0, lines: 0, monthly: emptyMonthlyArray() };
}

function emptyDocumentCommercial() {
  return { total: 0, enCours: 0, valide: 0, nonValide: 0, bdcEnCours: 0, devisEnCours: 0 };
}

function normalizeBudgetCommercials(byCommercial) {
  Object.keys(byCommercial).forEach((id) => {
    byCommercial[id].year = roundMoney(byCommercial[id].year);
    byCommercial[id].toDate = roundMoney(byCommercial[id].toDate);
  });
}

function emptySalesBlock() {
  return {
    totals: { day: 0, month: 0, year: 0, monthAuto: 0, monthIndustrie: 0, visitsMonth: 0, phoneMonth: 0, clientsMonth: 0 },
    byCommercial: {},
    dailyRows: [],
    monthlyRows: [],
    yearlyRows: [],
    topClientsMonth: []
  };
}

function emptyBudgetBlock() {
  return {
    totals: { year: 0, toDate: 0, monthly: emptyMonthlyArray() },
    byCommercial: {},
    entities: [],
    rows: []
  };
}

function emptyRealBlock() {
  return {
    totals: { year: 0, toDate: 0, monthly: emptyMonthlyArray() },
    byCommercial: {},
    entities: [],
    monthlyRows: [],
    rows: []
  };
}

function emptyDocumentsBlock() {
  return {
    totals: { total: 0, enCours: 0, valide: 0, nonValide: 0, bdcEnCours: 0, devisEnCours: 0, montantEnCours: 0 },
    byCommercial: {},
    recent: [],
    rows: []
  };
}
