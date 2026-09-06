import { normalizeText, requireRole, sendJson, supabaseAdminFetch } from "./_auth.js";

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 500;
const ACCESS_TABLE = "commercial_plaque_access";

const USER_SELECT = ["id", "identifier", "display_name", "role", "active", "hidden"].join(",");
const PLAQUE_SELECT = ["id", "nom", "created_at"].join(",");
const PLAQUE_SELECT_SAFE = ["id", "nom"].join(",");
const PRODUCT_SELECT = ["id", "nom", "reference_produit", "prix_vente", "actif"].join(",");
const TARIFF_SELECT = ["plaque_id", "produit_id", "prix_vente"].join(",");
const CONDITIONING_SELECT = [
  "ref_5",
  "code_produit",
  "categorie",
  "famille",
  "sous_famille",
  "description",
  "grains",
  "emballage",
  "tarif_revente"
].join(",");

const SECTORS = {
  auto: {
    key: "auto",
    label: "Automobile",
    plaques: "plaques",
    products: "produits",
    tariffs: "tarifs_plaques",
    conditionings: "conditionnements_produits"
  },
  industrie: {
    key: "industrie",
    label: "Industrie",
    plaques: "industrie_plaques",
    products: "industrie_produits",
    tariffs: "industrie_tarifs_plaques",
    conditionings: "industrie_conditionnements_produits"
  }
};

export default async function handler(request, response) {
  const guard = requireRole(request, ["admin"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadCatalog());
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
      ok: false,
      error: friendlyError(error),
      details: normalizeText(error?.payload?.details),
      hint: normalizeText(error?.payload?.hint)
    });
  }
}

async function loadCatalog() {
  const [commercials, autoPlaques, industriePlaques, accessResult] = await Promise.all([
    listCommercialUsers(),
    listPlaques(SECTORS.auto),
    listPlaques(SECTORS.industrie),
    listAccessRows()
  ]);

  return {
    ok: true,
    ready: true,
    commercials: commercials.map(safeCommercial),
    plaques: {
      auto: autoPlaques.map((row) => safePlaque(row, "auto")),
      industrie: industriePlaques.map((row) => safePlaque(row, "industrie"))
    },
    access: accessResult.rows.map(safeAccess),
    accessReady: accessResult.ready,
    accessWarning: accessResult.warning
  };
}

async function handleAction(body, session) {
  const action = normalizeText(body?.action);
  if (action === "createPlaque") return createPlaque(body, session);
  if (action === "setCommercialPlaques") return setCommercialPlaques(body, session);
  if (action === "importTarifs") return importTarifs(body, session);
  if (action === "importConditionnements") return importConditionnements(body, session);
  throw badRequest("Action référentiel inconnue.");
}

