const ACCESS_PAGE = "/acces.html";
const LOGOUT_PATH = "/deconnexion";
const COOKIE_NAME = "kent_portal_day";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 36;
const PARIS_TIMEZONE = "Europe/Paris";
const USER_CONFIG_ENV_NAMES = ["PORTAL_USERS", "ACCESS_USERS"];
const ROLE_HOME = {
  commercial: "/",
  responsable: "/responsable.html",
  admin: "/admin.html"
};
const ROLE_LABELS = {
  commercial: "Commercial",
  responsable: "Responsable",
  admin: "Admin"
};
const PUBLIC_PATHS = new Set([
  ACCESS_PAGE,
  "/kent-logo.svg",
  "/reporting-hero.png"
]);
const ROLE_GUARDS = [
  { path: "/admin.html", roles: new Set(["admin"]) },
  { path: "/responsable.html", roles: new Set(["admin", "responsable"]) }
];

export const config = {
  matcher: "/:path*"
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const authConfig = getAuthConfig();
  const todayKey = getParisDayKey();
  const currentSession = getCookie(request.headers.get("cookie"), COOKIE_NAME);
  const session = currentSession
    ? await parseSession(currentSession, authConfig, todayKey)
    : null;
  const isAuthenticated = Boolean(session);

  if (pathname === LOGOUT_PATH) {
    return buildRedirect(url, withQuery(ACCESS_PAGE, { logout: "1" }), {
      "Set-Cookie": clearSessionCookie(url)
    });
  }

  if (pathname === ACCESS_PAGE) {
    if (request.method === "POST") {
      return handleAccessAttempt(request, url, authConfig, todayKey);
    }

    if (isAuthenticated) {
      return buildRedirect(
        url,
        resolveRoleRedirect(session, sanitizeNext(url.searchParams.get("next")))
      );
    }

    return;
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return;
  }

  if (!isAuthenticated) {
    return buildRedirect(
      url,
      withQuery(ACCESS_PAGE, {
        next: sanitizeNext(pathname + url.search),
        ...(authConfig.enabled ? {} : { error: "config" })
      })
    );
  }

  const deniedRedirect = getRoleDeniedRedirect(pathname, session);
  if (deniedRedirect) {
    return buildRedirect(url, deniedRedirect);
  }
}

async function handleAccessAttempt(request, url, authConfig, todayKey) {
  const form = await request.formData();
  const identifier = String(form.get("identifier") || "").trim();
  const submittedCode = String(form.get("code") || "").trim();
  const nextPath = sanitizeNext(form.get("next"));

  if (!authConfig.enabled) {
    return buildRedirect(
      url,
      withQuery(ACCESS_PAGE, {
        error: "config",
        next: nextPath
      }),
      { "Set-Cookie": clearSessionCookie(url) }
    );
  }

  const user = await authenticateSubmittedUser(identifier, submittedCode, authConfig);
  if (!user) {
    return buildRedirect(
      url,
      withQuery(ACCESS_PAGE, {
        error: "invalid",
        next: nextPath
      }),
      { "Set-Cookie": clearSessionCookie(url) }
    );
  }

  const sessionValue = await createSession(todayKey, user, authConfig.secret);
  return buildRedirect(url, resolveRoleRedirect(user, nextPath), {
    "Set-Cookie": serializeSessionCookie(url, sessionValue)
  });
}

function getAuthConfig() {
  const legacyCode = String(process.env.ACCESS_DAILY_CODE || "").trim();
  const usersRaw = USER_CONFIG_ENV_NAMES
    .map((name) => String(process.env[name] || "").trim())
    .find(Boolean) || "";
  const users = parsePortalUsers(usersRaw);
  const secret = String(
    process.env.ACCESS_SESSION_SECRET ||
    process.env.PORTAL_SESSION_SECRET ||
    legacyCode ||
    usersRaw ||
    ""
  ).trim();

  return {
    enabled: Boolean(legacyCode || users.length),
    legacyCode,
    secret: secret || "kent-portal-session",
    users
  };
}

function parsePortalUsers(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.users)
        ? parsed.users
        : Object.values(parsed || {});

    return list
      .map(normalizePortalUser)
      .filter((user) => user.id && user.active !== false);
  } catch (error) {
    console.error("PORTAL_USERS invalide:", error);
    return [];
  }
}

