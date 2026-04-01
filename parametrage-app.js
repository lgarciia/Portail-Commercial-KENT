(function () {
  const root = document.querySelector(".wrap");
  if (!root) return;

  window.__PARAM_GUIDE_BOOTED__ = true;

  root.innerHTML = `
    <div class="navbar">
      <div class="brand">
        <div class="logo"></div>
        <div class="title">
          <b>Paramétrage - Cartographie du portail</b>
          <span>Sources de données, logique des pages, Git, thème global et favicon</span>
        </div>
      </div>
      <div class="navRight">
        <button class="btn ghost" id="btnOpenAll">Tout ouvrir</button>
        <button class="btn ghost" id="btnCloseAll">Tout fermer</button>
        <button class="btn primary" id="btnCopyAll">Copier le résumé</button>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <p class="sectionTitle">Recherche rapide</p>
        <input id="q" type="text" placeholder="Chercher : budgetpsa, Supabase, APP_THEME, requetepsa, vue_semaine..." />
        <div class="meta" id="searchMeta">
          <span class="chip"><span class="dot ok"></span><span>La recherche filtre les fichiers, les pages et les recettes Git.</span></span>
        </div>
      </div>

      <div class="card">
        <p class="sectionTitle">Notes perso</p>
        <textarea id="notes" placeholder="Tes remarques, rappels, checklists..."></textarea>
        <div class="rowBtns">
          <button class="pill" id="btnSaveNotes">Enregistrer</button>
          <button class="pill" id="btnClearNotes">Vider</button>
        </div>
        <div class="meta">
          <span class="chip"><span class="dot"></span><span>Clé locale : <code>APP_PARAM_GUIDE_NOTES</code></span></span>
        </div>
      </div>
    </div>

    <div class="card">
      <p class="sectionTitle">Règles d'or</p>
      <div class="kvs">
        <div class="k">Source partagée</div>
        <div class="v">Pour qu'un autre utilisateur voie la modification sur Vercel, il faut soit pousser un <code>fichier du repo</code>, soit modifier la <code>base Supabase</code>. Une valeur gardée seulement en <code>localStorage</code> reste locale à ton navigateur.</div>
        <div class="k">Thème global</div>
        <div class="v"><code>index.html</code> pilote <code>APP_THEME</code>. Toutes les pages écoutent cette clé via <code>shared-ui.js</code>. Les pages qui n'avaient pas de mode clair s'appuient sur <code>shared-theme.css</code>.</div>
        <div class="k">Favicon</div>
        <div class="v">Le favicon commun pointe sur <code>kent-logo.svg</code>. Pour changer l'icône partout, remplace ce fichier.</div>
        <div class="k">Chemin des XLSX</div>
        <div class="v">Les classeurs utiles sont aujourd'hui à la racine du projet. Quelques pages savent aussi tester <code>./data/</code>, mais la configuration active lit les fichiers à côté des pages HTML.</div>
        <div class="k">Limite GitHub</div>
        <div class="v">GitHub bloque les fichiers supérieurs à <code>100 MB</code>. Si un classeur grossit trop, il faut le réduire ou le découper.</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <p class="sectionTitle">Quel fichier modifier ?</p>
        <div class="list" id="dataList"></div>
      </div>
      <div class="card">
        <p class="sectionTitle">Commandes Git prêtes à copier</p>
        <div class="list" id="gitList"></div>
      </div>
    </div>

    <div class="card">
      <p class="sectionTitle">Comment fonctionnent les pages</p>
      <div class="list" id="pageList"></div>
    </div>

    <div class="card">
      <p class="sectionTitle">Pages en attente / de transition</p>
      <div class="list" id="pendingList"></div>
    </div>
  `;

  const DATA_SOURCES = [
    {
      id: "psa-base",
      title: "Base clients PSA",
      subtitle: "Recherche client et exploration produit PSA",
      kind: "XLSX partagé",
      source: ["psadata.xlsx"],
      pages: ["client-psa.html", "explorer-psa.html"],
      change: "Si tu modifies la base clients PSA, les références ou les lignes produits, c'est ce fichier qu'il faut remplacer puis pousser.",
      notes: "Explorer PSA garde aussi un cache local navigateur, mais la source de vérité reste psadata.xlsx."
    },
    {
      id: "gueudet-base",
      title: "Base clients Gueudet",
      subtitle: "Recherche client et exploration produit Gueudet",
      kind: "XLSX partagé",
      source: ["gueudetdata.xlsx"],
      pages: ["client-gueudet.html", "explorer-gueudet.html"],
      change: "Pour tout changement de base client Gueudet, modifie gueudetdata.xlsx puis push.",
      notes: "Même logique que PSA."
    },
    {
      id: "requete-historique-psa",
      title: "Requête PSA historique",
      subtitle: "Page TCD année antérieure PSA",
      kind: "XLSX partagé",
      source: ["data.xlsx"],
      pages: ["requetepsa.html"],
      change: "Si la requête PSA historique ne remonte pas la bonne donnée, c'est data.xlsx qu'il faut mettre à jour.",
      notes: "Ne pas confondre avec psadata.xlsx qui sert à la recherche client."
    },
    {
      id: "real-psa",
      title: "Activité réelle PSA",
      subtitle: "Réel PSA utilisé dans les analyses et reportings PSA",
      kind: "XLSX partagé",
      source: ["activitereelpsa.xlsx"],
      pages: ["activitereelpsa.html", "reporting-annuelpsa.html", "evol-analyse-psa.html", "requetepsa-2026.html", "evol-cumule.html", "projectionpsa2026.html"],
      change: "Si le réel PSA est faux, remplace activitereelpsa.xlsx puis push.",
      notes: "activitereelpsa.html génère aussi un bridge localStorage vers certains écrans PSA."
    },
    {
      id: "real-gueudet",
      title: "Activité réelle Gueudet",
      subtitle: "Réel Gueudet",
      kind: "XLSX partagé",
      source: ["activitereelgueudet.xlsx"],
      pages: ["activitereelgueudet.html", "reporting-annuelgueudet.html", "evol-analyse-gueudet.html", "evol-reporting-gueudet.html", "requetegueudet-2026.html", "evol-cumule.html"],
      change: "Pour corriger le réel Gueudet, modifie activitereelgueudet.xlsx puis push.",
      notes: "Le pivot Gueudet crée aussi un cache local pour certains écrans."
    },
    {
      id: "real-ford",
      title: "Activité réelle Ford",
      subtitle: "Réel Ford",
      kind: "XLSX partagé",
      source: ["activitereelford.xlsx"],
      pages: ["activitereelford.html", "reporting-annuelford.html", "evol-analyse-ford.html", "evol-cumule.html"],
      change: "Pour corriger Ford, modifie activitereelford.xlsx puis push.",
      notes: "Les pages Ford utilisent Date commande / CA Total côté réel."
    },
    {
      id: "real-direct",
      title: "Activité réelle Direct",
      subtitle: "Réel Direct",
      kind: "XLSX partagé",
      source: ["activitereeldirect.xlsx"],
      pages: ["activitereeldirect.html", "reporting-annueldirect.html", "evol-analyse-direct.html", "evol-cumule.html"],
      change: "Pour corriger Direct, modifie activitereeldirect.xlsx puis push.",
      notes: "Comme Ford, la lecture passe par Date commande / CA Total."
    },
    {
      id: "real-psa-n1",
      title: "Historique PSA N-1",
      subtitle: "Comparaison PSA historique / projection",
      kind: "XLSX partagé",
      source: ["activitereelpsan-1.xlsx"],
      pages: ["activite-reelle-n-1.html", "reel-n1-psa.html", "projectionpsa2026.html"],
      change: "Si la comparaison N-1 PSA est fausse, modifie activitereelpsan-1.xlsx.",
      notes: "Ce fichier sert uniquement à la logique PSA N-1 / projection."
    },
    {
      id: "budget-psa",
      title: "Budget PSA",
      subtitle: "Budget PSA principal",
      kind: "XLSX partagé",
      source: ["budgetpsa.xlsx"],
      pages: ["reporting-annuelpsa.html", "evol-analyse-psa.html", "histo-budget-psa.html", "evol-cumule.html"],
      change: "Si tu modifies le budget PSA que les utilisateurs doivent voir, remplace budgetpsa.xlsx puis push.",
      notes: "reporting-annuelpsa.html recharge maintenant automatiquement ce fichier."
    },
    {
      id: "budget-gueudet",
      title: "Budget Gueudet",
      subtitle: "Budget Gueudet principal",
      kind: "XLSX partagé",
      source: ["budgetgueudet.xlsx"],
      pages: ["reporting-annuelgueudet.html", "evol-analyse-gueudet.html", "evol-reporting-gueudet.html", "histo-budget-gueudet.html", "evol-cumule.html"],
      change: "Si le budget Gueudet doit changer pour tout le monde, modifie budgetgueudet.xlsx puis push.",
      notes: "Le fichier canonique est budgetgueudet.xlsx. Le fichier budgetgueudet .xlsx avec un espace n'est pas utilisé."
    },
    {
      id: "budget-ford",
      title: "Budget Ford",
      subtitle: "Budget Ford principal",
      kind: "XLSX partagé",
      source: ["budgetford.xlsx"],
      pages: ["reporting-annuelford.html", "evol-analyse-ford.html", "histo-budget-ford.html", "evol-cumule.html"],
      change: "Pour mettre à jour le budget Ford partagé, modifie budgetford.xlsx puis push.",
      notes: "reporting-annuelford.html le charge automatiquement."
    },
    {
      id: "budget-direct",
      title: "Budget Direct",
      subtitle: "Budget Direct principal",
      kind: "XLSX partagé",
      source: ["budgetdirect.xlsx"],
      pages: ["reporting-annueldirect.html", "evol-analyse-direct.html", "histo-budget-direct.html", "evol-cumule.html"],
      change: "Pour mettre à jour le budget Direct partagé, modifie budgetdirect.xlsx puis push.",
      notes: "reporting-annueldirect.html le charge automatiquement."
    },
    {
      id: "projection-psa-2026",
      title: "Projection PSA 2026",
      subtitle: "Classeur de projection dédié PSA",
      kind: "XLSX partagé",
      source: ["BUDGET2026_PSA.xlsx"],
      pages: ["projectionpsa2026.html"],
      change: "Si tu veux faire évoluer la projection PSA 2026 servie par le fichier, modifie BUDGET2026_PSA.xlsx puis push.",
      notes: "Cette page croise aussi activitereelpsa.xlsx et activitereelpsan-1.xlsx."
    },
    {
      id: "budget-local",
      title: "Budget 2026 saisi dans le navigateur",
      subtitle: "Editeur local de budget / projection",
      kind: "localStorage seulement",
      source: ["budget2026_v4_projection_import"],
      pages: ["budget2026.html"],
      change: "Quand tu modifies cette page, la donnée reste uniquement dans ton navigateur tant que tu n'exportes pas et que tu ne remplaces pas un vrai fichier du repo.",
      notes: "budget2026.html n'alimente pas directement Vercel. C'est un outil local d'édition/export."
    },
    {
      id: "supabase",
      title: "Suite terrain / CRM",
      subtitle: "Les pages commerciales lisent Supabase et non des XLSX",
      kind: "Base Supabase",
      source: ["clients", "visites", "visite_commandes", "produits", "tarifs_plaques", "plaques"],
      pages: ["ficherclt.html", "tdbactivite.html", "gestionimportclients.html", "gestiontarif.html", "rappelclt.html", "rapportjournalier.html"],
      change: "Pour changer ces données, il faut passer par l'application, les imports dédiés ou directement par Supabase. Un push Git ne change pas les lignes en base.",
      notes: "gestiontarif.html utilise aussi modele_import_tarifs.xlsx comme modèle d'import, mais ce fichier n'est pas la donnée live."
    },
    {
      id: "ui-shared",
      title: "Thème global et favicon",
      subtitle: "Harmonisation visuelle commune",
      kind: "Fichiers UI",
      source: ["shared-ui.js", "shared-theme.css", "kent-logo.svg", "index.html"],
      pages: ["Toutes les pages HTML"],
      change: "Pour changer le comportement dark/light partout, modifie shared-ui.js et shared-theme.css. Pour changer l'icône, remplace kent-logo.svg. Pour la logique de choix du thème, regarde aussi index.html.",
      notes: "La clé locale commune est APP_THEME."
    },
    {
      id: "unused",
      title: "Fichiers présents mais non branchés",
      subtitle: "A ne pas confondre avec les sources actives",
      kind: "Non utilisé aujourd'hui",
      source: ["base client.xlsx", "requetespsadata.xlsx", "budgetgueudet .xlsx"],
      pages: [],
      change: "Ne modifie pas ces fichiers si ton but est de corriger l'application actuelle, car aucune page active ne les lit aujourd'hui.",
      notes: "Ils peuvent servir d'archives, de brouillons ou de reliquats."
    }
  ];

  const GIT_RECIPES = [
    {
      id: "git-one-file",
      title: "Mettre à jour un fichier existant",
      subtitle: "Cas classique : tu remplaces un XLSX ou tu modifies un HTML déjà suivi",
      code: ["git status", "git add budgetpsa.xlsx", "git commit -m \"Update PSA budget\"", "git push"],
      notes: "Remplace budgetpsa.xlsx par le vrai nom du fichier."
    },
    {
      id: "git-many-files",
      title: "Pousser plusieurs fichiers liés",
      subtitle: "Exemple : un XLSX + une page HTML",
      code: ["git status", "git add budgetpsa.xlsx reporting-annuelpsa.html", "git commit -m \"Update PSA budget and reporting page\"", "git push"],
      notes: "Pratique quand tu modifies à la fois la donnée et l'écran qui l'exploite."
    },
    {
      id: "git-new-file",
      title: "Ajouter un nouveau fichier au repo",
      subtitle: "Cas d'un nouveau HTML, JS, image ou classeur",
      code: ["git status", "git add nouveau-fichier.html", "git commit -m \"Add new portal file\"", "git push"],
      notes: "Pour un nouveau classeur, remplace nouveau-fichier.html par le vrai nom, par exemple nouveau-budget.xlsx."
    },
    {
      id: "git-all",
      title: "Publier toutes les modifications du dossier",
      subtitle: "Quand tu as plusieurs changements et que tu veux tout envoyer",
      code: ["git status", "git add .", "git commit -m \"Update portal data and pages\"", "git push"],
      notes: "Fais bien le git status avant le commit pour voir exactement ce qui part."
    },
    {
      id: "git-check",
      title: "Vérifier avant d'envoyer",
      subtitle: "Routine recommandée avant chaque push",
      code: ["git status", "git diff --stat", "git log -1 --stat"],
      notes: "Utile si tu veux juste contrôler les changements sans rien pousser."
    }
  ];

  const PAGE_GUIDES = [
    {
      id: "nav",
      title: "Navigation / hubs",
      subtitle: "Menus et pages d'entrée",
      pages: ["index.html", "psa.html", "gueudet.html", "ford.html", "direct.html", "accbudget.html", "accreport.html", "accrequete.html", "accrequeteant.html", "commerce.html"],
      reads: ["Ces pages servent surtout de navigation et de liens.", "index.html mémorise le thème dans APP_THEME."],
      change: "Pour changer un lien, un intitulé ou la structure du menu, modifie la page hub concernée. Ce ne sont pas les pages où vit la donnée métier.",
      storage: ["APP_THEME (piloté depuis index.html)"],
      notes: "Toutes ces pages reçoivent maintenant le thème global et le favicon harmonisé."
    },
    {
      id: "psa-client",
      title: "Recherche client + explorer PSA",
      subtitle: "Base PSA consultée par client ou par produit",
      pages: ["client-psa.html", "explorer-psa.html"],
      reads: ["Fetch direct de psadata.xlsx.", "Explorer PSA peut aussi recharger le fichier et conserver un cache local navigateur."],
      change: "Pour corriger la donnée affichée ici, modifie psadata.xlsx puis push.",
      storage: ["PSA_DATA_CACHE_V1 (cache local côté explorer)"],
      notes: "Le cache améliore l'expérience locale, mais il ne remplace pas le fichier du repo."
    },
    {
      id: "gueudet-client",
      title: "Recherche client + explorer Gueudet",
      subtitle: "Base Gueudet consultée par client ou par produit",
      pages: ["client-gueudet.html", "explorer-gueudet.html"],
      reads: ["Fetch direct de gueudetdata.xlsx.", "Explorer Gueudet garde lui aussi un cache navigateur."],
      change: "Pour corriger la donnée ici, modifie gueudetdata.xlsx puis push.",
      storage: ["Cache local navigateur côté explorer"],
      notes: "Même logique que le duo PSA."
    },
    {
      id: "requetes",
      title: "Pages requêtes / TCD",
      subtitle: "Consultation de requêtes historiques ou 2026",
      pages: ["requetepsa.html", "requetepsa-2026.html", "requetegueudet-2026.html"],
      reads: ["requetepsa.html lit data.xlsx.", "requetepsa-2026.html lit activitereelpsa.xlsx.", "requetegueudet-2026.html lit activitereelgueudet.xlsx."],
      change: "Modifie le fichier source de la page voulue puis push.",
      storage: ["Peu ou pas de donnée métier persistée en local"],
      notes: "Les versions Ford/Direct 2026 et la requête Gueudet antérieure restent des pages de transition pour le moment."
    },
    {
      id: "real-pages",
      title: "Pages activité réelle",
      subtitle: "Chargent les réels et fabriquent des ponts locaux vers certains écrans",
      pages: ["activitereelpsa.html", "activitereelgueudet.html", "activitereelford.html", "activitereeldirect.html"],
      reads: ["Chaque page recharge son activitereel*.xlsx.", "Les pages PSA / Gueudet / Ford / Direct génèrent aussi des structures localStorage pour leurs écrans associés."],
      change: "Si le réel d'une entité est faux, commence toujours par son activitereel*.xlsx.",
      storage: ["ACTIVITEREEL_PSA_V1", "ACTIVITEREEL_GUEUDET_V1", "ACTIVITEREEL_FORD_V1", "ACTIVITEREEL_DIRECT_V1"],
      notes: "Ces ponts locaux servent au navigateur en cours, mais ne remplacent pas le vrai classeur du repo."
    },
    {
      id: "annual-reporting",
      title: "Reporting annuel",
      subtitle: "Pages de reporting annuel par entité",
      pages: ["reporting-annuelpsa.html", "reporting-annuelgueudet.html", "reporting-annuelford.html", "reporting-annueldirect.html"],
      reads: ["Ces pages auto-fetchent maintenant leur budget*.xlsx et leur activitereel*.xlsx.", "L'import manuel reste disponible en secours."],
      change: "Si un budget ou un réel affiché ici est faux, modifie le fichier budget*.xlsx ou activitereel*.xlsx correspondant puis push.",
      storage: ["Des clés locales de confort existent, mais la source partagée reste le fichier fetché"],
      notes: "C'est le bon point d'entrée si tu veux vérifier si le budget auto-remonte bien en ligne."
    },
    {
      id: "evol-analyse",
      title: "Evol analyse + vue semaine",
      subtitle: "Analyse mensuelle, drilldown et zoom semaine",
      pages: ["evol-analyse-psa.html", "evol-analyse-gueudet.html", "evol-analyse-ford.html", "evol-analyse-direct.html", "vue_semaine.html"],
      reads: ["Chaque page analyse lit un couple budget/réel propre à l'entité.", "vue_semaine.html reçoit les fichiers via les paramètres d'URL puis refait les calculs semaine."],
      change: "Pour changer l'analyse, modifie le budget ou le réel de l'entité. Pour changer les règles de calcul/semaine, modifie le HTML concerné.",
      storage: ["Commentaires mensuels par année", "Commentaires semaine par entité / année / mois"],
      notes: "Ford et Direct utilisent surtout Date commande + CA Total côté réel."
    },
    {
      id: "evol-cumule",
      title: "Evol cumulé",
      subtitle: "Vue transverse multi-entités",
      pages: ["evol-cumule.html"],
      reads: ["Lit les 8 gros fichiers principaux : 4 budgets + 4 réels."],
      change: "Si une entité est fausse ici, corrige son budget ou son réel source ; la page cumulée se mettra en cohérence.",
      storage: ["Commentaires / état d'interface local"],
      notes: "C'est la page la plus dépendante des bons fichiers source."
    },
    {
      id: "psa-bridge",
      title: "Chaîne PSA avec pont localStorage",
      subtitle: "Cas particulier à bien comprendre",
      pages: ["activitereelpsa.html", "reporting-annuelpsa.html", "evol-reporting-psa.html"],
      reads: ["activitereelpsa.html fabrique ACTIVITEREEL_PSA_V1.", "reporting-annuelpsa.html recharge budgetpsa.xlsx et activitereelpsa.xlsx puis stocke des clés PSA locales.", "evol-reporting-psa.html lit surtout les clés locales PSA plutôt qu'un fetch direct complet."],
      change: "Si evol-reporting-psa.html semble incohérent, recharge d'abord activitereelpsa.html et reporting-annuelpsa.html dans ce navigateur, puis vérifie les vrais fichiers PSA.",
      storage: ["ACTIVITEREEL_PSA_V1", "BUDGET2026_DATA_PSA_V1", "BUDGET2026_REAL_PSA_V1"],
      notes: "C'est la partie la plus hybride du projet : fichiers partagés + caches locaux."
    },
    {
      id: "psa-2026",
      title: "PSA N-1 / projection / budget local",
      subtitle: "Flux spécial PSA 2026",
      pages: ["activite-reelle-n-1.html", "reel-n1-psa.html", "projectionpsa2026.html", "budget2026.html"],
      reads: ["activite-reelle-n-1.html et reel-n1-psa.html lisent l'historique PSA.", "projectionpsa2026.html croise BUDGET2026_PSA.xlsx, activitereelpsa.xlsx et activitereelpsan-1.xlsx.", "budget2026.html travaille en localStorage tant que tu n'exportes pas."],
      change: "Pour la donnée partagée, change les fichiers XLSX. Pour des tests locaux ou une préparation de budget, budget2026.html suffit mais ne publie rien à lui seul.",
      storage: ["budget2026_v4_projection_import", "clés locales liées à la projection"],
      notes: "Très utile pour préparer un budget, mais attention à ne pas croire qu'un simple localStorage est déjà déployé."
    },
    {
      id: "supabase-pages",
      title: "Pages Supabase / terrain",
      subtitle: "CRM, suivi d'activité, fiches et tarifs",
      pages: ["ficherclt.html", "tdbactivite.html", "gestionimportclients.html", "gestiontarif.html", "rappelclt.html", "rapportjournalier.html"],
      reads: ["ficherclt.html : clients, produits, tarifs_plaques, visite_commandes, visites.", "tdbactivite.html : clients, produits, visite_commandes, visites.", "gestionimportclients.html : clients et plaques.", "gestiontarif.html : plaques, produits, tarifs_plaques.", "rappelclt.html : clients, produits, visite_commandes, visites.", "rapportjournalier.html : visites."],
      change: "La donnée de ces pages ne se corrige pas en modifiant un XLSX du repo. Il faut agir via Supabase ou via les écrans d'import de l'application.",
      storage: ["Peu utile comme source de vérité ; la vraie donnée est en base"],
      notes: "Si le bug est visuel, modifie le HTML. Si c'est la donnée métier, regarde la base."
    }
  ];

  const PENDING_PAGES = [
    { file: "client-direct.html", note: "écran de transition, pas de fetch métier" },
    { file: "explorer-direct.html", note: "écran de transition, pas de fetch métier" },
    { file: "client-ford.html", note: "écran de transition, pas de fetch métier" },
    { file: "explorer-ford.html", note: "écran de transition, pas de fetch métier" },
    { file: "evol-reporting-direct.html", note: "page publiée mais non développée" },
    { file: "evol-reporting-ford.html", note: "page publiée mais non développée" },
    { file: "requetedirect-2026.html", note: "page de transition" },
    { file: "requeteford-2026.html", note: "page de transition" },
    { file: "requetegueudet.html", note: "page de transition pour la requête historique Gueudet" },
    { file: "evol-analyse-global.html", note: "placeholder" },
    { file: "encours.html", note: "placeholder générique" }
  ];

  const dom = {
    q: document.getElementById("q"),
    dataList: document.getElementById("dataList"),
    gitList: document.getElementById("gitList"),
    pageList: document.getElementById("pageList"),
    pendingList: document.getElementById("pendingList"),
    btnOpenAll: document.getElementById("btnOpenAll"),
    btnCloseAll: document.getElementById("btnCloseAll"),
    btnCopyAll: document.getElementById("btnCopyAll"),
    notes: document.getElementById("notes"),
    btnSaveNotes: document.getElementById("btnSaveNotes"),
    btnClearNotes: document.getElementById("btnClearNotes"),
    searchMeta: document.getElementById("searchMeta")
  };

  const NOTES_KEY = "APP_PARAM_GUIDE_NOTES";
  dom.notes.value = localStorage.getItem(NOTES_KEY) || "";

  dom.btnSaveNotes.addEventListener("click", function () {
    localStorage.setItem(NOTES_KEY, dom.notes.value || "");
    toast("Notes enregistrées.");
  });

  dom.btnClearNotes.addEventListener("click", function () {
    dom.notes.value = "";
    localStorage.setItem(NOTES_KEY, "");
    toast("Notes vidées.");
  });

  dom.btnOpenAll.addEventListener("click", function () {
    document.querySelectorAll("details").forEach(function (d) { d.open = true; });
  });

  dom.btnCloseAll.addEventListener("click", function () {
    document.querySelectorAll("details").forEach(function (d) { d.open = false; });
  });

  dom.btnCopyAll.addEventListener("click", async function () {
    await copyText(buildFullText());
    toast("Résumé copié.");
  });

  dom.q.addEventListener("input", render);
  document.addEventListener("click", onDocumentClick);

  render();

  function onDocumentClick(event) {
    const copyBtn = event.target.closest("[data-copy-text]");
    if (copyBtn) {
      event.preventDefault();
      event.stopPropagation();
      copyText(copyBtn.getAttribute("data-copy-text") || "").then(function () {
        toast("Bloc copié.");
      });
      return;
    }

    const openBtn = event.target.closest("[data-open-page]");
    if (openBtn) {
      event.preventDefault();
      event.stopPropagation();
      const file = openBtn.getAttribute("data-open-page");
      if (file) location.href = file;
    }
  }

  function render() {
    const q = norm(dom.q.value || "");
    const dataItems = DATA_SOURCES.filter(function (item) { return match(item, q); });
    const gitItems = GIT_RECIPES.filter(function (item) { return match(item, q); });
    const pageItems = PAGE_GUIDES.filter(function (item) { return match(item, q); });
    const pendingItems = PENDING_PAGES.filter(function (item) { return match(item, q); });

    dom.searchMeta.innerHTML = [
      metaChip(dataItems.length + " source(s) de données visibles", "ok"),
      metaChip(gitItems.length + " recette(s) Git", "ok"),
      metaChip(pageItems.length + " bloc(s) de fonctionnement", "ok"),
      metaChip(pendingItems.length + " page(s) en attente", pendingItems.length ? "warn" : "ok")
    ].join("");

    dom.dataList.innerHTML = dataItems.map(renderDataItem).join("") || emptyState("Aucune source de données ne correspond à la recherche.");
    dom.gitList.innerHTML = gitItems.map(renderGitItem).join("") || emptyState("Aucune recette Git ne correspond à la recherche.");
    dom.pageList.innerHTML = pageItems.map(renderPageItem).join("") || emptyState("Aucun bloc page ne correspond à la recherche.");
    dom.pendingList.innerHTML = pendingItems.map(renderPendingItem).join("") || emptyState("Aucune page de transition ne correspond à la recherche.");
  }

  function renderDataItem(item) {
    return `
      <details ${dom.q.value ? "open" : ""}>
        <summary>
          <div class="sumLeft">
            <div class="sumTitle">${esc(item.title)}</div>
            <div class="sumSub">${esc(item.subtitle)}</div>
            <div class="meta" style="margin-top:8px">
              <span class="badge"><code>${esc(item.kind)}</code></span>
              ${item.source.map(codeChip).join("")}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <button class="pill" type="button" data-copy-text="${escAttr(buildDataText(item))}">Copier</button>
          </div>
        </summary>
        <div class="content">
          <div class="kvs">
            <div class="k">Source à modifier</div>
            <div class="v"><div class="codes">${item.source.map(codeChip).join("")}</div></div>
            <div class="k">Pages concernées</div>
            <div class="v"><div class="codes">${item.pages.length ? item.pages.map(fileChip).join("") : "<span class='muted'>Aucune page active</span>"}</div></div>
            <div class="k">Quand la modifier</div>
            <div class="v">${esc(item.change)}</div>
            <div class="k">Notes</div>
            <div class="v">${esc(item.notes)}</div>
          </div>
        </div>
      </details>
    `;
  }

  function renderGitItem(item) {
    return `
      <details ${dom.q.value ? "open" : ""}>
        <summary>
          <div class="sumLeft">
            <div class="sumTitle">${esc(item.title)}</div>
            <div class="sumSub">${esc(item.subtitle)}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <span class="badge"><span class="dot ok"></span><code>Git</code></span>
          </div>
        </summary>
        <div class="content">
          <div class="kvs">
            <div class="k">Commandes</div>
            <div class="v">
              <pre style="margin:0;white-space:pre-wrap;font:12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.10);padding:12px;border-radius:14px;">${esc(item.code.join("\n"))}</pre>
            </div>
            <div class="k">Pourquoi</div>
            <div class="v">${esc(item.notes)}</div>
          </div>
          <div class="rowBtns">
            <button class="pill" type="button" data-copy-text="${escAttr(item.code.join("\n"))}">Copier les commandes</button>
          </div>
        </div>
      </details>
    `;
  }

  function renderPageItem(item) {
    return `
      <details ${dom.q.value ? "open" : ""}>
        <summary>
          <div class="sumLeft">
            <div class="sumTitle">${esc(item.title)}</div>
            <div class="sumSub">${esc(item.subtitle)}</div>
            <div class="meta" style="margin-top:8px">${item.pages.slice(0, 5).map(fileChip).join("")}${item.pages.length > 5 ? "<span class='chip'><span class='dot'></span><span>+" + (item.pages.length - 5) + " autre(s)</span></span>" : ""}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <button class="pill" type="button" data-copy-text="${escAttr(buildPageText(item))}">Copier</button>
          </div>
        </summary>
        <div class="content">
          <div class="kvs">
            <div class="k">Pages</div>
            <div class="v"><div class="codes">${item.pages.map(fileChip).join("")}</div></div>
            <div class="k">Lecture / fetch</div>
            <div class="v">${item.reads.map(function (line) { return "• " + esc(line); }).join("<br>")}</div>
            <div class="k">Pour changer la donnée</div>
            <div class="v">${esc(item.change)}</div>
            <div class="k">Caches locaux</div>
            <div class="v">${item.storage.length ? item.storage.map(codeChip).join("") : "<span class='muted'>Aucun point clé à retenir</span>"}</div>
            <div class="k">Notes</div>
            <div class="v">${esc(item.notes)}</div>
          </div>
        </div>
      </details>
    `;
  }

  function renderPendingItem(item) {
    return `<div class="chip" style="justify-content:space-between;gap:12px;padding:10px 12px;"><span><code>${esc(item.file)}</code></span><span class="muted2">${esc(item.note)}</span></div>`;
  }

  function buildFullText() {
    const lines = [];
    lines.push("PARAMETRAGE - CARTOGRAPHIE PORTAIL KENT");
    lines.push("");
    lines.push("REGLES D'OR");
    lines.push("- Une donnée partagée doit venir d'un fichier poussé sur GitHub ou de Supabase.");
    lines.push("- localStorage reste local au navigateur.");
    lines.push("- APP_THEME pilote le thème global.");
    lines.push("- kent-logo.svg pilote le favicon commun.");
    lines.push("");
    lines.push("SOURCES DE DONNEES");
    DATA_SOURCES.forEach(function (item) {
      lines.push("");
      lines.push(buildDataText(item));
    });
    lines.push("");
    lines.push("RECETTES GIT");
    GIT_RECIPES.forEach(function (item) {
      lines.push("");
      lines.push(item.title);
      lines.push(item.code.join("\n"));
      lines.push("Note: " + item.notes);
    });
    lines.push("");
    lines.push("FONCTIONNEMENT DES PAGES");
    PAGE_GUIDES.forEach(function (item) {
      lines.push("");
      lines.push(buildPageText(item));
    });
    lines.push("");
    lines.push("PAGES EN ATTENTE");
    PENDING_PAGES.forEach(function (item) {
      lines.push("- " + item.file + ": " + item.note);
    });
    return lines.join("\n");
  }

  function metaChip(text, tone) {
    return `<span class="chip"><span class="dot ${tone}"></span><span>${esc(text)}</span></span>`;
  }

  function fileChip(file) {
    return `<button class="pill" type="button" data-open-page="${escAttr(file)}">${esc(file)}</button>`;
  }

  function codeChip(value) {
    return `<span class="badge"><code>${esc(value)}</code></span>`;
  }

  function emptyState(label) {
    return `<div class="chip"><span class="dot warn"></span><span>${esc(label)}</span></div>`;
  }

  function match(item, query) {
    if (!query) return true;
    return norm(JSON.stringify(item)).includes(query);
  }

  function buildDataText(item) {
    return [
      item.title,
      "Type: " + item.kind,
      "Source: " + (item.source.join(", ") || "—"),
      "Pages: " + (item.pages.join(", ") || "—"),
      "Quand modifier: " + item.change,
      "Notes: " + item.notes
    ].join("\n");
  }

  function buildPageText(item) {
    return [
      item.title,
      "Pages: " + item.pages.join(", "),
      "",
      "Lecture / fetch:",
      item.reads.map(function (line) { return "- " + line; }).join("\n"),
      "",
      "Pour changer la donnée: " + item.change,
      "Caches locaux: " + (item.storage.join(", ") || "—"),
      "Notes: " + item.notes
    ].join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  function toast(msg) {
    const n = document.createElement("div");
    n.textContent = msg;
    n.style.position = "fixed";
    n.style.left = "50%";
    n.style.bottom = "22px";
    n.style.transform = "translateX(-50%)";
    n.style.padding = "10px 12px";
    n.style.borderRadius = "14px";
    n.style.border = "1px solid rgba(255,255,255,0.14)";
    n.style.background = "rgba(10,14,22,0.90)";
    n.style.boxShadow = "0 18px 40px rgba(0,0,0,.45)";
    n.style.backdropFilter = "blur(10px)";
    n.style.color = "rgba(255,255,255,0.92)";
    n.style.fontWeight = "950";
    n.style.zIndex = "9999";
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 1100);
  }

  function norm(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
