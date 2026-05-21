import crypto from "node:crypto";

const COOKIE_NAME = "kent_portal_day";
const PARIS_TIMEZONE = "Europe/Paris";
const MAX_RESPONSE_ROWS = 1000;
const DEFAULT_LIMIT = 10;
const PAGE_SIZE = 1000;
const MAX_FETCH_ROWS = 50000;

const SUPABASE_URL = process.env.SUPABASE_URL || "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";

const ALLOWED_INTENTS = new Set([
  "top_products",
  "top_clients",
  "sales_evolution",
  "inactive_clients",
  "visit_history",
  "client_summary",
  "product_performance",
  "sales_by_period",
  "compare_periods"
]);

const ALLOWED_VISUALIZATIONS = new Set(["table", "bar", "line", "pie"]);

const DEFAULT_VISUALIZATION_BY_INTENT = {
  top_products: "bar",
  top_clients: "bar",
  sales_evolution: "line",
  inactive_clients: "table",
  visit_history: "table",
  client_summary: "table",
  product_performance: "bar",
  sales_by_period: "bar",
  compare_periods: "bar"
};

const FORBIDDEN_MUTATION_PATTERN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i;

const PLAQUE_ALIAS_TO_CANONICAL = new Map([
  ["psa", "PSA Tarif Revente"],
  ["psa tarif revente", "PSA Tarif Revente"],
  ["gueudet", "Gueudet Tarif revente"],
  ["gd", "Gueudet Tarif revente"],
  ["gueudet tarif revente", "Gueudet Tarif revente"],
  ["gueudet tarif achat", "Gueudet Tarif achat Concession"],
  ["gueudet tarif achat concession", "Gueudet Tarif achat Concession"],
  ["ford", "Ford Tarif Revente"],
  ["ford tarif revente", "Ford Tarif Revente"],
  ["ford tarif achat", "Ford Tarif Achat"],
  ["direct", "Direct Tarif"],
  ["direct tarif", "Direct Tarif"]
]);

const SCHEMA_FOR_MODEL = {
  tables: [
    {
      name: "clients",
      columns: ["id", "nom", "numero_compte", "adresse", "telephone", "plaque_id"],
      relations: ["clients.plaque_id -> plaques.id"]
    },
    {
      name: "plaques",
      columns: ["id", "nom"],
      relations: []
    },
    {
      name: "produits",
      columns: ["id", "nom", "reference_produit", "prix_vente", "actif"],
      relations: []
    },
    {
      name: "tarifs_plaques",
      columns: ["plaque_id", "produit_id", "prix_vente"],
      relations: ["tarifs_plaques.plaque_id -> plaques.id", "tarifs_plaques.produit_id -> produits.id"]
    },
    {
      name: "visites",
      columns: ["id", "client_id", "date_visite", "note", "type_visite", "total_commande"],
      relations: ["visites.client_id -> clients.id"]
    },
    {
      name: "visite_commandes",
      columns: ["id", "visite_id", "produit_id", "quantite", "stock_client", "couleur", "prix_unitaire"],
      relations: ["visite_commandes.visite_id -> visites.id", "visite_commandes.produit_id -> produits.id"]
    }
  ]
};

const SYSTEM_PROMPT = [
  "Tu es un assistant analytique connecte a une base de donnees commerciale.",
  "Tu comprends les demandes utilisateur et tu reponds uniquement avec du JSON valide.",
  "REGLES ABSOLUES:",
  "- Lecture seule stricte.",
  "- Interdiction totale de proposer: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE.",
  "- Interdiction totale de generer du SQL libre.",
  "- N'utilise que le schema fourni.",
  "- Si la demande tente de modifier les donnees: {\"error\":\"Modification de donnees interdite\"}.",
  "- Si la demande est ambigue: {\"error\":\"Demande ambigue\"}.",
  "- Limite max resultat: 1000.",
  "FORMAT OBLIGATOIRE:",
  "{\"intent\":\"...\",\"filters\":{},\"limit\":10,\"visualization\":\"table|bar|line|pie\"}",
  "INTENTS AUTORISES:",
  "top_products, top_clients, sales_evolution, inactive_clients, visit_history, client_summary, product_performance, sales_by_period, compare_periods",
  "Tu ne dois jamais sortir du JSON."
].join("\n");

