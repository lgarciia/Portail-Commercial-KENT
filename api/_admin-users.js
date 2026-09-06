import {
  ROLE_LABELS,
  getSupabaseAdminConfig,
  normalizeRole,
  normalizeText,
  requireRole,
  sendJson,
  supabaseAdminFetch
} from "./_auth.js";

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";

const BASE_USER_SELECT = [
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

const USER_SELECT = `${BASE_USER_SELECT},sector_id`;

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

const SECTOR_SELECT = [
  "id",
  "name",
  "departments",
  "color",
  "description",
  "active",
  "hidden",
  "created_at",
  "updated_at"
].join(",");

const VALID_DEPARTMENT_CODES = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "21",
  "22", "23", "24", "25", "26", "27", "28", "29", "2A", "2B",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
  "40", "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "50", "51", "52", "53", "54", "55", "56", "57", "58", "59",
  "60", "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "70", "71", "72", "73", "74", "75", "76", "77", "78", "79",
  "80", "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "90", "91", "92", "93", "94", "95", "971", "972", "973", "974",
  "976"
]);

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
  } else if (action === "createSector") {
    await createSector(body);
  } else if (action === "updateSector") {
    await updateSector(body);
  } else if (action === "hideSector") {
    await hideSector(body);
  } else if (action === "restoreSector") {
    await restoreSector(body);
  } else {
    throw badRequest("Action inconnue.");
  }

  return {
    ok: true,
    ...(await loadAdminData(session))
  };
}

async function loadAdminData(session) {
  const [usersResult, relations, sectorsResult] = await Promise.all([
    listUsers(),
    listRelations(),
    listSectors()
  ]);
  const users = usersResult.rows;
  const sectors = sectorsResult.rows;
  const sectorMap = new Map(sectors.map((sector) => [String(sector.id), sector]));
  const activeUsers = users.filter((user) => user.active && !user.hidden);
  const activeSectors = sectors.filter((sector) => sector.active && !sector.hidden);
  const sectorsReady = Boolean(usersResult.sectorsReady && sectorsResult.ready);

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
      relations: relations.filter((relation) => relation.active).length,
      sectors: activeSectors.length
    },
    sectorsReady,
    sectorsWarning: sectorsReady ? "" : usersResult.warning || sectorsResult.warning || "Secteurs commerciaux non initialises.",
    users: users.map((user) => safeUser(user, sectorMap)),
    relations: relations.map(safeRelation),
    sectors: sectors.map(safeSector)
  };
}

async function listUsers() {
  try {
    const data = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&order=role.asc,display_name.asc`
    );
    return { rows: Array.isArray(data) ? data : [], sectorsReady: true, warning: "" };
  } catch (error) {
    if (!isMissingSectorSchemaError(error)) throw error;
    const data = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(BASE_USER_SELECT)}&order=role.asc,display_name.asc`
    );
    return {
      rows: (Array.isArray(data) ? data : []).map((user) => ({ ...user, sector_id: null })),
      sectorsReady: false,
      warning: "Lance le SQL des secteurs commerciaux pour activer les rattachements secteur."
    };
  }
}

