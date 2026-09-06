import {
  ROLE_LABELS,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 100;
const CURRENT_YEAR = new Date().getFullYear();
const VISIT_TYPE_PHONE_ORDER = "commande_telephone";
const PHONE_ORDER_NOTE_MARKER = "[COMMANDE_TELEPHONE]";
const CLIENT_SIZE_OPTIONS = ["S", "M", "L"];

const SOURCES = [
  {
    key: "auto",
    label: "Automobile",
    shortLabel: "Auto",
    clients: "clients",
    plaques: "plaques",
    visites: "visites",
    lignes: "visite_commandes"
  },
  {
    key: "industrie",
    label: "Industrie",
    shortLabel: "Industrie",
    clients: "industrie_clients",
    plaques: "industrie_plaques",
    visites: "industrie_visites",
    lignes: "industrie_visite_commandes"
  }
];

export default async function handler(request, response) {
  const guard = requireRole(request, ["commercial"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadClientQueryPayload(request, guard.session));
      return;
    }

    if (request.method === "PATCH") {
      sendJson(response, 200, await updateClientSizes(request, guard.session));
      return;
    }

    response.setHeader("Allow", "GET, PATCH");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyClientQueryError(error)
    });
  }
}

async function loadClientQueryPayload(request, session) {
  const commercialId = requireCommercialId(session);
  const url = new URL(request.url, "http://localhost");
  const mode = normalizeText(url.searchParams.get("mode")).toLowerCase();
  const year = normalizeYear(url.searchParams.get("year"));
  const windowInfo = computeYearWindow(year);

  const { plaques, clients } = await loadClientsAndPlaques(commercialId);

  if (mode === "clients") {
    return {
      ok: true,
      mode,
      user: sessionPayload(session),
      year,
      window: windowInfo,
      plaques,
      clients
    };
  }

  const [closedRows, currentRows] = await Promise.all([
    fetchClosedRealRows(commercialId, year, windowInfo.closedMonthLimit),
    windowInfo.currentToolMonth
      ? fetchCurrentSalesRows(commercialId, year, windowInfo.currentToolMonth)
      : Promise.resolve([])
  ]);

  return {
    ok: true,
    mode: "query",
    user: sessionPayload(session),
    year,
    window: windowInfo,
    plaques,
    clients,
    closedRows,
    currentRows
  };
}

async function loadClientsAndPlaques(commercialId) {
  const plaqueGroups = await Promise.all(SOURCES.map(fetchPlaquesForSource));
  const plaques = plaqueGroups.flat();
  const plaqueByKey = new Map(plaques.map((plaque) => [plaque.key, plaque]));

  const clientGroups = await Promise.all(
    SOURCES.map((source) => fetchClientsForSource(source, commercialId, plaqueByKey))
  );

  return {
    plaques,
    clients: clientGroups.flat()
  };
}

async function fetchPlaquesForSource(source) {
  const rows = await fetchAllRows(source.plaques, "id,nom", {
    order: "nom.asc"
  });

  return rows.map((row) => ({
    id: normalizeText(row.id),
    key: `${source.key}|${normalizeText(row.id)}`,
    source: source.key,
    sourceLabel: source.label,
    nom: normalizeText(row.nom)
  }));
}

