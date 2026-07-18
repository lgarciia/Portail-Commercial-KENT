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

  const REAL_COLUMN_CONFIGS = {
    psa: {
      clientCodeCandidates: ["n° client interne", "no client interne", "n client interne", "n° client", "numero client interne"],
      clientNameCandidates: ["nom du client", "nom client", "client"],
      amountCandidates: ["montant prix achat kent", "montant achat kent", "montant"],
      monthCandidates: ["mois2", "mois", "month"],
      dateCandidates: ["date facturation", "date de vente", "date vente", "date facture", "date", "date piece", "date pièce"],
      refCandidates: ["nos réf kent", "nos ref kent", "reference produits", "reference produit", "référence produits", "référence produit", "code produit", "n° produit", "n produit", "reference", "référence", "ref"],
      desCandidates: ["designation", "désignation", "designation produit", "designation produits"],
      qtyCandidates: ["quantité payante servie", "quantite payante servie", "quantité servie", "quantite servie", "quantite", "quantité", "qte", "qté"]
    },
    gueudet: {
      clientCodeCandidates: ["n° client interne", "no client interne", "n client interne", "numero client interne", "n° client", "no client", "n client", "numero client", "nclient"],
      clientNameCandidates: ["nom du client", "nom client", "client"],
      amountCandidates: ["montant prix achat kent", "montant achat kent", "montant", "ca total", "ca", "chiffre d'affaires", "chiffre daffaires"],
      monthCandidates: ["mois2", "mois", "month"],
      dateCandidates: ["date facturation", "date de vente", "date vente", "date facture", "date", "date piece", "date pièce"],
      refCandidates: ["nos réf kent", "nos ref kent", "reference produits", "reference produit", "référence produits", "référence produit", "code produit", "n° produit", "n produit", "reference", "référence", "ref"],
      desCandidates: ["designation", "désignation", "designation produit", "designation produits"],
      qtyCandidates: ["quantité payante servie", "quantite payante servie", "quantité servie", "quantite servie", "quantite", "quantité", "qte", "qté"]
    },
    default: {
      clientCodeCandidates: ["code livré", "code livre", "code", "code livre client"],
      clientNameCandidates: ["nom client", "nom du client", "client"],
      amountCandidates: ["ca total", "ca", "chiffre d'affaires", "chiffre daffaires", "montant"],
      monthCandidates: ["mois2", "mois", "month"],
      dateCandidates: ["date facturation", "date de vente", "date vente", "date commande", "date facture", "date", "date piece", "date pièce"],
      refCandidates: ["nos réf kent", "nos ref kent", "reference produits", "reference produit", "référence produits", "référence produit", "code produit", "n° produit", "n produit", "reference", "référence", "ref"],
      desCandidates: ["designation", "désignation", "designation produit", "designation produits"],
      qtyCandidates: ["quantité payante servie", "quantite payante servie", "quantité servie", "quantite servie", "quantite", "quantité", "qte", "qté"]
    }
  };

  let cachedClient = null;

  function client(){
    if (cachedClient) return cachedClient;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase indisponible sur cette page.");
    }
    cachedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return cachedClient;
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
      map[normalizeKey(key)] = key;
    }
    return map;
  }

  function findCol(headerMap, candidates){
    for (const candidate of candidates || []){
      const normalized = normalizeKey(candidate);
      if (headerMap[normalized]) return headerMap[normalized];
    }
    return null;
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

  async function listEntities(){
    const { data, error } = await client()
      .from("budget_entites")
      .select("*")
      .eq("actif", true)
      .order("ordre", { ascending: true })
      .order("libelle", { ascending: true });
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
    const { data: activeRows, error: activeError } = await client()
      .from("reel_imports")
      .select("*")
      .eq("entite_id", entiteId)
      .eq("annee", Number(year))
      .eq("mois", Number(month))
      .eq("statut", "active");
    if (activeError) throw activeError;
    if (!activeRows?.length) return [];

    const { error } = await client()
      .from("reel_imports")
      .update({ statut: "inactive" })
      .in("id", activeRows.map(row => row.id));
    if (error) throw error;
    return activeRows;
  }

  async function insertLines(importId, lines){
    const payload = lines.map(line => ({ ...line, import_id: importId }));
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
      }
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
      await insertLines(saved.id, parsed.lines);
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
    let query = client()
      .from("reel_imports")
      .select("*")
      .order("annee", { ascending: false })
      .order("mois", { ascending: false })
      .order("created_at", { ascending: false });
    if (year) query = query.eq("annee", Number(year));
    if (month) query = query.eq("mois", Number(month));
    if (entiteId) query = query.eq("entite_id", entiteId);
    if (!includeInactive) query = query.eq("statut", "active");
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function getImport(id){
    const { data: importRow, error } = await client()
      .from("reel_imports")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    const { data: lines, error: linesError } = await client()
      .from("reel_lignes")
      .select("*")
      .eq("import_id", id)
      .order("ordre", { ascending: true });
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
    const { data, error } = await client()
      .from("reel_imports")
      .update({
        statut: "active",
        meta: {
          ...(importRow.meta && typeof importRow.meta === "object" ? importRow.meta : {}),
          activated_at: new Date().toISOString(),
          replaced_import_ids: active.map(row => row.id)
        }
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function getAnnualRealByEntity(entityId, year){
    const { data, error } = await client()
      .from("v_reel_annuel_clients")
      .select("*")
      .eq("entite_id", entityId)
      .eq("annee", Number(year))
      .order("client_nom", { ascending: true });
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

  async function getActiveLinesByEntityYear(entityKey, year){
    if (!entityKey) throw new Error("Entite obligatoire.");
    if (!Number(year)) throw new Error("Annee obligatoire.");
    return await selectAllPaged(() => client()
      .from("v_reel_lignes_actives")
      .select("*")
      .eq("entite_key", String(entityKey))
      .eq("annee", Number(year))
      .order("mois", { ascending: true })
      .order("ordre", { ascending: true })
    );
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
