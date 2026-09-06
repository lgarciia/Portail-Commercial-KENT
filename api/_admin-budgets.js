import { normalizeText, requireRole, sendJson, supabaseAdminFetch } from "./_auth.js";

const BUDGET_SELECT = [
  "id",
  "projection_id",
  "entite_id",
  "nom",
  "annee",
  "statut",
  "total_annuel",
  "nb_lignes",
  "meta",
  "validated_at",
  "validation_admin",
  "validation_admin_at",
  "validation_admin_by",
  "validation_admin_note",
  "commercial_user_id",
  "commercial_identifier",
  "commercial_name",
  "created_at",
  "updated_at"
].join(",");

const USER_SELECT = [
  "id",
  "identifier",
  "display_name",
  "role",
  "active",
  "hidden"
].join(",");

const ENTITY_SELECT = [
  "id",
  "key",
  "libelle",
  "actif",
  "commercial_user_id"
].join(",");

export default async function handler(request, response) {
  const guard = requireRole(request, ["admin"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadBudgets(request));
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      await handleAction(body, guard.session);
      sendJson(response, 200, { ok: true, ...(await loadBudgets(request)) });
      return;
    }

    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyBudgetError(error)
    });
  }
}

async function loadBudgets(request) {
  const url = requestUrl(request);
  const year = normalizeYear(url.searchParams.get("year"));
  const [users, rawBudgets] = await Promise.all([
    listCommercialUsers(),
    listBudgets(year)
  ]);
  const entityMap = await loadEntityMap(rawBudgets);
  const commercialMap = new Map(users.map((user) => [user.id, user]));
  const extraCommercials = [];

  for (const budget of rawBudgets) {
    const commercialId = normalizeText(budget.commercial_user_id);
    if (!commercialId || commercialMap.has(commercialId)) continue;
    const fallback = {
      id: commercialId,
      identifier: normalizeText(budget.commercial_identifier) || "commercial-inconnu",
      displayName: normalizeText(budget.commercial_name) || "Commercial masque",
      role: "commercial",
      active: false,
      hidden: true
    };
    commercialMap.set(commercialId, fallback);
    extraCommercials.push(fallback);
  }

  const budgets = rawBudgets.map((budget) => safeBudget(budget, entityMap, commercialMap));
  const commercials = [...users, ...extraCommercials].map(safeCommercial);

  return {
    ready: true,
    year: year || "",
    commercials,
    budgets,
    stats: budgetStats(budgets, commercials)
  };
}

async function handleAction(body, session) {
  const action = normalizeText(body?.action);
  const budgetId = normalizeUuid(body?.budgetId || body?.id);
  if (!budgetId) throw badRequest("Budget introuvable.");

  const budget = await getBudgetById(budgetId);
  if (!budget) throw badRequest("Budget introuvable.");

  if (action === "validateBudget") {
    if (budget.statut !== "active") {
      throw badRequest("Ce budget est inactif. Le commercial doit d'abord l'activer avant validation admin.");
    }
    await setAdminValidation(budgetId, "valide", body, session);
    return;
  }

  if (action === "devalidateBudget") {
    await setAdminValidation(budgetId, "devalide", body, session);
    return;
  }

  throw badRequest("Action budget inconnue.");
}

