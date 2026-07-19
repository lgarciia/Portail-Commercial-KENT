import {
  ROLE_LABELS,
  normalizeRole,
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
  const guard = requireRole(request, ["admin"]);
  if (!guard.ok) {
    sendJson(response, guard.status, guard.body);
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadAdminData(guard.session));
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const result = await handleAction(body, guard.session);
      sendJson(response, 200, result);
      return;
    }

    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status >= 400 && status < 600 ? status : 500, {
      error: error.message || "Erreur admin."
    });
  }
}

async function handleAction(body, session) {
  const action = normalizeText(body?.action);
  if (!action) throw badRequest("Action manquante.");

  if (action === "createUser") {
    await createUser(body);
  } else if (action === "updateUser") {
    await updateUser(body, session);
  } else if (action === "setPassword") {
    await setPassword(body);
  } else if (action === "hideUser") {
    await hideUser(body, session);
  } else if (action === "restoreUser") {
    await restoreUser(body);
  } else if (action === "setRelation") {
    await setRelation(body);
  } else if (action === "removeRelation") {
    await removeRelation(body);
  } else {
    throw badRequest("Action inconnue.");
  }

  return {
    ok: true,
    ...(await loadAdminData(session))
  };
}

async function loadAdminData(session) {
  const [users, relations] = await Promise.all([listUsers(), listRelations()]);
  const activeUsers = users.filter((user) => user.active && !user.hidden);

  return {
    currentUser: {
      id: session.userId,
      dbUserId: session.dbUserId || "",
      name: session.name,
      role: session.role,
      source: session.source || ""
    },
    stats: {
      total: users.length,
      active: activeUsers.length,
      hidden: users.filter((user) => user.hidden || !user.active).length,
      admins: activeUsers.filter((user) => user.role === "admin").length,
      responsables: activeUsers.filter((user) => user.role === "responsable").length,
      commerciaux: activeUsers.filter((user) => user.role === "commercial").length,
      relations: relations.filter((relation) => relation.active).length
    },
    users: users.map(safeUser),
    relations: relations.map(safeRelation)
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

async function createUser(body) {
  const payload = normalizeUserPayload(body, { requirePassword: true });
  const existing = await findUserByIdentifier(payload.identifier);
  if (existing) throw badRequest("Cet identifiant existe deja.");

  const passwordHash = await hashPassword(payload.password);
  await supabaseAdminFetch("/rest/v1/portal_users", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      identifier: payload.identifier,
      display_name: payload.displayName,
      role: payload.role,
      password_hash: passwordHash,
      home_path: payload.homePath,
      active: true,
      hidden: false
    })
  });
}

async function updateUser(body, session) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Utilisateur introuvable.");

  const current = await getUserById(id);
  if (!current) throw badRequest("Utilisateur introuvable.");

  const payload = normalizeUserPayload(body, { requirePassword: false });
  const isSelf = isCurrentSessionUser(current, session);
  const nextRole = payload.role;
  const nextActive = body.active === undefined ? Boolean(current.active) : Boolean(body.active);
  const nextHidden = body.hidden === undefined ? Boolean(current.hidden) : Boolean(body.hidden);

  if (isSelf && (nextRole !== "admin" || !nextActive || nextHidden)) {
    throw badRequest("Protection active : tu ne peux pas retirer ton propre acces admin.");
  }

  await assertAdminWouldRemain(current, {
    role: nextRole,
    active: nextActive,
    hidden: nextHidden
  });

  await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      identifier: payload.identifier,
      display_name: payload.displayName,
      role: nextRole,
      home_path: payload.homePath,
      active: nextActive,
      hidden: nextHidden
    })
  });

  await cleanupRelationsForUserRole(id, nextRole, nextActive && !nextHidden);
}

async function setPassword(body) {
  const id = normalizeUuid(body?.id);
  const password = normalizeText(body?.password);
  if (!id) throw badRequest("Utilisateur introuvable.");
  if (password.length < 4) throw badRequest("Le code doit contenir au moins 4 caracteres.");

  const passwordHash = await hashPassword(password);
  await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ password_hash: passwordHash })
  });
}

async function hideUser(body, session) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Utilisateur introuvable.");

  const current = await getUserById(id);
  if (!current) throw badRequest("Utilisateur introuvable.");
  if (isCurrentSessionUser(current, session)) {
    throw badRequest("Protection active : tu ne peux pas masquer ton propre compte.");
  }

  await assertAdminWouldRemain(current, {
    role: current.role,
    active: false,
    hidden: true
  });

  await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: false, hidden: true })
  });

  await supabaseAdminFetch(
    `/rest/v1/portal_user_relations?or=(responsable_user_id.eq.${encodeURIComponent(id)},commercial_user_id.eq.${encodeURIComponent(id)})&active=eq.true`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ active: false })
    }
  );
}

async function restoreUser(body) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Utilisateur introuvable.");

  await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: true, hidden: false })
  });
}

