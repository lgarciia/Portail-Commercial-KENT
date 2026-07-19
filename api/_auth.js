import crypto from "node:crypto";

const COOKIE_NAME = "kent_portal_day";
const PARIS_TIMEZONE = "Europe/Paris";
const USER_CONFIG_ENV_NAMES = ["PORTAL_USERS", "ACCESS_USERS"];
const DEFAULT_SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";

export const ROLE_LABELS = {
  commercial: "Commercial",
  responsable: "Responsable",
  admin: "Administrateur"
};

export function getSessionFromRequest(request) {
  const authConfig = getAuthConfig();
  return parseSession(
    getCookie(request.headers.cookie, COOKIE_NAME),
    authConfig,
    getParisDayKey()
  );
}

export function requireRole(request, allowedRoles) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      status: 401,
      body: { error: "Session invalide ou expiree." }
    };
  }

  const allowed = new Set((allowedRoles || []).map(normalizeRole));
  if (allowed.size && !allowed.has(session.role)) {
    return {
      ok: false,
      status: 403,
      body: { error: "Droits insuffisants." }
    };
  }

  return { ok: true, session };
}

export function sendJson(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  response.status(status).json(payload);
}

export function getSupabaseAdminConfig() {
  const url = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const serviceKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();

  if (!url || !serviceKey) {
    return {
      ok: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY manque dans Vercel. Cette cle serveur est obligatoire pour gerer les utilisateurs."
    };
  }

  return {
    ok: true,
    url: url.replace(/\/+$/, ""),
    serviceKey
  };
}

export async function supabaseAdminFetch(path, options = {}) {
  const config = getSupabaseAdminConfig();
  if (!config.ok) {
    const error = new Error(config.error);
    error.code = "missing_service_role_key";
    throw error;
  }

  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const error = new Error(extractSupabaseError(payload) || `Supabase ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function normalizeRole(value) {
  const role = String(value || "commercial").trim().toLowerCase();
  if (role === "admin") return "admin";
  if (role === "responsable" || role === "manager") return "responsable";
  return "commercial";
}

export function normalizeText(value) {
  return String(value || "").trim();
}

function extractSupabaseError(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  return payload.message || payload.details || payload.hint || payload.error || "";
}

function getAuthConfig() {
  const legacyCode = String(process.env.ACCESS_DAILY_CODE || "").trim();
  const usersRaw = USER_CONFIG_ENV_NAMES
    .map((name) => String(process.env[name] || "").trim())
    .find(Boolean) || "";
  const secret = String(
    process.env.ACCESS_SESSION_SECRET ||
    process.env.PORTAL_SESSION_SECRET ||
    legacyCode ||
    usersRaw ||
    ""
  ).trim();

  return {
    legacyCode,
    secret: secret || "kent-portal-session"
  };
}

function getParisDayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return "";
  const parts = String(cookieHeader).split(";").map((item) => item.trim());
  const prefix = `${name}=`;
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return "";
}

function parseSession(value, authConfig, expectedDayKey) {
  if (!value || !expectedDayKey) return null;

  if (value.startsWith("v2.")) {
    return parseV2Session(value, authConfig.secret, expectedDayKey);
  }

  if (
    authConfig.legacyCode &&
    isValidLegacySession(value, authConfig.legacyCode, expectedDayKey)
  ) {
    return {
      userId: "legacy-commercial",
      dbUserId: "",
      name: "Commercial",
      role: "commercial",
      legacy: true,
      source: "legacy"
    };
  }

  return null;
}

function parseV2Session(value, secret, expectedDayKey) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;

  const [, encoded, signature] = parts;
  const expectedSignature = signValue(encoded, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (payload?.v !== 2 || payload?.dayKey !== expectedDayKey) return null;

    return {
      userId: String(payload.userId || ""),
      dbUserId: String(payload.dbUserId || ""),
      name: String(payload.name || "Utilisateur"),
      role: normalizeRole(payload.role),
      legacy: Boolean(payload.legacy),
      source: String(payload.source || "")
    };
  } catch {
    return null;
  }
}

function isValidLegacySession(value, accessCode, expectedDayKey) {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return false;

  const dayKey = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);

  if (!dayKey || !signature || dayKey !== expectedDayKey) return false;

  const expectedSignature = signValue(dayKey, accessCode);
  return safeEqual(signature, expectedSignature);
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
