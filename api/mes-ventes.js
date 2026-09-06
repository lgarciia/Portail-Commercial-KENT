import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 120;

const SECTORS = {
  auto: {
    key: "auto",
    clients: "clients",
    products: "produits",
    visits: "visites",
    lines: "visite_commandes",
    plaques: "plaques",
    clientSelect: "id,nom,numero_compte,adresse,telephone,plaque_id,plaques(id,nom)"
  },
  industrie: {
    key: "industrie",
    clients: "industrie_clients",
    products: "industrie_produits",
    visits: "industrie_visites",
    lines: "industrie_visite_commandes",
    plaques: "industrie_plaques",
    clientSelect: "id,nom,numero_compte,adresse,telephone,plaque_id"
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

    const commercialId = normalizeUuid(guard.session.dbUserId);
    if (!commercialId) {
      throw forbidden("Compte commercial non rattaché. Reconnecte-toi avec un utilisateur commercial valide.");
    }

    const url = new URL(request.url, "http://localhost");
    const sector = resolveSector(url.searchParams.get("secteur") || url.searchParams.get("sector"));
    sendJson(response, 200, await loadSalesData(SECTORS[sector], commercialId));
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlySalesError(error)
    });
  }
}

async function loadSalesData(config, commercialId) {
  const [clients, visits, plaques] = await Promise.all([
    fetchAllRows(config.clients, config.clientSelect, {
      filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`],
      order: "nom.asc"
    }),
    fetchAllRows(config.visits, "id,client_id,date_visite,note,type_visite,total_commande", {
      filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`],
      order: "date_visite.desc,id.asc"
    }),
    config.key === "industrie"
      ? fetchAllRows(config.plaques, "id,nom", { order: "nom.asc" })
      : Promise.resolve([])
  ]);

  const visitIds = uniqueValues(visits.map((row) => row.id));
  const lines = visitIds.length
    ? await fetchRowsByChunks(config.lines, "id,visite_id,produit_id,quantite,stock_client,couleur,prix_unitaire", "visite_id", visitIds, {
        order: "visite_id.asc,id.asc"
      })
    : [];

  const productIds = uniqueValues(lines.map((row) => row.produit_id));
  const products = productIds.length
    ? await fetchRowsByChunks(config.products, "id,nom,actif,reference_produit,prix_vente", "id", productIds, {
        order: "nom.asc"
      })
    : [];

  return {
    ok: true,
    secteur: config.key,
    clients,
    produits: products,
    visites: visits,
    lignesCommandes: lines,
    plaques
  };
}

async function fetchAllRows(table, select, options = {}) {
  const rows = [];
  let offset = 0;

  while (true) {
    const query = [
      `/rest/v1/${table}?select=${encodeURIComponent(select)}`,
      ...(options.filters || []),
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

async function fetchRowsByChunks(table, select, column, values, options = {}) {
  const rows = [];
  for (const chunk of chunkValues(values, CHUNK_SIZE)) {
    const query = [
      `/rest/v1/${table}?select=${encodeURIComponent(select)}`,
      `${column}=${encodeURIComponent(inFilter(chunk))}`,
      options.order ? `order=${encodeURIComponent(options.order)}` : ""
    ].filter(Boolean);
    rows.push(...await safeArrayFetch(query.join("&")));
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

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function uniqueValues(values) {
  return [...new Set((values || []).map((value) => normalizeText(value)).filter(Boolean))];
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function inFilter(values) {
  return `in.(${values.map((value) => String(value).trim()).filter(Boolean).join(",")})`;
}

function friendlySalesError(error) {
  const message = normalizeText(error?.message) || "Ventes indisponibles.";
  const lower = message.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("42p01")) {
    return "Structure Supabase ventes indisponible. Vérifie que les tables commerciales sont bien présentes.";
  }
  return message;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}
