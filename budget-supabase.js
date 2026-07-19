(function(){
  const SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";
  const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const DEFAULT_ENTITIES = [
    { key: "psa", libelle: "PSA", ordre: 10 },
    { key: "gueudet", libelle: "Gueudet", ordre: 20 },
    { key: "ford", libelle: "Ford", ordre: 30 },
    { key: "direct", libelle: "Direct", ordre: 40 }
  ];

  let cachedClient = null;
  let cachedScopeUser = null;
  let scopeLoaded = false;
  let ownershipReady = null;

  function client(){
    if (cachedClient) return cachedClient;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase indisponible sur cette page.");
    }
    cachedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return cachedClient;
  }

  async function loadScopeUser(){
    if (scopeLoaded) return cachedScopeUser;
    scopeLoaded = true;

    try{
      if (window.KentCommercialScope && typeof window.KentCommercialScope.load === "function") {
        cachedScopeUser = await window.KentCommercialScope.load();
        return cachedScopeUser;
      }

      const response = await fetch("/api/session", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (response.ok) {
        const payload = await response.json();
        cachedScopeUser = payload?.user || null;
      }
    }catch(error){
      console.warn("Session budget indisponible:", error?.message || error);
      cachedScopeUser = null;
    }

    return cachedScopeUser;
  }

  function commercialIdFromUser(user){
    return user?.role === "commercial" && user?.dbUserId ? String(user.dbUserId) : "";
  }

  async function canUseOwnershipColumns(){
    if (ownershipReady !== null) return ownershipReady;
    try{
      const { error } = await client()
        .from("budget_entites")
        .select("commercial_user_id")
        .limit(1);
      ownershipReady = !error;
    }catch{
      ownershipReady = false;
    }
    return ownershipReady;
  }

  async function ownerContext(){
    const user = await loadScopeUser();
    const id = commercialIdFromUser(user);
    if (!id) {
      return { user, id: "", payload: {} };
    }
    canUseOwnershipColumns().catch(() => {});
    return {
      user,
      id,
      payload: {
        commercial_user_id: id,
        commercial_identifier: String(user.userId || user.id || ""),
        commercial_name: String(user.name || "")
      }
    };
  }

  function applyOwner(query, owner, column = "commercial_user_id"){
    return owner?.id ? query.eq(column, owner.id) : query;
  }

  function toNumber(value){
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function slugify(value){
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60);
  }

  function makeEntityKey(label){
    return slugify(label) || `entite-${Date.now()}`;
  }

  function sumLine(line){
    return MONTH_KEYS.reduce((sum, key) => sum + toNumber(line[key]), 0);
  }

  function normalizeLine(row, index){
    const values = row?.values || row?.months || row || {};
    const line = {
      ordre: Number.isFinite(Number(row?.ordre)) ? Number(row.ordre) : index,
      client_nom: String(row?.client_nom || row?.clientName || row?.name || row?.client || "Client").trim() || "Client",
      numero_client: String(row?.numero_client || row?.clientInternal || row?.number || row?.nclient || "").trim() || null,
      commentaire: String(row?.commentaire || row?.comment || "").trim() || null
    };
    MONTH_KEYS.forEach(key => {
      line[key] = toNumber(values[key]);
    });
    line.total = toNumber(row?.total);
    if (!line.total) line.total = sumLine(line);
    return line;
  }

  function normalizeLines(rows){
    return (Array.isArray(rows) ? rows : [])
      .map((row, index) => normalizeLine(row, index))
      .filter(line => line.client_nom);
  }

  function totalRows(rows){
    return normalizeLines(rows).reduce((sum, line) => sum + toNumber(line.total), 0);
  }

  function toBudgetData(lines){
    return {
      clients: normalizeLines(lines).map(line => ({
        id: `${String(line.numero_client || "").trim()}__${String(line.client_nom || "").trim()}`,
        name: line.client_nom,
        nclient: line.numero_client || "",
        commentaire: line.commentaire || "",
        budget: MONTH_KEYS.reduce((acc, key) => {
          acc[key] = toNumber(line[key]);
          return acc;
        }, {})
      }))
    };
  }

  async function ensureDefaultEntities(){
    const owner = await ownerContext();
    let existingQuery = client()
      .from("budget_entites")
      .select("key");
    existingQuery = applyOwner(existingQuery, owner);
    const { data: existing, error: existingError } = await existingQuery;
    if (existingError) throw existingError;

    const existingKeys = new Set((existing || []).map(entity => String(entity.key || "")));
    const missing = DEFAULT_ENTITIES.filter(entity => !existingKeys.has(entity.key));
    if (!missing.length) return;

    const { error } = await client()
      .from("budget_entites")
      .insert(missing.map(entity => ({ ...entity, ...owner.payload })));
    if (error) throw error;
  }

  async function listEntities(){
    await ensureDefaultEntities();
    const owner = await ownerContext();
    let query = client()
      .from("budget_entites")
      .select("*")
      .eq("actif", true);
    query = applyOwner(query, owner);
    query = query
      .order("ordre", { ascending: true })
      .order("libelle", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function createEntity(label){
    const libelle = String(label || "").trim();
    if (!libelle) throw new Error("Nom entite obligatoire.");
    const owner = await ownerContext();
    const payload = { key: makeEntityKey(libelle), libelle, actif: true, ordre: 100, ...owner.payload };
    const { data, error } = await client()
      .from("budget_entites")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function updateEntity(id, updates = {}){
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(updates, "libelle")) {
      const libelle = String(updates.libelle || "").trim();
      if (!libelle) throw new Error("Nom entite obligatoire.");
      payload.libelle = libelle;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "actif")) {
      payload.actif = Boolean(updates.actif);
    }
    if (!Object.keys(payload).length) throw new Error("Aucune modification entite.");
    payload.updated_at = new Date().toISOString();

    const owner = await ownerContext();
    let query = client()
      .from("budget_entites")
      .update(payload)
      .eq("id", id);
    query = applyOwner(query, owner);
    query = query.select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  function renameEntity(id, label){
    return updateEntity(id, { libelle: label });
  }

  function deactivateEntity(id){
    return updateEntity(id, { actif: false });
  }

  async function listBudgetsForEntity(entityId){
    const owner = await ownerContext();
    let query = client()
      .from("budgets")
      .select("*")
      .eq("entite_id", entityId);
    query = applyOwner(query, owner);
    query = query
      .order("annee", { ascending: false })
      .order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function listProjections(year){
    const owner = await ownerContext();
    let query = client()
      .from("budget_projections")
      .select("*");
    if (year) query = query.eq("annee", Number(year));
    query = applyOwner(query, owner);
    query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function insertProjectionLines(projectionId, lines, owner){
    const payload = normalizeLines(lines).map(line => ({ ...line, projection_id: projectionId, ...(owner?.payload || {}) }));
    if (!payload.length) return;
    const { error } = await client().from("budget_projection_lignes").insert(payload);
    if (error) throw error;
  }

  async function saveProjection({ nom, annee, sourceLabel = "", sourceEntityKey = "", rows = [], meta = {} }){
    const lines = normalizeLines(rows);
    if (!lines.length) throw new Error("Aucune ligne a enregistrer.");
    const owner = await ownerContext();
    const payload = {
      nom: String(nom || "").trim() || `Projection ${annee || ""}`.trim(),
      annee: Number(annee),
      source_label: sourceLabel || null,
      source_entite_key: sourceEntityKey || null,
      total_annuel: totalRows(lines),
      nb_lignes: lines.length,
      meta: meta || {},
      ...owner.payload
    };
    const { data, error } = await client()
      .from("budget_projections")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    try{
      await insertProjectionLines(data.id, lines, owner);
    }catch(errorLines){
      await client().from("budget_projections").delete().eq("id", data.id);
      throw errorLines;
    }
    return data;
  }

  async function getProjection(id){
    const owner = await ownerContext();
    let projectionQuery = client()
      .from("budget_projections")
      .select("*")
      .eq("id", id);
    projectionQuery = applyOwner(projectionQuery, owner);
    projectionQuery = projectionQuery.single();
    const { data: projection, error } = await projectionQuery;
    if (error) throw error;
    let linesQuery = client()
      .from("budget_projection_lignes")
      .select("*")
      .eq("projection_id", id);
    linesQuery = applyOwner(linesQuery, owner);
    linesQuery = linesQuery.order("ordre", { ascending: true });
    const { data: lines, error: linesError } = await linesQuery;
    if (linesError) throw linesError;
    return { projection, lines: lines || [] };
  }

  async function activeBudgetForEntityYear(entityId, year){
    const owner = await ownerContext();
    let query = client()
      .from("budgets")
      .select("*")
      .eq("entite_id", entityId)
      .eq("annee", Number(year))
      .eq("statut", "active");
    query = applyOwner(query, owner);
    query = query.limit(1);
    const { data, error } = await query;
    if (error) throw error;
    return (data || [])[0] || null;
  }

  async function insertBudgetLines(budgetId, lines, owner){
    const payload = normalizeLines(lines).map(line => ({ ...line, budget_id: budgetId, ...(owner?.payload || {}) }));
    if (!payload.length) return;
    const { error } = await client().from("budget_lignes").insert(payload);
    if (error) throw error;
  }

  async function validateBudget({ nom, annee, entityId, projectionId = null, rows = [], meta = {}, replaceActive = false }){
    const lines = normalizeLines(rows);
    if (!lines.length) throw new Error("Aucune ligne budget a valider.");
    const owner = await ownerContext();
    const active = await activeBudgetForEntityYear(entityId, annee);
    if (active && !replaceActive) {
      const err = new Error(`Un budget actif existe deja pour cette entite et ${annee}. Desactive-le avant d'en valider un autre.`);
      err.code = "ACTIVE_BUDGET_EXISTS";
      err.activeBudget = active;
      throw err;
    }
    let replacedActive = null;
    if (active && replaceActive) {
      const oldMeta = active.meta && typeof active.meta === "object" ? active.meta : {};
      const { error: deactivateError } = await client()
        .from("budgets")
        .update({
          statut: "inactive",
          meta: { ...oldMeta, replaced_at: new Date().toISOString() }
        })
        .eq("id", active.id);
      if (deactivateError) throw deactivateError;
      replacedActive = active;
    }
    const payloadMeta = meta && typeof meta === "object" ? { ...meta } : {};
    if (replacedActive) payloadMeta.replaced_budget_id = replacedActive.id;
    const payload = {
      projection_id: projectionId || null,
      entite_id: entityId,
      nom: String(nom || "").trim() || `Budget ${annee}`,
      annee: Number(annee),
      statut: "active",
      total_annuel: totalRows(lines),
      nb_lignes: lines.length,
      meta: payloadMeta,
      validated_at: new Date().toISOString(),
      ...owner.payload
    };
    try{
      const { data, error } = await client()
        .from("budgets")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      try{
        await insertBudgetLines(data.id, lines, owner);
      }catch(errorLines){
        await client().from("budgets").delete().eq("id", data.id);
        throw errorLines;
      }
      return data;
    }catch(error){
      if (replacedActive) {
        const { error: restoreError } = await client()
          .from("budgets")
          .update({
            statut: "active",
            validated_at: replacedActive.validated_at || new Date().toISOString()
          })
          .eq("id", replacedActive.id);
        if (restoreError) console.warn("Impossible de reactiver l'ancien budget actif apres erreur:", restoreError);
      }
      throw error;
    }
  }

  async function listBudgets(year){
    const owner = await ownerContext();
    let query = client()
      .from("budgets")
      .select("*");
    if (year) query = query.eq("annee", Number(year));
    query = applyOwner(query, owner);
    query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function getBudget(id){
    const owner = await ownerContext();
    let budgetQuery = client()
      .from("budgets")
      .select("*")
      .eq("id", id);
    budgetQuery = applyOwner(budgetQuery, owner);
    budgetQuery = budgetQuery.single();
    const { data: budget, error } = await budgetQuery;
    if (error) throw error;
    let linesQuery = client()
      .from("budget_lignes")
      .select("*")
      .eq("budget_id", id);
    linesQuery = applyOwner(linesQuery, owner);
    linesQuery = linesQuery.order("ordre", { ascending: true });
    const { data: lines, error: linesError } = await linesQuery;
    if (linesError) throw linesError;
    return { budget, lines: lines || [] };
  }

  async function setBudgetStatus(id, status){
    const next = status === "active" ? "active" : "inactive";
    const { budget } = await getBudget(id);
    if (next === "active") {
      const active = await activeBudgetForEntityYear(budget.entite_id, budget.annee);
      if (active && String(active.id) !== String(id)) {
        const err = new Error(`Un budget actif existe deja pour cette entite et ${budget.annee}.`);
        err.code = "ACTIVE_BUDGET_EXISTS";
        err.activeBudget = active;
        throw err;
      }
    }
    const payload = {
      statut: next,
      validated_at: next === "active" ? new Date().toISOString() : null
    };
    const { data, error } = await client()
      .from("budgets")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteBudget(id){
    const { budget } = await getBudget(id);
    const { error: linesError } = await client()
      .from("budget_lignes")
      .delete()
      .eq("budget_id", id);
    if (linesError) throw linesError;

    const { error } = await client()
      .from("budgets")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return budget;
  }

  async function getActiveBudgetData(entityKey, year){
    const owner = await ownerContext();
    let query = client()
      .from("budget_entites")
      .select("*")
      .eq("key", String(entityKey || "").trim().toLowerCase());
    query = applyOwner(query, owner);
    query = query.limit(1);
    const { data: entities, error: entityError } = await query;
    if (entityError) throw entityError;
    const entity = (entities || [])[0];
    if (!entity) return null;
    const active = await activeBudgetForEntityYear(entity.id, year);
    if (!active) return null;
    const { lines } = await getBudget(active.id);
    return {
      budgetData: toBudgetData(lines),
      meta: {
        source: "supabase",
        budgetId: active.id,
        fileName: active.nom,
        usedUrl: "Supabase budgets actifs",
        sheetName: entity.libelle
      }
    };
  }

  async function getStorageScopeSuffix(){
    const owner = await ownerContext();
    return owner.id || "global";
  }

  window.BudgetSupabase = {
    MONTH_KEYS,
    normalizeLines,
    totalRows,
    toBudgetData,
    ensureDefaultEntities,
    listEntities,
    createEntity,
    renameEntity,
    deactivateEntity,
    listBudgetsForEntity,
    listProjections,
    saveProjection,
    getProjection,
    validateBudget,
    listBudgets,
    getBudget,
    setBudgetStatus,
    deleteBudget,
    getActiveBudgetData,
    getStorageScopeSuffix
  };
})();
