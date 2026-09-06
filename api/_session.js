import { ROLE_LABELS, getSessionFromRequest, sendJson } from "./_auth.js";

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const session = getSessionFromRequest(request);
  if (!session) {
    sendJson(response, 401, { authenticated: false });
    return;
  }

  sendJson(response, 200, {
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
