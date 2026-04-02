(function () {
  var SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";
  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var rapportVisites = [];
  var reportStats = createEmptyStats();

  window.__RAPPORT_JOURNALIER_BOOTED__ = true;

  function createEmptyStats() {
    return {
      nbVisites: 0,
      nbClients: 0,
      nbLignes: 0,
      nbVerts: 0,
      nbRouges: 0,
      nbJaunes: 0,
      nbBleus: 0,
      totalQuantite: 0,
      totalStock: 0,
      avgLinesPerVisit: 0,
      topClients: [],
      topProducts: [],
      executivePoints: []
    };
  }

  function setStatus(message) {
    var node = document.getElementById("statusBar");
    if (node) node.textContent = message;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(normalizeNumber(value));
  }

  function formatDate(dateStr) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("fr-FR");
  }

  function formatDateLong(dateStr) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  function getColorLabel(color) {
    var map = {
      red: "Rouge",
      yellow: "Jaune",
      green: "Vert",
      blue: "Bleu"
    };
    return map[color] || "Non defini";
  }

  function getColorDotClass(color) {
    return ["red", "yellow", "green", "blue"].includes(color) ? color : "gray";
  }

  function computeVisitMetrics(visite) {
    var metrics = {
      nbLignes: 0,
      totalQuantite: 0,
      totalStock: 0,
      nbRouges: 0,
      nbJaunes: 0,
      nbVerts: 0,
      nbBleus: 0
    };

    (visite.commandes || []).forEach(function (cmd) {
      metrics.nbLignes += 1;
      metrics.totalQuantite += normalizeNumber(cmd.quantite);
      metrics.totalStock += normalizeNumber(cmd.stock_client);

      if (cmd.couleur === "red") metrics.nbRouges += 1;
      if (cmd.couleur === "yellow") metrics.nbJaunes += 1;
      if (cmd.couleur === "green") metrics.nbVerts += 1;
      if (cmd.couleur === "blue") metrics.nbBleus += 1;
    });

    return metrics;
  }

  function buildExecutivePoints(stats) {
    var points = [];

    if (!stats.nbVisites) {
      return ["Aucune visite exploitable n'a ete remontee pour cette date."];
    }

    points.push(
      formatNumber(stats.nbVisites) +
        " visite(s) realisee(s) aupres de " +
        formatNumber(stats.nbClients) +
        " client(s), pour " +
        formatNumber(stats.nbLignes) +
        " ligne(s) produit(s) travaillees."
    );

    points.push(
      "Volume terrain du jour : " +
        formatNumber(stats.totalQuantite) +
        " unite(s) declaree(s) et " +
        formatNumber(stats.totalStock) +
        " unite(s) de stock client observees."
    );

    points.push(
      "Lecture prioritaire : " +
        formatNumber(stats.nbRouges) +
        " alerte(s) rouge(s), " +
        formatNumber(stats.nbJaunes) +
        " vigilance(s) jaune(s) et " +
        formatNumber(stats.nbVerts) +
        " opportunite(s) verte(s)."
    );

    if (stats.topClients.length) {
      points.push(
        "Client le plus actif : " +
          stats.topClients[0].name +
          " avec " +
          formatNumber(stats.topClients[0].lines) +
          " ligne(s) et " +
          formatNumber(stats.topClients[0].quantity) +
          " unite(s) travaillees."
      );
    }

    if (stats.topProducts.length) {
      points.push(
        "Produit principal du jour : " +
          stats.topProducts[0].name +
          " (" +
          (stats.topProducts[0].reference || "-") +
          ") avec " +
          formatNumber(stats.topProducts[0].quantity) +
          " unite(s) sur " +
          formatNumber(stats.topProducts[0].lines) +
          " ligne(s)."
      );
    }

    return points;
  }

  async function fetchRapportVisitesByDate(reportDate) {
    var result = await supabaseClient
      .from("visites")
      .select(
        "id, client_id, date_visite, note, clients ( id, nom, numero_compte, adresse, telephone ), visite_commandes ( id, produit_id, quantite, stock_client, couleur, produits ( id, nom, reference_produit ) )"
      )
      .eq("date_visite", reportDate)
      .order("date_visite", { ascending: true });

    if (result.error) {
      console.error("Erreur fetchRapportVisitesByDate:", result.error);
      throw result.error;
    }

    return (result.data || []).map(function (visite) {
      return {
        id: visite.id,
        client_id: visite.client_id,
        date_visite: visite.date_visite,
        note: visite.note,
        client: visite.clients || null,
        commandes: (visite.visite_commandes || []).map(function (cmd) {
          return {
            id: cmd.id,
            produit_id: cmd.produit_id,
            quantite: cmd.quantite,
            stock_client: cmd.stock_client,
            couleur: cmd.couleur,
            produit: cmd.produits || null
          };
        })
      };
    });
  }

  function calculateStats(visites) {
    var stats = createEmptyStats();
    var uniqueClients = new Set();
    var clientMap = new Map();
    var productMap = new Map();

    stats.nbVisites = visites.length;

    visites.forEach(function (visite) {
      var visitMetrics = computeVisitMetrics(visite);
      var clientId = visite.client && visite.client.id ? visite.client.id : "client-" + (visite.client && visite.client.nom ? visite.client.nom : "inconnu");
      var clientName = visite.client && visite.client.nom ? visite.client.nom : "Client inconnu";

      if ((visite.client && visite.client.id) || (visite.client && visite.client.nom)) {
        uniqueClients.add(clientId);
      }

      stats.nbLignes += visitMetrics.nbLignes;
      stats.totalQuantite += visitMetrics.totalQuantite;
      stats.totalStock += visitMetrics.totalStock;
      stats.nbRouges += visitMetrics.nbRouges;
      stats.nbJaunes += visitMetrics.nbJaunes;
      stats.nbVerts += visitMetrics.nbVerts;
      stats.nbBleus += visitMetrics.nbBleus;

      if (!clientMap.has(clientId)) {
        clientMap.set(clientId, {
          name: clientName,
          account: visite.client && visite.client.numero_compte ? visite.client.numero_compte : "-",
          visits: 0,
          lines: 0,
          quantity: 0,
          stock: 0,
          greens: 0
        });
      }

      var clientEntry = clientMap.get(clientId);
      clientEntry.visits += 1;
      clientEntry.lines += visitMetrics.nbLignes;
      clientEntry.quantity += visitMetrics.totalQuantite;
      clientEntry.stock += visitMetrics.totalStock;
      clientEntry.greens += visitMetrics.nbVerts;

      (visite.commandes || []).forEach(function (cmd) {
        var productKey =
          (cmd.produit && cmd.produit.id) ||
          ((cmd.produit && cmd.produit.reference_produit) || "") + "-" + ((cmd.produit && cmd.produit.nom) || "produit-inconnu");

        if (!productMap.has(productKey)) {
          productMap.set(productKey, {
            name: cmd.produit && cmd.produit.nom ? cmd.produit.nom : "Produit inconnu",
            reference: cmd.produit && cmd.produit.reference_produit ? cmd.produit.reference_produit : "-",
            lines: 0,
            quantity: 0,
            stock: 0,
            greens: 0
          });
        }

        var productEntry = productMap.get(productKey);
        productEntry.lines += 1;
        productEntry.quantity += normalizeNumber(cmd.quantite);
        productEntry.stock += normalizeNumber(cmd.stock_client);
        if (cmd.couleur === "green") productEntry.greens += 1;
      });
    });

    stats.nbClients = uniqueClients.size;
    stats.avgLinesPerVisit = stats.nbVisites ? stats.nbLignes / stats.nbVisites : 0;
    stats.topClients = Array.from(clientMap.values())
      .sort(function (a, b) {
        return b.quantity - a.quantity || b.lines - a.lines || b.visits - a.visits;
      })
      .slice(0, 5);
    stats.topProducts = Array.from(productMap.values())
      .sort(function (a, b) {
        return b.quantity - a.quantity || b.lines - a.lines || b.greens - a.greens;
      })
      .slice(0, 5);
    stats.executivePoints = buildExecutivePoints(stats);

    return stats;
  }

  function renderSummary(stats) {
    var mapping = {
      summaryVisites: stats.nbVisites,
      summaryClients: stats.nbClients,
      summaryLignes: stats.nbLignes,
      summaryQuantite: stats.totalQuantite,
      summaryStock: stats.totalStock,
      summaryRouges: stats.nbRouges,
      summaryJaunes: stats.nbJaunes,
      summaryVerts: stats.nbVerts
    };

    Object.keys(mapping).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = formatNumber(mapping[id]);
    });
  }

  function renderRankingRows(items, type) {
    if (!items.length) {
      return '<div class=\"analysis-item\">Aucune donnee disponible pour cette date.</div>';
    }

    return items
      .map(function (item, index) {
        var meta =
          type === "client"
            ? "Compte : " +
              escapeHtml(item.account || "-") +
              " · Visites : " +
              formatNumber(item.visits) +
              " · Lignes : " +
              formatNumber(item.lines)
            : "Ref : " +
              escapeHtml(item.reference || "-") +
              " · Lignes : " +
              formatNumber(item.lines) +
              " · Opportunites : " +
              formatNumber(item.greens);

        return (
          '<div class=\"ranking-row\">' +
          '<div class=\"ranking-main\">' +
          '<div class=\"ranking-name\">' +
          (index + 1) +
          ". " +
          escapeHtml(item.name) +
          "</div>" +
          '<div class=\"ranking-meta\">' +
          meta +
          "</div>" +
          "</div>" +
          '<div class=\"ranking-value\">' +
          formatNumber(item.quantity) +
          " u.</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderInsights(stats) {
    var executiveNode = document.getElementById("executiveSummary");
    var clientsNode = document.getElementById("topClientsList");
    var productsNode = document.getElementById("topProductsList");

    if (executiveNode) {
      executiveNode.innerHTML =
        (stats.executivePoints || [])
          .map(function (point) {
            return '<div class=\"analysis-item\">' + escapeHtml(point) + "</div>";
          })
          .join("") || '<div class=\"analysis-item\">Aucune synthese disponible.</div>';
    }

    if (clientsNode) clientsNode.innerHTML = renderRankingRows(stats.topClients, "client");
    if (productsNode) productsNode.innerHTML = renderRankingRows(stats.topProducts, "product");
  }

  function renderPreview(visites) {
    var container = document.getElementById("previewList");
    if (!container) return;

    if (!visites.length) {
      container.innerHTML = '<div class=\"empty-state\">Aucune visite trouvee pour cette date.</div>';
      return;
    }

    container.innerHTML = visites
      .map(function (visite) {
        var clientNom = visite.client && visite.client.nom ? visite.client.nom : "Client inconnu";
        var compte = visite.client && visite.client.numero_compte ? visite.client.numero_compte : "-";
        var tel = visite.client && visite.client.telephone ? visite.client.telephone : "-";
        var adresse = visite.client && visite.client.adresse ? visite.client.adresse : "-";
        var note = visite.note && visite.note.trim() ? visite.note.trim() : "Aucune note";
        var visitMetrics = computeVisitMetrics(visite);

        var lignesHtml = (visite.commandes || []).length
          ? '<div class=\"table-wrapper\"><table><thead><tr><th>Produit</th><th>Quantite</th><th>Stock client</th><th>Statut</th></tr></thead><tbody>' +
            (visite.commandes || [])
              .map(function (cmd) {
                return (
                  "<tr>" +
                  "<td>" +
                  escapeHtml(cmd.produit && cmd.produit.nom ? cmd.produit.nom : "Produit inconnu") +
                  '<span class=\"ref-text\">Ref : ' +
                  escapeHtml(cmd.produit && cmd.produit.reference_produit ? cmd.produit.reference_produit : "-") +
                  "</span></td>" +
                  "<td>" +
                  formatNumber(cmd.quantite) +
                  "</td>" +
                  "<td>" +
                  formatNumber(cmd.stock_client) +
                  "</td>" +
                  "<td><span class=\"color-badge\"><span class=\"dot " +
                  getColorDotClass(cmd.couleur) +
                  '\"></span>' +
                  escapeHtml(getColorLabel(cmd.couleur)) +
                  "</span></td>" +
                  "</tr>"
                );
              })
              .join("") +
            "</tbody></table></div>"
          : '<div class=\"empty-state\" style=\"padding:20px 0 0;\">Aucune ligne produit sur cette visite.</div>';

        return (
          '<div class=\"visit-card\">' +
          '<div class=\"visit-header\">' +
          '<div class=\"visit-client\">' +
          "<h3>" +
          escapeHtml(clientNom) +
          "</h3>" +
          '<div class=\"visit-meta\">Compte : ' +
          escapeHtml(compte) +
          "<br>Telephone : " +
          escapeHtml(tel) +
          "<br>Adresse : " +
          escapeHtml(adresse) +
          "</div>" +
          "</div>" +
          '<div class=\"visit-meta\"><strong>Date :</strong> ' +
          escapeHtml(formatDate(visite.date_visite)) +
          "</div>" +
          "</div>" +
          '<div class=\"visit-stat-row\">' +
          '<span class=\"visit-stat-chip\">Lignes : ' +
          formatNumber(visitMetrics.nbLignes) +
          "</span>" +
          '<span class=\"visit-stat-chip\">Quantite : ' +
          formatNumber(visitMetrics.totalQuantite) +
          "</span>" +
          '<span class=\"visit-stat-chip\">Stock observe : ' +
          formatNumber(visitMetrics.totalStock) +
          "</span>" +
          '<span class=\"visit-stat-chip\">Rouges : ' +
          formatNumber(visitMetrics.nbRouges) +
          "</span>" +
          '<span class=\"visit-stat-chip\">Verts : ' +
          formatNumber(visitMetrics.nbVerts) +
          "</span>" +
          "</div>" +
          '<div class=\"visit-note\">' +
          escapeHtml(note) +
          "</div>" +
          lignesHtml +
          "</div>"
        );
      })
      .join("");
  }

  function buildPdfMetricRows() {
    var rows = [
      ["Volume total travaille", formatNumber(reportStats.totalQuantite) + " unite(s)"],
      ["Stock client observe", formatNumber(reportStats.totalStock) + " unite(s)"],
      ["Moyenne lignes / visite", reportStats.nbVisites ? reportStats.avgLinesPerVisit.toFixed(1).replace(".", ",") : "0"],
      ["Alertes rouges", formatNumber(reportStats.nbRouges)],
      ["Vigilances jaunes", formatNumber(reportStats.nbJaunes)],
      ["Opportunites vertes", formatNumber(reportStats.nbVerts)]
    ];

    return rows
      .map(function (row) {
        return "<tr><th>" + escapeHtml(row[0]) + "</th><td>" + escapeHtml(row[1]) + "</td></tr>";
      })
      .join("");
  }

  function buildPdfRankingRows(items, type) {
    if (!items.length) {
      return '<tr><td colspan=\"3\">Aucune donnee exploitable.</td></tr>';
    }

    return items
      .map(function (item) {
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(item.name) +
          "</td>" +
          "<td>" +
          escapeHtml(type === "client" ? item.account || "-" : item.reference || "-") +
          "</td>" +
          "<td>" +
          formatNumber(item.quantity) +
          " u.</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function buildPdfHtml() {
    var reportDate = document.getElementById("reportDate").value;
    var commercialName = (document.getElementById("commercialName").value || "").trim() || "Non renseigne";
    var reportTitle = (document.getElementById("reportTitle").value || "").trim() || "Rapport journalier des visites";
    var globalComment = (document.getElementById("globalComment").value || "").trim();

    var visitsHtml = rapportVisites
      .map(function (visite) {
        var clientNom = visite.client && visite.client.nom ? visite.client.nom : "Client inconnu";
        var compte = visite.client && visite.client.numero_compte ? visite.client.numero_compte : "-";
        var tel = visite.client && visite.client.telephone ? visite.client.telephone : "-";
        var adresse = visite.client && visite.client.adresse ? visite.client.adresse : "-";
        var note = visite.note && visite.note.trim() ? visite.note.trim() : "Aucune note";
        var visitMetrics = computeVisitMetrics(visite);
        var commandes = visite.commandes || [];

        var rows = commandes.length
          ? '<div class=\"pdf-products\"><table class=\"pdf-product-table\"><thead><tr><th>Produit</th><th>Reference</th><th>Quantite</th><th>Stock client</th><th>Statut</th></tr></thead><tbody>' +
            commandes
              .map(function (cmd) {
                return (
                  "<tr>" +
                  "<td>" +
                  escapeHtml(cmd.produit && cmd.produit.nom ? cmd.produit.nom : "Produit inconnu") +
                  "</td>" +
                  "<td>" +
                  escapeHtml(cmd.produit && cmd.produit.reference_produit ? cmd.produit.reference_produit : "-") +
                  "</td>" +
                  "<td>" +
                  formatNumber(cmd.quantite) +
                  "</td>" +
                  "<td>" +
                  formatNumber(cmd.stock_client) +
                  "</td>" +
                  "<td>" +
                  escapeHtml(getColorLabel(cmd.couleur)) +
                  "</td>" +
                  "</tr>"
                );
              })
              .join("") +
            "</tbody></table></div>"
          : '<div class=\"pdf-note\">Aucune ligne produit sur cette visite.</div>';

        return (
          '<div class=\"pdf-visit\">' +
          '<div class=\"pdf-visit-header\">' +
          "<div>" +
          '<div class=\"pdf-visit-client\">' +
          escapeHtml(clientNom) +
          "</div>" +
          '<div class=\"pdf-visit-meta\">Compte : ' +
          escapeHtml(compte) +
          "<br>Telephone : " +
          escapeHtml(tel) +
          "<br>Adresse : " +
          escapeHtml(adresse) +
          "</div>" +
          "</div>" +
          '<div class=\"pdf-visit-meta\">Date : ' +
          escapeHtml(formatDate(visite.date_visite)) +
          "</div>" +
          "</div>" +
          '<div class=\"pdf-visit-stats\">' +
          '<span class=\"pdf-visit-badge\">Lignes : ' +
          formatNumber(visitMetrics.nbLignes) +
          "</span>" +
          '<span class=\"pdf-visit-badge\">Quantite : ' +
          formatNumber(visitMetrics.totalQuantite) +
          "</span>" +
          '<span class=\"pdf-visit-badge\">Stock : ' +
          formatNumber(visitMetrics.totalStock) +
          "</span>" +
          '<span class=\"pdf-visit-badge\">Rouges : ' +
          formatNumber(visitMetrics.nbRouges) +
          "</span>" +
          '<span class=\"pdf-visit-badge\">Verts : ' +
          formatNumber(visitMetrics.nbVerts) +
          "</span>" +
          "</div>" +
          '<div class=\"pdf-note\">' +
          escapeHtml(note) +
          "</div>" +
          rows +
          "</div>"
        );
      })
      .join("");

    var executiveHtml = (reportStats.executivePoints || [])
      .map(function (point) {
        return '<div class=\"pdf-bullet\">' + escapeHtml(point) + "</div>";
      })
      .join("");

    return (
      '<div class=\"pdf-report\">' +
      '<div class=\"pdf-header\">' +
      '<div class=\"pdf-brand\">' +
      '<div class=\"pdf-logo-box\"><img src=\"./kent-logo.svg\" alt=\"KENT\"></div>' +
      "<div>" +
      "<h1>" +
      escapeHtml(reportTitle) +
      "</h1>" +
      '<div class=\"pdf-subtitle\">Portail Commercial KENT<br>Rapport terrain consolide de la journee</div>' +
      "</div>" +
      "</div>" +
      '<div class=\"pdf-meta-box\">Date du rapport : ' +
      escapeHtml(formatDateLong(reportDate)) +
      "<br>Commercial : " +
      escapeHtml(commercialName) +
      "<br>Visites consolidees : " +
      formatNumber(reportStats.nbVisites) +
      "</div>" +
      "</div>" +
      '<div class=\"pdf-summary\">' +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Visites</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.nbVisites) +
      "</div></div>" +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Clients</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.nbClients) +
      "</div></div>" +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Lignes produits</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.nbLignes) +
      "</div></div>" +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Quantite totale</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.totalQuantite) +
      "</div></div>" +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Stock observe</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.totalStock) +
      "</div></div>" +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Rouges</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.nbRouges) +
      "</div></div>" +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Jaunes</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.nbJaunes) +
      "</div></div>" +
      '<div class=\"pdf-chip\"><div class=\"pdf-chip-label\">Verts</div><div class=\"pdf-chip-value\">' +
      formatNumber(reportStats.nbVerts) +
      "</div></div>" +
      "</div>" +
      '<div class=\"pdf-grid\">' +
      '<div class=\"pdf-panel\"><div class=\"pdf-section-title\">Synthese executive</div><div class=\"pdf-bullet-list\">' +
      (executiveHtml || '<div class=\"pdf-bullet\">Aucune activite disponible.</div>') +
      "</div></div>" +
      '<div class=\"pdf-panel\"><div class=\"pdf-section-title\">Lecture activite</div><table class=\"pdf-mini-table\"><tbody>' +
      buildPdfMetricRows() +
      "</tbody></table></div>" +
      "</div>" +
      (globalComment
        ? '<div class=\"pdf-callout\"><strong>Commentaire global</strong><br>' + escapeHtml(globalComment) + "</div>"
        : "") +
      '<div class=\"pdf-grid\">' +
      '<div class=\"pdf-panel\"><div class=\"pdf-section-title\">Top clients du jour</div><table class=\"pdf-mini-table\"><thead><tr><th>Client</th><th>Compte</th><th>Volume</th></tr></thead><tbody>' +
      buildPdfRankingRows(reportStats.topClients, "client") +
      "</tbody></table></div>" +
      '<div class=\"pdf-panel\"><div class=\"pdf-section-title\">Top produits du jour</div><table class=\"pdf-mini-table\"><thead><tr><th>Produit</th><th>Reference</th><th>Volume</th></tr></thead><tbody>' +
      buildPdfRankingRows(reportStats.topProducts, "product") +
      "</tbody></table></div>" +
      "</div>" +
      (visitsHtml || '<div class=\"pdf-callout\">Aucune visite trouvee pour cette date.</div>') +
      '<div class=\"pdf-footer-note\">Document KENT genere automatiquement depuis le portail commercial. Les volumes presentes correspondent aux quantites et stocks saisis sur les visites.</div>' +
      "</div>"
    );
  }

  async function chargerRapportJournalier() {
    var reportDate = document.getElementById("reportDate").value;

    if (!reportDate) {
      alert("Veuillez choisir une date.");
      return;
    }

    try {
      setStatus("Chargement des visites du jour...");
      rapportVisites = await fetchRapportVisitesByDate(reportDate);
      reportStats = calculateStats(rapportVisites);
      renderSummary(reportStats);
      renderInsights(reportStats);
      renderPreview(rapportVisites);
      setStatus(
        formatNumber(reportStats.nbVisites) +
          " visite(s), " +
          formatNumber(reportStats.nbClients) +
          " client(s) et " +
          formatNumber(reportStats.nbLignes) +
          " ligne(s) chargee(s) pour le " +
          formatDate(reportDate) +
          "."
      );
    } catch (error) {
      console.error(error);
      rapportVisites = [];
      reportStats = createEmptyStats();
      renderSummary(reportStats);
      renderInsights(reportStats);
      renderPreview([]);
      setStatus("Erreur de chargement du rapport journalier.");
      alert("Impossible de charger les visites depuis Supabase.");
    }
  }

  async function exporterPDF() {
    var reportDate = document.getElementById("reportDate").value;

    if (!reportDate) {
      alert("Veuillez choisir une date avant d'exporter le PDF.");
      return;
    }

    if (!rapportVisites.length) {
      alert("Aucune visite chargee pour cette date.");
      return;
    }

    try {
      setStatus("Generation du PDF en cours...");

      var pdfContainer = document.getElementById("pdfReport");
      pdfContainer.innerHTML = buildPdfHtml();
      pdfContainer.style.display = "block";

      var element = pdfContainer.firstElementChild;
      var safeDate = reportDate.replaceAll("-", "_");
      var filename = "rapport_journalier_" + safeDate + ".pdf";

      await window.html2pdf()
        .set({
          margin: 0,
          filename: filename,
          image: { type: "jpeg", quality: 0.96 },
          html2canvas: { scale: 1.9, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] }
        })
        .from(element)
        .save();

      pdfContainer.style.display = "none";
      setStatus("PDF genere avec succes.");
    } catch (error) {
      console.error("Erreur export PDF:", error);
      document.getElementById("pdfReport").style.display = "none";
      setStatus("Erreur pendant la generation du PDF.");
      alert("Impossible de generer le PDF.");
    }
  }

  function initPage() {
    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = String(today.getMonth() + 1).padStart(2, "0");
    var dd = String(today.getDate()).padStart(2, "0");
    document.getElementById("reportDate").value = yyyy + "-" + mm + "-" + dd;
    renderSummary(reportStats);
    renderInsights(reportStats);
    setStatus("Pret. Choisis une date puis charge les visites.");
  }

  window.chargerRapportJournalier = chargerRapportJournalier;
  window.exporterPDF = exporterPDF;

  initPage();
})();