function normalizePortalUser(raw) {
  const id = String(raw?.id || raw?.identifier || raw?.login || "").trim();
  const role = normalizeRole(raw?.role);
  const name = String(raw?.name || raw?.label || id || ROLE_LABELS[role]).trim();
  const password = String(raw?.password || raw?.code || raw?.accessCode || "").trim();
  const passwordHash = String(raw?.passwordHash || raw?.password_sha256 || "").trim().toLowerCase();
  const redirect = sanitizeNext(raw?.redirect || ROLE_HOME[role] || "/");

  return {
    id,
    lookup: normalizeIdentifier(id),
    name,
    role,
    password,
    passwordHash,
    redirect,
    active: raw?.active !== false && raw?.actif !== false
  };
}

function normalizeRole(value) {
  const role = String(value || "commercial").trim().toLowerCase();
  if (role === "admin") return "admin";
  if (role === "responsable" || role === "manager") return "responsable";
  return "commercial";
}

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function authenticateSubmittedUser(identifier, submittedCode, authConfig) {
  if (!submittedCode) return null;

  const lookup = normalizeIdentifier(identifier);
  if (lookup && authConfig.users.length) {
    const user = authConfig.users.find((item) => item.lookup === lookup);
    if (user && (await isValidPassword(submittedCode, user))) {
      return user;
    }
    return null;
  }

  if (authConfig.legacyCode && submittedCode === authConfig.legacyCode) {
    return {
      id: "legacy-commercial",
      name: "Commercial",
      role: "commercial",
      redirect: "/",
      legacy: true
    };
  }

  return null;
}

async function isValidPassword(submittedCode, user) {
  if (user.passwordHash) {
    const submittedHash = await digestHex(submittedCode);
    return safeEqual(submittedHash, user.passwordHash);
  }

  return Boolean(user.password) && safeEqual(submittedCode, user.password);
}

function getParisDayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function withQuery(path, params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (!value) return;
    search.set(key, value);
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function sanitizeNext(value) {
  if (typeof value !== "string" || !value.trim()) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

function getCookie(header, name) {
  if (!header) return "";
  const parts = header.split(";").map((item) => item.trim());
  const prefix = `${name}=`;
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return "";
}

async function createSession(dayKey, user, secret) {
  const payload = {
    v: 2,
    dayKey,
    userId: user.id,
    name: user.name,
    role: user.role,
    legacy: Boolean(user.legacy)
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await signValue(encoded, secret);
  return `v2.${encoded}.${signature}`;
}

async function parseSession(value, authConfig, expectedDayKey) {
  if (!value || !expectedDayKey) return null;

  if (value.startsWith("v2.")) {
    return parseV2Session(value, authConfig.secret, expectedDayKey);
  }

  if (
    authConfig.legacyCode &&
    (await isValidLegacySession(value, authConfig.legacyCode, expectedDayKey))
  ) {
    return {
      userId: "legacy-commercial",
      name: "Commercial",
      role: "commercial",
      legacy: true
    };
  }

  return null;
}

async function parseV2Session(value, secret, expectedDayKey) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;

  const [, encoded, signature] = parts;
  const expectedSignature = await signValue(encoded, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (payload?.v !== 2 || payload?.dayKey !== expectedDayKey) return null;

    return {
      userId: String(payload.userId || ""),
      name: String(payload.name || "Utilisateur"),
      role: normalizeRole(payload.role),
      legacy: Boolean(payload.legacy)
    };
  } catch {
    return null;
  }
}

async function isValidLegacySession(value, accessCode, expectedDayKey) {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return false;

  const dayKey = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);

  if (!dayKey || !signature || dayKey !== expectedDayKey) return false;

  const expectedSignature = await signValue(dayKey, accessCode);
  return safeEqual(signature, expectedSignature);
}

function resolveRoleRedirect(user, nextPath) {
  const home = user?.redirect || ROLE_HOME[user?.role] || "/";
  const safeNext = sanitizeNext(nextPath);

  if (safeNext === "/" || safeNext === "/index.html") {
    return home;
  }

  const denied = getRoleDeniedRedirect(safeNext, user);
  return denied || safeNext;
}

function getRoleDeniedRedirect(pathname, user) {
  const role = normalizeRole(user?.role);
  const guard = ROLE_GUARDS.find((item) => pathname === item.path);
  if (!guard) return "";
  return guard.roles.has(role) ? "" : ROLE_HOME[role] || "/";
}

async function signValue(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toHex(signature);
}

async function digestHex(value) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(digest);
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function serializeSessionCookie(url, value) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  ];

  if (url.protocol === "https:") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function clearSessionCookie(url) {
  const attributes = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (url.protocol === "https:") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function buildRedirect(baseUrl, target, extraHeaders = {}) {
  const destination = new URL(target, baseUrl);
  const headers = new Headers({
    Location: destination.toString(),
    "Cache-Control": "no-store",
    ...extraHeaders
  });

  return new Response(null, {
    status: 303,
    headers
  });
}
