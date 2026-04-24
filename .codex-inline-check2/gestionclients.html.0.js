
    const SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const state = {
      clients: [],
      plaques: []
    };

    const dom = {};

    function cacheDom() {
      dom.statusBar = document.getElementById("statusBar");
      dom.statClients = document.getElementById("statClients");
      dom.statPlaques = document.getElementById("statPlaques");
      dom.searchInput = document.getElementById("searchInput");
      dom.plaqueFilter = document.getElementById("plaqueFilter");
      dom.clientsTableBody = document.getElementById("clientsTableBody");
      dom.openCreateClientBtn = document.getElementById("openCreateClientBtn");
      dom.clientModalOverlay = document.getElementById("clientModalOverlay");
      dom.clientModalTitle = document.getElementById("clientModalTitle");
      dom.clientModalSubtitle = document.getElementById("clientModalSubtitle");
      dom.closeClientModalBtn = document.getElementById("closeClientModalBtn");
      dom.cancelClientBtn = document.getElementById("cancelClientBtn");
      dom.clientForm = document.getElementById("clientForm");
      dom.editingClientId = document.getElementById("editingClientId");
      dom.clientNomInput = document.getElementById("clientNomInput");
      dom.clientNumeroCompteInput = document.getElementById("clientNumeroCompteInput");
      dom.clientTelephoneInput = document.getElementById("clientTelephoneInput");
      dom.clientAdresseInput = document.getElementById("clientAdresseInput");
      dom.clientPlaqueSelect = document.getElementById("clientPlaqueSelect");
      dom.saveClientBtn = document.getElementById("saveClientBtn");
      dom.toastWrap = document.getElementById("toastWrap");
    }

    function setStatus(message, tone = "info") {
      dom.statusBar.textContent = message;
      dom.statusBar.dataset.tone = tone;
    }

    function showToast(message, tone = "info") {
      const toast = document.createElement("div");
      toast.className = `toast ${tone}`;
      toast.textContent = message;
      dom.toastWrap.appendChild(toast);
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

    function getPlaqueName(client) {
      return client?.plaques?.nom || "â€”";
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

    async function fetchPlaques() {
      const { data, error } = await supabaseClient
        .from("plaques")
        .select("id, nom")
        .order("nom", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    function updateStats() {
      dom.statClients.textContent = String(state.clients.length);
      dom.statPlaques.textContent = String(state.plaques.length);
    }

    function buildPlaqueFilterOptions() {
      const options = ['<option value="">Toutes les plaques</option>'];
      state.plaques.forEach(plaque => {
        options.push(`<option value="${escapeHtml(plaque.id)}">${escapeHtml(plaque.nom || "Plaque")}</option>`);
      });
      dom.plaqueFilter.innerHTML = options.join("");
    }

    function buildPlaqueSelectOptions(selectedPlaqueId = "") {
      const selected = selectedPlaqueId ? String(selectedPlaqueId) : "";
      if (!state.plaques.length) {
        dom.clientPlaqueSelect.innerHTML = '<option value="">Aucune plaque disponible</option>';
        return;
      }

      const options = ['<option value="">Selectionner une plaque</option>'];
      state.plaques.forEach(plaque => {
        const isSelected = String(plaque.id) === selected ? " selected" : "";
        options.push(`<option value="${escapeHtml(plaque.id)}"${isSelected}>${escapeHtml(plaque.nom || "Plaque")}</option>`);
      });
      dom.clientPlaqueSelect.innerHTML = options.join("");
    }

    function getFilteredClients() {
      const query = normalizeText(dom.searchInput.value);
      const plaqueFilter = dom.plaqueFilter.value;

      return state.clients.filter(client => {
        const matchesPlaque = !plaqueFilter || String(client.plaque_id) === String(plaqueFilter);
        if (!matchesPlaque) return false;

        if (!query) return true;
        const candidates = [
          client.id,
          client.nom,
          client.numero_compte,
          client.telephone,
          client.adresse,
          getPlaqueName(client)
        ];
        return candidates.some(value => normalizeText(value).includes(query));
      });
    }

    function renderClientsTable() {
      const clients = getFilteredClients();
      if (!clients.length) {
        dom.clientsTableBody.innerHTML = `
          <tr>
            <td colspan="7">
              <div class="empty">Aucun client trouvÃ© avec ces filtres.</div>
            </td>
          </tr>
        `;
        return;
      }

      dom.clientsTableBody.innerHTML = clients.map(client => `
        <tr>
          <td>${escapeHtml(client.nom || "Client sans nom")}</td>
          <td>${escapeHtml(client.id || "â€”")}</td>
          <td>${escapeHtml(client.numero_compte || "â€”")}</td>
          <td>${escapeHtml(client.telephone || "â€”")}</td>
          <td>${escapeHtml(client.adresse || "â€”")}</td>
          <td>${escapeHtml(getPlaqueName(client))}</td>
          <td class="action-cell">
            <button class="btn btn-info btn-sm" type="button" data-action="edit" data-client-id="${escapeHtml(client.id)}">Modifier</button>
            <a class="btn btn-secondary btn-sm" href="ficherclt.html?client_id=${encodeURIComponent(String(client.id))}">Voir fiche</a>
          </td>
        </tr>
      `).join("");
    }

    function resetClientForm() {
      dom.editingClientId.value = "";
      dom.clientModalTitle.textContent = "Ajouter client";
      dom.clientModalSubtitle.textContent = "Renseigne les informations puis valide pour enregistrer dans la table clients.";
      dom.saveClientBtn.textContent = "Enregistrer client";
      dom.clientNomInput.value = "";
      dom.clientNumeroCompteInput.value = "";
      dom.clientTelephoneInput.value = "";
      dom.clientAdresseInput.value = "";
      buildPlaqueSelectOptions();
    }

    function openClientModal(client = null) {
      if (client) {
        dom.editingClientId.value = String(client.id);
        dom.clientModalTitle.textContent = "Modifier client";
        dom.clientModalSubtitle.textContent = "Modifie les informations puis valide pour enregistrer les changements.";
        dom.saveClientBtn.textContent = "Enregistrer modifications";
        dom.clientNomInput.value = client.nom || "";
        dom.clientNumeroCompteInput.value = client.numero_compte || "";
        dom.clientTelephoneInput.value = client.telephone || "";
        dom.clientAdresseInput.value = client.adresse || "";
        buildPlaqueSelectOptions(client.plaque_id || "");
      } else {
        resetClientForm();
      }

      dom.clientModalOverlay.classList.add("active");
      setTimeout(() => dom.clientNomInput.focus(), 30);
    }

    function closeClientModal() {
      dom.clientModalOverlay.classList.remove("active");
    }

    function findClientByCompteAndPlaque(numeroCompte, plaqueId, excludeId = "") {
      const excluded = excludeId ? String(excludeId) : "";
      return state.clients.find(client =>
        normalizeText(client.numero_compte) === normalizeText(numeroCompte) &&
        String(client.plaque_id) === String(plaqueId) &&
        String(client.id) !== excluded
      ) || null;
    }

    async function refreshData() {
      const [clients, plaques] = await Promise.all([
        fetchClients(),
        fetchPlaques()
      ]);

      state.clients = clients;
      state.plaques = plaques;
      updateStats();
      buildPlaqueFilterOptions();
      renderClientsTable();
    }

    async function saveClient(event) {
      event.preventDefault();

      const editingId = String(dom.editingClientId.value || "").trim();
      const nom = String(dom.clientNomInput.value || "").trim();
      const numeroCompte = String(dom.clientNumeroCompteInput.value || "").trim();
      const telephone = String(dom.clientTelephoneInput.value || "").trim();
      const adresse = String(dom.clientAdresseInput.value || "").trim();
      const plaqueId = dom.clientPlaqueSelect.value;

      if (!nom) return showToast("Renseigne le nom du client.", "warning");
      if (!numeroCompte) return showToast("Renseigne le numero client / compte.", "warning");
      if (!plaqueId) return showToast("Selectionne une plaque.", "warning");

      const duplicateClient = findClientByCompteAndPlaque(numeroCompte, plaqueId, editingId);
      if (duplicateClient) {
        showToast("Ce client existe deja pour cette plaque.", "warning");
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
        setStatus(editingId ? "Mise a jour du client..." : "Creation du client...", "info");

        if (editingId) {
          const { error } = await supabaseClient
            .from("clients")
            .update(payload)
            .eq("id", editingId);
          if (error) throw error;
        } else {
          const { error } = await supabaseClient
            .from("clients")
            .insert(payload);
          if (error) throw error;
        }

        await refreshData();
        closeClientModal();
        setStatus(editingId ? "Client modifie avec succes." : "Client ajoute avec succes.", "success");
        showToast(editingId ? "Client modifie." : "Client ajoute.", "success");
      } catch (error) {
        console.error("Erreur saveClient:", error);
        setStatus("Erreur pendant l'enregistrement du client.", "error");
        showToast("Impossible d'enregistrer le client.", "error");
      } finally {
        dom.saveClientBtn.disabled = false;
      }
    }

    function getClientById(id) {
      return state.clients.find(client => String(client.id) === String(id)) || null;
    }

    function handleTableClick(event) {
      const btn = event.target.closest("[data-action='edit'][data-client-id]");
      if (!btn) return;
      const client = getClientById(btn.dataset.clientId);
      if (!client) {
        showToast("Client introuvable.", "warning");
        return;
      }
      openClientModal(client);
    }

    function attachEvents() {
      dom.searchInput.addEventListener("input", renderClientsTable);
      dom.plaqueFilter.addEventListener("change", renderClientsTable);
      dom.openCreateClientBtn.addEventListener("click", () => openClientModal());
      dom.clientsTableBody.addEventListener("click", handleTableClick);
      dom.closeClientModalBtn.addEventListener("click", closeClientModal);
      dom.cancelClientBtn.addEventListener("click", closeClientModal);
      dom.clientForm.addEventListener("submit", saveClient);

      dom.clientModalOverlay.addEventListener("click", event => {
        if (event.target === dom.clientModalOverlay) closeClientModal();
      });

      document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeClientModal();
      });
    }

    async function initApp() {
      cacheDom();
      attachEvents();
      resetClientForm();

      try {
        setStatus("Connexion a Supabase...", "info");
        await refreshData();
        setStatus(`${state.clients.length} client(s) charges.`, "success");
        showToast("Gestion clients prete.", "success");
      } catch (error) {
        console.error("Erreur initApp:", error);
        setStatus("Erreur de connexion a Supabase.", "error");
        showToast("Impossible de charger les clients.", "error");
      }
    }

    initApp();
  
