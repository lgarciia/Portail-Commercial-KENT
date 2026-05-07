
    const SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const state = {
      clients: [],
      produits: [],
      produitsActifs: [],
      visites: [],
      plaques: [],
      tarifsPlaques: [],
      currentView: "timeline",
      activeVisitId: null
    };

    const dom = {};
    const VISIT_TYPE_SALE = "vente";
    const VISIT_TYPE_LABELS = {
      vente: "Vente",
      passage_sans_vente: "Passage sans vente",
      client_ferme: "Client ferme"
    };

    function cacheDom() {
      dom.clientSearch = document.getElementById("clientSearch");
      dom.clientSelect = document.getElementById("clientSelect");
      dom.selectedClientInfo = document.getElementById("selectedClientInfo");
      dom.clientNameCard = document.getElementById("clientNameCard");
      dom.clientNumeroCompte = document.getElementById("clientNumeroCompte");
      dom.clientTelephone = document.getElementById("clientTelephone");
      dom.clientAdresse = document.getElementById("clientAdresse");
      dom.clientPlaque = document.getElementById("clientPlaque");
      dom.clientTerrainStatus = document.getElementById("clientTerrainStatus");
      dom.clientLastVisit = document.getElementById("clientLastVisit");
      dom.clientTopProduct = document.getElementById("clientTopProduct");
      dom.statusBar = document.getElementById("statusBar");
      dom.activeViewLabel = document.getElementById("activeViewLabel");
      dom.selectedClientSyncLabel = document.getElementById("selectedClientSyncLabel");
      dom.statNbVisites = document.getElementById("statNbVisites");
      dom.statCaCumule = document.getElementById("statCaCumule");
      dom.statPanierMoyen = document.getElementById("statPanierMoyen");
      dom.statNbProduits = document.getElementById("statNbProduits");
      dom.statVisitsWithSale = document.getElementById("statVisitsWithSale");
      dom.statVisitsWithoutSale = document.getElementById("statVisitsWithoutSale");
      dom.statTransformRate = document.getElementById("statTransformRate");
      dom.timelineView = document.getElementById("timelineView");
      dom.timelineList = document.getElementById("timelineList");
      dom.matrixView = document.getElementById("matrixView");
      dom.visitesTableHead = document.getElementById("visitesTableHead");
      dom.visitesTableBody = document.getElementById("visitesTableBody");
      dom.viewButtons = [...document.querySelectorAll(".view-switch [data-view]")];
      dom.openTopProductsBtn = document.getElementById("openTopProductsBtn");
      dom.openClientModalBtn = document.getElementById("openClientModalBtn");
      dom.openVisitModalBtn = document.getElementById("openVisitModalBtn");
      dom.mobileAddVisitBtn = document.getElementById("mobileAddVisitBtn");
      dom.visitModalOverlay = document.getElementById("visitModalOverlay");
      dom.visitModalTitle = document.getElementById("visitModalTitle");
      dom.visitModalSubtitle = document.getElementById("visitModalSubtitle");
      dom.closeVisitModalBtn = document.getElementById("closeVisitModalBtn");
      dom.cancelVisitBtn = document.getElementById("cancelVisitBtn");
      dom.visitForm = document.getElementById("visitForm");
      dom.popupDate = document.getElementById("popupDate");
      dom.popupClient = document.getElementById("popupClient");
      dom.popupVisitType = document.getElementById("popupVisitType");
      dom.popupNote = document.getElementById("popupNote");
      dom.productsFormList = document.getElementById("productsFormList");
      dom.popupTotalCommande = document.getElementById("popupTotalCommande");
      dom.popupPricingHint = document.getElementById("popupPricingHint");
      dom.popupVisitTypeHint = document.getElementById("popupVisitTypeHint");
      dom.addProductRowBtn = document.getElementById("addProductRowBtn");
      dom.saveVisitBtn = document.getElementById("saveVisitBtn");
      dom.topProduitsOverlay = document.getElementById("topProduitsOverlay");
      dom.topProduitsList = document.getElementById("topProduitsList");
      dom.closeTopProduitsBtn = document.getElementById("closeTopProduitsBtn");
      dom.clientModalOverlay = document.getElementById("clientModalOverlay");
      dom.clientModalTitle = document.getElementById("clientModalTitle");
      dom.clientModalSubtitle = document.getElementById("clientModalSubtitle");
      dom.closeClientModalBtn = document.getElementById("closeClientModalBtn");
      dom.cancelClientBtn = document.getElementById("cancelClientBtn");
      dom.clientForm = document.getElementById("clientForm");
      dom.clientNomInput = document.getElementById("clientNomInput");
      dom.clientNumeroCompteInput = document.getElementById("clientNumeroCompteInput");
      dom.clientTelephoneInput = document.getElementById("clientTelephoneInput");
      dom.clientAdresseInput = document.getElementById("clientAdresseInput");
      dom.clientPlaqueSelect = document.getElementById("clientPlaqueSelect");
      dom.saveClientBtn = document.getElementById("saveClientBtn");
      dom.toastContainer = document.getElementById("toastContainer");
      dom.produitsDatalist = document.getElementById("produitsDatalist");
    }

    function setStatus(message, tone = "info") {
      dom.statusBar.textContent = message;
      dom.statusBar.dataset.tone = tone;
    }

    function showToast(message, tone = "info") {
      const toast = document.createElement("div");
      toast.className = `toast ${tone}`;
      toast.textContent = message;
      dom.toastContainer.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add("visible"));
      setTimeout(() => {
        toast.classList.remove("visible");
        setTimeout(() => toast.remove(), 220);
      }, 3200);
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function normalizeText(value) {
      return String(value ?? "").trim().toLowerCase();
    }

    function normalizeVisitType(value) {
      const normalized = normalizeText(value).replaceAll("-", "_").replaceAll(" ", "_");
      if (normalized === "vente") return "vente";
      if (normalized === "passage_sans_vente") return "passage_sans_vente";
      if (normalized === "client_ferme") return "client_ferme";
      return "";
    }

    function resolveVisitType(value) {
      return normalizeVisitType(value) || VISIT_TYPE_SALE;
    }

    function isSaleVisitType(value) {
      return resolveVisitType(value) === VISIT_TYPE_SALE;
    }

    function getVisitTypeLabel(value) {
      const key = resolveVisitType(value);
      return VISIT_TYPE_LABELS[key] || VISIT_TYPE_LABELS[VISIT_TYPE_SALE];
    }

    function buildVisitTypeBadgeHtml(value) {
      const key = resolveVisitType(value);
      const badgeClass = key === VISIT_TYPE_SALE ? "sale" : "no-sale";
      return `<span class="visit-type-badge ${badgeClass}">${escapeHtml(getVisitTypeLabel(key))}</span>`;
    }

    function parseLocalDate(dateStr) {
      if (!dateStr) return null;
      const [year, month, day] = String(dateStr).split("-").map(Number);
      if (!year || !month || !day) return null;
      return new Date(year, month - 1, day);
    }

    function formatDate(dateStr) {
      const parsed = parseLocalDate(dateStr);
      return parsed ? parsed.toLocaleDateString("fr-FR") : "â€”";
    }

    function formatDateLong(dateStr) {
      const parsed = parseLocalDate(dateStr);
      return parsed
        ? parsed.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
        : "â€”";
    }

    function formatCurrency(value) {
      return Number(value || 0).toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR"
      });
    }

    function getTodayIsoLocal() {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      return local.toISOString().split("T")[0];
    }

    function getClientById(id) {
      return state.clients.find(client => String(client.id) === String(id));
    }

    function getProduitById(id) {
      return state.produits.find(produit => String(produit.id) === String(id));
    }

    function getProduitDisplay(id) {
      return getProduitById(id) || { id, nom: "Produit archivÃ©", reference_produit: "" };
    }

    function getClientPlaqueLabel(client) {
      return client?.plaques?.nom || "â€”";
    }

    function getProductLabel(produit) {
      if (!produit) return "";
      return produit.reference_produit ? `${produit.reference_produit} - ${produit.nom || ""}` : (produit.nom || "");
    }

    function getClientIdFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get("client_id");
    }

    function getSelectedClientId() {
      return dom.clientSelect.value;
    }

    function getPopupSelectedClientId() {
      return dom.popupClient.value;
    }

    function getColorDotHtml(color = "green") {
      return `<span class="color-dot ${escapeHtml(color)}"></span>`;
    }

    async function fetchClients() {
      const { data, error } = await supabaseClient
        .from("clients")
        .select(`
          id,
          nom,
          numero_compte,
          adresse,
          telephone,
          plaque_id,
          plaques ( id, nom )
        `)
        .order("nom", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    async function fetchProduits() {
      const pageSize = 1000;
      let from = 0;
      const all = [];

      while (true) {
        const to = from + pageSize - 1;
        const { data, error } = await supabaseClient
          .from("produits")
          .select("id, nom, actif, reference_produit, prix_vente")
          .order("nom", { ascending: true })
          .range(from, to);

        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }

      return all;
    }

    async function fetchTarifsPlaques() {
      const pageSize = 1000;
      let from = 0;
      const all = [];

      while (true) {
        const to = from + pageSize - 1;
        const { data, error } = await supabaseClient
          .from("tarifs_plaques")
          .select("plaque_id, produit_id, prix_vente")
          .order("plaque_id", { ascending: true })
          .order("produit_id", { ascending: true })
          .range(from, to);

        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }

      return all;
    }

    async function fetchPlaques() {
      const { data, error } = await supabaseClient
        .from("plaques")
        .select("id, nom")
        .order("nom", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    async function fetchVisitesByClient(clientId) {
      const { data, error } = await supabaseClient
        .from("visites")
        .select(`
          id,
          client_id,
          date_visite,
          note,
          type_visite,
          total_commande,
          visite_commandes (
            id,
            produit_id,
            quantite,
            stock_client,
            couleur,
            prix_unitaire
          )
        `)
        .eq("client_id", clientId)
        .order("date_visite", { ascending: false });

      if (error) throw error;

      return (data || []).map(visite => ({
        ...visite,
        type_visite: normalizeVisitType(visite.type_visite),
        commandes: visite.visite_commandes || []
      }));
    }

    function getTarifPlaque(clientId, produitId) {
      const client = getClientById(clientId);
      const produit = getProduitById(produitId);
      if (!produit) return 0;

      const fallbackPrix = Number(produit.prix_vente || 0);
      const plaqueId = client?.plaque_id;
      if (!plaqueId) return fallbackPrix;

      const tarif = state.tarifsPlaques.find(item =>
        String(item.plaque_id) === String(plaqueId) &&
        String(item.produit_id) === String(produitId)
      );

      return tarif ? Number(tarif.prix_vente || 0) : fallbackPrix;
    }

    function clearClientContext() {
      dom.selectedClientInfo.textContent = "Aucun client";
      dom.clientNameCard.textContent = "Aucun client";
      dom.selectedClientSyncLabel.textContent = "Aucun client";
      dom.clientNumeroCompte.textContent = "â€”";
      dom.clientTelephone.textContent = "â€”";
      dom.clientAdresse.textContent = "â€”";
      dom.clientPlaque.textContent = "â€”";
      dom.clientTerrainStatus.textContent = "SÃ©lectionne un client pour dÃ©marrer";
      dom.clientLastVisit.textContent = "â€”";
      dom.clientTopProduct.textContent = "â€”";
    }

    function updateClientHeader() {
      const client = getClientById(getSelectedClientId());
      if (!client) return clearClientContext();

      const clientName = client.nom || "Client sans nom";
      dom.selectedClientInfo.textContent = clientName;
      dom.clientNameCard.textContent = clientName;
      dom.selectedClientSyncLabel.textContent = clientName;
      dom.clientNumeroCompte.textContent = client.numero_compte || "â€”";
      dom.clientTelephone.textContent = client.telephone || "â€”";
      dom.clientAdresse.textContent = client.adresse || "â€”";
      dom.clientPlaque.textContent = getClientPlaqueLabel(client);
      dom.clientTerrainStatus.textContent = "Fiche client prÃªte pour le rendez-vous";
    }

    function isVisitWithSale(visite) {
      const normalizedType = normalizeVisitType(visite?.type_visite);
      if (normalizedType === VISIT_TYPE_SALE) return true;
      if (normalizedType && normalizedType !== VISIT_TYPE_SALE) return false;
      if (Number(visite?.total_commande || 0) > 0) return true;
      return (visite?.commandes || []).length > 0;
    }

    function updateStats(currentVisites) {
      const nbVisites = currentVisites.length;
      const caCumule = currentVisites.reduce((sum, visite) => sum + Number(visite.total_commande || 0), 0);
      const panierMoyen = nbVisites ? caCumule / nbVisites : 0;
      const produitIds = new Set();

      const visitsWithSale = currentVisites.filter(isVisitWithSale).length;
      const visitsWithoutSale = Math.max(0, nbVisites - visitsWithSale);
      const transformRate = nbVisites ? (visitsWithSale / nbVisites) * 100 : 0;

      currentVisites.forEach(visite => {
        (visite.commandes || []).forEach(commande => {
          if (commande.produit_id) produitIds.add(commande.produit_id);
        });
      });

      dom.statNbVisites.textContent = String(nbVisites);
      dom.statCaCumule.textContent = formatCurrency(caCumule);
      dom.statPanierMoyen.textContent = formatCurrency(panierMoyen);
      dom.statNbProduits.textContent = String(produitIds.size);
      if (dom.statVisitsWithSale) dom.statVisitsWithSale.textContent = String(visitsWithSale);
      if (dom.statVisitsWithoutSale) dom.statVisitsWithoutSale.textContent = String(visitsWithoutSale);
      if (dom.statTransformRate) dom.statTransformRate.textContent = `${transformRate.toFixed(0)} %`;
    }

    function updateClientInsights(currentVisites) {
      if (!currentVisites.length) {
        dom.clientLastVisit.textContent = "Aucune visite";
        dom.clientTopProduct.textContent = "Aucun historique";
        return;
      }

      dom.clientLastVisit.textContent = formatDateLong(currentVisites[0].date_visite);

      const aggregation = {};
      currentVisites.forEach(visite => {
        (visite.commandes || []).forEach(commande => {
          const produit = getProduitDisplay(commande.produit_id);
          if (!aggregation[commande.produit_id]) {
            aggregation[commande.produit_id] = { nom: produit.nom || "Produit", quantite: 0 };
          }
          aggregation[commande.produit_id].quantite += Number(commande.quantite || 0);
        });
      });

      const topProduct = Object.values(aggregation).sort((a, b) => {
        if (b.quantite !== a.quantite) return b.quantite - a.quantite;
        return (a.nom || "").localeCompare(b.nom || "", "fr");
      })[0];

      dom.clientTopProduct.textContent = topProduct ? `${topProduct.nom} (${topProduct.quantite})` : "Aucun historique";
    }

    function getFilteredClients() {
      const query = normalizeText(dom.clientSearch.value);
      if (!query) return [...state.clients];

      return state.clients.filter(client =>
        [client.nom, client.numero_compte, client.telephone, client.adresse]
          .some(value => normalizeText(value).includes(query))
      );
    }

    function buildPlaqueOptions(selectedPlaqueId = "") {
      const selected = selectedPlaqueId ? String(selectedPlaqueId) : "";
      if (!state.plaques.length) {
        return '<option value="">Aucune plaque disponible</option>';
      }

      const options = ['<option value="">Selectionner une plaque</option>'];
      state.plaques.forEach(plaque => {
        const isSelected = String(plaque.id) === selected ? " selected" : "";
        options.push(`<option value="${escapeHtml(plaque.id)}"${isSelected}>${escapeHtml(plaque.nom || "Plaque")}</option>`);
      });
      return options.join("");
    }

    function resetClientForm() {
      dom.clientModalTitle.textContent = "Ajout client";
      dom.clientModalSubtitle.textContent = "Ajoute un client avec toutes les infos terrain pour le retrouver tout de suite dans la liste des visites.";
      dom.clientNomInput.value = "";
      dom.clientNumeroCompteInput.value = "";
      dom.clientTelephoneInput.value = "";
      dom.clientAdresseInput.value = "";
      dom.clientPlaqueSelect.innerHTML = buildPlaqueOptions();
      dom.saveClientBtn.textContent = "Enregistrer client";
    }

    function openClientModal() {
      resetClientForm();
      dom.clientModalOverlay.classList.add("active");
      setTimeout(() => dom.clientNomInput.focus(), 30);
    }

    function closeClientModal() {
      dom.clientModalOverlay.classList.remove("active");
    }

    function findExistingClientByCompteAndPlaque(numeroCompte, plaqueId) {
      return state.clients.find(client =>
        normalizeText(client.numero_compte) === normalizeText(numeroCompte) &&
        String(client.plaque_id) === String(plaqueId)
      ) || null;
    }

    async function saveClient(event) {
      event.preventDefault();

      const nom = String(dom.clientNomInput.value || "").trim();
      const numeroCompte = String(dom.clientNumeroCompteInput.value || "").trim();
      const telephone = String(dom.clientTelephoneInput.value || "").trim();
      const adresse = String(dom.clientAdresseInput.value || "").trim();
      const plaqueId = dom.clientPlaqueSelect.value;

      if (!nom) return showToast("Renseigne le nom du client.", "warning");
      if (!numeroCompte) return showToast("Renseigne le numero client / compte.", "warning");
      if (!plaqueId) return showToast("Selectionne une plaque.", "warning");

      const existingClient = findExistingClientByCompteAndPlaque(numeroCompte, plaqueId);
      if (existingClient) {
        showToast("Ce client existe deja pour cette plaque.", "warning");
        dom.clientSearch.value = "";
        renderClientOptions(existingClient.id);
        dom.clientSelect.value = String(existingClient.id);
        closeClientModal();
        await loadVisites();
        return;
      }

      const payload = {
        nom,
        numero_compte: numeroCompte,
        telephone: telephone || null,
        adresse: adresse || null,
        plaque_id: plaqueId
      };

      try {
        dom.saveClientBtn.disabled = true;
        setStatus("Enregistrement du client...", "info");

        const { data, error } = await supabaseClient
          .from("clients")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;

        const insertedClientId = data?.id ? String(data.id) : "";
        state.clients = await fetchClients();

        let targetClientId = insertedClientId;
        if (!targetClientId) {
          const fallback = findExistingClientByCompteAndPlaque(numeroCompte, plaqueId);
          targetClientId = fallback?.id ? String(fallback.id) : "";
        }

        dom.clientSearch.value = "";
        renderClientOptions(targetClientId || null);
        if (targetClientId) dom.clientSelect.value = String(targetClientId);
        updatePopupClientOptions();

        closeClientModal();
        await loadVisites();
        setStatus("Client ajoute et selectionne.", "success");
        showToast("Client ajoute avec succes.", "success");
      } catch (error) {
        console.error("Erreur saveClient:", error);
        setStatus("Erreur lors de l'ajout du client.", "error");
        showToast("Impossible d'ajouter le client.", "error");
      } finally {
        dom.saveClientBtn.disabled = false;
      }
    }

    function renderTimelineEmpty(message) {
      dom.timelineList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    }

    function renderMatrixEmpty(message) {
      dom.visitesTableHead.innerHTML = `
        <tr>
          <th class="sticky-col sticky-col-1">Date</th>
          <th class="sticky-col sticky-col-2">Total</th>
          <th class="type-col">Type visite</th>
          <th class="note-cell note-col">Note</th>
          <th class="actions-col">Actions</th>
        </tr>
      `;
      dom.visitesTableBody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">${escapeHtml(message)}</div>
          </td>
        </tr>
      `;
    }

    function renderClientOptions(preferredClientId = null) {
      const filteredClients = getFilteredClients();
      const currentValue = preferredClientId ?? dom.clientSelect.value;
      dom.clientSelect.innerHTML = "";

      if (!filteredClients.length) {
        dom.clientSelect.innerHTML = '<option value="">Aucun client trouvÃ©</option>';
        state.visites = [];
        clearClientContext();
        updateStats([]);
        renderTimelineEmpty("Aucun client trouvÃ© avec cette recherche.");
        renderMatrixEmpty("Aucun client trouvÃ© avec cette recherche.");
        setStatus("Aucun client ne correspond Ã  la recherche.", "warning");
        return false;
      }

      filteredClients.forEach(client => {
        const option = document.createElement("option");
        option.value = client.id;
        option.textContent = client.nom;
        dom.clientSelect.appendChild(option);
      });

      const nextValue = filteredClients.some(client => String(client.id) === String(currentValue))
        ? String(currentValue)
        : String(filteredClients[0].id);

      dom.clientSelect.value = nextValue;
      updateClientHeader();
      refreshProductDatalist(nextValue);
      return true;
    }

    function applyClientSelectionFromUrl() {
      const clientIdFromUrl = getClientIdFromUrl();
      if (!clientIdFromUrl) return false;
      const exists = state.clients.some(client => String(client.id) === String(clientIdFromUrl));
      if (!exists) return false;

      dom.clientSearch.value = "";
      renderClientOptions(clientIdFromUrl);
      return true;
    }

    function getDynamicProducts() {
      const productIds = new Set();
      state.visites.forEach(visite => {
        (visite.commandes || []).forEach(commande => {
          if (commande.produit_id) productIds.add(commande.produit_id);
        });
      });

      return [...productIds]
        .map(id => getProduitDisplay(id))
        .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    }

    function renderTimelineCard(visite) {
      const commandes = [...(visite.commandes || [])].sort((a, b) => {
        const produitA = getProduitDisplay(a.produit_id);
        const produitB = getProduitDisplay(b.produit_id);
        return (produitA.nom || "").localeCompare(produitB.nom || "", "fr");
      });

      const totalUnites = commandes.reduce((sum, commande) => sum + Number(commande.quantite || 0), 0);
      const note = visite.note?.trim() || "Aucune note renseignÃ©e pour cette visite.";
      const linesHtml = commandes.length
        ? commandes.map(commande => {
            const produit = getProduitDisplay(commande.produit_id);
            const lineTotal = Number(commande.quantite || 0) * Number(commande.prix_unitaire || 0);

            return `
              <div class="visit-line">
                <div class="visit-line-main">
                  ${getColorDotHtml(commande.couleur || "green")}
                  <div class="visit-line-name">
                    <strong>${escapeHtml(produit.nom || "Produit")}</strong>
                    <span>${escapeHtml(produit.reference_produit || "Sans rÃ©fÃ©rence")}</span>
                  </div>
                </div>
                <div class="visit-line-metrics">
                  <div class="metric-chip">QtÃ© <strong>${Number(commande.quantite || 0)}</strong></div>
                  <div class="metric-chip">Stock <strong>${Number(commande.stock_client || 0)}</strong></div>
                  <div class="metric-chip">PU <strong>${formatCurrency(commande.prix_unitaire || 0)}</strong></div>
                  <div class="metric-chip">Ligne <strong>${formatCurrency(lineTotal)}</strong></div>
                </div>
              </div>
            `;
          }).join("")
        : `<div class="note-card"><span>Produits</span><p>Aucune ligne produit pour ce type de visite.</p></div>`;

      return `
        <article class="visit-card">
          <div class="visit-card-head">
            <div>
              <div class="visit-date-label">Visite</div>
              <div class="visit-date-value">${escapeHtml(formatDateLong(visite.date_visite))}</div>
              <div class="visit-badges">
                ${buildVisitTypeBadgeHtml(visite.type_visite)}
                <div class="mini-badge">${commandes.length} produit(s)</div>
                <div class="mini-badge">${totalUnites} unitÃ©(s)</div>
              </div>
            </div>
            <div class="visit-total-box">
              <span>Total commande</span>
              <strong>${formatCurrency(visite.total_commande || 0)}</strong>
            </div>
          </div>

          <div class="note-card">
            <span>Note terrain</span>
            <p>${escapeHtml(note)}</p>
          </div>

          <div class="visit-lines">${linesHtml}</div>

          <div class="visit-card-foot">
            <div class="mini-badge">ID visite ${escapeHtml(visite.id)}</div>
            <div class="actions-inline">
              <button class="btn btn-warning btn-sm" type="button" data-action="edit" data-visite-id="${escapeHtml(visite.id)}">Modifier</button>
              <button class="btn btn-danger btn-sm" type="button" data-action="delete" data-visite-id="${escapeHtml(visite.id)}">Supprimer</button>
            </div>
          </div>
        </article>
      `;
    }

    function renderTimelineView() {
      if (!getSelectedClientId()) return renderTimelineEmpty("SÃ©lectionne un client pour afficher lâ€™historique terrain.");
      if (!state.visites.length) return renderTimelineEmpty("Aucune visite enregistrÃ©e pour ce client.");
      dom.timelineList.innerHTML = state.visites.map(renderTimelineCard).join("");
    }

    function renderMatrixView() {
      if (!getSelectedClientId()) return renderMatrixEmpty("SÃ©lectionne un client pour afficher la synthÃ¨se produit.");

      const produitsDynamiques = getDynamicProducts();
      let headHtml = `
        <tr>
          <th class="sticky-col sticky-col-1">Date</th>
          <th class="sticky-col sticky-col-2">Total</th>
          <th class="type-col">Type visite</th>
      `;

      produitsDynamiques.forEach(produit => {
        headHtml += `
          <th class="product-col">
            <div class="table-product-head">
              <strong>${escapeHtml(produit.nom || "Produit")}</strong>
              <span>${escapeHtml(produit.reference_produit || "") || "&nbsp;"}</span>
            </div>
          </th>
        `;
      });

      headHtml += `
          <th class="note-cell note-col">Note</th>
          <th class="actions-col">Actions</th>
        </tr>
      `;

      dom.visitesTableHead.innerHTML = headHtml;

      if (!state.visites.length) {
        dom.visitesTableBody.innerHTML = `
          <tr>
            <td colspan="${produitsDynamiques.length + 5}">
              <div class="empty-state">Aucune visite enregistrÃ©e pour ce client.</div>
            </td>
          </tr>
        `;
        return;
      }

      dom.visitesTableBody.innerHTML = state.visites.map(visite => {
        let rowHtml = `
          <tr>
            <td class="sticky-col sticky-col-1">${escapeHtml(formatDate(visite.date_visite))}</td>
            <td class="sticky-col sticky-col-2 table-total">${formatCurrency(visite.total_commande || 0)}</td>
            <td>${buildVisitTypeBadgeHtml(visite.type_visite)}</td>
        `;

        produitsDynamiques.forEach(produit => {
          const commande = (visite.commandes || []).find(item => String(item.produit_id) === String(produit.id));

          if (!commande) {
            rowHtml += `<td class="empty-cell">â€”</td>`;
          } else {
            rowHtml += `
              <td>
                <div class="table-product-cell">
                  <div>${getColorDotHtml(commande.couleur || "green")}</div>
                  <strong>Q ${Number(commande.quantite || 0)}</strong>
                  <span>Stock ${Number(commande.stock_client || 0)}</span>
                </div>
              </td>
            `;
          }
        });

        rowHtml += `
            <td class="note-cell note-text">${escapeHtml(visite.note || "â€”")}</td>
            <td>
              <div class="actions-inline">
                <button class="btn btn-warning btn-sm" type="button" data-action="edit" data-visite-id="${escapeHtml(visite.id)}">Modifier</button>
                <button class="btn btn-danger btn-sm" type="button" data-action="delete" data-visite-id="${escapeHtml(visite.id)}">Supprimer</button>
              </div>
            </td>
          </tr>
        `;
        return rowHtml;
      }).join("");
    }

    function renderAllViews() {
      renderTimelineView();
      renderMatrixView();
    }

    function setView(viewName) {
      state.currentView = viewName === "matrix" ? "matrix" : "timeline";
      dom.timelineView.classList.toggle("active", state.currentView === "timeline");
      dom.matrixView.classList.toggle("active", state.currentView === "matrix");
      dom.activeViewLabel.textContent = state.currentView === "matrix" ? "SynthÃ¨se produit" : "Terrain";

      dom.viewButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.view === state.currentView);
      });
    }

    async function loadVisites() {
      updateClientHeader();
      const clientId = getSelectedClientId();

      if (!clientId) {
        state.visites = [];
        updateStats([]);
        updateClientInsights([]);
        renderTimelineEmpty("SÃ©lectionne un client pour afficher lâ€™historique terrain.");
        renderMatrixEmpty("SÃ©lectionne un client pour afficher la synthÃ¨se produit.");
        return;
      }

      try {
        setStatus("Chargement des visites...", "info");
        state.visites = await fetchVisitesByClient(clientId);
        updateStats(state.visites);
        updateClientInsights(state.visites);
        renderAllViews();
        setStatus(`${state.visites.length} visite(s) chargÃ©e(s) pour ce client.`, "success");
      } catch (error) {
        console.error("Erreur loadVisites:", error);
        state.visites = [];
        updateStats([]);
        updateClientInsights([]);
        renderTimelineEmpty("Erreur de chargement des visites.");
        renderMatrixEmpty("Erreur de chargement des visites.");
        setStatus("Erreur lors du chargement Supabase.", "error");
        showToast("Impossible de charger les visites du client.", "error");
      }
    }

    function getProductsForClient(clientId) {
      const client = getClientById(clientId);
      if (!client) return [...state.produits];

      const plaqueId = client.plaque_id;
      if (!plaqueId) return [...state.produits];

      const productIds = new Set(
        state.tarifsPlaques
          .filter(item => String(item.plaque_id) === String(plaqueId))
          .map(item => String(item.produit_id))
      );

      if (!productIds.size) return [...state.produits];
      const filtered = state.produits.filter(produit => productIds.has(String(produit.id)));
      return filtered.length ? filtered : [...state.produits];
    }

    function buildProductDatalistOptions(clientId = null) {
      const resolvedClientId = clientId || getPopupSelectedClientId() || getSelectedClientId();
      const pool = getProductsForClient(resolvedClientId);
      return pool.map(produit => `<option value="${escapeHtml(getProductLabel(produit))}"></option>`).join("");
    }

    function refreshProductDatalist(clientId = null) {
      dom.produitsDatalist.innerHTML = buildProductDatalistOptions(clientId);
    }

    function findProduitFromSearch(value) {
      const query = normalizeText(value);
      if (!query) return null;

      return state.produits.find(produit => {
        const reference = produit.reference_produit || "";
        const nom = produit.nom || "";
        const label = getProductLabel(produit);

        return normalizeText(reference) === query ||
          normalizeText(nom) === query ||
          normalizeText(label) === query ||
          normalizeText(reference).includes(query) ||
          normalizeText(nom).includes(query) ||
          normalizeText(label).includes(query);
      }) || null;
    }

    function createColorPicker(defaultColor = "green") {
      return `
        <div class="color-picker" data-selected="${escapeHtml(defaultColor)}">
          <span class="color-choice red ${defaultColor === "red" ? "active" : ""}" data-color="red" title="Rouge"></span>
          <span class="color-choice yellow ${defaultColor === "yellow" ? "active" : ""}" data-color="yellow" title="Jaune"></span>
          <span class="color-choice green ${defaultColor === "green" ? "active" : ""}" data-color="green" title="Vert"></span>
          <span class="color-choice blue ${defaultColor === "blue" ? "active" : ""}" data-color="blue" title="Bleu"></span>
        </div>
      `;
    }

    function bindColorPicker(row) {
      const picker = row.querySelector(".color-picker");
      if (!picker) return;

      picker.querySelectorAll(".color-choice").forEach(choice => {
        choice.addEventListener("click", () => {
          picker.dataset.selected = choice.dataset.color;
          picker.querySelectorAll(".color-choice").forEach(item => item.classList.remove("active"));
          choice.classList.add("active");
        });
      });
    }

    function updatePopupPricingHint() {
      if (!isSaleVisitType(getPopupVisitType())) {
        dom.popupPricingHint.textContent = "Aucune saisie produit pour ce type de visite: le total est fixe a 0 EUR.";
        return;
      }

      const client = getClientById(getPopupSelectedClientId());
      const plaqueLabel = getClientPlaqueLabel(client);

      if (state.activeVisitId) {
        dom.popupPricingHint.textContent = "Les prix dÃ©jÃ  prÃ©sents restent figÃ©s. Si tu remplaces un produit, le tarif du client actuel sera repris.";
      } else {
        dom.popupPricingHint.textContent = plaqueLabel === "â€”"
          ? "Aucune plaque client dÃ©tectÃ©e: tarif standard produit appliquÃ©."
          : `Tarification active: plaque ${plaqueLabel}. Le prix sera figÃ© Ã  l'enregistrement.`;
      }
    }

    function updateRowLineTotal(row) {
      const quantite = parseInt(row.querySelector(".quantite-input").value, 10) || 0;
      const prixUnitaire = Number(row.querySelector(".prix-unitaire-input").value || 0);
      row.querySelector(".line-total-box").textContent = formatCurrency(quantite * prixUnitaire);
    }

    function syncProductRow(row) {
      const searchInput = row.querySelector(".produit-search-input");
      const hiddenInput = row.querySelector(".produit-id-input");
      const priceInput = row.querySelector(".prix-unitaire-input");
      const hint = row.querySelector(".product-selected-hint");
      const unitPriceBox = row.querySelector(".unit-price-box");
      const currentProduct = hiddenInput.value ? getProduitById(hiddenInput.value) : null;
      const typedValue = searchInput.value.trim();
      const matchedProduct = findProduitFromSearch(typedValue);

      let produit = matchedProduct;
      if (!produit && currentProduct) {
        const currentMatches = [currentProduct.nom, currentProduct.reference_produit, getProductLabel(currentProduct)]
          .some(value => normalizeText(value) === normalizeText(typedValue));
        if (currentMatches || !typedValue) produit = currentProduct;
      }

      if (!produit) {
        hiddenInput.value = "";
        priceInput.value = "";
        hint.textContent = typedValue ? "Produit non reconnu" : "Choisis un produit actif ou dÃ©jÃ  utilisÃ©";
        unitPriceBox.textContent = formatCurrency(0);
        updateRowLineTotal(row);
        return;
      }

      hiddenInput.value = produit.id;

      const keepsFrozenPrice =
        row.dataset.frozenPrice === "true" &&
        String(row.dataset.originalProductId) === String(produit.id) &&
        priceInput.value !== "";

      const prixUnitaire = keepsFrozenPrice
        ? Number(priceInput.value || 0)
        : getTarifPlaque(getPopupSelectedClientId(), produit.id);

      if (!keepsFrozenPrice) {
        priceInput.value = String(prixUnitaire);
        row.dataset.frozenPrice = "false";
        row.dataset.originalProductId = String(produit.id);
      }

      const client = getClientById(getPopupSelectedClientId());
      const plaqueLabel = getClientPlaqueLabel(client);
      const pricingSource = keepsFrozenPrice
        ? "Prix figÃ© de la visite"
        : (plaqueLabel === "â€”" ? "Tarif standard" : `Plaque ${plaqueLabel}`);

      hint.textContent = `${produit.nom || "Produit"}${produit.reference_produit ? " â€¢ " + produit.reference_produit : ""} â€¢ ${pricingSource}`;
      unitPriceBox.textContent = formatCurrency(prixUnitaire);
      updateRowLineTotal(row);
    }

    function updatePopupTotalCommande() {
      const rows = [...dom.productsFormList.querySelectorAll(".product-row")];
      const total = rows.reduce((sum, row) => {
        const produitId = row.querySelector(".produit-id-input").value;
        const quantite = parseInt(row.querySelector(".quantite-input").value, 10) || 0;
        const prixUnitaire = Number(row.querySelector(".prix-unitaire-input").value || 0);
        return produitId ? sum + quantite * prixUnitaire : sum;
      }, 0);

      dom.popupTotalCommande.textContent = formatCurrency(total);
    }

    function refreshAllPopupPrices() {
      [...dom.productsFormList.querySelectorAll(".product-row")].forEach(syncProductRow);
      updatePopupTotalCommande();
      refreshProductDatalist(getPopupSelectedClientId());
      updatePopupPricingHint();
    }

    function addProductRow(prefill = null) {
      if (!isSaleVisitType(getPopupVisitType())) return null;

      const produit = prefill?.produit_id ? getProduitDisplay(prefill.produit_id) : null;
      const label = produit ? getProductLabel(produit) : "";
      const initialPrice = prefill?.prix_unitaire != null
        ? Number(prefill.prix_unitaire || 0)
        : (produit ? getTarifPlaque(getPopupSelectedClientId(), produit.id) : 0);
      const frozenPrice = prefill?.prix_unitaire != null;

      const row = document.createElement("div");
      row.className = "product-row";
      row.dataset.frozenPrice = frozenPrice ? "true" : "false";
      row.dataset.originalProductId = produit ? String(produit.id) : "";

      row.innerHTML = `
        <div class="field-group">
          <label>Produit</label>
          <input type="text" class="produit-search-input" list="produitsDatalist" placeholder="Tape une rÃ©fÃ©rence ou un nom..." autocomplete="off" value="${escapeHtml(label)}" />
          <input type="hidden" class="produit-id-input" value="${escapeHtml(produit?.id || "")}" />
          <input type="hidden" class="prix-unitaire-input" value="${escapeHtml(initialPrice)}" />
          <div class="product-selected-hint">Choisis un produit actif ou dÃ©jÃ  utilisÃ©</div>
        </div>

        <div class="field-group">
          <label>QuantitÃ©</label>
          <input type="number" class="quantite-input" min="0" value="${Number(prefill?.quantite || 0)}" />
        </div>

        <div class="field-group">
          <label>Stock client</label>
          <input type="number" class="stock-input" min="0" value="${Number(prefill?.stock_client || 0)}" />
        </div>

        <div class="field-group">
          <label>Prix unit.</label>
          <div class="price-box unit-price-box">${formatCurrency(initialPrice)}</div>
        </div>

        <div class="field-group">
          <label>Total ligne</label>
          <div class="price-box line-total-box">${formatCurrency(Number(prefill?.quantite || 0) * initialPrice)}</div>
        </div>

        <div class="field-group">
          <label>Couleur</label>
          ${createColorPicker(prefill?.couleur || "green")}
        </div>

        <div class="field-group">
          <button class="btn btn-danger btn-sm remove-product-row-btn" type="button">Supprimer</button>
        </div>
      `;

      bindColorPicker(row);

      row.querySelector(".produit-search-input").addEventListener("input", () => {
        syncProductRow(row);
        updatePopupTotalCommande();
      });

      row.querySelector(".produit-search-input").addEventListener("change", () => {
        syncProductRow(row);
        updatePopupTotalCommande();
      });

      row.querySelector(".quantite-input").addEventListener("input", () => {
        updateRowLineTotal(row);
        updatePopupTotalCommande();
      });

      row.querySelector(".stock-input").addEventListener("input", () => {
        updateRowLineTotal(row);
        updatePopupTotalCommande();
      });

      row.querySelector(".remove-product-row-btn").addEventListener("click", () => {
        row.remove();
        if (isSaleVisitType(getPopupVisitType()) && !dom.productsFormList.querySelector(".product-row")) addProductRow();
        updatePopupTotalCommande();
      });

      dom.productsFormList.appendChild(row);
      syncProductRow(row);
      updatePopupTotalCommande();
    }

    function updatePopupClientOptions() {
      dom.popupClient.innerHTML = state.clients.map(client =>
        `<option value="${escapeHtml(client.id)}">${escapeHtml(client.nom || "Client")}</option>`
      ).join("");
    }

    function getPopupVisitType() {
      return resolveVisitType(dom.popupVisitType?.value || VISIT_TYPE_SALE);
    }

    function applyVisitTypeUiState(options = {}) {
      const keepRows = Boolean(options.keepRows);
      const visitType = getPopupVisitType();
      const saleVisit = isSaleVisitType(visitType);

      dom.popupVisitType.value = visitType;
      dom.productsFormList.classList.toggle("products-disabled", !saleVisit);
      dom.addProductRowBtn.disabled = !saleVisit;

      if (saleVisit) {
        if (!dom.productsFormList.querySelector(".product-row")) addProductRow();
        dom.popupVisitTypeHint.textContent = "La note terrain est obligatoire pour toute visite.";
      } else {
        if (!keepRows) dom.productsFormList.innerHTML = "";
        dom.popupVisitTypeHint.textContent = "Visite sans vente: produits bloques, note obligatoire, total force a 0 EUR.";
      }

      updatePopupPricingHint();
      updatePopupTotalCommande();
    }

    function openVisitModal(visiteId = null) {
      updatePopupClientOptions();
      dom.productsFormList.innerHTML = "";
      dom.popupTotalCommande.textContent = formatCurrency(0);

      if (visiteId) {
        const visite = state.visites.find(item => String(item.id) === String(visiteId));
        if (!visite) {
          showToast("Visite introuvable.", "warning");
          return;
        }

        state.activeVisitId = visite.id;
        dom.visitModalTitle.textContent = "Modifier la visite";
        dom.visitModalSubtitle.textContent = "MÃªme simplicitÃ© de saisie, avec conservation des prix dÃ©jÃ  figÃ©s dans la visite.";
        dom.saveVisitBtn.textContent = "Mettre Ã  jour";
        dom.popupClient.value = String(visite.client_id);
        dom.popupClient.disabled = true;
        dom.popupDate.value = visite.date_visite || getTodayIsoLocal();
        dom.popupVisitType.value = resolveVisitType(visite.type_visite);
        dom.popupNote.value = visite.note || "";

        if (isSaleVisitType(visite.type_visite) && (visite.commandes || []).length) {
          visite.commandes.forEach(addProductRow);
        } else if (isSaleVisitType(visite.type_visite)) {
          addProductRow();
        }
      } else {
        state.activeVisitId = null;
        dom.visitModalTitle.textContent = "Nouvelle visite";
        dom.visitModalSubtitle.textContent = "Saisie rapide terrain: note, produits, stock client et total calculÃ© immÃ©diatement.";
        dom.saveVisitBtn.textContent = "Enregistrer";
        dom.popupClient.disabled = false;
        dom.popupClient.value = getSelectedClientId() || (state.clients[0]?.id ? String(state.clients[0].id) : "");
        dom.popupDate.value = getTodayIsoLocal();
        dom.popupVisitType.value = VISIT_TYPE_SALE;
        dom.popupNote.value = "";
        addProductRow();
      }

      refreshProductDatalist(getPopupSelectedClientId());
      applyVisitTypeUiState();
      dom.visitModalOverlay.classList.add("active");

      setTimeout(() => {
        const firstInput = dom.productsFormList.querySelector(".produit-search-input");
        if (isSaleVisitType(getPopupVisitType()) && firstInput) firstInput.focus();
        if (!isSaleVisitType(getPopupVisitType())) dom.popupNote.focus();
      }, 30);
    }

    function closeVisitModal() {
      dom.visitModalOverlay.classList.remove("active");
      dom.popupClient.disabled = false;
      state.activeVisitId = null;
    }

    function collectCommandesFromForm() {
      if (!isSaleVisitType(getPopupVisitType())) {
        return { commandes: [], invalidFilledRow: false };
      }

      const rows = [...dom.productsFormList.querySelectorAll(".product-row")];
      const commandes = [];
      let invalidFilledRow = false;

      rows.forEach(row => {
        const produitId = row.querySelector(".produit-id-input").value;
        const typedValue = row.querySelector(".produit-search-input").value.trim();
        const quantite = parseInt(row.querySelector(".quantite-input").value, 10) || 0;
        const stockClient = parseInt(row.querySelector(".stock-input").value, 10) || 0;
        const couleur = row.querySelector(".color-picker")?.dataset.selected || "green";
        const prixUnitaire = Number(row.querySelector(".prix-unitaire-input").value || 0);
        const rowHasData = typedValue || quantite > 0 || stockClient > 0;

        if (rowHasData && !produitId) {
          invalidFilledRow = true;
          return;
        }

        if (produitId && (quantite > 0 || stockClient > 0)) {
          commandes.push({
            produit_id: produitId,
            quantite,
            stock_client: stockClient,
            couleur,
            prix_unitaire: prixUnitaire
          });
        }
      });

      return { commandes, invalidFilledRow };
    }

    async function saveVisit(event) {
      event.preventDefault();

      const clientId = dom.popupClient.value;
      const dateVisite = dom.popupDate.value;
      const typeVisite = getPopupVisitType();
      const note = dom.popupNote.value.trim();
      const { commandes, invalidFilledRow } = collectCommandesFromForm();
      const saleVisit = isSaleVisitType(typeVisite);

      if (!clientId) return showToast("SÃ©lectionne un client avant dâ€™enregistrer.", "warning");
      if (!dateVisite) return showToast("Renseigne une date de visite.", "warning");
      if (!note) return showToast("La note terrain est obligatoire pour enregistrer la visite.", "warning");
      if (invalidFilledRow) return showToast("Une ligne produit est renseignÃ©e mais le produit nâ€™est pas reconnu.", "warning");
      if (saleVisit && !commandes.length) return showToast("Ajoute au moins un produit valide avec quantitÃ© ou stock.", "warning");

      const totalCommande = saleVisit
        ? commandes.reduce((sum, commande) => {
            return sum + Number(commande.quantite || 0) * Number(commande.prix_unitaire || 0);
          }, 0)
        : 0;

      try {
        setStatus(state.activeVisitId ? "Mise Ã  jour de la visite..." : "Enregistrement de la visite...", "info");

        if (state.activeVisitId) {
          const visiteId = state.activeVisitId;

          const { error: updateVisiteError } = await supabaseClient
            .from("visites")
            .update({ date_visite: dateVisite, type_visite: typeVisite, note, total_commande: totalCommande })
            .eq("id", visiteId);
          if (updateVisiteError) throw updateVisiteError;

          const { error: deleteCommandesError } = await supabaseClient
            .from("visite_commandes")
            .delete()
            .eq("visite_id", visiteId);
          if (deleteCommandesError) throw deleteCommandesError;

          if (saleVisit && commandes.length) {
            const lignes = commandes.map(commande => ({
              visite_id: visiteId,
              produit_id: commande.produit_id,
              quantite: commande.quantite,
              stock_client: commande.stock_client,
              couleur: commande.couleur,
              prix_unitaire: commande.prix_unitaire
            }));

            const { error: insertCommandesError } = await supabaseClient
              .from("visite_commandes")
              .insert(lignes);
            if (insertCommandesError) throw insertCommandesError;
          }

          showToast("Visite mise Ã  jour avec succÃ¨s.", "success");
        } else {
          const { data: visiteData, error: visiteError } = await supabaseClient
            .from("visites")
            .insert({ client_id: clientId, date_visite: dateVisite, type_visite: typeVisite, note, total_commande: totalCommande })
            .select()
            .single();
          if (visiteError) throw visiteError;

          if (saleVisit && commandes.length) {
            const lignes = commandes.map(commande => ({
              visite_id: visiteData.id,
              produit_id: commande.produit_id,
              quantite: commande.quantite,
              stock_client: commande.stock_client,
              couleur: commande.couleur,
              prix_unitaire: commande.prix_unitaire
            }));

            const { error: insertCommandesError } = await supabaseClient
              .from("visite_commandes")
              .insert(lignes);
            if (insertCommandesError) throw insertCommandesError;
          }

          showToast("Visite enregistrÃ©e avec succÃ¨s.", "success");
        }

        dom.clientSearch.value = "";
        renderClientOptions(clientId);
        dom.clientSelect.value = String(clientId);
        closeVisitModal();
        await loadVisites();
      } catch (error) {
        console.error("Erreur saveVisit:", error);
        setStatus("Erreur lors de lâ€™enregistrement de la visite.", "error");
        showToast("Impossible dâ€™enregistrer la visite.", "error");
      }
    }

    async function deleteVisit(visiteId) {
      if (!window.confirm("Supprimer cette visite ?")) return;

      try {
        setStatus("Suppression de la visite...", "info");
        const { error } = await supabaseClient.from("visites").delete().eq("id", visiteId);
        if (error) throw error;
        await loadVisites();
        setStatus("Visite supprimÃ©e.", "success");
        showToast("Visite supprimÃ©e.", "success");
      } catch (error) {
        console.error("Erreur deleteVisit:", error);
        setStatus("Erreur lors de la suppression.", "error");
        showToast("Impossible de supprimer la visite.", "error");
      }
    }

    function renderTopProduits() {
      if (!state.visites.length) {
        dom.topProduitsList.innerHTML = `<div class="empty-state">Aucune donnÃ©e disponible pour ce client.</div>`;
        return;
      }

      const aggregation = {};
      state.visites.forEach(visite => {
        (visite.commandes || []).forEach(commande => {
          const produit = getProduitDisplay(commande.produit_id);

          if (!aggregation[commande.produit_id]) {
            aggregation[commande.produit_id] = {
              produit_id: commande.produit_id,
              nom: produit.nom || "Produit",
              reference_produit: produit.reference_produit || "Sans rÃ©fÃ©rence",
              quantite: 0,
              visites: 0,
              chiffreAffaires: 0
            };
          }

          aggregation[commande.produit_id].quantite += Number(commande.quantite || 0);
          aggregation[commande.produit_id].visites += 1;
          aggregation[commande.produit_id].chiffreAffaires += Number(commande.quantite || 0) * Number(commande.prix_unitaire || 0);
        });
      });

      const topProduits = Object.values(aggregation).sort((a, b) => {
        if (b.quantite !== a.quantite) return b.quantite - a.quantite;
        return (a.nom || "").localeCompare(b.nom || "", "fr");
      });

      if (!topProduits.length) {
        dom.topProduitsList.innerHTML = `<div class="empty-state">Aucun produit commandÃ© pour ce client.</div>`;
        return;
      }

      const maxQuantity = topProduits[0].quantite || 1;

      dom.topProduitsList.innerHTML = topProduits.map((item, index) => {
        const ratio = Math.max(10, Math.round((item.quantite / maxQuantity) * 100));
        return `
          <div class="top-product-item">
            <div class="top-product-head">
              <div class="rank-badge">#${index + 1}</div>
              <div class="top-product-main">
                <strong>${escapeHtml(item.nom)}</strong>
                <span>${escapeHtml(item.reference_produit)}</span>
              </div>
            </div>
            <div class="top-product-stats">
              <div class="metric-chip">QtÃ© <strong>${item.quantite}</strong></div>
              <div class="metric-chip">Visites <strong>${item.visites}</strong></div>
              <div class="metric-chip">CA <strong>${formatCurrency(item.chiffreAffaires)}</strong></div>
            </div>
            <div class="progress-track"><span style="width:${ratio}%"></span></div>
          </div>
        `;
      }).join("");
    }

    function openTopProduits() {
      renderTopProduits();
      dom.topProduitsOverlay.classList.add("active");
    }

    function closeTopProduits() {
      dom.topProduitsOverlay.classList.remove("active");
    }

    async function handleClientChange() {
      updateClientHeader();
      refreshProductDatalist(getSelectedClientId());
      await loadVisites();
    }

    function handleVisitActionClick(event) {
      const actionButton = event.target.closest("[data-action][data-visite-id]");
      if (!actionButton) return;

      const visiteId = actionButton.dataset.visiteId;
      if (actionButton.dataset.action === "edit") openVisitModal(visiteId);
      if (actionButton.dataset.action === "delete") deleteVisit(visiteId);
    }

    function attachEvents() {
      dom.clientSearch.addEventListener("input", () => {
        if (renderClientOptions()) loadVisites();
      });

      dom.clientSelect.addEventListener("change", handleClientChange);

      dom.viewButtons.forEach(button => {
        button.addEventListener("click", () => setView(button.dataset.view));
      });

      dom.openTopProductsBtn.addEventListener("click", openTopProduits);
      dom.openClientModalBtn.addEventListener("click", openClientModal);
      dom.openVisitModalBtn.addEventListener("click", () => openVisitModal());
      dom.mobileAddVisitBtn.addEventListener("click", () => openVisitModal());
      dom.closeVisitModalBtn.addEventListener("click", closeVisitModal);
      dom.cancelVisitBtn.addEventListener("click", closeVisitModal);
      dom.addProductRowBtn.addEventListener("click", () => {
        if (!isSaleVisitType(getPopupVisitType())) {
          showToast("Passe le type de visite sur Vente pour saisir des produits.", "warning");
          return;
        }
        addProductRow();
      });
      dom.visitForm.addEventListener("submit", saveVisit);
      dom.popupClient.addEventListener("change", () => {
        refreshProductDatalist(getPopupSelectedClientId());
        refreshAllPopupPrices();
      });
      dom.popupVisitType.addEventListener("change", () => applyVisitTypeUiState());
      dom.closeTopProduitsBtn.addEventListener("click", closeTopProduits);
      dom.closeClientModalBtn.addEventListener("click", closeClientModal);
      dom.cancelClientBtn.addEventListener("click", closeClientModal);
      dom.clientForm.addEventListener("submit", saveClient);
      dom.timelineList.addEventListener("click", handleVisitActionClick);
      dom.visitesTableBody.addEventListener("click", handleVisitActionClick);

      dom.visitModalOverlay.addEventListener("click", event => {
        if (event.target === dom.visitModalOverlay) closeVisitModal();
      });

      dom.topProduitsOverlay.addEventListener("click", event => {
        if (event.target === dom.topProduitsOverlay) closeTopProduits();
      });

      dom.clientModalOverlay.addEventListener("click", event => {
        if (event.target === dom.clientModalOverlay) closeClientModal();
      });

      document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          closeVisitModal();
          closeTopProduits();
          closeClientModal();
        }
      });
    }

    async function initApp() {
      cacheDom();
      attachEvents();
      setView("timeline");
      renderTimelineEmpty("Chargement des donnÃ©es client...");
      renderMatrixEmpty("Chargement des donnÃ©es client...");

      try {
        setStatus("Connexion Ã  Supabase...", "info");

        const [clients, produits, tarifsPlaques, plaques] = await Promise.all([
          fetchClients(),
          fetchProduits(),
          fetchTarifsPlaques(),
          fetchPlaques()
        ]);

        state.clients = clients;
        state.produits = produits;
        state.produitsActifs = produits.filter(produit => Boolean(produit.actif));
        state.tarifsPlaques = tarifsPlaques;
        state.plaques = plaques;

        refreshProductDatalist(getSelectedClientId());

        const selectionFromUrl = applyClientSelectionFromUrl();
        if (!selectionFromUrl) renderClientOptions();

        if (getSelectedClientId()) {
          await loadVisites();
        } else {
          clearClientContext();
          updateStats([]);
          updateClientInsights([]);
          renderTimelineEmpty("Aucun client disponible.");
          renderMatrixEmpty("Aucun client disponible.");
          setStatus("Aucun client disponible dans Supabase.", "warning");
        }

        showToast("Fiche client prÃªte.", "success");
      } catch (error) {
        console.error("Erreur initApp:", error);
        clearClientContext();
        updateStats([]);
        updateClientInsights([]);
        renderTimelineEmpty("Impossible de charger les donnÃ©es Supabase.");
        renderMatrixEmpty("Impossible de charger les donnÃ©es Supabase.");
        setStatus("Erreur de connexion Ã  Supabase.", "error");
        showToast("Impossible de charger les donnÃ©es depuis Supabase.", "error");
      }
    }

    initApp();
  
