import { normalizeText, requireRole, sendJson, supabaseAdminFetch } from "./_auth.js";

const DEFAULT_ENTITIES = [
  { key: "psa", libelle: "PSA", ordre: 10 },
  { key: "gueudet", libelle: "Gueudet", ordre: 20 },
  { key: "ford", libelle: "Ford", ordre: 30 },
  { key: "direct", libelle: "Direct", ordre: 40 }
];

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
  "ordre",
  "actif",
  "commercial_user_id",
  "commercial_identifier",
  "commercial_name"
].join(",");

const IMPORT_SELECT = [
  "id",
  "entite_id",
  "annee",
  "mois",
  "statut",
  "nom",
  "source_file",
  "sheet_name",
  "total_mois",
  "nb_lignes",
  "colonnes_map",
  "meta",
  "commercial_user_id",
  "commercial_identifier",
  "commercial_name",
  "created_at",
  "imported_at"
].join(",");

export default async function handler(request, response) {
  const guard = requireRole(request, ["admin"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadAdminImports(request));
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const result = await handleAction(body, guard.session);
      sendJson(response, 200, result);
      return;
    }

    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyImportError(error)
    });
  }
}

async function loadAdminImports(request) {
  const url = requestUrl(request);
  const year = clampYear(url.searchParams.get("year"));
  const month = clampMonth(url.searchParams.get("month"));
  const requestedCommercialId = normalizeUuid(url.searchParams.get("commercialId"));

  const commercials = await listCommercialUsers();
  const selectedCommercial =
    commercials.find((user) => user.id === requestedCommercialId) ||
    commercials.find((user) => user.active && !user.hidden) ||
    commercials[0] ||
    null;

  if (!selectedCommercial) {
    return {
      ready: true,
      commercials: [],
      selectedCommercialId: "",
      entities: [],
      imports: [],
      summary: emptySummary()
    };
  }

  await ensureDefaultEntitiesForCommercial(selectedCommercial);
  const entities = await listEntitiesForCommercial(selectedCommercial.id);
  const entityId = normalizeUuid(url.searchParams.get("entiteId"));
  const imports = await listImportsForCommercial({
    commercialId: selectedCommercial.id,
    year,
    month,
    entiteId: entityId
  });
  const entityMap = new Map(entities.map((entity) => [String(entity.id), entity]));

  return {
    ready: true,
    year,
    month,
    selectedCommercialId: selectedCommercial.id,
    commercials: commercials.map(safeCommercial),
    entities: entities.map(safeEntity),
    imports: imports.map((row) => safeImport(row, entityMap)),
    summary: importSummary(imports)
  };
}

async function handleAction(body, session) {
  const action = normalizeText(body?.action);
  if (action === "saveImport") return saveImport(body, session);
  if (action === "activateImport") return activateImport(body, session);
  throw badRequest("Action import inconnue.");
}

