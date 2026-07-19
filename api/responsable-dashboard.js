import {
  ROLE_LABELS,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const USER_SELECT = [
  "id",
  "identifier",
  "display_name",
  "role",
  "home_path",
  "active",
  "hidden",
  "created_at",
  "updated_at",
  "last_login_at"
].join(",");

const RELATION_SELECT = [
  "id",
  "responsable_user_id",
  "commercial_user_id",
  "relation_type",
  "active",
  "note",
  "created_at",
  "updated_at"
].join(",");

export default async function handler(request, response) {
  const guard = requireRole(request, ["admin", "responsable"]);
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

    sendJson(response, 200, await buildDashboard(guard.session));
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: error.message || "Dashboard responsable indisponible."
    });
  }
}

async function buildDashboard(session) {
  const [users, relations] = await Promise.all([listUsers(), listRelations()]);
  const activeUsers = users.filter((user) => user.active && !user.hidden);
  const activeRelations = relations.filter((relation) => relation.active);
  const currentPortalUser = resolveCurrentPortalUser(session, users);

  const visibleCommercials =
    session.role === "admin"
      ? buildAdminCommercialScope(activeUsers, activeRelations, users)
      : buildResponsableCommercialScope(currentPortalUser, activeUsers, activeRelations, users);

  const principalRelations = visibleCommercials.filter((item) => item.relationType === "principal");
  const exceptionalRelations = visibleCommercials.filter((item) => item.relationType === "exceptionnel");
  const connectedRecently = visibleCommercials.filter((item) => isRecentLogin(item.lastLoginAt)).length;

  return {
    currentUser: {
      id: session.userId,
      dbUserId: session.dbUserId || currentPortalUser?.id || "",
      name: session.name || currentPortalUser?.display_name || "Utilisateur",
      role: session.role,
      roleLabel: ROLE_LABELS[session.role] || session.role,
      source: session.source || "",
      foundInSupabase: Boolean(currentPortalUser)
    },
    stats: {
      commerciaux: visibleCommercials.length,
      principal: principalRelations.length,
      exceptionnel: exceptionalRelations.length,
      connectedRecently,
      dataReady: 0
    },
    dataScope: {
      status: "ownership_pending",
      title: "Attribution des ventes en attente",
      message:
        "Les ventes, BDC et devis historiques ne sont pas encore rattaches aux commerciaux. Cette page affiche donc les droits et les equipes, sans modifier les donnees metier."
    },
    commercials: visibleCommercials,
    actions: [
      {
        label: "BDC / Devis",
        href: "/documents-commerciaux.html",
        enabled: true
      },
      {
        label: "Portail commercial",
        href: "/index.html",
        enabled: true
      }
    ]
  };
}

async function listUsers() {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&order=role.asc,display_name.asc`
  );
  return Array.isArray(data) ? data : [];
}

async function listRelations() {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_user_relations?select=${encodeURIComponent(RELATION_SELECT)}&order=created_at.desc`
  );
  return Array.isArray(data) ? data : [];
}

function buildAdminCommercialScope(activeUsers, relations, allUsers) {
  const commercialUsers = activeUsers.filter((user) => user.role === "commercial");
  return commercialUsers.map((commercial) => {
    const commercialRelations = relations.filter((relation) => relation.commercial_user_id === commercial.id);
    const principal = commercialRelations.find((relation) => relation.relation_type === "principal");
    const fallback = commercialRelations[0] || null;
    const relation = principal || fallback;
    const responsables = commercialRelations.map((item) => userSummary(findUser(allUsers, item.responsable_user_id)));

    return commercialSummary({
      commercial,
      relation,
      responsables,
      scopeLabel: relation
        ? relation.relation_type === "principal"
          ? "Responsable principal"
          : "Acces exceptionnel"
        : "Non rattache"
    });
  });
}

function buildResponsableCommercialScope(currentPortalUser, activeUsers, relations, allUsers) {
  if (!currentPortalUser) return [];

  return relations
    .filter((relation) => relation.responsable_user_id === currentPortalUser.id)
    .map((relation) => {
      const commercial = activeUsers.find((user) => user.id === relation.commercial_user_id);
      if (!commercial || commercial.role !== "commercial") return null;
      return commercialSummary({
        commercial,
        relation,
        responsables: [userSummary(currentPortalUser)],
        scopeLabel:
          relation.relation_type === "principal"
            ? "Responsable principal"
            : "Acces exceptionnel"
      });
    })
    .filter(Boolean);
}

function commercialSummary({ commercial, relation, responsables, scopeLabel }) {
  return {
    id: commercial.id,
    identifier: commercial.identifier,
    displayName: commercial.display_name,
    role: commercial.role,
    roleLabel: ROLE_LABELS[commercial.role] || "Commercial",
    homePath: commercial.home_path || "/",
    active: Boolean(commercial.active),
    hidden: Boolean(commercial.hidden),
    lastLoginAt: commercial.last_login_at,
    relationId: relation?.id || "",
    relationType: relation?.relation_type || "none",
    relationLabel:
      relation?.relation_type === "principal"
        ? "Principal"
        : relation?.relation_type === "exceptionnel"
          ? "Exceptionnel"
          : "Non rattache",
    scopeLabel,
    relationNote: relation?.note || "",
    responsables: responsables.filter(Boolean),
    metrics: {
      caJour: null,
      caMois: null,
      bdcEnCours: null,
      devisEnCours: null,
      status: "waiting_for_data_ownership"
    }
  };
}

function userSummary(user) {
  if (!user) return null;
  return {
    id: user.id,
    identifier: user.identifier,
    displayName: user.display_name,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role
  };
}

function findUser(users, id) {
  return users.find((user) => user.id === id) || null;
}

function resolveCurrentPortalUser(session, users) {
  const dbUserId = normalizeText(session.dbUserId);
  if (dbUserId) {
    const byId = users.find((user) => user.id === dbUserId);
    if (byId) return byId;
  }

  const identifier = normalizeText(session.userId).toLowerCase();
  if (!identifier) return null;
  return users.find((user) => normalizeText(user.identifier).toLowerCase() === identifier) || null;
}

function isRecentLogin(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
}