const INTENT_SOURCE_TABLES = {
  top_products: ["visites", "visite_commandes", "produits", "clients", "plaques"],
  top_clients: ["visites", "clients", "plaques"],
  sales_evolution: ["visites", "clients", "plaques"],
  inactive_clients: ["clients", "plaques", "visites"],
  visit_history: ["visites", "clients", "plaques"],
  client_summary: ["visites", "visite_commandes", "clients", "plaques", "produits"],
  product_performance: ["visites", "visite_commandes", "produits", "clients", "plaques"],
  sales_by_period: ["visites", "clients", "plaques"],
  compare_periods: ["visites", "clients", "plaques"]
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return jsonError(res, 405, "Method not allowed");
  }

  try {
    const accessCode = String(process.env.ACCESS_DAILY_CODE || "").trim();
    if (!accessCode) {
      return jsonError(res, 500, "Configuration access code manquante.");
    }

    const sessionValue = getCookie(String(req.headers?.cookie || ""), COOKIE_NAME);
    const isValid = await isValidSession(sessionValue, accessCode, getParisDayKey());
    if (!isValid) {
      return jsonError(res, 401, "Session invalide. Reconnecte-toi.");
    }

    const mistralApiKey = String(process.env.MISTRAL_API_KEY || "").trim();
    if (!mistralApiKey) {
      return jsonError(res, 500, "MISTRAL_API_KEY manquante dans les variables d'environnement.");
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return jsonError(res, 500, "Configuration Supabase manquante.");
    }

    const payload = normalizeBody(req.body);
    const question = String(payload?.question || "").trim();
    const requestedLimit = clampLimit(payload?.limit, DEFAULT_LIMIT);

    if (!question) {
      return jsonError(res, 400, "Question obligatoire.");
    }

    if (FORBIDDEN_MUTATION_PATTERN.test(question)) {
      return jsonError(res, 400, "Modification de donnees interdite", {
        error: "Modification de donnees interdite"
      });
    }

    const modelResponse = await parseQuestionWithMistral({
      question,
      limit: requestedLimit,
      apiKey: mistralApiKey
    });

    const normalizedPlan = normalizeIntentPlan(modelResponse, requestedLimit);
    if (normalizedPlan.error) {
      return jsonError(res, 400, normalizedPlan.error, { error: normalizedPlan.error });
    }

    if (FORBIDDEN_MUTATION_PATTERN.test(JSON.stringify(normalizedPlan))) {
      return jsonError(res, 400, "Modification de donnees interdite", {
        error: "Modification de donnees interdite"
      });
    }

    const analytics = await runReadOnlyAnalytics(normalizedPlan);

    return res.status(200).json({
      ok: true,
      question,
      intent: normalizedPlan.intent,
      visualization: normalizedPlan.visualization,
      queryPlan: normalizedPlan,
      summary: analytics.summary,
      finalResult: analytics.finalResult,
      columns: analytics.columns,
      rows: analytics.rows,
      meta: {
        sourceTables: INTENT_SOURCE_TABLES[normalizedPlan.intent] || [],
        limitApplied: normalizedPlan.limit,
        rowCount: analytics.rows.length,
        period: analytics.periodLabel || null,
        scope: "global_read_only"
      }
    });
  } catch (error) {
    console.error("[ai-query]", error);
    return jsonError(res, 500, "Erreur pendant l'analyse IA.");
  }
}

function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    message,
    ...extra
  });
}

function normalizeBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  const rounded = Math.floor(numberValue);
  if (rounded < 1) return 1;
  if (rounded > MAX_RESPONSE_ROWS) return MAX_RESPONSE_ROWS;
  return rounded;
}