async function saveImport(body, session) {
  const commercialId = normalizeUuid(body?.commercialId);
  const entiteId = normalizeUuid(body?.entiteId);
  const year = clampYear(body?.year || body?.annee);
  const month = clampMonth(body?.month || body?.mois);
  const parsed = body?.parsed || {};
  const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
  if (!commercialId) throw badRequest("Commercial obligatoire.");
  if (!entiteId) throw badRequest("Entite obligatoire.");
  if (!lines.length) throw badRequest("Aucune ligne reelle a importer.");

  const commercial = await getCommercialById(commercialId);
  if (!commercial) throw badRequest("Commercial introuvable.");
  const entity = await getEntityForCommercial(entiteId, commercial.id);
  if (!entity) throw badRequest("Cette entite n'appartient pas au commercial selectionne.");

  const replaced = await deactivateActiveImports({
    commercialId: commercial.id,
    entiteId: entity.id,
    year,
    month
  });

  const monthLabel = monthName(month);
  const ownerPayload = commercialOwnerPayload(commercial);
  const importPayload = {
    entite_id: entity.id,
    annee: year,
    mois: month,
    statut: "active",
    nom: normalizeText(body?.name) || `Reel ${entity.libelle || entity.key || "Entite"} ${monthLabel} ${year}`,
    source_file: normalizeText(body?.sourceFile) || null,
    sheet_name: normalizeText(body?.sheetName) || null,
    total_mois: toMoney(parsed.total),
    nb_lignes: lines.length,
    colonnes_map: parsed.columns && typeof parsed.columns === "object" ? parsed.columns : {},
    meta: {
      imported_from: "admin-reel-imports",
      imported_by_admin: normalizeText(session?.name || session?.userId || "Admin"),
      skipped: parsed.skipped && typeof parsed.skipped === "object" ? parsed.skipped : {},
      replaced_import_ids: replaced.map((row) => row.id)
    },
    ...ownerPayload
  };

  let savedImport = null;
  try {
    const inserted = await supabaseAdminFetch(`/rest/v1/reel_imports?select=${encodeURIComponent(IMPORT_SELECT)}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(importPayload)
    });
    savedImport = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!savedImport?.id) throw badRequest("Import cree mais identifiant introuvable.");

    await insertImportLines(savedImport.id, lines, ownerPayload, commercial, month);

    return {
      ok: true,
      importRow: safeImport(savedImport, new Map([[String(entity.id), entity]])),
      replacedCount: replaced.length,
      message: `Import reel enregistre pour ${commercial.display_name || commercial.identifier}.`
    };
  } catch (error) {
    if (savedImport?.id) {
      await safeRollbackInsertedImport(savedImport.id);
    }
    if (replaced.length) {
      await restoreImports(replaced.map((row) => row.id));
    }
    throw error;
  }
}

async function activateImport(body) {
  const importId = normalizeUuid(body?.importId || body?.id);
  if (!importId) throw badRequest("Import introuvable.");
  const importRow = await getImportById(importId);
  if (!importRow) throw badRequest("Import introuvable.");

  const replaced = await deactivateActiveImports({
    commercialId: importRow.commercial_user_id,
    entiteId: importRow.entite_id,
    year: importRow.annee,
    month: importRow.mois
  });

  await supabaseAdminFetch(`/rest/v1/reel_imports?id=eq.${encodeURIComponent(importId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      statut: "active",
      meta: {
        ...(importRow.meta && typeof importRow.meta === "object" ? importRow.meta : {}),
        activated_from_admin_at: new Date().toISOString(),
        replaced_import_ids: replaced.map((row) => row.id)
      }
    })
  });

  return {
    ok: true,
    replacedCount: replaced.filter((row) => row.id !== importId).length
  };
}

async function listCommercialUsers() {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&role=eq.commercial&order=display_name.asc`
  );
  return Array.isArray(data) ? data : [];
}

async function getCommercialById(id) {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&id=eq.${encodeURIComponent(id)}&role=eq.commercial&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function ensureDefaultEntitiesForCommercial(commercial) {
  const existing = await listEntitiesForCommercial(commercial.id, { includeInactive: true });
  const existingKeys = new Set(existing.map((entity) => normalizeText(entity.key).toLowerCase()));
  const missing = DEFAULT_ENTITIES.filter((entity) => !existingKeys.has(entity.key));
  if (!missing.length) return;

  const owner = commercialOwnerPayload(commercial);
  await supabaseAdminFetch("/rest/v1/budget_entites", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(missing.map((entity) => ({ ...entity, actif: true, ...owner })))
  });
}

async function listEntitiesForCommercial(commercialId, options = {}) {
  let path = `/rest/v1/budget_entites?select=${encodeURIComponent(ENTITY_SELECT)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}`;
  if (!options.includeInactive) path += "&actif=eq.true";
  path += "&order=ordre.asc,libelle.asc";
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

async function getEntityForCommercial(entiteId, commercialId) {
  const data = await supabaseAdminFetch(
    `/rest/v1/budget_entites?select=${encodeURIComponent(ENTITY_SELECT)}&id=eq.${encodeURIComponent(entiteId)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function listImportsForCommercial({ commercialId, year, month, entiteId }) {
  let path = `/rest/v1/reel_imports?select=${encodeURIComponent(IMPORT_SELECT)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}`;
  if (year) path += `&annee=eq.${encodeURIComponent(year)}`;
  if (month) path += `&mois=eq.${encodeURIComponent(month)}`;
  if (entiteId) path += `&entite_id=eq.${encodeURIComponent(entiteId)}`;
  path += "&order=annee.desc,mois.desc,created_at.desc";
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

async function getImportById(importId) {
  const data = await supabaseAdminFetch(
    `/rest/v1/reel_imports?select=${encodeURIComponent(IMPORT_SELECT)}&id=eq.${encodeURIComponent(importId)}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function deactivateActiveImports({ commercialId, entiteId, year, month }) {
  const active = await supabaseAdminFetch(
    `/rest/v1/reel_imports?select=${encodeURIComponent(IMPORT_SELECT)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}&entite_id=eq.${encodeURIComponent(entiteId)}&annee=eq.${encodeURIComponent(year)}&mois=eq.${encodeURIComponent(month)}&statut=eq.active`
  );
  const rows = Array.isArray(active) ? active : [];
  if (!rows.length) return [];
  await supabaseAdminFetch(`/rest/v1/reel_imports?id=in.(${rows.map((row) => encodeURIComponent(row.id)).join(",")})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ statut: "inactive" })
  });
  return rows;
}

