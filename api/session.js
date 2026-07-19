import crypto from "node:crypto";

const COOKIE_NAME = "kent_portal_day";
const PARIS_TIMEZONE = "Europe/Paris";
const USER_CONFIG_ENV_NAMES = ["PORTAL_USERS", "ACCESS_USERS"];
const ROLE_LABELS = {
  commercial: "Commercial",
  responsable: "Responsable",
  admin: "Administrateur"
};

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  response.setHeader("Cache-Control", "no-store");

  const authConfig = getAuthConfig();
  const session = parseSession(
    getCookie(request.headers.cookie, COOKIE_NAME),
    authConfig,
    getParisDayKey()
  );

  if (!session) {
    response.status(401).json({ authenticated: false });
    return;
  }

  response.status(200).json({
    authenticated: true,
    user: {
      id: session.userId,
      dbUserId: session.dbUserId || "",
      name: session.name || "Utilisateur",
      role: session.role,
      roleLabel: ROLE_LABELS[session.role] || "Utilisateur",
      source: session.source || (session.legacy ? "legacy" : "env"),
      legacy: Boolean(session.legacy)
    }
  });
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

function normalizeRole(value) {
  const role = String(value || "commercial").trim().toLowerCase();
  if (role === "admin") return "admin";
  if (role === "responsable" || role === "manager") return "responsable";
  return "commercial";
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
