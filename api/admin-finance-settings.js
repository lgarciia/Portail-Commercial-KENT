import {
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const TABLE_NAME = "finance_source_settings";
const SELECT_COLUMNS = "id,annee,mois,source,updated_by,updated_at,created_at";

export default async function handler(request, response) {
  const allowedRoles = request.method === "GET" ? ["admin", "responsable"] : ["admin"];
  const guard = requireRole(request, allowedRoles);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadSettings(request));
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await saveSetting(body, guard.session));
      return;
    }

    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: error.message || "Parametres finance indisponibles."
    });
  }
}

async function loadSettings(request) {
  const url = new URL(request.url, "http://localhost");
  const year = clampYear(url.searchParams.get("year"));
  try {
    const rows = await supabaseAdminFetch(
      `/rest/v1/${TABLE_NAME}?select=${encodeURIComponent(SELECT_COLUMNS)}&annee=eq.${year}&order=mois.asc`
    );
    return {
      ok: true,
      ready: true,
      year,
      settings: Array.isArray(rows) ? rows.map(safeSetting) : []
    };
  } catch (error) {
    if (isMissingSettingsTable(error)) {
      return {
        ok: true,
        ready: false,
        year,
        settings: [],
        warning: "Table finance_source_settings absente. Lance le SQL de parametrage finance pour enregistrer les choix mensuels."
      };
    }
    throw error;
  }
}

async function saveSetting(body, session) {
  const year = clampYear(body?.year || body?.annee);
  const month = clampMonth(body?.month || body?.mois);
  const source = normalizeSource(body?.source);
  const updatedBy = normalizeText(session?.name || session?.userId || "admin");

  try {
    const rows = await supabaseAdminFetch(`/rest/v1/${TABLE_NAME}?on_conflict=annee,mois`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        annee: year,
        mois: month,
        source,
        updated_by: updatedBy,
        updated_at: new Date().toISOString()
      })
    });

    return {
      ok: true,
      ready: true,
      setting: safeSetting(Array.isArray(rows) ? rows[0] : rows)
    };
  } catch (error) {
    if (isMissingSettingsTable(error)) {
      const bad = new Error("Table finance_source_settings absente. Lance le SQL fourni avant d'enregistrer les choix finance.");
      bad.status = 400;
      throw bad;
    }
    throw error;
  }
}

function safeSetting(row) {
  return {
    id: row?.id || "",
    year: Number(row?.annee || 0),
    month: Number(row?.mois || 0),
    source: normalizeSource(row?.source),
    updatedBy: row?.updated_by || "",
    updatedAt: row?.updated_at || "",
    createdAt: row?.created_at || ""
  };
}

function normalizeSource(value) {
  const source = normalizeText(value).toLowerCase();
  return source === "real" ? "real" : "sales";
}

function clampYear(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return new Date().getFullYear();
  return Math.min(2100, Math.max(2020, Math.trunc(number)));
}

function clampMonth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(12, Math.max(1, Math.trunc(number)));
}

function isMissingSettingsTable(error) {
  const text = [
    error?.message,
    error?.payload?.message,
    error?.payload?.details,
    error?.payload?.hint,
    error?.payload?.code
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes(TABLE_NAME) || text.includes("42p01") || text.includes("does not exist");
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

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
