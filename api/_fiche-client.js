import {
  getSupabaseAdminConfig,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RANGE_LIMIT = 1000;
const MAX_STORAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const DOCUMENTS_TABLE = "documents_commerciaux";
const DOCUMENTS_BUCKET = "documents-commerciaux";
const PROMO_ORIGIN = "promo_manuelle";
const ACCESS_TABLE = "commercial_plaque_access";

const SECTORS = {
  auto: {
    key: "auto",
    clients: "clients",
    accounts: "client_comptes",
    products: "produits",
    tariffs: "tarifs_plaques",
    conditionings: "conditionnements_produits",
    plaques: "plaques",
    visits: "visites",
    lines: "visite_commandes"
  },
  industrie: {
    key: "industrie",
    clients: "industrie_clients",
    accounts: "industrie_client_comptes",
    products: "industrie_produits",
    tariffs: "industrie_tarifs_plaques",
    conditionings: "industrie_conditionnements_produits",
    plaques: "industrie_plaques",
    visits: "industrie_visites",
    lines: "industrie_visite_commandes"
  }
};

export default async function handler(request, response) {
  const guard = requireRole(request, ["commercial"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const commercialId = normalizeUuid(guard.session.dbUserId);
    if (!commercialId) {
      throw forbidden("Compte commercial non rattaché. Reconnecte-toi avec un utilisateur commercial valide.");
    }

    const url = new URL(request.url, "http://localhost");
    const sector = resolveSector(url.searchParams.get("secteur") || url.searchParams.get("sector"));
    const config = SECTORS[sector];
    const body = await readBody(request);

    if (normalizeText(body?.kind).toLowerCase() === "storage") {
      sendJson(response, 200, await handleStorageRequest(body, config, commercialId));
      return;
    }

    sendJson(response, 200, await handleDataRequest(body, config, commercialId, guard.session));
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, serializeError(error));
  }
}

async function handleDataRequest(body, config, commercialId, session) {
  const tableName = normalizeIdentifier(body?.table);
  const table = resolveTable(config, tableName);
  const action = normalizeAction(body?.action);
  if (!table.actions.has(action)) throw forbidden(`Action non autorisée sur ${tableName}.`);

  const filters = normalizeFilters(body?.filters);
  const orders = normalizeOrders(body?.orders);
  const range = normalizeRange(body?.range);
  const select = normalizeSelect(body?.select, action, table);
  validateQueryColumns(filters.map((filter) => filter.column), table, "Filtre");
  validateQueryColumns(orders.map((order) => order.column), table, "Tri");

  if (action === "select") {
    const data = await runSelect({ table, select, filters, orders, range, config, commercialId });
    return { ok: true, data: finalizeReturnedData(data, table, commercialId, config) };
  }

  if (action === "insert") {
    const data = await runInsert({ table, select, payload: body?.payload, single: Boolean(body?.single), config, commercialId, session });
    return { ok: true, data };
  }

  if (action === "upsert") {
    const data = await runUpsert({ table, select, payload: body?.payload, onConflict: body?.onConflict, single: Boolean(body?.single), config, commercialId });
    return { ok: true, data };
  }

  if (action === "update") {
    const data = await runUpdate({ table, select, filters, payload: body?.payload, single: Boolean(body?.single), config, commercialId });
    return { ok: true, data };
  }

  if (action === "delete") {
    const data = await runDelete({ table, filters, config, commercialId });
    return { ok: true, data };
  }

  throw badRequest("Action inconnue.");
}

async function runSelect({ table, select, filters, orders, range, config, commercialId }) {
  if (table.kind === "plaques") {
    const access = await getPlaqueAccess(config, commercialId);
    if (access.ready) {
      if (!access.ids.length) return [];
      filters = [...filters, { op: "in", column: "id", value: access.ids }];
    }
  }

  if (table.kind === "tariffs") {
    const access = await getPlaqueAccess(config, commercialId);
    if (access.ready) {
      if (!access.ids.length) return [];
      filters = [...filters, { op: "in", column: "plaque_id", value: access.ids }];
    }
  }

  if (table.kind === "accounts") {
    const clientIds = await getCommercialClientIds(config, commercialId);
    if (!clientIds.length) return [];
    filters = [...filters, { op: "in", column: "client_id", value: clientIds }];
  }

  if (table.kind === "lines") {
    const visitIds = extractFilterValues(filters, "visite_id");
    if (!visitIds.length) throw forbidden("Lecture des lignes limitée aux visites demandées.");
    const authorizedVisitIds = await getAuthorizedVisitIds(config, commercialId, visitIds);
    if (!authorizedVisitIds.length) return [];
    filters = replaceFiltersForColumn(filters, "visite_id", { op: "in", column: "visite_id", value: authorizedVisitIds });
  }

  if (["clients", "visits", "documents"].includes(table.kind)) {
    filters = [...filters, { op: "eq", column: "commercial_user_id", value: commercialId }];
  }

  if (table.kind === "documents") {
    filters = [...filters, { op: "eq", column: "secteur", value: config.key }];
  }

  const path = buildRestPath(table.name, select, filters, orders, range);
  return safeArrayFetch(path);
}

async function runInsert({ table, select, payload, single, config, commercialId, session }) {
  const rows = asArray(payload);
  if (!rows.length) return single ? null : [];

  let sanitizedRows = rows;
  if (table.kind === "clients") {
    sanitizedRows = [];
    for (const row of rows) sanitizedRows.push(await sanitizeClientPayload(row, config, commercialId, session));
  } else if (table.kind === "visits") {
    sanitizedRows = [];
    for (const row of rows) sanitizedRows.push(await sanitizeVisitPayload(row, config, commercialId, session));
  } else if (table.kind === "lines") {
    sanitizedRows = [];
    for (const row of rows) sanitizedRows.push(await sanitizeLinePayload(row, config, commercialId));
  } else if (table.kind === "documents") {
    sanitizedRows = [];
    for (const row of rows) sanitizedRows.push(await sanitizeDocumentPayload(row, config, commercialId, session));
  } else {
    throw forbidden(`Insertion non autorisée sur ${table.name}.`);
  }

  const queryParts = [];
  if (select) queryParts.push(`select=${encodeURIComponent(select)}`);
  const headers = select ? { Prefer: "return=representation" } : { Prefer: "return=minimal" };
  const result = await supabaseAdminFetch(`/rest/v1/${table.name}${queryParts.length ? `?${queryParts.join("&")}` : ""}`, {
    method: "POST",
    headers,
    body: JSON.stringify(Array.isArray(payload) ? sanitizedRows : sanitizedRows[0])
  });
  return single ? firstRow(result) : (Array.isArray(result) ? result : null);
}

async function runUpsert({ table, select, payload, onConflict, single, config, commercialId }) {
  if (table.kind !== "accounts") throw forbidden(`Upsert non autorisé sur ${table.name}.`);

  const rows = asArray(payload);
  if (!rows.length) return single ? null : [];
  const sanitizedRows = [];
  for (const row of rows) sanitizedRows.push(await sanitizeAccountPayload(row, config, commercialId));

  const queryParts = [];
  if (select) queryParts.push(`select=${encodeURIComponent(select)}`);
  const conflict = normalizeConflictColumns(onConflict);
  if (conflict) queryParts.push(`on_conflict=${encodeURIComponent(conflict)}`);

  const prefer = ["resolution=merge-duplicates", select ? "return=representation" : "return=minimal"].join(",");
  const result = await supabaseAdminFetch(`/rest/v1/${table.name}${queryParts.length ? `?${queryParts.join("&")}` : ""}`, {
    method: "POST",
    headers: { Prefer: prefer },
    body: JSON.stringify(Array.isArray(payload) ? sanitizedRows : sanitizedRows[0])
  });
  return single ? firstRow(result) : (Array.isArray(result) ? result : null);
}

async function runUpdate({ table, select, filters, payload, single, config, commercialId }) {
  if (table.kind === "clients") {
    const ids = extractFilterValues(filters, "id");
    if (!ids.length) throw forbidden("Modification client limitée à un client précis.");
    await ensureClientsBelongToCommercial(config, commercialId, ids);
    payload = sanitizeClientUpdatePayload(payload);
    if (hasOwn(payload, "plaque_id")) {
      if (!payload.plaque_id) throw badRequest("Plaque client invalide.");
      await ensurePlaqueAllowed(config, commercialId, payload.plaque_id);
    }
    filters = [...filters, { op: "eq", column: "commercial_user_id", value: commercialId }];
  } else if (table.kind === "accounts") {
    payload = sanitizeAccountUpdatePayload(payload);
    await ensureAccountUpdateScope(config, commercialId, filters);
  } else if (table.kind === "visits") {
    const ids = extractFilterValues(filters, "id");
    if (!ids.length) throw forbidden("Modification visite limitée à une visite précise.");
    await ensureVisitsBelongToCommercial(config, commercialId, ids);
    payload = sanitizeVisitUpdatePayload(payload);
    filters = [...filters, { op: "eq", column: "commercial_user_id", value: commercialId }];
  } else if (table.kind === "documents") {
    payload = await sanitizeDocumentUpdatePayload(payload, config, commercialId);
    filters = await secureDocumentFilters(filters, config, commercialId);
  } else {
    throw forbidden(`Modification non autorisée sur ${table.name}.`);
  }

  const path = buildRestPath(table.name, select || "*", filters, [], null, { includeSelect: Boolean(select) });
  const result = await supabaseAdminFetch(path, {
    method: "PATCH",
    headers: { Prefer: select ? "return=representation" : "return=minimal" },
    body: JSON.stringify(payload)
  });
  return single ? firstRow(result) : (Array.isArray(result) ? result : null);
}

async function runDelete({ table, filters, config, commercialId }) {
  if (table.kind === "accounts") {
    await ensureAccountDeleteScope(config, commercialId, filters);
  } else if (table.kind === "visits") {
    const ids = extractFilterValues(filters, "id");
    if (!ids.length) throw forbidden("Suppression visite limitée à une visite précise.");
    await ensureVisitsBelongToCommercial(config, commercialId, ids);
    filters = [...filters, { op: "eq", column: "commercial_user_id", value: commercialId }];
  } else if (table.kind === "lines") {
    const visitIds = extractFilterValues(filters, "visite_id");
    if (!visitIds.length) throw forbidden("Suppression des lignes limitée à une visite précise.");
    await ensureVisitsBelongToCommercial(config, commercialId, visitIds);
  } else {
    throw forbidden(`Suppression non autorisée sur ${table.name}.`);
  }

  const path = buildRestPath(table.name, "*", filters, [], null, { includeSelect: false });
  await supabaseAdminFetch(path, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  return null;
}

async function handleStorageRequest(body, config, commercialId) {
  const operation = normalizeText(body?.operation || body?.action).toLowerCase();
  if (operation === "upload") {
    const bucket = normalizeStorageBucket(body?.bucket);
    const path = normalizeStoragePath(body?.path);
    ensureDocumentStorageScope(bucket, path, config, commercialId);
    const contentType = normalizeText(body?.contentType) || "application/pdf";
    const buffer = Buffer.from(normalizeText(body?.base64), "base64");
    if (!buffer.length || buffer.length > MAX_STORAGE_UPLOAD_BYTES) throw badRequest("PDF vide ou trop volumineux pour l'archivage.");
    await uploadStorageObject(bucket, path, buffer, contentType, Boolean(body?.upsert));
    return { ok: true, data: { path, fullPath: `${bucket}/${path}`, size: buffer.length, commercial_user_id: commercialId } };
  }

  if (operation === "remove") {
    const bucket = normalizeStorageBucket(body?.bucket);
    const paths = asArray(body?.paths || body?.path).map(normalizeStoragePath).filter(Boolean);
    for (const path of paths) ensureDocumentStorageScope(bucket, path, config, commercialId);
    for (const path of paths) await deleteStorageObject(bucket, path);
    return { ok: true, data: paths.map((path) => ({ name: path })) };
  }

  throw badRequest("Action de stockage inconnue.");
}

function resolveTable(config, tableName) {
  const clientTokens = tokenSet([
    "id", "nom", "numero_compte", "adresse", "telephone", "email", "plaque_id",
    "taille_client", "created_at", "commercial_user_id", "commercial_identifier",
    "commercial_name", "plaques", "industrie_plaques"
  ]);
  const lineTokens = tokenSet([
    "id", "visite_id", "produit_id", "quantite", "stock_client", "stock_commande_info",
    "couleur", "prix_unitaire", "demo_effectuee"
  ]);
  const visitTokens = tokenSet([
    "id", "client_id", "date_visite", "note", "type_visite", "total_commande",
    "commercial_user_id", "commercial_identifier", "commercial_name",
    "visite_commandes", "industrie_visite_commandes",
    ...lineTokens
  ]);
  const allowed = new Map([
    [config.clients, { name: config.clients, kind: "clients", actions: new Set(["select", "insert", "update"]), selectTokens: clientTokens }],
    [config.accounts, { name: config.accounts, kind: "accounts", actions: new Set(["select", "upsert", "update", "delete"]), selectTokens: tokenSet(["id", "client_id", "numero_compte", "libelle", "is_default", "created_at", "updated_at"]) }],
    [config.products, { name: config.products, kind: "products", actions: new Set(["select"]), selectTokens: tokenSet(["id", "nom", "actif", "reference_produit", "prix_vente", "origine", "created_by_user_id", "promo_deleted_at"]) }],
    [config.tariffs, { name: config.tariffs, kind: "tariffs", actions: new Set(["select"]), selectTokens: tokenSet(["plaque_id", "produit_id", "prix_vente"]) }],
    [config.conditionings, { name: config.conditionings, kind: "conditionings", actions: new Set(["select"]), selectTokens: tokenSet(["ref_5", "code_produit", "categorie", "famille", "sous_famille", "description", "grains", "emballage", "tarif_revente"]) }],
    [config.plaques, { name: config.plaques, kind: "plaques", actions: new Set(["select"]), selectTokens: tokenSet(["id", "nom"]) }],
    [config.visits, { name: config.visits, kind: "visits", actions: new Set(["select", "insert", "update", "delete"]), selectTokens: visitTokens }],
    [config.lines, { name: config.lines, kind: "lines", actions: new Set(["select", "insert", "delete"]), selectTokens: lineTokens }],
    [DOCUMENTS_TABLE, { name: DOCUMENTS_TABLE, kind: "documents", actions: new Set(["select", "insert", "update"]), selectTokens: tokenSet(["id", "commercial_user_id", "secteur", "type_document", "client_id", "visite_id", "client_nom", "numero_compte", "numero_compte_libelle", "compte_client_id", "date_document", "nom_fichier", "montant_ht", "numero_document", "type_visite", "nb_lignes", "taille_octets", "valide", "statut_validation", "created_at", "updated_at", "storage_bucket", "storage_path"]) }]
  ]);
  const table = allowed.get(tableName);
  if (!table) throw forbidden(`Table non autorisée : ${tableName || "-"}.`);
  return table;
}

function buildRestPath(table, select, filters, orders, range, options = {}) {
  const parts = [];
  if (options.includeSelect !== false) parts.push(`select=${encodeURIComponent(select || "*")}`);
  for (const filter of filters) parts.push(encodeFilter(filter));
  if (orders.length) parts.push(`order=${encodeURIComponent(orders.map(formatOrder).join(","))}`);
  if (range) {
    parts.push(`limit=${range.limit}`);
    parts.push(`offset=${range.offset}`);
  }
  return `/rest/v1/${table}${parts.length ? `?${parts.join("&")}` : ""}`;
}

function encodeFilter(filter) {
  const column = normalizeIdentifier(filter.column);
  if (!column) throw badRequest("Colonne de filtre invalide.");
  if (filter.op === "eq") return `${column}=eq.${encodeURIComponent(normalizeScalar(filter.value))}`;
  if (filter.op === "in") return `${column}=${encodeURIComponent(`in.(${asArray(filter.value).map(normalizeScalar).filter(Boolean).join(",")})`)}`;
  throw badRequest(`Filtre non autorisé : ${filter.op || "-"}.`);
}

function formatOrder(order) {
  return `${normalizeIdentifier(order.column)}.${order.ascending === false ? "desc" : "asc"}`;
}

function finalizeReturnedData(data, table, commercialId, config) {
  if (table.kind !== "products") return data;
  if (config.key !== "auto") return data;
  return (data || []).filter((row) => {
    if (normalizeText(row?.origine).toLowerCase() !== PROMO_ORIGIN) return true;
    return normalizeText(row?.created_by_user_id) === commercialId;
  });
}

async function sanitizeClientPayload(row, config, commercialId, session) {
  const payload = sanitizeClientUpdatePayload(row);
  payload.nom = normalizeRequiredText(row?.nom, "Nom client obligatoire.");
  payload.numero_compte = normalizeRequiredText(row?.numero_compte, "Numéro client obligatoire.");
  payload.plaque_id = normalizeUuid(row?.plaque_id);
  if (!payload.plaque_id) throw badRequest("Plaque client invalide.");
  await ensurePlaqueAllowed(config, commercialId, payload.plaque_id);
  payload.commercial_user_id = commercialId;
  payload.commercial_identifier = normalizeText(session?.userId) || null;
  payload.commercial_name = normalizeText(session?.name) || null;
  return payload;
}

function sanitizeClientUpdatePayload(row) {
  const payload = {};
  if (hasOwn(row, "nom")) payload.nom = normalizeText(row.nom);
  if (hasOwn(row, "numero_compte")) payload.numero_compte = normalizeText(row.numero_compte);
  if (hasOwn(row, "telephone")) payload.telephone = nullableText(row.telephone);
  if (hasOwn(row, "adresse")) payload.adresse = nullableText(row.adresse);
  if (hasOwn(row, "email")) payload.email = nullableText(row.email);
  if (hasOwn(row, "taille_client")) payload.taille_client = normalizeClientSize(row.taille_client);
  if (hasOwn(row, "plaque_id")) payload.plaque_id = normalizeUuid(row.plaque_id);
  return payload;
}

async function sanitizeVisitPayload(row, config, commercialId, session) {
  const clientId = normalizeUuid(row?.client_id);
  if (!clientId) throw badRequest("Client de visite invalide.");
  await ensureClientsBelongToCommercial(config, commercialId, [clientId]);
  return {
    client_id: clientId,
    date_visite: normalizeIsoDate(row?.date_visite) || todayIso(),
    type_visite: normalizeText(row?.type_visite) || "vente",
    note: normalizeText(row?.note),
    total_commande: toMoney(row?.total_commande),
    commercial_user_id: commercialId,
    commercial_identifier: normalizeText(session?.userId) || null,
    commercial_name: normalizeText(session?.name) || null
  };
}

function sanitizeVisitUpdatePayload(row) {
  const payload = {};
  if (hasOwn(row, "date_visite")) payload.date_visite = normalizeIsoDate(row.date_visite) || todayIso();
  if (hasOwn(row, "type_visite")) payload.type_visite = normalizeText(row.type_visite) || "vente";
  if (hasOwn(row, "note")) payload.note = normalizeText(row.note);
  if (hasOwn(row, "total_commande")) payload.total_commande = toMoney(row.total_commande);
  return payload;
}

async function sanitizeLinePayload(row, config, commercialId) {
  const visitId = normalizeUuid(row?.visite_id);
  if (!visitId) throw badRequest("Visite de ligne invalide.");
  await ensureVisitsBelongToCommercial(config, commercialId, [visitId]);
  const payload = {
    visite_id: visitId,
    produit_id: normalizeUuid(row?.produit_id) || null,
    quantite: toInteger(row?.quantite),
    stock_client: toInteger(row?.stock_client),
    couleur: normalizeText(row?.couleur) || "green",
    prix_unitaire: toMoney(row?.prix_unitaire),
    demo_effectuee: Boolean(row?.demo_effectuee)
  };
  if (hasOwn(row, "stock_commande_info")) {
    payload.stock_commande_info = normalizeText(row?.stock_commande_info).slice(0, 40) || null;
  }
  return payload;
}

async function sanitizeAccountPayload(row, config, commercialId) {
  const clientId = normalizeUuid(row?.client_id);
  if (!clientId) throw badRequest("Client du compte invalide.");
  await ensureClientsBelongToCommercial(config, commercialId, [clientId]);
  return {
    client_id: clientId,
    numero_compte: normalizeRequiredText(row?.numero_compte, "Numéro de compte obligatoire."),
    libelle: nullableText(row?.libelle),
    is_default: Boolean(row?.is_default)
  };
}

function sanitizeAccountUpdatePayload(row) {
  const payload = {};
  if (hasOwn(row, "numero_compte")) payload.numero_compte = normalizeText(row.numero_compte);
  if (hasOwn(row, "libelle")) payload.libelle = nullableText(row.libelle);
  if (hasOwn(row, "is_default")) payload.is_default = Boolean(row.is_default);
  return payload;
}

async function sanitizeDocumentPayload(row, config, commercialId, session) {
  const clientId = normalizeUuid(row?.client_id);
  const visitId = normalizeUuid(row?.visite_id);
  if (clientId) await ensureClientsBelongToCommercial(config, commercialId, [clientId]);
  if (visitId) await ensureVisitsBelongToCommercial(config, commercialId, [visitId]);
  const storagePath = normalizeStoragePath(row?.storage_path);
  ensureDocumentStorageScope(normalizeStorageBucket(row?.storage_bucket), storagePath, config, commercialId);
  return {
    secteur: config.key,
    type_document: normalizeChoice(row?.type_document, ["bdc", "devis"], "bdc"),
    client_id: clientId || null,
    visite_id: visitId || null,
    client_nom: normalizeText(row?.client_nom) || "Client",
    numero_compte: nullableText(row?.numero_compte),
    numero_compte_libelle: nullableText(row?.numero_compte_libelle),
    compte_client_id: normalizeUuid(row?.compte_client_id) || null,
    date_document: normalizeIsoDate(row?.date_document) || todayIso(),
    nom_fichier: normalizeText(row?.nom_fichier) || "document.pdf",
    storage_bucket: DOCUMENTS_BUCKET,
    storage_path: storagePath,
    montant_ht: toMoney(row?.montant_ht),
    numero_document: nullableText(row?.numero_document),
    type_visite: nullableText(row?.type_visite),
    nb_lignes: toInteger(row?.nb_lignes),
    taille_octets: toInteger(row?.taille_octets),
    valide: row?.valide === true,
    statut_validation: row?.statut_validation === null ? null : nullableText(row?.statut_validation),
    commercial_user_id: commercialId,
    commercial_identifier: normalizeText(session?.userId) || null,
    commercial_name: normalizeText(session?.name) || null
  };
}

async function sanitizeDocumentUpdatePayload(row, config, commercialId) {
  const payload = {};
  if (hasOwn(row, "visite_id")) {
    const visitId = normalizeUuid(row.visite_id);
    if (!visitId) throw badRequest("Visite document invalide.");
    await ensureVisitsBelongToCommercial(config, commercialId, [visitId]);
    payload.visite_id = visitId;
  }
  if (hasOwn(row, "statut_validation")) payload.statut_validation = nullableText(row.statut_validation);
  if (hasOwn(row, "valide")) payload.valide = row.valide === true;
  return payload;
}

async function secureDocumentFilters(filters, config, commercialId) {
  const ids = extractFilterValues(filters, "id");
  if (!ids.length) throw forbidden("Modification document limitée aux documents précis.");
  filters = replaceFiltersForColumn(filters, "id", { op: "in", column: "id", value: ids });
  filters = [...filters, { op: "eq", column: "commercial_user_id", value: commercialId }, { op: "eq", column: "secteur", value: config.key }];
  return filters;
}

async function ensureAccountUpdateScope(config, commercialId, filters) {
  const clientIds = extractFilterValues(filters, "client_id");
  if (clientIds.length) await ensureClientsBelongToCommercial(config, commercialId, clientIds);
  const accountIds = extractFilterValues(filters, "id");
  if (accountIds.length) await ensureAccountsBelongToCommercial(config, commercialId, accountIds);
  if (!clientIds.length && !accountIds.length) throw forbidden("Modification compte limitée à un client ou un compte précis.");
}

async function ensureAccountDeleteScope(config, commercialId, filters) {
  const accountIds = extractFilterValues(filters, "id");
  if (!accountIds.length) throw forbidden("Suppression compte limitée à un compte précis.");
  await ensureAccountsBelongToCommercial(config, commercialId, accountIds);
}

async function ensureClientsBelongToCommercial(config, commercialId, clientIds) {
  const ids = uniqueValues(clientIds).map(normalizeUuid).filter(Boolean);
  if (!ids.length) throw forbidden("Client non autorisé.");
  const rows = await fetchRowsByChunks(config.clients, "id", "id", ids, {
    filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`]
  });
  const found = new Set(rows.map((row) => normalizeText(row.id)));
  if (ids.some((id) => !found.has(id))) throw forbidden("Client introuvable ou non autorisé.");
}

async function ensureVisitsBelongToCommercial(config, commercialId, visitIds) {
  const ids = uniqueValues(visitIds).map(normalizeUuid).filter(Boolean);
  if (!ids.length) throw forbidden("Visite non autorisée.");
  const rows = await fetchRowsByChunks(config.visits, "id", "id", ids, {
    filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`]
  });
  const found = new Set(rows.map((row) => normalizeText(row.id)));
  if (ids.some((id) => !found.has(id))) throw forbidden("Visite introuvable ou non autorisée.");
}

async function ensureAccountsBelongToCommercial(config, commercialId, accountIds) {
  const ids = uniqueValues(accountIds).map(normalizeUuid).filter(Boolean);
  if (!ids.length) throw forbidden("Compte non autorisé.");
  const rows = await fetchRowsByChunks(config.accounts, "id,client_id", "id", ids);
  const rowsById = new Map(rows.map((row) => [normalizeText(row.id), row]));
  const clientIds = rows.map((row) => row.client_id).filter(Boolean);
  await ensureClientsBelongToCommercial(config, commercialId, clientIds);
  if (ids.some((id) => !rowsById.has(id))) throw forbidden("Compte introuvable ou non autorisé.");
}

async function getCommercialClientIds(config, commercialId) {
  const rows = await fetchAllRows(config.clients, "id", {
    filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`]
  });
  return rows.map((row) => normalizeText(row.id)).filter(Boolean);
}

async function getPlaqueAccess(config, commercialId) {
  const id = normalizeUuid(commercialId);
  if (!id) return { ready: false, ids: [] };

  try {
    const rows = await fetchAllRows(ACCESS_TABLE, "plaque_id", {
      filters: [
        `commercial_user_id=eq.${encodeURIComponent(id)}`,
        `secteur=eq.${encodeURIComponent(config.key)}`
      ]
    });
    return {
      ready: true,
      ids: uniqueValues(rows.map((row) => normalizeText(row.plaque_id))).map(normalizeUuid).filter(Boolean)
    };
  } catch (error) {
    if (isMissingAccessTable(error)) return { ready: false, ids: [] };
    throw error;
  }
}

async function ensurePlaqueAllowed(config, commercialId, plaqueId) {
  const id = normalizeUuid(plaqueId);
  if (!id) throw badRequest("Plaque client invalide.");
  const access = await getPlaqueAccess(config, commercialId);
  if (!access.ready) return;
  if (!access.ids.includes(id)) {
    throw forbidden("Plaque non autorisée pour ce commercial.");
  }
}

async function getAuthorizedVisitIds(config, commercialId, visitIds) {
  const ids = uniqueValues(visitIds).map(normalizeUuid).filter(Boolean);
  if (!ids.length) return [];
  const rows = await fetchRowsByChunks(config.visits, "id", "id", ids, {
    filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`]
  });
  return rows.map((row) => normalizeText(row.id)).filter(Boolean);
}