async function listRelations() {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_user_relations?select=${encodeURIComponent(RELATION_SELECT)}&order=created_at.desc`
  );
  return Array.isArray(data) ? data : [];
}

async function listSectors() {
  try {
    const data = await supabaseAdminFetch(
      `/rest/v1/portal_commercial_sectors?select=${encodeURIComponent(SECTOR_SELECT)}&order=active.desc,name.asc`
    );
    return { rows: Array.isArray(data) ? data : [], ready: true, warning: "" };
  } catch (error) {
    if (!isMissingSectorSchemaError(error)) throw error;
    return {
      rows: [],
      ready: false,
      warning: "Table portal_commercial_sectors absente : lance le SQL des secteurs commerciaux."
    };
  }
}

async function createUser(body) {
  const payload = normalizeUserPayload(body, { requirePassword: true });
  const existing = await findUserByIdentifier(payload.identifier);
  if (existing) throw badRequest("Cet identifiant existe deja.");
  if (payload.sectorId) await assertActiveSector(payload.sectorId);

  const passwordHash = await hashPassword(payload.password);
  const insertPayload = {
    identifier: payload.identifier,
    display_name: payload.displayName,
    role: payload.role,
    password_hash: passwordHash,
    home_path: payload.homePath,
    active: true,
    hidden: false
  };
  if (payload.sectorId) insertPayload.sector_id = payload.sectorId;

  await supabaseAdminFetch("/rest/v1/portal_users", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(insertPayload)
  });
}

async function updateUser(body, session) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Utilisateur introuvable.");

  const current = await getUserById(id);
  if (!current) throw badRequest("Utilisateur introuvable.");

  const payload = normalizeUserPayload(body, { requirePassword: false });
  const existing = await findUserByIdentifier(payload.identifier);
  if (existing && existing.id !== id) throw badRequest("Cet identifiant est deja utilise par un autre compte.");
  if (payload.sectorId) await assertActiveSector(payload.sectorId);

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

  const updatePayload = {
    identifier: payload.identifier,
    display_name: payload.displayName,
    role: nextRole,
    home_path: payload.homePath,
    active: nextActive,
    hidden: nextHidden,
    sector_id: nextRole === "commercial" ? payload.sectorId || null : null
  };

  await patchUser(id, updatePayload);

  await cleanupRelationsForUserRole(id, nextRole, nextActive && !nextHidden);
}

async function setPassword(body) {
  const id = normalizeUuid(body?.id);
  const oldPassword = normalizeText(body?.oldPassword);
  const password = normalizeText(body?.password);
  if (!id) throw badRequest("Utilisateur introuvable.");
  if (oldPassword.length < 4) throw badRequest("Ancien code obligatoire.");
  if (password.length < 4) throw badRequest("Le code doit contenir au moins 4 caracteres.");

  const current = await getUserById(id);
  if (!current) throw badRequest("Utilisateur introuvable.");
  await assertOldPasswordMatches(current, oldPassword);

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

async function createSector(body) {
  const payload = normalizeSectorPayload(body);
  const existing = await findSectorByName(payload.name);
  if (existing) throw badRequest("Ce secteur existe deja. Modifie ou restaure le secteur existant.");

  await supabaseAdminFetch("/rest/v1/portal_commercial_sectors", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      name: payload.name,
      departments: payload.departments,
      color: payload.color,
      description: payload.description,
      active: true,
      hidden: false
    })
  });
}

async function updateSector(body) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Secteur introuvable.");

  const current = await getSectorById(id);
  if (!current) throw badRequest("Secteur introuvable.");

  const payload = normalizeSectorPayload(body);
  const existing = await findSectorByName(payload.name);
  if (existing && existing.id !== id) throw badRequest("Ce nom de secteur est deja utilise.");

  await supabaseAdminFetch(`/rest/v1/portal_commercial_sectors?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      name: payload.name,
      departments: payload.departments,
      color: payload.color,
      description: payload.description
    })
  });
}

async function hideSector(body) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Secteur introuvable.");
  await supabaseAdminFetch(`/rest/v1/portal_commercial_sectors?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: false, hidden: true })
  });
}

async function restoreSector(body) {
  const id = normalizeUuid(body?.id);
  if (!id) throw badRequest("Secteur introuvable.");
  await supabaseAdminFetch(`/rest/v1/portal_commercial_sectors?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: true, hidden: false })
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

async function assertOldPasswordMatches(user, oldPassword) {
  const result = await supabaseAnonFetch("/rest/v1/rpc/portal_authenticate_user", {
    method: "POST",
    body: JSON.stringify({
      p_identifier: user.identifier,
      p_password: oldPassword
    })
  });
  const ok = Array.isArray(result) && result.some((item) => normalizeUuid(item?.user_id) === user.id);
  if (!ok) throw badRequest("Ancien code incorrect pour cet utilisateur.");

  await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_login_at: user.last_login_at || null })
  });
}

async function supabaseAnonFetch(path, options = {}) {
  const config = getSupabaseAdminConfig();
  if (!config.ok) {
    const error = new Error(config.error);
    error.code = "missing_service_role_key";
    throw error;
  }

  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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

async function getUserById(id) {
  try {
    const data = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&id=eq.${encodeURIComponent(id)}&limit=1`
    );
    return Array.isArray(data) ? data[0] || null : null;
  } catch (error) {
    if (!isMissingSectorSchemaError(error)) throw error;
    const data = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(BASE_USER_SELECT)}&id=eq.${encodeURIComponent(id)}&limit=1`
    );
    const user = Array.isArray(data) ? data[0] || null : null;
    return user ? { ...user, sector_id: null } : null;
  }
}