async function parseQuestionWithMistral({ question, limit, apiKey }) {
  const model = String(process.env.MISTRAL_MODEL || "mistral-small-latest").trim();
  const userPrompt = JSON.stringify(
    {
      question,
      rules: {
        max_rows: MAX_RESPONSE_ROWS,
        read_only: true,
        allowed_intents: Array.from(ALLOWED_INTENTS)
      },
      schema: SCHEMA_FOR_MODEL
    },
    null,
    2
  );

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Mistral API error (${response.status}): ${rawText.slice(0, 240)}`);
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(rawText);
  } catch {
    throw new Error("Reponse Mistral invalide.");
  }

  const modelContent = readModelContent(parsedPayload);
  const parsedContent = parseModelJson(modelContent);

  if (!parsedContent || typeof parsedContent !== "object") {
    throw new Error("Mistral n'a pas retourne un JSON exploitable.");
  }

  if (Object.prototype.hasOwnProperty.call(parsedContent, "error")) {
    return parsedContent;
  }

  return {
    intent: parsedContent.intent,
    filters: parsedContent.filters,
    limit: parsedContent.limit ?? limit,
    visualization: parsedContent.visualization
  };
}

function readModelContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content
      .map(item => (typeof item?.text === "string" ? item.text : typeof item?.content === "string" ? item.content : ""))
      .join("\n")
      .trim();
  }
  if (typeof content === "string") return content.trim();
  return "";
}

function parseModelJson(content) {
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeIntentPlan(rawPlan, requestLimit) {
  if (!rawPlan || typeof rawPlan !== "object") {
    return { error: "Demande ambigue" };
  }

  if (rawPlan.error) {
    return { error: String(rawPlan.error || "Demande ambigue") };
  }

  const intent = String(rawPlan.intent || "").trim();
  if (!ALLOWED_INTENTS.has(intent)) {
    return { error: "Demande ambigue" };
  }

  const filters = rawPlan.filters && typeof rawPlan.filters === "object" ? rawPlan.filters : {};
  const limitedByModel = clampLimit(rawPlan.limit, requestLimit);
  const limit = clampLimit(Math.min(requestLimit, limitedByModel), requestLimit);

  const visualizationCandidate = String(rawPlan.visualization || "").trim().toLowerCase();
  const visualization = ALLOWED_VISUALIZATIONS.has(visualizationCandidate)
    ? visualizationCandidate
    : DEFAULT_VISUALIZATION_BY_INTENT[intent];

  return {
    intent,
    filters,
    limit,
    visualization
  };
}

async function runReadOnlyAnalytics(plan) {
  const needsProducts = plan.intent === "top_products" || plan.intent === "product_performance" || plan.intent === "client_summary";
  const needsCommandes = needsProducts;

  const [clients, plaques, visites, produits, commandes] = await Promise.all([
    fetchAllRows("clients", "id,nom,numero_compte,plaque_id", "nom.asc"),
    fetchAllRows("plaques", "id,nom", "nom.asc"),
    fetchAllRows("visites", "id,client_id,date_visite,note,type_visite,total_commande", "date_visite.desc"),
    needsProducts ? fetchAllRows("produits", "id,nom,reference_produit,prix_vente,actif", "nom.asc") : Promise.resolve([]),
    needsCommandes ? fetchAllRows("visite_commandes", "id,visite_id,produit_id,quantite,stock_client,couleur,prix_unitaire") : Promise.resolve([])
  ]);

  const clientsById = indexBy(clients, row => String(row.id || ""));
  const plaquesById = indexBy(plaques, row => String(row.id || ""));
  const produitsById = indexBy(produits, row => String(row.id || ""));

  const normalizedFilters = normalizeFilters(plan.filters, plaques);
  if (!normalizedFilters.clientIdSet) {
    const inferredClientIds = resolveClientIdsFromText(clients, normalizedFilters);
    if (inferredClientIds && inferredClientIds.size) {
      normalizedFilters.clientIdSet = inferredClientIds;
    }
  }
  const period = resolvePeriodRange(normalizedFilters);

  switch (plan.intent) {
    case "top_products":
      return buildTopProducts({ plan, period, normalizedFilters, clientsById, plaquesById, produitsById, visites, commandes });
    case "top_clients":
      return buildTopClients({ plan, period, normalizedFilters, clientsById, plaquesById, visites });
    case "sales_evolution":
      return buildSalesEvolution({ plan, period, normalizedFilters, clientsById, plaquesById, visites });
    case "inactive_clients":
      return buildInactiveClients({ plan, normalizedFilters, clients, clientsById, plaquesById, visites });
    case "visit_history":
      return buildVisitHistory({ plan, period, normalizedFilters, clientsById, plaquesById, visites });
    case "client_summary":
      return buildClientSummary({ plan, period, normalizedFilters, clients, clientsById, plaquesById, visites, commandes, produitsById });
    case "product_performance":
      return buildProductPerformance({ plan, period, normalizedFilters, clientsById, plaquesById, visites, commandes, produits, produitsById });
    case "sales_by_period":
      return buildSalesByPeriod({ plan, period, normalizedFilters, clientsById, plaquesById, visites });
    case "compare_periods":
      return buildComparePeriods({ plan, normalizedFilters, clientsById, plaquesById, visites });
    default:
      return {
        columns: ["message"],
        rows: [{ message: "Intent non gere." }],
        summary: "Intent non gere.",
        finalResult: "Intent non gere.",
        periodLabel: period.label
      };
  }
}

function buildTopProducts({ plan, period, normalizedFilters, clientsById, produitsById, visites, commandes }) {
  const filteredVisits = filterVisits(visites, {
    clientsById,
    plaqueIdSet: normalizedFilters.plaqueIdSet,
    clientIdSet: normalizedFilters.clientIdSet,
    period,
    onlySales: true
  });

  const visitIds = new Set(filteredVisits.map(row => getVisitId(row)).filter(Boolean));
  const aggregate = new Map();

  for (const ligne of commandes) {
    const visiteId = String(ligne?.visite_id || "");
    if (!visitIds.has(visiteId)) continue;

    const productId = String(ligne?.produit_id || "");
    if (!productId) continue;

    const quantite = toNumber(ligne?.quantite);
    const prix = toNumber(ligne?.prix_unitaire);
    const total = round2(quantite * prix);

    if (!aggregate.has(productId)) {
      aggregate.set(productId, { quantite_totale: 0, chiffre_affaires_ht: 0 });
    }

    const row = aggregate.get(productId);
    row.quantite_totale += quantite;
    row.chiffre_affaires_ht = round2(row.chiffre_affaires_ht + total);
  }

  const rows = Array.from(aggregate.entries())
    .map(([productId, values]) => {
      const produit = produitsById.get(productId) || {};
      return {
        reference_produit: produit.reference_produit || "-",
        designation: produit.nom || "[produit introuvable]",
        quantite_totale: values.quantite_totale,
        chiffre_affaires_ht: round2(values.chiffre_affaires_ht)
      };
    })
    .sort((a, b) => b.chiffre_affaires_ht - a.chiffre_affaires_ht)
    .slice(0, plan.limit);

  const totalCa = round2(rows.reduce((sum, row) => sum + toNumber(row.chiffre_affaires_ht), 0));

  return {
    columns: ["reference_produit", "designation", "quantite_totale", "chiffre_affaires_ht"],
    rows,
    summary: `Top ${rows.length} produits sur ${period.label}.`,
    finalResult: `CA HT cumule affiche: ${formatNumberFr(totalCa)} EUR.`,
    periodLabel: period.label
  };
}

function buildTopClients({ plan, period, normalizedFilters, clientsById, plaquesById, visites }) {
  const filteredVisits = filterVisits(visites, {
    clientsById,
    plaqueIdSet: normalizedFilters.plaqueIdSet,
    clientIdSet: normalizedFilters.clientIdSet,
    period,
    onlySales: true
  });

  const aggregate = new Map();
  for (const visite of filteredVisits) {
    const clientId = String(visite?.client_id || "");
    if (!clientId) continue;

    if (!aggregate.has(clientId)) {
      aggregate.set(clientId, { ca_ht: 0, nb_visites: 0 });
    }

    const row = aggregate.get(clientId);
    row.nb_visites += 1;
    row.ca_ht = round2(row.ca_ht + toNumber(visite?.total_commande));
  }

  const rows = Array.from(aggregate.entries())
    .map(([clientId, values]) => {
      const client = clientsById.get(clientId) || {};
      const plaqueLabel = getPlaqueLabel(client?.plaque_id, plaquesById);
      return {
        client_nom: client.nom || "[client introuvable]",
        numero_compte: client.numero_compte || "-",
        plaque: plaqueLabel,
        nb_visites: values.nb_visites,
        ca_ht: round2(values.ca_ht)
      };
    })
    .sort((a, b) => b.ca_ht - a.ca_ht)
    .slice(0, plan.limit);

  const totalCa = round2(rows.reduce((sum, row) => sum + toNumber(row.ca_ht), 0));

  return {
    columns: ["client_nom", "numero_compte", "plaque", "nb_visites", "ca_ht"],
    rows,
    summary: `Top ${rows.length} clients sur ${period.label}.`,
    finalResult: `CA HT cumule affiche: ${formatNumberFr(totalCa)} EUR.`,
    periodLabel: period.label
  };
}

function buildSalesEvolution({ plan, period, normalizedFilters, clientsById, visites }) {
  const granularity = normalizeGranularity(normalizedFilters.granularity, period.token);

  const filteredVisits = filterVisits(visites, {
    clientsById,
    plaqueIdSet: normalizedFilters.plaqueIdSet,
    clientIdSet: normalizedFilters.clientIdSet,
    period,
    onlySales: true
  });

  const aggregate = new Map();
  for (const visite of filteredVisits) {
    const dateValue = normalizeDate(visite?.date_visite);
    const bucket = buildTimeBucket(dateValue, granularity);
    if (!bucket) continue;

    if (!aggregate.has(bucket)) {
      aggregate.set(bucket, { ca_ht: 0, nb_visites: 0 });
    }

    const row = aggregate.get(bucket);
    row.ca_ht = round2(row.ca_ht + toNumber(visite?.total_commande));
    row.nb_visites += 1;
  }

  const rows = Array.from(aggregate.entries())
    .map(([periode, values]) => ({
      periode,
      ca_ht: round2(values.ca_ht),
      nb_visites: values.nb_visites
    }))
    .sort((a, b) => String(a.periode).localeCompare(String(b.periode)))
    .slice(0, plan.limit);

  const totalCa = round2(rows.reduce((sum, row) => sum + toNumber(row.ca_ht), 0));

  return {
    columns: ["periode", "ca_ht", "nb_visites"],
    rows,
    summary: `Evolution des ventes (${granularity}) sur ${period.label}.`,
    finalResult: `CA HT total sur la periode: ${formatNumberFr(totalCa)} EUR.`,
    periodLabel: period.label
  };
}

function buildInactiveClients({ plan, normalizedFilters, clients, plaquesById, visites }) {
  const months = extractInactiveMonths(normalizedFilters.inactive_since);
  const thresholdDate = shiftMonths(getTodayDateParis(), -months);
  const threshold = toIsoDate(thresholdDate);

  const eligibleClientIds = resolveEligibleClientIds(clients, normalizedFilters);
  const latestSaleByClient = new Map();

  for (const visite of visites) {
    if (!isSaleVisit(visite)) continue;

    const clientId = String(visite?.client_id || "");
    if (!clientId || (eligibleClientIds && !eligibleClientIds.has(clientId))) continue;

    const visitDate = normalizeDate(visite?.date_visite);
    if (!visitDate) continue;

    const previous = latestSaleByClient.get(clientId);
    if (!previous || visitDate > previous) {
      latestSaleByClient.set(clientId, visitDate);
    }
  }

  const rows = [];

  for (const client of clients) {
    const clientId = String(client?.id || "");
    if (!clientId) continue;
    if (eligibleClientIds && !eligibleClientIds.has(clientId)) continue;

    const lastSale = latestSaleByClient.get(clientId) || "";
    if (lastSale && lastSale >= threshold) continue;

    rows.push({
      client_nom: client.nom || "-",
      numero_compte: client.numero_compte || "-",
      plaque: getPlaqueLabel(client.plaque_id, plaquesById),
      derniere_vente: lastSale || "-",
      jours_sans_vente: lastSale ? daysBetween(lastSale, toIsoDate(getTodayDateParis())) : null
    });
  }

  rows.sort((a, b) => {
    if (a.derniere_vente === "-" && b.derniere_vente !== "-") return -1;
    if (a.derniere_vente !== "-" && b.derniere_vente === "-") return 1;
    return String(a.derniere_vente).localeCompare(String(b.derniere_vente));
  });

  const limited = rows.slice(0, plan.limit);

  return {
    columns: ["client_nom", "numero_compte", "plaque", "derniere_vente", "jours_sans_vente"],
    rows: limited,
    summary: `Clients inactifs depuis au moins ${months} mois.`,
    finalResult: `${rows.length} client(s) inactif(s) detecte(s), ${limited.length} affiche(s).`,
    periodLabel: `Inactivite >= ${months} mois`
  };
}

function buildVisitHistory({ plan, period, normalizedFilters, clientsById, plaquesById, visites }) {
  const filtered = filterVisits(visites, {
    clientsById,
    plaqueIdSet: normalizedFilters.plaqueIdSet,
    clientIdSet: normalizedFilters.clientIdSet,
    period,
    onlySales: false
  });

  const rows = filtered
    .map(visite => {
      const client = clientsById.get(String(visite?.client_id || "")) || {};
      return {
        date_visite: normalizeDate(visite?.date_visite),
        client_nom: client.nom || "[client introuvable]",
        numero_compte: client.numero_compte || "-",
        plaque: getPlaqueLabel(client.plaque_id, plaquesById),
        total_ht: round2(toNumber(visite?.total_commande)),
        note: String(visite?.note || ""),
        type_visite: String(visite?.type_visite || "")
      };
    })
    .sort((a, b) => String(b.date_visite).localeCompare(String(a.date_visite)))
    .slice(0, plan.limit);

  return {
    columns: ["date_visite", "client_nom", "numero_compte", "plaque", "total_ht", "type_visite", "note"],
    rows,
    summary: `Historique des visites sur ${period.label}.`,
    finalResult: `${rows.length} visite(s) affichee(s).`,
    periodLabel: period.label
  };
}

function buildClientSummary({ plan, period, normalizedFilters, clients, clientsById, plaquesById, visites, commandes, produitsById }) {
  const targetClient = resolveSingleClient(clients, normalizedFilters);
  if (!targetClient) {
    return {
      columns: ["message"],
      rows: [{ message: "Demande ambigue" }],
      summary: "Demande ambigue: client non identifie.",
      finalResult: "Precise le client (nom, numero compte ou id).",
      periodLabel: period.label
    };
  }

  const clientId = String(targetClient.id);
  const clientVisits = filterVisits(visites, {
    clientsById,
    plaqueIdSet: null,
    clientIdSet: new Set([clientId]),
    period,
    onlySales: false
  });

  const saleVisits = clientVisits.filter(isSaleVisit);
  const visitIds = new Set(clientVisits.map(getVisitId).filter(Boolean));

  const aggregateProducts = new Map();
  for (const ligne of commandes) {
    const visiteId = String(ligne?.visite_id || "");
    if (!visitIds.has(visiteId)) continue;

    const productId = String(ligne?.produit_id || "");
    if (!productId) continue;

    if (!aggregateProducts.has(productId)) {
      aggregateProducts.set(productId, { quantite: 0, ca: 0 });
    }

    const row = aggregateProducts.get(productId);
    const quantite = toNumber(ligne?.quantite);
    const ca = round2(quantite * toNumber(ligne?.prix_unitaire));

    row.quantite += quantite;
    row.ca = round2(row.ca + ca);
  }

  const topProduct = Array.from(aggregateProducts.entries())
    .map(([productId, values]) => ({
      productId,
      quantite: values.quantite,
      ca: values.ca,
      produit: produitsById.get(productId) || {}
    }))
    .sort((a, b) => b.ca - a.ca)[0];

  const totalCa = round2(saleVisits.reduce((sum, visite) => sum + toNumber(visite?.total_commande), 0));
  const lastVisit = clientVisits[0] ? normalizeDate(clientVisits[0].date_visite) : "-";

  const rows = [
    { indicateur: "Client", valeur: targetClient.nom || "-" },
    { indicateur: "Numero compte", valeur: targetClient.numero_compte || "-" },
    { indicateur: "Plaque", valeur: getPlaqueLabel(targetClient.plaque_id, plaquesById) },
    { indicateur: "Visites", valeur: clientVisits.length },
    { indicateur: "Visites vente", valeur: saleVisits.length },
    { indicateur: "CA HT", valeur: round2(totalCa) },
    { indicateur: "Derniere visite", valeur: lastVisit },
    {
      indicateur: "Top produit",
      valeur: topProduct
        ? `${topProduct.produit.reference_produit || "-"} - ${topProduct.produit.nom || "[produit introuvable]"}`
        : "-"
    }
  ].slice(0, plan.limit);

  return {
    columns: ["indicateur", "valeur"],
    rows,
    summary: `Synthese client sur ${period.label}.`,
    finalResult: `Client ${targetClient.nom || "-"}: CA HT ${formatNumberFr(totalCa)} EUR sur ${saleVisits.length} visite(s) vente.`,
    periodLabel: period.label
  };
}

function buildProductPerformance({ plan, period, normalizedFilters, clientsById, visites, commandes, produits, produitsById }) {
  const filteredVisits = filterVisits(visites, {
    clientsById,
    plaqueIdSet: normalizedFilters.plaqueIdSet,
    clientIdSet: normalizedFilters.clientIdSet,
    period,
    onlySales: true
  });

  const visitsById = indexBy(filteredVisits, visite => getVisitId(visite));
  const visitIds = new Set(filteredVisits.map(getVisitId).filter(Boolean));
  const targetProductIds = resolveProductIds(normalizedFilters, produits);

  const aggregate = new Map();
  const clientsByProduct = new Map();

  for (const ligne of commandes) {
    const visiteId = String(ligne?.visite_id || "");
    if (!visitIds.has(visiteId)) continue;

    const productId = String(ligne?.produit_id || "");
    if (!productId) continue;
    if (targetProductIds && !targetProductIds.has(productId)) continue;

    if (!aggregate.has(productId)) {
      aggregate.set(productId, { quantite_totale: 0, ca_ht: 0, nb_lignes: 0 });
      clientsByProduct.set(productId, new Set());
    }

    const row = aggregate.get(productId);
    const quantite = toNumber(ligne?.quantite);
    const prix = toNumber(ligne?.prix_unitaire);

    row.quantite_totale += quantite;
    row.ca_ht = round2(row.ca_ht + quantite * prix);
    row.nb_lignes += 1;

    const visite = visitsById.get(visiteId);
    if (visite) {
      clientsByProduct.get(productId).add(String(visite.client_id || ""));
    }
  }

  const rows = Array.from(aggregate.entries())
    .map(([productId, values]) => {
      const produit = produitsById.get(productId) || {};
      return {
        reference_produit: produit.reference_produit || "-",
        designation: produit.nom || "[produit introuvable]",
        quantite_totale: values.quantite_totale,
        ca_ht: round2(values.ca_ht),
        nb_clients: clientsByProduct.get(productId)?.size || 0,
        nb_lignes: values.nb_lignes
      };
    })
    .sort((a, b) => b.ca_ht - a.ca_ht)
    .slice(0, plan.limit);

  const totalCa = round2(rows.reduce((sum, row) => sum + toNumber(row.ca_ht), 0));

  return {
    columns: ["reference_produit", "designation", "quantite_totale", "ca_ht", "nb_clients", "nb_lignes"],
    rows,
    summary: targetProductIds
      ? `Performance produit ciblee sur ${period.label}.`
      : `Performance produits sur ${period.label}.`,
    finalResult: `CA HT cumule affiche: ${formatNumberFr(totalCa)} EUR.`,
    periodLabel: period.label
  };
}

function buildSalesByPeriod({ plan, period, normalizedFilters, clientsById, plaquesById, visites }) {
  const filteredVisits = filterVisits(visites, {
    clientsById,
    plaqueIdSet: normalizedFilters.plaqueIdSet,
    clientIdSet: normalizedFilters.clientIdSet,
    period,
    onlySales: true
  });

  const aggregate = new Map();
  for (const visite of filteredVisits) {
    const client = clientsById.get(String(visite?.client_id || "")) || {};
    const plaqueLabel = getPlaqueLabel(client?.plaque_id, plaquesById);

    if (!aggregate.has(plaqueLabel)) {
      aggregate.set(plaqueLabel, { ca_ht: 0, nb_visites: 0 });
    }

    const row = aggregate.get(plaqueLabel);
    row.ca_ht = round2(row.ca_ht + toNumber(visite?.total_commande));
    row.nb_visites += 1;
  }

  const rows = Array.from(aggregate.entries())
    .map(([plaque, values]) => ({
      plaque,
      nb_visites: values.nb_visites,
      ca_ht: round2(values.ca_ht),
      panier_moyen: values.nb_visites ? round2(values.ca_ht / values.nb_visites) : 0
    }))
    .sort((a, b) => b.ca_ht - a.ca_ht)
    .slice(0, plan.limit);

  const totalCa = round2(rows.reduce((sum, row) => sum + toNumber(row.ca_ht), 0));

  return {
    columns: ["plaque", "nb_visites", "ca_ht", "panier_moyen"],
    rows,
    summary: `Repartition des ventes par plaque sur ${period.label}.`,
    finalResult: `CA HT total affiche: ${formatNumberFr(totalCa)} EUR.`,
    periodLabel: period.label
  };
}

function buildComparePeriods({ plan, normalizedFilters, clientsById, visites }) {
  const filters = normalizedFilters;
  const periodA = resolvePeriodRange({ period: filters.period_a || filters.period || "this_month" });
  const periodB = resolvePeriodRange({ period: filters.period_b || previousPeriodToken(periodA.token) || "last_month" });

  const visitsA = filterVisits(visites, {
    clientsById,
    plaqueIdSet: filters.plaqueIdSet,
    clientIdSet: filters.clientIdSet,
    period: periodA,
    onlySales: true
  });

  const visitsB = filterVisits(visites, {
    clientsById,
    plaqueIdSet: filters.plaqueIdSet,
    clientIdSet: filters.clientIdSet,
    period: periodB,
    onlySales: true
  });

  const metricA = summarizeVisits(visitsA);
  const metricB = summarizeVisits(visitsB);

  const rows = [
    {
      periode: periodA.label,
      ca_ht: metricA.ca,
      nb_visites: metricA.nb_visites,
      panier_moyen: metricA.panier_moyen
    },
    {
      periode: periodB.label,
      ca_ht: metricB.ca,
      nb_visites: metricB.nb_visites,
      panier_moyen: metricB.panier_moyen
    },
    {
      periode: "Variation A-B",
      ca_ht: round2(metricA.ca - metricB.ca),
      nb_visites: metricA.nb_visites - metricB.nb_visites,
      panier_moyen: round2(metricA.panier_moyen - metricB.panier_moyen)
    }
  ].slice(0, plan.limit);

  const variationPct = metricB.ca > 0 ? round2(((metricA.ca - metricB.ca) / metricB.ca) * 100) : null;

  return {
    columns: ["periode", "ca_ht", "nb_visites", "panier_moyen"],
    rows,
    summary: `Comparaison ${periodA.label} vs ${periodB.label}.`,
    finalResult:
      variationPct == null
        ? "Periode B a un CA nul, pourcentage non calcule."
        : `Variation CA HT: ${formatNumberFr(variationPct)} %.`,
    periodLabel: `${periodA.label} vs ${periodB.label}`
  };
}

function summarizeVisits(visits) {
  const ca = round2(visits.reduce((sum, visite) => sum + toNumber(visite?.total_commande), 0));
  const nb_visites = visits.length;
  const panier_moyen = nb_visites ? round2(ca / nb_visites) : 0;
  return { ca, nb_visites, panier_moyen };
}

async function fetchAllRows(table, select, order = "") {
  const rows = [];
  let offset = 0;

  while (rows.length < MAX_FETCH_ROWS) {
    const chunkSize = Math.min(PAGE_SIZE, MAX_FETCH_ROWS - rows.length);
    if (chunkSize <= 0) break;

    const page = await fetchSupabaseRows({
      table,
      select,
      order,
      limit: chunkSize,
      offset
    });

    rows.push(...page);

    if (page.length < chunkSize) break;
    offset += chunkSize;
  }

  return rows;
}

async function fetchSupabaseRows({ table, select, order = "", limit = PAGE_SIZE, offset = 0 }) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (order) url.searchParams.set("order", order);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase error ${table} (${response.status}): ${text.slice(0, 220)}`);
  }

  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function indexBy(rows, getKey) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(getKey(row) || "");
    if (!key) continue;
    map.set(key, row);
  }
  return map;
}

