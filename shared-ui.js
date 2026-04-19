(function () {
  var THEME_KEY = "APP_THEME";
  var YEAR_KEY = "APP_ACTIVE_YEAR";
  var root = document.documentElement;

  if (
    typeof document !== "undefined" &&
    document.readyState === "loading" &&
    typeof window !== "undefined" &&
    !window.KentDataConfig
  ) {
    document.write('<script src="./app-data-config.js"><\/script>');
  }

  function resolveTheme(value) {
    return value === "light" ? "light" : "dark";
  }

  function applyTheme(value) {
    root.setAttribute("data-theme", resolveTheme(value));
  }

  function ensureFavicon() {
    if (document.querySelector('link[rel*="icon"]')) return;
    var link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = "./kent-logo.svg";
    link.setAttribute("data-shared-favicon", "true");
    document.head.appendChild(link);
  }

  function ensureSharedControlStyles() {
    if (document.getElementById("kent-shared-control-styles")) return;
    var style = document.createElement("style");
    style.id = "kent-shared-control-styles";
    style.textContent = [
      'select option {',
      '  background: #0f172a !important;',
      '  color: rgba(255,255,255,0.96) !important;',
      '}',
      'html[data-theme="light"] select option {',
      '  background: #ffffff !important;',
      '  color: #0f172a !important;',
      '}',
      'select.kent-year-select,',
      'select#yearSelect {',
      '  appearance: none !important;',
      '  -webkit-appearance: none !important;',
      '  min-width: 132px;',
      '  height: 44px;',
      '  padding: 0 48px 0 16px !important;',
      '  border-radius: 16px !important;',
      '  border: 1px solid rgba(255,255,255,0.14) !important;',
      '  background:',
      '    linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05)) !important;',
      '  color: rgba(255,255,255,0.94) !important;',
      '  font-weight: 800 !important;',
      '  font-size: 14px !important;',
      '  letter-spacing: 0.01em;',
      '  cursor: pointer;',
      '  box-shadow: 0 16px 36px rgba(0,0,0,0.24);',
      '  background-image:',
      '    linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05)),',
      '    linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02)),',
      '    linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.82) 50%),',
      '    linear-gradient(135deg, rgba(255,255,255,0.82) 50%, transparent 50%);',
      '  background-position:',
      '    0 0,',
      '    calc(100% - 4px) 50%,',
      '    calc(100% - 20px) calc(50% - 2px),',
      '    calc(100% - 14px) calc(50% - 2px);',
      '  background-size: 100% 100%, 34px 34px, 7px 7px, 7px 7px;',
      '  background-repeat: no-repeat;',
      '}',
      'select.kent-year-select:hover,',
      'select#yearSelect:hover {',
      '  border-color: rgba(124,58,237,0.40) !important;',
      '  box-shadow: 0 18px 40px rgba(0,0,0,0.26);',
      '  transform: translateY(-1px);',
      '}',
      'select.kent-year-select:focus,',
      'select#yearSelect:focus {',
      '  outline: none !important;',
      '  border-color: rgba(124,58,237,0.60) !important;',
      '  box-shadow: 0 0 0 4px rgba(124,58,237,0.16), 0 20px 40px rgba(0,0,0,0.26) !important;',
      '}',
      'html[data-theme="light"] select.kent-year-select,',
      'html[data-theme="light"] select#yearSelect {',
      '  border-color: rgba(15,23,42,0.12) !important;',
      '  background:',
        '    linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.96)) !important;',
      '  color: #0f172a !important;',
      '  box-shadow: 0 16px 34px rgba(15,23,42,0.10) !important;',
      '  background-image:',
      '    linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.96)),',
      '    linear-gradient(180deg, rgba(226,232,240,0.96), rgba(226,232,240,0.72)),',
      '    linear-gradient(45deg, transparent 50%, rgba(15,23,42,0.68) 50%),',
      '    linear-gradient(135deg, rgba(15,23,42,0.68) 50%, transparent 50%);',
      '}'
    ].join("\n");
    document.head.appendChild(style);
  }

  function enhanceYearSelects() {
    if (typeof document === "undefined") return;
    document.querySelectorAll('select#yearSelect').forEach(function(select) {
      select.classList.add("kent-year-select");
    });
  }

  try {
    applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  } catch (err) {
    applyTheme("dark");
  }

  ensureFavicon();
  ensureSharedControlStyles();

  window.getAppTheme = function () {
    return resolveTheme(root.getAttribute("data-theme"));
  };

  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    var nativeFetch = window.fetch.bind(window);

    function resolveMappedDataUrl(input) {
      if (!window.KentDataConfig || typeof input !== "string") return null;
      if (/^https?:\/\//i.test(input) && !input.startsWith(window.location.origin)) return null;

      try {
        var url = new URL(input, window.location.href);
        var pathname = url.pathname || "";
        var currentName = pathname.split("/").pop();
        if (!currentName || /-\d{4}\.xlsx$/i.test(currentName)) return null;

        var year = window.KentDataConfig.getActiveYear();
        var previousYear = window.KentDataConfig.getPreviousYear(year);
        var mappedName = null;

        switch (currentName) {
          case "budgetpsa.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("psa", "budget", year);
            break;
          case "budgetgueudet.xlsx":
          case "budgetgueudet .xlsx":
            mappedName = window.KentDataConfig.getEntityFile("gueudet", "budget", year);
            break;
          case "budgetford.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("ford", "budget", year);
            break;
          case "budgetdirect.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("direct", "budget", year);
            break;
          case "activitereelpsa.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("psa", "real", year);
            break;
          case "activitereelpsan-1.xlsx":
            mappedName = "activitereelpsa-" + previousYear + ".xlsx";
            break;
          case "activitereelgueudet.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("gueudet", "real", year);
            break;
          case "activitereelford.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("ford", "real", year);
            break;
          case "activitereeldirect.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("direct", "real", year);
            break;
          case "psadata.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("psa", "client", year);
            break;
          case "gueudetdata.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("gueudet", "client", year);
            break;
          case "BUDGET2026_PSA.xlsx":
            mappedName = window.KentDataConfig.getEntityFile("psa", "projection", year);
            break;
          default:
            mappedName = null;
        }

        if (!mappedName || mappedName === currentName) return null;

        url.pathname = pathname.slice(0, pathname.length - currentName.length) + mappedName;
        return url.toString();
      } catch (err) {
        return null;
      }
    }

    window.fetch = function(input, init) {
      if (typeof input !== "string") {
        return nativeFetch(input, init);
      }

      var mappedUrl = resolveMappedDataUrl(input);
      if (!mappedUrl) {
        return nativeFetch(input, init);
      }

      return nativeFetch(mappedUrl, init).then(function(response) {
        if (response && response.ok) return response;
        return nativeFetch(input, init);
      });
    };
  }

  window.addEventListener("storage", function (event) {
    if (event.key === THEME_KEY) {
      applyTheme(event.newValue || "dark");
      document.dispatchEvent(
        new CustomEvent("app-theme-change", {
          detail: { theme: window.getAppTheme() }
        })
      );
      return;
    }

    if (event.key === YEAR_KEY) {
      var nextYear = Number(event.newValue);
      if (!Number.isFinite(nextYear)) return;
      document.dispatchEvent(
        new CustomEvent("app-year-change", {
          detail: { year: nextYear }
        })
      );
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    enhanceYearSelects();
    document.dispatchEvent(
      new CustomEvent("app-theme-ready", {
        detail: { theme: window.getAppTheme() }
      })
    );
  });
})();
