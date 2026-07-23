import {
  ROLE_LABELS,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const PAGE_SIZE = 1000;
const VISIT_TYPE_PHONE_ORDER = "commande_telephone";
const PHONE_ORDER_NOTE_MARKER = "[COMMANDE_TELEPHONE]";

const USER_SELECT = [
  "id",
  "identifier",
  "display_name",
  "role",
  "active",
  "hidden"
].join(",");

const RELATION_SELECT = [
  "id",
  "responsable_user_id",
  "commercial_user_id",
  "relation_type",
  "active"
].join(",");

const SOURCES = [
  {
    key: "auto",
    label: "Auto",
    tables: {
      clients: "clients",
      produits: "produits",
      visites: "visites",
      lignes: "visite_commandes"
    }
  },
  {
    key: "industrie",
    label: "Industrie",
    tables: {
      clients: "industrie_clients",
      produits: "industrie_produits",
      visites: "industrie_visites",
      lignes: "industrie_visite_commandes"
    }
  }
];

export default async function handler(request, response) {
  const guard = requireRole(request, ["admin", "responsable"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const [users, relations] = await Promise.all([listUsers(), listRelations()]);
    const commercialScope = resolveCommercialScope(guard.session, users, relations);
    const commercialIds = commercialScope.map((item) => item.id).filter(Boolean);

    if (!commercialIds.length) {
      sendJson(response, 200, {
        scope: buildScopePayload(guard.session, commercialScope),
        rows: [],
        warnings: []
      });
      return;
    }

    const warnings = [];
    const sourceRows = await Promise.all(
      SOURCES.map((source) =>
        loadSourceRows(source, commercialScope, commercialIds).catch((error) => {
          warnings.push({ source: source.label, message: error.message || "Chargement impossible." });
          return [];
        })
      )
    );

    sendJson(response, 200, {
      scope: buildScopePayload(guard.session, commercialScope),
      rows: sourceRows.flat(),
      warnings
    });
  } catch (error) {
    sendJson(response, Number(error.status || 500), {
      error: error.message || "Requete commerce equipe indisponible."
    });
  }
}

async function listUsers() {
  return supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&order=display_name.asc`
  );
}

async function listRelations() {
  return supabaseAdminFetch(
    `/rest/v1/portal_user_relations?select=${encodeURIComponent(RELATION_SELECT)}&active=eq.true&order=created_at.asc`
  );
}

function resolveCommercialScope(session, users, relations) {
  const activeUsers = (users || []).filter((user) => user.active && !user.hidden);
  if (session.role === "admin") {
    return activeUsers
      .filter((user) => user.role === "commercial")
      .map((user) => commercialSummary(user, "Tous vendeurs"));
  }

  const currentUser = resolveCurrentPortalUser(session, users);
  if (!currentUser) return [];

  return (relations || [])
    .filter((relation) => relation.responsable_user_id === currentUser.id && relation.active)
    .map((relation) => {
      const commercial = activeUsers.find((user) => user.id === relation.commercial_user_id);
      if (!commercial || commercial.role !== "commercial") return null;
      return commercialSummary(
        commercial,
        relation.relation_type === "exceptionnel" ? "Acces exceptionnel" : "Responsable principal"
      );
    })
    .filter(Boolean);
}

function commercialSummary(user, scopeLabel) {
  return {
    id: normalizeText(user.id),
    identifier: normalizeText(user.identifier),
    displayName: normalizeText(user.display_name) || normalizeText(user.identifier) || "Commercial",
    roleLabel: ROLE_LABELS[user.role] || "Commercial",
    scopeLabel
  };
}

function buildScopePayload(session, commercials) {
  return {
    role: session.role,
    roleLabel: ROLE_LABELS[session.role] || session.role,
    commercialCount: commercials.length,
    commercials
  };
}

function resolveCurrentPortalUser(session, users) {
  const dbUserId = normalizeText(session.dbUserId);
  if (dbUserId) {
    const byId = (users || []).find((user) => user.id === dbUserId);
    if (byId) return byId;
  }

  const identifier = normalizeText(session.userId).toLowerCase();
  return (users || []).find((user) => normalizeText(user.identifier).toLowerCase() === identifier) || null;
}

async function loadSourceRows(source, commercialScope, commercialIds) {
  const allowedCommercialIds = new Set(commercialIds.map(String));
  const commercialById = new Map(commercialScope.map((item) => [String(item.id), item]));
  const ownedClients = await fetchByCommercialChunks(
    source.tables.clients,
    "id,nom,numero_compte,commercial_user_id",
    commercialIds,
    { order: "nom.asc" }
  );
  const ownedClientIds = unique(ownedClients.map((client) => client.id).filter(Boolean));

  const [visitsByCommercial, visitsByClient] = await Promise.all([
    fetchByCommercialChunks(
      source.tables.visites,
      "id,client_id,date_visite,note,type_visite,total_commande,commercial_user_id",
      commercialIds,
      { order: "date_visite.desc,id.asc" }
    ),
    ownedClientIds.length
      ? fetchByChunks(
          source.tables.visites,
          "id,client_id,date_visite,note,type_visite,total_commande,commercial_user_id",
          "client_id",
          ownedClientIds,
          { order: "date_visite.desc,id.asc" }
        )
      : Promise.resolve([])
  ]);

  const visits = mergeRowsById([...visitsByCommercial, ...visitsByClient]);
  if (!visits.length) return [];

  const visitIds = visits.map((visit) => visit.id).filter(Boolean);
  const clientIds = unique([
    ...ownedClientIds,
    ...visits.map((visit) => visit.client_id).filter(Boolean)
  ]);

  const [lines, clients] = await Promise.all([
    fetchByChunks(
      source.tables.lignes,
      "id,visite_id,produit_id,quantite,prix_unitaire",
      "visite_id",
      visitIds,
      { order: "visite_id.asc,id.asc" }
    ),
    fetchByChunks(
      source.tables.clients,
      "id,nom,numero_compte,commercial_user_id",
      "id",
      clientIds
    )
  ]);

  const productIds = unique(lines.map((line) => line.produit_id).filter(Boolean));
  const products = await fetchByChunks(
    source.tables.produits,
    "id,nom,reference_produit",
    "id",
    productIds
  );

  const clientsById = new Map([...ownedClients, ...clients].map((client) => [String(client.id), client]));
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const visitsById = new Map();

  visits.forEach((visit) => {
    const client = clientsById.get(String(visit.client_id));
    const ownerId = normalizeText(visit.commercial_user_id) || normalizeText(client?.commercial_user_id);
    if (!ownerId || !allowedCommercialIds.has(ownerId)) return;
    visitsById.set(String(visit.id), {
      ...visit,
      ownerId,
      client
    });
  });

  const rows = [];
  for (const line of lines) {
    const visit = visitsById.get(String(line.visite_id));
    if (!visit || !isOrderVisit(visit)) continue;
    const product = productsById.get(String(line.produit_id));
    const date = normalizeText(visit.date_visite).slice(0, 10);
    if (!date) continue;
    const [year, month] = date.split("-");
    const quantity = toNumber(line.quantite);
    const unitPrice = toNumber(line.prix_unitaire);
    const commercial = commercialById.get(String(visit.ownerId));

    rows.push({
      commercial: commercial?.displayName || "Commercial",
      commercialIdentifier: commercial?.identifier || "",
      activity: source.label,
      year: year || "",
      month: String(Number(month || 0) || ""),
      date,
      type: getVisitTypeLabel(resolveVisitTypeFromRecord(visit)),
      clientNumber: visit.client?.numero_compte || "-",
      client: visit.client?.nom || "Client inconnu",
      reference: product?.reference_produit || "-",
      designation: product?.nom || "Produit archive",
      quantity,
      revenue: roundMoney(quantity * unitPrice)
    });
  }

  return rows;
}

async function fetchByCommercialChunks(table, select, commercialIds, params = {}) {
  const chunks = chunkArray(unique(commercialIds), 35);
  const results = [];
  for (const chunk of chunks) {
    const rows = await fetchPaged(table, select, {
      ...params,
      commercial_user_id: inFilter(chunk)
    });
    results.push(...rows);
  }
  return results;
}

async function fetchByChunks(table, select, column, values, params = {}) {
  const uniqueValues = unique(values).filter(Boolean);
  if (!uniqueValues.length) return [];
  const chunks = chunkArray(uniqueValues, 100);
  const results = [];
  for (const chunk of chunks) {
    const rows = await fetchPaged(table, select, {
      ...params,
      [column]: inFilter(chunk)
    });
    results.push(...rows);
  }
  return results;
}

async function fetchPaged(table, select, params = {}) {
  const rows = [];
  let offset = 0;
  while (true) {
    const page = await supabaseAdminFetch(buildRestPath(table, select, {
      ...params,
      limit: PAGE_SIZE,
      offset
    }));
    const safePage = Array.isArray(page) ? page : [];
    rows.push(...safePage);
    if (safePage.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

function buildRestPath(table, select, params = {}) {
  const search = new URLSearchParams();
  search.set("select", select);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.append(key, String(value));
  });
  return `/rest/v1/${table}?${search.toString()}`;
}

function inFilter(values) {
  return `in.(${values.map((value) => String(value).trim()).filter(Boolean).join(",")})`;
}

function normalizeVisitType(value) {
  const normalized = normalizeText(value).toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["commande_telephone", "commande_tel", "appel_telephonique", "telephone", "tel"].includes(normalized)) return VISIT_TYPE_PHONE_ORDER;
  if (["vente", "visite", "terrain", "commande"].includes(normalized)) return "vente";
  if (["passage_sans_vente", "sans_vente"].includes(normalized)) return "passage_sans_vente";
  if (["client_ferme", "ferme"].includes(normalized)) return "client_ferme";
  return normalized || "vente";
}

function resolveVisitTypeFromRecord(visit) {
  const type = normalizeVisitType(visit?.type_visite);
  if (type === "vente" && normalizeText(visit?.note).includes(PHONE_ORDER_NOTE_MARKER)) return VISIT_TYPE_PHONE_ORDER;
  return type;
}

function getVisitTypeLabel(type) {
  if (type === VISIT_TYPE_PHONE_ORDER) return "Commande telephone";
  if (type === "vente") return "Vente terrain";
  if (type === "passage_sans_vente") return "Passage sans vente";
  if (type === "client_ferme") return "Client ferme";
  return type || "Vente";
}

function isOrderVisit(visit) {
  const type = resolveVisitTypeFromRecord(visit);
  return type === "vente" || type === VISIT_TYPE_PHONE_ORDER || toNumber(visit?.total_commande) > 0;
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
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
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
