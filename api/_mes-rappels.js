import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 120;
const TRACKED_COLORS = new Set(["red", "yellow", "green", "blue"]);

const SOURCES = [
  {
    key: "auto",
    sourceLabel: "Automobile",
    targetPage: "ficherclt.html",
    clients: "clients",
    visits: "visites",
    lines: "visite_commandes",
    products: "produits"
  },
  {
    key: "industrie",
    sourceLabel: "Industrie",
    targetPage: "ficherclt-industrie.html",
    clients: "industrie_clients",
    visits: "industrie_visites",
    lines: "industrie_visite_commandes",
    products: "industrie_produits"
  }
];

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

    const groups = await Promise.all(SOURCES.map((source) => loadSourceReminders(source, commercialId)));
    const rows = groups
      .flat()
      .sort((a, b) => {
        const da = a.date_visite ? new Date(a.date_visite).getTime() : 0;
        const db = b.date_visite ? new Date(b.date_visite).getTime() : 0;
        return db - da;
      });

    sendJson(response, 200, {
      ok: true,
      rows,
      stats: countByColor(rows)
    });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyReminderError(error)
    });
  }
}

async function loadSourceReminders(source, commercialId) {
  const [clients, visits] = await Promise.all([
    fetchAllRows(source.clients, "id,nom,numero_compte", {
      filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`],
      order: "nom.asc"
    }),
    fetchAllRows(source.visits, "id,client_id,date_visite,note", {
      filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`],
      order: "date_visite.desc,id.asc"
    })
  ]);

  const visitIds = uniqueValues(visits.map((row) => row.id));
  if (!visitIds.length) return [];

  const lines = await fetchRowsByChunks(source.lines, "*", "visite_id", visitIds, {
    order: "visite_id.asc,id.asc"
  });
  const reminderLines = lines.filter((line) => TRACKED_COLORS.has(normalizeColor(line.couleur)));
  if (!reminderLines.length) return [];

  const productIds = uniqueValues(reminderLines.map((row) => row.produit_id));
  const products = productIds.length
    ? await fetchRowsByChunks(source.products, "id,nom,reference_produit", "id", productIds, {
        order: "nom.asc"
      })
    : [];

  return buildReminderRows({
    source,
    clients,
    visits,
    products,
    lines: reminderLines
  });
}

function buildReminderRows({ source, clients, visits, products, lines }) {
  const visitsById = mapById(visits);
  const clientsById = mapById(clients);
  const productsById = mapById(products);

  return lines
    .map((line) => {
      const visit = visitsById.get(normalizeText(line.visite_id)) || null;
      if (!visit) return null;
      const client = clientsById.get(normalizeText(visit.client_id)) || null;
      const product = productsById.get(normalizeText(line.produit_id)) || null;
      const color = normalizeColor(line.couleur);
      if (!TRACKED_COLORS.has(color)) return null;

      return {
        client_id: normalizeText(visit.client_id),
        client_nom: normalizeText(client?.nom) || "[client introuvable]",
        numero_compte: normalizeText(client?.numero_compte) || "-",
        produit_nom: buildProductDisplay(product, line),
        source_label: source.sourceLabel,
        target_page: source.targetPage,
        date_visite: normalizeText(visit.date_visite),
        note: normalizeText(visit.note),
        couleur_norm: color
      };
    })
    .filter(Boolean);
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

function buildProductDisplay(product, line) {
  if (product) {
    const ref = normalizeText(product.reference_produit);
    const name = normalizeText(product.nom);
    if (ref && name) return `${ref} - ${name}`;
    return name || ref || `[produit introuvable: ${normalizeText(line?.produit_id) || "-"}]`;
  }

  const fallback =
    normalizeText(line?.produit_nom) ||
    normalizeText(line?.nom_produit) ||
    normalizeText(line?.reference_produit) ||
    normalizeText(line?.reference);

  return fallback || `[produit introuvable: ${normalizeText(line?.produit_id) || "-"}]`;
}

function countByColor(rows) {
  const stats = { red: 0, yellow: 0, green: 0, blue: 0, total: rows.length };
  rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(stats, row.couleur_norm)) {
      stats[row.couleur_norm] += 1;
    }
  });
  return stats;
}

function normalizeColor(value) {
  const color = normalizeText(value).toLowerCase();
  if (color === "rouge") return "red";
  if (color === "jaune") return "yellow";
  if (color === "vert") return "green";
  if (color === "bleu") return "blue";
  return color;
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function mapById(array) {
  const map = new Map();
  for (const item of array || []) {
    const id = normalizeText(item?.id);
    if (id) map.set(id, item);
  }
  return map;
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

function friendlyReminderError(error) {
  const message = normalizeText(error?.message) || "Rappels clients indisponibles.";
  const lower = message.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("42p01")) {
    return "Structure Supabase rappels indisponible. Vérifie que les tables commerciales sont bien présentes.";
  }
  return message;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}
