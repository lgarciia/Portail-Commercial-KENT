import {
  ROLE_LABELS,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TARGETS_PER_CAMPAIGN = 2000;

export default async function handler(request, response) {
  const guard = requireRole(request, ["commercial", "responsable"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadCampaigns(request, guard.session));
      return;
    }

    if (request.method === "POST") {
      if (guard.session.role !== "commercial") {
        throw forbidden("Seul un commercial peut historiser une campagne promo.");
      }
      sendJson(response, 200, await createCampaign(request, guard.session));
      return;
    }

    if (request.method === "DELETE") {
      if (guard.session.role !== "commercial") {
        throw forbidden("Seul le commercial proprietaire peut supprimer sa campagne.");
      }
      const body = await readBody(request);
      sendJson(response, 200, await deleteCampaign(body, guard.session));
      return;
    }

    response.setHeader("Allow", "GET, POST, DELETE");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyCampaignError(error)
    });
  }
}

async function loadCampaigns(request, session) {
  const scope = await resolveScope(session);
  const url = new URL(request.url, "http://localhost");
  const year = normalizeYear(url.searchParams.get("year"));
  const requestedCommercialId = normalizeUuid(url.searchParams.get("commercialId"));
  let commercialIds = scope.commercials.map((commercial) => commercial.id).filter(Boolean);

  if (requestedCommercialId) {
    if (!commercialIds.includes(requestedCommercialId)) {
      throw forbidden("Commercial hors perimetre.");
    }
    commercialIds = [requestedCommercialId];
  }

  if (!commercialIds.length) {
    return {
      ready: true,
      year,
      scope,
      campaigns: [],
      clientsByCampaign: {}
    };
  }

  let path = `/rest/v1/action_promo_campagnes?select=${encodeURIComponent(CAMPAIGN_SELECT)}`;
  path += `&commercial_user_id=${encodeURIComponent(inFilter(commercialIds))}`;
  if (year) {
    path += `&sent_at=gte.${encodeURIComponent(`${year}-01-01T00:00:00.000Z`)}`;
    path += `&sent_at=lt.${encodeURIComponent(`${year + 1}-01-01T00:00:00.000Z`)}`;
  }
  path += "&order=sent_at.desc,created_at.desc";

  const rawCampaigns = await safeArrayFetch(path);
  const campaignIds = rawCampaigns.map((campaign) => campaign.id).filter(Boolean);
  const rawClients = campaignIds.length
    ? await safeArrayFetch(
        `/rest/v1/action_promo_campagne_clients?select=${encodeURIComponent(CAMPAIGN_CLIENT_SELECT)}&campagne_id=${encodeURIComponent(inFilter(campaignIds))}&order=client_nom.asc`
      )
    : [];

  const clientsByCampaign = {};
  rawClients.forEach((row) => {
    const key = normalizeText(row.campagne_id);
    if (!clientsByCampaign[key]) clientsByCampaign[key] = [];
    clientsByCampaign[key].push(normalizeCampaignClient(row));
  });

  const commercialById = new Map(scope.commercials.map((commercial) => [commercial.id, commercial]));
  const campaigns = rawCampaigns.map((campaign) => normalizeCampaign(campaign, commercialById));

  return {
    ready: true,
    year,
    scope,
    campaigns,
    clientsByCampaign,
    stats: {
      total: campaigns.length,
      clients: rawClients.length,
      caCible: roundMoney(campaigns.reduce((sum, campaign) => sum + campaign.totalCaCible, 0))
    }
  };
}

