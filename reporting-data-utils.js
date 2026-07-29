(function(){
  const MONTHS = [
    { key: "jan", label: "Janvier", aliases: ["janvier", "jan", "1"] },
    { key: "feb", label: "Fevrier", aliases: ["fevrier", "fev", "2"] },
    { key: "mar", label: "Mars", aliases: ["mars", "mar", "3"] },
    { key: "apr", label: "Avril", aliases: ["avril", "avr", "4"] },
    { key: "may", label: "Mai", aliases: ["mai", "5"] },
    { key: "jun", label: "Juin", aliases: ["juin", "6"] },
    { key: "jul", label: "Juillet", aliases: ["juillet", "juil", "7"] },
    { key: "aug", label: "Aout", aliases: ["aout", "aou", "8"] },
    { key: "sep", label: "Septembre", aliases: ["septembre", "sept", "sep", "9"] },
    { key: "oct", label: "Octobre", aliases: ["octobre", "oct", "10"] },
    { key: "nov", label: "Novembre", aliases: ["novembre", "nov", "11"] },
    { key: "dec", label: "Decembre", aliases: ["decembre", "dec", "12"] },
  ];

  const MONTH_INDEX_BY_KEY = MONTHS.reduce((acc, month, index) => {
    acc[month.key] = index;
    return acc;
  }, {});

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

  function toInt(value){
    return Math.round(toNumber(value));
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

  function monthColumnCandidates(monthKey){
    const month = MONTHS.find((item) => item.key === monthKey);
    return month ? month.aliases : [];
  }

  function monthNameToKey(value){
    const normalized = normalizeKey(value).replace(/\.$/, "");
    for (const month of MONTHS){
      if (month.aliases.includes(normalized)) return month.key;
    }
    return null;
  }

  function monthToIndex(value){
    const key = monthNameToKey(value);
    return key ? MONTH_INDEX_BY_KEY[key] : -1;
  }

  function pickBestSheet(workbook){
    let bestName = workbook.SheetNames[0];
    let bestScore = -1;

    for (const sheetName of workbook.SheetNames){
      const ws = workbook.Sheets[sheetName];
      const ref = ws && ws["!ref"];
      if (!ref) continue;

      const range = XLSX.utils.decode_range(ref);
      const rows = range.e.r - range.s.r + 1;
      const cols = range.e.c - range.s.c + 1;
      const score = rows * cols;

      if (score > bestScore){
        bestScore = score;
        bestName = sheetName;
      }
    }

    return bestName;
  }

  async function fetchXlsxWithFallback(fileName){
    const fileNames = Array.isArray(fileName) ? fileName : [fileName];
    const pageDir = location.href.replace(/[#?].*$/, "").replace(/\/[^\/]*$/, "/");
    const candidates = [];
    for (const currentFileName of fileNames){
      if (!currentFileName) continue;
      const urlSame = new URL(currentFileName, pageDir).toString();
      const urlData = new URL("data/" + currentFileName, pageDir).toString();
      candidates.push({ fileName: currentFileName, url: urlSame });
      candidates.push({ fileName: currentFileName, url: urlData });
    }
    let lastErr = "";

    for (const candidate of candidates){
      const url = candidate.url + (candidate.url.includes("?") ? "&" : "?") + "v=" + Date.now();
      const response = await fetch(url, { cache: "no-store" });
      const buffer = await response.arrayBuffer();

      if (!response.ok){
        lastErr = `HTTP ${response.status} sur ${candidate.url}`;
        continue;
      }

      const sniff = sniffBuffer(buffer);
      if (sniff.looksHtml || !sniff.isZip){
        lastErr = `Contenu invalide sur ${candidate.url} (HTML/404 ou pas XLSX)`;
        continue;
      }

      return { buffer, usedUrl: candidate.url, usedFileName: candidate.fileName };
    }

    throw new Error(lastErr || "fetchXlsxWithFallback failed");
  }

  function sniffBuffer(arrayBuffer){
    const bytes = new Uint8Array(arrayBuffer);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B;
    const head = bytes.slice(0, Math.min(220, bytes.length));
    let preview = "";

    try{
      preview = new TextDecoder("utf-8").decode(head).trim();
    }catch{
      preview = "";
    }

    const normalized = (preview || "").toLowerCase();
    const looksHtml = normalized.startsWith("<") || normalized.includes("<!doctype html") || normalized.includes("<html");
    return { isZip, looksHtml };
  }

  function compactClientCode(value){
    return normalizeKey(value).replace(/[^a-z0-9]+/g, "").slice(0, 40);
  }

  function compactClientName(value){
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60);
  }

  function makeClientMatchKey(name, nclient){
    const compactCode = compactClientCode(nclient);
    const compactName = compactClientName(name);
    if (compactCode && compactName) return `client_${compactCode}__${compactName}`;
    if (compactCode) return `nclient_${compactCode}`;
    if (compactName) return `name_${compactName}`;
    return "";
  }

  function addLookupCandidate(map, key, client){
    if (!key) return;
    const current = map.get(key);
    if (current) current.push(client);
    else map.set(key, [client]);
  }

  function getUniqueLookupCandidate(map, key){
    if (!key) return null;
    const candidates = map.get(key);
    return candidates && candidates.length === 1 ? candidates[0] : null;
  }

  function findMatchedClient(exactMap, byCodeMap, byNameMap, nclient, name){
    const exactKey = makeClientMatchKey(name, nclient);
    if (exactKey && exactMap.has(exactKey)) return exactMap.get(exactKey);

    const byCode = getUniqueLookupCandidate(byCodeMap, compactClientCode(nclient));
    if (byCode) return byCode;

    return getUniqueLookupCandidate(byNameMap, compactClientName(name));
  }

  function normalizeBudgetClientIds(clients){
    if (!Array.isArray(clients)) return;
    for (const client of clients){
      const nextId = makeClientMatchKey(client && client.name, client && client.nclient);
      if (nextId) client.id = nextId;
    }
  }

  function parseBudgetWorkbook(workbook, budgetConfig){
    const sheetName = pickBestSheet(workbook);
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!rows.length) throw new Error("Budget vide");

    const headerMap = buildHeaderMap(rows[0] || {});
    const colClient = findCol(headerMap, budgetConfig.clientCandidates || ["client", "clients"]);
    if (!colClient) throw new Error("Colonne client introuvable");

    const colNClient = findCol(
      headerMap,
      budgetConfig.codeCandidates || ["n client", "n client interne", "no client", "numero client", "num client", "nclient"]
    );

    const monthCols = {};
    for (const month of MONTHS){
      const column = findCol(headerMap, monthColumnCandidates(month.key));
      if (!column) throw new Error(`Colonne mois introuvable: ${month.label}`);
      monthCols[month.key] = column;
    }

    const clients = [];
    for (const row of rows){
      const name = String(row[colClient] || "").trim();
      if (!name) continue;

      const nclient = colNClient ? String(row[colNClient] || "").trim() : "";
      const budget = {};
      for (const month of MONTHS){
        budget[month.key] = toNumber(row[monthCols[month.key]]);
      }

      const id = makeClientMatchKey(name, nclient);
      clients.push({ id, name, nclient, budget });
    }

    normalizeBudgetClientIds(clients);
    return { clients, sheetName };
  }

  async function loadBudgetData(options){
    options = options || {};
    const allowExcelFallback = options.allowExcelFallback === true;
    const supabaseBudget = await loadActiveBudgetDataFromSupabase(options || {});
    if (supabaseBudget) return supabaseBudget;

    if (!allowExcelFallback) {
      return {
        budgetData: { clients: [] },
        meta: {
          source: "supabase_empty",
          fileName: "Aucun budget actif",
          usedUrl: "Supabase budgets actifs",
          sheetName: "Aucun budget actif",
        },
      };
    }

    const fileName = options.fileName || options.fileCandidates;
    const budgetConfig = options.budgetConfig || {};
    const { buffer, usedUrl, usedFileName } = await fetchXlsxWithFallback(fileName);
    const workbook = XLSX.read(buffer, { type: "array" });
    const parsed = parseBudgetWorkbook(workbook, budgetConfig);
    return {
      budgetData: { clients: parsed.clients },
      meta: {
        source: "excel",
        fileName: usedFileName || (Array.isArray(fileName) ? fileName[0] : fileName),
        usedUrl,
        sheetName: parsed.sheetName,
      },
    };
  }

  async function loadActiveBudgetDataFromSupabase(options){
    if (!options || options.preferSupabase === false) return null;
    if (!options.entityKey || !options.year) return null;
    if (!window.BudgetSupabase || typeof window.BudgetSupabase.getActiveBudgetData !== "function") return null;
    const allowExcelFallback = options.allowExcelFallback === true;

    try{
      return await window.BudgetSupabase.getActiveBudgetData(options.entityKey, options.year);
    }catch(error){
      if (!allowExcelFallback) throw error;
      console.warn("Budget actif Supabase indisponible, fallback Excel:", error?.message || error);
      return null;
    }
  }

  function inferEntityKey(options){
    if (options && options.entityKey) return String(options.entityKey || "").trim().toLowerCase();
    const files = [];
    if (options && options.fileName) files.push(options.fileName);
    if (options && Array.isArray(options.fileCandidates)) files.push(...options.fileCandidates);
    else if (options && options.fileCandidates) files.push(options.fileCandidates);
    const text = files.join(" ").toLowerCase();
    if (text.includes("psa")) return "psa";
    if (text.includes("gueudet")) return "gueudet";
    if (text.includes("ford")) return "ford";
    if (text.includes("direct")) return "direct";
    return "";
  }

  async function loadRealDataFromSupabase(options){
    if (!options || options.preferSupabase === false) return null;
    const entityKey = inferEntityKey(options);
    const year = Number.isFinite(options.year) ? options.year : null;
    const realConfig = options.realConfig || {};
    if (!entityKey || !year) return null;
    if (!window.ReelSupabase || typeof window.ReelSupabase.getActiveLinesByEntityYear !== "function") return null;
    const allowExcelFallback = options.allowExcelFallback === true;

    try{
      const rows = await window.ReelSupabase.getActiveLinesByEntityYear(entityKey, year);
      const budgetData = options.budgetData;
      const lookups = buildBudgetLookups(budgetData);
      const nextReal = {};
      const realRows = [];
      const dateSources = {};

      for (const row of rows || []){
        const amount = toNumber(row && row.montant);
        if (!amount) continue;

        const monthNumber = Number(row && row.mois);
        const month = MONTHS[monthNumber - 1];
        if (!month) continue;

        const rawClientCode = String(row.client_code || "").trim();
        const rawClientName = String(row.client_nom || "").trim();
        const budgetClient = ensureBudgetClient(budgetData, lookups, rawClientCode, rawClientName);
        if (!budgetClient) continue;

        if (!nextReal[budgetClient.id]) nextReal[budgetClient.id] = {};
        nextReal[budgetClient.id][month.key] = toNumber(nextReal[budgetClient.id][month.key]) + amount;

        const resolvedDate = resolveSupabaseRowDate(row, realConfig.dateCandidates);
        const date = resolvedDate.date;
        if (resolvedDate.source) dateSources[resolvedDate.source] = (dateSources[resolvedDate.source] || 0) + 1;
        realRows.push({
          monthIdx: MONTH_INDEX_BY_KEY[month.key],
          weekIdx: date ? weekBucket(date) : -1,
          date,
          clientInternal: rawClientCode,
          clientName: rawClientName || budgetClient.name || "",
          budgetClientId: budgetClient.id,
          budgetClientName: budgetClient.name || "",
          budgetClientNClient: budgetClient.nclient || "",
          amount,
          ref: String(row.reference || "").trim(),
          des: String(row.designation || "").trim(),
          qty: toNumber(row.quantite),
        });
      }

      return {
        realData: nextReal,
        realRows,
        activiteClients: buildActivityClients(budgetData, nextReal),
        meta: {
          source: "supabase",
          fileName: "Supabase réel actif",
          usedUrl: "Supabase réel actif",
          sheetName: "v_reel_lignes_actives",
          usedDateColumn: topSource(dateSources) || "date_piece",
          usedMonthColumn: "mois",
          usedYearColumn: "annee",
        },
      };
    }catch(error){
      if (!allowExcelFallback) throw error;
      console.warn("Reel Supabase indisponible, fallback Excel:", error?.message || error);
      return null;
    }
  }

  function resolveSupabaseRowDate(row, preferredCandidates){
    const candidates = uniqueCandidates([
      "Date commande",
      "Date de commande",
      ...(preferredCandidates || []),
      "Date vente",
      "Date de vente",
      "Date facturation",
      "Date facture",
      "Date",
      "date_piece"
    ]);

    const rawData = row && row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};
    const rawMap = {};
    for (const key of Object.keys(rawData)){
      const normalized = normalizeKey(key);
      if (normalized && !rawMap[normalized]) rawMap[normalized] = key;
    }

    for (const candidate of candidates){
      const rawKey = rawMap[normalizeKey(candidate)];
      if (!rawKey) continue;
      const date = parseAnyDate(rawData[rawKey]);
      if (date) return { date, source: rawKey };
    }

    const fallback = parseAnyDate(row && row.date_piece);
    return fallback ? { date: fallback, source: "date_piece" } : { date: null, source: null };
  }

  function uniqueCandidates(values){
    const seen = new Set();
    const output = [];
    for (const value of values || []){
      const normalized = normalizeKey(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(value);
    }
    return output;
  }

  function topSource(sources){
    const entries = Object.entries(sources || {}).sort((a,b) => b[1] - a[1]);
    return entries.length ? entries[0][0] : "";
  }

  function ensureBudgetClient(budgetData, lookups, nclientInterne, clientName){
    const known = findMatchedClient(
      lookups.exact,
      lookups.byCode,
      lookups.byName,
      nclientInterne,
      clientName
    );
    if (known) return known;

    const rawCode = String(nclientInterne || "").trim();
    const rawName = String(clientName || "").trim();
    if (!rawCode && !rawName) return null;

    const name = rawName || `Client ${rawCode}`;
    const id = makeClientMatchKey(name, rawCode);
    const budget = {};
    for (const month of MONTHS) budget[month.key] = 0;

    const client = { id, name, nclient: rawCode, budget, isUnbudgeted: true };
    budgetData.clients.push(client);

    if (id) lookups.exact.set(id, client);
    addLookupCandidate(lookups.byCode, compactClientCode(rawCode), client);
    addLookupCandidate(lookups.byName, compactClientName(name), client);
    return client;
  }

  function buildBudgetLookups(budgetData){
    const exact = new Map();
    const byCode = new Map();
    const byName = new Map();

    normalizeBudgetClientIds(budgetData.clients);

    for (const client of budgetData.clients){
      const exactKey = makeClientMatchKey(client.name, client.nclient);
      if (exactKey) exact.set(exactKey, client);
      addLookupCandidate(byCode, compactClientCode(client.nclient), client);
      addLookupCandidate(byName, compactClientName(client.name), client);
    }

    return { exact, byCode, byName };
  }

  function buildActivityClients(budgetData, realData){
    const out = [];

    for (const client of budgetData.clients || []){
      const months = {};
      let total = 0;

      for (const month of MONTHS){
        const value = toInt(realData && realData[client.id] && realData[client.id][month.key]);
        months[month.key] = value;
        total += value;
      }

      if (!total) continue;
      out.push({
        clientKey: client.id,
        nclient: client.nclient || "",
        name: client.name || "",
        months,
      });
    }

    return out;
  }

  function computeBudgetMonthlyTotals(budgetData){
    const totals = new Array(12).fill(0);
    for (const client of budgetData && budgetData.clients ? budgetData.clients : []){
      for (const month of MONTHS){
        totals[MONTH_INDEX_BY_KEY[month.key]] += toNumber(client && client.budget && client.budget[month.key]);
      }
    }
    return totals;
  }

  function computeRealMonthlyTotals(budgetData, realData){
    const totals = new Array(12).fill(0);
    for (const client of budgetData && budgetData.clients ? budgetData.clients : []){
      const months = realData && realData[client.id];
      for (const month of MONTHS){
        totals[MONTH_INDEX_BY_KEY[month.key]] += toInt(months && months[month.key]);
      }
    }
    return totals;
  }

  async function loadRealDataAgainstBudget(options){
    options = options || {};
    const allowExcelFallback = options.allowExcelFallback === true;
    const fileName = options.fileName || options.fileCandidates;
    const budgetData = options.budgetData;
    const realConfig = options.realConfig || {};
    const year = Number.isFinite(options.year) ? options.year : null;

    if (!budgetData || !Array.isArray(budgetData.clients)) {
      throw new Error("budgetData absent");
    }

    const supabaseReal = await loadRealDataFromSupabase(options);
    if (supabaseReal) return supabaseReal;

    if (!allowExcelFallback) {
      return {
        realData: {},
        realRows: [],
        activiteClients: [],
        meta: {
          source: "supabase_empty",
          fileName: "Aucun reel actif",
          usedUrl: "Supabase reel actif",
          sheetName: "v_reel_lignes_actives",
          usedDateColumn: "date_piece",
          usedMonthColumn: "mois",
          usedYearColumn: "annee",
        },
      };
    }

    const { buffer, usedUrl, usedFileName } = await fetchXlsxWithFallback(fileName);
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = pickBestSheet(workbook);
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (!rows.length){
      return {
        realData: {},
        realRows: [],
        activiteClients: [],
        meta: {
          fileName: usedFileName || (Array.isArray(fileName) ? fileName[0] : fileName),
          usedUrl,
          sheetName,
          usedDateColumn: null,
          usedMonthColumn: null
        },
      };
    }

    const headerMap = buildHeaderMap(rows[0] || {});
    const colClientInt = findCol(headerMap, realConfig.clientCodeCandidates || []);
    const colClientName = findCol(headerMap, realConfig.clientNameCandidates || ["nom du client", "nom client", "client"]);
    const colAmt = findCol(headerMap, realConfig.amountCandidates || ["montant", "ca"]);
    const colMonth = findCol(headerMap, realConfig.monthCandidates || ["mois2", "mois", "month"]);
    const colDate = findCol(headerMap, realConfig.dateCandidates || []);
    const colYear = findCol(headerMap, realConfig.yearCandidates || ["annee", "année", "year"]);
    const colRef = findCol(headerMap, realConfig.refCandidates || []);
    const colDes = findCol(headerMap, realConfig.desCandidates || []);
    const colQty = findCol(headerMap, realConfig.qtyCandidates || []);

    if (!colAmt || (!colMonth && !colDate)){
      throw new Error("Colonnes Date/Mois ou CA introuvables");
    }

    const lookups = buildBudgetLookups(budgetData);
    const nextReal = {};
    const realRows = [];

    for (const row of rows){
      const amount = toInt(row[colAmt]);
      if (!amount) continue;

      let date = null;
      if (colDate) date = parseAnyDate(row[colDate]);

      const explicitYear = colYear ? parseYearValue(row[colYear]) : null;
      if (year){
        if (explicitYear && explicitYear !== year) continue;
        if (!explicitYear && date && date.getFullYear() !== year) continue;
      }

      let monthKey = null;
      if (colMonth) monthKey = monthNameToKey(String(row[colMonth] || "").trim());
      if (!monthKey && date) monthKey = MONTHS[date.getMonth()] && MONTHS[date.getMonth()].key;
      if (!monthKey) continue;

      const rawClientCode = colClientInt ? String(row[colClientInt] || "").trim() : "";
      const rawClientName = colClientName ? String(row[colClientName] || "").trim() : "";
      const budgetClient = ensureBudgetClient(budgetData, lookups, rawClientCode, rawClientName);
      if (!budgetClient) continue;

      if (!nextReal[budgetClient.id]) nextReal[budgetClient.id] = {};
      nextReal[budgetClient.id][monthKey] = toInt(nextReal[budgetClient.id][monthKey]) + amount;

      realRows.push({
        monthIdx: MONTH_INDEX_BY_KEY[monthKey],
        weekIdx: date ? weekBucket(date) : -1,
        date,
        clientInternal: rawClientCode,
        clientName: rawClientName || budgetClient.name || "",
        budgetClientId: budgetClient.id,
        budgetClientName: budgetClient.name || "",
        budgetClientNClient: budgetClient.nclient || "",
        amount,
        ref: colRef ? String(row[colRef] || "").trim() : "",
        des: colDes ? String(row[colDes] || "").trim() : "",
        qty: colQty ? toNumber(row[colQty]) : 0,
      });
    }

    return {
      realData: nextReal,
      realRows,
      activiteClients: buildActivityClients(budgetData, nextReal),
      meta: {
        fileName: usedFileName || (Array.isArray(fileName) ? fileName[0] : fileName),
        usedUrl,
        sheetName,
        usedDateColumn: colDate,
        usedMonthColumn: colMonth,
        usedYearColumn: colYear,
      },
    };
  }

  function parseAnyDate(value){
    if (!value && value !== 0) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

    if (typeof value === "number" && Number.isFinite(value)){
      if (window.XLSX?.SSF?.parse_date_code) {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) {
          const date = new Date(parsed.y, (parsed.m || 1) - 1, parsed.d || 1);
          return Number.isNaN(date.getTime()) ? null : date;
        }
      }
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + value * 86400000);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dmy){
      const day = Number(dmy[1]);
      const month = Number(dmy[2]);
      const year = Number(dmy[3]);
      const fullYear = year < 100 ? 2000 + year : year;
      const date = new Date(fullYear, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymd){
      const date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const timestamp = Date.parse(raw);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }

  function parseYearValue(value){
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)){
      const rounded = Math.round(value);
      return rounded >= 1900 && rounded <= 3000 ? rounded : null;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const match = raw.match(/\b(20\d{2}|19\d{2})\b/);
    return match ? Number(match[1]) : null;
  }

  function weekBucket(date){
    const day = date.getDate();
    if (day <= 7) return 0;
    if (day <= 14) return 1;
    if (day <= 21) return 2;
    return 3;
  }

  window.ReportingDataUtils = {
    MONTHS,
    normalizeKey,
    toNumber,
    toInt,
    monthNameToKey,
    monthToIndex,
    fetchXlsxWithFallback,
    loadBudgetData,
    loadRealDataAgainstBudget,
    loadRealDataFromSupabase,
    computeBudgetMonthlyTotals,
    computeRealMonthlyTotals,
    buildActivityClients,
  };
})();