async function createPlaque(body, session) {
  const sector = resolveSector(body?.sector || body?.secteur);
  const config = SECTORS[sector];
  const name = normalizeRequiredText(body?.name || body?.nom, "Nom de plaque obligatoire.").slice(0, 120);

  const existing = findPlaqueByName(await listPlaques(config), name);
  if (existing) {
    return {
      ok: true,
      created: false,
      plaque: safePlaque(existing, sector),
      message: "Cette plaque existe déjà."
    };
  }

  const inserted = await supabaseAdminFetch(`/rest/v1/${config.plaques}?select=${encodeURIComponent(PLAQUE_SELECT_SAFE)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ nom: name })
  }).catch(async (error) => {
    if (isUniqueViolation(error)) {
      const row = findPlaqueByName(await listPlaques(config), name);
      if (row) return [row];
    }
    throw error;
  });

  const plaque = Array.isArray(inserted) ? inserted[0] : inserted;
  return {
    ok: true,
    created: true,
    plaque: safePlaque(plaque, sector),
    message: `Plaque créée par ${normalizeText(session?.name) || "Admin"}.`
  };
}

async function setCommercialPlaques(body, session) {
  await assertAccessTableReady();
  const commercialId = normalizeUuid(body?.commercialId || body?.commercial_user_id);
  const sector = resolveSector(body?.sector || body?.secteur);
  const plaqueIds = uniqueValues(asArray(body?.plaqueIds || body?.plaques)).map(normalizeUuid).filter(Boolean);
  if (!commercialId) throw badRequest("Commercial obligatoire.");

  const commercial = await getCommercialById(commercialId);
  if (!commercial) throw badRequest("Commercial introuvable.");

  const plaques = await listPlaques(SECTORS[sector]);
  const plaqueIdSet = new Set(plaques.map((row) => normalizeText(row.id)));
  const invalid = plaqueIds.filter((id) => !plaqueIdSet.has(id));
  if (invalid.length) throw badRequest("Au moins une plaque sélectionnée n'existe pas dans ce secteur.");

  const oldAccess = await listAccessRowsFor(commercialId, sector);
  await deleteAccessRows(commercialId, sector);

  try {
    if (plaqueIds.length) {
      const nowBy = normalizeText(session?.name || session?.userId || "Admin");
      await insertRows(ACCESS_TABLE, plaqueIds.map((plaqueId) => ({
        commercial_user_id: commercialId,
        secteur: sector,
        plaque_id: plaqueId,
        created_by: nowBy
      })));
    }
  } catch (error) {
    if (oldAccess.length) {
      await insertRows(ACCESS_TABLE, oldAccess.map((row) => ({
        id: row.id,
        commercial_user_id: row.commercial_user_id,
        secteur: row.secteur,
        plaque_id: row.plaque_id,
        created_at: row.created_at,
        created_by: row.created_by || null
      })));
    }
    throw error;
  }

  return {
    ok: true,
    commercial: safeCommercial(commercial),
    secteur: sector,
    plaqueIds,
    message: `${plaqueIds.length} plaque(s) autorisée(s).`
  };
}

async function importTarifs(body, session) {
  const sector = resolveSector(body?.sector || body?.secteur);
  const config = SECTORS[sector];
  const plaqueId = normalizeUuid(body?.plaqueId || body?.plaque_id);
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (!plaqueId) throw badRequest("Plaque obligatoire pour importer un tarif.");
  if (!rows.length) throw badRequest("Aucune ligne tarif à importer.");

  const plaque = (await listPlaques(config)).find((row) => normalizeText(row.id) === plaqueId);
  if (!plaque) throw badRequest("Plaque introuvable pour ce secteur.");

  const normalizedRows = normalizeTariffRows(rows);
  if (!normalizedRows.length) throw badRequest("Aucune ligne tarif valide après contrôle.");

  let oldTariffs = [];
  let replaced = false;

  try {
    const productSummary = await syncProducts(config, normalizedRows);
    const productsAfter = await fetchAllRows(config.products, PRODUCT_SELECT, { order: "reference_produit.asc" });
    const productsByRef = buildProductMap(productsAfter);
    const tariffRows = [];
    const missingProducts = [];

    for (const row of normalizedRows) {
      const product = productsByRef.get(row.referenceKey);
      if (!product?.id) {
        missingProducts.push(row.reference);
        continue;
      }
      tariffRows.push({
        plaque_id: plaqueId,
        produit_id: product.id,
        prix_vente: row.price
      });
    }

    if (!tariffRows.length) {
      throw badRequest("Aucun tarif à insérer : les produits n'ont pas pu être synchronisés.");
    }

    oldTariffs = await fetchAllRows(config.tariffs, TARIFF_SELECT, {
      filters: [`plaque_id=eq.${encodeURIComponent(plaqueId)}`]
    });

    await supabaseAdminFetch(`/rest/v1/${config.tariffs}?plaque_id=eq.${encodeURIComponent(plaqueId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    replaced = true;

    await insertRows(config.tariffs, tariffRows);

    return {
      ok: true,
      sector,
      plaque: safePlaque(plaque, sector),
      imported: tariffRows.length,
      oldTariffs: oldTariffs.length,
      missingProducts: missingProducts.slice(0, 10),
      productsCreated: productSummary.created,
      productsUpdated: productSummary.updated,
      importedBy: normalizeText(session?.name || session?.userId || "Admin"),
      message: `Tarif importé pour ${plaque.nom || "la plaque"}.`
    };
  } catch (error) {
    if (replaced) {
      await safeRestoreTariffs(config, plaqueId, oldTariffs);
    }
    throw error;
  }
}

async function importConditionnements(body, session) {
  const sector = resolveSector(body?.sector || body?.secteur);
  const config = SECTORS[sector];
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (!rows.length) throw badRequest("Aucune ligne conditionnement à importer.");

  const normalizedRows = normalizeConditioningRows(rows);
  if (!normalizedRows.length) throw badRequest("Aucune ligne conditionnement valide après contrôle.");

  let oldRows = [];
  let replaced = false;

  try {
    oldRows = await fetchAllRows(config.conditionings, CONDITIONING_SELECT, { order: "ref_5.asc" });

    await supabaseAdminFetch(`/rest/v1/${config.conditionings}?ref_5=neq.${encodeURIComponent("__KENT_NO_MATCH__")}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    replaced = true;

    await insertRows(config.conditionings, normalizedRows);

    return {
      ok: true,
      sector,
      imported: normalizedRows.length,
      oldRows: oldRows.length,
      importedBy: normalizeText(session?.name || session?.userId || "Admin"),
      message: `${normalizedRows.length} conditionnement(s) importé(s) pour ${config.label}.`
    };
  } catch (error) {
    if (replaced) {
      await safeRestoreConditionings(config, oldRows);
    }
    throw error;
  }
}

async function syncProducts(config, rows) {
  const products = await fetchAllRows(config.products, PRODUCT_SELECT, { order: "reference_produit.asc" });
  const productsByRef = buildProductMap(products);
  const creates = [];
  const updates = [];

  for (const row of rows) {
    const existing = productsByRef.get(row.referenceKey);
    const payload = {
      reference_produit: row.reference,
      nom: row.designation,
      prix_vente: row.price,
      actif: true
    };
    if (!existing) {
      creates.push(payload);
      continue;
    }
    if (
      normalizeText(existing.reference_produit) !== payload.reference_produit ||
      normalizeText(existing.nom) !== payload.nom ||
      Number(existing.prix_vente || 0) !== Number(payload.prix_vente || 0) ||
      existing.actif === false
    ) {
      updates.push({ id: existing.id, payload });
    }
  }

  if (creates.length) await insertRows(config.products, creates);
  if (updates.length) await patchRowsById(config.products, updates);
  return { created: creates.length, updated: updates.length };
}

async function patchRowsById(table, rows) {
  for (const group of chunkValues(rows, 40)) {
    await Promise.all(group.map((item) => supabaseAdminFetch(`/rest/v1/${table}?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(item.payload)
    })));
  }
}