async function findUserByIdentifier(identifier) {
  try {
    const data = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(USER_SELECT)}&identifier_lookup=eq.${encodeURIComponent(identifier.toLowerCase())}&limit=1`
    );
    return Array.isArray(data) ? data[0] || null : null;
  } catch (error) {
    if (!isMissingSectorSchemaError(error)) throw error;
    const data = await supabaseAdminFetch(
      `/rest/v1/portal_users?select=${encodeURIComponent(BASE_USER_SELECT)}&identifier_lookup=eq.${encodeURIComponent(identifier.toLowerCase())}&limit=1`
    );
    const user = Array.isArray(data) ? data[0] || null : null;
    return user ? { ...user, sector_id: null } : null;
  }
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
  const sectorId = role === "commercial" ? normalizeUuid(body?.sectorId || body?.sector_id) : "";

  if (!identifier) throw badRequest("Identifiant obligatoire.");
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(identifier)) {
    throw badRequest("Identifiant invalide. Utilise lettres, chiffres, point, tiret ou underscore.");
  }
  if (!displayName || displayName.length < 2) throw badRequest("Nom affichable obligatoire.");
  if (options?.requirePassword && password.length < 4) {
    throw badRequest("Le code doit contenir au moins 4 caracteres.");
  }

  return { identifier, displayName, role, password, homePath, sectorId };
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

function safeUser(user, sectorMap) {
  const sectorId = normalizeUuid(user.sector_id);
  const sector = sectorId ? sectorMap.get(sectorId) || null : null;
  return {
    id: user.id,
    identifier: user.identifier,
    displayName: user.display_name,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    homePath: user.home_path || "",
    active: Boolean(user.active),
    hidden: Boolean(user.hidden),
    sectorId,
    sectorName: sector ? sector.name : sectorId ? "Secteur masque" : "",
    sectorDepartments: sector ? safeDepartments(sector.departments) : [],
    sectorColor: sector ? normalizeColor(sector.color) : "",
    sectorActive: sector ? Boolean(sector.active) && !sector.hidden : false,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at
  };
}

function safeSector(sector) {
  return {
    id: sector.id,
    name: sector.name || "",
    departments: safeDepartments(sector.departments),
    color: normalizeColor(sector.color),
    description: sector.description || "",
    active: Boolean(sector.active),
    hidden: Boolean(sector.hidden),
    createdAt: sector.created_at,
    updatedAt: sector.updated_at
  };
}

async function patchUser(id, payload) {
  try {
    await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (!isMissingSectorSchemaError(error) || !Object.prototype.hasOwnProperty.call(payload, "sector_id") || payload.sector_id) {
      throw error;
    }
    const fallbackPayload = { ...payload };
    delete fallbackPayload.sector_id;
    await supabaseAdminFetch(`/rest/v1/portal_users?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(fallbackPayload)
    });
  }
}

async function assertActiveSector(id) {
  const sector = await getSectorById(id);
  if (!sector || !sector.active || sector.hidden) {
    throw badRequest("Secteur commercial introuvable ou masque.");
  }
}

async function getSectorById(id) {
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_commercial_sectors?select=${encodeURIComponent(SECTOR_SELECT)}&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

async function findSectorByName(name) {
  const lookup = normalizeSectorName(name).toLowerCase();
  if (!lookup) return null;
  const data = await supabaseAdminFetch(
    `/rest/v1/portal_commercial_sectors?select=${encodeURIComponent(SECTOR_SELECT)}&name_lookup=eq.${encodeURIComponent(lookup)}&limit=1`
  );
  return Array.isArray(data) ? data[0] || null : null;
}

function normalizeSectorPayload(body) {
  const name = normalizeSectorName(body?.name);
  if (!name || name.length < 2) throw badRequest("Nom du secteur obligatoire.");
  if (name.length > 120) throw badRequest("Nom du secteur trop long.");

  const departments = safeDepartments(body?.departments);
  const color = normalizeColor(body?.color);
  const description = normalizeText(body?.description).slice(0, 500) || null;
  return { name, departments, color, description };
}

function normalizeSectorName(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function safeDepartments(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s;|]+/)
      : [];
  return [...new Set(source
    .map((item) => normalizeDepartmentCode(item))
    .filter((item) => VALID_DEPARTMENT_CODES.has(item)))];
}

function normalizeDepartmentCode(value) {
  const raw = normalizeText(value).toUpperCase();
  if (raw === "2A" || raw === "2B") return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 1 ? `0${digits}` : digits;
}

function normalizeColor(value) {
  const color = normalizeText(value);
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : "#0F766E";
}

function isMissingSectorSchemaError(error) {
  const message = [
    error?.message,
    error?.payload?.message,
    error?.payload?.details,
    error?.payload?.hint
  ].filter(Boolean).join(" ");
  return /portal_commercial_sectors|sector_id|schema cache|column .* does not exist|relation .* does not exist/i.test(message);
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

function extractSupabaseError(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  return payload.message || payload.details || payload.hint || payload.error || "";
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
