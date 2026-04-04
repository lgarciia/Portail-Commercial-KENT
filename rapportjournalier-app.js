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
    var clientsHtml = groupedClients.length
      ? groupedClients.map(buildPreviewWindowClientHtml).join("")
      : '<div class="preview-empty big">Aucune visite chargee pour cette date.</div>';

    return (
      "<!DOCTYPE html>" +
      '<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      "<title>" +
      escapeHtml(inputs.reportTitle) +
      "</title>" +
      "<style>" +
      "body{margin:0;background:#0b1020;color:#e5edf8;font-family:'Segoe UI',Roboto,sans-serif;}" +
      ".preview-shell{max-width:1380px;margin:0 auto;padding:28px 24px 48px;}" +
      ".preview-header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:24px;padding:22px 24px;border-radius:24px;background:linear-gradient(135deg,#10203d,#0f172a 62%,#081120);border:1px solid rgba(148,163,184,.18);box-shadow:0 28px 60px rgba(0,0,0,.35);}" +
      ".preview-brand{display:flex;gap:16px;align-items:center;}" +
      ".preview-logo{width:62px;height:62px;border-radius:18px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 16px 34px rgba(15,139,255,.18);}" +
      ".preview-logo img{width:40px;height:40px;display:block;}" +
      ".preview-kicker{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#93c5fd;font-weight:700;margin-bottom:6px;}" +
      ".preview-title{font-size:32px;font-weight:800;line-height:1.05;margin:0 0 10px;letter-spacing:-.03em;color:#f8fafc;}" +
      ".preview-subtext{margin:0;color:#cbd5e1;line-height:1.6;font-size:15px;max-width:760px;}" +
      ".preview-meta{color:#cbd5e1;font-size:14px;line-height:1.7;text-align:right;}" +
      ".preview-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-top:14px;}" +
      ".preview-action{border:none;border-radius:14px;padding:12px 16px;font-weight:700;font-size:14px;cursor:pointer;transition:.2s ease;background:linear-gradient(135deg,#1d4ed8,#0f8bff);color:#fff;box-shadow:0 12px 30px rgba(15,139,255,.25);}" +
      ".preview-action.secondary{background:rgba(255,255,255,.08);color:#e5edf8;box-shadow:none;border:1px solid rgba(148,163,184,.2);}" +
      ".preview-copy-status{min-height:20px;color:#93c5fd;font-size:13px;font-weight:600;}" +
      ".preview-section{margin-bottom:22px;padding:22px;border-radius:22px;background:rgba(15,23,42,.88);border:1px solid rgba(148,163,184,.14);box-shadow:0 22px 50px rgba(0,0,0,.22);}" +
      ".preview-section-title{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#93c5fd;font-weight:800;margin-bottom:14px;}" +
      ".preview-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;}" +
      ".preview-chip{padding:16px 18px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.16);}" +
      ".preview-chip-label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-bottom:8px;}" +
      ".preview-chip-value{font-size:22px;font-weight:800;color:#f8fafc;}" +
      ".preview-grid{display:grid;grid-template-columns:1.25fr 1fr;gap:18px;}" +
      ".preview-list-card,.preview-ranking-card{padding:18px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.14);}" +
      ".preview-bullets{margin:0;padding-left:18px;color:#dbe7f3;line-height:1.7;}" +
      ".preview-bullets li+li{margin-top:8px;}" +
      ".preview-ranking-list{display:flex;flex-direction:column;gap:10px;}" +
      ".preview-ranking-row{display:flex;justify-content:space-between;gap:14px;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.12);}" +
      ".preview-ranking-name{font-weight:700;color:#f8fafc;margin-bottom:4px;}" +
      ".preview-ranking-meta{font-size:13px;color:#94a3b8;line-height:1.5;}" +
      ".preview-ranking-value{color:#f8fafc;font-weight:800;white-space:nowrap;}" +
      ".preview-client-card{padding:24px;border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.03));border:1px solid rgba(148,163,184,.16);}" +
      ".preview-client-card + .preview-client-card{margin-top:18px;}" +
      ".preview-client-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px;}" +
      ".preview-client-name{font-size:24px;font-weight:800;color:#f8fafc;margin-bottom:6px;}" +
      ".preview-client-meta{font-size:14px;color:#cbd5e1;line-height:1.65;}" +
      ".preview-client-ca{text-align:right;}" +
      ".preview-client-ca-value{font-size:30px;font-weight:800;color:#f8fafc;letter-spacing:-.03em;}" +
      ".preview-client-ca-label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd;font-weight:700;}" +
      ".preview-stat-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;}" +
      ".preview-stat{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(148,163,184,.16);}" +
      ".preview-stat-label{color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;}" +
      ".preview-stat-value{color:#f8fafc;font-size:13px;font-weight:800;}" +
      ".preview-subtitle{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd;font-weight:800;margin-bottom:12px;}" +
      ".preview-table-wrap{overflow-x:auto;}" +
      ".preview-table{width:100%;border-collapse:collapse;min-width:760px;background:rgba(255,255,255,.03);border-radius:18px;overflow:hidden;}" +
      ".preview-table th,.preview-table td{padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.14);vertical-align:top;text-align:left;}" +
      ".preview-table th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#93c5fd;background:rgba(15,139,255,.08);}" +
      ".preview-table td{font-size:14px;color:#e5edf8;}" +
      ".preview-table .num-cell{text-align:right;white-space:nowrap;font-weight:700;}" +
      ".preview-product-name{font-weight:700;color:#f8fafc;margin-bottom:4px;}" +
      ".preview-product-meta{font-size:12px;color:#94a3b8;line-height:1.5;}" +
      ".preview-note-list{display:flex;flex-direction:column;gap:10px;}" +
      ".preview-note-item,.preview-empty{padding:14px 16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.14);color:#dbe7f3;line-height:1.65;}" +
      ".preview-empty.big{text-align:center;padding:32px;}" +
      ".preview-callout{margin-top:18px;padding:16px 18px;border-radius:18px;background:rgba(15,139,255,.1);border:1px solid rgba(96,165,250,.2);color:#dbe7f3;line-height:1.7;}" +
      "@media (max-width:980px){.preview-grid{grid-template-columns:1fr;}.preview-client-ca{text-align:left;}.preview-meta{text-align:left;}.preview-actions{justify-content:flex-start;}}" +
      "@media (max-width:760px){.preview-shell{padding:20px 16px 38px;}.preview-title{font-size:26px;}.preview-client-name{font-size:20px;}.preview-client-ca-value{font-size:24px;}.preview-table{min-width:640px;}}" +
      "</style></head><body>" +
      '<div class="preview-shell">' +
      '<header class="preview-header">' +
      '<div class="preview-brand">' +
      '<div class="preview-logo"><img src="' +
      logoUrl +
      '" alt="KENT"></div>' +
      "<div>" +
      '<div class="preview-kicker">Portail commercial KENT</div>' +
      '<h1 class="preview-title">' +
      escapeHtml(inputs.reportTitle) +
      "</h1>" +
      "<p class=\"preview-subtext\">Rapport journalier structure par client avec detail des produits, quantites et chiffre d'affaires. Cette page est pensee pour la lecture rapide et le copier-coller vers un autre support.</p>" +
      "</div></div>" +
      "<div>" +
      '<div class="preview-meta">Date : ' +
      escapeHtml(formatDateLong(inputs.reportDate)) +
      "<br>Commercial : " +
      escapeHtml(inputs.commercialName) +
      "<br>Visites consolidees : " +
      escapeHtml(formatNumber(reportStats.nbVisites)) +
      "</div>" +
      '<div class="preview-actions">' +
      '<button id="copyReportButton" class="preview-action" type="button">Copier le rapport</button>' +
      '<button class="preview-action secondary" type="button" onclick="window.print()">Imprimer</button>' +
      "</div>" +
      '<div id="copyStatus" class="preview-copy-status"></div>' +
      "</div></header>" +
      '<section class="preview-section">' +
      '<div class="preview-section-title">Synthese du jour</div>' +
      buildPreviewSummaryHtml() +
      (inputs.globalComment
        ? '<div class="preview-callout"><strong>Commentaire global</strong><br>' + escapeHtml(inputs.globalComment) + "</div>"
        : "") +
      "</section>" +
      '<section class="preview-section preview-grid">' +
      '<div class="preview-list-card"><div class="preview-section-title">Lecture commerciale</div><ul class="preview-bullets">' +
      executiveHtml +
      "</ul></div>" +
      '<div class="preview-ranking-card"><div class="preview-section-title">Top clients et top produits</div>' +
      '<div class="preview-ranking-list">' +
      buildPreviewRanking(reportStats.topClients, "client") +
      buildPreviewRanking(reportStats.topProducts, "product") +
      "</div></div>" +
      "</section>" +
      '<section class="preview-section"><div class="preview-section-title">Rapport detaille</div>' +
      clientsHtml +
      "</section>" +
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
      ".pdf-header{display:flex;justify-content:space-between;gap:10mm;align-items:flex-start;padding-bottom:7mm;margin-bottom:7mm;border-bottom:2px solid #0f8bff;}" +
      ".pdf-brand{display:flex;gap:4mm;align-items:center;}" +
      ".pdf-logo{width:17mm;height:17mm;border-radius:4mm;border:1px solid #d7e3f2;background:#ffffff;display:flex;align-items:center;justify-content:center;overflow:hidden;}" +
      ".pdf-logo img{width:11mm;height:11mm;display:block;}" +
      ".pdf-kicker{font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#2563eb;font-weight:700;margin-bottom:2mm;}" +
      ".pdf-title{font-size:19px;line-height:1.05;font-weight:700;margin:0 0 1.5mm;color:#0b2540;}" +
      ".pdf-subtitle{font-size:9px;line-height:1.5;color:#475569;}" +
      ".pdf-meta{font-size:9px;line-height:1.6;text-align:right;color:#334155;min-width:52mm;}" +
      ".pdf-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:3.2mm;margin-bottom:6mm;}" +
      ".pdf-chip{padding:3.5mm;border-radius:3.5mm;border:1px solid #dbeafe;background:#f8fbff;min-height:15mm;}" +
      ".pdf-chip-label{font-size:7px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:1.2mm;}" +
      ".pdf-chip-value{font-size:12px;font-weight:700;color:#0b2540;}" +
      ".pdf-grid{display:grid;grid-template-columns:1.25fr 1fr;gap:4mm;margin-bottom:5mm;}" +
      ".pdf-panel{padding:4mm;border:1px solid #dbe4f0;border-radius:3.5mm;background:#ffffff;}" +
      ".pdf-section-title{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:700;margin-bottom:2.5mm;}" +
      ".pdf-bullets{margin:0;padding-left:4mm;}" +
      ".pdf-bullets li{font-size:9px;line-height:1.55;color:#334155;}" +
      ".pdf-bullets li+li{margin-top:1.4mm;}" +
      ".pdf-mini-table{width:100%;border-collapse:collapse;}" +
      ".pdf-mini-table th,.pdf-mini-table td{border-bottom:1px solid #e2e8f0;padding:2.4mm 2.2mm;text-align:left;vertical-align:top;font-size:8px;color:#334155;}" +
      ".pdf-mini-table th{background:#f8fafc;color:#475569;font-weight:700;}" +
      ".pdf-mini-table tr:last-child td{border-bottom:none;}" +
      ".pdf-callout{margin-bottom:5mm;padding:3.4mm 3.8mm;border-radius:3.5mm;border:1px solid #dbeafe;background:#f8fbff;color:#334155;font-size:9px;line-height:1.6;}" +
      ".pdf-client{page-break-inside:avoid;break-inside:avoid;margin-bottom:4mm;padding:4mm;border:1px solid #dbe4f0;border-radius:4mm;background:#ffffff;}" +
      ".pdf-client-head{display:flex;justify-content:space-between;gap:4mm;align-items:flex-start;flex-wrap:wrap;margin-bottom:3mm;}" +
      ".pdf-client-name{font-size:13px;font-weight:700;color:#0b2540;margin-bottom:1mm;}" +
      ".pdf-client-meta{font-size:8.5px;line-height:1.55;color:#475569;}" +
      ".pdf-client-ca{text-align:right;}" +
      ".pdf-client-ca-value{font-size:14px;font-weight:700;color:#0b2540;}" +
      ".pdf-client-ca-label{font-size:7px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;font-weight:700;}" +
      ".pdf-client-stats{display:flex;flex-wrap:wrap;gap:2mm;margin-bottom:3mm;}" +
      ".pdf-stat{display:inline-block;padding:1.6mm 2.4mm;border-radius:99px;border:1px solid #e2e8f0;background:#f8fafc;font-size:7.5px;color:#334155;font-weight:700;}" +
      ".pdf-subsection{font-size:7.5px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:700;margin-bottom:2mm;}" +
      ".pdf-product-table{width:100%;border-collapse:collapse;table-layout:fixed;}" +
      ".pdf-product-table th,.pdf-product-table td{border-bottom:1px solid #e2e8f0;padding:2.2mm 2mm;text-align:left;vertical-align:top;font-size:8px;color:#334155;}" +
      ".pdf-product-table th{background:#f8fafc;color:#475569;font-weight:700;}" +
      ".pdf-product-table tr:last-child td{border-bottom:none;}" +
      ".pdf-product-table th.qty,.pdf-product-table td.qty{width:18mm;text-align:right;}" +
      ".pdf-product-table th.stock,.pdf-product-table td.stock{width:18mm;text-align:right;}" +
      ".pdf-product-table th.ca,.pdf-product-table td.ca{width:24mm;text-align:right;}" +
      ".pdf-product-name{font-weight:700;color:#0f172a;margin-bottom:1mm;}" +
      ".pdf-product-meta{font-size:7px;line-height:1.45;color:#64748b;}" +
      ".pdf-note-list{margin-top:3mm;}" +
      ".pdf-note{padding:2.6mm 3mm;border-radius:3mm;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;font-size:8px;line-height:1.55;}" +
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
      "<div class=\"pdf-subtitle\">Rapport journalier structure par client avec detail des produits, quantites et chiffre d'affaires.</div>" +
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
      '<div class="pdf-summary">' +
      '<div class="pdf-chip"><div class="pdf-chip-label">Visites</div><div class="pdf-chip-value">' +
      formatNumber(reportStats.nbVisites) +
      "</div></div>" +
      '<div class="pdf-chip"><div class="pdf-chip-label">Clients</div><div class="pdf-chip-value">' +
      formatNumber(reportStats.nbClients) +
      "</div></div>" +
      '<div class="pdf-chip"><div class="pdf-chip-label">Lignes produits</div><div class="pdf-chip-value">' +
      formatNumber(reportStats.nbLignes) +
      "</div></div>" +
      '<div class="pdf-chip"><div class="pdf-chip-label">Quantite totale</div><div class="pdf-chip-value">' +
      formatNumber(reportStats.totalQuantite) +
      "</div></div>" +
      '<div class="pdf-chip"><div class="pdf-chip-label">Stock observe</div><div class="pdf-chip-value">' +
      formatNumber(reportStats.totalStock) +
      "</div></div>" +
      '<div class="pdf-chip"><div class="pdf-chip-label">CA du jour</div><div class="pdf-chip-value">' +
      escapeHtml(formatCurrency(reportStats.totalCA)) +
      "</div></div>" +
      "</div>" +
      '<div class="pdf-grid">' +
      '<div class="pdf-panel"><div class="pdf-section-title">Lecture commerciale</div><ul class="pdf-bullets">' +
      executiveHtml +
      "</ul></div>" +
      '<div class="pdf-panel"><div class="pdf-section-title">Indicateurs cles</div><table class="pdf-mini-table"><tbody>' +
      buildPdfMetricRows() +
      "</tbody></table></div>" +
      "</div>" +
      (inputs.globalComment
        ? '<div class="pdf-callout"><strong>Commentaire global</strong><br>' + escapeHtml(inputs.globalComment) + "</div>"
        : "") +
      '<div class="pdf-grid">' +
      '<div class="pdf-panel"><div class="pdf-section-title">Top clients du jour</div><table class="pdf-mini-table"><thead><tr><th>Client</th><th>Compte</th><th>CA</th></tr></thead><tbody>' +
      buildPdfRankingRows(reportStats.topClients, "client") +
      "</tbody></table></div>" +
      '<div class="pdf-panel"><div class="pdf-section-title">Top produits du jour</div><table class="pdf-mini-table"><thead><tr><th>Produit</th><th>Reference</th><th>CA</th></tr></thead><tbody>' +
      buildPdfRankingRows(reportStats.topProducts, "product") +
      "</tbody></table></div>" +
      "</div>" +
      buildPdfClientBlocks() +
      '<div class="pdf-footer">Document KENT genere automatiquement depuis le portail commercial. Le CA global reprend le total de commande remonte sur la visite, avec un detail produit base sur les prix unitaires saisis.</div>' +
      "</div>"
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
    var ready = await ensureReportLoaded();
    if (!ready) return;

    var previewWindow = window.open("", "_blank", "noopener,noreferrer,width=1480,height=960");
    if (!previewWindow) {
      alert("Impossible d'ouvrir la fenetre de visualisation. Verifie le bloqueur de pop-up.");
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
