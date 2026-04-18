(function(){
  const YEAR_KEY = "APP_ACTIVE_YEAR";
  const YEAR_MIN = 2024;
  const YEAR_MAX = 2035;
  const DEFAULT_YEAR = 2026;

  const ENTITY_CONFIG = {
    psa: {
      label: "PSA",
      budgetBase: "budgetpsa",
      realBase: "activitereelpsa",
      clientBase: "psadata",
      cumulBase: "psacumul",
      projectionBase: "projectionpsa",
      legacyFiles: {
        budget: { 2026: ["budgetpsa.xlsx"] },
        real: {
          2025: ["activitereelpsan-1.xlsx"],
          2026: ["activitereelpsa.xlsx"]
        },
        client: { 2026: ["psadata.xlsx"] },
        projection: { 2026: ["BUDGET2026_PSA.xlsx"] },
        queryCurrent: { 2026: ["activitereelpsa.xlsx"] },
        historical: { 2026: ["data.xlsx"] }
      },
      legacyStorage: {
        activityPivot: { 2026: "ACTIVITE_REEL_2026_V1" },
        activityReport: { 2026: "ACTIVITEREEL_PSA_V1" },
        budgetData: { 2026: "BUDGET2026_DATA_PSA_V1" },
        budgetMeta: { 2026: "BUDGET2026_META_PSA_V1" },
        budgetReal: { 2026: "BUDGET2026_REAL_PSA_V1" }
      }
    },
    gueudet: {
      label: "Gueudet",
      budgetBase: "budgetgueudet",
      realBase: "activitereelgueudet",
      clientBase: "gueudetdata",
      cumulBase: "gueudetcumul",
      legacyFiles: {
        budget: { 2026: ["budgetgueudet.xlsx"] },
        real: { 2026: ["activitereelgueudet.xlsx"] },
        client: { 2026: ["gueudetdata.xlsx"] },
        queryCurrent: { 2026: ["activitereelgueudet.xlsx"] }
      },
      legacyStorage: {
        activityPivot: { 2026: "ACTIVITE_REEL_GUEUDET_2026_V1" },
        activityReport: { 2026: "ACTIVITEREEL_GUEUDET_V1" },
        budgetData: { 2026: "BUDGET2026_DATA_GUEUDET_V1" },
        budgetMeta: { 2026: "BUDGET2026_META_GUEUDET_V1" },
        budgetReal: { 2026: "BUDGET2026_REAL_GUEUDET_V1" }
      }
    },
    ford: {
      label: "Ford",
      budgetBase: "budgetford",
      realBase: "activitereelford",
      cumulBase: "fordcumul",
      legacyFiles: {
        budget: { 2026: ["budgetford.xlsx"] },
        real: { 2026: ["activitereelford.xlsx"] },
        queryCurrent: { 2026: ["activitereelford.xlsx"] }
      },
      legacyStorage: {
        activityPivot: { 2026: "ACTIVITE_REEL_FORD_2026_V1" },
        activityReport: { 2026: "ACTIVITEREEL_FORD_V1" },
        budgetData: { 2026: "BUDGET_FORD_DATA_V1" },
        budgetMeta: { 2026: "BUDGET_FORD_META_V1" },
        budgetReal: { 2026: "BUDGET_FORD_REAL_V1" }
      }
    },
    direct: {
      label: "Direct",
      budgetBase: "budgetdirect",
      realBase: "activitereeldirect",
      cumulBase: "directcumul",
      legacyFiles: {
        budget: { 2026: ["budgetdirect.xlsx"] },
        real: { 2026: ["activitereeldirect.xlsx"] },
        queryCurrent: { 2026: ["activitereeldirect.xlsx"] }
      },
      legacyStorage: {
        activityPivot: { 2026: "ACTIVITE_REEL_DIRECT_2026_V1" },
        activityReport: { 2026: "ACTIVITEREEL_DIRECT_V1" },
        budgetData: { 2026: "BUDGET_DIRECT_DATA_V1" },
        budgetMeta: { 2026: "BUDGET_DIRECT_META_V1" },
        budgetReal: { 2026: "BUDGET_DIRECT_REAL_V1" }
      }
    }
  };

  function clampYear(value){
    const year = Number(value);
    if (!Number.isFinite(year)) return DEFAULT_YEAR;
    return Math.min(YEAR_MAX, Math.max(YEAR_MIN, Math.round(year)));
  }

  function getCalendarYear(){
    try{
      const now = new Date();
      const year = now.getFullYear();
      return Number.isFinite(year) ? year : DEFAULT_YEAR;
    }catch{
      return DEFAULT_YEAR;
    }
  }

  function getDefaultYear(){
    return clampYear(getCalendarYear());
  }

  function getSearchParamYear(search){
    try{
      const params = new URLSearchParams(typeof search === "string" ? search : location.search);
      const raw = params.get("year");
      if (!raw) return null;
      const year = Number(raw);
      return Number.isFinite(year) ? clampYear(year) : null;
    }catch{
      return null;
    }
  }

  function getStoredYear(){
    try{
      const raw = localStorage.getItem(YEAR_KEY);
      if (!raw) return null;
      const year = Number(raw);
      return Number.isFinite(year) ? clampYear(year) : null;
    }catch{
      return null;
    }
  }

  function setStoredYear(year){
    const next = clampYear(year);
    try{
      localStorage.setItem(YEAR_KEY, String(next));
    }catch{}
    document.dispatchEvent(
      new CustomEvent("app-year-change", {
        detail: { year: next }
      })
    );
    return next;
  }

  function getActiveYear(options){
    const opts = options || {};
    const fromUrl = opts.allowUrl === false ? null : getSearchParamYear(opts.search);
    if (fromUrl) return fromUrl;

    const fromStorage = getStoredYear();
    if (fromStorage) return fromStorage;

    if (opts.fallbackYear) return clampYear(opts.fallbackYear);
    return getDefaultYear();
  }

  function normalizeEntity(entity){
    return String(entity || "").trim().toLowerCase();
  }

  function entityConfig(entity){
    return ENTITY_CONFIG[normalizeEntity(entity)] || null;
  }

  function buildYearFile(baseName, year){
    return `${baseName}-${clampYear(year)}.xlsx`;
  }

  function getLegacyFiles(entity, kind, year){
    const config = entityConfig(entity);
    if (!config) return [];
    const group = config.legacyFiles && config.legacyFiles[kind];
    if (!group) return [];
    return Array.isArray(group[year]) ? group[year].slice() : [];
  }

  function unique(values){
    return Array.from(new Set(values.filter(Boolean)));
  }

  function getEntityFile(entity, kind, year){
    const config = entityConfig(entity);
    const y = clampYear(year);
    if (!config) return "";

    if (kind === "budget") return buildYearFile(config.budgetBase, y);
    if (kind === "real") return buildYearFile(config.realBase, y);
    if (kind === "realN1") return buildYearFile(config.realBase, y - 1);
    if (kind === "client" && config.clientBase) return buildYearFile(config.clientBase, y);
    if (kind === "cumul" && config.cumulBase) return `${config.cumulBase}.xlsx`;
    if (kind === "projection" && config.projectionBase) return buildYearFile(config.projectionBase, y);
    if (kind === "queryCurrent") return getEntityFile(entity, "real", y);
    if (kind === "historical") return `historique-${normalizeEntity(entity)}-${y}.xlsx`;
    return "";
  }

  function getEntityFileCandidates(entity, kind, year){
    const y = clampYear(year);
    const primary = getEntityFile(entity, kind, y);
    let legacy = getLegacyFiles(entity, kind, y);
    if (kind === "realN1"){
      legacy = legacy.concat(getLegacyFiles(entity, "real", y - 1));
    }
    return unique([primary].concat(legacy));
  }

  function buildStorageKey(section, entity, year){
    return [
      "KENT",
      String(section || "").trim().toUpperCase(),
      normalizeEntity(entity).toUpperCase(),
      String(clampYear(year)),
      "V1"
    ].join("_");
  }

  function getLegacyStorageKey(entity, kind, year){
    const config = entityConfig(entity);
    const group = config && config.legacyStorage && config.legacyStorage[kind];
    if (!group) return null;
    return group[clampYear(year)] || null;
  }

  function getStorageKeys(entity, year){
    const y = clampYear(year);
    return {
      activityPivot: {
        primary: buildStorageKey("ACTIVITE_REEL", entity, y),
        legacy: unique([getLegacyStorageKey(entity, "activityPivot", y)])
      },
      activityReport: {
        primary: buildStorageKey("ACTIVITEREEL", entity, y),
        legacy: unique([getLegacyStorageKey(entity, "activityReport", y)])
      },
      budgetData: {
        primary: buildStorageKey("BUDGET_DATA", entity, y),
        legacy: unique([getLegacyStorageKey(entity, "budgetData", y)])
      },
      budgetMeta: {
        primary: buildStorageKey("BUDGET_META", entity, y),
        legacy: unique([getLegacyStorageKey(entity, "budgetMeta", y)])
      },
      budgetReal: {
        primary: buildStorageKey("BUDGET_REAL", entity, y),
        legacy: unique([getLegacyStorageKey(entity, "budgetReal", y)])
      }
    };
  }

  function buildYearHref(href, year){
    if (!href || /^https?:\/\//i.test(href) || href.startsWith("#")) return href;
    try{
      const url = new URL(href, location.href);
      url.searchParams.set("year", String(clampYear(year)));
      return url.pathname.replace(/^\//, "") + url.search + url.hash;
    }catch{
      return href;
    }
  }

  function applyYearToLinks(root, year){
    const scope = root || document;
    const nextYear = clampYear(year);
    scope.querySelectorAll("[data-year-link]").forEach(function(anchor){
      const baseHref = anchor.getAttribute("data-base-href") || anchor.getAttribute("href") || "";
      anchor.setAttribute("data-base-href", baseHref);
      anchor.setAttribute("href", buildYearHref(baseHref, nextYear));
    });
  }

  function fillYearSelect(select, options){
    if (!select) return;
    const opts = options || {};
    const currentYear = clampYear(getCalendarYear());
    const selected = clampYear(opts.selectedYear || getActiveYear());
    const min = clampYear(opts.min || YEAR_MIN);
    const max = clampYear(opts.max || (currentYear + 1));
    const years = [];
    if (selected < min){
      years.push(`<option value="${selected}">${selected}</option>`);
    }
    for (let year = min; year <= max; year += 1){
      years.push(`<option value="${year}">${year}</option>`);
    }
    if (selected > max){
      years.push(`<option value="${selected}">${selected}</option>`);
    }
    select.innerHTML = years.join("");
    select.value = String(selected);
  }

  window.KentDataConfig = {
    YEAR_KEY,
    YEAR_MIN,
    YEAR_MAX,
    DEFAULT_YEAR,
    entities: ENTITY_CONFIG,
    clampYear,
    getDefaultYear,
    getActiveYear,
    setActiveYear: setStoredYear,
    getPreviousYear: function(year){ return clampYear(year) - 1; },
    getEntityConfig: entityConfig,
    getEntityFile,
    getEntityFileCandidates,
    getStorageKeys,
    buildYearHref,
    applyYearToLinks,
    fillYearSelect
  };
})();
