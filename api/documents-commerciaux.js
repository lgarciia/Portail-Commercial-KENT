import {
  getSupabaseAdminConfig,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const DOCUMENTS_TABLE = "documents_commerciaux";
const DOCUMENTS_BUCKET = "documents-commerciaux";
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 1000;
const MAX_SIGNED_URL_SECONDS = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DOCUMENT_PUBLIC_SELECT = [
  "id",
  "commercial_user_id",
  "secteur",
  "type_document",
  "client_id",
  "visite_id",
  "client_nom",
  "numero_compte",
  "numero_compte_libelle",
  "compte_client_id",
  "date_document",
  "nom_fichier",
  "montant_ht",
  "numero_document",
  "type_visite",
  "nb_lignes",
  "taille_octets",
  "valide",
  "statut_validation",
  "created_at",
  "updated_at"
].join(",");

const DOCUMENT_PRIVATE_SELECT = [
  DOCUMENT_PUBLIC_SELECT,
  "storage_bucket",
  "storage_path"
].join(",");

const ALLOWED_STATUS = new Set(["transmis", "valide", "non_valide"]);

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
      const action = normalizeText(url.searchParams.get("action")).toLowerCase();
      if (action === "download") {
        const id = normalizeUuid(url.searchParams.get("id"));
        const expiresIn = clampSignedUrlSeconds(url.searchParams.get("expiresIn"));
        sendJson(response, 200, await createDownloadLink(id, commercialId, expiresIn));
        return;
      }

      sendJson(response, 200, await listDocuments(url, commercialId));
      return;
    }

    if (request.method === "PATCH") {
      const body = await readBody(request);
      sendJson(response, 200, await updateDocumentStatus(body, commercialId));
      return;
    }

    if (request.method === "DELETE") {
      const body = await readBody(request);
      sendJson(response, 200, await deleteDocument(body, commercialId));
      return;
    }

    response.setHeader("Allow", "GET, PATCH, DELETE");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyDocumentsError(error)
    });
  }
}

async function listDocuments(url, commercialId) {
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const path = [
    `/rest/v1/${DOCUMENTS_TABLE}?select=${encodeURIComponent(DOCUMENT_PUBLIC_SELECT)}`,
    `commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
    "order=date_document.desc,created_at.desc",
    `limit=${limit}`,
    `offset=${offset}`
  ].join("&");

  const rows = await safeArrayFetch(path);
  return {
    ok: true,
    documents: rows.map(normalizeDocument),
    meta: {
      limit,
      offset,
      count: rows.length,
      hasMore: rows.length === limit
    }
  };
}

async function createDownloadLink(id, commercialId, expiresIn) {
  if (!id) throw badRequest("Document introuvable.");
  const document = await getDocumentForCommercial(id, commercialId);
  if (!document) throw forbidden("Document introuvable ou non autorisé.");
  const signedUrl = await signStorageUrl(document, expiresIn);
  return {
    ok: true,
    id: document.id,
    filename: document.nom_fichier || "document.pdf",
    signedUrl,
    expiresIn
  };
}

async function updateDocumentStatus(body, commercialId) {
  const id = normalizeUuid(body?.id || body?.documentId);
  const status = normalizeText(body?.status || body?.statut).toLowerCase();
  if (!id) throw badRequest("Document introuvable.");
  if (!ALLOWED_STATUS.has(status)) throw badRequest("Statut document invalide.");

  const current = await getDocumentForCommercial(id, commercialId, { publicOnly: true });
  if (!current) throw forbidden("Document introuvable ou non autorisé.");

  const updated = await supabaseAdminFetch(
    `/rest/v1/${DOCUMENTS_TABLE}?select=${encodeURIComponent(DOCUMENT_PUBLIC_SELECT)}&id=eq.${encodeURIComponent(id)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        statut_validation: status,
        valide: status === "valide"
      })
    }
  );
  const row = Array.isArray(updated) ? updated[0] : null;
  if (!row) throw new Error("Statut non modifié.");

  return {
    ok: true,
    document: normalizeDocument(row)
  };
}

