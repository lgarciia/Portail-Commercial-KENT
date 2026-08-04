const SUPABASE_URL = "https://qcdkmwtzdxnmltqvsxmd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjZGttd3R6ZHhubWx0cXZzeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTE1ODksImV4cCI6MjA4OTU4NzU4OX0.DUD3kcysi9iGevaPiz2ANYEowS1-xQK4itPpZ-z61ZY";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STAGES = [
  { key: "prospect_identifie", label: "Prospect identifié", short: "Prospect", color: "blue" },
  { key: "documentation_envoyee", label: "Documentation envoyée", short: "Doc envoyée", color: "gold" },
  { key: "relance_rdv", label: "Relance / RDV à décrocher", short: "Relance RDV", color: "gold" },
  { key: "rdv_planifie", label: "RDV planifié", short: "RDV", color: "blue" },
  { key: "besoin_qualifie", label: "Besoin qualifié", short: "Qualifié", color: "green" },
  { key: "offre_envoyee", label: "Offre envoyée", short: "Offre", color: "green" },
  { key: "converti_client", label: "Converti client", short: "Converti", color: "green" },
  { key: "perdu", label: "Perdu / arrêté", short: "Perdu", color: "red" }
];
const EDITABLE_STAGES = STAGES.filter(stage => stage.key !== "converti_client");
const NEXT_STAGE = {
  prospect_identifie: "documentation_envoyee",
  documentation_envoyee: "relance_rdv",
  relance_rdv: "rdv_planifie",
  rdv_planifie: "besoin_qualifie",
  besoin_qualifie: "offre_envoyee"
};
const stageByKey = new Map(STAGES.map(stage => [stage.key, stage]));
const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const numberFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const state = {
  prospects: [],
  actions: [],
  plaques: [],
  currentProspectId: "",
  pendingConfirm: null,
  stageTouched: false
};
const dom = {};

