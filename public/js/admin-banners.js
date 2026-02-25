/**
 * admin-banners.js — Admin panel: create/edit/pin/archive banners.
 * Writes to Supabase `banners` table + `banners` storage bucket.
 */

const AdminBanners = (() => {
  let _banners = [];
  let _editingId = null;

  function _esc(v) {
    return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function _fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString([], { month:"short", day:"numeric", year:"numeric" });
  }

  // ── Load & render list ────────────────────────────────────────
  async function load() {
    const listEl = document.getElementById("admin-banners-list");
    if (!listEl) return;
    listEl.innerHTML = `<p class="muted">Loading...</p>`;
    try {
      const { data } = await window.sb
        .from("banners")
        .select("*")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      _banners = Array.isArray(data) ? data : [];
    } catch {
      _banners = [];
    }
    _renderList(listEl);
  }

  function _renderList(listEl) {
    if (!_banners.length) {
      listEl.innerHTML = `<p class="muted">No banners yet. Create one below.</p>`;
      return;
    }
    listEl.innerHTML = _banners.map(b => `
      <div class="abn-row ${b.is_active ? "" : "abn-row-archived"}">
        <div class="abn-thumb-wrap">
          ${b.image_url
            ? `<div class="abn-thumb" style="background-image:url('${_esc(b.image_url)}')"></div>`
            : `<div class="abn-thumb abn-thumb-empty"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-5 4 5"/><circle cx="8.5" cy="7.5" r="1.5"/></svg></div>`}
        </div>
        <div class="abn-info">
          <span class="abn-title">${_esc(b.title) || "<em>Untitled</em>"}</span>
          <div class="abn-meta">
            ${b.is_pinned ? `<span class="badge badge-pinned">Pinned</span>` : ""}
            ${!b.is_active ? `<span class="badge badge-archived">Archived</span>` : `<span class="badge badge-active">Active</span>`}
            <span class="abn-meta-likes">♥ ${b.likes || 0}</span>
            <span class="abn-meta-date">${_fmtDate(b.created_at)}</span>
          </div>
        </div>
        <div class="abn-actions">
          <button class="btn-sm btn-outline" data-action="edit" data-id="${_esc(b.id)}">Edit</button>
          <button class="btn-sm ${b.is_pinned ? "btn-active" : "btn-outline"}" data-action="pin" data-id="${_esc(b.id)}" data-val="${b.is_pinned}">${b.is_pinned ? "Unpin" : "Pin"}</button>
          <button class="btn-sm ${b.is_active ? "btn-outline" : "btn-active"}" data-action="archive" data-id="${_esc(b.id)}" data-val="${b.is_active}">${b.is_active ? "Archive" : "Restore"}</button>
        </div>
      </div>
    `).join("");

    // Wire row action buttons
    listEl.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const { action, id, val } = btn.dataset;
        if (action === "edit")    _startEdit(id);
        if (action === "pin")     _toggle(id, "is_pinned",  val === "true");
        if (action === "archive") _toggle(id, "is_active",  val === "true");
      });
    });
  }

  async function _toggle(id, field, current) {
    try {
      await window.sb.from("banners")
        .update({ [field]: !current, updated_at: new Date().toISOString() })
        .eq("id", id);
      await load();
    } catch (e) { console.error("[AdminBanners] toggle", e); }
  }

  // ── Form helpers ──────────────────────────────────────────────
  function _getFormEls() {
    return {
      heading:   document.getElementById("abn-form-heading"),
      title:     document.getElementById("abn-form-title"),
      info:      document.getElementById("abn-form-info"),
      pinned:    document.getElementById("abn-form-pinned"),
      active:    document.getElementById("abn-form-active"),
      imageFile: document.getElementById("abn-form-image"),
      preview:   document.getElementById("abn-form-preview"),
      msg:       document.getElementById("abn-form-msg"),
      submit:    document.getElementById("abn-form-submit"),
      cancel:    document.getElementById("abn-form-cancel"),
    };
  }

  function _clearForm() {
    _editingId = null;
    const f = _getFormEls();
    if (f.title)   f.title.value = "";
    if (f.info)    f.info.value  = "";
    if (f.pinned)  f.pinned.checked = false;
    if (f.active)  f.active.checked = true;
    if (f.imageFile) f.imageFile.value = "";
    if (f.preview) { f.preview.src = ""; f.preview.classList.add("hidden"); }
    if (f.msg)     f.msg.textContent = "";
    if (f.heading) f.heading.textContent = "New Banner";
    if (f.submit)  f.submit.textContent  = "Create Banner";
  }

  function _startEdit(id) {
    const b = _banners.find(x => x.id === id);
    if (!b) return;
    _editingId = id;
    const f = _getFormEls();
    if (f.title)   f.title.value         = b.title  || "";
    if (f.info)    f.info.value           = b.info   || "";
    if (f.pinned)  f.pinned.checked       = !!b.is_pinned;
    if (f.active)  f.active.checked       = !!b.is_active;
    if (f.preview && b.image_url) {
      f.preview.src = b.image_url;
      f.preview.classList.remove("hidden");
    }
    if (f.heading) f.heading.textContent = "Edit Banner";
    if (f.submit)  f.submit.textContent  = "Save Changes";
    if (f.msg)     f.msg.textContent     = "";
    document.getElementById("abn-form-card")?.scrollIntoView({ behavior: "smooth" });
  }

  // ── Submit ────────────────────────────────────────────────────
  async function _handleSubmit(e) {
    e.preventDefault();
    const f = _getFormEls();
    if (!f.submit) return;
    f.submit.disabled = true;
    if (f.msg) f.msg.textContent = "Saving…";

    try {
      const title    = f.title?.value.trim()  || "";
      const info     = f.info?.value.trim()   || "";
      const is_pinned = !!f.pinned?.checked;
      const is_active = !!f.active?.checked;

      // Resolve existing image URL (for edits)
      let image_url = _editingId
        ? (_banners.find(b => b.id === _editingId)?.image_url || "")
        : "";

      // Upload new image if provided
      const file = f.imageFile?.files?.[0];
      if (file) {
        if (file.size > 4 * 1024 * 1024) throw new Error("Image too large — max 4 MB");
        const ext  = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `banner-${Date.now()}.${ext}`;
        const { error: upErr } = await window.sb.storage
          .from("banners")
          .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
        if (upErr) throw upErr;
        const { data: urlData } = window.sb.storage.from("banners").getPublicUrl(path);
        image_url = urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : "";
        if (f.imageFile) f.imageFile.value = "";
      }

      const payload = { title, info, image_url, is_pinned, is_active, updated_at: new Date().toISOString() };

      if (_editingId) {
        const { error } = await window.sb.from("banners").update(payload).eq("id", _editingId);
        if (error) throw error;
      } else {
        const { error } = await window.sb.from("banners").insert({ ...payload, likes: 0 });
        if (error) throw error;
      }

      if (f.msg) f.msg.textContent = _editingId ? "Saved." : "Banner created.";
      _clearForm();
      await load();
      setTimeout(() => { if (f.msg && /Saved|created/.test(f.msg.textContent)) f.msg.textContent = ""; }, 2500);
    } catch (err) {
      if (f.msg) f.msg.textContent = err.message || "Save failed";
      console.error("[AdminBanners]", err);
    } finally {
      if (f.submit) f.submit.disabled = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    document.getElementById("abn-form")?.addEventListener("submit", _handleSubmit);
    document.getElementById("abn-form-cancel")?.addEventListener("click", _clearForm);

    // Image preview on file select
    document.getElementById("abn-form-image")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const f = _getFormEls();
      if (f.preview) {
        f.preview.src = URL.createObjectURL(file);
        f.preview.classList.remove("hidden");
      }
    });
  }

  return { init, load };
})();

window.AdminBanners = AdminBanners;