async function deleteDocument(body, commercialId) {
  const id = normalizeUuid(body?.id || body?.documentId);
  if (!id) throw badRequest("Document introuvable.");

  const document = await getDocumentForCommercial(id, commercialId);
  if (!document) throw forbidden("Document introuvable ou non autorisé.");

  await deleteStorageObject(document);

  await supabaseAdminFetch(
    `/rest/v1/${DOCUMENTS_TABLE}?id=eq.${encodeURIComponent(id)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    }
  );

  return {
    ok: true,
    deletedId: id
  };
}

async function getDocumentForCommercial(id, commercialId, options = {}) {
  const select = options.publicOnly ? DOCUMENT_PUBLIC_SELECT : DOCUMENT_PRIVATE_SELECT;
  const rows = await safeArrayFetch(
    `/rest/v1/${DOCUMENTS_TABLE}?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(id)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}&limit=1`
  );
  return rows[0] || null;
}

async function signStorageUrl(document, expiresIn) {
  const bucket = normalizeStorageBucket(document.storage_bucket);
  const storagePath = normalizeStoragePath(document.storage_path);
  if (!storagePath) throw badRequest("Chemin du PDF introuvable.");

  const result = await supabaseStorageFetch(
    `/storage/v1/object/sign/${encodeStorageObjectPath(bucket, storagePath)}`,
    {
      method: "POST",
      body: JSON.stringify({ expiresIn })
    }
  );

  const signed = normalizeText(result?.signedUrl || result?.signedURL || result?.url || result?.signed_url);
  if (!signed) throw new Error("Lien signé indisponible.");
  return absolutizeStorageUrl(signed);
}

async function deleteStorageObject(document) {
  const bucket = normalizeStorageBucket(document.storage_bucket);
  const storagePath = normalizeStoragePath(document.storage_path);
  if (!storagePath) throw badRequest("Chemin du PDF introuvable.");

  await supabaseStorageFetch(
    `/storage/v1/object/${encodeStorageObjectPath(bucket, storagePath)}`,
    { method: "DELETE" }
  );
}

async function supabaseStorageFetch(path, options = {}) {
  const config = getSupabaseAdminConfig();
  if (!config.ok) {
    const error = new Error(config.error);
    error.code = "missing_service_role_key";
    throw error;
  }

  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      ...(options.body == null ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && (payload.message || payload.error || payload.details)) ||
      (typeof payload === "string" ? payload : "") ||
      `Storage ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

async function safeArrayFetch(path) {
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

function normalizeDocument(row) {
  return {
    id: normalizeText(row.id),
    commercial_user_id: normalizeText(row.commercial_user_id),
    secteur: normalizeChoice(row.secteur, ["auto", "industrie"], "auto"),
    type_document: normalizeChoice(row.type_document, ["bdc", "devis"], "bdc"),
    client_id: normalizeText(row.client_id),
    visite_id: normalizeText(row.visite_id),
    client_nom: normalizeText(row.client_nom) || "Client",
    numero_compte: normalizeText(row.numero_compte),
    numero_compte_libelle: normalizeText(row.numero_compte_libelle),
    compte_client_id: normalizeText(row.compte_client_id),
    date_document: normalizeText(row.date_document),
    nom_fichier: normalizeText(row.nom_fichier) || "document.pdf",
    montant_ht: toMoney(row.montant_ht),
    numero_document: normalizeText(row.numero_document),
    type_visite: normalizeText(row.type_visite),
    nb_lignes: Number(row.nb_lignes || 0),
    taille_octets: Number(row.taille_octets || 0),
    valide: row.valide === true || row.valide === "true",
    statut_validation: normalizeText(row.statut_validation),
    created_at: normalizeText(row.created_at),
    updated_at: normalizeText(row.updated_at)
  };
}

function normalizeChoice(value, allowed, fallback) {
  const text = normalizeText(value).toLowerCase();
  return allowed.includes(text) ? text : fallback;
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function normalizeStorageBucket(value) {
  const text = normalizeText(value);
  return text || DOCUMENTS_BUCKET;
}

function normalizeStoragePath(value) {
  return normalizeText(value)
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function encodeStorageObjectPath(bucket, storagePath) {
  return [bucket, ...storagePath.split("/")]
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function absolutizeStorageUrl(value) {
  if (/^https?:\/\//i.test(value)) return value;
  const config = getSupabaseAdminConfig();
  if (!config.ok) return value;
  if (value.startsWith("/storage/v1/")) return `${config.url}${value}`;
  if (value.startsWith("/object/")) return `${config.url}/storage/v1${value}`;
  if (value.startsWith("object/")) return `${config.url}/storage/v1/${value}`;
  return `${config.url}/storage/v1/${value.replace(/^\/+/, "")}`;
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

function clampSignedUrlSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 60;
  return Math.max(15, Math.min(MAX_SIGNED_URL_SECONDS, Math.trunc(number)));
}

function toMoney(value) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function friendlyDocumentsError(error) {
  const message = normalizeText(error?.message) || "Documents commerciaux indisponibles.";
  const lower = message.toLowerCase();
  if (
    lower.includes("documents_commerciaux") ||
    lower.includes("commercial_user_id") ||
    lower.includes("storage_path") ||
    lower.includes("does not exist") ||
    lower.includes("42p01") ||
    lower.includes("42703")
  ) {
    return "Documents commerciaux Supabase non prêts : vérifie que les SQL documents et ownership ont bien été lancés.";
  }
  if (lower.includes("missing_service_role_key") || lower.includes("service_role")) {
    return "Clé serveur Supabase manquante côté Vercel.";
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
