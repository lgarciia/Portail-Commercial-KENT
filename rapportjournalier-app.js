(function () {
  var SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";
  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var rapportVisites = [];
  var groupedClients = [];
  var reportStats = createEmptyStats();
  var currentLoadedDate = "";

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
      totalCA: 0,
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

  function safeScriptJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  function normalizeNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeColor(value) {
    var color = String(value == null ? "" : value).trim().toLowerCase();
    return ["red", "yellow", "green", "blue"].includes(color) ? color : "other";
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(normalizeNumber(value));
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(normalizeNumber(value));
  }

  function formatAverage(value) {
    return normalizeNumber(value).toLocaleString("fr-FR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
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
      blue: "Bleu",
      other: "Non defini"
    };
    return map[normalizeColor(color)] || "Non defini";
  }

  function getAssetUrl(relativePath) {
    return new URL(relativePath, window.location.href).href;
  }

  function getCommandUnitPrice(cmd) {
    var rawPrice = normalizeNumber(cmd && cmd.prix_unitaire);
    var fallbackPrice = normalizeNumber(cmd && cmd.produit && cmd.produit.prix_vente);
    return rawPrice || fallbackPrice;
  }

  function getCommandAmount(cmd) {
    return normalizeNumber(cmd && cmd.quantite) * getCommandUnitPrice(cmd);
  }

  function getVisitRevenue(visite) {
    var totalCommande = normalizeNumber(visite && visite.total_commande);
    if (totalCommande) return totalCommande;

    return (visite && visite.commandes ? visite.commandes : []).reduce(function (sum, cmd) {
      return sum + getCommandAmount(cmd);
    }, 0);
  }

  function computeVisitMetrics(visite) {
    var metrics = {
      nbLignes: 0,
      totalQuantite: 0,
      totalStock: 0,
      totalCA: getVisitRevenue(visite),
      nbRouges: 0,
      nbJaunes: 0,
      nbVerts: 0,
      nbBleus: 0
    };

    (visite.commandes || []).forEach(function (cmd) {
      var color = normalizeColor(cmd.couleur);
      metrics.nbLignes += 1;
      metrics.totalQuantite += normalizeNumber(cmd.quantite);
      metrics.totalStock += normalizeNumber(cmd.stock_client);

      if (color === "red") metrics.nbRouges += 1;
      if (color === "yellow") metrics.nbJaunes += 1;
      if (color === "green") metrics.nbVerts += 1;
      if (color === "blue") metrics.nbBleus += 1;
    });

    return metrics;
  }

  function buildColorSummary(item) {
    var parts = [];
    if (normalizeNumber(item.reds)) parts.push(formatNumber(item.reds) + "R");
    if (normalizeNumber(item.yellows)) parts.push(formatNumber(item.yellows) + "J");
    if (normalizeNumber(item.greens)) parts.push(formatNumber(item.greens) + "V");
    if (normalizeNumber(item.blues)) parts.push(formatNumber(item.blues) + "B");
    return parts.join(" / ") || "Sans priorite";
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
        " client(s) pour " +
        formatNumber(stats.nbLignes) +
        " ligne(s) produit(s), soit un CA consolide de " +
        formatCurrency(stats.totalCA) +
        "."
    );

    points.push(
      "Volume du jour : " +
        formatNumber(stats.totalQuantite) +
        " unite(s) vendues ou saisies et " +
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
        "Client leader : " +
          stats.topClients[0].name +
          " avec " +
          formatCurrency(stats.topClients[0].ca) +
          " de CA et " +
          formatNumber(stats.topClients[0].quantity) +
          " unite(s) travaillees."
      );
    }

    if (stats.topProducts.length) {
      points.push(
        "Produit principal : " +
          stats.topProducts[0].name +
          " (" +
          (stats.topProducts[0].reference || "-") +
          ") pour " +
          formatCurrency(stats.topProducts[0].ca) +
          " et " +
          formatNumber(stats.topProducts[0].quantity) +
          " unite(s)."
      );
    }

    return points;
  }

  async function fetchRapportVisitesByDate(reportDate) {
    var result = await supabaseClient
      .from("visites")
      .select(
        "id, client_id, date_visite, note, total_commande, clients ( id, nom, numero_compte, adresse, telephone ), visite_commandes ( id, produit_id, quantite, stock_client, couleur, prix_unitaire, produits ( id, nom, reference_produit, prix_vente ) )"
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
        total_commande: visite.total_commande,
        client: visite.clients || null,
        commandes: (visite.visite_commandes || []).map(function (cmd) {
          var unitPrice = normalizeNumber(cmd.prix_unitaire) || normalizeNumber(cmd.produits && cmd.produits.prix_vente);
          return {
            id: cmd.id,
            produit_id: cmd.produit_id,
            quantite: normalizeNumber(cmd.quantite),
            stock_client: normalizeNumber(cmd.stock_client),
            couleur: normalizeColor(cmd.couleur),
            prix_unitaire: unitPrice,
            montant_ligne: normalizeNumber(cmd.quantite) * unitPrice,
            produit: cmd.produits || null
          };
        })
      };
    });
  }

  function calculateReportData(visites) {
    var stats = createEmptyStats();
    var uniqueClients = new Set();
    var clientMap = new Map();
    var productMap = new Map();

    stats.nbVisites = visites.length;

    visites.forEach(function (visite) {
      var visitMetrics = computeVisitMetrics(visite);
      var clientName = visite.client && visite.client.nom ? visite.client.nom : "Client inconnu";
      var clientId =
        (visite.client && visite.client.id) ||
        (visite.client_id ? "client-" + visite.client_id : "client-" + clientName.toLowerCase().replace(/\\s+/g, "-"));

      uniqueClients.add(String(clientId));

      stats.nbLignes += visitMetrics.nbLignes;
      stats.totalQuantite += visitMetrics.totalQuantite;
      stats.totalStock += visitMetrics.totalStock;
      stats.totalCA += visitMetrics.totalCA;
      stats.nbRouges += visitMetrics.nbRouges;
      stats.nbJaunes += visitMetrics.nbJaunes;
      stats.nbVerts += visitMetrics.nbVerts;
      stats.nbBleus += visitMetrics.nbBleus;

      if (!clientMap.has(String(clientId))) {
        clientMap.set(String(clientId), {
          id: clientId,
          name: clientName,
          account: visite.client && visite.client.numero_compte ? visite.client.numero_compte : "-",
          address: visite.client && visite.client.adresse ? visite.client.adresse : "-",
          phone: visite.client && visite.client.telephone ? visite.client.telephone : "-",
          visits: 0,
          lines: 0,
          quantity: 0,
          stock: 0,
          ca: 0,
          reds: 0,
          yellows: 0,
          greens: 0,
          blues: 0,
          notes: [],
          productsMap: new Map()
        });
      }

      var clientEntry = clientMap.get(String(clientId));
      clientEntry.visits += 1;
      clientEntry.lines += visitMetrics.nbLignes;
      clientEntry.quantity += visitMetrics.totalQuantite;
      clientEntry.stock += visitMetrics.totalStock;
      clientEntry.ca += visitMetrics.totalCA;
      clientEntry.reds += visitMetrics.nbRouges;
      clientEntry.yellows += visitMetrics.nbJaunes;
      clientEntry.greens += visitMetrics.nbVerts;
      clientEntry.blues += visitMetrics.nbBleus;

      if (visite.note && String(visite.note).trim()) {
        clientEntry.notes.push({
          date: visite.date_visite,
          note: String(visite.note).trim()
        });
      }

      (visite.commandes || []).forEach(function (cmd) {
        var productName = cmd.produit && cmd.produit.nom ? cmd.produit.nom : "Produit inconnu";
        var productReference = cmd.produit && cmd.produit.reference_produit ? cmd.produit.reference_produit : "-";
        var productKey =
          (cmd.produit && cmd.produit.id) ||
          (productReference !== "-" ? productReference : productName);
        var color = normalizeColor(cmd.couleur);

        if (!clientEntry.productsMap.has(String(productKey))) {
          clientEntry.productsMap.set(String(productKey), {
            name: productName,
            reference: productReference,
            lines: 0,
            quantity: 0,
            stock: 0,
            ca: 0,
            reds: 0,
            yellows: 0,
            greens: 0,
            blues: 0
          });
        }

        var clientProduct = clientEntry.productsMap.get(String(productKey));
        clientProduct.lines += 1;
        clientProduct.quantity += normalizeNumber(cmd.quantite);
        clientProduct.stock += normalizeNumber(cmd.stock_client);
        clientProduct.ca += normalizeNumber(cmd.montant_ligne);
        if (color === "red") clientProduct.reds += 1;
        if (color === "yellow") clientProduct.yellows += 1;
        if (color === "green") clientProduct.greens += 1;
        if (color === "blue") clientProduct.blues += 1;

        if (!productMap.has(String(productKey))) {
          productMap.set(String(productKey), {
            name: productName,
            reference: productReference,
            lines: 0,
            quantity: 0,
            stock: 0,
            ca: 0,
            reds: 0,
            yellows: 0,
            greens: 0,
            blues: 0,
            clientIds: new Set()
          });
        }

        var globalProduct = productMap.get(String(productKey));
        globalProduct.lines += 1;
        globalProduct.quantity += normalizeNumber(cmd.quantite);
        globalProduct.stock += normalizeNumber(cmd.stock_client);
        globalProduct.ca += normalizeNumber(cmd.montant_ligne);
        globalProduct.clientIds.add(String(clientId));
        if (color === "red") globalProduct.reds += 1;
        if (color === "yellow") globalProduct.yellows += 1;
        if (color === "green") globalProduct.greens += 1;
        if (color === "blue") globalProduct.blues += 1;
      });
    });

    stats.nbClients = uniqueClients.size;
    stats.avgLinesPerVisit = stats.nbVisites ? stats.nbLignes / stats.nbVisites : 0;

    groupedClients = Array.from(clientMap.values())
      .map(function (client) {
        return {
          id: client.id,
          name: client.name,
          account: client.account,
          address: client.address,
          phone: client.phone,
          visits: client.visits,
          lines: client.lines,
          quantity: client.quantity,
          stock: client.stock,
          ca: client.ca,
          reds: client.reds,
          yellows: client.yellows,
          greens: client.greens,
          blues: client.blues,
          notes: client.notes.sort(function (a, b) {
            return String(a.date).localeCompare(String(b.date));
          }),
          products: Array.from(client.productsMap.values())
            .sort(function (a, b) {
              return b.ca - a.ca || b.quantity - a.quantity || a.name.localeCompare(b.name);
            })
            .map(function (product) {
              return {
                name: product.name,
                reference: product.reference,
                lines: product.lines,
                quantity: product.quantity,
                stock: product.stock,
                ca: product.ca,
                reds: product.reds,
                yellows: product.yellows,
                greens: product.greens,
                blues: product.blues
              };
            })
        };
      })
      .sort(function (a, b) {
        return b.ca - a.ca || b.quantity - a.quantity || a.name.localeCompare(b.name);
      });

    stats.topClients = groupedClients.slice(0, 5).map(function (client) {
      return {
        name: client.name,
        account: client.account,
        visits: client.visits,
        lines: client.lines,
        quantity: client.quantity,
        ca: client.ca
      };
    });

    stats.topProducts = Array.from(productMap.values())
      .map(function (product) {
        return {
          name: product.name,
          reference: product.reference,
          lines: product.lines,
          quantity: product.quantity,
          ca: product.ca,
          clients: product.clientIds.size,
          reds: product.reds,
          yellows: product.yellows,
          greens: product.greens,
          blues: product.blues
        };
      })
      .sort(function (a, b) {
        return b.ca - a.ca || b.quantity - a.quantity || a.name.localeCompare(b.name);
      })
      .slice(0, 5);

    stats.executivePoints = buildExecutivePoints(stats);

    return {
      stats: stats,
      clients: groupedClients
    };
  }

  function renderSummary(stats) {
    var mapping = {
      summaryVisites: formatNumber(stats.nbVisites),
      summaryClients: formatNumber(stats.nbClients),
      summaryLignes: formatNumber(stats.nbLignes),
      summaryQuantite: formatNumber(stats.totalQuantite),
      summaryCA: formatCurrency(stats.totalCA),
      summaryStock: formatNumber(stats.totalStock),
      summaryRouges: formatNumber(stats.nbRouges),
      summaryJaunes: formatNumber(stats.nbJaunes),
      summaryVerts: formatNumber(stats.nbVerts)
    };

    Object.keys(mapping).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = mapping[id];
    });
  }

  function renderRankingRows(items, type) {
    if (!items.length) {
      return '<div class="analysis-item">Aucune donnee disponible pour cette date.</div>';
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
              formatNumber(item.lines) +
              " · Qte : " +
              formatNumber(item.quantity)
            : "Ref : " +
              escapeHtml(item.reference || "-") +
              " · Lignes : " +
              formatNumber(item.lines) +
              " · Qte : " +
              formatNumber(item.quantity) +
              " · Clients : " +
              formatNumber(item.clients);

        return (
          '<div class="ranking-row">' +
          '<div class="ranking-main">' +
          '<div class="ranking-name">' +
          (index + 1) +
          ". " +
          escapeHtml(item.name) +
          "</div>" +
          '<div class="ranking-meta">' +
          meta +
          "</div>" +
          "</div>" +
          '<div class="ranking-value">' +
          escapeHtml(formatCurrency(item.ca)) +
          "</div>" +
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
            return '<div class="analysis-item">' + escapeHtml(point) + "</div>";
          })
          .join("") || '<div class="analysis-item">Aucune synthese disponible.</div>';
    }

    if (clientsNode) clientsNode.innerHTML = renderRankingRows(stats.topClients, "client");
    if (productsNode) productsNode.innerHTML = renderRankingRows(stats.topProducts, "product");
  }

  function buildProductRowsHtml(products) {
    if (!products.length) {
      return '<div class="empty-state" style="padding: 18px 0;">Aucune ligne produit saisie pour ce client.</div>';
    }

    return products
      .map(function (product) {
        return (
          '<div class="client-product-row">' +
          '<div class="client-product-main">' +
          '<div class="client-product-name">' +
          escapeHtml(product.name) +
          "</div>" +
          '<div class="client-product-meta">Ref : ' +
          escapeHtml(product.reference || "-") +
          " · Lignes : " +
          formatNumber(product.lines) +
          " · Priorites : " +
          escapeHtml(buildColorSummary(product)) +
          "</div>" +
          "</div>" +
          '<div class="client-product-value"><small>Quantite</small>' +
          formatNumber(product.quantity) +
          "</div>" +
          '<div class="client-product-value"><small>Stock</small>' +
          formatNumber(product.stock) +
          "</div>" +
          '<div class="client-product-value"><small>CA</small>' +
          escapeHtml(formatCurrency(product.ca)) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function buildNotesHtml(notes) {
    if (!notes.length) return "";

    return (
      '<div class="client-notes-title">Notes terrain</div>' +
      '<div class="client-note-list">' +
      notes
        .map(function (entry) {
          return (
            '<div class="client-note-item">' +
            '<span class="client-note-date">' +
            escapeHtml(formatDate(entry.date)) +
            "</span>" +
            escapeHtml(entry.note) +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderPreview(clients) {
    var container = document.getElementById("previewList");
    if (!container) return;

    if (!clients.length) {
      container.innerHTML =
        '<div class="empty-state">' +
        (currentLoadedDate
          ? "Aucune visite trouvee pour cette date."
          : 'Choisis une date puis clique sur "Charger les visites".') +
        "</div>";
      return;
    }

    container.innerHTML = clients
      .map(function (client) {
        return (
          '<div class="client-report-card">' +
          '<div class="client-report-head">' +
          "<div>" +
          '<div class="client-report-name">' +
          escapeHtml(client.name) +
          "</div>" +
          '<div class="client-report-meta">Compte : ' +
          escapeHtml(client.account || "-") +
          "<br>Telephone : " +
          escapeHtml(client.phone || "-") +
          "<br>Adresse : " +
          escapeHtml(client.address || "-") +
          "</div>" +
          "</div>" +
          '<div class="client-report-totals">' +
          '<div class="client-report-amount">' +
          escapeHtml(formatCurrency(client.ca)) +
          "</div>" +
          '<div class="client-report-caption">CA du jour</div>' +
          "</div>" +
          "</div>" +
          '<div class="client-report-stats">' +
          '<span class="visit-stat-chip">Visites : ' +
          formatNumber(client.visits) +
          "</span>" +
          '<span class="visit-stat-chip">Lignes : ' +
          formatNumber(client.lines) +
          "</span>" +
          '<span class="visit-stat-chip">Quantite : ' +
          formatNumber(client.quantity) +
          "</span>" +
          '<span class="visit-stat-chip">Stock : ' +
          formatNumber(client.stock) +
          "</span>" +
          '<span class="visit-stat-chip">Rouges : ' +
          formatNumber(client.reds) +
          "</span>" +
          '<span class="visit-stat-chip">Verts : ' +
          formatNumber(client.greens) +
          "</span>" +
          "</div>" +
          '<div class="client-products-title">Detail vendu</div>' +
          '<div class="client-report-products">' +
          buildProductRowsHtml(client.products) +
          "</div>" +
          buildNotesHtml(client.notes) +
          "</div>"
        );
      })
      .join("");
  }

  function getReportInputs() {
    return {
      reportDate: document.getElementById("reportDate").value,
      commercialName: (document.getElementById("commercialName").value || "").trim() || "Non renseigne",
      reportTitle: (document.getElementById("reportTitle").value || "").trim() || "Rapport journalier des visites",
      globalComment: (document.getElementById("globalComment").value || "").trim()
    };
  }

  function buildCopyText() {
    var inputs = getReportInputs();
    var lines = [];

    lines.push(inputs.reportTitle);
    lines.push("Date : " + formatDateLong(inputs.reportDate));
    lines.push("Commercial : " + inputs.commercialName);
    lines.push("");
    lines.push("Synthese :");
    lines.push("- Visites : " + formatNumber(reportStats.nbVisites));
    lines.push("- Clients : " + formatNumber(reportStats.nbClients));
    lines.push("- Lignes produits : " + formatNumber(reportStats.nbLignes));
    lines.push("- Quantite totale : " + formatNumber(reportStats.totalQuantite));
    lines.push("- Stock observe : " + formatNumber(reportStats.totalStock));
    lines.push("- CA du jour : " + formatCurrency(reportStats.totalCA));
    lines.push("- Alertes rouges : " + formatNumber(reportStats.nbRouges));
    lines.push("- Vigilances jaunes : " + formatNumber(reportStats.nbJaunes));
    lines.push("- Opportunites vertes : " + formatNumber(reportStats.nbVerts));

    if (inputs.globalComment) {
      lines.push("");
      lines.push("Commentaire global :");
      lines.push(inputs.globalComment);
    }

    if (reportStats.executivePoints.length) {
      lines.push("");
      lines.push("Lecture commerciale :");
      reportStats.executivePoints.forEach(function (point) {
        lines.push("- " + point);
      });
    }

    lines.push("");
    lines.push("Detail par client :");

    if (!groupedClients.length) {
      lines.push("- Aucune visite sur cette date.");
    } else {
      groupedClients.forEach(function (client) {
        lines.push(
          "- " +
            client.name +
            " (Compte " +
            client.account +
            ") : Visites " +
            formatNumber(client.visits) +
            " | Lignes " +
            formatNumber(client.lines) +
            " | Quantite " +
            formatNumber(client.quantity) +
            " | Stock " +
            formatNumber(client.stock) +
            " | CA " +
            formatCurrency(client.ca)
        );

        if (client.products.length) {
          client.products.forEach(function (product) {
            lines.push(
              "  - " +
                product.name +
                " [" +
                product.reference +
                "] : Qte " +
                formatNumber(product.quantity) +
                " | Stock " +
                formatNumber(product.stock) +
                " | CA " +
                formatCurrency(product.ca) +
                " | Priorites " +
                buildColorSummary(product)
            );
          });
        } else {
          lines.push("  - Aucun produit saisi.");
        }

        client.notes.forEach(function (note) {
          lines.push("  - Note " + formatDate(note.date) + " : " + note.note);
        });
      });
    }

    return lines.join("\n");
  }

  function buildPreviewSummaryHtml() {
    return (
      '<div class="preview-summary-grid">' +
      buildPreviewSummaryCard("Visites", formatNumber(reportStats.nbVisites)) +
      buildPreviewSummaryCard("Clients", formatNumber(reportStats.nbClients)) +
      buildPreviewSummaryCard("Lignes produits", formatNumber(reportStats.nbLignes)) +
      buildPreviewSummaryCard("Quantite totale", formatNumber(reportStats.totalQuantite)) +
      buildPreviewSummaryCard("Stock observe", formatNumber(reportStats.totalStock)) +
      buildPreviewSummaryCard("CA du jour", formatCurrency(reportStats.totalCA)) +
      "</div>"
    );
  }

  function buildPreviewSummaryCard(label, value) {
    return (
      '<div class="preview-chip">' +
      '<div class="preview-chip-label">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="preview-chip-value">' +
      escapeHtml(value) +
      "</div>" +
      "</div>"
    );
  }

  function buildPreviewWindowClientHtml(client) {
    return (
      '<section class="preview-client-card">' +
      '<div class="preview-client-head">' +
      "<div>" +
      '<div class="preview-client-name">' +
      escapeHtml(client.name) +
      "</div>" +
      '<div class="preview-client-meta">Compte : ' +
      escapeHtml(client.account || "-") +
      " · Telephone : " +
      escapeHtml(client.phone || "-") +
      "<br>Adresse : " +
      escapeHtml(client.address || "-") +
      "</div>" +
      "</div>" +
      '<div class="preview-client-ca">' +
      '<div class="preview-client-ca-value">' +
      escapeHtml(formatCurrency(client.ca)) +
      "</div>" +
      '<div class="preview-client-ca-label">CA du jour</div>' +
      "</div>" +
      "</div>" +
      '<div class="preview-stat-row">' +
      buildPreviewStat("Visites", formatNumber(client.visits)) +
      buildPreviewStat("Lignes", formatNumber(client.lines)) +
      buildPreviewStat("Quantite", formatNumber(client.quantity)) +
      buildPreviewStat("Stock", formatNumber(client.stock)) +
      buildPreviewStat("Rouges", formatNumber(client.reds)) +
      buildPreviewStat("Verts", formatNumber(client.greens)) +
      "</div>" +
      '<div class="preview-subtitle">Detail vendu</div>' +
      buildPreviewWindowProductTable(client.products) +
      (client.notes.length
        ? '<div class="preview-subtitle" style="margin-top: 18px;">Notes terrain</div>' +
          '<div class="preview-note-list">' +
          client.notes
            .map(function (note) {
              return (
                '<div class="preview-note-item"><strong>' +
                escapeHtml(formatDate(note.date)) +
                " :</strong> " +
                escapeHtml(note.note) +
                "</div>"
              );
            })
            .join("") +
          "</div>"
        : "") +
      "</section>"
    );
  }

  function buildPreviewStat(label, value) {
    return (
      '<div class="preview-stat">' +
      '<span class="preview-stat-label">' +
      escapeHtml(label) +
      "</span>" +
      '<span class="preview-stat-value">' +
      escapeHtml(value) +
      "</span>" +
      "</div>"
    );
  }

  function buildPreviewWindowProductTable(products) {
    if (!products.length) {
      return '<div class="preview-empty">Aucune ligne produit saisie pour ce client.</div>';
    }

    return (
      '<div class="preview-table-wrap"><table class="preview-table">' +
      "<thead><tr><th>Produit</th><th>Qte</th><th>Stock</th><th>CA</th></tr></thead>" +
      "<tbody>" +
      products
        .map(function (product) {
          return (
            "<tr>" +
            "<td>" +
            '<div class="preview-product-name">' +
            escapeHtml(product.name) +
            "</div>" +
            '<div class="preview-product-meta">Ref : ' +
            escapeHtml(product.reference || "-") +
            " · Lignes : " +
            formatNumber(product.lines) +
            " · Priorites : " +
            escapeHtml(buildColorSummary(product)) +
            "</div>" +
            "</td>" +
            '<td class="num-cell">' +
            formatNumber(product.quantity) +
            "</td>" +
            '<td class="num-cell">' +
            formatNumber(product.stock) +
            "</td>" +
            '<td class="num-cell">' +
            escapeHtml(formatCurrency(product.ca)) +
            "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function buildPreviewRanking(items, type) {
    if (!items.length) {
      return '<div class="preview-ranking-row"><div><div class="preview-ranking-name">Aucune donnee</div><div class="preview-ranking-meta">Aucun element disponible sur cette date.</div></div></div>';
    }

    return items
      .slice(0, 3)
      .map(function (item, index) {
        var meta =
          type === "client"
            ? "Compte : " +
              escapeHtml(item.account || "-") +
              " · Visites : " +
              formatNumber(item.visits) +
              " · Qte : " +
              formatNumber(item.quantity)
            : "Ref : " +
              escapeHtml(item.reference || "-") +
              " · Lignes : " +
              formatNumber(item.lines) +
              " · Qte : " +
              formatNumber(item.quantity);

        return (
          '<div class="preview-ranking-row">' +
          "<div>" +
          '<div class="preview-ranking-name">' +
          (type === "client" ? "Client " : "Produit ") +
          (index + 1) +
          " · " +
          escapeHtml(item.name) +
          "</div>" +
          '<div class="preview-ranking-meta">' +
          meta +
          "</div>" +
          "</div>" +
          '<div class="preview-ranking-value">' +
          escapeHtml(formatCurrency(item.ca)) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function buildPreviewWindowHtml() {
    var inputs = getReportInputs();
    var logoUrl = getAssetUrl("./kent-logo.svg");
    var copyText = buildCopyText();
    var executiveHtml = reportStats.executivePoints.length
      ? reportStats.executivePoints
          .map(function (point) {
            return "<li>" + escapeHtml(point) + "</li>";
          })
          .join("")
      : "<li>Aucune synthese disponible.</li>";
    var clientRowsHtml = groupedClients.length
      ? groupedClients
          .map(function (client) {
            return (
              "<tr>" +
              "<td><strong>" +
              escapeHtml(client.name) +
              "</strong><br><span class=\"muted\">Compte : " +
              escapeHtml(client.account || "-") +
              "</span></td>" +
              "<td class=\"num\">" +
              formatNumber(client.visits) +
              "</td>" +
              "<td class=\"num\">" +
              formatNumber(client.lines) +
              "</td>" +
              "<td class=\"num\">" +
              formatNumber(client.quantity) +
              "</td>" +
              "<td class=\"num\">" +
              formatNumber(client.stock) +
              "</td>" +
              "<td class=\"num\">" +
              escapeHtml(formatCurrency(client.ca)) +
              "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="6">Aucune visite chargee pour cette date.</td></tr>';
    var notesHtml = groupedClients
      .filter(function (client) {
        return client.notes && client.notes.length;
      })
      .map(function (client) {
        return client.notes
          .map(function (note) {
            return (
              '<div class="note-item"><strong>' +
              escapeHtml(client.name) +
              " - " +
              escapeHtml(formatDate(note.date)) +
              " :</strong> " +
              escapeHtml(note.note) +
              "</div>"
            );
          })
          .join("");
      })
      .join("");

    return (
      "<!DOCTYPE html>" +
      '<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      "<title>" +
      escapeHtml(inputs.reportTitle) +
      "</title>" +
      "<style>" +
      "body{margin:0;background:#f8fafc;color:#0f172a;font-family:'Segoe UI',Roboto,sans-serif;}" +
      ".shell{max-width:1200px;margin:0 auto;padding:28px 24px 48px;}" +
      ".header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:24px;padding:24px;border-radius:20px;background:#ffffff;border:1px solid #dbe4f0;box-shadow:0 18px 40px rgba(15,23,42,.08);}" +
      ".brand{display:flex;gap:16px;align-items:center;}" +
      ".logo{width:60px;height:60px;border-radius:18px;background:#ffffff;border:1px solid #dbe4f0;display:flex;align-items:center;justify-content:center;overflow:hidden;}" +
      ".logo img{width:40px;height:40px;display:block;}" +
      ".kicker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#2563eb;font-weight:800;margin-bottom:6px;}" +
      ".title{font-size:30px;font-weight:800;line-height:1.05;margin:0 0 8px;color:#0f172a;}" +
      ".subtext{margin:0;color:#475569;line-height:1.6;font-size:15px;}" +
      ".meta{color:#334155;font-size:14px;line-height:1.7;text-align:right;}" +
      ".actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-top:14px;}" +
      ".action{border:none;border-radius:14px;padding:12px 16px;font-weight:700;font-size:14px;cursor:pointer;background:#0f8bff;color:#fff;}" +
      ".action.secondary{background:#ffffff;color:#0f172a;border:1px solid #cbd5e1;}" +
      ".copy-status{min-height:20px;color:#2563eb;font-size:13px;font-weight:700;}" +
      ".section{margin-bottom:20px;padding:22px;border-radius:20px;background:#ffffff;border:1px solid #dbe4f0;box-shadow:0 12px 30px rgba(15,23,42,.05);}" +
      ".section-title{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#2563eb;font-weight:800;margin-bottom:14px;}" +
      ".summary-table,.client-table{width:100%;border-collapse:collapse;}" +
      ".summary-table th,.summary-table td,.client-table th,.client-table td{padding:12px 14px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;}" +
      ".summary-table th,.client-table th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#475569;background:#f8fafc;}" +
      ".summary-table td,.client-table td{font-size:14px;color:#0f172a;}" +
      ".client-table .num{text-align:right;white-space:nowrap;font-weight:700;}" +
      ".bullets{margin:0;padding-left:18px;color:#334155;line-height:1.7;}" +
      ".bullets li+li{margin-top:8px;}" +
      ".muted{color:#64748b;font-size:12px;}" +
      ".note-item{padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;line-height:1.65;}" +
      ".note-item + .note-item{margin-top:10px;}" +
      "@media (max-width:760px){.shell{padding:20px 14px 34px;}.title{font-size:24px;}.meta{text-align:left;}.actions{justify-content:flex-start;}.client-table .num{text-align:left;}}" +
      "</style></head><body>" +
      '<div class="shell">' +
      '<header class="header">' +
      '<div class="brand">' +
      '<div class="logo"><img src="' +
      logoUrl +
      '" alt="KENT"></div>' +
      "<div>" +
      '<div class="kicker">Portail commercial KENT</div>' +
      '<h1 class="title">' +
      escapeHtml(inputs.reportTitle) +
      "</h1>" +
      '<p class="subtext">Vue de synthese du rapport journalier avec chiffres globaux et recapitulatif par client.</p>' +
      "</div></div>" +
      "<div>" +
      '<div class="meta">Date : ' +
      escapeHtml(formatDateLong(inputs.reportDate)) +
      "<br>Commercial : " +
      escapeHtml(inputs.commercialName) +
      "<br>Visites consolidees : " +
      escapeHtml(formatNumber(reportStats.nbVisites)) +
      "</div>" +
      '<div class="actions">' +
      '<button id="copyReportButton" class="action" type="button">Copier le rapport</button>' +
      '<button class="action secondary" type="button" onclick="window.print()">Imprimer</button>' +
      "</div>" +
      '<div id="copyStatus" class="copy-status"></div>' +
      "</div></header>" +
      '<section class="section">' +
      '<div class="section-title">Synthese du jour</div>' +
      '<table class="summary-table"><tbody>' +
      "<tr><th>Nombre de visites</th><td>" + escapeHtml(formatNumber(reportStats.nbVisites)) + "</td></tr>" +
      "<tr><th>Clients visites</th><td>" + escapeHtml(formatNumber(reportStats.nbClients)) + "</td></tr>" +
      "<tr><th>Lignes produits</th><td>" + escapeHtml(formatNumber(reportStats.nbLignes)) + "</td></tr>" +
      "<tr><th>Quantite totale</th><td>" + escapeHtml(formatNumber(reportStats.totalQuantite)) + "</td></tr>" +
      "<tr><th>Stock observe</th><td>" + escapeHtml(formatNumber(reportStats.totalStock)) + "</td></tr>" +
      "<tr><th>CA du jour</th><td>" + escapeHtml(formatCurrency(reportStats.totalCA)) + "</td></tr>" +
      "<tr><th>Alertes rouges</th><td>" + escapeHtml(formatNumber(reportStats.nbRouges)) + "</td></tr>" +
      "<tr><th>Vigilances jaunes</th><td>" + escapeHtml(formatNumber(reportStats.nbJaunes)) + "</td></tr>" +
      "<tr><th>Opportunites vertes</th><td>" + escapeHtml(formatNumber(reportStats.nbVerts)) + "</td></tr>" +
      "</tbody></table>" +
      (inputs.globalComment
        ? '<div class="note-item" style="margin-top:14px;"><strong>Commentaire global :</strong> ' + escapeHtml(inputs.globalComment) + "</div>"
        : "") +
      "</section>" +
      '<section class="section">' +
      '<div class="section-title">Lecture commerciale</div><ul class="bullets">' +
      executiveHtml +
      "</ul>" +
      "</section>" +
      '<section class="section"><div class="section-title">Recapitulatif par client</div>' +
      '<table class="client-table"><thead><tr><th>Client</th><th>Visites</th><th>Lignes</th><th>Quantite</th><th>Stock</th><th>CA</th></tr></thead><tbody>' +
      clientRowsHtml +
      "</tbody></table>" +
      "</section>" +
      (notesHtml
        ? '<section class="section"><div class="section-title">Notes terrain</div>' + notesHtml + "</section>"
        : "") +
      "</div>" +
      "<script>" +
      "var reportText = " +
      safeScriptJson(copyText) +
      ";" +
      "var copyButton = document.getElementById('copyReportButton');" +
      "var copyStatus = document.getElementById('copyStatus');" +
      "copyButton.addEventListener('click', async function () {" +
      "try { await navigator.clipboard.writeText(reportText); copyStatus.textContent = 'Rapport copie dans le presse-papiers.'; }" +
      "catch (error) {" +
      "var area = document.createElement('textarea'); area.value = reportText; document.body.appendChild(area); area.select();" +
      "document.execCommand('copy'); document.body.removeChild(area); copyStatus.textContent = 'Rapport copie dans le presse-papiers.'; }" +
      "});" +
      "</script>" +
      "</body></html>"
    );
  }

  function buildPdfStyles() {
    return (
      "<style>" +
      ".pdf-root,.pdf-root *{box-sizing:border-box;color:#0f172a;font-family:Arial,Helvetica,sans-serif;}" +
      ".pdf-root{width:190mm;padding:10mm 9mm 10mm;background:#ffffff;}" +
      ".pdf-header{display:flex;justify-content:space-between;gap:8mm;align-items:flex-start;padding-bottom:5mm;margin-bottom:6mm;border-bottom:2px solid #0f8bff;}" +
      ".pdf-brand{display:flex;gap:4mm;align-items:center;}" +
      ".pdf-logo{width:16mm;height:16mm;border:1px solid #d7e3f2;border-radius:4mm;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;}" +
      ".pdf-logo img{width:10mm;height:10mm;display:block;}" +
      ".pdf-kicker{font-size:8px;letter-spacing:.18em;text-transform:uppercase;color:#2563eb;font-weight:700;margin-bottom:1.5mm;}" +
      ".pdf-title{font-size:18px;line-height:1.05;font-weight:700;margin:0 0 1.5mm;color:#0b2540;}" +
      ".pdf-subtitle{font-size:9px;line-height:1.5;color:#475569;}" +
      ".pdf-meta{font-size:9px;line-height:1.6;text-align:right;color:#334155;min-width:50mm;}" +
      ".pdf-section{margin-bottom:5mm;}" +
      ".pdf-section-title{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:700;margin-bottom:2mm;}" +
      ".pdf-table{width:100%;border-collapse:collapse;}" +
      ".pdf-table th,.pdf-table td{border:1px solid #e2e8f0;padding:2.5mm 2.2mm;text-align:left;vertical-align:top;font-size:8.5px;color:#334155;}" +
      ".pdf-table th{background:#f8fafc;color:#475569;font-weight:700;}" +
      ".pdf-table .num{text-align:right;white-space:nowrap;}" +
      ".pdf-bullets{margin:0;padding-left:4mm;}" +
      ".pdf-bullets li{font-size:8.5px;line-height:1.55;color:#334155;}" +
      ".pdf-bullets li+li{margin-top:1.2mm;}" +
      ".pdf-note{padding:3mm;border:1px solid #e2e8f0;background:#f8fafc;font-size:8.5px;line-height:1.55;color:#334155;margin-top:2mm;}" +
      ".pdf-note + .pdf-note{margin-top:2mm;}" +
      ".pdf-footer{margin-top:6mm;font-size:7.5px;line-height:1.55;text-align:center;color:#64748b;}" +
      "</style>"
    );
  }

  function buildPdfMetricRows() {
    var rows = [
      ["CA du jour", formatCurrency(reportStats.totalCA)],
      ["Quantite totale", formatNumber(reportStats.totalQuantite) + " unite(s)"],
      ["Stock observe", formatNumber(reportStats.totalStock) + " unite(s)"],
      ["Moyenne lignes / visite", formatAverage(reportStats.avgLinesPerVisit)],
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
      return '<tr><td colspan="3">Aucune donnee exploitable.</td></tr>';
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
          escapeHtml(formatCurrency(item.ca)) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function buildPdfClientBlocks() {
    if (!groupedClients.length) {
      return '<div class="pdf-callout">Aucune visite trouvee pour cette date.</div>';
    }

    return groupedClients
      .map(function (client) {
        var productsHtml = client.products.length
          ? '<table class="pdf-product-table"><thead><tr><th>Produit</th><th class="qty">Qte</th><th class="stock">Stock</th><th class="ca">CA</th></tr></thead><tbody>' +
            client.products
              .map(function (product) {
                return (
                  "<tr>" +
                  "<td>" +
                  '<div class="pdf-product-name">' +
                  escapeHtml(product.name) +
                  "</div>" +
                  '<div class="pdf-product-meta">Ref : ' +
                  escapeHtml(product.reference || "-") +
                  " · Lignes : " +
                  formatNumber(product.lines) +
                  " · Priorites : " +
                  escapeHtml(buildColorSummary(product)) +
                  "</div>" +
                  "</td>" +
                  '<td class="qty">' +
                  formatNumber(product.quantity) +
                  "</td>" +
                  '<td class="stock">' +
                  formatNumber(product.stock) +
                  "</td>" +
                  '<td class="ca">' +
                  escapeHtml(formatCurrency(product.ca)) +
                  "</td>" +
                  "</tr>"
                );
              })
              .join("") +
            "</tbody></table>"
          : '<div class="pdf-note">Aucun produit saisi pour ce client.</div>';

        var notesHtml = client.notes.length
          ? '<div class="pdf-note-list">' +
            client.notes
              .map(function (note) {
                return '<div class="pdf-note"><strong>' + escapeHtml(formatDate(note.date)) + " :</strong> " + escapeHtml(note.note) + "</div>";
              })
              .join("") +
            "</div>"
          : "";

        return (
          '<section class="pdf-client">' +
          '<div class="pdf-client-head">' +
          "<div>" +
          '<div class="pdf-client-name">' +
          escapeHtml(client.name) +
          "</div>" +
          '<div class="pdf-client-meta">Compte : ' +
          escapeHtml(client.account || "-") +
          " · Telephone : " +
          escapeHtml(client.phone || "-") +
          "<br>Adresse : " +
          escapeHtml(client.address || "-") +
          "</div>" +
          "</div>" +
          '<div class="pdf-client-ca">' +
          '<div class="pdf-client-ca-value">' +
          escapeHtml(formatCurrency(client.ca)) +
          "</div>" +
          '<div class="pdf-client-ca-label">CA du jour</div>' +
          "</div>" +
          "</div>" +
          '<div class="pdf-client-stats">' +
          '<span class="pdf-stat">Visites : ' +
          formatNumber(client.visits) +
          "</span>" +
          '<span class="pdf-stat">Lignes : ' +
          formatNumber(client.lines) +
          "</span>" +
          '<span class="pdf-stat">Qte : ' +
          formatNumber(client.quantity) +
          "</span>" +
          '<span class="pdf-stat">Stock : ' +
          formatNumber(client.stock) +
          "</span>" +
          '<span class="pdf-stat">Rouges : ' +
          formatNumber(client.reds) +
          "</span>" +
          '<span class="pdf-stat">Verts : ' +
          formatNumber(client.greens) +
          "</span>" +
          "</div>" +
          '<div class="pdf-subsection">Detail vendu</div>' +
          productsHtml +
          (notesHtml ? '<div class="pdf-subsection" style="margin-top:3mm;">Notes terrain</div>' + notesHtml : "") +
          "</section>"
        );
      })
      .join("");
  }

  function buildPdfHtml() {
    var inputs = getReportInputs();
    var logoUrl = getAssetUrl("./kent-logo.svg");
    var executiveHtml = reportStats.executivePoints.length
      ? reportStats.executivePoints
          .map(function (point) {
            return "<li>" + escapeHtml(point) + "</li>";
          })
          .join("")
      : "<li>Aucune synthese disponible.</li>";

    var clientRowsHtml = groupedClients.length
      ? groupedClients
          .map(function (client) {
            return (
              "<tr>" +
              "<td><strong>" +
              escapeHtml(client.name) +
              "</strong><br>Compte : " +
              escapeHtml(client.account || "-") +
              "</td>" +
              '<td class="num">' +
              formatNumber(client.visits) +
              "</td>" +
              '<td class="num">' +
              formatNumber(client.lines) +
              "</td>" +
              '<td class="num">' +
              formatNumber(client.quantity) +
              "</td>" +
              '<td class="num">' +
              formatNumber(client.stock) +
              "</td>" +
              '<td class="num">' +
              escapeHtml(formatCurrency(client.ca)) +
              "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="6">Aucune visite trouvee pour cette date.</td></tr>';

    var notesHtml = groupedClients
      .filter(function (client) {
        return client.notes && client.notes.length;
      })
      .map(function (client) {
        return client.notes
          .map(function (note) {
            return (
              '<div class="pdf-note"><strong>' +
              escapeHtml(client.name) +
              " - " +
              escapeHtml(formatDate(note.date)) +
              " :</strong> " +
              escapeHtml(note.note) +
              "</div>"
            );
          })
          .join("");
      })
      .join("");

    return (
      '<div class="pdf-root">' +
      buildPdfStyles() +
      '<div class="pdf-header">' +
      '<div class="pdf-brand">' +
      '<div class="pdf-logo"><img src="' +
      logoUrl +
      '" alt="KENT"></div>' +
      "<div>" +
      '<div class="pdf-kicker">Portail commercial KENT</div>' +
      '<h1 class="pdf-title">' +
      escapeHtml(inputs.reportTitle) +
      "</h1>" +
      '<div class="pdf-subtitle">Rapport journalier de synthese avec les indicateurs globaux et le recapitulatif par client.</div>' +
      "</div>" +
      "</div>" +
      '<div class="pdf-meta">Date : ' +
      escapeHtml(formatDateLong(inputs.reportDate)) +
      "<br>Commercial : " +
      escapeHtml(inputs.commercialName) +
      "<br>Visites consolidees : " +
      escapeHtml(formatNumber(reportStats.nbVisites)) +
      "</div>" +
      "</div>" +
      '<div class="pdf-section"><div class="pdf-section-title">Synthese du jour</div><table class="pdf-table"><tbody>' +
      buildPdfMetricRows() +
      "</tbody></table>" +
      (inputs.globalComment
        ? '<div class="pdf-note"><strong>Commentaire global :</strong> ' + escapeHtml(inputs.globalComment) + "</div>"
        : "") +
      "</div>" +
      '<div class="pdf-section"><div class="pdf-section-title">Lecture commerciale</div><ul class="pdf-bullets">' +
      executiveHtml +
      "</ul></div>" +
      '<div class="pdf-section"><div class="pdf-section-title">Recapitulatif par client</div><table class="pdf-table"><thead><tr><th>Client</th><th>Visites</th><th>Lignes</th><th>Quantite</th><th>Stock</th><th>CA</th></tr></thead><tbody>' +
      clientRowsHtml +
      "</tbody></table></div>" +
      (notesHtml
        ? '<div class="pdf-section"><div class="pdf-section-title">Notes terrain</div>' + notesHtml + "</div>"
        : "") +
      '<div class="pdf-footer">Document KENT genere automatiquement depuis le portail commercial.</div>' +
      "</div>"
    );
  }

  function buildPreviewLoadingHtml() {
    return (
      "<!DOCTYPE html>" +
      '<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      "<title>Chargement du rapport</title>" +
      "<style>" +
      "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font-family:'Segoe UI',Roboto,sans-serif;}" +
      ".loading{padding:28px 32px;border-radius:20px;background:#ffffff;border:1px solid #dbe4f0;box-shadow:0 18px 40px rgba(15,23,42,.08);text-align:center;}" +
      ".loading strong{display:block;font-size:18px;margin-bottom:10px;}" +
      ".loading span{color:#475569;line-height:1.6;}" +
      "</style></head><body>" +
      '<div class="loading"><strong>Chargement du rapport...</strong><span>Preparation de la visualisation KENT en cours.</span></div>' +
      "</body></html>"
    );
  }

  async function chargerRapportJournalier() {
    var reportDate = document.getElementById("reportDate").value;

    if (!reportDate) {
      alert("Veuillez choisir une date.");
      return false;
    }

    try {
      setStatus("Chargement des visites du jour...");
      rapportVisites = await fetchRapportVisitesByDate(reportDate);

      var reportData = calculateReportData(rapportVisites);
      reportStats = reportData.stats;
      groupedClients = reportData.clients;
      currentLoadedDate = reportDate;

      renderSummary(reportStats);
      renderInsights(reportStats);
      renderPreview(groupedClients);

      setStatus(
        formatNumber(reportStats.nbVisites) +
          " visite(s), " +
          formatNumber(reportStats.nbClients) +
          " client(s), " +
          formatNumber(reportStats.nbLignes) +
          " ligne(s) et " +
          formatCurrency(reportStats.totalCA) +
          " charges pour le " +
          formatDate(reportDate) +
          "."
      );

      return true;
    } catch (error) {
      console.error(error);
      rapportVisites = [];
      groupedClients = [];
      reportStats = createEmptyStats();
      currentLoadedDate = "";
      renderSummary(reportStats);
      renderInsights(reportStats);
      renderPreview([]);
      setStatus("Erreur de chargement du rapport journalier.");
      alert("Impossible de charger les visites depuis Supabase.");
      return false;
    }
  }

  async function ensureReportLoaded() {
    var reportDate = document.getElementById("reportDate").value;

    if (!reportDate) {
      alert("Veuillez choisir une date.");
      return false;
    }

    if (currentLoadedDate === reportDate) {
      return true;
    }

    return chargerRapportJournalier();
  }

  async function visualiserRapport() {
    var previewWindow = window.open("", "_blank", "width=1480,height=960");
    if (!previewWindow) {
      alert("Impossible d'ouvrir la fenetre de visualisation. Verifie le bloqueur de pop-up.");
      return;
    }

    previewWindow.document.open();
    previewWindow.document.write(buildPreviewLoadingHtml());
    previewWindow.document.close();

    var ready = await ensureReportLoaded();
    if (!ready) {
      previewWindow.close();
      return;
    }

    previewWindow.document.open();
    previewWindow.document.write(buildPreviewWindowHtml());
    previewWindow.document.close();

    setStatus("Apercu du rapport ouvert dans une nouvelle fenetre.");
  }

  async function exporterPDF() {
    var reportDate = document.getElementById("reportDate").value;

    if (!reportDate) {
      alert("Veuillez choisir une date avant d'exporter le PDF.");
      return;
    }

    var ready = await ensureReportLoaded();
    if (!ready) return;

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
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
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
    renderPreview([]);
    setStatus("Pret. Choisis une date puis charge les visites.");
  }

  window.chargerRapportJournalier = chargerRapportJournalier;
  window.visualiserRapport = visualiserRapport;
  window.exporterPDF = exporterPDF;

  initPage();
})();
