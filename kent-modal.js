(function(){
  if (window.KentModal) return;

  const STYLE_ID = "kent-modal-style";
  const OVERLAY_CLASS = "kent-modal-overlay";

  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${OVERLAY_CLASS}{
        position:fixed;
        inset:0;
        z-index:99999;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:rgba(2,6,23,.58);
        backdrop-filter:blur(16px);
        animation:kentModalFade .16s ease-out both;
      }
      .kent-modal-card{
        width:min(520px,100%);
        border:1px solid rgba(148,163,184,.22);
        border-radius:26px;
        background:
          radial-gradient(620px 260px at 8% 0%, rgba(59,130,246,.18), transparent 58%),
          radial-gradient(520px 260px at 96% 0%, rgba(34,197,94,.12), transparent 55%),
          rgba(15,23,42,.96);
        color:#eef4ff;
        box-shadow:0 30px 90px rgba(0,0,0,.48);
        overflow:hidden;
        transform-origin:center;
        animation:kentModalPop .18s cubic-bezier(.2,.9,.25,1.05) both;
      }
      .kent-modal-inner{padding:24px}
      .kent-modal-kicker{
        display:inline-flex;
        align-items:center;
        gap:8px;
        margin-bottom:14px;
        padding:7px 11px;
        border-radius:999px;
        border:1px solid rgba(148,163,184,.20);
        background:rgba(255,255,255,.06);
        color:rgba(226,232,240,.72);
        font-size:11px;
        font-weight:900;
        letter-spacing:.12em;
        text-transform:uppercase;
      }
      .kent-modal-dot{
        width:8px;
        height:8px;
        border-radius:999px;
        background:#38bdf8;
        box-shadow:0 0 18px rgba(56,189,248,.55);
      }
      .kent-modal-card[data-tone="danger"] .kent-modal-dot{background:#fb7185;box-shadow:0 0 18px rgba(251,113,133,.55)}
      .kent-modal-card[data-tone="success"] .kent-modal-dot{background:#22c55e;box-shadow:0 0 18px rgba(34,197,94,.55)}
      .kent-modal-card[data-tone="warning"] .kent-modal-dot{background:#f59e0b;box-shadow:0 0 18px rgba(245,158,11,.55)}
      .kent-modal-title{
        margin:0 0 10px;
        font-size:26px;
        line-height:1.05;
        font-weight:950;
        letter-spacing:-.04em;
      }
      .kent-modal-message{
        margin:0;
        color:rgba(226,232,240,.78);
        font-size:15px;
        line-height:1.55;
        white-space:pre-wrap;
      }
      .kent-modal-input{
        width:100%;
        box-sizing:border-box;
        margin-top:18px;
        border:1px solid rgba(148,163,184,.24);
        border-radius:17px;
        background:rgba(2,6,23,.38);
        color:#f8fafc;
        outline:none;
        padding:14px 15px;
        font-size:15px;
        font-weight:800;
      }
      .kent-modal-input:focus{
        border-color:rgba(56,189,248,.65);
        box-shadow:0 0 0 4px rgba(56,189,248,.12);
      }
      .kent-modal-actions{
        display:flex;
        justify-content:flex-end;
        gap:10px;
        margin-top:22px;
        flex-wrap:wrap;
      }
      .kent-modal-btn{
        border:1px solid rgba(148,163,184,.20);
        border-radius:15px;
        min-height:42px;
        padding:0 17px;
        cursor:pointer;
        color:#e5edf8;
        background:rgba(255,255,255,.08);
        font-weight:950;
        font-size:14px;
      }
      .kent-modal-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.12)}
      .kent-modal-btn.primary{
        border-color:rgba(59,130,246,.42);
        color:white;
        background:linear-gradient(135deg,#38bdf8,#2563eb);
        box-shadow:0 15px 36px rgba(37,99,235,.28);
      }
      .kent-modal-card[data-tone="danger"] .kent-modal-btn.primary{
        border-color:rgba(251,113,133,.42);
        background:linear-gradient(135deg,#fb7185,#dc2626);
        box-shadow:0 15px 36px rgba(220,38,38,.28);
      }
      .kent-modal-card[data-tone="success"] .kent-modal-btn.primary{
        border-color:rgba(34,197,94,.42);
        background:linear-gradient(135deg,#34d399,#16a34a);
        box-shadow:0 15px 36px rgba(22,163,74,.26);
      }
      html[data-theme="light"] .${OVERLAY_CLASS}{background:rgba(15,23,42,.30)}
      html[data-theme="light"] .kent-modal-card{
        color:#0f172a;
        background:
          radial-gradient(620px 260px at 8% 0%, rgba(59,130,246,.13), transparent 58%),
          radial-gradient(520px 260px at 96% 0%, rgba(34,197,94,.10), transparent 55%),
          rgba(255,255,255,.97);
        box-shadow:0 30px 90px rgba(15,23,42,.22);
      }
      html[data-theme="light"] .kent-modal-kicker{color:rgba(15,23,42,.55);background:rgba(15,23,42,.04);border-color:rgba(15,23,42,.10)}
      html[data-theme="light"] .kent-modal-title{color:#0f172a}
      html[data-theme="light"] .kent-modal-message{color:rgba(15,23,42,.68)}
      html[data-theme="light"] .kent-modal-input{background:rgba(255,255,255,.86);color:#0f172a;border-color:rgba(15,23,42,.12)}
      html[data-theme="light"] .kent-modal-btn{background:rgba(15,23,42,.05);color:#0f172a;border-color:rgba(15,23,42,.10)}
      @keyframes kentModalFade{from{opacity:0}to{opacity:1}}
      @keyframes kentModalPop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
    `;
    document.head.appendChild(style);
  }

  function makeButton(label, className){
    const button = document.createElement("button");
    button.type = "button";
    button.className = `kent-modal-btn ${className || ""}`.trim();
    button.textContent = label;
    return button;
  }

  function openDialog(options){
    ensureStyle();
    const config = options || {};
    const overlay = document.createElement("div");
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute("role", "presentation");

    const card = document.createElement("section");
    card.className = "kent-modal-card";
    card.dataset.tone = config.tone || "info";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");

    const inner = document.createElement("div");
    inner.className = "kent-modal-inner";

    const kicker = document.createElement("div");
    kicker.className = "kent-modal-kicker";
    const dot = document.createElement("span");
    dot.className = "kent-modal-dot";
    const kickerText = document.createElement("span");
    kickerText.textContent = config.kicker || "Kent";
    kicker.append(dot, kickerText);

    const title = document.createElement("h2");
    title.className = "kent-modal-title";
    title.textContent = config.title || "Information";

    const message = document.createElement("p");
    message.className = "kent-modal-message";
    message.textContent = config.message || "";

    let input = null;
    if (config.input) {
      input = document.createElement("input");
      input.className = "kent-modal-input";
      input.type = "text";
      input.value = config.defaultValue || "";
      input.placeholder = config.placeholder || "";
    }

    const actions = document.createElement("div");
    actions.className = "kent-modal-actions";
    const cancel = config.showCancel ? makeButton(config.cancelText || "Annuler", "") : null;
    const confirm = makeButton(config.confirmText || "Valider", "primary");
    if (cancel) actions.appendChild(cancel);
    actions.appendChild(confirm);

    inner.append(kicker, title, message);
    if (input) inner.appendChild(input);
    inner.appendChild(actions);
    card.appendChild(inner);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    return new Promise(resolve => {
      let settled = false;
      const close = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
        resolve(value);
      };
      const onKeyDown = event => {
        if (event.key === "Escape") close(config.input ? null : false);
        if (event.key === "Enter" && input && document.activeElement === input) {
          event.preventDefault();
          close(input.value);
        }
      };
      confirm.addEventListener("click", () => close(input ? input.value : true));
      if (cancel) cancel.addEventListener("click", () => close(input ? null : false));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) close(input ? null : false);
      });
      document.addEventListener("keydown", onKeyDown);
      window.setTimeout(() => {
        if (input) {
          input.focus();
          input.select();
        } else {
          confirm.focus();
        }
      }, 30);
    });
  }

  function alertDialog(message, options){
    return openDialog({
      ...(options || {}),
      title: (options && options.title) || "Information",
      message: String(message || ""),
      confirmText: (options && options.confirmText) || "OK",
      showCancel: false
    });
  }

  function confirmDialog(message, options){
    return openDialog({
      ...(options || {}),
      title: (options && options.title) || "Confirmation",
      message: String(message || ""),
      confirmText: (options && options.confirmText) || "Valider",
      cancelText: (options && options.cancelText) || "Annuler",
      showCancel: true
    }).then(Boolean);
  }

  function promptDialog(message, defaultValue, options){
    return openDialog({
      ...(options || {}),
      title: (options && options.title) || "Saisie",
      message: String(message || ""),
      defaultValue: defaultValue == null ? "" : String(defaultValue),
      confirmText: (options && options.confirmText) || "Valider",
      cancelText: (options && options.cancelText) || "Annuler",
      input: true,
      showCancel: true
    });
  }

  window.KentModal = {
    alert: alertDialog,
    confirm: confirmDialog,
    prompt: promptDialog
  };
  window.kentAlert = alertDialog;
  window.kentConfirm = confirmDialog;
  window.kentPrompt = promptDialog;
})();