async function fetchAllRows(table, select, options = {}) {
  const rows = [];
  let offset = 0;
  while (true) {
    const path = buildRestPath(table, select, normalizeFiltersFromStrings(options.filters), [], { offset, limit: MAX_RANGE_LIMIT });
    const batch = await safeArrayFetch(path);
    rows.push(...batch);
    if (batch.length < MAX_RANGE_LIMIT) break;
    offset += MAX_RANGE_LIMIT;
  }
  return rows;
}

async function fetchRowsByChunks(table, select, column, values, options = {}) {
  const rows = [];
  for (const chunk of chunkValues(uniqueValues(values), 100)) {
    const filters = [
      ...normalizeFiltersFromStrings(options.filters),
      { op: "in", column, value: chunk }
    ];
    rows.push(...await safeArrayFetch(buildRestPath(table, select, filters, [], null)));
  }
  return rows;
}

async function safeArrayFetch(path) {
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

async function uploadStorageObject(bucket, storagePath, buffer, contentType, upsert) {
  const config = getSupabaseAdminConfig();
  if (!config.ok) {
    const error = new Error(config.error);
    error.code = "missing_service_role_key";
    throw error;
  }
  const response = await fetch(`${config.url}/storage/v1/object/${encodeStorageObjectPath(bucket, storagePath)}`, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": contentType,
      "x-upsert": upsert ? "true" : "false"
    },
    body: buffer
  });
  await assertStorageResponse(response);
}

