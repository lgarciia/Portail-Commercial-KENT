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

  try {
    applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  } catch (err) {
    applyTheme("dark");
  }

  ensureFavicon();

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
    document.dispatchEvent(
      new CustomEvent("app-theme-ready", {
        detail: { theme: window.getAppTheme() }
      })
    );
  });
})();