async function createCampaign(request, session) {
  const commercialId = normalizeUuid(session.dbUserId);
  if (!commercialId) {
    throw forbidden("Compte commercial non rattache a portal_users. Reconnecte-toi avec un utilisateur commercial valide.");
  }

  const body = await readBody(request);
  const targets = Array.isArray(body?.targets) ? body.targets : [];
  if (!targets.length) throw badRequest("Aucun client cible a historiser.");
  if (targets.length > MAX_TARGETS_PER_CAMPAIGN) {
    throw badRequest(`Trop de clients cibles en une seule campagne (${MAX_TARGETS_PER_CAMPAIGN} maximum).`);
  }

  const productQuery = normalizeText(body?.productQuery);
  if (!productQuery) throw badRequest("Produit ou reference promo obligatoire.");

  const campaignRecord = {
    commercial_user_id: commercialId,
    produit_recherche: productQuery,
    source_mode: normalizeChoice(body?.sourceMode, ["validated", "sales", "both"], "validated"),
    activity_scope: normalizeChoice(body?.activityScope, ["all", "auto", "industrie"], "all"),
    plaque_filter_key: normalizeText(body?.plaqueFilterKey) || "all",
    plaque_filter_label: normalizeText(body?.plaqueFilterLabel) || "Toutes les plaques",
    period_value: normalizeText(body?.periodValue) || "12",
    min_ca: toMoney(body?.minCa),
    nb_clients: targets.length,
    total_ca_cible: roundMoney(targets.reduce((sum, target) => sum + toMoney(target?.revenue), 0)),
    statut: "envoyee",
    sent_at: new Date().toISOString()
  };

  const inserted = await supabaseAdminFetch(
    `/rest/v1/action_promo_campagnes?select=${encodeURIComponent(CAMPAIGN_SELECT)}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(campaignRecord)
    }
  );
  const campaign = Array.isArray(inserted) ? inserted[0] : null;
  if (!campaign?.id) throw new Error("Campagne creee sans identifiant.");

  const clientRows = targets.map((target) => ({
    campagne_id: campaign.id,
    commercial_user_id: commercialId,
    client_id: normalizeUuid(target?.clientId) || null,
    secteur: normalizeChoice(target?.sector, ["auto", "industrie"], inferSector(target?.activity)),
    client_nom: normalizeText(target?.client) || "Client sans nom",
    numero_compte: nullableText(target?.account),
    plaque_id: normalizeUuid(target?.plaqueId) || null,
    plaque_nom: nullableText(target?.plaqueLabel),
    email: nullableText(target?.email),
    ca_cible: toMoney(target?.revenue),
    quantite: toMoney(target?.qty),
    dernier_achat: normalizeDate(target?.lastRaw),
    statut_email: nullableText(target?.status)
  }));

  await supabaseAdminFetch("/rest/v1/action_promo_campagne_clients", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(clientRows)
  });

  return {
    ok: true,
    campaign: normalizeCampaign(campaign, new Map()),
    clientCount: clientRows.length
  };
}

async function deleteCampaign(body, session) {
  const commercialId = normalizeUuid(session.dbUserId);
  const campaignId = normalizeUuid(body?.campaignId || body?.id);
  if (!commercialId) throw forbidden("Compte commercial invalide.");
  if (!campaignId) throw badRequest("Campagne introuvable.");

  const existing = await safeArrayFetch(
    `/rest/v1/action_promo_campagnes?select=id,commercial_user_id&id=eq.${encodeURIComponent(campaignId)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}&limit=1`
  );
  if (!existing.length) {
    throw forbidden("Campagne introuvable ou non autorisee.");
  }

  await supabaseAdminFetch(
    `/rest/v1/action_promo_campagnes?id=eq.${encodeURIComponent(campaignId)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    }
  );

  return { ok: true, deletedId: campaignId };
}

async function resolveScope(session) {
  const [users, relations] = await Promise.all([listUsers(), listRelations()]);
  const activeUsers = users.filter((user) => user.active && !user.hidden);

  if (session.role === "commercial") {
    const current = resolveCurrentPortalUser(session, users);
    if (!current || current.role !== "commercial" || !current.active || current.hidden) {
      throw forbidden("Commercial introuvable ou masque.");
    }
    return {
      role: session.role,
      roleLabel: ROLE_LABELS[session.role] || "Commercial",
      commercials: [commercialSummary(current, "Personnel")]
    };
  }

  const current = resolveCurrentPortalUser(session, users);
  if (!current) {
    return {
      role: session.role,
      roleLabel: ROLE_LABELS[session.role] || "Responsable",
      commercials: []
    };
  }

  const commercials = relations
    .filter((relation) => relation.active && relation.responsable_user_id === current.id)
    .map((relation) => {
      const commercial = activeUsers.find((user) => user.id === relation.commercial_user_id);
      if (!commercial || commercial.role !== "commercial") return null;
      return commercialSummary(
        commercial,
        relation.relation_type === "exceptionnel" ? "Acces exceptionnel" : "Responsable principal"
      );
    })
    .filter(Boolean);

  return {
    role: session.role,
    roleLabel: ROLE_LABELS[session.role] || "Responsable",
    commercials
  };
}

