import {
  ROLE_LABELS,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const BASE_USER_SELECT = [
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

const USER_SELECT = `${BASE_USER_SELECT},sector_id`;

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

const SECTOR_SELECT = [
  "id",
  "name",
  "departments",
  "color",
  "description",
  "active",
  "hidden",
  "created_at",
  "updated_at"
].join(",");

const CAMPAIGN_SELECT = [
  "id",
  "commercial_user_id",
  "produit_recherche",
  "source_mode",
  "activity_scope",
  "plaque_filter_key",
  "plaque_filter_label",
  "period_value",
  "min_ca",
  "nb_clients",
  "total_ca_cible",
  "statut",
  "sent_at",
  "created_at",
  "updated_at"
].join(",");

const CAMPAIGN_CLIENT_SELECT = [
  "id",
  "campagne_id",
  "commercial_user_id",
  "client_id",
  "secteur",
  "client_nom",
  "numero_compte",
  "plaque_id",
  "plaque_nom",
  "email",
  "ca_cible",
  "quantite",
  "dernier_achat",
  "statut_email",
  "created_at"
].join(",");

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABELS = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];
const PAGE_SIZE = 1000;
const CHUNK_CONCURRENCY = 6;
const PARIS_TIMEZONE = "Europe/Paris";
const VISIT_TYPE_PHONE_ORDER = "commande_telephone";
const PHONE_ORDER_NOTE_MARKER = "[COMMANDE_TELEPHONE]";
const CLIENT_SIZE_DEFAULT = "S";
const CLIENT_SIZE_KEYS = ["S", "M", "L"];

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

const DASHBOARD_FAST_VIEWS = {
  salesDaily: "v_kent_dashboard_sales_daily",
  salesLines: "v_kent_dashboard_sales_lines",
  visitsMonthly: "v_kent_dashboard_visits_monthly",
  clientsTotal: "v_kent_dashboard_clients_total",
  budgetSummary: "v_kent_dashboard_budget_summary",
  realSummary: "v_kent_dashboard_real_summary"
};

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
  const mode = parseDashboardMode(request);
  const options = parseDashboardOptions(request, mode);
  const [usersResult, relations, sectorsResult] = await Promise.all([listUsers(), listRelations(), listSectors()]);
  const users = usersResult.rows;
  const sectors = sectorsResult.rows;
  const sectorMap = new Map(sectors.map((sector) => [String(sector.id), sector]));
  const activeUsers = users.filter((user) => user.active && !user.hidden);
  const activeRelations = relations.filter((relation) => relation.active);
  const currentPortalUser = resolveCurrentPortalUser(session, users);
  const sectorsReady = Boolean(usersResult.sectorsReady && sectorsResult.ready);
  const sectorsWarning = sectorsReady ? "" : usersResult.warning || sectorsResult.warning || "Secteurs commerciaux non initialises.";
  const warnings = sectorsWarning ? [{ label: "secteurs commerciaux", message: sectorsWarning }] : [];

  const visibleCommercials =
    session.role === "admin"
      ? buildAdminCommercialScope(activeUsers, activeRelations, users, sectorMap)
      : buildResponsableCommercialScope(currentPortalUser, activeUsers, activeRelations, sectorMap);

  const commercialIds = visibleCommercials.map((item) => item.id).filter(Boolean);
  const includeMainData = mode !== "campaigns";
  const includeDocuments = mode !== "finance" && mode !== "campaigns";
  const includeCampaigns = mode === "full" || mode === "campaigns";

  const [salesBlock, budgetBlock, realBlock, documentsBlock, campaignsBlock, qualityBlock] = await Promise.all([
    includeMainData
      ? safeBlock(() => buildSalesBlock(commercialIds, period, options), emptySalesBlock(), warnings, "ventes terrain")
      : Promise.resolve(emptySalesBlock()),
    includeMainData
      ? safeBlock(() => buildBudgetBlock(commercialIds, period, options), emptyBudgetBlock(), warnings, "budgets")
      : Promise.resolve(emptyBudgetBlock()),
    includeMainData
      ? safeBlock(() => buildRealBlock(commercialIds, period, options), emptyRealBlock(), warnings, "reel importe")
      : Promise.resolve(emptyRealBlock()),
    includeDocuments
      ? safeBlock(() => buildDocumentsBlock(commercialIds, period, options), emptyDocumentsBlock(), warnings, "BDC / devis")
      : Promise.resolve(emptyDocumentsBlock()),
    includeCampaigns
      ? safeBlock(() => buildCampaignsBlock(commercialIds, period), emptyCampaignsBlock(), warnings, "campagnes promo")
      : Promise.resolve(emptyCampaignsBlock()),
    includeMainData
      ? safeBlock(() => buildQualityBlock(commercialIds, period), emptyQualityBlock(), warnings, "taille clients / demos")
      : Promise.resolve(emptyQualityBlock())
  ]);

  const enrichedCommercials = visibleCommercials.map((commercial) => enrichCommercial(commercial, {
    salesBlock,
    budgetBlock,
    realBlock,
    documentsBlock,
    campaignsBlock,
    qualityBlock
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
    mode,
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
      campagnesPromo: campaignsBlock.totals.total,
      clientsCampagnesPromo: campaignsBlock.totals.clients,
      caCibleCampagnesPromo: campaignsBlock.totals.caCible,
      visitesMois: salesBlock.totals.visitsMonth,
      commandesTelephoneMois: salesBlock.totals.phoneMonth,
      clientsMois: salesBlock.totals.clientsMonth,
      clientsS: qualityBlock.totals.clientsTotalBySize.S,
      clientsM: qualityBlock.totals.clientsTotalBySize.M,
      clientsL: qualityBlock.totals.clientsTotalBySize.L,
      clientsVisitesS: qualityBlock.totals.clientsVisitedBySizeMonth.S,
      clientsVisitesM: qualityBlock.totals.clientsVisitedBySizeMonth.M,
      clientsVisitesL: qualityBlock.totals.clientsVisitedBySizeMonth.L,
      caMoisS: qualityBlock.totals.caMonthBySize.S,
      caMoisM: qualityBlock.totals.caMonthBySize.M,
      caMoisL: qualityBlock.totals.caMonthBySize.L,
      demosMois: qualityBlock.totals.demosMonth,
      visitesAvecDemoMois: qualityBlock.totals.visitsWithDemoMonth
    },
    dataScope: buildDataScope(session, currentPortalUser, warnings),
    team: {
      topCommercials,
      alerts: buildAlerts(enrichedCommercials)
    },
    commercials: enrichedCommercials,
    sectorsReady,
    sectorsWarning,
    sectors: sectors.map(safeSector),
    sales: salesBlock,
    budgets: budgetBlock,
    real: realBlock,
    documents: documentsBlock,
    campaigns: campaignsBlock,
    quality: qualityBlock,
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
  const week = getWeekBounds(day);
  return {
    year,
    month,
    day,
    weekStart: week.start,
    weekEnd: week.end,
    monthKey: MONTH_KEYS[month - 1],
    monthLabel: MONTH_LABELS[month - 1],
    toDateMonth: month,
    generatedAt: new Date().toISOString()
  };
}

function parseDashboardMode(request) {
  const url = new URL(request.url, "http://localhost");
  const mode = normalizeText(url.searchParams.get("mode")).toLowerCase();
  if (mode === "finance") return "finance";
  if (mode === "control") return "control";
  if (mode === "campaigns") return "campaigns";
  return "full";
}

function parseDashboardOptions(request, mode) {
  const url = new URL(request.url, "http://localhost");
  const detailParam = normalizeText(url.searchParams.get("detail")).toLowerCase();
  const compactRequested = ["0", "false", "compact", "summary"].includes(detailParam);
  const compact = mode === "finance" || compactRequested;
  return {
    compact,
    includeSalesDetails: !compact,
    includeBudgetRows: !compact,
    includeDocumentRows: !compact
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

function getWeekBounds(isoDate) {
  const date = parseIsoDateUtc(isoDate);
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: toIsoDateUtc(monday),
    end: toIsoDateUtc(sunday)
  };
}

function parseIsoDateUtc(isoDate) {
  const [year, month, day] = String(isoDate || "").split("-").map(Number);
  return new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
}

function toIsoDateUtc(date) {
  return date.toISOString().slice(0, 10);
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
  try {
    const rows = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&order=display_name.asc`
    );
    return { rows: Array.isArray(rows) ? rows : [], sectorsReady: true, warning: "" };
  } catch (error) {
    if (!isMissingSectorSchemaError(error)) throw error;
    const rows = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(BASE_USER_SELECT)}&order=display_name.asc`
    );
    return {
      rows: (Array.isArray(rows) ? rows : []).map((user) => ({ ...user, sector_id: null })),
      sectorsReady: false,
      warning: "Colonne portal_users.sector_id absente : lance le SQL des secteurs commerciaux."
    };
  }
}

async function listRelations() {
  return supabaseAdminFetch(
    `/rest/v1/portal_user_relations?select=${encodeURIComponent(RELATION_SELECT)}&order=created_at.asc`
  );
}

async function listSectors() {
  try {
    const rows = await supabaseAdminFetch(
      `/rest/v1/portal_commercial_sectors?select=${encodeURIComponent(SECTOR_SELECT)}&order=active.desc,name.asc`
    );
    return { rows: Array.isArray(rows) ? rows : [], ready: true, warning: "" };
  } catch (error) {
    if (!isMissingSectorSchemaError(error)) throw error;
    return {
      rows: [],
      ready: false,
      warning: "Table portal_commercial_sectors absente : lance le SQL des secteurs commerciaux."
    };
  }
}

async function buildSalesBlock(commercialIds, period, options = {}) {
  if (!commercialIds.length) return emptySalesBlock();
  try {
    return await buildSalesBlockFast(commercialIds, period, options);
  } catch (error) {
    if (!isMissingDashboardFastViewError(error)) throw error;
    return buildSalesBlockLegacy(commercialIds, period, options);
  }
}

async function buildSalesBlockFast(commercialIds, period, options = {}) {
  const monthStart = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const monthEnd = `${period.year}-${String(period.month).padStart(2, "0")}-${String(daysInMonth(period.year, period.month)).padStart(2, "0")}`;
  const detailStart = minIsoDate(monthStart, period.weekStart);
  const detailEnd = maxIsoDate(monthEnd, period.weekEnd);
  const detailSelect = [
    "id",
    "visit_id",
    "source",
    "secteur",
    "secteur_label",
    "commercial_user_id",
    "client_id",
    "client_nom",
    "numero_compte",
    "date",
    "type_visite",
    "note",
    "reference",
    "designation",
    "quantite",
    "prix_unitaire",
    "montant"
  ].join(",");

  const [dailyRows, visitsMonthlyRows, clientsTotalRows, detailRows] = await Promise.all([
    fetchByCommercialChunks(DASHBOARD_FAST_VIEWS.salesDaily, "commercial_user_id,secteur,date,annee,mois,montant,lignes,ventes", commercialIds, {
      annee: `eq.${period.year}`,
      order: "date.asc"
    }),
    fetchByCommercialChunks(DASHBOARD_FAST_VIEWS.visitsMonthly, "commercial_user_id,secteur,annee,mois,visites_total,visites_terrain,commandes_telephone,clients_terrain", commercialIds, {
      annee: `eq.${period.year}`,
      mois: `eq.${period.month}`
    }),
    fetchByCommercialChunks(DASHBOARD_FAST_VIEWS.clientsTotal, "commercial_user_id,secteur,clients_total", commercialIds),
    options.includeSalesDetails
      ? fetchByCommercialChunks(DASHBOARD_FAST_VIEWS.salesLines, detailSelect, commercialIds, {
          date: `gte.${detailStart}`,
          date_lte: `lte.${detailEnd}`,
          order: "date.desc,client_nom.asc"
        }, { date_lte: "date" })
      : Promise.resolve([])
  ]);

  return summarizeSalesFastRows(dailyRows, visitsMonthlyRows, clientsTotalRows, detailRows, period, options);
}

async function buildSalesBlockLegacy(commercialIds, period, options = {}) {
  if (!commercialIds.length) return emptySalesBlock();
  const sourceResults = await Promise.all(
    SALES_SOURCES.map((source) => loadSalesSource(source, commercialIds, period, options))
  );
  const rows = sourceResults.flatMap((item) => item.rows);
  const visits = sourceResults.flatMap((item) => item.visits);
  const clients = sourceResults.flatMap((item) => item.clients || []);
  return summarizeSalesRows(rows, visits, period, clients, options);
}

async function loadSalesSource(source, commercialIds, period, options = {}) {
  const allowedCommercialIds = new Set((commercialIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const visitSelect = "id,client_id,date_visite,note,type_visite,total_commande,commercial_user_id";
  const clientSelect = "id,nom,numero_compte,plaque_id,commercial_user_id";
  const visitYearParams = {
    date_visite: `gte.${period.year}-01-01`,
    date_visite_lte: `lte.${period.year}-12-31`,
    order: "date_visite.desc,id.asc"
  };

  const [ownedClients, visitsByCommercial] = await Promise.all([
    fetchByCommercialChunks(source.clients, clientSelect, commercialIds, {
      order: "nom.asc"
    }),
    fetchByCommercialChunks(source.visites, visitSelect, commercialIds, visitYearParams, { date_visite_lte: "date_visite" })
  ]);
  const ownedClientIds = unique(ownedClients.map((client) => client.id).filter(Boolean));
  const visitsByClient = ownedClientIds.length
    ? await fetchByChunks(source.visites, visitSelect, "client_id", ownedClientIds, {
        ...visitYearParams,
        commercial_user_id: "is.null"
      }, { date_visite_lte: "date_visite" })
    : [];
  const visits = mergeRowsById([...visitsByCommercial, ...visitsByClient]);
  const scopedClients = ownedClients.map((client) => ({
    id: client.id,
    secteur: source.secteur,
    commercialUserId: normalizeText(client.commercial_user_id),
    nom: client.nom || "",
    numeroCompte: client.numero_compte || ""
  })).filter((client) => allowedCommercialIds.has(client.commercialUserId));

  if (!visits.length) return { rows: [], visits: [], clients: scopedClients };

  const clientIds = unique([
    ...ownedClientIds,
    ...visits.map((visit) => visit.client_id).filter(Boolean)
  ]);
  const clients = await fetchByChunks(source.clients, clientSelect, "id", clientIds);
  const clientById = new Map([...ownedClients, ...clients].map((client) => [String(client.id), client]));

  const enrichedVisits = visits.map((visit) => {
    const client = clientById.get(String(visit.client_id));
    const ownerId = resolveSaleOwnerId(visit, client);
    return {
      id: visit.id,
      secteur: source.secteur,
      secteurLabel: source.label,
      commercialUserId: ownerId,
      clientId: visit.client_id || "",
      clientNom: client?.nom || "Client sans nom",
      numeroCompte: client?.numero_compte || "",
      date: normalizeText(visit.date_visite),
      typeVisite: normalizeVisitType(visit),
      isPhoneOrder: isPhoneOrderVisit(visit),
      totalCommande: toNumber(visit.total_commande)
    };
  }).filter((visit) => allowedCommercialIds.has(visit.commercialUserId));
  if (!enrichedVisits.length) return { rows: [], visits: [], clients: scopedClients };

  const visitById = new Map(enrichedVisits.map((visit) => [String(visit.id), visit]));
  const visitIds = enrichedVisits.map((visit) => visit.id).filter(Boolean);
  const lineSelect = options.includeSalesDetails
    ? "id,visite_id,produit_id,quantite,stock_client,couleur,prix_unitaire"
    : "id,visite_id,produit_id,quantite,prix_unitaire";
  const lines = await fetchByChunks(source.lignes, lineSelect, "visite_id", visitIds, { order: "visite_id.asc,id.asc" });

  const rowShells = lines.map((line) => {
    const visit = visitById.get(String(line.visite_id));
    if (!visit) return null;
    const quantity = toNumber(line.quantite);
    const unitPrice = toNumber(line.prix_unitaire);
    return {
      id: line.id,
      visitId: line.visite_id || "",
      productId: line.produit_id || "",
      source: source.secteur,
      secteur: source.secteur,
      secteurLabel: source.label,
      commercialUserId: visit.commercialUserId || "",
      clientId: visit.clientId || "",
      clientNom: visit.clientNom || "Client sans nom",
      numeroCompte: visit.numeroCompte || "",
      date: normalizeText(visit.date),
      typeVisite: visit.typeVisite,
      typeLabel: visit.isPhoneOrder ? "Commande telephone" : "Visite terrain",
      isPhoneOrder: visit.isPhoneOrder,
      quantite: quantity,
      prixUnitaire: unitPrice,
      montant: roundMoney(quantity * unitPrice)
    };
  }).filter((row) => row?.commercialUserId);

  const detailProductIds = options.includeSalesDetails ? unique(rowShells
    .filter((row) => sameMonth(row.date, period.year, period.month) || row.date === period.day || (row.date >= period.weekStart && row.date <= period.weekEnd))
    .map((row) => row.productId)
    .filter(Boolean)) : [];
  const products = await fetchByChunks(source.produits, "id,nom,reference_produit,prix_vente", "id", detailProductIds);
  const productById = new Map(products.map((product) => [String(product.id), product]));

  const rows = rowShells.map((row) => {
    const product = productById.get(String(row.productId));
    return {
      ...row,
      reference: product?.reference_produit || "",
      designation: product?.nom || "Produit sans designation",
      productId: undefined
    };
  });

  return { rows, visits: enrichedVisits, clients: scopedClients };
}

async function buildQualityBlock(commercialIds, period) {
  if (!commercialIds.length) return emptyQualityBlock();
  const sourceBlocks = await Promise.all(
    SALES_SOURCES.map((source) => buildQualitySourceBlock(source, commercialIds, period))
  );

  const totals = emptyQualityTotals();
  const byCommercial = {};

  sourceBlocks.forEach((block) => {
    CLIENT_SIZE_KEYS.forEach((size) => {
      totals.clientsTotalBySize[size] += block.totals.clientsTotalBySize[size] || 0;
      totals.clientsVisitedBySizeMonth[size] += block.totals.clientsVisitedBySizeMonth[size] || 0;
      totals.caMonthBySize[size] += toNumber(block.totals.caMonthBySize[size]);
    });
    totals.demosMonth += Number(block.totals.demosMonth || 0);
    totals.visitsWithDemoMonth += Number(block.totals.visitsWithDemoMonth || 0);

    Object.entries(block.byCommercial || {}).forEach(([commercialId, metrics]) => {
      if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyQualityCommercialObject();
      CLIENT_SIZE_KEYS.forEach((size) => {
        byCommercial[commercialId].clientsTotalBySize[size] += metrics.clientsTotalBySize[size] || 0;
        byCommercial[commercialId].clientsVisitedBySizeMonth[size] += metrics.clientsVisitedBySizeMonth[size] || 0;
        byCommercial[commercialId].caMonthBySize[size] += toNumber(metrics.caMonthBySize[size]);
      });
      byCommercial[commercialId].demosMonth += Number(metrics.demosMonth || 0);
      byCommercial[commercialId].visitsWithDemoMonth += Number(metrics.visitsWithDemoMonth || 0);
    });
  });

  CLIENT_SIZE_KEYS.forEach((size) => {
    totals.caMonthBySize[size] = roundMoney(totals.caMonthBySize[size]);
    Object.keys(byCommercial).forEach((commercialId) => {
      byCommercial[commercialId].caMonthBySize[size] = roundMoney(byCommercial[commercialId].caMonthBySize[size]);
    });
  });

  return { totals: finalizeQualityTotals(totals), byCommercial };
}

async function buildQualitySourceBlock(source, commercialIds, period) {
  const allowedCommercialIds = new Set((commercialIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const totals = emptyQualityTotals();
  const byCommercial = new Map();
  const monthStart = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const monthEnd = `${period.year}-${String(period.month).padStart(2, "0")}-${String(daysInMonth(period.year, period.month)).padStart(2, "0")}`;

  const ownedClients = await fetchClientsByCommercialWithOptionalSize(source, commercialIds, { order: "nom.asc" });
  const ownedClientIds = unique(ownedClients.map((client) => client.id).filter(Boolean));
  const clientById = new Map(ownedClients.map((client) => [String(client.id), client]));

  ownedClients.forEach((client) => {
    const commercialId = normalizeText(client.commercial_user_id);
    if (!commercialId || !allowedCommercialIds.has(commercialId)) return;
    const quality = ensureQualityCommercial(byCommercial, commercialId);
    const size = normalizeClientSize(client.taille_client);
    quality.clientsTotalBySize[size] += 1;
    totals.clientsTotalBySize[size] += 1;
  });

  const visitSelect = "id,client_id,date_visite,note,type_visite,total_commande,commercial_user_id";
  const visitMonthParams = {
    date_visite: `gte.${monthStart}`,
    date_visite_lte: `lte.${monthEnd}`,
    order: "date_visite.desc,id.asc"
  };
  const [visitsByCommercial, visitsByClient] = await Promise.all([
    fetchByCommercialChunks(source.visites, visitSelect, commercialIds, visitMonthParams, { date_visite_lte: "date_visite" }),
    ownedClientIds.length
      ? fetchByChunks(source.visites, visitSelect, "client_id", ownedClientIds, {
          ...visitMonthParams,
          commercial_user_id: "is.null"
        }, { date_visite_lte: "date_visite" })
      : Promise.resolve([])
  ]);
  const visits = mergeRowsById([...visitsByCommercial, ...visitsByClient]);
  if (!visits.length) {
    return { totals: finalizeQualityTotals(totals), byCommercial: qualityMapToObject(byCommercial) };
  }

  const missingClientIds = unique(visits.map((visit) => visit.client_id).filter((id) => id && !clientById.has(String(id))));
  if (missingClientIds.length) {
    const visitedClients = await fetchClientsByIdsWithOptionalSize(source, missingClientIds);
    visitedClients.forEach((client) => clientById.set(String(client.id), client));
  }

  const scopedVisits = [];
  visits.forEach((visit) => {
    const client = clientById.get(String(visit.client_id));
    const ownerId = resolveSaleOwnerId(visit, client);
    if (!ownerId || !allowedCommercialIds.has(ownerId)) return;
    const quality = ensureQualityCommercial(byCommercial, ownerId);
    const size = normalizeClientSize(client?.taille_client);
    const visitKey = `${source.secteur}:${visit.id}`;
    const clientKey = `${source.secteur}:${visit.client_id || client?.numero_compte || client?.nom || visit.id}`;
    if (!isPhoneOrderVisit(visit)) {
      quality.clientsVisitedBySizeMonthSets[size].add(clientKey);
      totals.clientsVisitedBySizeMonthSets[size].add(`${ownerId}:${clientKey}`);
    }
    scopedVisits.push({
      id: visit.id,
      ownerId,
      size,
      key: visitKey
    });
  });

  const visitById = new Map(scopedVisits.map((visit) => [String(visit.id), visit]));
  const lines = await fetchLinesByVisitsWithOptionalDemo(source, scopedVisits.map((visit) => visit.id).filter(Boolean));
  lines.forEach((line) => {
    const visit = visitById.get(String(line.visite_id));
    if (!visit) return;
    const quality = ensureQualityCommercial(byCommercial, visit.ownerId);
    const amount = roundMoney(toNumber(line.quantite) * toNumber(line.prix_unitaire));
    quality.caMonthBySize[visit.size] += amount;
    totals.caMonthBySize[visit.size] += amount;
    if (isTruthyFlag(line.demo_effectuee)) {
      quality.demosMonth += 1;
      totals.demosMonth += 1;
      quality.visitsWithDemoMonthSet.add(visit.key);
      totals.visitsWithDemoMonthSet.add(`${visit.ownerId}:${visit.key}`);
    }
  });

  return { totals: finalizeQualityTotals(totals), byCommercial: qualityMapToObject(byCommercial) };
}

async function fetchClientsByCommercialWithOptionalSize(source, commercialIds, params = {}) {
  try {
    return await fetchByCommercialChunks(source.clients, "id,nom,numero_compte,commercial_user_id,taille_client", commercialIds, params);
  } catch (error) {
    if (!isMissingColumnError(error, "taille_client")) throw error;
    const rows = await fetchByCommercialChunks(source.clients, "id,nom,numero_compte,commercial_user_id", commercialIds, params);
    return rows.map((row) => ({ ...row, taille_client: CLIENT_SIZE_DEFAULT }));
  }
}

async function fetchClientsByIdsWithOptionalSize(source, clientIds) {
  try {
    return await fetchByChunks(source.clients, "id,nom,numero_compte,commercial_user_id,taille_client", "id", clientIds);
  } catch (error) {
    if (!isMissingColumnError(error, "taille_client")) throw error;
    const rows = await fetchByChunks(source.clients, "id,nom,numero_compte,commercial_user_id", "id", clientIds);
    return rows.map((row) => ({ ...row, taille_client: CLIENT_SIZE_DEFAULT }));
  }
}

async function fetchLinesByVisitsWithOptionalDemo(source, visitIds) {
  try {
    return await fetchByChunks(source.lignes, "id,visite_id,quantite,prix_unitaire,demo_effectuee", "visite_id", visitIds, { order: "visite_id.asc,id.asc" });
  } catch (error) {
    if (!isMissingColumnError(error, "demo_effectuee")) throw error;
    const rows = await fetchByChunks(source.lignes, "id,visite_id,quantite,prix_unitaire", "visite_id", visitIds, { order: "visite_id.asc,id.asc" });
    return rows.map((row) => ({ ...row, demo_effectuee: false }));
  }
}

function summarizeSalesFastRows(dailyRows, visitsMonthlyRows, clientsTotalRows, detailRows, period, options = {}) {
  const byCommercial = new Map();
  const totals = {
    day: 0,
    week: 0,
    month: 0,
    year: 0,
    monthly: emptyMonthlyArray(),
    monthAuto: 0,
    monthIndustrie: 0,
    visitsMonth: 0,
    phoneMonth: 0,
    clientsMonth: 0,
    clientsTotal: 0,
    ventesAnnee: 0,
    lignesAnnee: 0
  };

  for (const row of dailyRows || []) {
    const commercialId = normalizeText(row.commercial_user_id);
    if (!commercialId) continue;
    const commercial = ensureSalesCommercial(byCommercial, commercialId);
    const amount = toNumber(row.montant);
    const lines = Number(row.lignes || 0);
    const sales = Number(row.ventes || 0);
    const monthIndex = clampNumber(row.mois, 1, 12, 1) - 1;
    const date = normalizeText(row.date);
    const secteur = normalizeText(row.secteur);

    commercial.year += amount;
    commercial.linesYear += lines;
    commercial.salesYearDirect += sales;
    totals.year += amount;
    totals.lignesAnnee += lines;
    totals.ventesAnnee += sales;

    if (monthIndex >= 0) {
      commercial.monthly[monthIndex] += amount;
      totals.monthly[monthIndex] += amount;
    }

    if (date >= period.weekStart && date <= period.weekEnd) {
      commercial.week += amount;
      totals.week += amount;
    }

    if (sameMonth(date, period.year, period.month)) {
      commercial.month += amount;
      totals.month += amount;
      if (secteur === "industrie") {
        commercial.monthIndustrie += amount;
        totals.monthIndustrie += amount;
      } else {
        commercial.monthAuto += amount;
        totals.monthAuto += amount;
      }
    }

    if (date === period.day) {
      commercial.day += amount;
      totals.day += amount;
    }
  }

  for (const row of visitsMonthlyRows || []) {
    const commercialId = normalizeText(row.commercial_user_id);
    if (!commercialId) continue;
    const commercial = ensureSalesCommercial(byCommercial, commercialId);
    const terrain = Number(row.visites_terrain || 0);
    const phone = Number(row.commandes_telephone || 0);
    const clients = Number(row.clients_terrain || 0);
    commercial.visitsMonth += terrain;
    commercial.terrainMonth += terrain;
    commercial.phoneMonth += phone;
    commercial.clientsMonthDirect += clients;
    totals.visitsMonth += terrain;
    totals.phoneMonth += phone;
    totals.clientsMonth += clients;
  }

  for (const row of clientsTotalRows || []) {
    const commercialId = normalizeText(row.commercial_user_id);
    if (!commercialId) continue;
    const commercial = ensureSalesCommercial(byCommercial, commercialId);
    const count = Number(row.clients_total || 0);
    commercial.clientsTotalDirect += count;
    totals.clientsTotal += count;
  }

  const normalizedDetails = options.includeSalesDetails
    ? (detailRows || []).map(normalizeFastSalesDetailRow)
    : [];
  const dailyDetails = normalizedDetails.filter((row) => row.date === period.day);
  const weeklyDetails = normalizedDetails.filter((row) => row.date >= period.weekStart && row.date <= period.weekEnd);
  const monthlyDetails = normalizedDetails.filter((row) => sameMonth(row.date, period.year, period.month));
  const topClientsMonth = buildTopClientsFromSalesRows(monthlyDetails);

  const byCommercialObject = Object.fromEntries(
    Array.from(byCommercial.entries()).map(([id, value]) => [id, salesCommercialToObject(value)])
  );

  return {
    totals: mapMoneyTotals({
      ...totals,
      monthly: totals.monthly.map(roundMoney)
    }),
    byCommercial: byCommercialObject,
    dailyRows: sortRows(dailyDetails).slice(0, 2500),
    weeklyRows: sortRows(weeklyDetails).slice(0, 2500),
    monthlyRows: sortRows(monthlyDetails).slice(0, 1200),
    yearlyRows: [],
    topClientsMonth
  };
}

function normalizeFastSalesDetailRow(row) {
  const quantity = toNumber(row.quantite);
  const unitPrice = toNumber(row.prix_unitaire);
  const isPhoneOrder = isPhoneOrderVisit({ type_visite: row.type_visite, note: row.note });
  return {
    id: row.id,
    visitId: row.visit_id || "",
    source: row.source || row.secteur || "",
    secteur: row.secteur || "",
    secteurLabel: row.secteur_label || (row.secteur === "industrie" ? "Industrie" : "Automobile"),
    commercialUserId: row.commercial_user_id || "",
    clientId: row.client_id || "",
    clientNom: row.client_nom || "Client sans nom",
    numeroCompte: row.numero_compte || "",
    date: normalizeText(row.date),
    typeVisite: normalizeVisitType(row.type_visite),
    typeLabel: isPhoneOrder ? "Commande telephone" : "Visite terrain",
    isPhoneOrder,
    reference: row.reference || "",
    designation: row.designation || "Produit sans designation",
    quantite: quantity,
    prixUnitaire: unitPrice,
    montant: roundMoney(row.montant ?? quantity * unitPrice)
  };
}

function resolveSaleOwnerId(visit, client) {
  return normalizeText(visit?.commercial_user_id) || normalizeText(client?.commercial_user_id);
}

function summarizeSalesRows(rows, visits, period, clients = [], options = {}) {
  const byCommercial = new Map();
  const topClientsMonth = new Map();
  const clientKeysTotal = new Set();
  const saleKeysYear = new Set();
  let totals = {
    day: 0,
    week: 0,
    month: 0,
    year: 0,
    monthly: emptyMonthlyArray(),
    monthAuto: 0,
    monthIndustrie: 0,
    visitsMonth: 0,
    phoneMonth: 0,
    clientsMonth: 0,
    clientsTotal: 0,
    ventesAnnee: 0,
    lignesAnnee: 0
  };

  const dayRows = [];
  const weekRows = [];
  const monthRows = [];
  const yearRows = [];

  for (const client of clients) {
    if (!client.commercialUserId) continue;
    const commercial = ensureSalesCommercial(byCommercial, client.commercialUserId);
    const key = `${client.secteur}:${client.id || client.numeroCompte || client.nom}`;
    commercial.clientsTotalSet.add(key);
    clientKeysTotal.add(key);
  }

  for (const row of rows) {
    const monthIndex = getIsoMonthIndex(row.date);
    const commercial = ensureSalesCommercial(byCommercial, row.commercialUserId);
    const saleKey = `${row.source}:${row.visitId || row.id}`;
    commercial.salesYearSet.add(saleKey);
    saleKeysYear.add(saleKey);
    commercial.linesYear += 1;
    totals.lignesAnnee += 1;
    commercial.year += row.montant;
    totals.year += row.montant;
    yearRows.push(row);
    if (monthIndex >= 0) {
      commercial.monthly[monthIndex] += row.montant;
      totals.monthly[monthIndex] += row.montant;
    }

    if (row.date >= period.weekStart && row.date <= period.weekEnd) {
      commercial.week += row.montant;
      totals.week += row.montant;
      weekRows.push(row);
    }

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
      if (visit.isPhoneOrder) {
        phoneVisitKeysMonth.add(`${visit.secteur}:${visit.id}`);
        commercial.phoneMonth += 1;
      } else {
        visitKeysMonth.add(`${visit.secteur}:${visit.id}`);
        clientKeysMonth.add(`${visit.secteur}:${visit.clientId || visit.clientNom}`);
        commercial.visitsMonth += 1;
        commercial.terrainMonth += 1;
        commercial.clientsMonthSet.add(`${visit.secteur}:${visit.clientId || visit.clientNom}`);
      }
    }
  }

  totals = mapMoneyTotals({
    ...totals,
    visitsMonth: visitKeysMonth.size,
    phoneMonth: phoneVisitKeysMonth.size,
    clientsMonth: clientKeysMonth.size,
    clientsTotal: clientKeysTotal.size,
    ventesAnnee: saleKeysYear.size
  });

  const byCommercialObject = Object.fromEntries(
    Array.from(byCommercial.entries()).map(([id, value]) => [id, salesCommercialToObject(value)])
  );

  return {
    totals,
    byCommercial: byCommercialObject,
    dailyRows: options.includeSalesDetails ? sortRows(dayRows).slice(0, 2500) : [],
    weeklyRows: options.includeSalesDetails ? sortRows(weekRows).slice(0, 2500) : [],
    monthlyRows: options.includeSalesDetails ? sortRows(monthRows).slice(0, 1200) : [],
    yearlyRows: options.includeSalesDetails ? sortRows(yearRows).slice(0, 1500) : [],
    topClientsMonth: options.includeSalesDetails ? finalizeTopClientsMap(topClientsMonth) : []
  };
}

function buildTopClientsFromSalesRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = `${row.commercialUserId}::${row.clientId || row.clientNom}`;
    const current = map.get(key) || {
      commercialUserId: row.commercialUserId,
      clientId: row.clientId,
      clientNom: row.clientNom,
      numeroCompte: row.numeroCompte,
      montant: 0,
      lignes: 0
    };
    current.montant += toNumber(row.montant);
    current.lignes += 1;
    map.set(key, current);
  }
  return finalizeTopClientsMap(map);
}

function finalizeTopClientsMap(map) {
  return Array.from(map.values())
    .map((item) => ({ ...item, montant: roundMoney(item.montant) }))
    .sort((a, b) => b.montant - a.montant)
    .slice(0, 30);
}

function salesCommercialToObject(value) {
  return {
    day: roundMoney(value.day),
    week: roundMoney(value.week),
    month: roundMoney(value.month),
    year: roundMoney(value.year),
    monthly: value.monthly.map(roundMoney),
    monthAuto: roundMoney(value.monthAuto),
    monthIndustrie: roundMoney(value.monthIndustrie),
    visitsMonth: value.visitsMonth,
    phoneMonth: value.phoneMonth,
    terrainMonth: value.terrainMonth,
    clientsMonth: value.clientsMonthSet.size || value.clientsMonthDirect || 0,
    clientsTotal: value.clientsTotalSet.size || value.clientsTotalDirect || 0,
    ventesAnnee: value.salesYearSet.size || value.salesYearDirect || 0,
    lignesAnnee: value.linesYear
  };
}

function ensureSalesCommercial(map, commercialUserId) {
  const key = commercialUserId || "unknown";
  if (!map.has(key)) {
    map.set(key, {
      day: 0,
      week: 0,
      month: 0,
      year: 0,
      monthly: emptyMonthlyArray(),
      monthAuto: 0,
      monthIndustrie: 0,
      visitsMonth: 0,
      phoneMonth: 0,
      terrainMonth: 0,
      clientsMonthSet: new Set(),
      clientsMonthDirect: 0,
      clientsTotalSet: new Set(),
      clientsTotalDirect: 0,
      salesYearSet: new Set(),
      salesYearDirect: 0,
      linesYear: 0
    });
  }
  return map.get(key);
}

function getIsoMonthIndex(value) {
  const match = String(value || "").match(/^\d{4}-(\d{2})-\d{2}$/);
  if (!match) return -1;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < 12 ? index : -1;
}

async function buildBudgetBlock(commercialIds, period, options = {}) {
  if (!commercialIds.length) return emptyBudgetBlock();
  try {
    return await buildBudgetBlockFast(commercialIds, period, options);
  } catch (error) {
    if (!isMissingDashboardFastViewError(error)) throw error;
    return buildBudgetBlockLegacy(commercialIds, period, options);
  }
}

async function buildBudgetBlockFast(commercialIds, period, options = {}) {
  const summaryRows = await fetchByCommercialChunks(
    DASHBOARD_FAST_VIEWS.budgetSummary,
    "commercial_user_id,commercial_identifier,commercial_name,entite_id,entite_key,entite_libelle,annee,active_budgets,lignes,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,total",
    commercialIds,
    {
      annee: `eq.${period.year}`,
      order: "commercial_name.asc,entite_libelle.asc"
    }
  );
  if (!summaryRows.length) return emptyBudgetBlock();

  const byCommercial = {};
  const byEntity = {};
  const monthlyTotals = emptyMonthlyArray();
  let totalYear = 0;
  let totalToDate = 0;

  const rows = summaryRows.map((sourceRow) => {
    const monthly = monthlyFromRow(sourceRow);
    const total = roundMoney(monthly.reduce((sum, value) => sum + value, 0));
    const toDate = roundMoney(sumToMonth(monthly, period.toDateMonth));
    const commercialId = sourceRow.commercial_user_id || "";
    const entiteId = sourceRow.entite_id || sourceRow.entite_key || "sans-entite";
    const lineCount = Number(sourceRow.lignes || 0);
    const activeBudgetCount = Number(sourceRow.active_budgets || 0);

    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyBudgetCommercial();
    byCommercial[commercialId].year += total;
    byCommercial[commercialId].toDate += toDate;
    byCommercial[commercialId].lines += lineCount;
    byCommercial[commercialId].activeBudgets += activeBudgetCount;
    if (entiteId) byCommercial[commercialId].entityIds.add(String(entiteId));
    monthly.forEach((value, index) => {
      byCommercial[commercialId].monthly[index] += value;
    });

    if (!byEntity[entiteId]) {
      byEntity[entiteId] = {
        id: entiteId,
        key: sourceRow.entite_key || "",
        libelle: sourceRow.entite_libelle || "Entite",
        total: 0,
        toDate: 0,
        lignes: 0,
        monthly: emptyMonthlyArray()
      };
    }
    byEntity[entiteId].total += total;
    byEntity[entiteId].toDate += toDate;
    byEntity[entiteId].lignes += lineCount;
    monthly.forEach((value, index) => {
      monthlyTotals[index] += value;
      byEntity[entiteId].monthly[index] += value;
    });
    totalYear += total;
    totalToDate += toDate;

    return {
      id: `${commercialId}:${entiteId}`,
      budgetId: "",
      commercialUserId: commercialId,
      commercialName: sourceRow.commercial_name || "",
      entiteId,
      entiteKey: sourceRow.entite_key || "",
      entiteLibelle: sourceRow.entite_libelle || "Entite",
      clientNom: "Budget consolidé",
      numeroClient: "",
      monthly,
      total,
      toDate,
      lignes: lineCount
    };
  });

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
    rows: options.includeBudgetRows ? rows.slice(0, 1500) : []
  };
}

async function buildBudgetBlockLegacy(commercialIds, period, options = {}) {
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
  const byCommercial = {};
  for (const budget of budgets) {
    const commercialId = budget.commercial_user_id || "";
    if (!commercialId) continue;
    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyBudgetCommercial();
    byCommercial[commercialId].activeBudgets += 1;
    if (budget.entite_id) byCommercial[commercialId].entityIds.add(String(budget.entite_id));
  }
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

  const byEntity = {};
  const monthlyTotals = emptyMonthlyArray();
  let totalYear = 0;
  let totalToDate = 0;

  for (const row of rows) {
    if (!byCommercial[row.commercialUserId]) byCommercial[row.commercialUserId] = emptyBudgetCommercial();
    byCommercial[row.commercialUserId].year += row.total;
    byCommercial[row.commercialUserId].toDate += row.toDate;
    byCommercial[row.commercialUserId].lines += 1;
    if (row.entiteId) byCommercial[row.commercialUserId].entityIds.add(String(row.entiteId));
    row.monthly.forEach((value, index) => {
      byCommercial[row.commercialUserId].monthly[index] += value;
    });
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
    rows: options.includeBudgetRows ? rows.slice(0, 1500) : []
  };
}

async function buildRealBlock(commercialIds, period, options = {}) {
  if (!commercialIds.length) return emptyRealBlock();
  try {
    return await buildRealBlockFast(commercialIds, period, options);
  } catch (error) {
    if (!isMissingDashboardFastViewError(error)) throw error;
    return buildRealBlockLegacy(commercialIds, period, options);
  }
}

async function buildRealBlockFast(commercialIds, period, options = {}) {
  const [rows, imports] = await Promise.all([
    fetchByCommercialChunks(DASHBOARD_FAST_VIEWS.realSummary, "commercial_user_id,commercial_identifier,commercial_name,entite_id,entite_key,entite_libelle,annee,mois,montant,quantite,lignes", commercialIds, {
      annee: `eq.${period.year}`,
      order: "mois.asc,entite_libelle.asc"
    }),
    fetchByCommercialChunks("reel_imports", "id,commercial_user_id,entite_id,annee,mois,statut,total_mois,nb_lignes", commercialIds, {
      annee: `eq.${period.year}`,
      statut: "eq.active",
      order: "mois.asc"
    })
  ]);

  const byCommercial = {};
  const byEntity = {};
  const monthlyTotals = emptyMonthlyArray();
  const monthlyRows = [];
  let totalYear = 0;
  let totalToDate = 0;

  for (const importRow of imports) {
    const commercialId = importRow.commercial_user_id || "";
    if (!commercialId) continue;
    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyRealCommercial();
    const month = clampNumber(importRow.mois, 1, 12, 1);
    byCommercial[commercialId].imports += 1;
    byCommercial[commercialId].importMonthsSet.add(month);
    byCommercial[commercialId].lastImportMonth = Math.max(byCommercial[commercialId].lastImportMonth || 0, month);
    byCommercial[commercialId].importedLines += Number(importRow.nb_lignes || 0);
    byCommercial[commercialId].importedAmount += toNumber(importRow.total_mois);
  }

  for (const row of rows) {
    const amount = toNumber(row.montant);
    const monthIndex = clampNumber(row.mois, 1, 12, 1) - 1;
    const commercialId = row.commercial_user_id || "";
    const lineCount = Number(row.lignes || 0);
    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyRealCommercial();
    byCommercial[commercialId].year += amount;
    byCommercial[commercialId].monthly[monthIndex] += amount;
    byCommercial[commercialId].lines += lineCount;
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
    byEntity[entityId].lignes += lineCount;
    if (monthIndex + 1 <= period.toDateMonth) byEntity[entityId].toDate += amount;

    monthlyTotals[monthIndex] += amount;
    totalYear += amount;
    if (monthIndex + 1 <= period.toDateMonth) totalToDate += amount;
    if (monthIndex + 1 === period.month) monthlyRows.push(normalizeRealSummaryRow(row));
  }

  Object.keys(byCommercial).forEach((id) => {
    byCommercial[id].year = roundMoney(byCommercial[id].year);
    byCommercial[id].toDate = roundMoney(byCommercial[id].toDate);
    byCommercial[id].monthly = byCommercial[id].monthly.map(roundMoney);
    byCommercial[id].importedAmount = roundMoney(byCommercial[id].importedAmount);
    byCommercial[id].importedMonths = Array.from(byCommercial[id].importMonthsSet).sort((a, b) => a - b);
    delete byCommercial[id].importMonthsSet;
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
    monthlyRows: options.includeBudgetRows ? monthlyRows.slice(0, 1200) : [],
    rows: options.includeBudgetRows ? monthlyRows.slice(0, 1500) : []
  };
}

async function buildRealBlockLegacy(commercialIds, period, options = {}) {
  if (!commercialIds.length) return emptyRealBlock();
  const [rows, imports] = await Promise.all([
    fetchByCommercialChunks("v_reel_lignes_actives", "id,commercial_user_id,commercial_identifier,commercial_name,entite_id,entite_key,entite_libelle,annee,mois,client_code,client_nom,montant,quantite,reference,designation,date_piece", commercialIds, {
      annee: `eq.${period.year}`,
      order: "mois.asc,client_nom.asc"
    }),
    fetchByCommercialChunks("reel_imports", "id,commercial_user_id,entite_id,annee,mois,statut,total_mois,nb_lignes", commercialIds, {
      annee: `eq.${period.year}`,
      statut: "eq.active",
      order: "mois.asc"
    })
  ]);

  const byCommercial = {};
  const byEntity = {};
  const monthlyTotals = emptyMonthlyArray();
  const monthlyRows = [];
  let totalYear = 0;
  let totalToDate = 0;

  for (const importRow of imports) {
    const commercialId = importRow.commercial_user_id || "";
    if (!commercialId) continue;
    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyRealCommercial();
    const month = clampNumber(importRow.mois, 1, 12, 1);
    byCommercial[commercialId].imports += 1;
    byCommercial[commercialId].importMonthsSet.add(month);
    byCommercial[commercialId].lastImportMonth = Math.max(byCommercial[commercialId].lastImportMonth || 0, month);
    byCommercial[commercialId].importedLines += Number(importRow.nb_lignes || 0);
    byCommercial[commercialId].importedAmount += toNumber(importRow.total_mois);
  }

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
    byCommercial[id].importedAmount = roundMoney(byCommercial[id].importedAmount);
    byCommercial[id].importedMonths = Array.from(byCommercial[id].importMonthsSet).sort((a, b) => a - b);
    delete byCommercial[id].importMonthsSet;
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
    monthlyRows: options.includeBudgetRows ? monthlyRows.slice(0, 1200) : [],
    rows: options.includeBudgetRows ? rows.map(normalizeRealRow).slice(0, 1500) : []
  };
}

async function buildDocumentsBlock(commercialIds, period, options = {}) {
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
    sansStatut: 0,
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
    recent: options.includeDocumentRows ? recent.slice(0, 80) : [],
    rows: options.includeDocumentRows ? recent.slice(0, 1000) : []
  };
}

async function buildCampaignsBlock(commercialIds, period) {
  if (!commercialIds.length) return emptyCampaignsBlock();
  const rows = await fetchByCommercialChunks("action_promo_campagnes", CAMPAIGN_SELECT, commercialIds, {
    sent_at: `gte.${period.year}-01-01T00:00:00.000Z`,
    sent_at_lte: `lt.${period.year + 1}-01-01T00:00:00.000Z`,
    order: "sent_at.desc,created_at.desc"
  }, { sent_at_lte: "sent_at" });

  const campaignIds = unique(rows.map((row) => row.id).filter(Boolean));
  const clients = campaignIds.length
    ? await fetchByChunks("action_promo_campagne_clients", CAMPAIGN_CLIENT_SELECT, "campagne_id", campaignIds, {
        order: "client_nom.asc"
      })
    : [];

  const byCommercial = {};
  const clientsByCampaign = {};
  const normalizedRows = rows.map(normalizeCampaignRow);
  const totals = { total: normalizedRows.length, clients: 0, caCible: 0 };

  normalizedRows.forEach((campaign) => {
    const commercialId = campaign.commercialUserId || "";
    if (!byCommercial[commercialId]) byCommercial[commercialId] = emptyCampaignCommercial();
    byCommercial[commercialId].total += 1;
    byCommercial[commercialId].clients += Number(campaign.clientCount || 0);
    byCommercial[commercialId].caCible += Number(campaign.totalCaCible || 0);
    totals.clients += Number(campaign.clientCount || 0);
    totals.caCible += Number(campaign.totalCaCible || 0);
  });

  clients.forEach((client) => {
    const key = normalizeText(client.campagne_id);
    if (!clientsByCampaign[key]) clientsByCampaign[key] = [];
    clientsByCampaign[key].push(normalizeCampaignClientRow(client));
  });

  Object.keys(byCommercial).forEach((id) => {
    byCommercial[id].caCible = roundMoney(byCommercial[id].caCible);
  });

  return {
    totals: {
      total: totals.total,
      clients: totals.clients,
      caCible: roundMoney(totals.caCible)
    },
    byCommercial,
    clientsByCampaign,
    recent: normalizedRows.slice(0, 80),
    rows: normalizedRows.slice(0, 1000)
  };
}

function enrichCommercial(commercial, blocks) {
  const sales = blocks.salesBlock.byCommercial[commercial.id] || emptySalesCommercialObject();
  const budget = blocks.budgetBlock.byCommercial[commercial.id] || emptyBudgetCommercialObject();
  const real = blocks.realBlock.byCommercial[commercial.id] || emptyRealCommercialObject();
  const docs = blocks.documentsBlock.byCommercial[commercial.id] || emptyDocumentCommercial();
  const campaigns = blocks.campaignsBlock.byCommercial[commercial.id] || emptyCampaignCommercial();
  const quality = blocks.qualityBlock.byCommercial[commercial.id] || emptyQualityCommercialObject();
  return {
    ...commercial,
    metrics: {
      caJour: roundMoney(sales.day),
      caHebdo: roundMoney(sales.week),
      caMois: roundMoney(sales.month),
      caAnnee: roundMoney(sales.year),
      caMensuel: Array.isArray(sales.monthly) ? sales.monthly.map(roundMoney) : emptyMonthlyArray(),
      reelMensuel: Array.isArray(real.monthly) ? real.monthly.map(roundMoney) : emptyMonthlyArray(),
      caAutoMois: roundMoney(sales.monthAuto),
      caIndustrieMois: roundMoney(sales.monthIndustrie),
      visitesMois: sales.visitsMonth || 0,
      commandesTelephoneMois: sales.phoneMonth || 0,
      terrainMois: sales.terrainMonth || 0,
      clientsMois: sales.clientsMonth || 0,
      clientsTotal: sales.clientsTotal || 0,
      clientsTailleTotal: quality.clientsTotalBySize || emptySizeCounts(),
      clientsTailleMois: quality.clientsVisitedBySizeMonth || emptySizeCounts(),
      caMoisParTaille: quality.caMonthBySize || emptySizeCounts(),
      demosMois: quality.demosMonth || 0,
      visitesAvecDemoMois: quality.visitsWithDemoMonth || 0,
      ventesAnnee: sales.ventesAnnee || 0,
      lignesAnnee: sales.lignesAnnee || 0,
      budgetAnnuel: roundMoney(budget.year),
      budgetADate: roundMoney(budget.toDate),
      budgetMensuel: Array.isArray(budget.monthly) ? budget.monthly.map(roundMoney) : emptyMonthlyArray(),
      budgetsActifs: budget.activeBudgets || 0,
      entitesBudgetees: budget.entitiesCount || 0,
      lignesBudget: budget.lines || 0,
      reelReportingAnnee: roundMoney(real.year),
      reelReportingADate: roundMoney(real.toDate),
      reelDernierMois: real.lastImportMonth || 0,
      reelImportsActifs: real.imports || 0,
      reelMoisImportes: Array.isArray(real.importedMonths) ? real.importedMonths : [],
      reelLignesImportees: real.importedLines || 0,
      ecartADate: roundMoney(real.toDate - budget.toDate),
      tauxAtteinteADate: budget.toDate ? roundMoney((real.toDate / budget.toDate) * 100) : null,
      documentsEnCours: docs.enCours || 0,
      documentsSansStatut: docs.sansStatut || 0,
      bdcEnCours: docs.bdcEnCours || 0,
      devisEnCours: docs.devisEnCours || 0,
      documentsTotal: docs.total || 0,
      campagnesPromo: campaigns.total || 0,
      clientsCampagnesPromo: campaigns.clients || 0,
      caCibleCampagnesPromo: roundMoney(campaigns.caCible),
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
    title: `${item.displayName} a des documents transmis`,
    message: `${item.metrics.documentsEnCours} document(s) BDC/devis a suivre.`
  }));

  return alerts.slice(0, 8);
}

