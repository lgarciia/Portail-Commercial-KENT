


// âœ… CONFIG VUE SEMAINE (Ã  changer pour Ford/Gueudet/Direct)
const WEEK_VIEW_PAGE = "vue_semaine.html";
const ENTITY_KEY     = "PSA";
const REAL_XLSX_FILE = "activitereelpsa.xlsx";
const REAL_DATE_COL  = "Date vente";
(function(){
  // ---------------------------
  // CONFIG PSA (localStorage keys)
  // ---------------------------
  const STORAGE = {
    budget: "BUDGET2026_DATA_PSA_V1",
    activiteReel: "ACTIVITEREEL_PSA_V1",
    realOverride: "BUDGET2026_REAL_PSA_V1" // optionnel
  };

  const MONTHS = [
    { key:"jan", label:"Janvier" },
    { key:"feb", label:"FÃ©vrier" },
    { key:"mar", label:"Mars" },
    { key:"apr", label:"Avril" },
    { key:"may", label:"Mai" },
    { key:"jun", label:"Juin" },
    { key:"jul", label:"Juillet" },
    { key:"aug", label:"AoÃ»t" },
    { key:"sep", label:"Septembre" },
    { key:"oct", label:"Octobre" },
    { key:"nov", label:"Novembre" },
    { key:"dec", label:"DÃ©cembre" },
  ];

  const nf0 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits:0, maximumFractionDigits:0 });
// ===========================
// CONFIG VUE SEMAINE (COPY/PASTE FRIENDLY)
// ===========================
// ðŸ‘‰ pour dupliquer sur Ford/Gueudet/Direct : tu changes ces 4 lignes
const WEEK_VIEW_PAGE = "vue_semaine.html";     // nom du fichier de la page semaine
const REAL_XLSX_FILE = "activitereelpsa.xlsx"; // âš ï¸ mets ici TON fichier rÃ©el de l'entitÃ© (ex: activitereelford.xlsx)
const ENTITY_KEY = "PSA";                      // "PSA" / "FORD" / "GUEUDET" / "DIRECT"
const REAL_DATE_COL = "Date vente";            // nom colonne date dans le rÃ©el (tolÃ©rance accents/casse)
  // ---------------------------
  // DOM
  // ---------------------------
  const el = {
    dotBudget: document.getElementById("dotBudget"),
    dotReel: document.getElementById("dotReel"),
    sBudget: document.getElementById("sBudget"),
    sReel: document.getElementById("sReel"),

    btnReset: document.getElementById("btnReset"),
    btnGenerate: document.getElementById("btnGenerate"),
    btnExportCsv: document.getElementById("btnExportCsv"),

    filtersGrid: document.getElementById("filtersGrid"),
    resultTable: document.getElementById("resultTable"),

    kClients: document.getElementById("kClients"),
    kReal: document.getElementById("kReal"),
    kBudget2: document.getElementById("kBudget2"),
    kEcart: document.getElementById("kEcart"),
  };

  // ---------------------------
  // LOAD DATA
  // ---------------------------
  const budgetData = loadJSON(STORAGE.budget, null);     // {clients:[{id,name,nclient,budget:{jan..dec}}]}
  const activite = loadJSON(STORAGE.activiteReel, null); // {clients:[{nclient,name,months:{jan..dec}}]}
  let override = loadJSON(STORAGE.realOverride, {});
  if (!override || typeof override !== "object") override = {};

  // index activitÃ© rÃ©elle
  const actByExact = new Map();
  const actByNClient = new Map();
  const actByName = new Map();
  if (activite?.clients?.length){
    for (const c of activite.clients){
      indexActiviteClient(c);
    }
  }

  paintStatus();

  // ---------------------------
  // FILTERS SETUP
  // ---------------------------
  const dimensions = [
    { key:"ANNEE", label:"ANNÃ‰E" },
    { key:"MOIS", label:"MOIS" },
    { key:"CLIENT", label:"CLIENTS" },
    { key:"NCLIENT", label:"N CLIENT" },
  ];

  const values = {
    ANNEE: ["2026"],
    MOIS: MONTHS.map(m=>m.label),
    CLIENT: (budgetData?.clients || []).map(c => c.name || "").filter(Boolean).sort((a,b)=>a.localeCompare(b, "fr")),
    NCLIENT: (budgetData?.clients || []).map(c => String(c.nclient || "").trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b, "fr")),
  };

  const filters = {
    ANNEE: new Set(values.ANNEE),
    MOIS: new Set(values.MOIS),
    CLIENT: new Set(values.CLIENT),
    NCLIENT: new Set(values.NCLIENT),
  };

  const searches = { ANNEE:"", MOIS:"", CLIENT:"", NCLIENT:"" };
  let lastExportRows = [];

  buildFiltersUI();
  renderAllLists();
  generate();

  el.btnReset.addEventListener("click", ()=>{
    filters.ANNEE = new Set(values.ANNEE);
    filters.MOIS = new Set(values.MOIS);
    filters.CLIENT = new Set(values.CLIENT);
    filters.NCLIENT = new Set(values.NCLIENT);
    searches.ANNEE = searches.MOIS = searches.CLIENT = searches.NCLIENT = "";
    el.filtersGrid.querySelectorAll("input[data-search]").forEach(i=>i.value="");
    renderAllLists();
    generate();
  });

  el.btnGenerate.addEventListener("click", generate);
  el.btnExportCsv.addEventListener("click", exportCSV);


  // âœ… Click sur bouton "Sem." (event delegation) -> ouvre vue_semaine.html