function normalizeFilters(inputFilters, plaques = []) {
  const filters = inputFilters && typeof inputFilters === "object" ? { ...inputFilters } : {};
  const plaqueNames = collectStringValues([
    filters.plaque,
    filters.plaques,
    filters.entity,
    filters.entities
  ]);

  const canonicalPlaqueNames = new Set();
  for (const value of plaqueNames) {
    const normalized = normalizeLabel(value);
    const alias = PLAQUE_ALIAS_TO_CANONICAL.get(normalized);
    if (alias) {
      canonicalPlaqueNames.add(alias);
      continue;
    }

    const fromRealList = plaques.find(plaque => normalizeLabel(plaque?.nom) === normalized);
    if (fromRealList?.nom) {
      canonicalPlaqueNames.add(fromRealList.nom);
    }
  }

  let plaqueIdSet = null;
  if (canonicalPlaqueNames.size) {
    plaqueIdSet = new Set(
      plaques
        .filter(plaque => canonicalPlaqueNames.has(String(plaque?.nom || "")))
        .map(plaque => String(plaque?.id || ""))
        .filter(Boolean)
    );
  }

  return {
    ...filters,
    plaqueIdSet,
    clientIdSet: resolveClientIdSet(filters),
    granularity: String(filters.granularity || "").toLowerCase().trim(),
    inactive_since: filters.inactive_since || null,
    period: filters.period || null,
    period_a: filters.period_a || null,
    period_b: filters.period_b || null
  };
}