async function restoreImports(ids) {
  if (!ids.length) return;
  await supabaseAdminFetch(`/rest/v1/reel_imports?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ statut: "active" })
  });
}

async function insertImportLines(importId, lines, ownerPayload, commercial, selectedMonth) {
  const payload = lines.map((line, index) => ({
    import_id: importId,
    ordre: toInteger(line?.ordre, index),
    client_code: nullableText(line?.client_code),
    client_nom: normalizeText(line?.client_nom) || `Client ${normalizeText(line?.client_code) || index + 1}`,
    montant: toMoney(line?.montant),
    mois_source: clampMonth(line?.mois_source || selectedMonth),
    date_piece: validDateOrNull(line?.date_piece),
    reference: nullableText(line?.reference),
    designation: nullableText(line?.designation),
    quantite: toMoney(line?.quantite),
    raw_data: {
      Vendeur: commercial.display_name || commercial.identifier || "",
      source_admin: true
    },
    ...ownerPayload
  }));

  const chunkSize = 500;
  for (let index = 0; index < payload.length; index += chunkSize) {
    await supabaseAdminFetch("/rest/v1/reel_lignes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload.slice(index, index + chunkSize))
    });
  }
}

async function safeRollbackInsertedImport(importId) {
  try {
    await supabaseAdminFetch(`/rest/v1/reel_lignes?import_id=eq.${encodeURIComponent(importId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    await supabaseAdminFetch(`/rest/v1/reel_imports?id=eq.${encodeURIComponent(importId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  } catch {
    // Rollback best-effort uniquement sur l'import cree dans cette requete.
  }
}

function commercialOwnerPayload(commercial) {
  return {
    commercial_user_id: commercial.id,
    commercial_identifier: normalizeText(commercial.identifier),
    commercial_name: normalizeText(commercial.display_name || commercial.identifier)
  };
}

function safeCommercial(user) {
  return {
    id: user.id,
    identifier: user.identifier || "",
    displayName: user.display_name || user.identifier || "Commercial",
    active: Boolean(user.active) && !user.hidden,
    hidden: Boolean(user.hidden) || !user.active
  };
}

function safeEntity(entity) {
  return {
    id: entity.id,
    key: entity.key || "",
    label: entity.libelle || entity.key || "Entite",
    order: Number(entity.ordre || 0),
    active: Boolean(entity.actif),
    commercialId: entity.commercial_user_id || ""
  };
}

function safeImport(row, entityMap) {
  const entity = entityMap.get(String(row.entite_id)) || null;
  return {
    id: row.id,
    entityId: row.entite_id || "",
    entityKey: entity?.key || "",
    entityLabel: entity?.libelle || entity?.label || "Entite",
    year: Number(row.annee || 0),
    month: Number(row.mois || 0),
    monthLabel: monthName(row.mois),
    status: row.statut === "active" ? "active" : "inactive",
    name: row.nom || "Import reel",
    sourceFile: row.source_file || "",
    sheetName: row.sheet_name || "",
    total: Number(row.total_mois || 0),
    lineCount: Number(row.nb_lignes || 0),
    createdAt: row.imported_at || row.created_at || "",
    commercialId: row.commercial_user_id || "",
    commercialName: row.commercial_name || ""
  };
}

function importSummary(imports) {
  const rows = Array.isArray(imports) ? imports : [];
  const active = rows.filter((row) => row.statut === "active");
  return {
    totalImports: rows.length,
    activeImports: active.length,
    activeAmount: active.reduce((sum, row) => sum + Number(row.total_mois || 0), 0),
    activeLines: active.reduce((sum, row) => sum + Number(row.nb_lignes || 0), 0)
  };
}

function emptySummary() {
  return { totalImports: 0, activeImports: 0, activeAmount: 0, activeLines: 0 };
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

function clampYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return new Date().getFullYear();
  return Math.min(2100, Math.max(2020, Math.trunc(year)));
}

function clampMonth(value) {
  const month = Number(value);
  if (!Number.isFinite(month)) return 0;
  return Math.min(12, Math.max(1, Math.trunc(month)));
}

function monthName(value) {
  const names = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];
  return names[Number(value) - 1] || `Mois ${value || "-"}`;
}

function toMoney(value) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function validDateOrNull(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function friendlyImportError(error) {
  const message = error?.message || "Erreur import reel admin.";
  const lower = message.toLowerCase();
  if (lower.includes("reel_imports") || lower.includes("reel_lignes") || lower.includes("does not exist") || lower.includes("42p01")) {
    return "Import reel Supabase non pret : verifie que le SQL reel_mensuel et le scope commercial sont bien lances.";
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
