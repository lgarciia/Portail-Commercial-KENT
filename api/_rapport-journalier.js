import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 120;

const SOURCES = {
  auto: {
    key: "auto",
    label: "Auto",
    visits: "visites",
    lines: "visite_commandes",
    clients: "clients",
    products: "produits"
  },
  industrie: {
    key: "industrie",
    label: "Industrie",
    visits: "industrie_visites",
    lines: "industrie_visite_commandes",
    clients: "industrie_clients",
    products: "industrie_produits"
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
    const reportDate = normalizeText(url.searchParams.get("date"));
    if (!DATE_RE.test(reportDate)) {
      sendJson(response, 400, { error: "Date de rapport invalide." });
      return;
    }

    const sector = resolveSector(url.searchParams.get("secteur") || url.searchParams.get("sector"));
    const selectedSources = sector === "global"
      ? [SOURCES.auto, SOURCES.industrie]
      : [SOURCES[sector]];

    const groups = await Promise.all(
      selectedSources.map((source) => loadSourceVisits(source, commercialId, reportDate, sector === "global"))
    );

    const visites = groups
      .flat()
      .sort((a, b) => {
        return (
          normalizeText(a.date_visite).localeCompare(normalizeText(b.date_visite)) ||
          normalizeText(a.source_label).localeCompare(normalizeText(b.source_label), "fr") ||
          normalizeText(a.client?.nom).localeCompare(normalizeText(b.client?.nom), "fr")
        );
      });

    sendJson(response, 200, {
      ok: true,
      secteur: sector,
      date: reportDate,
      visites
    });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyReportError(error)
    });
  }
}

