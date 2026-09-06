import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const PAGE_SIZE = 1000;

const TABLES = {
  auto: "conditionnements_produits",
  industrie: "industrie_conditionnements_produits"
};

const CONDITIONNEMENT_SELECT = [
  "id",
  "ref_5",
  "code_produit",
  "categorie",
  "famille",
  "sous_famille",
  "description",
  "grains",
  "emballage",
  "tarif_revente",
  "imported_at",
  "created_at"
].join(",");

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
    const sector = normalizeText(url.searchParams.get("secteur") || url.searchParams.get("sector")).toLowerCase() === "industrie"
      ? "industrie"
      : "auto";

    const rows = await fetchAllRows(TABLES[sector]);
    sendJson(response, 200, {
      ok: true,
      secteur: sector,
      rows
    });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: friendlyConditionnementError(error)
    });
  }
}

async function fetchAllRows(table) {
  const rows = [];
  let offset = 0;

  while (true) {
    const path = [
      `/rest/v1/${table}?select=${encodeURIComponent(CONDITIONNEMENT_SELECT)}`,
      "order=ref_5.asc",
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`
    ].join("&");
    const batch = await safeArrayFetch(path);
    rows.push(...batch.map(normalizeConditionnementRow));
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function safeArrayFetch(path) {
  const data = await supabaseAdminFetch(path);
  return Array.isArray(data) ? data : [];
}

function normalizeConditionnementRow(row) {
  return {
    id: normalizeText(row.id),
    ref_5: normalizeText(row.ref_5),
    code_produit: normalizeText(row.code_produit),
    categorie: normalizeText(row.categorie),
    famille: normalizeText(row.famille),
    sous_famille: normalizeText(row.sous_famille),
    description: normalizeText(row.description),
    grains: normalizeText(row.grains),
    emballage: normalizeText(row.emballage),
    tarif_revente: toMoneyOrNull(row.tarif_revente),
    imported_at: normalizeText(row.imported_at),
    created_at: normalizeText(row.created_at)
  };
}

function toMoneyOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : null;
}

function friendlyConditionnementError(error) {
  const message = normalizeText(error?.message) || "Conditionnements indisponibles.";
  const lower = message.toLowerCase();
  if (lower.includes("does not exist") || lower.includes("42p01")) {
    return "Table conditionnements indisponible. Vérifie que le SQL conditionnements a bien été lancé.";
  }
  return message;
}