function buildAdminCommercialScope(activeUsers, relations, allUsers, sectorMap) {
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
        : "Sans responsable actif",
      sectorMap
    });
  });
}

function buildResponsableCommercialScope(currentPortalUser, activeUsers, relations, sectorMap) {
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
            : "Acces exceptionnel",
        sectorMap
      });
    })
    .filter(Boolean);
}

function commercialSummary({ commercial, relation, responsables, scopeLabel, sectorMap }) {
  const sectorId = normalizeText(commercial.sector_id);
  const sector = sectorId && sectorMap ? sectorMap.get(sectorId) || null : null;
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
    responsableId: relation?.responsable_user_id || "",
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
    sectorId,
    sectorName: sector ? sector.name || "" : sectorId ? "Secteur masque" : "",
    sectorDepartments: sector ? safeDepartments(sector.departments) : [],
    sectorColor: sector ? normalizeColor(sector.color) : "",
    sectorActive: sector ? Boolean(sector.active) && !sector.hidden : false,
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
  const pages = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, (chunk) =>
    fetchPaged(table, select, {
      ...params,
      commercial_user_id: inFilter(chunk)
    }, aliases)
  );
  return pages.flat();
}

async function fetchByChunks(table, select, column, values, params = {}, aliases = {}) {
  const uniqueValues = unique(values).filter(Boolean);
  if (!uniqueValues.length) return [];
  const chunks = chunkArray(uniqueValues, 120);
  const pages = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, (chunk) =>
    fetchPaged(table, select, {
      ...params,
      [column]: inFilter(chunk)
    }, aliases)
  );
  return pages.flat();
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));
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
  if (status === "transmis" || status === "en_cours") return "enCours";
  if (row?.valide === true) return "valide";
  return "sansStatut";
}

