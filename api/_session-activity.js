import { requireRole, sendJson, supabaseAdminFetch } from "./_auth.js";

export default async function handler(request, response) {
  const guard = requireRole(request, ["admin", "responsable", "commercial"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const userId = String(guard.session.dbUserId || "").trim();
    if (!userId) {
      sendJson(response, 200, { updated: false, reason: "session_without_db_user" });
      return;
    }

    const now = new Date().toISOString();
    await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        last_login_at: now,
        updated_at: now
      })
    });

    sendJson(response, 200, { updated: true, updatedAt: now });
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "Mise a jour activite indisponible."
    });
  }
}
