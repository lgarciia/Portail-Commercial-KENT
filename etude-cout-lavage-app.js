(function (global) {
  "use strict";

  var PRODUCT_META = {
    shampoo: {
      key: "shampoo",
      label: "Shampoing",
      shortLabel: "shampoing",
      icon: "🧽",
      serviceLabel: "lavages",
      assumptionKey: "shampooLitersPerWash"
    },
    dry: {
      key: "dry",
      label: "Auto-séchant",
      shortLabel: "auto-séchant",
      icon: "✨",
      serviceLabel: "passages",
      assumptionKey: "dryLitersPerWash"
    }
  };

  var DEFAULT_STATE = {
    clientName: "",
    studyMode: "both",
    assumptions: {
      barrelVolume: 200,
      shampooLitersPerWash: 5.5,
      dryLitersPerWash: 10
    },
    products: {
      shampoo: {
        clientPrice: 369,
        kentPrice: 720,
        clientDilutionPct: 8.56,
        kentDilutionPct: 3.4,
        clientBarrelsPerYear: 3
      },
      dry: {
        clientPrice: 263,
        kentPrice: 865,
        clientDilutionPct: 3.605,
        kentDilutionPct: 2.9,
        clientBarrelsPerYear: 1
      }
    }
  };

  var state = clone(DEFAULT_STATE);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    var normalized = String(value).replace(",", ".").replace(/\s/g, "");
    var parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function round(value, digits) {
    if (!Number.isFinite(value)) return 0;
    var factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
  }

  function safeDivide(a, b) {
    return b ? a / b : 0;
  }

  function formatNumber(value, digits) {
    return Number(value || 0).toLocaleString("fr-FR", {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    });
  }

  function formatSmart(value, maxDigits) {
    return Number(value || 0).toLocaleString("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDigits === undefined ? 2 : maxDigits
    });
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatPercent(value) {
    return formatSmart(value, 3) + " %";
  }

  function deltaClass(delta) {
    if (Math.abs(delta) < 0.005) return "delta-neutral";
    return delta < 0 ? "delta-good" : "delta-bad";
  }

  function getActiveKeys(mode) {
    if (mode === "shampoo") return ["shampoo"];
    if (mode === "dry") return ["dry"];
    return ["shampoo", "dry"];
  }

  function sanitizeFileName(value) {
    return String(value || "Sans nom")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Sans nom";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function modeLabel(mode) {
    if (mode === "shampoo") return "Etude shampoing";
    if (mode === "dry") return "Etude auto-séchant";
    return "Etude complète";
  }

  function getProductStatus(delta) {
    if (Math.abs(delta) < 0.005) return "neutral";
    return delta < 0 ? "good" : "bad";
  }

  function getStatusLabel(status) {
    if (status === "good") return "favorable";
    if (status === "bad") return "défavorable";
    return "équilibrée";
  }

  function buildDeltaText(delta, suffix) {
    var value = Math.abs(delta);
    if (Math.abs(delta) < 0.005) {
      return "Équilibre quasi parfait";
    }
    if (delta < 0) {
      return "Gain " + formatCurrency(value) + (suffix ? suffix : "");
    }
    return "Surcoût " + formatCurrency(value) + (suffix ? suffix : "");
  }

  function computeProduct(key, productInput, assumptions) {
    var meta = PRODUCT_META[key];
    var barrelVolume = toNumber(assumptions.barrelVolume);
    var litersPerWash = toNumber(assumptions[meta.assumptionKey]);
    var clientPrice = toNumber(productInput.clientPrice);
    var kentPrice = toNumber(productInput.kentPrice);
    var clientDilutionPct = toNumber(productInput.clientDilutionPct);
    var kentDilutionPct = toNumber(productInput.kentDilutionPct);
    var clientBarrelsPerYear = toNumber(productInput.clientBarrelsPerYear);

    var errors = [];
    if (barrelVolume <= 0) errors.push("conditionnement");
    if (litersPerWash <= 0) errors.push("consommation moyenne");
    if (clientPrice <= 0) errors.push("prix fût client");
    if (kentPrice <= 0) errors.push("prix fût KENT");
    if (clientDilutionPct <= 0 || clientDilutionPct >= 100) errors.push("dilution client");
    if (kentDilutionPct <= 0 || kentDilutionPct >= 100) errors.push("dilution KENT");
    if (clientBarrelsPerYear <= 0) errors.push("nombre de fûts client / an");

    if (errors.length) {
      return {
        key: key,
        meta: meta,
        complete: false,
        errors: errors
      };
    }

    var clientDilutionRatio = clientDilutionPct / 100;
    var kentDilutionRatio = kentDilutionPct / 100;

    var clientPricePerLiter = safeDivide(clientPrice, barrelVolume);
    var kentPricePerLiter = safeDivide(kentPrice, barrelVolume);

    var clientReadyLiters = safeDivide(barrelVolume, clientDilutionRatio);
    var kentReadyLiters = safeDivide(barrelVolume, kentDilutionRatio);

    var clientApplicationsPerBarrel = safeDivide(clientReadyLiters, litersPerWash);
    var kentApplicationsPerBarrel = safeDivide(kentReadyLiters, litersPerWash);

    var annualServiceCount = clientBarrelsPerYear * clientApplicationsPerBarrel;
    var kentEquivalentBarrels = safeDivide(annualServiceCount, kentApplicationsPerBarrel);
    var barrelDelta = kentEquivalentBarrels - clientBarrelsPerYear;

    var clientCostPerService = safeDivide(clientPrice, clientApplicationsPerBarrel);
    var kentCostPerService = safeDivide(kentPrice, kentApplicationsPerBarrel);
    var deltaPerService = kentCostPerService - clientCostPerService;

    var clientAnnualCost = clientBarrelsPerYear * clientPrice;
    var kentAnnualCost = kentEquivalentBarrels * kentPrice;
    var annualDelta = kentAnnualCost - clientAnnualCost;
    var monthlyDelta = annualDelta / 12;

    return {
      key: key,
      meta: meta,
      complete: true,
      assumptions: {
        barrelVolume: barrelVolume,
        litersPerWash: litersPerWash
      },
      clientPrice: clientPrice,
      kentPrice: kentPrice,
      clientDilutionPct: clientDilutionPct,
      kentDilutionPct: kentDilutionPct,
      clientBarrelsPerYear: clientBarrelsPerYear,
      clientPricePerLiter: clientPricePerLiter,
      kentPricePerLiter: kentPricePerLiter,
      clientReadyLiters: clientReadyLiters,
      kentReadyLiters: kentReadyLiters,
      clientApplicationsPerBarrel: clientApplicationsPerBarrel,
      kentApplicationsPerBarrel: kentApplicationsPerBarrel,
      annualServiceCount: annualServiceCount,
      kentEquivalentBarrels: kentEquivalentBarrels,
      barrelDelta: barrelDelta,
      clientCostPerService: clientCostPerService,
      kentCostPerService: kentCostPerService,
      deltaPerService: deltaPerService,
      clientAnnualCost: clientAnnualCost,
      kentAnnualCost: kentAnnualCost,
      annualDelta: annualDelta,
      monthlyDelta: monthlyDelta,
      status: getProductStatus(annualDelta)
    };
  }

  function buildProductBullets(result) {
    var bullets = [];
    var deltaAnnualAbs = Math.abs(result.annualDelta);
    var deltaMonthlyAbs = Math.abs(result.monthlyDelta);
    var deltaPerServiceAbs = Math.abs(result.deltaPerService);

    bullets.push(
      "Volume estimé : environ " +
      formatSmart(result.annualServiceCount, 0) +
      " " +
      result.meta.serviceLabel +
      " par an à partir du rythme actuel."
    );
    bullets.push(
      "Coût actuel : " +
      formatCurrency(result.clientCostPerService) +
      " par prestation, contre " +
      formatCurrency(result.kentCostPerService) +
      " avec KENT."
    );
    bullets.push(
      "Il faudrait environ " +
      formatSmart(result.kentEquivalentBarrels, 2) +
      " fûts KENT par an, contre " +
      formatSmart(result.clientBarrelsPerYear, 2) +
      " fûts actuellement."
    );

    if (result.status === "good") {
      bullets.push(
        "KENT réduit le coût de " +
        formatCurrency(deltaPerServiceAbs) +
        " par prestation, soit une économie estimée à " +
        formatCurrency(deltaAnnualAbs) +
        " par an et " +
        formatCurrency(deltaMonthlyAbs) +
        " par mois."
      );
      bullets.push(
        "Dans ces conditions, l'étude soutient la vente : le garage baisse son coût direct sur la prestation offerte."
      );
    } else if (result.status === "bad") {
      bullets.push(
        "KENT ressort plus cher de " +
        formatCurrency(deltaPerServiceAbs) +
        " par prestation, soit un surcoût estimé à " +
        formatCurrency(deltaAnnualAbs) +
        " par an et " +
        formatCurrency(deltaMonthlyAbs) +
        " par mois."
      );
      bullets.push(
        "À ce rythme, le garage laverait à perte sur les 12 mois de l'année par rapport à sa solution actuelle. Dans cet état, l'étude ne soutient pas la vente."
      );
    } else {
      bullets.push(
        "Les deux solutions ressortent quasiment à l'équilibre. Il faudra alors défendre KENT sur un autre angle que le coût pur : service, efficacité ou confort d'usage."
      );
    }

    return bullets;
  }

  function computeStudy(inputState) {
    var activeKeys = getActiveKeys(inputState.studyMode);
    var results = [];
    var incomplete = [];

    activeKeys.forEach(function (key) {
      var productResult = computeProduct(key, inputState.products[key], inputState.assumptions);
      if (productResult.complete) {
        results.push(productResult);
      } else {
        incomplete.push(productResult);
      }
    });

    var totals = {
      currentAnnualCost: 0,
      kentAnnualCost: 0,
      annualDelta: 0,
      monthlyDelta: 0,
      serviceCount: 0
    };

    results.forEach(function (result) {
      totals.currentAnnualCost += result.clientAnnualCost;
      totals.kentAnnualCost += result.kentAnnualCost;
      totals.serviceCount += result.annualServiceCount;
    });
    totals.annualDelta = totals.kentAnnualCost - totals.currentAnnualCost;
    totals.monthlyDelta = totals.annualDelta / 12;
    totals.status = getProductStatus(totals.annualDelta);

    var overallBullets = [];
    if (!incomplete.length && results.length) {
      if (results.length === 1) {
        overallBullets = buildProductBullets(results[0]);
      } else {
        var winners = results.filter(function (item) { return item.status === "good"; });
        var losers = results.filter(function (item) { return item.status === "bad"; });

        overallBullets.push(
          "L'étude complète porte sur " + results.length + " familles de produit(s) pour un coût direct total client de " +
          formatCurrency(totals.currentAnnualCost) + " par an."
        );

        if (totals.status === "good") {
          overallBullets.push(
            "Au global, KENT baisse le coût annuel de " +
            formatCurrency(Math.abs(totals.annualDelta)) +
            ", soit environ " +
            formatCurrency(Math.abs(totals.monthlyDelta)) +
            " par mois."
          );
        } else if (totals.status === "bad") {
          overallBullets.push(
            "Au global, KENT ajoute un surcoût annuel de " +
            formatCurrency(Math.abs(totals.annualDelta)) +
            ", soit environ " +
            formatCurrency(Math.abs(totals.monthlyDelta)) +
            " par mois."
          );
        } else {
          overallBullets.push(
            "Au global, l'écart est très faible : la décision ne peut pas reposer uniquement sur le coût."
          );
        }

        if (winners.length && losers.length) {
          overallBullets.push(
            "Lecture métier : certains postes sont favorables à KENT, d'autres non. Il faut donc piloter la vente produit par produit et ne pas présenter l'offre comme un bloc uniforme."
          );
        } else if (winners.length === results.length) {
          overallBullets.push(
            "Tous les postes étudiés ressortent favorables à KENT. L'argument coût est donc cohérent sur l'ensemble du dossier."
          );
        } else if (losers.length === results.length) {
          overallBullets.push(
            "Tous les postes étudiés ressortent défavorables à KENT. En l'état, l'étude ne soutient pas la vente."
          );
        }
      }
    }

    return {
      clientName: inputState.clientName || "",
      mode: inputState.studyMode,
      activeKeys: activeKeys,
      results: results,
      incomplete: incomplete,
      totals: totals,
      overallBullets: overallBullets,
      ready: activeKeys.length === results.length && results.length > 0
    };
  }

  function getInputValue(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }

  function getStateFromDom() {
    return {
      clientName: getInputValue("clientName").trim(),
      studyMode: state.studyMode,
      assumptions: clone(state.assumptions),
      products: {
        shampoo: {
          clientPrice: toNumber(getInputValue("shampooClientPrice")),
          kentPrice: toNumber(getInputValue("shampooKentPrice")),
          clientDilutionPct: toNumber(getInputValue("shampooClientDilution")),
          kentDilutionPct: toNumber(getInputValue("shampooKentDilution")),
          clientBarrelsPerYear: toNumber(getInputValue("shampooClientBarrels"))
        },
        dry: {
          clientPrice: toNumber(getInputValue("dryClientPrice")),
          kentPrice: toNumber(getInputValue("dryKentPrice")),
          clientDilutionPct: toNumber(getInputValue("dryClientDilution")),
          kentDilutionPct: toNumber(getInputValue("dryKentDilution")),
          clientBarrelsPerYear: toNumber(getInputValue("dryClientBarrels"))
        }
      }
    };
  }

  function hydrateInputs() {
    document.getElementById("clientName").value = state.clientName;

    document.getElementById("shampooClientPrice").value = state.products.shampoo.clientPrice;
    document.getElementById("shampooKentPrice").value = state.products.shampoo.kentPrice;
    document.getElementById("shampooClientDilution").value = state.products.shampoo.clientDilutionPct;
    document.getElementById("shampooKentDilution").value = state.products.shampoo.kentDilutionPct;
    document.getElementById("shampooClientBarrels").value = state.products.shampoo.clientBarrelsPerYear;

    document.getElementById("dryClientPrice").value = state.products.dry.clientPrice;
    document.getElementById("dryKentPrice").value = state.products.dry.kentPrice;
    document.getElementById("dryClientDilution").value = state.products.dry.clientDilutionPct;
    document.getElementById("dryKentDilution").value = state.products.dry.kentDilutionPct;
    document.getElementById("dryClientBarrels").value = state.products.dry.clientBarrelsPerYear;
  }

  function renderModeButtons() {
    document.querySelectorAll(".mode-btn").forEach(function (button) {
      var isActive = button.getAttribute("data-mode") === state.studyMode;
      button.classList.toggle("is-active", isActive);
    });
  }

  function renderAssumptionStrip() {
    var strip = document.getElementById("assumptionStrip");
    strip.innerHTML = [
      buildAssumptionChip("Conditionnement", formatSmart(state.assumptions.barrelVolume, 2) + " L / fût"),
      buildAssumptionChip("Consommation shampoing", formatSmart(state.assumptions.shampooLitersPerWash, 2) + " L / véhicule"),
      buildAssumptionChip("Consommation auto-séchant", formatSmart(state.assumptions.dryLitersPerWash, 2) + " L / véhicule")
    ].join("");
  }

  function buildAssumptionChip(label, value) {
    return (
      '<div class="assumption-chip">' +
      '<div class="chip-label">' + escapeHtml(label) + "</div>" +
      '<div class="chip-value">' + escapeHtml(value) + "</div>" +
      "</div>"
    );
  }

  function renderScenarioVisibility() {
    document.getElementById("section-shampoo").classList.toggle("section-hidden", state.studyMode === "dry");
    document.getElementById("section-dry").classList.toggle("section-hidden", state.studyMode === "shampoo");
  }

  function renderProductTable(targetId, result) {
    var table = document.getElementById(targetId);
    if (!result || !result.complete) {
      table.innerHTML = (
        "<thead><tr><th>Indicateur</th><th>Client</th><th>KENT</th><th>Lecture</th></tr></thead>" +
        '<tbody><tr><td colspan="4">Renseigne tous les champs de cette étude pour afficher le comparatif.</td></tr></tbody>'
      );
      return;
    }

    var rows = [
      ["Prix du fût", formatCurrency(result.clientPrice), formatCurrency(result.kentPrice), "Tarif saisi dans l'étude"],
      ["Prix du litre pur", formatCurrency(result.clientPricePerLiter), formatCurrency(result.kentPricePerLiter), "Base produit pur avant dilution"],
      ["Taux de dilution", formatPercent(result.clientDilutionPct), formatPercent(result.kentDilutionPct), "Plus le taux est bas, plus le volume prêt à l'emploi augmente"],
      ["Litres prêts à l'emploi / fût", formatSmart(result.clientReadyLiters, 0) + " L", formatSmart(result.kentReadyLiters, 0) + " L", "Volume utilisable après dilution"],
      ["Applications / fût", formatSmart(result.clientApplicationsPerBarrel, 0), formatSmart(result.kentApplicationsPerBarrel, 0), "Nombre de prestations réalisables avec un fût"],
      ["Fûts utilisés / an", formatSmart(result.clientBarrelsPerYear, 2), formatSmart(result.kentEquivalentBarrels, 2), barrelLabel(result.barrelDelta)],
      ["Coût / prestation", formatCurrency(result.clientCostPerService), formatCurrency(result.kentCostPerService), costLabel(result.deltaPerService)],
      ["Coût annuel", formatCurrency(result.clientAnnualCost), formatCurrency(result.kentAnnualCost), costLabel(result.annualDelta)]
    ];

    table.innerHTML =
      "<thead><tr><th>Indicateur</th><th>Solution client</th><th>Solution KENT</th><th>Lecture</th></tr></thead>" +
      "<tbody>" +
      rows.map(function (row) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(row[0]) + "</td>" +
          "<td><strong>" + escapeHtml(row[1]) + "</strong></td>" +
          "<td><strong>" + escapeHtml(row[2]) + "</strong></td>" +
          "<td>" + row[3] + "</td>" +
          "</tr>"
        );
      }).join("") +
      "</tbody>";
  }

  function barrelLabel(delta) {
    if (Math.abs(delta) < 0.005) {
      return '<span class="delta-neutral">Volume identique</span>';
    }
    if (delta < 0) {
      return '<span class="delta-good">' + escapeHtml(formatSmart(Math.abs(delta), 2)) + " fût(s) KENT en moins</span>";
    }
    return '<span class="delta-bad">' + escapeHtml(formatSmart(Math.abs(delta), 2)) + " fût(s) KENT en plus</span>";
  }

  function costLabel(delta) {
    if (Math.abs(delta) < 0.005) {
      return '<span class="delta-neutral">Écart négligeable</span>';
    }
    if (delta < 0) {
      return '<span class="delta-good">Gain ' + escapeHtml(formatCurrency(Math.abs(delta))) + "</span>";
    }
    return '<span class="delta-bad">Surcoût ' + escapeHtml(formatCurrency(Math.abs(delta))) + "</span>";
  }

  function renderInsight(targetId, result) {
    var container = document.getElementById(targetId);
    if (!result || !result.complete) {
      container.innerHTML = "";
      return;
    }

    var title = "";
    var subtitle = "";
    if (result.status === "good") {
      title = "Etude favorable à KENT";
      subtitle = "La solution KENT baisse le coût direct de la prestation sur ce poste.";
    } else if (result.status === "bad") {
      title = "Etude défavorable à KENT";
      subtitle = "La solution KENT ressort plus chère sur ce poste. Dans cet état, l'étude ne soutient pas la vente.";
    } else {
      title = "Etude à l'équilibre";
      subtitle = "Le différentiel coût est trop faible pour porter la vente à lui seul.";
    }

    container.innerHTML =
      '<div class="insight-box ' + result.status + '">' +
      '<h4 class="insight-title">' + escapeHtml(title) + "</h4>" +
      '<p class="insight-subtitle">' + escapeHtml(subtitle) + "</p>" +
      '<div class="bullets">' +
      buildProductBullets(result).map(function (line) {
        return '<div class="bullet">' + escapeHtml(line) + "</div>";
      }).join("") +
      "</div>" +
      "</div>";
  }

  function renderSummary(study) {
    var grid = document.getElementById("summaryGrid");
    if (!study.ready) {
      grid.innerHTML = [
        buildSummaryCard("Client", state.clientName || "À renseigner", "Le nom client sera repris dans le PDF."),
        buildSummaryCard("Mode", modeLabel(state.studyMode), "Active uniquement les produits réellement étudiés."),
        buildSummaryCard("Coût actuel", "—", "Le calcul apparaît dès que toutes les valeurs utiles sont remplies."),
        buildSummaryCard("Écart annuel", "—", "Le sens de lecture reste simple : vert = favorable à KENT, rouge = défavorable.", true)
      ].join("");
      return;
    }

    var deltaNote;
    if (study.totals.status === "good") {
      deltaNote = "KENT baisse le coût annuel global de " + formatCurrency(Math.abs(study.totals.annualDelta)) + ".";
    } else if (study.totals.status === "bad") {
      deltaNote = "KENT ajoute un surcoût annuel global de " + formatCurrency(Math.abs(study.totals.annualDelta)) + ".";
    } else {
      deltaNote = "L'écart global est très faible : la vente ne peut pas reposer uniquement sur le coût.";
    }

    grid.innerHTML = [
      buildSummaryCard("Client", study.clientName || "Sans nom", "Nom repris dans l'étude et dans le PDF."),
      buildSummaryCard("Prestations / an", formatSmart(study.totals.serviceCount, 0), "Estimation à partir du rythme client actuel."),
      buildSummaryCard("Coût annuel actuel", formatCurrency(study.totals.currentAnnualCost), "Coût direct pour le garage avec la solution en place."),
      buildSummaryCard("Coût annuel KENT", formatCurrency(study.totals.kentAnnualCost), "Projection avec la solution KENT à volume constant."),
      buildSummaryCard("Écart annuel", buildDeltaText(study.totals.annualDelta), deltaNote, true, study.totals.status),
      buildSummaryCard("Écart mensuel", buildDeltaText(study.totals.monthlyDelta), study.totals.status === "bad" ? "À ce rythme, le garage subirait ce surcoût 12 mois sur 12." : "Lecture utile pour reformuler l'étude en budget mensuel.", true, study.totals.status)
    ].join("");
  }

  function buildSummaryCard(label, value, note, highlight, status) {
    return (
      '<div class="summary-card' + (highlight ? " highlight" : "") + '">' +
      '<div class="summary-label">' + escapeHtml(label) + "</div>" +
      '<div class="summary-value ' + (status ? deltaClass(status === "good" ? -1 : status === "bad" ? 1 : 0) : "") + '">' + escapeHtml(value) + "</div>" +
      '<div class="summary-note">' + escapeHtml(note) + "</div>" +
      "</div>"
    );
  }

  function renderOverallInsight(study) {
    var container = document.getElementById("overallInsight");
    if (!study.ready) {
      var missingLabel = study.incomplete.length
        ? "Champs encore à renseigner : " + study.incomplete.map(function (item) { return item.meta.label; }).join(", ") + "."
        : "Choisis au moins un produit d'étude.";
      container.innerHTML =
        '<div class="insight-box neutral">' +
        '<h4 class="insight-title">En attente de simulation</h4>' +
        '<p class="insight-subtitle">' + escapeHtml(missingLabel) + "</p>" +
        "</div>";
      document.getElementById("statusBar").textContent = missingLabel;
      return;
    }

    var title;
    var subtitle;
    if (study.totals.status === "good") {
      title = "Conclusion : KENT est économiquement défendable";
      subtitle = "Le coût direct de la prestation offerte baisse à volume constant.";
    } else if (study.totals.status === "bad") {
      title = "Conclusion : l'étude ne soutient pas la vente";
      subtitle = "KENT ressort plus cher et ferait monter le coût direct du garage.";
    } else {
      title = "Conclusion : l'étude est neutre";
      subtitle = "Le différentiel coût est trop faible pour décider seul.";
    }

    container.innerHTML =
      '<div class="insight-box ' + study.totals.status + '">' +
      '<h4 class="insight-title">' + escapeHtml(title) + "</h4>" +
      '<p class="insight-subtitle">' + escapeHtml(subtitle) + "</p>" +
      '<div class="bullets">' +
      study.overallBullets.map(function (line) {
        return '<div class="bullet">' + escapeHtml(line) + "</div>";
      }).join("") +
      "</div>" +
      "</div>";

    document.getElementById("statusBar").textContent =
      study.totals.status === "bad"
        ? "Simulation prête. Le coût KENT ressort défavorable sur cette étude."
        : study.totals.status === "good"
          ? "Simulation prête. L'étude montre un gain économique en faveur de KENT."
          : "Simulation prête. L'écart coût est quasi neutre.";
  }

  function syncStateFromDom() {
    var domState = getStateFromDom();
    state.clientName = domState.clientName;
    state.products = domState.products;
  }

  function renderAll() {
    syncStateFromDom();
    renderModeButtons();
    renderScenarioVisibility();
    renderAssumptionStrip();

    var study = computeStudy(getStateFromDom());
    renderProductTable("table-shampoo", getResultByKey(study, "shampoo"));
    renderProductTable("table-dry", getResultByKey(study, "dry"));
    renderInsight("insight-shampoo", getResultByKey(study, "shampoo"));
    renderInsight("insight-dry", getResultByKey(study, "dry"));
    renderSummary(study);
    renderOverallInsight(study);
  }

  function getResultByKey(study, key) {
    for (var i = 0; i < study.results.length; i += 1) {
      if (study.results[i].key === key) return study.results[i];
    }
    for (var j = 0; j < study.incomplete.length; j += 1) {
      if (study.incomplete[j].key === key) return study.incomplete[j];
    }
    return null;
  }

  function openAssumptionsModal() {
    document.getElementById("assumptionsModal").classList.add("open");
    document.getElementById("assumptionsModal").setAttribute("aria-hidden", "false");
    document.getElementById("assumptionBarrelVolume").value = state.assumptions.barrelVolume;
    document.getElementById("assumptionShampooLiters").value = state.assumptions.shampooLitersPerWash;
    document.getElementById("assumptionDryLiters").value = state.assumptions.dryLitersPerWash;
  }

  function closeAssumptionsModal() {
    document.getElementById("assumptionsModal").classList.remove("open");
    document.getElementById("assumptionsModal").setAttribute("aria-hidden", "true");
  }

  function saveAssumptions() {
    var nextAssumptions = {
      barrelVolume: toNumber(document.getElementById("assumptionBarrelVolume").value),
      shampooLitersPerWash: toNumber(document.getElementById("assumptionShampooLiters").value),
      dryLitersPerWash: toNumber(document.getElementById("assumptionDryLiters").value)
    };

    if (nextAssumptions.barrelVolume <= 0 || nextAssumptions.shampooLitersPerWash <= 0 || nextAssumptions.dryLitersPerWash <= 0) {
      alert("Toutes les hypothèses doivent être supérieures à zéro.");
      return;
    }

    if (!global.confirm("Confirmer la mise à jour des hypothèses de calcul ?")) {
      return;
    }

    state.assumptions = nextAssumptions;
    closeAssumptionsModal();
    renderAll();
    document.getElementById("statusBar").textContent = "Hypothèses mises à jour et étude recalculée.";
  }

  function resetAssumptions() {
    document.getElementById("assumptionBarrelVolume").value = DEFAULT_STATE.assumptions.barrelVolume;
    document.getElementById("assumptionShampooLiters").value = DEFAULT_STATE.assumptions.shampooLitersPerWash;
    document.getElementById("assumptionDryLiters").value = DEFAULT_STATE.assumptions.dryLitersPerWash;
  }

  function getAssetUrl(assetPath) {
    try {
      return new URL(assetPath, global.location.href).toString();
    } catch (error) {
      return assetPath;
    }
  }

  function buildPdfProductSection(result) {
    var bullets = buildProductBullets(result);
    var rows = [
      ["Prix du fût", formatCurrency(result.clientPrice), formatCurrency(result.kentPrice), "Saisi dans l'étude"],
      ["Prix du litre pur", formatCurrency(result.clientPricePerLiter), formatCurrency(result.kentPricePerLiter), "Base produit pur"],
      ["Taux de dilution", formatPercent(result.clientDilutionPct), formatPercent(result.kentDilutionPct), "Comparatif de préparation"],
      ["Applications / fût", formatSmart(result.clientApplicationsPerBarrel, 0), formatSmart(result.kentApplicationsPerBarrel, 0), "Prestations réalisables par fût"],
      ["Fûts / an", formatSmart(result.clientBarrelsPerYear, 2), formatSmart(result.kentEquivalentBarrels, 2), stripHtml(barrelLabel(result.barrelDelta))],
      ["Coût / prestation", formatCurrency(result.clientCostPerService), formatCurrency(result.kentCostPerService), stripHtml(costLabel(result.deltaPerService))],
      ["Coût annuel", formatCurrency(result.clientAnnualCost), formatCurrency(result.kentAnnualCost), stripHtml(costLabel(result.annualDelta))]
    ];

    return (
      '<section class="pdf-section">' +
      '<div class="pdf-section-head">' +
      '<div class="pdf-section-kicker">' + escapeHtml(result.meta.label) + "</div>" +
      '<div class="pdf-section-status pdf-' + result.status + '">' + escapeHtml(getStatusLabel(result.status)) + "</div>" +
      "</div>" +
      '<table class="pdf-table">' +
      "<thead><tr><th>Indicateur</th><th>Solution client</th><th>Solution KENT</th><th>Lecture</th></tr></thead>" +
      "<tbody>" +
      rows.map(function (row) {
        return "<tr><td>" + escapeHtml(row[0]) + "</td><td>" + escapeHtml(row[1]) + "</td><td>" + escapeHtml(row[2]) + "</td><td>" + escapeHtml(row[3]) + "</td></tr>";
      }).join("") +
      "</tbody>" +
      "</table>" +
      buildPdfNoteList(bullets) +
      "</section>"
    );
  }

  function buildPdfNoteList(lines) {
    return (
      '<div class="pdf-note-list">' +
      lines.map(function (line) {
        return (
          '<div class="pdf-note-item">' +
          '<span class="pdf-note-dot"></span>' +
          '<span class="pdf-note-text">' + escapeHtml(line) + "</span>" +
          "</div>"
        );
      }).join("") +
      "</div>"
    );
  }

  function stripHtml(value) {
    return String(value || "").replace(/<[^>]+>/g, "").trim();
  }

  function buildPdfHtml(study) {
    var clientName = study.clientName || "Client non renseigné";
    var logoUrl = getAssetUrl("./kent-logo.svg");
    var generatedOn = new Date();
    var dateLabel = generatedOn.toLocaleDateString("fr-FR");

    var sectionsHtml = study.results.map(function (result) {
      return buildPdfProductSection(result);
    }).join("");

    var overallSummary =
      '<section class="pdf-section">' +
      '<div class="pdf-section-kicker">Synthèse de décision</div>' +
      '<table class="pdf-metrics"><tbody>' +
      "<tr><td>Client</td><td>" + escapeHtml(clientName) + "</td></tr>" +
      "<tr><td>Mode d'étude</td><td>" + escapeHtml(modeLabel(study.mode)) + "</td></tr>" +
      "<tr><td>Coût annuel actuel</td><td>" + escapeHtml(formatCurrency(study.totals.currentAnnualCost)) + "</td></tr>" +
      "<tr><td>Coût annuel KENT</td><td>" + escapeHtml(formatCurrency(study.totals.kentAnnualCost)) + "</td></tr>" +
      "<tr><td>Écart annuel</td><td>" + escapeHtml(buildDeltaText(study.totals.annualDelta)) + "</td></tr>" +
      "<tr><td>Écart mensuel</td><td>" + escapeHtml(buildDeltaText(study.totals.monthlyDelta)) + "</td></tr>" +
      "</tbody></table>" +
      buildPdfNoteList(study.overallBullets) +
      "</section>";

    return (
      '<div class="pdf-root">' +
      "<style>" +
      ".pdf-root,.pdf-root *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#0f172a;}" +
      ".pdf-root{width:184mm;padding:8mm 8mm 7mm;background:#ffffff;}" +
      ".pdf-header{display:flex;justify-content:space-between;gap:6mm;align-items:flex-start;border-bottom:2px solid #2563eb;padding-bottom:4.5mm;margin-bottom:5.5mm;}" +
      ".pdf-brand{display:flex;gap:4mm;align-items:center;}" +
      ".pdf-logo{width:15mm;height:15mm;border:1px solid #dbe5f1;border-radius:4mm;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;}" +
      ".pdf-logo img{width:10mm;height:10mm;display:block;}" +
      ".pdf-kicker{font-size:8px;letter-spacing:.18em;text-transform:uppercase;color:#2563eb;font-weight:700;margin-bottom:1.6mm;}" +
      ".pdf-title{font-size:18px;line-height:1.05;font-weight:700;margin:0 0 1.4mm;color:#0b2540;}" +
      ".pdf-subtitle{font-size:8.8px;line-height:1.45;color:#475569;max-width:96mm;}" +
      ".pdf-meta{font-size:8.8px;line-height:1.55;text-align:right;color:#334155;min-width:38mm;}" +
      ".pdf-section{margin-bottom:4.8mm;page-break-inside:avoid;break-inside:avoid;}" +
      ".pdf-section-head{display:flex;justify-content:space-between;align-items:center;gap:4mm;margin-bottom:2.5mm;}" +
      ".pdf-section-kicker{font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#2563eb;font-weight:700;}" +
      ".pdf-section-status{font-size:8px;font-weight:700;padding:1.4mm 2.4mm;border-radius:999px;border:1px solid #dbe5f1;}" +
      ".pdf-good{background:#dcfce7;color:#166534;border-color:#bbf7d0;}" +
      ".pdf-bad{background:#fee2e2;color:#991b1b;border-color:#fecaca;}" +
      ".pdf-neutral{background:#fef3c7;color:#92400e;border-color:#fde68a;}" +
      ".pdf-table,.pdf-metrics{width:100%;border-collapse:collapse;table-layout:fixed;}" +
      ".pdf-table th,.pdf-table td,.pdf-metrics td{border:1px solid #e2e8f0;padding:2.3mm 2.1mm;font-size:8.25px;line-height:1.42;vertical-align:top;overflow-wrap:break-word;word-break:break-word;}" +
      ".pdf-table th{background:#f8fafc;color:#475569;font-weight:700;}" +
      ".pdf-table th:nth-child(1),.pdf-table td:nth-child(1){width:24%;}" +
      ".pdf-table th:nth-child(2),.pdf-table td:nth-child(2){width:19%;}" +
      ".pdf-table th:nth-child(3),.pdf-table td:nth-child(3){width:19%;}" +
      ".pdf-table th:nth-child(4),.pdf-table td:nth-child(4){width:38%;}" +
      ".pdf-table tr,.pdf-metrics tr{page-break-inside:avoid;break-inside:avoid;}" +
      ".pdf-metrics td:first-child{width:44mm;font-weight:700;background:#f8fafc;color:#475569;}" +
      ".pdf-note-list{margin-top:2.6mm;display:grid;gap:1.7mm;}" +
      ".pdf-note-item{display:grid;grid-template-columns:1.8mm 1fr;column-gap:2.2mm;align-items:flex-start;font-size:8.45px;line-height:1.58;color:#334155;page-break-inside:avoid;break-inside:avoid;}" +
      ".pdf-note-dot{width:1.8mm;height:1.8mm;border-radius:99px;background:#7c3aed;display:block;margin-top:.95mm;}" +
      ".pdf-note-text{min-width:0;overflow-wrap:break-word;word-break:break-word;}" +
      ".pdf-footer{margin-top:5.4mm;font-size:7.8px;line-height:1.55;text-align:center;color:#64748b;}" +
      "</style>" +
      '<div class="pdf-header">' +
      '<div class="pdf-brand">' +
      '<div class="pdf-logo"><img src="' + logoUrl + '" alt="KENT"></div>' +
      "<div>" +
      '<div class="pdf-kicker">Portail commercial KENT</div>' +
      '<h1 class="pdf-title">Etude coût de lavage</h1>' +
      '<div class="pdf-subtitle">Comparatif solution client vs solution KENT pour évaluer le coût direct de la prestation offerte au garage et la faisabilité commerciale de la proposition.</div>' +
      "</div>" +
      "</div>" +
      '<div class="pdf-meta">Client : ' + escapeHtml(clientName) + "<br>Date : " + escapeHtml(dateLabel) + "<br>Mode : " + escapeHtml(modeLabel(study.mode)) + "</div>" +
      "</div>" +
      overallSummary +
      sectionsHtml +
      '<div class="pdf-footer">Document KENT généré automatiquement depuis l’étude coût de lavage.</div>' +
      "</div>"
    );
  }

  async function exportPdf() {
    var study = computeStudy(getStateFromDom());
    if (!study.ready) {
      alert("L'étude doit être complète avant de générer le PDF.");
      return;
    }
    if (!global.html2pdf) {
      alert("Le moteur PDF n'est pas disponible sur cette page.");
      return;
    }

    try {
      document.getElementById("statusBar").textContent = "Génération du PDF en cours...";
      var pdfRoot = document.getElementById("pdfExportRoot");
      pdfRoot.innerHTML = buildPdfHtml(study);
      pdfRoot.style.display = "block";

      var fileClientName = sanitizeFileName(study.clientName || "Sans nom");
      var filename = "Etude cout de lavage " + fileClientName + " KENT.pdf";

      await global.html2pdf()
        .set({
          margin: 0,
          filename: filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] }
        })
        .from(pdfRoot.firstElementChild)
        .save();

      pdfRoot.style.display = "none";
      document.getElementById("statusBar").textContent = "PDF généré avec succès.";
    } catch (error) {
      console.error("Erreur export PDF :", error);
      document.getElementById("pdfExportRoot").style.display = "none";
      document.getElementById("statusBar").textContent = "Erreur pendant la génération du PDF.";
      alert("Impossible de générer le PDF.");
    }
  }

  function bindEvents() {
    document.querySelectorAll(".mode-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        state.studyMode = button.getAttribute("data-mode");
        renderAll();
      });
    });

    document.querySelectorAll("input").forEach(function (input) {
      if (input.closest("#assumptionsModal")) return;
      input.addEventListener("input", renderAll);
    });

    document.getElementById("openAssumptionsBtn").addEventListener("click", openAssumptionsModal);
    document.getElementById("closeAssumptionsBtn").addEventListener("click", closeAssumptionsModal);
    document.getElementById("saveAssumptionsBtn").addEventListener("click", saveAssumptions);
    document.getElementById("resetAssumptionsBtn").addEventListener("click", resetAssumptions);
    document.getElementById("exportPdfBtn").addEventListener("click", exportPdf);
    document.getElementById("assumptionsModal").addEventListener("click", function (event) {
      if (event.target === event.currentTarget) closeAssumptionsModal();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeAssumptionsModal();
    });
  }

  function init() {
    hydrateInputs();
    bindEvents();
    renderAll();
  }

  global.EtudeCoutLavageApp = {
    computeProduct: computeProduct,
    computeStudy: computeStudy
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
