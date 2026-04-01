(function () {
  const config = window.ENTITY_SPACE_CONFIG;
  if (!config) return;

  function boot() {
    injectStylesheet();
    document.title = config.title || "Espace";
    document.body.innerHTML = buildPage(config);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  function injectStylesheet() {
    if (document.querySelector('link[href="./entity-space.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./entity-space.css";
    document.head.appendChild(link);
  }

  function buildPage(data) {
    const topActions = (data.topActions || []).map(renderTopAction).join("");
    const cards = (data.cards || []).map(renderCard).join("");

    return `
      <div class="shell">
        <header class="topbar glass-card">
          <a class="brand" href="${escAttr(data.hubHref || "index.html")}">
            <span class="logo" aria-hidden="true"></span>
            <span class="brand-copy">
              <strong>${esc(data.brandTitle || "Portail Commercial KENT")}</strong>
              <span>${esc(data.brandSubtitle || "Retour au hub principal")}</span>
            </span>
          </a>

          <nav class="nav-actions">
            ${topActions}
          </nav>
        </header>

        <main class="page-hero glass-card">
          <div class="entity-copy">
            <span class="eyebrow">${esc(data.eyebrow || "")}</span>
            <h1>${esc(data.title || "")}</h1>
            <p>${esc(data.description || "")}</p>
            <div class="hero-actions">
              ${topActions}
            </div>
            <div class="support-note">${esc(data.supportNote || "")}</div>
          </div>

          <div class="entity-visual">
            <img src="${escAttr(data.image || "")}" alt="${escAttr(data.imageAlt || data.title || "")}">
          </div>
        </main>

        <section class="section">
          <div class="section-head">
            <h2>${esc(data.sectionTitle || "Outils disponibles")}</h2>
            <p>${esc(data.sectionSubtitle || "")}</p>
          </div>

          <div class="tools-grid">
            ${cards}
          </div>
        </section>
      </div>
    `;
  }

  function renderTopAction(action) {
    return `<a class="pill${action.primary ? " primary" : ""}" href="${escAttr(action.href)}">${esc(action.label)}</a>`;
  }

  function renderCard(card) {
    return `
      <article class="tool-card glass-card">
        <div class="tool-head">
          <div class="tool-icon">${getIcon(card.kind)}</div>
          <span class="tool-tag">${esc(card.tag || "")}</span>
        </div>
        <h3>${esc(card.title || "")}</h3>
        <p>${esc(card.description || "")}</p>
        <div class="tool-actions">
          <a class="card-btn${card.primary ? " primary" : ""}" href="${escAttr(card.href)}">${esc(card.buttonLabel || "Ouvrir")}</a>
        </div>
      </article>
    `;
  }

  function getIcon(kind) {
    const icons = {
      lookup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M234-276q51-39 114-61.5T480-360q69 0 132 22.5T726-276q43-54 66.5-120.5T816-540q0-146-95-241t-241-95q-146 0-241 95t-95 241q0 77 23.5 143.5T234-276Zm246-204q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-80q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0 480q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg>',
      product: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M784-120 532-372q-30 22-69 35t-83 13q-109 0-184.5-75.5T120-584q0-109 75.5-184.5T380-844q109 0 184.5 75.5T640-584q0 44-13 83t-35 69l252 252-60 60ZM380-408q74 0 125-51t51-125q0-74-51-125t-125-51q-74 0-125 51t-51 125q0 74 51 125t125 51Z"/></svg>',
      default: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M160-120v-720h640v720H160Zm80-80h480v-560H240v560Zm80-80h320v-80H320v80Zm0-160h320v-80H320v80Zm0-160h320v-80H320v80Z"/></svg>'
    };
    return icons[kind] || icons.default;
  }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (s) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s];
    });
  }

  function escAttr(str) {
    return esc(str).replace(/"/g, "&quot;");
  }
})();
