(function () {
  var THEME_KEY = "APP_THEME";
  var root = document.documentElement;

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

  window.addEventListener("storage", function (event) {
    if (event.key !== THEME_KEY) return;
    applyTheme(event.newValue || "dark");
    document.dispatchEvent(
      new CustomEvent("app-theme-change", {
        detail: { theme: window.getAppTheme() }
      })
    );
  });

  document.addEventListener("DOMContentLoaded", function () {
    document.dispatchEvent(
      new CustomEvent("app-theme-ready", {
        detail: { theme: window.getAppTheme() }
      })
    );
  });
})();