async function listUsers() {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&order=display_name.asc`
  );
  return Array.isArray(data) ? data : [];
}

async function listRelations() {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_user_relations?select=${encodeURIComponent(RELATION_SELECT)}&active=eq.true&order=created_at.asc`
  );
  return Array.isArray(data) ? data : [];
}

function resolveCurrentPortalUser(session, users) {
  const dbUserId = normalizeUuid(session.dbUserId);
  if (dbUserId) {
    const byId = users.find((user) => user.id === dbUserId);
    if (byId) return byId;
  }

  const identifier = normalizeText(session.userId).toLowerCase();
  if (!identifier) return null;
  return users.find((user) => normalizeText(user.identifier).toLowerCase() === identifier) || null;
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

function normalizeCampaign(row, commercialById) {
  const commercial = commercialById.get(normalizeText(row.commercial_user_id)) || null;
  return {
    id: normalizeText(row.id),
    commercialUserId: normalizeText(row.commercial_user_id),
    commercialName: commercial?.displayName || "",
    commercialIdentifier: commercial?.identifier || "",
    productQuery: normalizeText(row.produit_recherche),
    sourceMode: normalizeText(row.source_mode),
    activityScope: normalizeText(row.activity_scope),
    plaqueFilterKey: normalizeText(row.plaque_filter_key) || "all",
    plaqueFilterLabel: normalizeText(row.plaque_filter_label) || "Toutes les plaques",
    periodValue: normalizeText(row.period_value) || "12",
    minCa: toMoney(row.min_ca),
    clientCount: Number(row.nb_clients || 0),
    totalCaCible: toMoney(row.total_ca_cible),
    status: normalizeText(row.statut) || "envoyee",
    sentAt: normalizeText(row.sent_at),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at)
  };
}

function normalizeCampaignClient(row) {
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
    revenue: toMoney(row.ca_cible),
    qty: toMoney(row.quantite),
    lastPurchase: normalizeText(row.dernier_achat),
    emailStatus: normalizeText(row.statut_email)
  };
}

async function safeArrayFetch(path) {
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

function normalizeYear(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return new Date().getFullYear();
  return Math.min(2100, Math.max(2020, Math.trunc(number)));
}

function normalizeChoice(value, allowed, fallback) {
  const text = normalizeText(value).toLowerCase();
  return allowed.includes(text) ? text : fallback;
}

function inferSector(activity) {
  return normalizeText(activity).toLowerCase().includes("industrie") ? "industrie" : "auto";
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function normalizeDate(value) {
  const text = normalizeText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function toMoney(value) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function roundMoney(value) {
  return toMoney(value);
}

function inFilter(values) {
  return `in.(${values.map((value) => String(value).trim()).filter(Boolean).join(",")})`;
}

function friendlyCampaignError(error) {
  const message = error?.message || "Campagnes promo indisponibles.";
  const lower = message.toLowerCase();
  if (
    lower.includes("action_promo_campagnes") ||
    lower.includes("action_promo_campagne_clients") ||
    lower.includes("does not exist") ||
    lower.includes("42p01")
  ) {
    return "Campagnes promo Supabase non pretes : lance le SQL supabase_action_promo_campagnes.sql dans Supabase.";
  }
  return message;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function readBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === "string") {
    try {
      return request.body ? JSON.parse(request.body) : {};
    } catch {
      throw badRequest("JSON invalide.");
    }
  }

  if (!request[Symbol.asyncIterator]) return {};

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("JSON invalide.");
  }
}
