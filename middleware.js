const ACCESS_PAGE = "/acces.html";
const LOGOUT_PATH = "/deconnexion";
const COOKIE_NAME = "kent_portal_day";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 36;
const PARIS_TIMEZONE = "Europe/Paris";
const PUBLIC_PATHS = new Set([
  ACCESS_PAGE,
  "/kent-logo.svg"
]);

export const config = {
  matcher: "/:path*"
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const accessCode = String(process.env.ACCESS_DAILY_CODE || "").trim();
  const todayKey = getParisDayKey();
  const currentSession = getCookie(request.headers.get("cookie"), COOKIE_NAME);
  const isAuthenticated =
    accessCode &&
    currentSession &&
    (await isValidSession(currentSession, accessCode, todayKey));

  if (pathname === LOGOUT_PATH) {
    return buildRedirect(url, withQuery(ACCESS_PAGE, { logout: "1" }), {
      "Set-Cookie": clearSessionCookie(url)
    });
  }

  if (pathname === ACCESS_PAGE) {
    if (request.method === "POST") {
      return handleAccessAttempt(request, url, accessCode, todayKey);
    }

    if (isAuthenticated) {
      return buildRedirect(url, sanitizeNext(url.searchParams.get("next")));
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
        ...(accessCode ? {} : { error: "config" })
      })
    );
  }
}

async function handleAccessAttempt(request, url, accessCode, todayKey) {
  const form = await request.formData();
  const submittedCode = String(form.get("code") || "").trim();
  const nextPath = sanitizeNext(form.get("next"));

  if (!accessCode) {
    return buildRedirect(
      url,
      withQuery(ACCESS_PAGE, {
        error: "config",
        next: nextPath
      }),
      { "Set-Cookie": clearSessionCookie(url) }
    );
  }

  if (!submittedCode || submittedCode !== accessCode) {
    return buildRedirect(
      url,
      withQuery(ACCESS_PAGE, {
        error: "invalid",
        next: nextPath
      }),
      { "Set-Cookie": clearSessionCookie(url) }
    );
  }

  const sessionValue = await createSession(todayKey, accessCode);
  return buildRedirect(url, nextPath, {
    "Set-Cookie": serializeSessionCookie(url, sessionValue)
  });
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

async function createSession(dayKey, accessCode) {
  const signature = await signValue(dayKey, accessCode);
  return `${dayKey}.${signature}`;
}

async function isValidSession(value, accessCode, expectedDayKey) {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return false;

  const dayKey = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);

  if (!dayKey || !signature || dayKey !== expectedDayKey) return false;

  const expectedSignature = await signValue(dayKey, accessCode);
  return safeEqual(signature, expectedSignature);
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