async function loadSourceVisits(source, commercialId, reportDate, prefixIds) {
  const visites = await fetchAllRows(
    source.visits,
    "id,client_id,date_visite,note,type_visite,total_commande",
    {
      filters: [
        `commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
        `date_visite=eq.${encodeURIComponent(reportDate)}`
      ],
      order: "date_visite.asc,id.asc"
    }
  );

  const visiteIds = uniqueValues(visites.map((visite) => visite.id));
  const clientIds = uniqueValues(visites.map((visite) => visite.client_id));

  const [commandes, clients] = await Promise.all([
    visiteIds.length ? fetchCommandRows(source.lines, visiteIds) : Promise.resolve([]),
    clientIds.length ? fetchClientRows(source.clients, clientIds) : Promise.resolve([])
  ]);

  const produitIds = uniqueValues(commandes.map((commande) => commande.produit_id));
  const produits = produitIds.length
    ? await fetchRowsByChunks(
        source.products,
        "id,nom,reference_produit,prix_vente",
        "id",
        produitIds,
        { order: "nom.asc" }
      )
    : [];

  return buildVisits(source, {
    visites,
    commandes,
    clients,
    produits,
    prefixIds
  });
}

async function fetchCommandRows(table, visitIds) {
  try {
    return await fetchRowsByChunks(
      table,
      "id,visite_id,produit_id,quantite,stock_client,couleur,prix_unitaire,demo_effectuee",
      "visite_id",
      visitIds,
      { order: "visite_id.asc,id.asc" }
    );
  } catch (error) {
    if (!isMissingColumnError(error, "demo_effectuee")) throw error;
    const rows = await fetchRowsByChunks(
      table,
      "id,visite_id,produit_id,quantite,stock_client,couleur,prix_unitaire",
      "visite_id",
      visitIds,
      { order: "visite_id.asc,id.asc" }
    );
    return rows.map((row) => ({ ...row, demo_effectuee: false }));
  }
}

async function fetchClientRows(table, clientIds) {
  try {
    return await fetchRowsByChunks(
      table,
      "id,nom,numero_compte,adresse,telephone,taille_client",
      "id",
      clientIds,
      { order: "nom.asc" }
    );
  } catch (error) {
    if (!isMissingColumnError(error, "taille_client")) throw error;
    const rows = await fetchRowsByChunks(
      table,
      "id,nom,numero_compte,adresse,telephone",
      "id",
      clientIds,
      { order: "nom.asc" }
    );
    return rows.map((row) => ({ ...row, taille_client: "S" }));
  }
}

function buildVisits(source, { visites, commandes, clients, produits, prefixIds }) {
  const clientsById = mapById(clients);
  const produitsById = mapById(produits);
  const commandesByVisiteId = new Map();

  commandes.forEach((commande) => {
    const key = normalizeText(commande.visite_id);
    if (!key) return;
    if (!commandesByVisiteId.has(key)) commandesByVisiteId.set(key, []);
    commandesByVisiteId.get(key).push(commande);
  });

  return visites.map((visite) => {
    const rawClient = clientsById.get(normalizeText(visite.client_id)) || null;
    const client = rawClient ? normalizeClient(rawClient, source, prefixIds) : null;

    return {
      id: normalizeEntityId(visite.id, source, prefixIds),
      source_key: source.key,
      source_label: source.label,
      source_visite_id: normalizeText(visite.id),
      client_id: normalizeEntityId(visite.client_id, source, prefixIds),
      date_visite: normalizeText(visite.date_visite),
      note: normalizeText(visite.note),
      type_visite: normalizeText(visite.type_visite),
      total_commande: toNumber(visite.total_commande),
      client,
      commandes: (commandesByVisiteId.get(normalizeText(visite.id)) || []).map((commande) => {
        const rawProduit = produitsById.get(normalizeText(commande.produit_id)) || null;
        const produit = rawProduit ? normalizeProduct(rawProduit, source, prefixIds) : null;
        const prixUnitaire = toNumber(commande.prix_unitaire) || toNumber(rawProduit?.prix_vente);
        const quantite = toNumber(commande.quantite);

        return {
          id: normalizeEntityId(commande.id, source, prefixIds),
          source_key: source.key,
          source_label: source.label,
          source_commande_id: normalizeText(commande.id),
          produit_id: normalizeEntityId(commande.produit_id, source, prefixIds),
          quantite,
          stock_client: toNumber(commande.stock_client),
          couleur: normalizeText(commande.couleur),
          demo_effectuee: Boolean(commande.demo_effectuee),
          prix_unitaire: prixUnitaire,
          montant_ligne: quantite * prixUnitaire,
          produit
        };
      })
    };
  });
}

function normalizeClient(client, source, prefixIds) {
  return {
    ...client,
    id: normalizeEntityId(client.id, source, prefixIds),
    nom: normalizeText(client.nom),
    numero_compte: normalizeText(client.numero_compte),
    adresse: normalizeText(client.adresse),
    telephone: normalizeText(client.telephone),
    taille_client: normalizeClientSize(client.taille_client),
    source_key: source.key,
    source_label: source.label
  };
}

function normalizeProduct(product, source, prefixIds) {
  return {
    ...product,
    id: normalizeEntityId(product.id, source, prefixIds),
    nom: normalizeText(product.nom),
    reference_produit: normalizeText(product.reference_produit),
    prix_vente: toNumber(product.prix_vente),
    source_key: source.key,
    source_label: source.label
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
  if (sector === "industrie") return "industrie";
  if (sector === "global" || sector === "all") return "global";
  return "auto";
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function normalizeClientSize(value) {
  const size = normalizeText(value).toUpperCase();
  return ["S", "M", "L"].includes(size) ? size : "S";
}

function normalizeEntityId(value, source, prefixIds) {
  const text = normalizeText(value);
  if (!prefixIds || !text) return text;
  return `${source.key}:${text}`;
}

function mapById(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const id = normalizeText(row?.id);
    if (id) map.set(id, row);
  });
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function isMissingColumnError(error, columnName) {
  const text = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint
  ].filter(Boolean).join(" ");
  return text.toLowerCase().includes(normalizeText(columnName).toLowerCase()) &&
    /(column|schema|cache|exist|introuvable|trouve|find)/i.test(text);
}

function friendlyReportError(error) {
  const message = normalizeText(error?.message) || "Rapport journalier indisponible.";
  const lower = message.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("42p01")) {
    return "Structure de rapport indisponible. Vérifie que les tables commerciales sont bien présentes.";
  }
  return message;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}
