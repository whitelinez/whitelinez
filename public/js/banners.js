/**
 * banners.js — Public banner/announcement tiles shown when no round is active.
 *
 * Dismissal is per-user profile:
 *   - localStorage key is scoped by user ID (logged-in) or "anon" (guest)
 *   - Logging in/out re-scopes all preferences automatically
 *   - Admin can force re-show any banner by updating it in Supabase — the
 *     banner's `updated_at` timestamp is compared to the user's dismiss time;
 *     if updated AFTER the user dismissed, the banner reappears.
 *
 * Admin controls:
 *   - Activate / deactivate banners (is_active)
 *   - Edit a banner content → automatically clears all user dismissals for it
 */

const Banners = (() => {
  const DISMISSED_KEY = "wlz.dismissed_banners.v2"; // v2 = per-user + timestamped
  const LIKED_KEY     = "wlz.liked_banners.v2";

  let _banners          = [];
  let _dismissed        = new Map(); // id → ISO timestamp (or null)
  let _liked            = new Set();
  let _userId           = null;      // current logged-in user ID, null = anon
  let _isAnon           = false;     // true when session is Supabase anonymous
  let _detailId         = null;
  let _visible          = false;
  let _sessionLive      = false;
  let _sessionPollTimer = null;
  let _authUnsub        = null;

  // ── User-scoped storage key ───────────────────────────────────
  function _userKey(base) {
    return _userId ? `${base}.u.${_userId}` : `${base}.anon`;
  }

  // ── Persistence helpers ───────────────────────────────────────
  function _loadDismissed() {
    try {
      const raw = JSON.parse(localStorage.getItem(_userKey(DISMISSED_KEY)) || "[]");
      // Support both formats: legacy [id, ...] and current [{id, at}, ...]
      _dismissed = new Map(raw.map(x =>
        x && typeof x === "object" ? [String(x.id), x.at || null] : [String(x), null]
      ));
    } catch { _dismissed = new Map(); }
  }

  function _saveDismissed() {
    try {
      const data = [..._dismissed.entries()].map(([id, at]) => ({ id, at }));
      localStorage.setItem(_userKey(DISMISSED_KEY), JSON.stringify(data));
    } catch {}
  }

  function _loadLiked() {
    try {
      _liked = new Set(JSON.parse(localStorage.getItem(_userKey(LIKED_KEY)) || "[]"));
    } catch { _liked = new Set(); }
  }

  function _saveLiked() {
    try {
      localStorage.setItem(_userKey(LIKED_KEY), JSON.stringify([..._liked]));
    } catch {}
  }

  // ── Admin force-reset: clear dismissals for banners updated after dismiss ──
  function _pruneOutdatedDismissals() {
    let changed = false;
    for (const b of _banners) {
      const key = String(b.id);
      if (!_dismissed.has(key)) continue;
      const dismissedAt = _dismissed.get(key);
      if (b.updated_at && dismissedAt && new Date(b.updated_at) > new Date(dismissedAt)) {
        _dismissed.delete(key);
        changed = true;
      }
    }
    if (changed) _saveDismissed();
  }

  // ── Auth tracking ─────────────────────────────────────────────
  async function _resolveUser() {
    if (!window.sb) return;
    try {
      const { data } = await window.sb.auth.getUser();
      _userId = data?.user?.id || null;
      _isAnon = !!data?.user?.is_anonymous;
    } catch { _userId = null; _isAnon = false; }
  }

  function _watchAuth() {
    if (_authUnsub || !window.sb) return;
    const { data } = window.sb.auth.onAuthStateChange((_event, session) => {
      const newId    = session?.user?.id || null;
      const newIsAnon = !!session?.user?.is_anonymous;
      if (newId === _userId && newIsAnon === _isAnon) return;
      _userId = newId;
      _isAnon = newIsAnon;
      _loadDismissed();
      _loadLiked();
      if (_visible) _render();
    });
    _authUnsub = data?.subscription?.unsubscribe ?? null;
  }

  // ── Guest upgrade tile ────────────────────────────────────────
  function _guestUpgradeTile() {
    if (!_isAnon) return "";
    return `
      <div class="bnr-tile bnr-tile-guest">
        <div class="bnr-tile-bg bnr-tile-bg-empty"></div>
        <div class="bnr-tile-tint"></div>
        <div class="bnr-guest-inner">
          <div class="bnr-guest-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFD600" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>
              <line x1="17" y1="3" x2="21" y2="7"/>
              <line x1="21" y1="3" x2="17" y2="7"/>
            </svg>
          </div>
          <div class="bnr-guest-copy">
            <p class="bnr-tile-title">Guest Session</p>
            <p class="bnr-tile-info">You're browsing as a guest. Create a free account to save bets, track wins, and appear on the leaderboard. Guest access expires in 48 hours.</p>
            <button class="bnr-guest-signup" id="bnr-guest-signup">
              Create Account
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  // ── Escape ────────────────────────────────────────────────────
  function _esc(v) {
    return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Fetch (include updated_at for admin force-reset logic) ────
  async function _fetch() {
    if (!window.sb) { console.warn("[Banners] sb not ready"); return []; }
    try {
      const { data, error } = await window.sb
        .from("banners")
        .select("id, title, info, image_url, is_pinned, likes, updated_at")
        .eq("is_active", true)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) { console.error("[Banners] fetch error:", error.message || error); return []; }
      return Array.isArray(data) ? data : [];
    } catch (e) { console.error("[Banners] fetch exception:", e); return []; }
  }

  // ── Render tile ───────────────────────────────────────────────
  function _tile(b) {
    if (_dismissed.has(String(b.id))) return "";
    const liked = _liked.has(String(b.id));
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

  // ── Camera switcher tile ──────────────────────────────────────
  function _cameraTile() {
    return `
      <div class="bnr-tile bnr-tile-camera" id="bnr-camera-tile" role="button" tabindex="0" aria-label="Switch camera location">
        <div class="bnr-tile-bg bnr-tile-bg-empty"></div>
        <div class="bnr-tile-tint"></div>
        <div class="bnr-default-inner">
          <div class="bnr-ai-scan-icon">
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Corner brackets — cyan -->
              <path d="M4 13V4H13" stroke="#00d4ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M31 4H40V13" stroke="#00d4ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 31V40H13" stroke="#00d4ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M31 40H40V31" stroke="#00d4ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <!-- Detection box -->
              <rect x="11" y="13" width="22" height="18" rx="1.5" stroke="rgba(0,212,255,0.35)" stroke-width="1" stroke-dasharray="3.5 2.5"/>
              <!-- Corner dots -->
              <circle cx="11" cy="13" r="1.2" fill="#00d4ff" opacity="0.65"/>
              <circle cx="33" cy="13" r="1.2" fill="#00d4ff" opacity="0.65"/>
              <circle cx="11" cy="31" r="1.2" fill="#00d4ff" opacity="0.65"/>
              <circle cx="33" cy="31" r="1.2" fill="#00d4ff" opacity="0.65"/>
              <!-- Camera body -->
              <rect x="15" y="18" width="10" height="8" rx="1.2" fill="rgba(0,212,255,0.1)" stroke="rgba(0,212,255,0.6)" stroke-width="0.9"/>
              <!-- Camera lens -->
              <circle cx="20" cy="22" r="2.2" fill="rgba(0,212,255,0.15)" stroke="rgba(0,212,255,0.55)" stroke-width="0.9"/>
              <!-- Camera lens inner dot -->
              <circle cx="20" cy="22" r="0.8" fill="#00d4ff" opacity="0.7"/>
              <!-- Camera tail -->
              <path d="M25 20l4-2v8l-4-2z" fill="rgba(0,212,255,0.12)" stroke="rgba(0,212,255,0.5)" stroke-width="0.8" stroke-linejoin="round"/>
              <!-- Scan line -->
              <line class="bnr-detect-scan" x1="11" y1="22" x2="33" y2="22" stroke="#00d4ff" stroke-width="0.8" opacity="0.5"/>
            </svg>
          </div>
          <div class="bnr-default-copy">
            <p class="bnr-tile-title">Live Cameras</p>
            <p class="bnr-tile-info">Browse active camera locations and preview before switching.</p>
          </div>
        </div>
        <div class="bnr-default-status-bar">
          <span class="bnr-ai-dot" style="background:#00d4ff;animation:bnr-ai-pulse 2s ease-in-out infinite;"></span>
          <span class="bnr-ai-label">MULTI-CAM</span>
          <span class="bnr-standby-label" style="color:#00d4ff;">VIEW ALL</span>
        </div>
      </div>`;
  }

  // ── Play tile ─────────────────────────────────────────────────
  function _playTile() {
    const live = _sessionLive;
    const scanColor = live ? "#FFD600" : "#00d4ff";
    return `
      <div class="bnr-tile bnr-tile-play ${live ? "bnr-tile-live" : ""}">
        <div class="bnr-tile-bg bnr-tile-bg-empty"></div>
        <div class="bnr-tile-tint"></div>
        <div class="bnr-default-inner">
          <div class="bnr-ai-scan-icon">
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Corner brackets -->
              <path d="M4 13V4H13" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M31 4H40V13" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 31V40H13" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M31 40H40V31" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <!-- Detection box -->
              <rect x="11" y="13" width="22" height="18" rx="1.5" stroke="rgba(255,214,0,0.38)" stroke-width="1" stroke-dasharray="3.5 2.5"/>
              <!-- Corner dots -->
              <circle cx="11" cy="13" r="1.2" fill="#FFD600" opacity="0.7"/>
              <circle cx="33" cy="13" r="1.2" fill="#FFD600" opacity="0.7"/>
              <circle cx="11" cy="31" r="1.2" fill="#FFD600" opacity="0.7"/>
              <circle cx="33" cy="31" r="1.2" fill="#FFD600" opacity="0.7"/>
              ${live ? `
              <!-- Round active: play triangle -->
              <polygon points="18,17 18,27 29,22" fill="rgba(255,214,0,0.82)" stroke="#FFD600" stroke-width="0.7" stroke-linejoin="round"/>
              <circle cx="22" cy="22" r="5.5" fill="none" stroke="rgba(255,214,0,0.3)" stroke-width="0.9"/>
              ` : `
              <!-- Waiting: clock/timer -->
              <circle cx="22" cy="22" r="5.5" fill="none" stroke="rgba(255,214,0,0.32)" stroke-width="1"/>
              <line x1="22" y1="18" x2="22" y2="22" stroke="#FFD600" stroke-width="1.3" stroke-linecap="round" opacity="0.8"/>
              <line x1="22" y1="22" x2="25" y2="25" stroke="#FFD600" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/>
              `}
              <!-- Scan line -->
              <line class="bnr-detect-scan" x1="11" y1="22" x2="33" y2="22" stroke="${scanColor}" stroke-width="0.8" opacity="0.6"/>
            </svg>
          </div>
          <div class="bnr-default-copy">
            <p class="bnr-tile-title">${live ? "Round Active" : "Play"}</p>
            <p class="bnr-tile-info">${live
              ? "A betting round is live — place your bet before time runs out."
              : "Watch the feed. Count the vehicles. A round is coming soon."
            }</p>
          </div>
        </div>
        <div class="bnr-default-status-bar">
          <span class="bnr-ai-dot ${live ? "bnr-ai-dot-live" : ""}"></span>
          <span class="bnr-ai-label">${live ? "ROUND OPEN" : "WAITING"}</span>
          <span class="bnr-standby-label ${live ? "bnr-standby-live" : ""}">${live ? "BET NOW" : "STANDBY"}</span>
        </div>
      </div>`;
  }

  // ── Default "no round" tile ───────────────────────────────────
  function _defaultTile() {
    return `
      <div class="bnr-tile bnr-tile-default">
        <div class="bnr-tile-bg bnr-tile-bg-empty"></div>
        <div class="bnr-tile-tint"></div>
        <div class="bnr-default-inner">
          <div class="bnr-ai-scan-icon">
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Corner brackets -->
              <path d="M4 13V4H13" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M31 4H40V13" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 31V40H13" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M31 40H40V31" stroke="#FFD600" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <!-- Detection box -->
              <rect x="11" y="13" width="22" height="18" rx="1.5" stroke="rgba(255,214,0,0.42)" stroke-width="1" stroke-dasharray="3.5 2.5"/>
              <!-- Corner dots on detection box -->
              <circle cx="11" cy="13" r="1.2" fill="#FFD600" opacity="0.7"/>
              <circle cx="33" cy="13" r="1.2" fill="#FFD600" opacity="0.7"/>
              <circle cx="11" cy="31" r="1.2" fill="#FFD600" opacity="0.7"/>
              <circle cx="33" cy="31" r="1.2" fill="#FFD600" opacity="0.7"/>
              <!-- Car body -->
              <rect x="15" y="19" width="14" height="7" rx="1.5" fill="rgba(0,212,255,0.12)" stroke="rgba(0,212,255,0.55)" stroke-width="0.9"/>
              <!-- Roof -->
              <path d="M17.5 19L19.5 16H24.5L26.5 19" stroke="rgba(0,212,255,0.45)" stroke-width="0.9" fill="rgba(0,212,255,0.07)"/>
              <!-- Wheels -->
              <circle cx="18" cy="26" r="1.3" fill="rgba(0,212,255,0.45)" stroke="rgba(0,212,255,0.65)" stroke-width="0.7"/>
              <circle cx="26" cy="26" r="1.3" fill="rgba(0,212,255,0.45)" stroke="rgba(0,212,255,0.65)" stroke-width="0.7"/>
              <!-- Animated scan line -->
              <line class="bnr-detect-scan" x1="11" y1="22" x2="33" y2="22" stroke="#00d4ff" stroke-width="0.8" opacity="0.75"/>
            </svg>
          </div>
          <div class="bnr-default-copy">
            <p class="bnr-tile-title">No Active Round</p>
            <p class="bnr-tile-info">AI is scanning live traffic. A new round is incoming.</p>
          </div>
        </div>
        <div class="bnr-default-status-bar">
          <span class="bnr-ai-dot"></span>
          <span class="bnr-ai-label">AI SCANNING</span>
          <span class="bnr-standby-label">STANDBY</span>
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

    const visible = _banners.filter(b => !_dismissed.has(String(b.id)));
    const bannerTiles = visible.map(_tile).join("");

    section.innerHTML = `
      <div class="bnr-header">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Updates &amp; Announcements</span>
      </div>
      <div class="bnr-grid">${_playTile()}${_defaultTile()}${_cameraTile()}${_guestUpgradeTile()}${bannerTiles}</div>`;
    if (visible.length) _wireGrid(section);

    // Wire guest signup → register modal
    section.querySelector("#bnr-guest-signup")?.addEventListener("click", () => {
      document.getElementById("login-modal")?.classList.add("hidden");
      document.getElementById("register-modal")?.classList.remove("hidden");
      document.getElementById("modal-reg-email")?.focus();
    });
  }

  function _wireGrid(container) {
    container.querySelectorAll(".bnr-dismiss").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Store dismiss with current timestamp for admin force-reset comparison
        _dismissed.set(String(btn.dataset.id), new Date().toISOString());
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
    const wasLiked = _liked.has(String(id));
    const banner = _banners.find(b => b.id === id);
    if (!banner) return;

    // Optimistic
    if (wasLiked) { _liked.delete(String(id)); } else { _liked.add(String(id)); }
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

    // Resolve current user first so localStorage keys are scoped correctly
    await _resolveUser();
    _loadDismissed();
    _loadLiked();
    _watchAuth();

    [_banners, _sessionLive] = await Promise.all([_fetch(), _checkSession()]);

    // Clear any dismissals that admin has overridden via banner updates
    _pruneOutdatedDismissals();

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
