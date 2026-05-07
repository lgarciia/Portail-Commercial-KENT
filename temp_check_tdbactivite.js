
    const SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let clients = [];
    let produits = [];
    let visites = [];
    let lignesCommandes = [];
    let filteredContext = null;

    function setStatus(message) {
      document.getElementById("statusBar").textContent = message;
    }

    function formatCurrency(value) {
      return Number(value || 0).toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR"
      });
    }

    function formatDate(dateStr) {
      if (!dateStr) return "â€”";
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("fr-FR");
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function normalizeColor(value) {
      const c = String(value || "").trim().toLowerCase();
      if (c === "rouge") return "red";
      if (c === "jaune") return "yellow";
      if (c === "vert") return "green";
      if (c === "bleu") return "blue";
      return c;
    }

    function normalizeVisitType(value) {
      const normalized = String(value || "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
      if (normalized === "vente") return "vente";
      if (normalized === "passage_sans_vente") return "passage_sans_vente";
      if (normalized === "client_ferme") return "client_ferme";
      return "";
    }

    function buildLineCountByVisitId(lignesFiltered) {
      const map = new Map();
      lignesFiltered.forEach(ligne => {
        const key = String(ligne.visite_id);
        map.set(key, (map.get(key) || 0) + 1);
      });
      return map;
    }

    function isSaleVisit(visite, lineCountByVisit = null) {
      const visitType = normalizeVisitType(visite?.type_visite);
      if (visitType === "vente") return true;
      if (visitType) return false;
      if (Number(visite?.total_commande || 0) > 0) return true;
      if (lineCountByVisit) return (lineCountByVisit.get(String(visite?.id)) || 0) > 0;
      return false;
    }

    function getClientById(id) {
      return clients.find(c => String(c.id) === String(id));
    }

    function getProduitById(id) {
      return produits.find(p => String(p.id) === String(id));
    }

    function goToClient(clientId) {
      if (!clientId) return;
      window.location.href = "ficherclt.html?client_id=" + encodeURIComponent(clientId);
    }

    window.goToClient = goToClient;

    function getDateRange(period) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let start = null;
      let end = new Date(today);
      end.setDate(end.getDate() + 1);

      if (period === "today") {
        start = today;
      } else if (period === "week") {
        const day = today.getDay();
        const diff = day === 0 ? 6 : day - 1;
        start = new Date(today);
        start.setDate(today.getDate() - diff);
      } else if (period === "month") {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
      } else if (period === "30days") {
        start = new Date(today);
        start.setDate(today.getDate() - 29);
      }

      return { start, end };
    }

    function setDefaultDatesFromPeriod() {
      const period = document.getElementById("periodSelect").value;
      const dateStart = document.getElementById("dateStart");
      const dateEnd = document.getElementById("dateEnd");

      if (period !== "custom") {
        const range = getDateRange(period);
        if (range.start) dateStart.value = toInputDate(range.start);
        if (range.end) {
          const displayEnd = new Date(range.end);
          displayEnd.setDate(displayEnd.getDate() - 1);
          dateEnd.value = toInputDate(displayEnd);
        }
      }
    }

    function toInputDate(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    async function fetchAllData() {
      const [clientsRes, produitsRes, visitesRes, lignesRes] = await Promise.all([
        supabaseClient.from("clients").select("id, nom, numero_compte, adresse, telephone").order("nom"),
        supabaseClient.from("produits").select("id, nom, actif, reference_produit, prix_vente").order("nom"),
        supabaseClient.from("visites").select("id, client_id, date_visite, note, type_visite, total_commande").order("date_visite", { ascending: false }),
        supabaseClient.from("visite_commandes").select("id, visite_id, produit_id, quantite, stock_client, couleur, prix_unitaire")
      ]);

      if (clientsRes.error) throw new Error("clients : " + clientsRes.error.message);
      if (produitsRes.error) throw new Error("produits : " + produitsRes.error.message);
      if (visitesRes.error) throw new Error("visites : " + visitesRes.error.message);
      if (lignesRes.error) throw new Error("visite_commandes : " + lignesRes.error.message);

      clients = clientsRes.data || [];
      produits = (produitsRes.data || []).filter(p => p.actif !== false);
      visites = visitesRes.data || [];
      lignesCommandes = lignesRes.data || [];
    }

    function buildContext() {
      const clientSearch = document.getElementById("clientSearch").value.trim().toLowerCase();
      const period = document.getElementById("periodSelect").value;
      const dateStartValue = document.getElementById("dateStart").value;
      const dateEndValue = document.getElementById("dateEnd").value;

      let start = null;
      let end = null;

      if (period === "custom") {
        start = dateStartValue ? new Date(dateStartValue + "T00:00:00") : null;
        end = dateEndValue ? new Date(dateEndValue + "T00:00:00") : null;
        if (end) end.setDate(end.getDate() + 1);
      } else {
        const range = getDateRange(period);
        start = range.start;
        end = range.end;
      }

      const matchingClientIds = new Set(
        clients
          .filter(client => {
            if (!clientSearch) return true;
            const nom = String(client.nom || "").toLowerCase();
            const compte = String(client.numero_compte || "").toLowerCase();
            return nom.includes(clientSearch) || compte.includes(clientSearch);
          })
          .map(client => String(client.id))
      );

      const visitesFiltered = visites.filter(visite => {
        const okClient = matchingClientIds.has(String(visite.client_id));
        if (!okClient) return false;

        const d = visite.date_visite ? new Date(visite.date_visite + "T00:00:00") : null;
        if (!d) return false;

        if (start && d < start) return false;
        if (end && d >= end) return false;
        return true;
      });

      const visiteIds = new Set(visitesFiltered.map(v => String(v.id)));

      const lignesFiltered = lignesCommandes.filter(ligne =>
        visiteIds.has(String(ligne.visite_id))
      );

      return {
        start,
        end,
        clientSearch,
        visitesFiltered,
        lignesFiltered,
        matchingClientIds
      };
    }

    function getTodayMetrics() {
      const range = getDateRange("today");
      const visitesToday = visites.filter(visite => {
        const d = visite.date_visite ? new Date(visite.date_visite + "T00:00:00") : null;
        return d && d >= range.start && d < range.end;
      });

      const caToday = visitesToday.reduce((sum, v) => sum + Number(v.total_commande || 0), 0);

      return {
        visitesToday,
        caToday
      };
    }

    function aggregateClientStats(visitesFiltered) {
      const map = new Map();

      visitesFiltered.forEach(visite => {
        const client = getClientById(visite.client_id);
        if (!client) return;

        const key = String(client.id);
        if (!map.has(key)) {
          map.set(key, {
            client_id: client.id,
            nom: client.nom || "Client",
            numero_compte: client.numero_compte || "â€”",
            visites: 0,
            ca: 0
          });
        }

        const item = map.get(key);
        item.visites += 1;
        item.ca += Number(visite.total_commande || 0);
      });

      return [...map.values()].map(item => ({
        ...item,
        panierMoyen: item.visites ? item.ca / item.visites : 0
      }));
    }

    function aggregateProductStats(lignesFiltered) {
      const map = new Map();

      lignesFiltered.forEach(ligne => {
        const produit = getProduitById(ligne.produit_id);
        if (!produit) return;

        const visite = visites.find(v => String(v.id) === String(ligne.visite_id));
        const clientId = visite ? String(visite.client_id) : null;
        const key = String(produit.id);

        if (!map.has(key)) {
          map.set(key, {
            produit_id: produit.id,
            nom: produit.nom || "Produit",
            reference_produit: produit.reference_produit || "â€”",
            quantite: 0,
            ca: 0,
            clientIds: new Set(),
            rouges: 0
          });
        }

        const item = map.get(key);
        item.quantite += Number(ligne.quantite || 0);
        item.ca += Number(ligne.quantite || 0) * Number(ligne.prix_unitaire || 0);
        if (clientId) item.clientIds.add(clientId);
        if (normalizeColor(ligne.couleur) === "red") item.rouges += 1;
      });

      return [...map.values()].map(item => ({
        ...item,
        clientsCount: item.clientIds.size
      }));
    }

    function buildColorStats(lignesFiltered) {
      const counts = { red: 0, yellow: 0, green: 0, blue: 0, other: 0 };

      lignesFiltered.forEach(ligne => {
        const c = normalizeColor(ligne.couleur);
        if (counts[c] !== undefined) counts[c] += 1;
        else counts.other += 1;
      });

      return counts;
    }

    function buildLowStockLines(lignesFiltered) {
      return lignesFiltered
        .filter(ligne => Number(ligne.stock_client || 0) > 0 && Number(ligne.stock_client || 0) <= 2)
        .map(ligne => {
          const visite = visites.find(v => String(v.id) === String(ligne.visite_id));
          const client = visite ? getClientById(visite.client_id) : null;
          const produit = getProduitById(ligne.produit_id);
          return {
            client_id: client?.id || "",
            client_nom: client?.nom || "Client",
            numero_compte: client?.numero_compte || "â€”",
            produit_nom: produit?.nom || "Produit",
            stock_client: Number(ligne.stock_client || 0),
            date_visite: visite?.date_visite || ""
          };
        })
        .sort((a, b) => a.stock_client - b.stock_client || new Date(b.date_visite) - new Date(a.date_visite));
    }

    function buildRedLinesAll() {
      return lignesCommandes
        .filter(ligne => normalizeColor(ligne.couleur) === "red")
        .map(ligne => {
          const visite = visites.find(v => String(v.id) === String(ligne.visite_id));
          const client = visite ? getClientById(visite.client_id) : null;
          const produit = getProduitById(ligne.produit_id);

          return {
            client_id: client?.id || "",
            client_nom: client?.nom || "Client",
            numero_compte: client?.numero_compte || "â€”",
            produit_nom: produit?.nom || "Produit",
            date_visite: visite?.date_visite || "",
            note: visite?.note || ""
          };
        })
        .sort((a, b) => new Date(b.date_visite) - new Date(a.date_visite));
    }

    function buildInactiveClients(days = 30) {
      const now = new Date();
      const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      limit.setDate(limit.getDate() - days);

      return clients.map(client => {
        const visitesClient = visites
          .filter(v => String(v.client_id) === String(client.id))
          .sort((a, b) => new Date(b.date_visite) - new Date(a.date_visite));

        const lastVisite = visitesClient[0] || null;
        const lastDate = lastVisite?.date_visite ? new Date(lastVisite.date_visite + "T00:00:00") : null;
        const inactive = !lastDate || lastDate < limit;

        return {
          client_id: client.id,
          nom: client.nom || "Client",
          numero_compte: client.numero_compte || "â€”",
          lastDate: lastVisite?.date_visite || "",
          inactive
        };
      })
      .filter(item => item.inactive)
      .sort((a, b) => {
        if (!a.lastDate && !b.lastDate) return 0;
        if (!a.lastDate) return -1;
        if (!b.lastDate) return 1;
        return new Date(a.lastDate) - new Date(b.lastDate);
      });
    }

    function buildVisitsWithoutOrders(visitesFiltered, lignesFiltered) {
      const lineCountByVisit = buildLineCountByVisitId(lignesFiltered);
      return visitesFiltered.filter(visite => !isSaleVisit(visite, lineCountByVisit));
    }

    function renderHero(context) {
      const { visitesFiltered, lignesFiltered } = context;
      const todayMetrics = getTodayMetrics();
      const clientIds = new Set(visitesFiltered.map(v => String(v.client_id)));
      const redLines = lignesFiltered.filter(l => normalizeColor(l.couleur) === "red");
      const redClientIds = new Set(
        redLines.map(l => {
          const visite = visites.find(v => String(v.id) === String(l.visite_id));
          return visite ? String(visite.client_id) : "";
        }).filter(Boolean)
      );

      const ca = visitesFiltered.reduce((sum, v) => sum + Number(v.total_commande || 0), 0);
      const panier = visitesFiltered.length ? ca / visitesFiltered.length : 0;

      document.getElementById("heroVisites").textContent = visitesFiltered.length;
      document.getElementById("heroClients").textContent = `${clientIds.size} client${clientIds.size > 1 ? "s" : ""} visitÃ©${clientIds.size > 1 ? "s" : ""}`;
      document.getElementById("heroCa").textContent = formatCurrency(ca);
      document.getElementById("heroPanier").textContent = `Panier moyen : ${formatCurrency(panier)}`;
      document.getElementById("heroToday").textContent = todayMetrics.visitesToday.length;
      document.getElementById("heroTodayCa").textContent = `CA jour : ${formatCurrency(todayMetrics.caToday)}`;
      document.getElementById("heroRed").textContent = redLines.length;
      document.getElementById("heroRedClients").textContent = `${redClientIds.size} client${redClientIds.size > 1 ? "s" : ""} concernÃ©${redClientIds.size > 1 ? "s" : ""}`;
    }

    function renderAlerts(context) {
      const inactiveClients = buildInactiveClients(30);
      const visitsWithoutOrders = buildVisitsWithoutOrders(context.visitesFiltered, context.lignesFiltered);
      const lowStockLines = buildLowStockLines(context.lignesFiltered);
      const distinctProducts = new Set(context.lignesFiltered.map(l => String(l.produit_id)).filter(Boolean));

      document.getElementById("alertNoVisit").textContent = inactiveClients.length;
      document.getElementById("alertNoVisitText").textContent = `${inactiveClients.length} client${inactiveClients.length > 1 ? "s" : ""}`;

      document.getElementById("alertNoOrder").textContent = visitsWithoutOrders.length;
      document.getElementById("alertNoOrderText").textContent = `${visitsWithoutOrders.length} visite${visitsWithoutOrders.length > 1 ? "s" : ""}`;

      document.getElementById("alertLowStock").textContent = lowStockLines.length;
      document.getElementById("alertLowStockText").textContent = `${lowStockLines.length} ligne${lowStockLines.length > 1 ? "s" : ""}`;

      document.getElementById("alertDistinct").textContent = distinctProducts.size;
      document.getElementById("alertDistinctText").textContent = `${distinctProducts.size} rÃ©fÃ©rence${distinctProducts.size > 1 ? "s" : ""}`;
    }

    function renderActivityKpis(context) {
      const body = document.getElementById("activityKpis");
      const { visitesFiltered, lignesFiltered } = context;
      const ca = visitesFiltered.reduce((sum, v) => sum + Number(v.total_commande || 0), 0);
      const clientIds = new Set(visitesFiltered.map(v => String(v.client_id)));
      const panier = visitesFiltered.length ? ca / visitesFiltered.length : 0;
      const qty = lignesFiltered.reduce((sum, l) => sum + Number(l.quantite || 0), 0);
      const visitsWithoutOrders = buildVisitsWithoutOrders(visitesFiltered, lignesFiltered);
      const visitsWithSale = Math.max(0, visitesFiltered.length - visitsWithoutOrders.length);
      const tauxTransformation = visitesFiltered.length ? (visitsWithSale / visitesFiltered.length) * 100 : 0;

      const kpis = [
        { title: "Clients visitÃ©s", value: clientIds.size, foot: "sur la pÃ©riode filtrÃ©e" },
        { title: "Nombre de lignes", value: lignesFiltered.length, foot: "lignes produits saisies" },
        { title: "QuantitÃ© vendue", value: qty, foot: "total quantitÃ©s commandÃ©es" },
        { title: "Panier moyen", value: formatCurrency(panier), foot: "CA moyen par visite" },
        { title: "CA par client", value: formatCurrency(clientIds.size ? ca / clientIds.size : 0), foot: "moyenne par client visitÃ©" },
        { title: "Taux transformation", value: `${tauxTransformation.toFixed(0)} %`, foot: `${visitsWithSale} visite(s) avec vente` },
        { title: "Note moyenne / visite", value: (visitesFiltered.filter(v => (v.note || "").trim()).length / (visitesFiltered.length || 1)).toFixed(2), foot: "niveau de saisie terrain" },
        { title: "DerniÃ¨re visite", value: visitesFiltered[0] ? formatDate(visitesFiltered[0].date_visite) : "â€”", foot: "sur la pÃ©riode" }
      ];

      body.innerHTML = kpis.map(item => `
        <div class="kpi-card">
          <div class="kpi-title">${escapeHtml(item.title)}</div>
          <div class="kpi-value">${escapeHtml(item.value)}</div>
          <div class="kpi-foot">${escapeHtml(item.foot)}</div>
        </div>
      `).join("");
    }

    function renderColorProgress(context) {
      const body = document.getElementById("colorProgress");
      const stats = buildColorStats(context.lignesFiltered);
      const total = Object.values(stats).reduce((a, b) => a + b, 0);

      const rows = [
        { key: "red", label: "Rouge", colorClass: "red", value: stats.red },
        { key: "yellow", label: "Jaune", colorClass: "yellow", value: stats.yellow },
        { key: "green", label: "Vert", colorClass: "green", value: stats.green },
        { key: "blue", label: "Bleu", colorClass: "blue", value: stats.blue }
      ];

      if (!total) {
        body.innerHTML = `<div class="empty-state">Aucune ligne produit sur la pÃ©riode.</div>`;
        return;
      }

      body.innerHTML = rows.map(row => {
        const pct = total ? (row.value / total) * 100 : 0;
        return `
          <div class="progress-row">
            <div class="progress-row-label">
              <span class="color-chip ${row.colorClass}"></span>
              ${escapeHtml(row.label)}
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct.toFixed(1)}%"></div>
            </div>
            <div class="progress-value">${row.value} â€¢ ${pct.toFixed(0)} %</div>
          </div>
        `;
      }).join("");
    }

    function renderTopProductsProgress(context) {
      const body = document.getElementById("topProductsProgress");
      const items = aggregateProductStats(context.lignesFiltered)
        .sort((a, b) => b.quantite - a.quantite)
        .slice(0, 6);

      if (!items.length) {
        body.innerHTML = `<div class="empty-state">Aucun produit sur la pÃ©riode.</div>`;
        return;
      }

      const max = Math.max(...items.map(i => i.quantite), 1);

      body.innerHTML = items.map(item => `
        <div class="progress-row">
          <div class="progress-row-label">${escapeHtml(item.nom)}</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${(item.quantite / max) * 100}%"></div>
          </div>
          <div class="progress-value">${item.quantite}</div>
        </div>
      `).join("");
    }

    function renderTopClients(context) {
      const body = document.getElementById("topClientsBody");
      const rows = aggregateClientStats(context.visitesFiltered)
        .sort((a, b) => b.ca - a.ca)
        .slice(0, 10);

      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="6"><div class="empty-state">Aucun client sur la pÃ©riode.</div></td></tr>`;
        return;
      }

      body.innerHTML = rows.map(row => `
        <tr>
          <td>${escapeHtml(row.nom)}</td>
          <td>${escapeHtml(row.numero_compte)}</td>
          <td class="number">${row.visites}</td>
          <td class="number">${formatCurrency(row.ca)}</td>
          <td class="number">${formatCurrency(row.panierMoyen)}</td>
          <td><button class="link-btn" onclick="goToClient('${String(row.client_id).replace(/'/g, "\\'")}')">Voir fiche</button></td>
        </tr>
      `).join("");
    }

    function renderPriorityActions(context) {
      const body = document.getElementById("priorityActions");
      const redCount = context.lignesFiltered.filter(l => normalizeColor(l.couleur) === "red").length;
      const lowStockCount = buildLowStockLines(context.lignesFiltered).length;
      const noOrderCount = buildVisitsWithoutOrders(context.visitesFiltered, context.lignesFiltered).length;
      const inactiveCount = buildInactiveClients(30).length;

      const items = [
        {
          title: "Traiter les rappels rouges",
          sub: "RemontÃ©es terrain signalÃ©es comme sensibles",
          badge: `${redCount} rouge${redCount > 1 ? "s" : ""}`,
          badgeClass: "badge-danger",
      action: `<a class="btn btn-danger" href="rappelclt.html">Ouvrir</a>`
        },
        {
          title: "Relancer les clients inactifs",
          sub: "Clients non visitÃ©s depuis plus de 30 jours",
          badge: `${inactiveCount}`,
          badgeClass: "badge-warning",
          action: ``
        },
        {
          title: "VÃ©rifier les stocks bas",
          sub: "Clients avec stock faible observÃ© en visite",
          badge: `${lowStockCount}`,
          badgeClass: "badge-danger",
          action: ``
        },
        {
          title: "Analyser les visites sans commande",
          sub: "Visites faites mais sans ligne produit",
          badge: `${noOrderCount}`,
          badgeClass: "badge-info",
          action: ``
        }
      ];

      body.innerHTML = items.map(item => `
        <div class="action-item">
          <div class="action-main">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.sub)}</span>
          </div>
          <div class="action-right">
            <span class="badge ${item.badgeClass}">${escapeHtml(item.badge)}</span>
            ${item.action}
          </div>
        </div>
      `).join("");
    }

    function renderRelanceList() {
      const body = document.getElementById("relanceList");
      const rows = buildInactiveClients(30).slice(0, 8);

      if (!rows.length) {
        body.innerHTML = `<div class="empty-state">Aucun client en retard de visite.</div>`;
        return;
      }

      body.innerHTML = rows.map(item => `
        <div class="action-item">
          <div class="action-main">
            <strong>${escapeHtml(item.nom)}</strong>
            <span>Compte ${escapeHtml(item.numero_compte)} â€¢ DerniÃ¨re visite : ${item.lastDate ? formatDate(item.lastDate) : "jamais"}</span>
          </div>
          <div class="action-right">
            <button class="link-btn" onclick="goToClient('${String(item.client_id).replace(/'/g, "\\'")}')">Voir fiche</button>
          </div>
        </div>
      `).join("");
    }

    function renderRedList() {
      const body = document.getElementById("redList");
      const rows = buildRedLinesAll().slice(0, 8);

      if (!rows.length) {
        body.innerHTML = `<div class="empty-state">Aucune ligne rouge enregistrÃ©e.</div>`;
        return;
      }

      body.innerHTML = rows.map(item => `
        <div class="action-item">
          <div class="action-main">
            <strong>${escapeHtml(item.client_nom)} â€¢ ${escapeHtml(item.produit_nom)}</strong>
            <span>Compte ${escapeHtml(item.numero_compte)} â€¢ ${formatDate(item.date_visite)}${item.note ? " â€¢ " + escapeHtml(item.note) : ""}</span>
          </div>
          <div class="action-right">
            <button class="link-btn" onclick="goToClient('${String(item.client_id).replace(/'/g, "\\'")}')">Voir fiche</button>
          </div>
        </div>
      `).join("");
    }

    function renderLastVisits(context) {
      const body = document.getElementById("lastVisitsList");
      const rows = [...context.visitesFiltered].slice(0, 8);

      if (!rows.length) {
        body.innerHTML = `<div class="empty-state">Aucune visite sur la pÃ©riode.</div>`;
        return;
      }

      body.innerHTML = rows.map(visite => {
        const client = getClientById(visite.client_id);
        return `
          <div class="action-item">
            <div class="action-main">
              <strong>${escapeHtml(client?.nom || "Client")}</strong>
              <span>${formatDate(visite.date_visite)} â€¢ ${formatCurrency(visite.total_commande || 0)}${visite.note ? " â€¢ " + escapeHtml(visite.note) : ""}</span>
            </div>
            <div class="action-right">
              <button class="link-btn" onclick="goToClient('${String(client?.id || "").replace(/'/g, "\\'")}')">Voir fiche</button>
            </div>
          </div>
        `;
      }).join("");
    }

    function renderOpportunityList(context) {
      const body = document.getElementById("opportunityList");
      const products = aggregateProductStats(context.lignesFiltered)
        .sort((a, b) => a.quantite - b.quantite)
        .slice(0, 6);

      if (!products.length) {
        body.innerHTML = `<div class="empty-state">Aucune opportunitÃ© produit sur la pÃ©riode.</div>`;
        return;
      }

      body.innerHTML = products.map(item => `
        <div class="action-item">
          <div class="action-main">
            <strong>${escapeHtml(item.nom)}</strong>
            <span>RÃ©f ${escapeHtml(item.reference_produit)} â€¢ QtÃ© ${item.quantite} â€¢ ${item.clientsCount} client${item.clientsCount > 1 ? "s" : ""}</span>
          </div>
          <div class="action-right">
            <span class="pill">Rouges : ${item.rouges}</span>
            <span class="pill">CA : ${formatCurrency(item.ca)}</span>
          </div>
        </div>
      `).join("");
    }

    function renderProductsDetail(context) {
      const body = document.getElementById("productsDetailBody");
      const rows = aggregateProductStats(context.lignesFiltered)
        .sort((a, b) => b.ca - a.ca);

      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="6"><div class="empty-state">Aucun produit sur la pÃ©riode.</div></td></tr>`;
        return;
      }

      body.innerHTML = rows.map(item => `
        <tr>
          <td>${escapeHtml(item.nom)}</td>
          <td>${escapeHtml(item.reference_produit)}</td>
          <td class="number">${item.quantite}</td>
          <td class="number">${formatCurrency(item.ca)}</td>
          <td class="number">${item.clientsCount}</td>
          <td class="number">${item.rouges}</td>
        </tr>
      `).join("");
    }

    function renderAll(context) {
      filteredContext = context;
      renderHero(context);
      renderAlerts(context);
      renderActivityKpis(context);
      renderColorProgress(context);
      renderTopProductsProgress(context);
      renderTopClients(context);
      renderPriorityActions(context);
      renderRelanceList();
      renderRedList();
      renderLastVisits(context);
      renderOpportunityList(context);
      renderProductsDetail(context);

      setStatus(
        `Dashboard Ã  jour â€¢ ${context.visitesFiltered.length} visite(s) â€¢ ${context.lignesFiltered.length} ligne(s) â€¢ ${clients.length} client(s) â€¢ ${produits.length} produit(s)`
      );
    }

    function applyFilters() {
      const context = buildContext();
      renderAll(context);
    }

    async function refreshDashboard() {
      try {
        setStatus("Actualisation des donnÃ©es...");
        await fetchAllData();
        applyFilters();
      } catch (error) {
        console.error(error);
        setStatus("Erreur de chargement du tableau de bord.");
        alert("Erreur lors du chargement des donnÃ©es dashboard.");
      }
    }

    document.getElementById("periodSelect").addEventListener("change", () => {
      setDefaultDatesFromPeriod();
      applyFilters();
    });

    document.getElementById("dateStart").addEventListener("change", () => {
      document.getElementById("periodSelect").value = "custom";
      applyFilters();
    });

    document.getElementById("dateEnd").addEventListener("change", () => {
      document.getElementById("periodSelect").value = "custom";
      applyFilters();
    });

    document.getElementById("clientSearch").addEventListener("input", applyFilters);

    async function initDashboard() {
      try {
        setStatus("Connexion Ã  Supabase...");
        setDefaultDatesFromPeriod();
        await fetchAllData();
        applyFilters();
      } catch (error) {
        console.error("Erreur initDashboard:", error);
        setStatus("Erreur de connexion Ã  Supabase.");
        alert("Impossible de charger le tableau de bord. VÃ©rifie la clÃ© Supabase et les policies.");
      }
    }

    initDashboard();
  