async function deleteStorageObject(bucket, storagePath) {
  const config = getSupabaseAdminConfig();
  if (!config.ok) {
    const error = new Error(config.error);
    error.code = "missing_service_role_key";
    throw error;
  }
  const response = await fetch(`${config.url}/storage/v1/object/${encodeStorageObjectPath(bucket, storagePath)}`, {
    method: "DELETE",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`
    }
  });
  await assertStorageResponse(response);
}

async function assertStorageResponse(response) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = typeof payload === "string"
      ? payload
      : payload?.message || payload?.error || payload?.details || `Storage ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
}

function normalizeFiltersFromStrings(filters = []) {
  return (filters || []).map((filter) => {
    const [left, rawRight = ""] = String(filter).split("=");
    const [op, ...rest] = rawRight.split(".");
    const right = rest.join(".");
    if (op === "eq") return { op: "eq", column: left, value: decodeURIComponent(right) };
    if (op === "in") return { op: "in", column: left, value: decodeURIComponent(right).replace(/^\(|\)$/g, "").split(",") };
    throw badRequest(`Filtre interne invalide : ${filter}`);
  });
}

function normalizeFilters(filters) {
  return (Array.isArray(filters) ? filters : [])
    .map((filter) => ({
      op: normalizeText(filter?.op).toLowerCase(),
      column: normalizeIdentifier(filter?.column),
      value: filter?.value
    }))
    .filter((filter) => filter.column && ["eq", "in"].includes(filter.op));
}

function normalizeOrders(orders) {
  return (Array.isArray(orders) ? orders : [])
    .map((order) => ({ column: normalizeIdentifier(order?.column), ascending: order?.ascending !== false }))
    .filter((order) => order.column);
}

function normalizeRange(range) {
  const from = Number(range?.from);
  const to = Number(range?.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return null;
  const limit = Math.min(MAX_RANGE_LIMIT, to - from + 1);
  return { offset: from, limit };
}

function normalizeSelect(value, action, table) {
  const text = String(value || (action === "select" ? "*" : "")).trim();
  if (!text) return "";
  if (text.length > 5000) throw badRequest("Sélection trop longue.");
  validateSelectTokens(text, table);
  return text;
}

function validateSelectTokens(select, table) {
  if (select === "*") return;
  const tokens = select.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  const allowed = table?.selectTokens || new Set();
  const denied = tokens.filter((token) => !allowed.has(token));
  if (denied.length) {
    throw forbidden(`Champ non autorisé sur ${table?.name || "table"} : ${denied[0]}.`);
  }
}

function validateQueryColumns(columns, table, label) {
  const allowed = table?.selectTokens || new Set();
  const denied = (columns || []).filter((column) => column && !allowed.has(column));
  if (denied.length) {
    throw forbidden(`${label} non autorisé sur ${table?.name || "table"} : ${denied[0]}.`);
  }
}

function tokenSet(values) {
  return new Set(values || []);
}

function normalizeIdentifier(value) {
  const text = normalizeText(value);
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text) ? text : "";
}

function normalizeAction(value) {
  const action = normalizeText(value).toLowerCase();
  return ["select", "insert", "upsert", "update", "delete"].includes(action) ? action : "select";
}

function resolveSector(value) {
  return normalizeText(value).toLowerCase() === "industrie" ? "industrie" : "auto";
}

function extractFilterValues(filters, column) {
  const wanted = normalizeIdentifier(column);
  const values = [];
  for (const filter of filters) {
    if (filter.column !== wanted) continue;
    if (filter.op === "eq") values.push(filter.value);
    if (filter.op === "in") values.push(...asArray(filter.value));
  }
  return uniqueValues(values);
}

function replaceFiltersForColumn(filters, column, replacement) {
  const wanted = normalizeIdentifier(column);
  return [...filters.filter((filter) => filter.column !== wanted), replacement];
}

function ensureDocumentStorageScope(bucket, storagePath, config, commercialId) {
  if (bucket !== DOCUMENTS_BUCKET) throw forbidden("Bucket document non autorisé.");
  if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/")) throw badRequest("Chemin document invalide.");
  if (!storagePath.startsWith(`${config.key}/${commercialId}/`)) throw forbidden("Chemin document hors périmètre.");
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
  return [bucket, ...storagePath.split("/")].map((part) => encodeURIComponent(part)).join("/");
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function normalizeScalar(value) {
  return normalizeText(value);
}

function normalizeRequiredText(value, message) {
  const text = normalizeText(value);
  if (!text) throw badRequest(message);
  return text;
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeClientSize(value) {
  const size = normalizeText(value).toUpperCase();
  return ["S", "M", "L"].includes(size) ? size : "S";
}

function normalizeChoice(value, allowed, fallback) {
  const text = normalizeText(value).toLowerCase();
  return allowed.includes(text) ? text : fallback;
}

function normalizeIsoDate(value) {
  const text = normalizeText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toInteger(value) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toMoney(value) {
  const number = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function firstRow(value) {
  return Array.isArray(value) ? (value[0] || null) : value;
}

function uniqueValues(values) {
  return [...new Set((values || []).map((value) => normalizeText(value)).filter(Boolean))];
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function normalizeConflictColumns(value) {
  return String(value || "")
    .split(",")
    .map((part) => normalizeIdentifier(part.trim()))
    .filter(Boolean)
    .join(",");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isMissingAccessTable(error) {
  const message = normalizeText(`${error?.message || ""} ${error?.payload?.message || ""} ${error?.payload?.code || ""}`).toLowerCase();
  return message.includes("commercial_plaque_access") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("42p01");
}

async function readBody(request) {
  if (isParsedJsonBody(request.body)) return request.body;
  if (typeof request.body === "string") return parseJsonBody(request.body);
  if (Buffer.isBuffer(request.body)) return parseJsonBody(request.body.toString("utf8"));
  if (request.body) return parseJsonBody(await readStreamText(request.body));
  if (!request[Symbol.asyncIterator]) return {};

  return parseJsonBody(await readStreamText(request));
}

async function readStreamText(stream) {
  const chunks = [];
  let size = 0;
  if (stream && stream[Symbol.asyncIterator]) {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_STORAGE_UPLOAD_BYTES * 2) throw badRequest("Requête trop volumineuse.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  if (stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += buffer.length;
      if (size > MAX_STORAGE_UPLOAD_BYTES * 2) throw badRequest("Requête trop volumineuse.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  return "";
}

function isParsedJsonBody(value) {
  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return false;
  if (typeof value.pipe === "function" || typeof value.on === "function") return false;
  if (typeof value.getReader === "function" || value[Symbol.asyncIterator]) return false;
  return Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype;
}

function parseJsonBody(raw) {
  if (!normalizeText(raw)) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("JSON invalide.");
  }
}

function serializeError(error) {
  const payload = error?.payload && typeof error.payload === "object" ? error.payload : {};
  const message = normalizeText(error?.message) || normalizeText(payload.message) || "Fiche client indisponible.";
  return {
    ok: false,
    error: message,
    message,
    code: normalizeText(error?.code || payload.code),
    details: normalizeText(payload.details),
    hint: normalizeText(payload.hint)
  };
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
