import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const PAGE_SIZE = 1000;

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

    const [plaques, produits, tarifs] = await Promise.all([
      fetchAllRows(config.plaques, { order: config.plaqueOrder }),
      fetchAllRows(config.produits, { order: config.produitOrder }),
      fetchAllRows(config.tarifs, { order: config.tarifOrder })
    ]);

    sendJson(response, 200, {
      ok: true,
      secteur: sector,
      plaques,
      produits,
      tarifs
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

function resolveSector(value) {
  const sector = normalizeText(value).toLowerCase();
  return sector === "industrie" ? "industrie" : "auto";
}

function friendlyTariffError(error) {
  const message = normalizeText(error?.message) || "Tarifs indisponibles.";
  const lower = message.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("42p01")) {
    return "Structure Supabase tarifs indisponible. Vérifie que les tables tarifs sont bien présentes.";
  }
  return message;
}
