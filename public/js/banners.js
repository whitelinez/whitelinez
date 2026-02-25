/**
 * banners.js — Public banner/announcement tiles shown when no round is active.
 * Loads from Supabase `banners` table. Supports likes, dismiss, and detail view.
 */

const Banners = (() => {
  const DISMISSED_KEY = "wlz.dismissed_banners.v1";
  const LIKED_KEY     = "wlz.liked_banners.v1";

  let _banners       = [];
  let _dismissed     = new Set();
  let _liked         = new Set();
  let _detailId      = null;
  let _visible       = false;
  let _sessionLive   = false;
  let _sessionPollTimer = null;

  // ── Persistence helpers ───────────────────────────────────────
  function _loadDismissed() {
    try { _dismissed = new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); } catch { _dismissed = new Set(); }
  }
  function _saveDismissed() {
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([..._dismissed])); } catch {}
  }
  function _loadLiked() {
    try { _liked = new Set(JSON.parse(localStorage.getItem(LIKED_KEY) || "[]")); } catch { _liked = new Set(); }
  }
  function _saveLiked() {
    try { localStorage.setItem(LIKED_KEY, JSON.stringify([..._liked])); } catch {}
  }

  // ── Escape ────────────────────────────────────────────────────
  function _esc(v) {
    return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Fetch ─────────────────────────────────────────────────────
  async function _fetch() {
    if (!window.sb) { console.warn("[Banners] sb not ready"); return []; }
    try {
      const { data, error } = await window.sb
        .from("banners")
        .select("id, title, info, image_url, is_pinned, likes")
        .eq("is_active", true)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) { console.error("[Banners] fetch error:", error.message || error); return []; }
      return Array.isArray(data) ? data : [];
    } catch (e) { console.error("[Banners] fetch exception:", e); return []; }
  }

  // ── Render tile ───────────────────────────────────────────────
  function _tile(b) {
    if (_dismissed.has(b.id)) return "";
    const liked = _liked.has(b.id);
    const imgStyle = b.image_url ? `style="background-image:url('${_esc(b.image_url)}')"` : "";
    return `
      <div class="bnr-tile" data-id="${_esc(b.id)}">
        <div class="bnr-tile-bg ${b.image_url ? "" : "bnr-tile-bg-empty"}" ${imgStyle}></div>
        <div class="bnr-tile-tint"></div>
        <button class="bnr-dismiss" data-id="${_esc(b.id)}" title="Dismiss">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        ${b.is_pinned ? `<span class="bnr-pin-badge">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.4H21l-5.2 3.8 2 6.4L12 14.8 6.2 18.6l2-6.4L3 8.4h6.6z"/></svg>
          Pinned
        </span>` : ""}
        <div class="bnr-tile-content">
          <p class="bnr-tile-title">${_esc(b.title)}</p>
          ${b.info ? `<p class="bnr-tile-info">${_esc(b.info.length > 72 ? b.info.slice(0, 72) + "…" : b.info)}</p>` : ""}
        </div>
        <div class="bnr-tile-footer">
          <button class="bnr-like ${liked ? "is-liked" : ""}" data-id="${_esc(b.id)}" title="${liked ? "Unlike" : "Like"}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="bnr-like-count">${b.likes || 0}</span>
          </button>
          <button class="bnr-read-more" data-id="${_esc(b.id)}">More info →</button>
        </div>
      </div>`;
  }

  // ── Render detail ─────────────────────────────────────────────
  function _detail(b) {
    return `
      <div class="bnr-detail">
        <button class="bnr-detail-back" id="bnr-back">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        ${b.image_url ? `
        <div class="bnr-detail-hero" style="background-image:url('${_esc(b.image_url)}')">
          <div class="bnr-detail-hero-tint"></div>
          <h3 class="bnr-detail-hero-title">${_esc(b.title)}</h3>
        </div>` : `<h3 class="bnr-detail-title-plain">${_esc(b.title)}</h3>`}
        <div class="bnr-detail-body">
          <p class="bnr-detail-info">${_esc(b.info || "").replace(/\n/g, "<br>")}</p>
        </div>
      </div>`;
  }

  // ── Session detection ─────────────────────────────────────────
  async function _checkSession() {
    if (!window.sb) return false;
    try {
      const { data } = await window.sb
        .from("round_sessions")
        .select("id")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return !!data;
    } catch { return false; }
  }

  function _startSessionPoll() {
    if (_sessionPollTimer) return;
    _sessionPollTimer = setInterval(async () => {
      if (!_visible) { clearInterval(_sessionPollTimer); _sessionPollTimer = null; return; }
      const live = await _checkSession();
      if (live !== _sessionLive) { _sessionLive = live; _render(); }
    }, 12000);
  }

  // ── Play tile ─────────────────────────────────────────────────
  function _playTile() {
    const live = _sessionLive;
    return `
      <div class="bnr-tile bnr-tile-play ${live ? "bnr-tile-live" : ""}">
        <div class="bnr-tile-bg bnr-tile-bg-empty"></div>
        <div class="bnr-tile-tint"></div>
        ${live ? `
        <span class="bnr-live-badge">
          <span class="bnr-live-dot"></span>LIVE
        </span>` : ""}
        <div class="bnr-tile-content">
          <p class="bnr-tile-title">Play</p>
          <p class="bnr-tile-info">${live
            ? "A session is live. Watch the feed, count the cars, and place your bets before the round opens."
            : "Watch the live feed while you wait. A betting round is coming soon — count the cars and get ready."
          }</p>
        </div>
        <div class="bnr-tile-footer">
          <button class="bnr-play-btn" id="bnr-play-btn">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            ${live ? "Join Now" : "Watch Feed"}
          </button>
        </div>
      </div>`;
  }

  function _wirePlayBtn(section) {
    section.querySelector("#bnr-play-btn")?.addEventListener("click", () => {
      document.querySelector('.tab-btn[data-tab="ai"]')?.click();
    });
  }

  // ── Default "no round" tile ───────────────────────────────────
  function _defaultTile() {
    return `
      <div class="bnr-tile bnr-tile-default">
        <div class="bnr-tile-bg bnr-tile-bg-empty"></div>
        <div class="bnr-tile-tint"></div>
        <div class="bnr-tile-content">
          <p class="bnr-tile-title">No Active Round</p>
          <p class="bnr-tile-info">Markets are closed right now. Check the countdown above — a new round is coming soon.</p>
        </div>
        <div class="bnr-tile-footer">
          <span class="bnr-default-status">
            <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
            Waiting for next round
          </span>
        </div>
      </div>`;
  }

  // ── Render grid / detail into section ────────────────────────
  function _render() {
    const section = document.getElementById("banners-section");
    if (!section) return;

    if (_detailId) {
      const b = _banners.find(x => x.id === _detailId);
      if (b) { section.innerHTML = _detail(b); _wireDetail(section); return; }
      _detailId = null;
    }

    const visible = _banners.filter(b => !_dismissed.has(b.id));
    const adminTiles = visible.length ? visible.map(_tile).join("") : _defaultTile();

    section.innerHTML = `
      <div class="bnr-header">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Updates &amp; Announcements</span>
      </div>
      <div class="bnr-grid">${_playTile()}${adminTiles}</div>`;
    _wirePlayBtn(section);
    if (visible.length) _wireGrid(section);
  }

  function _wireGrid(container) {
    container.querySelectorAll(".bnr-dismiss").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        _dismissed.add(btn.dataset.id);
        _saveDismissed();
        _render();
      });
    });

    container.querySelectorAll(".bnr-like").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        _toggleLike(btn.dataset.id, btn);
      });
    });

    container.querySelectorAll(".bnr-read-more").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        _detailId = btn.dataset.id;
        _render();
      });
    });

    container.querySelectorAll(".bnr-tile-content").forEach(el => {
      el.addEventListener("click", () => {
        _detailId = el.closest(".bnr-tile").dataset.id;
        _render();
      });
    });
  }

  function _wireDetail(container) {
    container.querySelector("#bnr-back")?.addEventListener("click", () => {
      _detailId = null;
      _render();
    });
  }

  // ── Like toggle ───────────────────────────────────────────────
  async function _toggleLike(id, btn) {
    const wasLiked = _liked.has(id);
    const banner = _banners.find(b => b.id === id);
    if (!banner) return;

    // Optimistic
    if (wasLiked) { _liked.delete(id); } else { _liked.add(id); }
    _saveLiked();
    btn.classList.toggle("is-liked", !wasLiked);
    const svgPath = btn.querySelector("svg");
    if (svgPath) svgPath.setAttribute("fill", !wasLiked ? "currentColor" : "none");
    const newCount = Math.max(0, (banner.likes || 0) + (wasLiked ? -1 : 1));
    banner.likes = newCount;
    const countEl = btn.querySelector(".bnr-like-count");
    if (countEl) countEl.textContent = newCount;

    try {
      await window.sb.from("banners").update({ likes: newCount }).eq("id", id);
    } catch { /* silent — optimistic already applied */ }
  }

  // ── Public API ────────────────────────────────────────────────
  async function show() {
    _visible = true;
    const section = document.getElementById("banners-section");
    if (section) section.classList.remove("hidden");
    _loadDismissed();
    _loadLiked();
    [_banners, _sessionLive] = await Promise.all([_fetch(), _checkSession()]);
    _render();
    _startSessionPoll();
  }

  function hide() {
    _visible = false;
    clearInterval(_sessionPollTimer);
    _sessionPollTimer = null;
    const section = document.getElementById("banners-section");
    if (section) {
      section.classList.add("hidden");
      section.innerHTML = "";
    }
    _detailId = null;
  }

  return { show, hide };
})();

window.Banners = Banners;