async function fetchClientsForSource(source, commercialId, plaqueByKey) {
  let rows = [];
  try {
    rows = await fetchAllRows(
      source.clients,
      "id,nom,numero_compte,adresse,telephone,plaque_id,taille_client,commercial_user_id",
      {
        filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`],
        order: "nom.asc"
      }
    );
  } catch (error) {
    if (!isMissingColumnError(error, "taille_client")) throw error;
    rows = (await fetchAllRows(
      source.clients,
      "id,nom,numero_compte,adresse,telephone,plaque_id,commercial_user_id",
      {
        filters: [`commercial_user_id=eq.${encodeURIComponent(commercialId)}`],
        order: "nom.asc"
      }
    )).map((row) => ({ ...row, taille_client: "S" }));
  }

  return rows.map((row) => {
    const plaqueId = normalizeText(row.plaque_id);
    const plaqueKey = `${source.key}|${plaqueId}`;
    return {
      id: normalizeText(row.id),
      rowKey: `${source.key}|${normalizeText(row.id)}`,
      source: source.key,
      sourceLabel: source.label,
      sourceShortLabel: source.shortLabel,
      nom: normalizeText(row.nom) || "Client sans nom",
      numeroCompte: normalizeText(row.numero_compte),
      adresse: normalizeText(row.adresse),
      plaqueId,
      plaqueKey,
      plaqueNom: plaqueByKey.get(plaqueKey)?.nom || "Sans plaque",
      tailleClient: normalizeClientSize(row.taille_client)
    };
  });
}

async function fetchClosedRealRows(commercialId, year, closedMonthLimit) {
  if (closedMonthLimit < 1) return [];

  return fetchAllRows(
    "v_reel_lignes_actives",
    "id,commercial_user_id,annee,mois,client_code,client_nom,montant,date_piece,entite_key,entite_libelle",
    {
      filters: [
        `commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
        `annee=eq.${encodeURIComponent(year)}`,
        `mois=lte.${encodeURIComponent(closedMonthLimit)}`
      ],
      order: "mois.asc,client_nom.asc"
    }
  );
}

async function fetchCurrentSalesRows(commercialId, year, month) {
  try {
    const rows = await fetchAllRows(
      "v_kent_dashboard_sales_lines",
      "source,client_id,client_nom,numero_compte,date,annee,mois,type_visite,note,montant",
      {
        filters: [
          `commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
          `annee=eq.${encodeURIComponent(year)}`,
          `mois=eq.${encodeURIComponent(month)}`
        ],
        order: "date.desc"
      }
    );
    return rows.filter(isCurrentMonthOrderRow).map(normalizeCurrentSaleRow);
  } catch (error) {
    if (!isMissingFastSalesViewError(error)) throw error;
    return fetchCurrentSalesRowsLegacy(commercialId, year, month);
  }
}

async function fetchCurrentSalesRowsLegacy(commercialId, year, month) {
  const groups = await Promise.all(
    SOURCES.map(async (source) => {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const end = monthEndIso(year, month);
      const visites = await fetchAllRows(
        source.visites,
        "id,client_id,date_visite,type_visite,note,total_commande",
        {
          filters: [
            `commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
            `date_visite=gte.${encodeURIComponent(start)}`,
            `date_visite=lte.${encodeURIComponent(end)}`
          ],
          order: "date_visite.desc,id.asc"
        }
      );
      const visitIds = uniqueValues(visites.map((visite) => visite.id));
      if (!visitIds.length) return [];

      const lignes = await fetchRowsByChunks(
        source.lignes,
        "id,visite_id,quantite,prix_unitaire",
        "visite_id",
        visitIds,
        { order: "visite_id.asc,id.asc" }
      );
      const visitById = new Map(visites.map((visite) => [normalizeText(visite.id), visite]));

      return lignes
        .map((ligne) => {
          const visite = visitById.get(normalizeText(ligne.visite_id));
          if (!visite || !isCurrentMonthOrderRow(visite)) return null;
          return normalizeCurrentSaleRow({
            source: source.key,
            client_id: visite.client_id,
            date: visite.date_visite,
            annee: year,
            mois: month,
            type_visite: visite.type_visite,
            note: visite.note,
            montant: toNumber(ligne.quantite) * toNumber(ligne.prix_unitaire)
          });
        })
        .filter(Boolean);
    })
  );

  return groups.flat();
}