function resolveClientIdSet(filters) {
  const ids = collectStringValues([filters.client_id, filters.client_ids]);
  if (!ids.length) return null;
  return new Set(ids.map(value => String(value).trim()).filter(Boolean));
}

function resolveClientIdsFromText(clients, filters) {
  const terms = collectStringValues([
    filters.client,
    filters.client_name,
    filters.nom_client,
    filters.numero_compte,
    filters.account
  ]);

  if (!terms.length) return null;

  const normalizedTerms = terms.map(normalizeLabel).filter(Boolean);
  if (!normalizedTerms.length) return null;

  const matches = clients
    .filter(client => {
      const values = [client?.nom, client?.numero_compte, client?.id].map(normalizeLabel).filter(Boolean);
      return normalizedTerms.some(term => values.some(value => value.includes(term)));
    })
    .map(client => String(client?.id || ""))
    .filter(Boolean);

  if (!matches.length) return null;
  return new Set(matches);
}

function resolveEligibleClientIds(clients, normalizedFilters) {
  const byId = normalizedFilters.clientIdSet;
  const plaqueSet = normalizedFilters.plaqueIdSet;

  if (!byId && !plaqueSet) return null;

  const set = new Set();
  for (const client of clients) {
    const clientId = String(client?.id || "");
    if (!clientId) continue;

    if (byId && !byId.has(clientId)) continue;
    if (plaqueSet && !plaqueSet.has(String(client?.plaque_id || ""))) continue;

    set.add(clientId);
  }
  return set;
}