el.resultTable.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-weekbtn='1']");
  if (!btn) return;

  const monthKey = btn.getAttribute("data-mkey");
  const monthLabel = btn.getAttribute("data-mlabel");

  // on passe tout en querystring (copy/paste multi-entitÃ©s)
  const qs = new URLSearchParams({
    entity: ENTITY_KEY,
    month: monthKey,
    monthLabel: monthLabel || "",
    realFile: REAL_XLSX_FILE,
    dateCol: REAL_DATE_COL,
    // ðŸ‘‡ on rÃ©utilise tes keys localStorage dÃ©jÃ  existantes dans la page
    budgetKey: STORAGE.budget,
    overrideKey: STORAGE.realOverride
  });

  window.location.href = `${WEEK_VIEW_PAGE}?${qs.toString()}`;
});

  // ---------------------------
  // CORE: month columns
  // ---------------------------
  function generate(){
    if (!budgetData?.clients?.length){
      el.resultTable.innerHTML = emptyTable("Aucune donnÃ©e Budget PSA en localStorage.");
      setKpis(0,0,0,0);
      lastExportRows = [];
      return;
    }

    const selectedMonths = MONTHS.filter(m => filters.MOIS.has(m.label));
    if (!selectedMonths.length){
      el.resultTable.innerHTML = emptyTable("Aucun mois sÃ©lectionnÃ©.");
      setKpis(0,0,0,0);
      lastExportRows = [];
      return;
    }

    const clients = budgetData.clients.filter(c=>{
      const name = c.name || "";
      const nc = String(c.nclient || "").trim();
      const okClient = filters.CLIENT.size ? filters.CLIENT.has(name) : false;
      const okNc = (values.NCLIENT.length === 0) ? true : (filters.NCLIENT.size ? filters.NCLIENT.has(nc) : false);
      return okClient && okNc;
    });

    const rows = clients.map(c=>{
      const per = {};
      let cumReal=0, cumBudget=0;

      for (const m of selectedMonths){
        const b = toInt(c?.budget?.[m.key]);
        const r = getRealForClientMonth(c, m.key);
        const e = r - b;
        per[m.key] = { real:r, budget:b, ecart:e };
        cumReal += r; cumBudget += b;
      }

      return {
        name: c.name || "",
        nclient: String(c.nclient || "").trim(),
        per,
        cum: { real:cumReal, budget:cumBudget, ecart:(cumReal-cumBudget) }
      };
    });

    const global = { per:{}, cum:{ real:0, budget:0, ecart:0 } };
    for (const m of selectedMonths){
      let sr=0,sb=0;
      for (const r of rows){ sr += r.per[m.key].real; sb += r.per[m.key].budget; }
      global.per[m.key] = { real:sr, budget:sb, ecart:(sr-sb) };
      global.cum.real += sr;
      global.cum.budget += sb;
    }
    global.cum.ecart = global.cum.real - global.cum.budget;

    setKpis(rows.length, global.cum.real, global.cum.budget, global.cum.ecart);

    const thead = `
      <thead>
        <tr>
          <th class="col-client">Client</th>
          <th class="col-nclient">N CLIENT</th>
${selectedMonths.map((m,idx)=>`
  <th class="${idx===0 ? "mStart" : ""}" colspan="3">
    ${escapeHtml(m.label)}
    <button class="wkBtn" type="button" data-weekbtn="1" data-mkey="${m.key}" data-mlabel="${escapeAttr(m.label)}" title="Vue semaine">
      <span class="ic">â†—</span><span class="tx">Sem.</span>
    </button>
  </th>
`).join("")}
          <th class="mStart" colspan="3">Cumul</th>
        </tr>
        <tr>
          <th class="col-client">â€”</th>
          <th class="col-nclient">â€”</th>
          ${selectedMonths.map((m,idx)=>`
            <th class="${idx===0 ? "mStart" : ""}">RÃ©el</th>
            <th class="subSep">Budget</th>
            <th class="subSep">Ã‰cart</th>
          `).join("")}
          <th class="mStart">RÃ©el</th>
          <th class="subSep">Budget</th>
          <th class="subSep">Ã‰cart</th>
        </tr>
      </thead>
    `;

    const rowGlobal = `
      <tr class="rowTotal">
        <td class="col-client">Cumul</td>
        <td class="col-nclient">â€”</td>
        ${selectedMonths.map((m,idx)=>{
          const v = global.per[m.key];
          return `
            <td class="num ${idx===0 ? "mStart" : ""}">${fmt(v.real)}</td>
            <td class="num subSep">${fmt(v.budget)}</td>
            <td class="num subSep ${ecartClass(v.ecart)}">${fmt(v.ecart)}</td>
          `;
        }).join("")}
        <td class="num mStart">${fmt(global.cum.real)}</td>
        <td class="num subSep">${fmt(global.cum.budget)}</td>
        <td class="num subSep ${ecartClass(global.cum.ecart)}">${fmt(global.cum.ecart)}</td>
      </tr>
    `;

    const body = rows.map(r=>{
      return `
        <tr>
          <td class="col-client">${escapeHtml(r.name)}</td>
          <td class="col-nclient">${escapeHtml(r.nclient || "â€”")}</td>
          ${selectedMonths.map((m,idx)=>{
            const v = r.per[m.key];
            return `
              <td class="num ${idx===0 ? "mStart" : ""}">${fmt(v.real)}</td>
              <td class="num subSep">${fmt(v.budget)}</td>
              <td class="num subSep ${ecartClass(v.ecart)}">${fmt(v.ecart)}</td>
            `;
          }).join("")}
          <td class="num mStart">${fmt(r.cum.real)}</td>
          <td class="num subSep">${fmt(r.cum.budget)}</td>
          <td class="num subSep ${ecartClass(r.cum.ecart)}">${fmt(r.cum.ecart)}</td>
        </tr>
      `;
    }).join("");

    el.resultTable.innerHTML = thead + `<tbody>${rowGlobal}${body}</tbody>`;
    lastExportRows = buildExportRows(selectedMonths, rows, global);
  }

  function buildExportRows(selectedMonths, rows, global){
    const out = [];
    const cr = { CLIENT:"Cumul", "N CLIENT":"" };
    for (const m of selectedMonths){
      const v = global.per[m.key];
      cr[`${m.label} RÃ©el`] = v.real;
      cr[`${m.label} Budget`] = v.budget;
      cr[`${m.label} Ã‰cart`] = v.ecart;
    }
    cr["Cumul RÃ©el"] = global.cum.real;
    cr["Cumul Budget"] = global.cum.budget;
    cr["Cumul Ã‰cart"] = global.cum.ecart;
    out.push(cr);

    for (const r of rows){
      const rr = { CLIENT:r.name, "N CLIENT":r.nclient };
      for (const m of selectedMonths){
        const v = r.per[m.key];
        rr[`${m.label} RÃ©el`] = v.real;
        rr[`${m.label} Budget`] = v.budget;
        rr[`${m.label} Ã‰cart`] = v.ecart;
      }
      rr["Cumul RÃ©el"] = r.cum.real;
      rr["Cumul Budget"] = r.cum.budget;
      rr["Cumul Ã‰cart"] = r.cum.ecart;
      out.push(rr);
    }
    return out;
  }

  // ---------------------------
  // FILTER UI
  // ---------------------------
  function buildFiltersUI(){
    el.filtersGrid.innerHTML = dimensions.map(d => `
      <div class="fcol" data-dim="${escapeAttr(d.key)}">
        <div class="fhead">
          <div class="ftitle">${escapeHtml(d.label)}</div>
          <div class="pill" id="count_${escapeAttr(d.key)}">â€”</div>
          <div class="btnStack">
            <button class="btnSm" data-act="all" data-dim="${escapeAttr(d.key)}">Tout</button>
            <button class="btnSm" data-act="none" data-dim="${escapeAttr(d.key)}">Aucun</button>
          </div>
        </div>

        <input class="search" placeholder="Rechercherâ€¦" data-search="${escapeAttr(d.key)}" />

        <div class="list" id="list_${escapeAttr(d.key)}"></div>

        <div class="ffoot">
          <div>Sel : <span id="sel_${escapeAttr(d.key)}">â€”</span></div>
          <div>Total : <span id="tot_${escapeAttr(d.key)}">â€”</span></div>
        </div>
      </div>
    `).join("");

    el.filtersGrid.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const dim = btn.getAttribute("data-dim");
        const act = btn.getAttribute("data-act");
        if (!dim) return;
        const allVals = values[dim] || [];
        filters[dim] = (act === "all") ? new Set(allVals) : new Set();
        renderList(dim);
      });
    });

    el.filtersGrid.querySelectorAll("input[data-search]").forEach(inp=>{
      inp.addEventListener("input", ()=>{
        const dim = inp.getAttribute("data-search");
        searches[dim] = (inp.value || "").trim().toLowerCase();
        renderList(dim);
      });
    });
  }

  function renderAllLists(){
    for (const d of dimensions) renderList(d.key);
  }

  function renderList(dim){
    const list = document.getElementById(`list_${dim}`);
    const totEl = document.getElementById(`tot_${dim}`);
    const selEl = document.getElementById(`sel_${dim}`);
    const countEl = document.getElementById(`count_${dim}`);
    if (!list) return;

    const allVals = values[dim] || [];
    const q = (searches[dim] || "");
    const shown = q ? allVals.filter(v=>String(v).toLowerCase().includes(q)) : allVals;
    const sel = filters[dim] || new Set();

    countEl.textContent = String(shown.length);
    totEl.textContent = String(allVals.length);
    selEl.textContent = String(sel.size);

    list.innerHTML = shown.map(v=>{
      const on = sel.has(v);
      return `
        <div class="item ${on ? "on" : ""}" data-dim="${escapeAttr(dim)}" data-val="${escapeAttr(v)}">
          <div class="l">${escapeHtml(v)}</div>
          <div class="r">${on ? "âœ“" : ""}</div>
        </div>
      `;
    }).join("");

    list.querySelectorAll(".item[data-dim][data-val]").forEach(it=>{
      it.addEventListener("click", ()=>{
        const d = it.getAttribute("data-dim");
        const v = it.getAttribute("data-val");
        if (!d) return;
        if (!filters[d]) filters[d] = new Set();
        if (filters[d].has(v)) filters[d].delete(v);
        else filters[d].add(v);
        renderList(d);
      });
    });
  }

  // ---------------------------
  // EXPORT
  // ---------------------------
  function exportCSV(){
    if (!lastExportRows.length){ alert("Rien Ã  exporter."); return; }
    const headers = Object.keys(lastExportRows[0]);
    const lines = [headers.join(";")];

    for (const r of lastExportRows){
      const row = headers.map(h=>{
        const v = r[h];
        if (typeof v === "number") return String(v);
        return String(v ?? "").replace(/;/g, ",");
      }).join(";");
      lines.push(row);
    }

    downloadBlob(new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"}), `requete_psa_${stamp()}.csv`);
  }

  // ---------------------------
  // REAL READER: override > activite
  // ---------------------------
  function getRealForClientMonth(bc, mk){
    const ov = override?.[bc.id]?.[mk];
    if (ov !== undefined && ov !== null) return toInt(ov);
    const exactKey = makeClientMatchKey(bc.name, bc.nclient);
    const src =
      (exactKey && actByExact.get(exactKey)) ||
      getUniqueLookupCandidate(actByNClient, compactClientCode(bc.nclient)) ||
      getUniqueLookupCandidate(actByName, compactClientName(bc.name));
    return toInt(src?.months?.[mk]);
  }

  // ---------------------------
  // STATUS / KPIs / HELPERS
  // ---------------------------
  function paintStatus(){
    const bOk = !!(budgetData?.clients?.length);
    const rOk = !!(activite?.clients?.length);

    el.dotBudget.className = "dot " + (bOk ? "ok" : "bad");
    el.sBudget.textContent = bOk ? `${budgetData.clients.length} clients` : "introuvable";

    el.dotReel.className = "dot " + (rOk ? "ok" : "warn");
    el.sReel.textContent = rOk ? `${activite.clients.length} clients` : "non trouvÃ©";
  }

  function setKpis(clientsCount, real, budget, ecart){
    el.kClients.textContent = String(clientsCount);
    el.kReal.textContent = fmt(real);
    el.kBudget2.textContent = fmt(budget);
    el.kEcart.textContent = fmt(ecart);
  }

  function emptyTable(msg){
    return `
      <thead><tr><th class="col-client">Info</th></tr></thead>
      <tbody><tr><td class="col-client" style="color:rgba(255,255,255,0.70);font-weight:600;">${escapeHtml(msg)}</td></tr></tbody>
    `;
  }

  function ecartClass(v){
    const n = toInt(v);
    if (n > 0) return "ecart pos";
    if (n < 0) return "ecart neg";
    return "ecart zero";
  }

  function loadJSON(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    }catch{ return fallback; }
  }

  function toNumber(v){
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v).trim();
    if (!s) return 0;
    const norm = s.replace(/\s/g,"").replace(",",".");
    const n = Number(norm);
    return isFinite(n) ? n : 0;
  }
  function toInt(v){ return Math.round(toNumber(v)); }
  function fmt(v){ return nf0.format(toInt(v)); }

  function normKey(s){
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/\s+/g," ");
  }

  function compactClientCode(value){
    return normKey(value).replace(/[^a-z0-9]+/g,"").slice(0, 40);
  }

  function compactClientName(value){
    return String(value || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/g,"-")
      .replace(/(^-|-$)/g,"")
      .slice(0, 60);
  }

  function makeClientMatchKey(name, nclient){
    const nc = compactClientCode(nclient);
    const nm = compactClientName(name);
    if (nc && nm) return `client_${nc}__${nm}`;
    if (nc) return `nclient_${nc}`;
    if (nm) return `name_${nm}`;
    return "";
  }

  function addLookupCandidate(map, key, client){
    if (!key) return;
    const arr = map.get(key);
    if (arr) arr.push(client);
    else map.set(key, [client]);
  }

  function getUniqueLookupCandidate(map, key){
    if (!key) return null;
    const arr = map.get(key);
    return arr && arr.length === 1 ? arr[0] : null;
  }

  function getActiviteClientKey(client){
    const directKey = String(client?.clientKey || "").trim();
    return directKey || makeClientMatchKey(client?.name, client?.nclient);
  }

  function indexActiviteClient(client){
    const exactKey = getActiviteClientKey(client);
    if (exactKey) actByExact.set(exactKey, client);
    addLookupCandidate(actByNClient, compactClientCode(client?.nclient), client);
    addLookupCandidate(actByName, compactClientName(client?.name), client);
  }

  function stamp(){
    const d = new Date();
    const pad = (x)=>String(x).padStart(2,"0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function downloadBlob(blob, filename){
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function escapeHtml(str){
    return String(str ?? "").replace(/[&<>"']/g, s => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[s]));
  }
  function escapeAttr(str){
    return escapeHtml(str).replace(/"/g, "&quot;");
  }
})();