async function safeRestoreTariffs(config, plaqueId, oldRows) {
  try {
    await supabaseAdminFetch(`/rest/v1/${config.tariffs}?plaque_id=eq.${encodeURIComponent(plaqueId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    if (oldRows.length) await insertRows(config.tariffs, oldRows);
  } catch (restoreError) {
    console.error("Rollback tarifs impossible:", restoreError);
  }
}

async function safeRestoreConditionings(config, oldRows) {
  try {
    await supabaseAdminFetch(`/rest/v1/${config.conditionings}?ref_5=neq.${encodeURIComponent("__KENT_NO_MATCH__")}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    if (oldRows.length) await insertRows(config.conditionings, oldRows);
  } catch (restoreError) {
    console.error("Rollback conditionnements impossible:", restoreError);
  }
}

function normalizeTariffRows(rows) {
  const byRef = new Map();
  for (const raw of rows) {
    const reference = normalizeText(raw?.reference || raw?.reference_produit || raw?.ref || raw?.code || raw?.code_stellantis);
    const designation = normalizeText(raw?.designation || raw?.nom || raw?.description || raw?.designation_produit);
    const price = toMoney(raw?.price ?? raw?.tarif ?? raw?.prix_vente ?? raw?.tarif_revente);
    const referenceKey = normalizeReferenceKey(reference);
    if (!reference || !designation || !referenceKey || !Number.isFinite(price) || price < 0) continue;
    if (byRef.has(referenceKey)) continue;
    byRef.set(referenceKey, { reference, designation, referenceKey, price });
  }
  return Array.from(byRef.values());
}

function normalizeConditioningRows(rows) {
  const byRef = new Map();
  for (const raw of rows) {
    const ref = normalizeText(raw?.ref_5 || raw?.reference || raw?.ref || raw?.["Ref."]);
    const key = normalizeReferenceKey(ref);
    const emballage = nullableText(raw?.emballage ?? raw?.embal ?? raw?.["Embal."]);
    if (!ref || !key || !emballage) continue;
    byRef.set(key, {
      ref_5: ref,
      code_produit: nullableText(raw?.code_produit),
      categorie: nullableText(raw?.categorie),
      famille: nullableText(raw?.famille),
      sous_famille: nullableText(raw?.sous_famille),
      description: nullableText(raw?.description || raw?.designation || raw?.designation_produit),
      grains: nullableText(raw?.grains),
      emballage,
      tarif_revente: raw?.tarif_revente === null || raw?.tarif_revente === undefined || raw?.tarif_revente === "" ? null : toMoney(raw.tarif_revente)
    });
  }
  return Array.from(byRef.values());
}

async function listCommercialUsers() {
  return fetchAllRows("portal_users", USER_SELECT, {
    filters: ["role=eq.commercial"],
    order: "display_name.asc"
  });
}

async function getCommercialById(id) {
  const rows = await fetchAllRows("portal_users", USER_SELECT, {
    filters: [`id=eq.${encodeURIComponent(id)}`, "role=eq.commercial"],
    limit: 1
  });
  return rows[0] || null;
}

async function listPlaques(config) {
  try {
    return await fetchAllRows(config.plaques, PLAQUE_SELECT, { order: "nom.asc" });
  } catch (error) {
    if (isMissingColumn(error)) {
      return fetchAllRows(config.plaques, PLAQUE_SELECT_SAFE, { order: "nom.asc" });
    }
    throw error;
  }
}

async function listAccessRows() {
  try {
    const rows = await fetchAllRows(ACCESS_TABLE, "id,commercial_user_id,secteur,plaque_id,created_at,created_by", {
      order: "created_at.asc"
    });
    return { ready: true, warning: "", rows };
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        ready: false,
        warning: "La table commercial_plaque_access n'existe pas encore. Lance le SQL fourni avant de gérer les droits plaques.",
        rows: []
      };
    }
    throw error;
  }
}