function resolveSingleClient(clients, normalizedFilters) {
  if (!Array.isArray(clients) || !clients.length) return null;

  if (normalizedFilters.clientIdSet && normalizedFilters.clientIdSet.size === 1) {
    const [clientId] = normalizedFilters.clientIdSet;
    return clients.find(client => String(client?.id || "") === clientId) || null;
  }

  const terms = collectStringValues([
    normalizedFilters.client,
    normalizedFilters.client_name,
    normalizedFilters.nom_client,
    normalizedFilters.numero_compte,
    normalizedFilters.account
  ]);

  if (!terms.length) return null;

  const normalizedTerms = terms.map(normalizeLabel).filter(Boolean);
  if (!normalizedTerms.length) return null;

  const matches = clients.filter(client => {
    const candidateValues = [client?.nom, client?.numero_compte, client?.id]
      .map(value => normalizeLabel(value))
      .filter(Boolean);

    return normalizedTerms.some(term => candidateValues.some(candidate => candidate.includes(term)));
  });

  if (matches.length === 1) return matches[0];

  const exact = matches.find(client => {
    const nom = normalizeLabel(client?.nom);
    const compte = normalizeLabel(client?.numero_compte);
    return normalizedTerms.some(term => term === nom || term === compte);
  });

  return exact || null;
}