function safeSector(sector) {
  return {
    id: sector.id,
    name: sector.name || "",
    departments: safeDepartments(sector.departments),
    color: normalizeColor(sector.color),
    description: sector.description || "",
    active: Boolean(sector.active),
    hidden: Boolean(sector.hidden),
    createdAt: sector.created_at || "",
    updatedAt: sector.updated_at || ""
  };
}

function safeDepartments(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s;|]+/)
      : [];
  return [...new Set(source.map((item) => normalizeDepartmentCode(item)).filter(Boolean))];
}

function normalizeDepartmentCode(value) {
  const raw = normalizeText(value).toUpperCase();
  if (raw === "2A" || raw === "2B") return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 1 ? `0${digits}` : digits;
}

function normalizeColor(value) {
  const color = normalizeText(value);
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : "#0F766E";
}

function isMissingSectorSchemaError(error) {
  const message = [
    error?.message,
    error?.payload?.message,
    error?.payload?.details,
    error?.payload?.hint
  ].filter(Boolean).join(" ");
  return /portal_commercial_sectors|sector_id|schema cache|column .* does not exist|relation .* does not exist/i.test(message);
}

function isMissingDashboardFastViewError(error) {
  const message = [
    error?.message,
    error?.payload?.message,
    error?.payload?.details,
    error?.payload?.hint
  ].filter(Boolean).join(" ");
  return /v_kent_dashboard_|schema cache|column .* does not exist|relation .* does not exist|could not find/i.test(message);
}