async function listAccessRowsFor(commercialId, sector) {
  const access = await fetchAllRows(ACCESS_TABLE, "id,commercial_user_id,secteur,plaque_id,created_at,created_by", {
    filters: [
      `commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
      `secteur=eq.${encodeURIComponent(sector)}`
    ],
    order: "created_at.asc"
  });
  return access;
}

async function assertAccessTableReady() {
  const access = await listAccessRows();
  if (!access.ready) throw badRequest(access.warning);
}

async function deleteAccessRows(commercialId, sector) {
  await supabaseAdminFetch(
    `/rest/v1/${ACCESS_TABLE}?commercial_user_id=eq.${encodeURIComponent(commercialId)}&secteur=eq.${encodeURIComponent(sector)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } }
  );
}

async function fetchAllRows(table, select, options = {}) {
  const rows = [];
  let offset = 0;
  const limit = Number.isFinite(Number(options.limit)) ? Math.min(PAGE_SIZE, Math.max(1, Number(options.limit))) : PAGE_SIZE;

  while (true) {
    const parts = [`select=${encodeURIComponent(select || "*")}`];
    if (options.order) parts.push(`order=${encodeURIComponent(options.order)}`);
    for (const filter of options.filters || []) parts.push(filter);
    parts.push(`limit=${limit}`);
    parts.push(`offset=${offset}`);
    const data = await supabaseAdminFetch(`/rest/v1/${table}?${parts.join("&")}`);
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < limit || options.limit) break;
    offset += limit;
  }

  return rows;
}