async function listCommercialUsers() {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&role=eq.commercial&order=display_name.asc`
  );
  return Array.isArray(data) ? data : [];
}

async function listBudgets(year) {
  let path = `/rest/v1/budgets?select=${encodeURIComponent(BUDGET_SELECT)}&order=commercial_name.asc,annee.desc,created_at.desc`;
  if (year) path += `&annee=eq.${encodeURIComponent(year)}`;
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

async function getBudgetById(id) {
  const data = await supabaseAdminFetch(
    `/rest/v1/budgets?select=${encodeURIComponent(BUDGET_SELECT)}&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function loadEntityMap(budgets) {
  const ids = unique((budgets || []).map((budget) => budget.entite_id).filter(Boolean));
  if (!ids.length) return new Map();
  const data = await supabaseAdminFetch(
    `/rest/v1/budget_entites?select=${encodeURIComponent(ENTITY_SELECT)}&id=in.(${ids.map(encodeURIComponent).join(",")})`
  );
  return new Map((Array.isArray(data) ? data : []).map((entity) => [String(entity.id), entity]));
}

async function setAdminValidation(id, status, body, session) {
  const adminLabel = [
    normalizeText(session?.name) || normalizeText(session?.userId) || "Admin",
    normalizeText(session?.userId) ? `(${normalizeText(session.userId)})` : ""
  ].filter(Boolean).join(" ");

  await supabaseAdminFetch(`/rest/v1/budgets?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      validation_admin: status,
      validation_admin_at: new Date().toISOString(),
      validation_admin_by: adminLabel,
      validation_admin_note: normalizeText(body?.note) || null
    })
  });
}

function safeBudget(budget, entityMap, commercialMap) {
  const commercialId = normalizeText(budget.commercial_user_id);
  const commercial = commercialMap.get(commercialId) || null;
  const entity = entityMap.get(String(budget.entite_id)) || null;
  const validationAdmin = normalizeValidation(budget.validation_admin);
  return {
    id: budget.id,
    projectionId: budget.projection_id || "",
    entityId: budget.entite_id || "",
    entityKey: entity?.key || "",
    entityLabel: entity?.libelle || "Entite inconnue",
    entityActive: entity ? Boolean(entity.actif) : false,
    name: budget.nom || "Budget",
    year: Number(budget.annee || 0),
    status: budget.statut === "active" ? "active" : "inactive",
    totalAnnual: Number(budget.total_annuel || 0),
    lineCount: Number(budget.nb_lignes || 0),
    validationAdmin,
    adminLocked: validationAdmin === "valide",
    validationAdminAt: budget.validation_admin_at || "",
    validationAdminBy: budget.validation_admin_by || "",
    validationAdminNote: budget.validation_admin_note || "",
    commercialId,
    commercialIdentifier: commercial?.identifier || budget.commercial_identifier || "",
    commercialName: commercial?.displayName || commercial?.display_name || budget.commercial_name || "Commercial masque",
    commercialActive: commercial ? Boolean(commercial.active) && !commercial.hidden : false,
    validatedAt: budget.validated_at || "",
    createdAt: budget.created_at || "",
    updatedAt: budget.updated_at || ""
  };
}

function safeCommercial(user) {
  return {
    id: user.id,
    identifier: user.identifier || "",
    displayName: user.displayName || user.display_name || user.identifier || "Commercial",
    active: Boolean(user.active) && !user.hidden,
    hidden: Boolean(user.hidden) || !user.active
  };
}

function budgetStats(budgets, commercials) {
  const activeBudgets = budgets.filter((budget) => budget.status === "active");
  return {
    commercials: commercials.length,
    totalBudgets: budgets.length,
    activeBudgets: activeBudgets.length,
    toValidate: budgets.filter((budget) => budget.validationAdmin === "non_valide").length,
    validated: budgets.filter((budget) => budget.validationAdmin === "valide").length,
    devalidated: budgets.filter((budget) => budget.validationAdmin === "devalide").length,
    activeTotal: activeBudgets.reduce((sum, budget) => sum + Number(budget.totalAnnual || 0), 0)
  };
}

function normalizeValidation(value) {
  const status = normalizeText(value).toLowerCase();
  if (status === "valide") return "valide";
  if (status === "devalide") return "devalide";
  return "non_valide";
}

function normalizeYear(value) {
  const raw = normalizeText(value);
  if (!raw || raw === "all") return "";
  const year = Number(raw);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? String(year) : "";
}

function requestUrl(request) {
  try {
    return new URL(request.url, "https://local.kent");
  } catch {
    return new URL("https://local.kent");
  }
}

function normalizeUuid(value) {
  const id = normalizeText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : "";
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function friendlyBudgetError(error) {
  const message = error.message || "Erreur budgets admin.";
  if (/validation_admin/i.test(message) || /column .* does not exist/i.test(message)) {
    return "Validation admin non prete : lance le SQL supabase_budget_admin_validation.sql dans Supabase.";
  }
  return message;
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
