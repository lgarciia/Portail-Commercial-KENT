import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const PAGE_SIZE = 1000;
const ACCESS_TABLE = "commercial_plaque_access";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SECTORS = {
  auto: {
    plaques: "plaques",
    produits: "produits",
    tarifs: "tarifs_plaques",
    plaqueOrder: "nom.asc",
    produitOrder: "reference_produit.asc",
    tarifOrder: "produit_id.asc"
  },
  industrie: {
    plaques: "industrie_plaques",
    produits: "industrie_produits",
    tarifs: "industrie_tarifs_plaques",
    plaqueOrder: "nom.asc",
    produitOrder: "reference_produit.asc",
    tarifOrder: "produit_id.asc"
  }
};

export default async function handler(request, response) {
  const guard = requireRole(request, ["commercial"]);
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

    const url = new URL(request.url, "http://localhost");
    const sector = resolveSector(url.searchParams.get("secteur") || url.searchParams.get("sector"));
    const config = SECTORS[sector];

    const [plaques, produits, tarifs, access] = await Promise.all([
      fetchAllRows(config.plaques, { order: config.plaqueOrder }),
      fetchAllRows(config.produits, { order: config.produitOrder }),
      fetchAllRows(config.tarifs, { order: config.tarifOrder }),
      getPlaqueAccess(sector, guard.session.dbUserId)
    ]);

    const allowedPlaqueIds = new Set(access.ids);
    const visiblePlaques = access.ready
      ? plaques.filter((plaque) => allowedPlaqueIds.has(normalizeText(plaque.id)))
      : plaques;
    const visibleTarifs = access.ready
      ? tarifs.filter((tarif) => allowedPlaqueIds.has(normalizeText(tarif.plaque_id)))
      : tarifs;

    sendJson(response, 200, {
      ok: true,
      secteur: sector,
      plaques: visiblePlaques,
      produits,
      tarifs: visibleTarifs,
      accessApplied: access.ready,
      allowedPlaqueIds: access.ready ? access.ids : null,
      accessWarning: access.warning
    });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyTariffError(error)
    });
  }
}

async function fetchAllRows(table, options = {}) {
  const rows = [];
  let offset = 0;

  while (true) {
    const query = [
      `/rest/v1/${table}?select=*`,
      options.order ? `order=${encodeURIComponent(options.order)}` : "",
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`
    ].filter(Boolean);

    const batch = await safeArrayFetch(query.join("&"));
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function safeArrayFetch(path) {
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

async function getPlaqueAccess(sector, commercialId) {
  const id = normalizeUuid(commercialId);
  if (!id) return { ready: false, ids: [], warning: "Session commerciale historique : droits plaques non appliqués." };

  try {
    const rows = await safeArrayFetch(
      `/rest/v1/${ACCESS_TABLE}?select=plaque_id&commercial_user_id=eq.${encodeURIComponent(id)}&secteur=eq.${encodeURIComponent(sector)}`
    );
    return {
      ready: true,
      ids: rows.map((row) => normalizeText(row.plaque_id)).filter(Boolean),
      warning: ""
    };
  } catch (error) {
    if (isMissingAccessTable(error)) {
      return {
        ready: false,
        ids: [],
        warning: "Droits plaques non configurés : lance le SQL commercial_plaque_access pour activer le filtrage."
      };
    }
    throw error;
  }
}

function resolveSector(value) {
  const sector = normalizeText(value).toLowerCase();
  return sector === "industrie" ? "industrie" : "auto";
}

function normalizeUuid(value) {
  const id = normalizeText(value);
  return UUID_RE.test(id) ? id : "";
}

function isMissingAccessTable(error) {
  const message = normalizeText(`${error?.message || ""} ${error?.payload?.message || ""} ${error?.payload?.code || ""}`).toLowerCase();
  return message.includes("commercial_plaque_access") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("42p01");
}

function friendlyTariffError(error) {
  const message = normalizeText(error?.message) || "Tarifs indisponibles.";
  const lower = message.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("42p01")) {
    return "Structure Supabase tarifs indisponible. Vérifie que les tables tarifs sont bien présentes.";
  }
  return message;
}