async function setRelation(body) {
  const responsableId = normalizeUuid(body?.responsableUserId);
  const commercialId = normalizeUuid(body?.commercialUserId);
  const relationType = normalizeText(body?.relationType) === "exceptionnel" ? "exceptionnel" : "principal";
  const note = normalizeText(body?.note) || null;

  if (!responsableId || !commercialId) throw badRequest("Responsable et commercial obligatoires.");
  if (responsableId === commercialId) throw badRequest("Un utilisateur ne peut pas etre rattache a lui-meme.");

  const [responsable, commercial] = await Promise.all([
    getUserById(responsableId),
    getUserById(commercialId)
  ]);

  if (!responsable || responsable.role !== "responsable" || !responsable.active || responsable.hidden) {
    throw badRequest("Le responsable selectionne n'est pas actif.");
  }

  if (!commercial || commercial.role !== "commercial" || !commercial.active || commercial.hidden) {
    throw badRequest("Le commercial selectionne n'est pas actif.");
  }

  if (relationType === "principal") {
    await supabaseAdminFetch(
      `/rest/v1/portal_user_relations?commercial_user_id=eq.${encodeURIComponent(commercialId)}&relation_type=eq.principal&active=eq.true`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: false })
      }
    );
  }

  const existing = await findRelation(responsableId, commercialId, relationType);
  if (existing) {
    await supabaseAdminFetch(`/rest/v1/portal_user_relations?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ active: true, note })
    });
    return;
  }

  await supabaseAdminFetch("/rest/v1/portal_user_relations", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      responsable_user_id: responsableId,
      commercial_user_id: commercialId,
      relation_type: relationType,
      active: true,
      note
    })
  });
}

async function removeRelation(body) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Rattachement introuvable.");

  await supabaseAdminFetch(`/rest/v1/portal_user_relations?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: false })
  });
}

async function cleanupRelationsForUserRole(userId, role, visible) {
  if (role !== "responsable" || !visible) {
    await supabaseAdminFetch(
      `/rest/v1/portal_user_relations?responsable_user_id=eq.${encodeURIComponent(userId)}&active=eq.true`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: false })
      }
    );
  }

  if (role !== "commercial" || !visible) {
    await supabaseAdminFetch(
      `/rest/v1/portal_user_relations?commercial_user_id=eq.${encodeURIComponent(userId)}&active=eq.true`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: false })
      }
    );
  }
}

async function assertAdminWouldRemain(current, next) {
  const currentlyAdmin = current.role === "admin" && current.active && !current.hidden;
  const nextAdmin = next.role === "admin" && next.active && !next.hidden;
  if (!currentlyAdmin || nextAdmin) return;

  const admins = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=id&role=eq.admin&active=eq.true&hidden=eq.false&id=neq.${encodeURIComponent(current.id)}`
  );
  if (!Array.isArray(admins) || !admins.length) {
    throw badRequest("Impossible : il doit rester au moins un admin actif.");
  }
}

async function hashPassword(password) {
  const hash = await supabaseAdminFetch("/rest/v1/rpc/portal_hash_password", {
    method: "POST",
    body: JSON.stringify({ p_password: password })
  });

  if (typeof hash === "string") return hash;
  if (Array.isArray(hash) && typeof hash[0] === "string") return hash[0];
  if (hash && typeof hash.portal_hash_password === "string") return hash.portal_hash_password;
  throw new Error("Hash de mot de passe impossible.");
}

async function getUserById(id) {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function findUserByIdentifier(identifier) {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&identifier_lookup=eq.${encodeURIComponent(identifier.toLowerCase())}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function findRelation(responsableId, commercialId, relationType) {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_user_relations?select=${encodeURIComponent(RELATION_SELECT)}&responsable_user_id=eq.${encodeURIComponent(responsableId)}&commercial_user_id=eq.${encodeURIComponent(commercialId)}&relation_type=eq.${encodeURIComponent(relationType)}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

function normalizeUserPayload(body, options) {
  const role = normalizeRole(body?.role);
  const identifier = normalizeIdentifier(body?.identifier);
  const displayName = normalizeText(body?.displayName || body?.display_name);
  const password = normalizeText(body?.password);
  const homePath = sanitizeHomePath(body?.homePath || body?.home_path, role);

  if (!identifier) throw badRequest("Identifiant obligatoire.");
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(identifier)) {
    throw badRequest("Identifiant invalide. Utilise lettres, chiffres, point, tiret ou underscore.");
  }
  if (!displayName || displayName.length < 2) throw badRequest("Nom affichable obligatoire.");
  if (options?.requirePassword && password.length < 4) {
    throw badRequest("Le code doit contenir au moins 4 caracteres.");
  }

  return { identifier, displayName, role, password, homePath };
}

function sanitizeHomePath(value, role) {
  const raw = normalizeText(value);
  if (!raw) {
    if (role === "admin") return "/admin.html";
    if (role === "responsable") return "/responsable.html";
    return "/";
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) throw badRequest("Page d'accueil invalide.");
  return raw;
}

function normalizeIdentifier(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeUuid(value) {
  const id = normalizeText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : "";
}

function isCurrentSessionUser(user, session) {
  const dbUserId = normalizeText(session?.dbUserId);
  if (dbUserId && user.id === dbUserId) return true;
  return normalizeText(user.identifier).toLowerCase() === normalizeText(session?.userId).toLowerCase();
}

function safeUser(user) {
  return {
    id: user.id,
    identifier: user.identifier,
    displayName: user.display_name,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    homePath: user.home_path || "",
    active: Boolean(user.active),
    hidden: Boolean(user.hidden),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at
  };
}

function safeRelation(relation) {
  return {
    id: relation.id,
    responsableUserId: relation.responsable_user_id,
    commercialUserId: relation.commercial_user_id,
    relationType: relation.relation_type,
    active: Boolean(relation.active),
    note: relation.note || "",
    createdAt: relation.created_at,
    updatedAt: relation.updated_at
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
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
