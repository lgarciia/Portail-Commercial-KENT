import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const PRODUITS_TABLE = "produits";
const PROMO_ORIGIN = "promo_manuelle";
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROMO_SELECT = [
  "id",
  "nom",
  "reference_produit",
  "prix_vente",
  "actif",
  "origine",
  "created_by_user_id",
  "promo_deleted_at"
].join(",");

export default async function handler(request, response) {
  const guard = requireRole(request, ["commercial"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    const commercialId = normalizeUuid(guard.session.dbUserId);
    if (!commercialId) {
      throw forbidden("Compte commercial non rattaché. Reconnecte-toi avec un utilisateur commercial valide.");
    }

    if (request.method === "GET") {
      const url = new URL(request.url, "http://localhost");
      sendJson(response, 200, await listPromoProducts(url, commercialId));
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await createPromoProduct(body, commercialId));
      return;
    }

    if (request.method === "PATCH") {
      const body = await readBody(request);
      sendJson(response, 200, await updatePromoProduct(body, commercialId));
      return;
    }

    if (request.method === "DELETE") {
      const body = await readBody(request);
      sendJson(response, 200, await hidePromoProduct(body, commercialId));
      return;
    }

    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyPromoError(error)
    });
  }
}

async function listPromoProducts(url, commercialId) {
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const rows = await safeArrayFetch(
    [
      `/rest/v1/${PRODUITS_TABLE}?select=${encodeURIComponent(PROMO_SELECT)}`,
      `origine=eq.${encodeURIComponent(PROMO_ORIGIN)}`,
      `created_by_user_id=eq.${encodeURIComponent(commercialId)}`,
      "order=reference_produit.asc",
      `limit=${limit}`,
      `offset=${offset}`
    ].join("&")
  );

  return {
    ok: true,
    products: rows.map(normalizePromoProduct),
    meta: {
      limit,
      offset,
      count: rows.length,
      hasMore: rows.length === limit
    }
  };
}

