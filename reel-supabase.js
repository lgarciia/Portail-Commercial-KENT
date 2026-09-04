(function(){
  const SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";

  const MONTHS = [
    { key:"jan", label:"Janvier", number:1 },
    { key:"feb", label:"Fevrier", number:2 },
    { key:"mar", label:"Mars", number:3 },
    { key:"apr", label:"Avril", number:4 },
    { key:"may", label:"Mai", number:5 },
    { key:"jun", label:"Juin", number:6 },
    { key:"jul", label:"Juillet", number:7 },
    { key:"aug", label:"Aout", number:8 },
    { key:"sep", label:"Septembre", number:9 },
    { key:"oct", label:"Octobre", number:10 },
    { key:"nov", label:"Novembre", number:11 },
    { key:"dec", label:"Decembre", number:12 }
  ];

  const DEFAULT_ENTITIES = [
    { key: "psa", libelle: "PSA", ordre: 10 },
    { key: "gueudet", libelle: "Gueudet", ordre: 20 },
    { key: "ford", libelle: "Ford", ordre: 30 },
    { key: "direct", libelle: "Direct", ordre: 40 }
  ];

  const REAL_COLUMN_CONFIGS = {
    psa: {
      clientCodeCandidates: ["n° client interne", "no client interne", "n client interne", "n° client", "numero client interne", "numero client", "code client", "client code"],
      clientNameCandidates: ["nom du client", "nom client", "client", "raison sociale"],
      amountCandidates: ["montant prix achat kent", "montant achat kent", "montant", "montant ht", "ca total", "ca ht", "ca"],
      monthCandidates: ["mois2", "mois", "month"],
      dateCandidates: ["date commande", "date de commande", "date vente", "date de vente", "date facturation", "date facture", "date", "date piece", "date pièce"],
      refCandidates: ["nos réf kent", "nos ref kent", "reference produits", "reference produit", "référence produits", "référence produit", "code produit", "n° produit", "n produit", "reference", "référence", "ref"],
      desCandidates: ["designation", "désignation", "designation produit", "designation produits"],
      qtyCandidates: ["quantité payante servie", "quantite payante servie", "quantité servie", "quantite servie", "quantite", "quantité", "qte", "qté"]
    },
    gueudet: {
      clientCodeCandidates: ["n° client interne", "no client interne", "n client interne", "numero client interne", "n° client", "no client", "n client", "numero client", "nclient", "code client", "client code"],
      clientNameCandidates: ["nom du client", "nom client", "client", "raison sociale"],
      amountCandidates: ["montant prix achat kent", "montant achat kent", "montant", "montant ht", "ca total", "ca ht", "ca", "chiffre d'affaires", "chiffre daffaires"],
      monthCandidates: ["mois2", "mois", "month"],
      dateCandidates: ["date commande", "date de commande", "date vente", "date de vente", "date facturation", "date facture", "date", "date piece", "date pièce"],
      refCandidates: ["nos réf kent", "nos ref kent", "reference produits", "reference produit", "référence produits", "référence produit", "code produit", "n° produit", "n produit", "reference", "référence", "ref"],
      desCandidates: ["designation", "désignation", "designation produit", "designation produits"],
      qtyCandidates: ["quantité payante servie", "quantite payante servie", "quantité servie", "quantite servie", "quantite", "quantité", "qte", "qté"]
    },
    default: {
      clientCodeCandidates: ["code livré", "code livre", "code livré client", "code livre client", "code client", "client code", "n° client", "no client", "n client", "numero client", "nclient", "code"],
      clientNameCandidates: ["nom client", "nom du client", "client", "raison sociale", "nom"],
      amountCandidates: ["ca total", "ca ht", "ca", "chiffre d'affaires", "chiffre daffaires", "montant", "montant ht", "total ht", "total"],
      monthCandidates: ["mois2", "mois", "month"],
      dateCandidates: ["date commande", "date de commande", "date vente", "date de vente", "date facturation", "date facture", "date", "date piece", "date pièce"],
      refCandidates: ["nos réf kent", "nos ref kent", "reference produits", "reference produit", "référence produits", "référence produit", "code produit", "n° produit", "n produit", "reference", "référence", "ref"],
      desCandidates: ["designation", "désignation", "designation produit", "designation produits"],
      qtyCandidates: ["quantité payante servie", "quantite payante servie", "quantité servie", "quantite servie", "quantite", "quantité", "qte", "qté"]
    }
  };

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
      console.warn("Session reel indisponible:", error?.message || error);
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
      const [entitiesCheck, importsCheck] = await Promise.all([
        client().from("budget_entites").select("commercial_user_id").limit(1),
        client().from("reel_imports").select("commercial_user_id").limit(1)
      ]);
      ownershipReady = !entitiesCheck.error && !importsCheck.error;
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

  function normalizeKey(value){
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function toNumber(value){
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildHeaderMap(sampleRow){
    const map = {};
    for (const key of Object.keys(sampleRow || {})){
      const normalized = normalizeKey(key);
      const loose = looseKey(key);
      if (normalized && !map[normalized]) map[normalized] = key;
      if (loose && !map[loose]) map[loose] = key;
    }
    return map;
  }

  function findCol(headerMap, candidates){
    for (const candidate of candidates || []){
      const normalized = normalizeKey(candidate);
      if (headerMap[normalized]) return headerMap[normalized];
      const loose = looseKey(candidate);
      if (headerMap[loose]) return headerMap[loose];
    }
    return null;
  }

  function looseKey(value){
    return normalizeKey(value)
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function monthToKey(value){
    const raw = String(value || "").trim();
    const numeric = Number(raw.replace(",", "."));
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 12) {
      return MONTHS[Math.round(numeric) - 1]?.key || null;
    }
    const normalized = normalizeKey(raw).replace(/\.$/, "");
    const aliases = {
      jan:["janvier", "jan"], feb:["fevrier", "fev", "février", "fév"], mar:["mars", "mar"],
      apr:["avril", "avr"], may:["mai"], jun:["juin"], jul:["juillet", "juil"],
      aug:["aout", "aou", "août"], sep:["septembre", "sept", "sep"], oct:["octobre", "oct"],
      nov:["novembre", "nov"], dec:["decembre", "dec", "décembre"]
    };
    for (const [key, values] of Object.entries(aliases)){
      if (values.map(normalizeKey).includes(normalized)) return key;
    }
    return null;
  }

  function monthNumberToKey(monthNumber){
    return MONTHS.find(month => month.number === Number(monthNumber))?.key || "";
  }

  function parseDate(value){
    if (!value && value !== 0) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number" && Number.isFinite(value) && window.XLSX?.SSF?.parse_date_code) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (!parsed) return null;
      const date = new Date(parsed.y, (parsed.m || 1) - 1, parsed.d || 1);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dmy) {
      const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
      const date = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymd) {
      const date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const timestamp = Date.parse(raw);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }

  function dateToIso(date){
    if (!date || Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function configForEntity(entityKey){
    const key = String(entityKey || "").trim().toLowerCase();
    return REAL_COLUMN_CONFIGS[key] || REAL_COLUMN_CONFIGS.default;
  }

  async function ensureDefaultEntities(){
    if (window.BudgetSupabase && typeof window.BudgetSupabase.ensureDefaultEntities === "function") {
      await window.BudgetSupabase.ensureDefaultEntities();
      return;
    }

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
    if (window.BudgetSupabase && typeof window.BudgetSupabase.listEntities === "function") {
      return window.BudgetSupabase.listEntities();
    }

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

  function parseRows(rows, options = {}){
    if (!Array.isArray(rows) || !rows.length) {
      return { lines: [], total: 0, columns: {}, skipped: { empty: 0, wrongMonth: 0, noAmount: 0, noMonth: 0 } };
    }
    const config = configForEntity(options.entityKey);
    const headerMap = buildHeaderMap(rows[0]);
    const colClientCode = findCol(headerMap, config.clientCodeCandidates);
    const colClientName = findCol(headerMap, config.clientNameCandidates);
    const colAmount = findCol(headerMap, config.amountCandidates);
    const colMonth = findCol(headerMap, config.monthCandidates);
    const colDate = findCol(headerMap, config.dateCandidates);
    const colRef = findCol(headerMap, config.refCandidates);
    const colDes = findCol(headerMap, config.desCandidates);
    const colQty = findCol(headerMap, config.qtyCandidates);

    const selectedMonth = Number(options.month);
    const selectedMonthKey = monthNumberToKey(selectedMonth);
    const forceSelectedMonth = Boolean(selectedMonthKey) && options.forceSelectedMonth !== false;

    const missing = [];
    if (!colClientCode) missing.push("code client");
    if (!colClientName) missing.push("nom client");
    if (!colAmount) missing.push("montant");
    if (!forceSelectedMonth && !colMonth && !colDate) missing.push("mois ou date");
    if (missing.length) {
      throw new Error(`Colonnes introuvables : ${missing.join(", ")}.`);
    }

    const lines = [];
    const skipped = { empty: 0, wrongMonth: 0, noAmount: 0, noMonth: 0 };

    for (const [index, row] of rows.entries()){
      const clientCode = String(row[colClientCode] ?? "").trim();
      const clientName = String(row[colClientName] ?? "").trim();
      if (!clientCode && !clientName) {
        skipped.empty += 1;
        continue;
      }

      const date = colDate ? parseDate(row[colDate]) : null;
      let monthKey = selectedMonthKey;
      if (!forceSelectedMonth) {
        monthKey = colMonth ? monthToKey(row[colMonth]) : null;
        if (!monthKey && date) monthKey = MONTHS[date.getMonth()]?.key || null;
        if (!monthKey) {
          skipped.noMonth += 1;
          continue;
        }
        if (selectedMonthKey && monthKey !== selectedMonthKey) {
          skipped.wrongMonth += 1;
          continue;
        }
      }

      const amount = toNumber(row[colAmount]);
      if (!amount) {
        skipped.noAmount += 1;
        continue;
      }

      lines.push({
        ordre: index,
        client_code: clientCode || null,
        client_nom: clientName || `Client ${clientCode}`,
        montant: amount,
        mois_source: MONTHS.find(month => month.key === monthKey)?.number || selectedMonth,
        date_piece: dateToIso(date),
        reference: colRef ? String(row[colRef] || "").trim() || null : null,
        designation: colDes ? String(row[colDes] || "").trim() || null : null,
        quantite: colQty ? toNumber(row[colQty]) : 0,
        raw_data: row || {}
      });
    }

    return {
      lines,
      total: lines.reduce((sum, line) => sum + Number(line.montant || 0), 0),
      columns: {
        clientCode: colClientCode,
        clientName: colClientName,
        amount: colAmount,
        month: colMonth,
        date: colDate,
        reference: colRef,
        designation: colDes,
        quantity: colQty
      },
      skipped
    };
  }

  async function deactivateActiveImports(entiteId, year, month){
    const owner = await ownerContext();
    let query = client()
      .from("reel_imports")
      .select("*")
      .eq("entite_id", entiteId)
      .eq("annee", Number(year))
      .eq("mois", Number(month))
      .eq("statut", "active");
    query = applyOwner(query, owner);
    const { data: activeRows, error: activeError } = await query;
    if (activeError) throw activeError;
    if (!activeRows?.length) return [];

    const { error } = await client()
      .from("reel_imports")
      .update({ statut: "inactive" })
      .in("id", activeRows.map(row => row.id));
    if (error) throw error;
    return activeRows;
  }

  async function insertLines(importId, lines, owner){
    const payload = lines.map(line => ({ ...line, import_id: importId, ...(owner?.payload || {}) }));
    if (!payload.length) return;
    const chunkSize = 500;
    for (let index = 0; index < payload.length; index += chunkSize){
      const chunk = payload.slice(index, index + chunkSize);
      const { error } = await client().from("reel_lignes").insert(chunk);
      if (error) throw error;
    }
  }

  async function saveMonthlyImport({ entiteId, entiteKey = "", entiteLabel = "", year, month, name = "", sourceFile = "", sheetName = "", parsed, replaceActive = true }){
    if (!entiteId) throw new Error("Entite obligatoire.");
    if (!Number(year)) throw new Error("Annee obligatoire.");
    if (!Number(month) || Number(month) < 1 || Number(month) > 12) throw new Error("Mois obligatoire.");
    if (!parsed || !Array.isArray(parsed.lines) || !parsed.lines.length) throw new Error("Aucune ligne reel a importer.");

    const owner = await ownerContext();
    let replaced = [];
    if (replaceActive) {
      replaced = await deactivateActiveImports(entiteId, year, month);
    }

    const monthLabel = MONTHS.find(item => item.number === Number(month))?.label || `Mois ${month}`;
    const payload = {
      entite_id: entiteId,
      annee: Number(year),
      mois: Number(month),
      statut: "active",
      nom: String(name || "").trim() || `Reel ${entiteLabel || entiteKey || "Entite"} ${monthLabel} ${year}`,
      source_file: sourceFile || null,
      sheet_name: sheetName || null,
      total_mois: Number(parsed.total || 0),
      nb_lignes: parsed.lines.length,
      colonnes_map: parsed.columns || {},
      meta: {
        imported_from: "import-reel-mensuel",
        skipped: parsed.skipped || {},
        replaced_import_ids: replaced.map(row => row.id)
      },
      ...owner.payload
    };

    let saved = null;
    try{
      const { data, error } = await client()
        .from("reel_imports")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      saved = data;
      await insertLines(saved.id, parsed.lines, owner);
      return { importRow: saved, replaced };
    }catch(error){
      if (saved?.id) {
        await client().from("reel_imports").delete().eq("id", saved.id);
      }
      if (replaced.length) {
        await client()
          .from("reel_imports")
          .update({ statut: "active" })
          .in("id", replaced.map(row => row.id));
      }
      throw error;
    }
  }

  async function listImports({ year, month = null, entiteId = null, includeInactive = true } = {}){
    const owner = await ownerContext();
    let query = client()
      .from("reel_imports")
      .select("*");
    if (year) query = query.eq("annee", Number(year));
    if (month) query = query.eq("mois", Number(month));
    if (entiteId) query = query.eq("entite_id", entiteId);
    if (!includeInactive) query = query.eq("statut", "active");
    query = applyOwner(query, owner);
    query = query
      .order("annee", { ascending: false })
      .order("mois", { ascending: false })
      .order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function getImport(id){
    const owner = await ownerContext();
    let importQuery = client()
      .from("reel_imports")
      .select("*")
      .eq("id", id);
    importQuery = applyOwner(importQuery, owner);
    importQuery = importQuery.single();
    const { data: importRow, error } = await importQuery;
    if (error) throw error;
    let linesQuery = client()
      .from("reel_lignes")
      .select("*")
      .eq("import_id", id);
    linesQuery = applyOwner(linesQuery, owner);
    linesQuery = linesQuery.order("ordre", { ascending: true });
    const { data: lines, error: linesError } = await linesQuery;
    if (linesError) throw linesError;
    return { importRow, lines: lines || [] };
  }

  async function deleteImport(id){
    const { importRow } = await getImport(id);
    const { error: linesError } = await client().from("reel_lignes").delete().eq("import_id", id);
    if (linesError) throw linesError;
    const { error } = await client().from("reel_imports").delete().eq("id", id);
    if (error) throw error;
    return importRow;
  }

  async function activateImport(id){
    const { importRow } = await getImport(id);
    const active = await deactivateActiveImports(importRow.entite_id, importRow.annee, importRow.mois);
    const owner = await ownerContext();
    let query = client()
      .from("reel_imports")
      .update({
        statut: "active",
        meta: {
          ...(importRow.meta && typeof importRow.meta === "object" ? importRow.meta : {}),
          activated_at: new Date().toISOString(),
          replaced_import_ids: active.map(row => row.id)
        }
      })
      .eq("id", id);
    query = applyOwner(query, owner);
    query = query.select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async function getAnnualRealByEntity(entityId, year){
    const owner = await ownerContext();
    let query = client()
      .from("v_reel_annuel_clients")
      .select("*")
      .eq("entite_id", entityId)
      .eq("annee", Number(year));
    query = applyOwner(query, owner);
    query = query.order("client_nom", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function selectAllPaged(buildQuery, pageSize = 1000){
    const all = [];
    for (let start = 0; ; start += pageSize){
      const { data, error } = await buildQuery().range(start, start + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  async function getActiveLinesByEntityYear(entityKey, year, options = {}){
    if (!entityKey) throw new Error("Entite obligatoire.");
    if (!Number(year)) throw new Error("Annee obligatoire.");
    const entityId = String(options.entityId || "").trim();
    const owner = await ownerContext();
    return await selectAllPaged(() => {
      let query = client()
        .from("v_reel_lignes_actives")
        .select("*")
        .eq("entite_key", String(entityKey))
        .eq("annee", Number(year));
      if (entityId) query = query.eq("entite_id", entityId);
      query = applyOwner(query, owner);
      return query
        .order("mois", { ascending: true })
        .order("ordre", { ascending: true });
    });
  }

  window.ReelSupabase = {
    MONTHS,
    REAL_COLUMN_CONFIGS,
    normalizeKey,
    toNumber,
    configForEntity,
    listEntities,
    parseRows,
    saveMonthlyImport,
    listImports,
    getImport,
    deleteImport,
    activateImport,
    getAnnualRealByEntity,
    getActiveLinesByEntityYear
  };
})();
