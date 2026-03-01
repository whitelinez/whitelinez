/**
 * admin-streams.js — Camera / stream source management for admin panel.
 * Supports ipcam alias strings AND direct HLS URLs stored in ipcam_alias.
 * Human-readable name is stored in feed_appearance.label (existing JSONB col).
 */
const AdminStreams = (() => {
  let _cameras = [];
  let _editId = null;
  const _hlsMap = {}; // camId → Hls instance

  // ── Helpers ───────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function _camLabel(cam) {
    return cam?.feed_appearance?.label || cam?.ipcam_alias || "(unnamed)";
  }

  function _isUrl(alias) {
    return /^https?:\/\//i.test(String(alias || ""));
  }

  function _msg(text, isErr = false) {
    const el = document.getElementById("streams-msg");
    if (!el) return;
    el.textContent = text;
    el.className = "streams-msg " + (isErr ? "streams-msg-err" : "streams-msg-ok");
    setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 4500);
  }

  // ── Load ──────────────────────────────────────────────────────
  async function _load() {
    const listEl = document.getElementById("streams-list");
    if (listEl) listEl.innerHTML = '<p class="loading">Loading streams...</p>';

    const { data, error } = await window.sb
      .from("cameras")
      .select("id, ipcam_alias, created_at, is_active, feed_appearance")
      .order("created_at", { ascending: false });

    if (error) { _msg("Load failed: " + error.message, true); return; }
    _cameras = Array.isArray(data) ? data : [];
    _render();
  }

  // ── Determine which camera the public page loads by default ──
  function _getDefaultCamId() {
    const rank = (cam) => {
      const a = String(cam?.ipcam_alias || "").trim();
      if (!a || a.toLowerCase() === "your-alias") return 0;
      return 1;
    };
    const active = _cameras.filter(c => c.is_active && rank(c) > 0);
    if (!active.length) return null;
    active.sort((a, b) => {
      const at = Date.parse(a?.created_at || 0) || 0;
      const bt = Date.parse(b?.created_at || 0) || 0;
      if (at !== bt) return bt - at;
      return String(b?.id || "").localeCompare(String(a?.id || ""));
    });
    return active[0]?.id ?? null;
  }

  // ── Render list ───────────────────────────────────────────────
  function _render() {
    const el = document.getElementById("streams-list");
    if (!el) return;

    if (!_cameras.length) {
      el.innerHTML = '<p class="muted" style="padding:12px 0;">No streams configured. Add one below.</p>';
      return;
    }

    const defaultId = _getDefaultCamId();

    el.innerHTML = _cameras.map(cam => {
      const label    = _camLabel(cam);
      const alias    = cam.ipcam_alias || "";
      const typeTag  = _isUrl(alias) ? "Direct URL" : "Alias";
      const isDefault = cam.is_active && String(cam.id) === String(defaultId);
      const activeCls  = cam.is_active ? "stream-badge-active" : "stream-badge-inactive";
      const activeText = cam.is_active ? "Active" : "Inactive";
      const liveBadge  = isDefault
        ? '<span class="stream-live-badge"><span class="stream-live-dot"></span>LIVE ON PUBLIC</span>'
        : "";

      const aiIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
      const offIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';

      return `
        <div class="stream-row ${isDefault ? "stream-row-live" : ""}" data-id="${cam.id}">
          <div class="stream-row-info">
            <span class="stream-row-label">${esc(label)}</span>
            <span class="stream-row-alias">${esc(alias)}</span>
            ${liveBadge}
            <span class="stream-badge ${activeCls}">${activeText}</span>
            <span class="stream-type-tag">${typeTag}</span>
          </div>
          <div class="stream-row-preview-wrap hidden" id="sprv-${cam.id}">
            <video class="stream-row-video" data-cam-id="${cam.id}" muted playsinline></video>
            <button class="stream-prv-close" data-id="${cam.id}">&#x2715;</button>
          </div>
          <div class="stream-row-actions">
            <button class="btn-sm stream-btn-preview" data-action="preview" data-id="${cam.id}" data-alias="${esc(alias)}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="14" height="10" rx="1.5"/><path d="M16 10l5-3v10l-5-3"/></svg>
              Preview
            </button>
            <button class="btn-sm stream-btn-edit" data-action="edit" data-id="${cam.id}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            ${cam.is_active
              ? `<button class="btn-sm stream-btn-deactivate" data-action="deactivate-ai" data-id="${cam.id}">${offIcon} Remove AI</button>`
              : `<button class="btn-sm stream-btn-set-ai" data-action="set-ai" data-id="${cam.id}">${aiIcon} Set as AI Cam</button>`
            }
            <button class="btn-sm stream-btn-delete" data-action="delete" data-id="${cam.id}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Delete
            </button>
          </div>
        </div>`;
    }).join("");

    // Wire action buttons
    el.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", _handleRowAction);
    });
    el.querySelectorAll(".stream-prv-close").forEach(btn => {
      btn.addEventListener("click", () => _stopPreview(btn.dataset.id));
    });
  }

  function _handleRowAction(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    switch (btn.dataset.action) {
      case "preview":       _togglePreview(id, btn.dataset.alias); break;
      case "edit":          _startEdit(id); break;
      case "set-ai":        _setAiCamera(id); break;
      case "deactivate-ai": _deactivateAi(id); break;
      case "delete":        _deleteCamera(id); break;
    }
  }

  // ── Preview ───────────────────────────────────────────────────
  function _togglePreview(camId, alias) {
    const wrap = document.getElementById(`sprv-${camId}`);
    if (!wrap) return;
    if (!wrap.classList.contains("hidden")) {
      _stopPreview(camId); return;
    }
    wrap.classList.remove("hidden");

    const videoEl = wrap.querySelector("video");
    if (!videoEl) return;

    const url = _isUrl(alias) ? alias : `/api/stream?alias=${encodeURIComponent(alias)}`;

    if (Hls.isSupported()) {
      if (_hlsMap[camId]) { _hlsMap[camId].destroy(); }
      const h = new Hls({ enableWorker: false, maxBufferLength: 8, maxMaxBufferLength: 16 });
      h.loadSource(url);
      h.attachMedia(videoEl);
      h.on(Hls.Events.MANIFEST_PARSED, () => { videoEl.play().catch(() => {}); });
      _hlsMap[camId] = h;
    } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = url;
      videoEl.play().catch(() => {});
    }
  }

  function _stopPreview(camId) {
    const wrap = document.getElementById(`sprv-${camId}`);
    if (wrap) wrap.classList.add("hidden");
    if (_hlsMap[camId]) { _hlsMap[camId].destroy(); delete _hlsMap[camId]; }
    const vid = wrap?.querySelector("video");
    if (vid) { vid.pause(); vid.src = ""; }
  }

  // ── Edit ──────────────────────────────────────────────────────
  function _startEdit(id) {
    const cam = _cameras.find(c => String(c.id) === String(id));
    if (!cam) return;
    _editId = id;

    const heading = document.getElementById("streams-form-heading");
    const nameEl  = document.getElementById("streams-form-name");
    const aliasEl = document.getElementById("streams-form-alias");
    const activeEl = document.getElementById("streams-form-active");
    const submitBtn = document.getElementById("streams-form-submit");

    if (heading)   heading.textContent = "Edit Stream";
    if (nameEl)    nameEl.value  = cam.feed_appearance?.label || "";
    if (aliasEl)   aliasEl.value = cam.ipcam_alias || "";
    if (activeEl)  activeEl.checked = !!cam.is_active;
    if (submitBtn) submitBtn.textContent = "Update Stream";

    document.getElementById("streams-form-card")?.scrollIntoView({ behavior: "smooth" });
  }

  // ── AI camera selection (exclusive — only one active at a time) ──────────────
  async function _setAiCamera(id) {
    // Deactivate all others first, then activate the chosen one
    const { error: e1 } = await window.sb
      .from("cameras")
      .update({ is_active: false })
      .neq("id", id);
    if (e1) { _msg("Error: " + e1.message, true); return; }
    const { error: e2 } = await window.sb
      .from("cameras")
      .update({ is_active: true })
      .eq("id", id);
    if (e2) { _msg("Error: " + e2.message, true); return; }
    _msg("AI camera set. Backend will switch within ~4 min.");
    await _load();
  }

  async function _deactivateAi(id) {
    const { error } = await window.sb
      .from("cameras")
      .update({ is_active: false })
      .eq("id", id);
    if (error) { _msg("Error: " + error.message, true); return; }
    _msg("AI deactivated for this camera.");
    await _load();
  }

  // ── Delete ────────────────────────────────────────────────────
  async function _deleteCamera(id) {
    if (!confirm("Delete this stream? This cannot be undone.")) return;
    _stopPreview(id);
    const { error } = await window.sb.from("cameras").delete().eq("id", id);
    if (error) { _msg("Delete failed: " + error.message, true); return; }
    _msg("Stream deleted.");
    await _load();
  }

  // ── Form ──────────────────────────────────────────────────────
  function _wireForm() {
    const form = document.getElementById("streams-form");
    const cancelBtn = document.getElementById("streams-form-cancel");
    if (!form) return;

    cancelBtn?.addEventListener("click", _resetForm);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name   = document.getElementById("streams-form-name")?.value.trim() || "";
      const alias  = document.getElementById("streams-form-alias")?.value.trim() || "";
      const active = document.getElementById("streams-form-active")?.checked ?? true;

      if (!alias) { _msg("Stream alias or URL is required.", true); return; }

      const submitBtn = document.getElementById("streams-form-submit");
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving..."; }

      // Store label in feed_appearance.label (merges with existing config)
      const existingAppearance = _editId
        ? (_cameras.find(c => String(c.id) === String(_editId))?.feed_appearance || {})
        : {};
      const appearance = { ...existingAppearance, label: name || alias };

      let error;
      if (_editId) {
        ({ error } = await window.sb.from("cameras")
          .update({ ipcam_alias: alias, is_active: active, feed_appearance: appearance })
          .eq("id", _editId));
      } else {
        ({ error } = await window.sb.from("cameras")
          .insert({ ipcam_alias: alias, is_active: active, feed_appearance: appearance }));
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = _editId ? "Update Stream" : "Add Stream";
      }
      if (error) { _msg("Error: " + error.message, true); return; }
      _msg(_editId ? "Stream updated." : "Stream added.");
      _resetForm();
      await _load();
    });
  }

  function _resetForm() {
    _editId = null;
    const form = document.getElementById("streams-form");
    if (form) form.reset();
    const heading = document.getElementById("streams-form-heading");
    if (heading) heading.textContent = "Add Stream";
    const submitBtn = document.getElementById("streams-form-submit");
    if (submitBtn) submitBtn.textContent = "Add Stream";
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    _load();
    _wireForm();
  }

  return { init, reload: _load };
})();

window.AdminStreams = AdminStreams;