async function createPromoProduct(body, commercialId) {
  const reference = normalizeReference(body?.reference || body?.reference_produit);
  const designation = normalizeText(body?.designation || body?.nom);
  if (!reference) throw badRequest("Référence promo obligatoire.");
  if (!designation) throw badRequest("Désignation obligatoire.");

  const existingRows = await findProductsByReference(reference);
  const official = existingRows.find((row) => normalizeText(row.origine) !== PROMO_ORIGIN);
  if (official) {
    throw badRequest("Cette référence existe déjà dans le référentiel produits. Utilise directement le produit existant dans la fiche client.");
  }

  const ownPromo = existingRows.find(
    (row) =>
      normalizeText(row.origine) === PROMO_ORIGIN &&
      normalizeText(row.created_by_user_id) === commercialId
  );

  if (ownPromo && !isHiddenProduct(ownPromo)) {
    throw badRequest("Cette référence promo existe déjà dans ta liste.");
  }

  if (ownPromo && isHiddenProduct(ownPromo)) {
    const updated = await updateOwnPromoProduct(ownPromo.id, commercialId, {
      nom: designation,
      prix_vente: 0,
      actif: true,
      promo_deleted_at: null
    });
    return {
      ok: true,
      action: "restored",
      product: updated
    };
  }

  const inserted = await supabaseAdminFetch(
    `/rest/v1/${PRODUITS_TABLE}?select=${encodeURIComponent(PROMO_SELECT)}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        reference_produit: reference,
        nom: designation,
        prix_vente: 0,
        actif: true,
        origine: PROMO_ORIGIN,
        created_by_user_id: commercialId,
        promo_deleted_at: null
      })
    }
  );
  const row = Array.isArray(inserted) ? inserted[0] : null;
  if (!row?.id) throw new Error("Produit promo créé sans identifiant.");

  return {
    ok: true,
    action: "created",
    product: normalizePromoProduct(row)
  };
}

async function updatePromoProduct(body, commercialId) {
  const id = normalizeUuid(body?.id || body?.productId);
  const action = normalizeText(body?.action).toLowerCase();
  if (!id) throw badRequest("Produit promo introuvable.");

  const current = await getOwnPromoProduct(id, commercialId);
  if (!current) throw forbidden("Produit promo introuvable ou non autorisé.");

  if (action === "restore") {
    const updated = await updateOwnPromoProduct(id, commercialId, {
      actif: true,
      promo_deleted_at: null
    });
    return { ok: true, action: "restored", product: updated };
  }

  const designation = normalizeText(body?.designation || body?.nom);
  if (!designation) throw badRequest("Désignation obligatoire.");

  const updated = await updateOwnPromoProduct(id, commercialId, {
    nom: designation
  });
  return { ok: true, action: "updated", product: updated };
}

async function hidePromoProduct(body, commercialId) {
  const id = normalizeUuid(body?.id || body?.productId);
  if (!id) throw badRequest("Produit promo introuvable.");

  const current = await getOwnPromoProduct(id, commercialId);
  if (!current) throw forbidden("Produit promo introuvable ou non autorisé.");

  const updated = await updateOwnPromoProduct(id, commercialId, {
    actif: false,
    promo_deleted_at: new Date().toISOString()
  });

  return {
    ok: true,
    action: "hidden",
    product: updated
  };
}

async function findProductsByReference(reference) {
  const rows = await safeArrayFetch(
    [
      `/rest/v1/${PRODUITS_TABLE}?select=${encodeURIComponent(PROMO_SELECT)}`,
      `reference_produit=eq.${encodeURIComponent(reference)}`,
      "limit=100"
    ].join("&")
  );
  return rows;
}

async function getOwnPromoProduct(id, commercialId) {
  const rows = await safeArrayFetch(
    [
      `/rest/v1/${PRODUITS_TABLE}?select=${encodeURIComponent(PROMO_SELECT)}`,
      `id=eq.${encodeURIComponent(id)}`,
      `origine=eq.${encodeURIComponent(PROMO_ORIGIN)}`,
      `created_by_user_id=eq.${encodeURIComponent(commercialId)}`,
      "limit=1"
    ].join("&")
  );
  return rows[0] || null;
}

async function updateOwnPromoProduct(id, commercialId, patch) {
  const updated = await supabaseAdminFetch(
    [
      `/rest/v1/${PRODUITS_TABLE}?select=${encodeURIComponent(PROMO_SELECT)}`,
      `id=eq.${encodeURIComponent(id)}`,
      `origine=eq.${encodeURIComponent(PROMO_ORIGIN)}`,
      `created_by_user_id=eq.${encodeURIComponent(commercialId)}`
    ].join("&"),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch)
    }
  );
  const row = Array.isArray(updated) ? updated[0] : null;
  if (!row?.id) throw new Error("Produit promo non modifié.");
  return normalizePromoProduct(row);
}

async function safeArrayFetch(path) {
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

function normalizePromoProduct(row) {
  return {
    id: normalizeText(row.id),
    nom: normalizeText(row.nom),
    reference_produit: normalizeText(row.reference_produit),
    prix_vente: toMoney(row.prix_vente),
    actif: row.actif === true || row.actif === "true",
    origine: normalizeText(row.origine),
    created_by_user_id: normalizeText(row.created_by_user_id),
    promo_deleted_at: normalizeText(row.promo_deleted_at)
  };
}

function isHiddenProduct(row) {
  return !row?.actif || Boolean(row?.promo_deleted_at);
}

function normalizeReference(value) {
  return normalizeText(value).replace(/\s+/g, " ").toUpperCase();
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function clampLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(number)));
}

function clampOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function toMoney(value) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function friendlyPromoError(error) {
  const message = normalizeText(error?.message) || "Produits promo indisponibles.";
  const lower = message.toLowerCase();
  if (
    lower.includes("origine") ||
    lower.includes("created_by_user_id") ||
    lower.includes("promo_deleted_at") ||
    lower.includes("schema cache") ||
    lower.includes("column")
  ) {
    return "Structure Supabase produits promo non prête : lance le SQL supabase_produits_promo.sql dans Supabase.";
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