async function insertRows(table, rows, chunkSize = CHUNK_SIZE) {
  if (!rows.length) return;
  for (const chunk of chunkValues(rows, chunkSize)) {
    await supabaseAdminFetch(`/rest/v1/${table}`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(chunk)
    });
  }
}

function buildProductMap(products) {
  const map = new Map();
  for (const product of products || []) {
    const key = normalizeReferenceKey(product?.reference_produit);
    if (key && !map.has(key)) map.set(key, product);
  }
  return map;
}

function findPlaqueByName(list, name) {
  const target = normalizeComparable(name);
  return (list || []).find((row) => normalizeComparable(row?.nom) === target) || null;
}

function safeCommercial(user) {
  return {
    id: user.id || "",
    identifier: user.identifier || "",
    displayName: user.display_name || user.identifier || "Commercial",
    active: Boolean(user.active) && !user.hidden,
    hidden: Boolean(user.hidden) || !user.active
  };
}

function safePlaque(row, sector) {
  return {
    id: row?.id || "",
    name: row?.nom || "Plaque",
    sector,
    createdAt: row?.created_at || ""
  };
}

function safeAccess(row) {
  return {
    id: row?.id || "",
    commercialId: row?.commercial_user_id || "",
    sector: row?.secteur || "auto",
    plaqueId: row?.plaque_id || "",
    createdAt: row?.created_at || ""
  };
}

function resolveSector(value) {
  return normalizeComparable(value) === "industrie" ? "industrie" : "auto";
}

function normalizeUuid(value) {
  const id = normalizeText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function normalizeRequiredText(value, message) {
  const text = normalizeText(value);
  if (!text) throw badRequest(message);
  return text;
}

function normalizeComparable(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeReferenceKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function toMoney(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
  let cleaned = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/[€£$]/g, "")
    .replace(/[^0-9,.\-]/g, "");
  if (!cleaned) return NaN;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    cleaned = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    cleaned = cleaned.replace(",", ".");
  }
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function uniqueValues(values) {
  return [...new Set((values || []).map((value) => normalizeText(value)).filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function isMissingTable(error) {
  const text = normalizeComparable(`${error?.message || ""} ${error?.payload?.message || ""} ${error?.payload?.code || ""}`);
  return text.includes("does not exist") || text.includes("42p01") || text.includes("schema cache");
}

function isMissingColumn(error) {
  const text = normalizeComparable(`${error?.message || ""} ${error?.payload?.message || ""} ${error?.payload?.code || ""}`);
  return text.includes("column") || text.includes("42703") || text.includes("schema cache");
}

function isUniqueViolation(error) {
  const text = normalizeComparable(`${error?.message || ""} ${error?.payload?.message || ""} ${error?.payload?.code || ""}`);
  return text.includes("duplicate") || text.includes("unique") || text.includes("23505");
}

function friendlyError(error) {
  const message = normalizeText(error?.message || error?.payload?.message) || "Erreur référentiels admin.";
  const lower = message.toLowerCase();
  if (lower.includes("commercial_plaque_access")) {
    return "Droits plaques non prêts : lance le SQL supabase_commercial_plaque_access.sql dans Supabase.";
  }
  if (lower.includes("conditionnements_produits") || lower.includes("industrie_conditionnements_produits")) {
    return "Table conditionnements indisponible : vérifie le SQL conditionnement du secteur concerné.";
  }
  if (lower.includes("tarifs_plaques") || lower.includes("industrie_tarifs_plaques")) {
    return "Table tarifs indisponible : vérifie le SQL tarifs du secteur concerné.";
  }
  if (lower.includes("does not exist") || lower.includes("42p01") || lower.includes("schema cache")) {
    return "Structure Supabase indisponible : vérifie que le SQL du module concerné a bien été lancé.";
  }
  return message;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function readBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return request.body ? parseJson(request.body) : {};
  if (Buffer.isBuffer(request.body)) return parseJson(request.body.toString("utf8"));
  if (!request[Symbol.asyncIterator]) return {};

  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? parseJson(raw) : {};
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("JSON invalide.");
  }
}