async function updateClientSizes(request, session) {
  const commercialId = requireCommercialId(session);
  const body = await readJsonBody(request);
  const changes = Array.isArray(body?.changes) ? body.changes : [];
  if (!changes.length) {
    throw badRequest("Aucune taille client à enregistrer.");
  }
  if (changes.length > 500) {
    throw badRequest("Trop de modifications en une seule fois. Limite : 500 clients.");
  }

  const updated = [];
  for (const change of changes) {
    const source = SOURCES.find((item) => item.key === normalizeText(change?.source).toLowerCase());
    const clientId = normalizeUuid(change?.id);
    const size = normalizeClientSize(change?.size);
    if (!source || !clientId) {
      throw badRequest("Modification client invalide.");
    }

    const result = await supabaseAdminFetch(
      `/rest/v1/${source.clients}?select=${encodeURIComponent("id")}&id=eq.${encodeURIComponent(clientId)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ taille_client: size })
      }
    );

    if (!Array.isArray(result) || !result.length) {
      throw forbidden(`Aucun client modifié pour ${normalizeText(change?.name) || clientId}.`);
    }

    updated.push({
      source: source.key,
      id: clientId,
      rowKey: `${source.key}|${clientId}`,
      size
    });
  }

  return {
    ok: true,
    updated
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
  for (const chunk of chunkValues(uniqueValues(values), CHUNK_SIZE)) {
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

async function readJsonBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  const raw = await readBodyText(request);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("Corps JSON invalide.");
  }
}

async function readBodyText(request) {
  if (typeof request.body === "string") return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString("utf8");
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function computeYearWindow(year) {
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  if (year === nowYear) {
    return {
      currentMonth: nowMonth,
      currentToolMonth: nowMonth,
      closedMonthLimit: Math.max(0, nowMonth - 1)
    };
  }

  if (year < nowYear) {
    return {
      currentMonth: 12,
      currentToolMonth: null,
      closedMonthLimit: 12
    };
  }

  return {
    currentMonth: 1,
    currentToolMonth: null,
    closedMonthLimit: 0
  };
}

function normalizeYear(value) {
  const year = Number(value);
  if (Number.isInteger(year) && year >= 2020 && year <= 2100) return year;
  return CURRENT_YEAR;
}

function normalizeCurrentSaleRow(row) {
  return {
    source: normalizeText(row.source) || "auto",
    client_id: normalizeText(row.client_id),
    client_nom: normalizeText(row.client_nom),
    numero_compte: normalizeText(row.numero_compte),
    date: normalizeText(row.date).slice(0, 10),
    annee: Number(row.annee) || 0,
    mois: Number(row.mois) || 0,
    type_visite: normalizeText(row.type_visite),
    note: normalizeText(row.note),
    montant: roundMoney(row.montant)
  };
}

function isCurrentMonthOrderRow(row) {
  const type = normalizeText(row.type_visite).toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (type === "passage_sans_vente" || type === "client_ferme") return false;
  if (type === VISIT_TYPE_PHONE_ORDER || type === "commande_tel" || type === "telephone") return true;
  if (normalizeText(row.note).includes(PHONE_ORDER_NOTE_MARKER)) return true;
  return !type || type === "vente" || type === "visite" || type === "commande";
}

function isMissingFastSalesViewError(error) {
  const message = [
    error?.message,
    error?.payload?.message,
    error?.payload?.details,
    error?.payload?.hint
  ].filter(Boolean).join(" ");
  return /v_kent_dashboard_sales_lines|does not exist|not found|schema cache|42p01/i.test(message);
}

function isMissingColumnError(error, columnName) {
  const message = [
    error?.message,
    error?.payload?.message,
    error?.payload?.details,
    error?.payload?.hint
  ].filter(Boolean).join(" ");
  const escapedColumn = String(columnName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escapedColumn, "i").test(message)
    && /(schema cache|column|does not exist|could not find|introuvable|existe pas)/i.test(message);
}

function requireCommercialId(session) {
  const commercialId = normalizeUuid(session?.dbUserId);
  if (!commercialId) {
    throw forbidden("Compte commercial non rattaché. Reconnecte-toi avec un utilisateur commercial valide.");
  }
  return commercialId;
}

function sessionPayload(session) {
  return {
    id: normalizeText(session.userId),
    dbUserId: normalizeText(session.dbUserId),
    name: normalizeText(session.name) || "Utilisateur",
    role: session.role,
    roleLabel: ROLE_LABELS[session.role] || "Utilisateur"
  };
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  return UUID_RE.test(text) ? text : "";
}

function normalizeClientSize(value) {
  const size = normalizeText(value).toUpperCase();
  return CLIENT_SIZE_OPTIONS.includes(size) ? size : "S";
}

function monthEndIso(year, month) {
  const date = new Date(Number(year), Number(month), 0);
  if (Number.isNaN(date.getTime())) return "";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
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

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function friendlyClientQueryError(error) {
  const message = normalizeText(error?.message) || "Requête client indisponible.";
  const lower = message.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("42p01")) {
    return "Structure de données indisponible. Vérifie que les tables commerciales sont bien présentes.";
  }
  return message;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}