function isMissingColumnError(error, columnName) {
  const message = [
    error?.message,
    error?.payload?.message,
    error?.payload?.details,
    error?.payload?.hint
  ].filter(Boolean).join(" ");
  const escapedColumn = String(columnName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escapedColumn, "i").test(message)
    && /(schema cache|column|does not exist|could not find|introuvable|existe pas)/i.test(message);
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

function normalizeCampaignRow(row) {
  return {
    id: normalizeText(row.id),
    commercialUserId: normalizeText(row.commercial_user_id),
    productQuery: normalizeText(row.produit_recherche),
    sourceMode: normalizeText(row.source_mode),
    activityScope: normalizeText(row.activity_scope),
    plaqueFilterKey: normalizeText(row.plaque_filter_key) || "all",
    plaqueFilterLabel: normalizeText(row.plaque_filter_label) || "Toutes les plaques",
    periodValue: normalizeText(row.period_value) || "12",
    minCa: roundMoney(toNumber(row.min_ca)),
    clientCount: Number(row.nb_clients || 0),
    totalCaCible: roundMoney(toNumber(row.total_ca_cible)),
    status: normalizeText(row.statut) || "envoyee",
    sentAt: normalizeText(row.sent_at),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at)
  };
}

function normalizeCampaignClientRow(row) {
  return {
    id: normalizeText(row.id),
    campaignId: normalizeText(row.campagne_id),
    commercialUserId: normalizeText(row.commercial_user_id),
    clientId: normalizeText(row.client_id),
    sector: normalizeText(row.secteur),
    clientName: normalizeText(row.client_nom) || "Client sans nom",
    account: normalizeText(row.numero_compte),
    plaqueId: normalizeText(row.plaque_id),
    plaqueLabel: normalizeText(row.plaque_nom) || "Sans plaque",
    email: normalizeText(row.email),
    revenue: roundMoney(toNumber(row.ca_cible)),
    qty: toNumber(row.quantite),
    lastPurchase: normalizeText(row.dernier_achat),
    emailStatus: normalizeText(row.statut_email),
    createdAt: normalizeText(row.created_at)
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

function normalizeRealSummaryRow(row) {
  return {
    id: `${row.commercial_user_id || ""}:${row.entite_id || row.entite_key || ""}:${row.annee || ""}:${row.mois || ""}`,
    commercialUserId: row.commercial_user_id || "",
    entiteId: row.entite_id || "",
    entiteKey: row.entite_key || "",
    entiteLibelle: row.entite_libelle || "Entite",
    annee: Number(row.annee || 0),
    mois: Number(row.mois || 0),
    clientCode: "",
    clientNom: "Réel consolidé",
    montant: roundMoney(toNumber(row.montant)),
    quantite: toNumber(row.quantite),
    reference: "",
    designation: "",
    datePiece: ""
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

function daysInMonth(year, month) {
  return new Date(Number(year || 1970), Number(month || 1), 0).getDate();
}

function minIsoDate(...dates) {
  return dates.filter(Boolean).sort()[0] || "";
}

function maxIsoDate(...dates) {
  return dates.filter(Boolean).sort().at(-1) || "";
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.clientNom || "").localeCompare(String(b.clientNom || ""), "fr"));
}

function mergeRowsById(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = normalizeText(row?.id);
    if (!key || map.has(key)) return;
    map.set(key, row);
  });
  return Array.from(map.values());
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

function emptySizeCounts() {
  return CLIENT_SIZE_KEYS.reduce((acc, size) => {
    acc[size] = 0;
    return acc;
  }, {});
}

function emptySizeSets() {
  return CLIENT_SIZE_KEYS.reduce((acc, size) => {
    acc[size] = new Set();
    return acc;
  }, {});
}

function normalizeClientSize(value) {
  const size = normalizeText(value).toUpperCase();
  return CLIENT_SIZE_KEYS.includes(size) ? size : CLIENT_SIZE_DEFAULT;
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const text = normalizeText(value).toLowerCase();
  return ["true", "1", "oui", "yes", "y"].includes(text);
}

function emptyQualityTotals() {
  return {
    clientsTotalBySize: emptySizeCounts(),
    clientsVisitedBySizeMonth: emptySizeCounts(),
    clientsVisitedBySizeMonthSets: emptySizeSets(),
    caMonthBySize: emptySizeCounts(),
    demosMonth: 0,
    visitsWithDemoMonth: 0,
    visitsWithDemoMonthSet: new Set()
  };
}

function finalizeQualityTotals(totals) {
  const clientsVisitedBySizeMonth = emptySizeCounts();
  CLIENT_SIZE_KEYS.forEach((size) => {
    clientsVisitedBySizeMonth[size] = totals.clientsVisitedBySizeMonthSets?.[size]?.size || totals.clientsVisitedBySizeMonth?.[size] || 0;
    totals.caMonthBySize[size] = roundMoney(totals.caMonthBySize[size]);
  });
  return {
    clientsTotalBySize: totals.clientsTotalBySize || emptySizeCounts(),
    clientsVisitedBySizeMonth,
    caMonthBySize: totals.caMonthBySize || emptySizeCounts(),
    demosMonth: Number(totals.demosMonth || 0),
    visitsWithDemoMonth: totals.visitsWithDemoMonthSet?.size || Number(totals.visitsWithDemoMonth || 0)
  };
}

function emptyQualityCommercial() {
  return {
    clientsTotalBySize: emptySizeCounts(),
    clientsVisitedBySizeMonthSets: emptySizeSets(),
    caMonthBySize: emptySizeCounts(),
    demosMonth: 0,
    visitsWithDemoMonthSet: new Set()
  };
}

function emptyQualityCommercialObject() {
  return {
    clientsTotalBySize: emptySizeCounts(),
    clientsVisitedBySizeMonth: emptySizeCounts(),
    caMonthBySize: emptySizeCounts(),
    demosMonth: 0,
    visitsWithDemoMonth: 0
  };
}

function ensureQualityCommercial(map, commercialId) {
  const key = normalizeText(commercialId) || "unknown";
  if (!map.has(key)) map.set(key, emptyQualityCommercial());
  return map.get(key);
}

function qualityMapToObject(map) {
  return Object.fromEntries(
    Array.from(map.entries()).map(([commercialId, value]) => {
      const clientsVisitedBySizeMonth = emptySizeCounts();
      const caMonthBySize = emptySizeCounts();
      CLIENT_SIZE_KEYS.forEach((size) => {
        clientsVisitedBySizeMonth[size] = value.clientsVisitedBySizeMonthSets[size].size;
        caMonthBySize[size] = roundMoney(value.caMonthBySize[size]);
      });
      return [commercialId, {
        clientsTotalBySize: value.clientsTotalBySize,
        clientsVisitedBySizeMonth,
        caMonthBySize,
        demosMonth: Number(value.demosMonth || 0),
        visitsWithDemoMonth: value.visitsWithDemoMonthSet.size
      }];
    })
  );
}

function emptyMetrics() {
  return {
    caJour: 0,
    caHebdo: 0,
    caMois: 0,
    caAnnee: 0,
    caMensuel: emptyMonthlyArray(),
    reelMensuel: emptyMonthlyArray(),
    caAutoMois: 0,
    caIndustrieMois: 0,
    visitesMois: 0,
    commandesTelephoneMois: 0,
    terrainMois: 0,
    clientsMois: 0,
    clientsTotal: 0,
    clientsTailleTotal: emptySizeCounts(),
    clientsTailleMois: emptySizeCounts(),
    caMoisParTaille: emptySizeCounts(),
    demosMois: 0,
    visitesAvecDemoMois: 0,
    ventesAnnee: 0,
    lignesAnnee: 0,
    budgetAnnuel: 0,
    budgetADate: 0,
    budgetMensuel: emptyMonthlyArray(),
    budgetsActifs: 0,
    entitesBudgetees: 0,
    lignesBudget: 0,
    reelReportingAnnee: 0,
    reelReportingADate: 0,
    reelDernierMois: 0,
    reelImportsActifs: 0,
    reelMoisImportes: [],
    reelLignesImportees: 0,
    ecartADate: 0,
    tauxAtteinteADate: null,
    documentsEnCours: 0,
    documentsSansStatut: 0,
    bdcEnCours: 0,
    devisEnCours: 0,
    documentsTotal: 0,
    campagnesPromo: 0,
    clientsCampagnesPromo: 0,
    caCibleCampagnesPromo: 0,
    status: "ready"
  };
}

function emptySalesCommercialObject() {
  return {
    day: 0,
    week: 0,
    month: 0,
    year: 0,
    monthly: emptyMonthlyArray(),
    monthAuto: 0,
    monthIndustrie: 0,
    visitsMonth: 0,
    phoneMonth: 0,
    terrainMonth: 0,
    clientsMonth: 0,
    clientsTotal: 0,
    ventesAnnee: 0,
    lignesAnnee: 0
  };
}

function emptyBudgetCommercial() {
  return { year: 0, toDate: 0, lines: 0, monthly: emptyMonthlyArray(), activeBudgets: 0, entityIds: new Set() };
}

function emptyBudgetCommercialObject() {
  return { year: 0, toDate: 0, lines: 0, monthly: emptyMonthlyArray(), activeBudgets: 0, entitiesCount: 0 };
}

function emptyRealCommercial() {
  return { year: 0, toDate: 0, lines: 0, monthly: emptyMonthlyArray(), imports: 0, importMonthsSet: new Set(), lastImportMonth: 0, importedLines: 0, importedAmount: 0 };
}

function emptyRealCommercialObject() {
  return { year: 0, toDate: 0, lines: 0, monthly: emptyMonthlyArray(), imports: 0, importedMonths: [], lastImportMonth: 0, importedLines: 0, importedAmount: 0 };
}

function emptyDocumentCommercial() {
  return { total: 0, sansStatut: 0, enCours: 0, valide: 0, nonValide: 0, bdcEnCours: 0, devisEnCours: 0 };
}

function emptyCampaignCommercial() {
  return { total: 0, clients: 0, caCible: 0 };
}

function normalizeBudgetCommercials(byCommercial) {
  Object.keys(byCommercial).forEach((id) => {
    byCommercial[id].year = roundMoney(byCommercial[id].year);
    byCommercial[id].toDate = roundMoney(byCommercial[id].toDate);
    byCommercial[id].monthly = byCommercial[id].monthly.map(roundMoney);
    byCommercial[id].entitiesCount = byCommercial[id].entityIds ? byCommercial[id].entityIds.size : 0;
    delete byCommercial[id].entityIds;
  });
}

function emptySalesBlock() {
  return {
    totals: { day: 0, week: 0, month: 0, year: 0, monthly: emptyMonthlyArray(), monthAuto: 0, monthIndustrie: 0, visitsMonth: 0, phoneMonth: 0, clientsMonth: 0, clientsTotal: 0, ventesAnnee: 0, lignesAnnee: 0 },
    byCommercial: {},
    dailyRows: [],
    weeklyRows: [],
    monthlyRows: [],
    yearlyRows: [],
    topClientsMonth: []
  };
}

function emptyQualityBlock() {
  return {
    totals: finalizeQualityTotals(emptyQualityTotals()),
    byCommercial: {}
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
    totals: { total: 0, sansStatut: 0, enCours: 0, valide: 0, nonValide: 0, bdcEnCours: 0, devisEnCours: 0, montantEnCours: 0 },
    byCommercial: {},
    recent: [],
    rows: []
  };
}

function emptyCampaignsBlock() {
  return {
    totals: { total: 0, clients: 0, caCible: 0 },
    byCommercial: {},
    clientsByCampaign: {},
    recent: [],
    rows: []
  };
}