function resolveProductIds(filters, produits) {
  const terms = collectStringValues([
    filters.product,
    filters.product_name,
    filters.product_ref,
    filters.reference,
    filters.ref
  ]);

  if (!terms.length) return null;

  const normalizedTerms = terms.map(normalizeLabel).filter(Boolean);
  if (!normalizedTerms.length) return null;

  const matchingIds = produits
    .filter(produit => {
      const ref = normalizeLabel(produit?.reference_produit);
      const nom = normalizeLabel(produit?.nom);
      return normalizedTerms.some(term => ref.includes(term) || nom.includes(term));
    })
    .map(produit => String(produit?.id || ""))
    .filter(Boolean);

  if (!matchingIds.length) return null;
  return new Set(matchingIds);
}

function collectStringValues(values) {
  const result = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item == null) continue;
        const str = String(item).trim();
        if (str) result.push(str);
      }
      continue;
    }

    if (value == null) continue;
    const strValue = String(value).trim();
    if (!strValue) continue;

    if (strValue.includes(",")) {
      strValue
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(part => result.push(part));
    } else {
      result.push(strValue);
    }
  }

  return result;
}

function filterVisits(visites, { clientsById, plaqueIdSet = null, clientIdSet = null, period = null, onlySales = false }) {
  return (visites || []).filter(visite => {
    const clientId = String(visite?.client_id || "");
    if (!clientId) return false;

    if (clientIdSet && !clientIdSet.has(clientId)) return false;

    const client = clientsById.get(clientId);
    if (plaqueIdSet && !plaqueIdSet.has(String(client?.plaque_id || ""))) return false;

    const visitDate = normalizeDate(visite?.date_visite);
    if (period && !isDateInside(visitDate, period.start, period.end)) return false;

    if (onlySales && !isSaleVisit(visite)) return false;

    return true;
  });
}