function $(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function normalize(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeEmail(value) { return String(value ?? "").trim().toLowerCase(); }
function isValidEmail(value) {
  const email = normalizeEmail(value);
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function clampProbability(value) {
  const n = Math.round(toNumber(value));
  return Math.max(0, Math.min(100, n));
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}
function formatDate(value) {
  if (!value) return "-";
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString("fr-FR");
}
function stageLabel(key) { return stageByKey.get(key)?.label || key || "-"; }
function stageShort(key) { return stageByKey.get(key)?.short || stageLabel(key); }
function stageColor(key) { return stageByKey.get(key)?.color || "blue"; }

function applyCommercialScope(query) {
  return window.KentCommercialScope ? window.KentCommercialScope.applyToQuery(query) : query;
}
function getCommercialOwnershipPayload() {
  const user = window.KentCommercialScope?.getUser?.() || {};
  const dbUserId = String(user.dbUserId || "").trim();
  if (!dbUserId || user.role !== "commercial") return {};
  return {
    commercial_user_id: dbUserId,
    commercial_identifier: String(user.id || "").trim() || null,
    commercial_name: String(user.name || "").trim() || null
  };
}

function cacheDom() {
  [
    "board", "statusBar", "searchInput", "stageFilter", "priorityFilter", "dueFilter",
    "refreshBtn", "newProspectBtn", "kpiActive", "kpiDue", "kpiWeighted", "kpiConverted",
    "prospectModalOverlay", "prospectModalTitle", "prospectModalSubtitle",
    "closeProspectModalBtn", "cancelProspectBtn", "prospectForm", "prospectIdInput",
    "companyInput", "contactInput", "phoneInput", "emailInput", "addressInput",
    "sectorInput", "sourceInput", "stageInput", "priorityInput", "nextContactInput",
    "potentialInput", "probabilityInput", "notesInput", "archiveProspectBtn",
    "saveProspectBtn", "actionPanel", "actionForm", "actionTypeInput", "actionNextInput",
    "actionCommentInput", "historyList", "conversionPanel", "conversionForm",
    "convertedInfo", "clientNumberInput", "plaqueSelect", "convertBtn", "confirmOverlay",
    "confirmTitle", "confirmText", "confirmCancelBtn", "confirmOkBtn", "toastWrap"
  ].forEach(id => { dom[id] = $(id); });
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

function buildSelectOptions() {
  dom.stageFilter.innerHTML = '<option value="">Tous les statuts</option>' + STAGES
    .map(stage => `<option value="${stage.key}">${escapeHtml(stage.label)}</option>`)
    .join("");
  dom.stageInput.innerHTML = EDITABLE_STAGES
    .map(stage => `<option value="${stage.key}">${escapeHtml(stage.label)}</option>`)
    .join("");
  dom.plaqueSelect.innerHTML = state.plaques.length
    ? '<option value="">Sélectionner une plaque</option>' + state.plaques
      .map(plaque => `<option value="${escapeHtml(plaque.id)}">${escapeHtml(plaque.nom || "Plaque")}</option>`)
      .join("")
    : '<option value="">Aucune plaque disponible</option>';
}

async function fetchProspects() {
  let query = supabaseClient
    .from("industrie_prospects")
    .select("*")
    .eq("hidden", false)
    .order("updated_at", { ascending: false });
  query = applyCommercialScope(query);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function fetchActions(prospectIds) {
  if (!prospectIds.length) return [];
  const { data, error } = await supabaseClient
    .from("industrie_prospect_actions")
    .select("*")
    .in("prospect_id", prospectIds)
    .order("action_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function fetchPlaques() {
  const { data, error } = await supabaseClient
    .from("industrie_plaques")
    .select("id, nom")
    .order("nom", { ascending: true });
  if (error) throw error;
  return data || [];
}

function prospectActions(prospectId) {
  return state.actions.filter(action => String(action.prospect_id) === String(prospectId));
}
function getFilteredProspects() {
  const query = normalize(dom.searchInput.value);
  const stage = dom.stageFilter.value;
  const priority = dom.priorityFilter.value;
  const due = dom.dueFilter.value;
  const today = todayIso();
  const weekLimit = addDays(new Date(), 7).toISOString().slice(0, 10);

  return state.prospects.filter(prospect => {
    if (stage && prospect.statut !== stage) return false;
    if (priority && prospect.priorite !== priority) return false;
    if (due === "due" && (!prospect.prochain_contact || String(prospect.prochain_contact).slice(0, 10) > today)) return false;
    if (due === "week" && (!prospect.prochain_contact || String(prospect.prochain_contact).slice(0, 10) > weekLimit)) return false;
    if (due === "none" && prospect.prochain_contact) return false;
    if (!query) return true;
    const haystack = [
      prospect.nom_entreprise, prospect.contact_nom, prospect.telephone, prospect.email,
      prospect.adresse, prospect.secteur_activite, prospect.source_prospect, prospect.notes,
      stageLabel(prospect.statut)
    ].join(" ");
    return normalize(haystack).includes(query);
  });
}
function updateKpis(rows) {
  const active = rows.filter(row => !["converti_client", "perdu"].includes(row.statut));
  const today = todayIso();
  const due = active.filter(row => row.prochain_contact && String(row.prochain_contact).slice(0, 10) <= today);
  const weighted = active.reduce((sum, row) => sum + toNumber(row.potentiel_ca) * (clampProbability(row.probabilite) / 100), 0);
  const converted = rows.filter(row => row.statut === "converti_client");
  dom.kpiActive.textContent = numberFmt.format(active.length);
  dom.kpiDue.textContent = numberFmt.format(due.length);
  dom.kpiWeighted.textContent = eur.format(weighted);
  dom.kpiConverted.textContent = numberFmt.format(converted.length);
}

function cardHtml(prospect) {
  const actions = prospectActions(prospect.id);
  const lastAction = actions[0];
  const next = NEXT_STAGE[prospect.statut];
  const potential = eur.format(toNumber(prospect.potentiel_ca));
  const probability = clampProbability(prospect.probabilite);
  const nextContact = prospect.prochain_contact ? formatDate(prospect.prochain_contact) : "Aucune relance";
  const priorityClass = prospect.priorite === "urgente" ? "red" : prospect.priorite === "haute" ? "gold" : prospect.priorite === "basse" ? "blue" : "green";
  return `
    <button class="prospectCard" type="button" data-open-id="${escapeHtml(prospect.id)}" data-priority="${escapeHtml(prospect.priorite || "normale")}">
      <div class="prospectName">${escapeHtml(prospect.nom_entreprise || "Prospect sans nom")}</div>
      <div class="prospectMeta">
        <span>${escapeHtml(prospect.contact_nom || "Contact à renseigner")}</span>
        <span>${escapeHtml(prospect.secteur_activite || "Secteur non renseigné")}</span>
        <span>Relance : ${escapeHtml(nextContact)}</span>
        <span>Potentiel : ${escapeHtml(potential)} · ${probability}%</span>
        <span>Dernier point : ${escapeHtml(lastAction?.titre || lastAction?.commentaire || "Aucune action")}</span>
      </div>
      <div class="cardFooter">
        <span class="pill ${priorityClass}">${escapeHtml(prospect.priorite || "normale")}</span>
        ${next ? `<span class="pill blue" data-advance-id="${escapeHtml(prospect.id)}">Avancer</span>` : `<span class="pill ${stageColor(prospect.statut)}">${escapeHtml(stageShort(prospect.statut))}</span>`}
      </div>
    </button>`;
}
function renderBoard() {
  const rows = getFilteredProspects();
  updateKpis(rows);
  const byStage = new Map(STAGES.map(stage => [stage.key, []]));
  rows.forEach(row => {
    if (!byStage.has(row.statut)) byStage.set(row.statut, []);
    byStage.get(row.statut).push(row);
  });
  dom.board.innerHTML = STAGES.map(stage => {
    const items = byStage.get(stage.key) || [];
    return `
      <section class="stage">
        <div class="stageHead"><div class="stageTitle">${escapeHtml(stage.short)}</div><div class="stageCount">${items.length}</div></div>
        <div class="stageList">${items.length ? items.map(cardHtml).join("") : '<div class="empty">Aucun dossier</div>'}</div>
      </section>`;
  }).join("");
  setStatus(`${rows.length} prospect(s) affiché(s) sur ${state.prospects.length} dossier(s).`, "success");
}

function getProspectById(id) {
  return state.prospects.find(prospect => String(prospect.id) === String(id)) || null;
}
function resetProspectModal() {
  state.currentProspectId = "";
  state.stageTouched = false;
  dom.prospectIdInput.value = "";
  dom.prospectModalTitle.textContent = "Nouveau prospect";
  dom.prospectModalSubtitle.textContent = "Renseigne la piste industrie puis fais avancer le dossier étape par étape.";
  dom.companyInput.value = "";
  dom.contactInput.value = "";
  dom.phoneInput.value = "";
  dom.emailInput.value = "";
  dom.addressInput.value = "";
  dom.sectorInput.value = "";
  dom.sourceInput.value = "";
  dom.stageInput.value = "prospect_identifie";
  dom.priorityInput.value = "normale";
  dom.nextContactInput.value = "";
  dom.potentialInput.value = "";
  dom.probabilityInput.value = "10";
  dom.notesInput.value = "";
  dom.actionTypeInput.value = "note";
  dom.actionNextInput.value = "";
  dom.actionCommentInput.value = "";
  dom.actionPanel.style.display = "none";
  dom.conversionPanel.style.display = "none";
  dom.archiveProspectBtn.style.display = "none";
  dom.historyList.innerHTML = '<div class="empty">Enregistre le prospect pour commencer l\\\'historique.</div>';
}
function openProspectModal(prospect = null) {
  resetProspectModal();
  if (prospect) {
    state.currentProspectId = String(prospect.id);
    dom.prospectIdInput.value = String(prospect.id);
    dom.prospectModalTitle.textContent = prospect.nom_entreprise || "Prospect industrie";
    dom.prospectModalSubtitle.textContent = `${stageLabel(prospect.statut)} · ${prospect.priorite || "normale"}`;
    dom.companyInput.value = prospect.nom_entreprise || "";
    dom.contactInput.value = prospect.contact_nom || "";
    dom.phoneInput.value = prospect.telephone || "";
    dom.emailInput.value = prospect.email || "";
    dom.addressInput.value = prospect.adresse || "";
    dom.sectorInput.value = prospect.secteur_activite || "";
    dom.sourceInput.value = prospect.source_prospect || "";
    dom.stageInput.value = prospect.statut === "converti_client" ? "offre_envoyee" : (prospect.statut || "prospect_identifie");
    dom.priorityInput.value = prospect.priorite || "normale";
    dom.nextContactInput.value = prospect.prochain_contact ? String(prospect.prochain_contact).slice(0, 10) : "";
    dom.potentialInput.value = prospect.potentiel_ca ?? "";
    dom.probabilityInput.value = prospect.probabilite ?? 10;
    dom.notesInput.value = prospect.notes || "";
    dom.actionPanel.style.display = "block";
    dom.conversionPanel.style.display = "block";
    dom.archiveProspectBtn.style.display = "inline-flex";
    renderHistory(prospect.id);
    renderConversionPanel(prospect);
  }
  state.stageTouched = false;
  dom.prospectModalOverlay.classList.add("active");
  setTimeout(() => dom.companyInput.focus(), 40);
}
function closeProspectModal() { dom.prospectModalOverlay.classList.remove("active"); }
function renderHistory(prospectId) {
  const actions = prospectActions(prospectId);
  dom.historyList.innerHTML = actions.length ? actions.map(action => `
    <div class="historyItem">
      <strong>${escapeHtml(action.titre || action.type_action || "Action")}</strong>
      <div class="historyDate">${escapeHtml(formatDate(action.action_at))}${action.prochaine_action_date ? ` · prochaine relance ${escapeHtml(formatDate(action.prochaine_action_date))}` : ""}</div>
      ${action.commentaire ? `<p>${escapeHtml(action.commentaire)}</p>` : ""}
    </div>`).join("") : '<div class="empty">Aucune action historisée.</div>';
}
function renderConversionPanel(prospect) {
  const converted = prospect.statut === "converti_client" || prospect.client_id;
  dom.conversionForm.style.display = converted ? "none" : "block";
  dom.convertedInfo.style.display = converted ? "block" : "none";
  if (converted) {
    dom.convertedInfo.innerHTML = `Prospect converti en client industrie.${prospect.client_id ? `<br><br><a class="btn small green" href="ficherclt-industrie.html?client_id=${encodeURIComponent(prospect.client_id)}">Ouvrir la fiche client</a>` : ""}`;
    return;
  }
  dom.clientNumberInput.value = "";
  dom.plaqueSelect.value = "";
}

function prospectPayloadFromForm() {
  const email = normalizeEmail(dom.emailInput.value);
  const existing = getProspectById(dom.prospectIdInput.value);
  const preservedConverted = existing?.statut === "converti_client" || existing?.client_id;
  const selectedStage = dom.stageInput.value || "prospect_identifie";
  const currentStage = existing?.statut || selectedStage;
  if (!dom.companyInput.value.trim()) throw new Error("Renseigne le nom de l'entreprise.");
  if (!isValidEmail(email)) throw new Error("Renseigne un email valide.");
  return {
    nom_entreprise: dom.companyInput.value.trim(),
    contact_nom: dom.contactInput.value.trim() || null,
    telephone: dom.phoneInput.value.trim() || null,
    email: email || null,
    adresse: dom.addressInput.value.trim() || null,
    secteur_activite: dom.sectorInput.value.trim() || null,
    source_prospect: dom.sourceInput.value.trim() || null,
    statut: preservedConverted ? "converti_client" : (existing && !state.stageTouched ? currentStage : selectedStage),
    priorite: dom.priorityInput.value || "normale",
    prochain_contact: dom.nextContactInput.value || null,
    potentiel_ca: toNumber(dom.potentialInput.value),
    probabilite: clampProbability(dom.probabilityInput.value),
    notes: dom.notesInput.value.trim() || null
  };
}
async function addAction(prospectId, data) {
  const payload = {
    prospect_id: prospectId,
    type_action: data.type_action || "note",
    titre: data.titre || null,
    commentaire: data.commentaire || null,
    prochaine_action_date: data.prochaine_action_date || null,
    ...getCommercialOwnershipPayload()
  };
  const { error } = await supabaseClient.from("industrie_prospect_actions").insert(payload);
  if (error) throw error;
}
async function saveProspect(event) {
  event.preventDefault();
  try {
    dom.saveProspectBtn.disabled = true;
    const editingId = String(dom.prospectIdInput.value || "").trim();
    const payload = prospectPayloadFromForm();
    if (editingId) {
      let query = supabaseClient.from("industrie_prospects").update(payload).eq("id", editingId);
      query = applyCommercialScope(query);
      const { error } = await query;
      if (error) throw error;
      showToast("Prospect mis à jour.", "success");
    } else {
      const { data, error } = await supabaseClient
        .from("industrie_prospects")
        .insert({ ...payload, ...getCommercialOwnershipPayload() })
        .select("id")
        .single();
      if (error) throw error;
      if (data?.id) await addAction(data.id, { type_action: "note", titre: "Création du prospect", commentaire: "Dossier prospect industrie créé." });
      showToast("Prospect créé.", "success");
    }
    await refreshData();
    closeProspectModal();
  } catch (error) {
    console.error("Erreur saveProspect:", error);
    showToast(error.message || "Impossible d'enregistrer le prospect.", "error");
  } finally {
    dom.saveProspectBtn.disabled = false;
  }
}
async function saveAction(event) {
  event.preventDefault();
  const prospectId = state.currentProspectId;
  if (!prospectId) return showToast("Enregistre d'abord le prospect.", "warning");
  const comment = dom.actionCommentInput.value.trim();
  if (!comment) return showToast("Ajoute un commentaire d'action.", "warning");
  try {
    await addAction(prospectId, {
      type_action: dom.actionTypeInput.value || "note",
      titre: stageLabel(getProspectById(prospectId)?.statut),
      commentaire: comment,
      prochaine_action_date: dom.actionNextInput.value || null
    });
    if (dom.actionNextInput.value) {
      let query = supabaseClient.from("industrie_prospects").update({ prochain_contact: dom.actionNextInput.value }).eq("id", prospectId);
      query = applyCommercialScope(query);
      const { error } = await query;
      if (error) throw error;
    }
    dom.actionCommentInput.value = "";
    dom.actionNextInput.value = "";
    await refreshData(false);
    renderHistory(prospectId);
    showToast("Action ajoutée.", "success");
  } catch (error) {
    console.error("Erreur saveAction:", error);
    showToast(error.message || "Impossible d'ajouter l'action.", "error");
  }
}
async function advanceProspect(prospectId) {
  const prospect = getProspectById(prospectId);
  const next = prospect ? NEXT_STAGE[prospect.statut] : "";
  if (!prospect || !next) return;
  try {
    let query = supabaseClient.from("industrie_prospects").update({ statut: next }).eq("id", prospectId);
    query = applyCommercialScope(query);
    const { error } = await query;
    if (error) throw error;
    await addAction(prospectId, { type_action: "note", titre: "Statut avancé", commentaire: `Passage de ${stageLabel(prospect.statut)} à ${stageLabel(next)}.` });
    await refreshData();
    showToast("Prospect avancé.", "success");
  } catch (error) {
    console.error("Erreur advanceProspect:", error);
    showToast(error.message || "Impossible d'avancer le prospect.", "error");
  }
}

function openConfirm(title, text, action) {
  dom.confirmTitle.textContent = title;
  dom.confirmText.textContent = text;
  state.pendingConfirm = action;
  dom.confirmOverlay.classList.add("active");
}
function closeConfirm() {
  state.pendingConfirm = null;
  dom.confirmOverlay.classList.remove("active");
}
async function archiveCurrentProspect() {
  const prospectId = state.currentProspectId;
  if (!prospectId) return;
  openConfirm("Masquer le prospect", "Le prospect sera masqué du pipeline, sans suppression physique des données.", async () => {
    try {
      let query = supabaseClient.from("industrie_prospects").update({ hidden: true }).eq("id", prospectId);
      query = applyCommercialScope(query);
      const { error } = await query;
      if (error) throw error;
      closeConfirm();
      closeProspectModal();
      await refreshData();
      showToast("Prospect masqué.", "success");
    } catch (error) {
      console.error("Erreur archive:", error);
      showToast(error.message || "Impossible de masquer le prospect.", "error");
    }
  });
}
async function convertCurrentProspect() {
  const prospectId = state.currentProspectId;
  const prospect = getProspectById(prospectId);
  if (!prospect) return;
  const plaqueId = dom.plaqueSelect.value;
  if (!plaqueId) return showToast("Sélectionne une plaque tarifaire.", "warning");
  try {
    dom.convertBtn.disabled = true;
    const clientPayload = {
      nom: prospect.nom_entreprise,
      numero_compte: dom.clientNumberInput.value.trim() || null,
      telephone: prospect.telephone || null,
      email: prospect.email || null,
      adresse: prospect.adresse || null,
      plaque_id: plaqueId,
      ...getCommercialOwnershipPayload()
    };
    const { data, error } = await supabaseClient
      .from("industrie_clients")
      .insert(clientPayload)
      .select("id")
      .single();
    if (error) throw error;
    const clientId = data?.id;
    let query = supabaseClient
      .from("industrie_prospects")
      .update({ statut: "converti_client", client_id: clientId, converted_at: new Date().toISOString(), prochain_contact: null })
      .eq("id", prospectId);
    query = applyCommercialScope(query);
    const updateResult = await query;
    if (updateResult.error) throw updateResult.error;
    await addAction(prospectId, { type_action: "conversion", titre: "Conversion client", commentaire: "Prospect converti en fiche client industrie." });
    await refreshData();
    const updated = getProspectById(prospectId);
    if (updated) {
      state.currentProspectId = prospectId;
      renderConversionPanel(updated);
      renderHistory(prospectId);
    }
    showToast("Client industrie créé.", "success");
  } catch (error) {
    console.error("Erreur conversion:", error);
    showToast(error.message || "Impossible de convertir le prospect.", "error");
  } finally {
    dom.convertBtn.disabled = false;
  }
}

async function refreshData(showLoading = true) {
  if (showLoading) setStatus("Chargement de la prospection industrie...", "info");
  try {
    const [plaques, prospects] = await Promise.all([fetchPlaques(), fetchProspects()]);
    state.plaques = plaques;
    state.prospects = prospects;
    state.actions = await fetchActions(prospects.map(row => row.id));
    buildSelectOptions();
    renderBoard();
  } catch (error) {
    console.error("Erreur refreshData:", error);
    state.prospects = [];
    state.actions = [];
    renderBoard();
    setStatus("Prospection industrie non prête. Lance le SQL supabase_industrie_prospection.sql puis recharge la page.", "error");
    showToast(error.message || "Impossible de charger la prospection industrie.", "error");
  }
}

function attachEvents() {
  dom.newProspectBtn.addEventListener("click", () => openProspectModal());
  dom.refreshBtn.addEventListener("click", () => refreshData());
  [dom.searchInput, dom.stageFilter, dom.priorityFilter, dom.dueFilter].forEach(input => input.addEventListener("input", renderBoard));
  [dom.stageFilter, dom.priorityFilter, dom.dueFilter].forEach(input => input.addEventListener("change", renderBoard));
  dom.board.addEventListener("click", event => {
    const advance = event.target.closest("[data-advance-id]");
    if (advance) {
      event.stopPropagation();
      advanceProspect(advance.dataset.advanceId);
      return;
    }
    const card = event.target.closest("[data-open-id]");
    if (card) openProspectModal(getProspectById(card.dataset.openId));
  });
  dom.closeProspectModalBtn.addEventListener("click", closeProspectModal);
  dom.cancelProspectBtn.addEventListener("click", closeProspectModal);
  dom.prospectModalOverlay.addEventListener("click", event => { if (event.target === dom.prospectModalOverlay) closeProspectModal(); });
  dom.prospectForm.addEventListener("submit", saveProspect);
  dom.stageInput.addEventListener("change", () => { state.stageTouched = true; });
  dom.actionForm.addEventListener("submit", saveAction);
  dom.archiveProspectBtn.addEventListener("click", archiveCurrentProspect);
  dom.convertBtn.addEventListener("click", convertCurrentProspect);
  dom.confirmCancelBtn.addEventListener("click", closeConfirm);
  dom.confirmOverlay.addEventListener("click", event => { if (event.target === dom.confirmOverlay) closeConfirm(); });
  dom.confirmOkBtn.addEventListener("click", async () => { if (typeof state.pendingConfirm === "function") await state.pendingConfirm(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeProspectModal();
      closeConfirm();
    }
  });
}

async function init() {
  cacheDom();
  buildSelectOptions();
  attachEvents();
  try {
    await window.KentCommercialScope.load();
  } catch (error) {
    console.warn("Session commerciale indisponible:", error?.message || error);
  }
  await refreshData();
}

init();
