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

  function client(){
    if (cachedClient) return cachedClient;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase indisponible sur cette page.");
    }
    cachedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return cachedClient;
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
        budget: MONTH_KEYS.reduce((acc, key) => {
          acc[key] = toNumber(line[key]);
          return acc;
        }, {})
      }))
    };
  }

  async function ensureDefaultEntities(){
    const { error } = await client()
      .from("budget_entites")
      .upsert(DEFAULT_ENTITIES, { onConflict: "key" });
    if (error) throw error;
  }

  async function listEntities(){
    await ensureDefaultEntities();
    const { data, error } = await client()
      .from("budget_entites")
      .select("*")
      .eq("actif", true)
      .order("ordre", { ascending: true })
      .order("libelle", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function createEntity(label){
    const libelle = String(label || "").trim();
    if (!libelle) throw new Error("Nom entite obligatoire.");
    const payload = { key: makeEntityKey(libelle), libelle, actif: true, ordre: 100 };
    const { data, error } = await client()
      .from("budget_entites")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function listProjections(year){
    let query = client()
      .from("budget_projections")
      .select("*")
      .order("created_at", { ascending: false });
    if (year) query = query.eq("annee", Number(year));
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function insertProjectionLines(projectionId, lines){
    const payload = normalizeLines(lines).map(line => ({ ...line, projection_id: projectionId }));
    if (!payload.length) return;
    const { error } = await client().from("budget_projection_lignes").insert(payload);
    if (error) throw error;
  }

  async function saveProjection({ nom, annee, sourceLabel = "", sourceEntityKey = "", rows = [], meta = {} }){
    const lines = normalizeLines(rows);
    if (!lines.length) throw new Error("Aucune ligne a enregistrer.");
    const payload = {
      nom: String(nom || "").trim() || `Projection ${annee || ""}`.trim(),
      annee: Number(annee),
      source_label: sourceLabel || null,
      source_entite_key: sourceEntityKey || null,
      total_annuel: totalRows(lines),
      nb_lignes: lines.length,
      meta: meta || {}
    };
    const { data, error } = await client()
      .from("budget_projections")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    try{
      await insertProjectionLines(data.id, lines);
    }catch(errorLines){
      await client().from("budget_projections").delete().eq("id", data.id);
      throw errorLines;
    }
    return data;
  }

  async function getProjection(id){
    const { data: projection, error } = await client()
      .from("budget_projections")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    const { data: lines, error: linesError } = await client()
      .from("budget_projection_lignes")
      .select("*")
      .eq("projection_id", id)
      .order("ordre", { ascending: true });
    if (linesError) throw linesError;
    return { projection, lines: lines || [] };
  }

  async function activeBudgetForEntityYear(entityId, year){
    const { data, error } = await client()
      .from("budgets")
      .select("*")
      .eq("entite_id", entityId)
      .eq("annee", Number(year))
      .eq("statut", "active")
      .limit(1);
    if (error) throw error;
    return (data || [])[0] || null;
  }

  async function insertBudgetLines(budgetId, lines){
    const payload = normalizeLines(lines).map(line => ({ ...line, budget_id: budgetId }));
    if (!payload.length) return;
    const { error } = await client().from("budget_lignes").insert(payload);
    if (error) throw error;
  }

  async function validateBudget({ nom, annee, entityId, projectionId = null, rows = [], meta = {} }){
    const lines = normalizeLines(rows);
    if (!lines.length) throw new Error("Aucune ligne budget a valider.");
    const active = await activeBudgetForEntityYear(entityId, annee);
    if (active) {
      const err = new Error(`Un budget actif existe deja pour cette entite et ${annee}. Desactive-le avant d'en valider un autre.`);
      err.code = "ACTIVE_BUDGET_EXISTS";
      err.activeBudget = active;
      throw err;
    }
    const payload = {
      projection_id: projectionId || null,
      entite_id: entityId,
      nom: String(nom || "").trim() || `Budget ${annee}`,
      annee: Number(annee),
      statut: "active",
      total_annuel: totalRows(lines),
      nb_lignes: lines.length,
      meta: meta || {},
      validated_at: new Date().toISOString()
    };
    const { data, error } = await client()
      .from("budgets")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    try{
      await insertBudgetLines(data.id, lines);
    }catch(errorLines){
      await client().from("budgets").delete().eq("id", data.id);
      throw errorLines;
    }
    return data;
  }

  async function listBudgets(year){
    let query = client()
      .from("budgets")
      .select("*")
      .order("created_at", { ascending: false });
    if (year) query = query.eq("annee", Number(year));
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function getBudget(id){
    const { data: budget, error } = await client()
      .from("budgets")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    const { data: lines, error: linesError } = await client()
      .from("budget_lignes")
      .select("*")
      .eq("budget_id", id)
      .order("ordre", { ascending: true });
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

  async function getActiveBudgetData(entityKey, year){
    await ensureDefaultEntities();
    const { data: entities, error: entityError } = await client()
      .from("budget_entites")
      .select("*")
      .eq("key", String(entityKey || "").trim().toLowerCase())
      .limit(1);
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

  window.BudgetSupabase = {
    MONTH_KEYS,
    normalizeLines,
    totalRows,
    toBudgetData,
    ensureDefaultEntities,
    listEntities,
    createEntity,
    listProjections,
    saveProjection,
    getProjection,
    validateBudget,
    listBudgets,
    getBudget,
    setBudgetStatus,
    getActiveBudgetData
  };
})();