function getVisitId(visite) {
  return String(visite?.id || visite?.visite_id || "");
}

function getPlaqueLabel(plaqueId, plaquesById) {
  const plaque = plaquesById.get(String(plaqueId || ""));
  return String(plaque?.nom || "-");
}

function isSaleVisit(visite) {
  const type = String(visite?.type_visite || "").trim().toLowerCase();
  const total = toNumber(visite?.total_commande);
  return total > 0 || type === "vente";
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeDate(value) {
  if (!value) return "";
  const str = String(value).trim();
  if (!str) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return str.slice(0, 10);
}

function isDateInside(dateValue, start, end) {
  if (!dateValue) return false;
  if (start && dateValue < start) return false;
  if (end && dateValue > end) return false;
  return true;
}

function normalizeGranularity(raw, periodToken) {
  if (["day", "week", "month"].includes(raw)) return raw;
  if (periodToken === "this_year" || periodToken === "last_year") return "month";
  if (periodToken === "this_month" || periodToken === "last_month") return "day";
  return "week";
}

function buildTimeBucket(dateIso, granularity) {
  if (!dateIso) return "";
  if (granularity === "day") return dateIso;

  const date = fromIsoDate(dateIso);
  if (!date) return "";

  if (granularity === "month") {
    return `${dateIso.slice(0, 7)}`;
  }

  const week = isoWeek(date);
  return `${week.year}-W${String(week.week).padStart(2, "0")}`;
}

function resolvePeriodRange(filters = {}) {
  const startDate = normalizeDate(filters.start_date || filters.date_start || "");
  const endDate = normalizeDate(filters.end_date || filters.date_end || "");

  if (startDate || endDate) {
    return {
      token: "custom",
      start: startDate || null,
      end: endDate || null,
      label: `du ${startDate || "debut"} au ${endDate || "fin"}`
    };
  }

  const token = String(filters.period || "this_month").toLowerCase().trim();
  const today = getTodayDateParis();

  switch (token) {
    case "today": {
      const d = toIsoDate(today);
      return { token, start: d, end: d, label: "aujourd'hui" };
    }
    case "yesterday": {
      const y = addDays(today, -1);
      const d = toIsoDate(y);
      return { token, start: d, end: d, label: "hier" };
    }
    case "this_week": {
      const start = startOfWeekMonday(today);
      const end = addDays(start, 6);
      return { token, start: toIsoDate(start), end: toIsoDate(end), label: "cette semaine" };
    }
    case "last_week": {
      const currentStart = startOfWeekMonday(today);
      const start = addDays(currentStart, -7);
      const end = addDays(start, 6);
      return { token, start: toIsoDate(start), end: toIsoDate(end), label: "semaine derniere" };
    }
    case "this_year": {
      const year = today.getUTCFullYear();
      return { token, start: `${year}-01-01`, end: `${year}-12-31`, label: `annee ${year}` };
    }
    case "last_year": {
      const year = today.getUTCFullYear() - 1;
      return { token, start: `${year}-01-01`, end: `${year}-12-31`, label: `annee ${year}` };
    }
    case "last_month": {
      const shifted = shiftMonths(today, -1);
      const start = startOfMonth(shifted);
      const end = endOfMonth(shifted);
      return { token, start: toIsoDate(start), end: toIsoDate(end), label: `mois ${start.toISOString().slice(0, 7)}` };
    }
    case "this_month":
    default: {
      const start = startOfMonth(today);
      const end = endOfMonth(today);
      return { token: "this_month", start: toIsoDate(start), end: toIsoDate(end), label: `mois ${start.toISOString().slice(0, 7)}` };
    }
  }
}

function previousPeriodToken(periodToken) {
  switch (periodToken) {
    case "this_month":
      return "last_month";
    case "this_week":
      return "last_week";
    case "this_year":
      return "last_year";
    default:
      return "last_month";
  }
}

function extractInactiveMonths(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.floor(raw));
  }

  const text = String(raw || "2_months").toLowerCase().trim();
  const directMatch = text.match(/(\d+)/);
  if (directMatch) {
    return Math.max(1, Number(directMatch[1]));
  }

  return 2;
}

function daysBetween(startIso, endIso) {
  const start = fromIsoDate(startIso);
  const end = fromIsoDate(endIso);
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function formatNumberFr(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTodayDateParis() {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return fromIsoDate(formatted) || new Date();
}

function getParisDayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeekMonday(date) {
  const clone = new Date(date.getTime());
  const day = clone.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(clone, diff);
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function shiftMonths(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function fromIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target - firstThursday;
  const week = 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
  return { year: target.getUTCFullYear(), week };
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(";").map(item => item.trim());
  const prefix = `${name}=`;
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return "";
}

async function isValidSession(value, accessCode, expectedDayKey) {
  if (!value || !accessCode || !expectedDayKey) return false;

  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return false;

  const dayKey = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);
  if (!dayKey || !signature || dayKey !== expectedDayKey) return false;

  const expected = signValue(dayKey, accessCode);
  return safeEqual(signature, expected);
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return crypto.timingSafeEqual(left, right);
}
