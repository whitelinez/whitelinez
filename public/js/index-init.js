const GUEST_TS_KEY = "wlz.guest.session_ts";

// ── Vision HUD collapse toggle ────────────────────────────────────────────
(function () {
  const hud = document.getElementById("ml-hud");
  if (!hud) return;

  // Restore persisted state
  if (localStorage.getItem("wlz.hud.collapsed") === "1") {
    hud.classList.add("is-collapsed");
  }

  // Click anywhere on the hub to toggle collapse/expand
  hud.addEventListener("click", () => {
    const collapsed = hud.classList.toggle("is-collapsed");
    localStorage.setItem("wlz.hud.collapsed", collapsed ? "1" : "0");
  });
}());

(async () => {
  const PUBLIC_DAY_PRESET = {
    brightness: 102,
    contrast: 106,
    saturate: 104,
    hue: 0,
    blur: 0,
  };
  const PUBLIC_NIGHT_PRESET = {
    brightness: 132,
    contrast: 136,
    saturate: 122,
    hue: 0,
    blur: 0.2,
  };
  const PUBLIC_DETECTION_SETTINGS_KEY = "whitelinez.detection.overlay_settings.v4";
  async function resolveActiveCamera() {
    const { data, error } = await window.sb
      .from("cameras")
      .select("id, name, ipcam_alias, created_at, feed_appearance")
      .eq("is_active", true);
    if (error) throw error;
    const cams = Array.isArray(data) ? data : [];
    if (!cams.length) return null;
    const rank = (cam) => {
      const alias = String(cam?.ipcam_alias || "").trim();
      if (!alias) return 0;
      if (alias.toLowerCase() === "your-alias") return 1;
      return 2;
    };
    cams.sort((a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar !== br) return br - ar;
      const at = Date.parse(a?.created_at || 0) || 0;
      const bt = Date.parse(b?.created_at || 0) || 0;
      if (at !== bt) return bt - at;
      return String(b?.id || "").localeCompare(String(a?.id || ""));
    });
    return cams[0] || null;
  }

  function isNightWindowNow() {
    const h = new Date().getHours();
    return h >= 18 || h < 6;
  }
  function buildVideoFilter(a) {
    const brightness = Math.max(50, Math.min(180, Number(a?.brightness) || 100));
    const contrast = Math.max(50, Math.min(200, Number(a?.contrast) || 100));
    const saturate = Math.max(0, Math.min(220, Number(a?.saturate) || 100));
    const hue = Math.max(0, Math.min(360, Number(a?.hue) || 0));
    const blur = Math.max(0, Math.min(4, Number(a?.blur) || 0));
    return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%) hue-rotate(${hue}deg) blur(${blur.toFixed(1)}px)`;
  }
  async function applyPublicFeedAppearance(videoEl) {
    if (!videoEl || !window.sb) return;
    try {
      const cam = await resolveActiveCamera();
      const cfg = cam?.feed_appearance && typeof cam.feed_appearance === "object"
        ? cam.feed_appearance
        : null;
      if (!cfg || cfg.push_public === false) {
        videoEl.style.filter = "";
        return;
      }
      if (cfg.detection_overlay && typeof cfg.detection_overlay === "object") {
        const publicOverlayCfg = {
          ...cfg.detection_overlay,
          outside_scan_show_labels: true,
        };
        try {
          localStorage.setItem(PUBLIC_DETECTION_SETTINGS_KEY, JSON.stringify(publicOverlayCfg));
        } catch {}
        window.dispatchEvent(new CustomEvent("detection:settings-update", { detail: publicOverlayCfg }));
      }
      const appearance = cfg.auto_day_night
        ? (isNightWindowNow() ? PUBLIC_NIGHT_PRESET : PUBLIC_DAY_PRESET)
        : (cfg.appearance || {});
      videoEl.style.filter = buildVideoFilter(appearance);
    } catch {
      // Keep public view resilient if appearance config fetch fails.
    }
  }

  // ── Guest session 48h expiry scrub ────────────────────────────────────────
  {
    const earlySession = await Auth.getSession();
    if (earlySession?.user?.is_anonymous) {
      const ts = Number(localStorage.getItem(GUEST_TS_KEY) || 0);
      if (ts > 0 && Date.now() - ts > 48 * 60 * 60 * 1000) {
        localStorage.removeItem(GUEST_TS_KEY);
        try { await window.sb.auth.signOut(); } catch {}
        window.location.reload();
        return;
      }
    }
  }

  // Clean up OAuth redirect params from URL (Google OAuth lands with ?code= or #access_token)
  if (
    window.location.search.includes("code=") ||
    window.location.search.includes("error=") ||
    window.location.hash.includes("access_token")
  ) {
    history.replaceState(null, "", window.location.pathname);
  }

  const session = await Auth.getSession();
  const currentUserId = session?.user?.id || "";

  async function refreshNavBalance() {
    if (!currentUserId) return;
    try {
      const { data } = await window.sb
        .from("user_balances")
        .select("balance")
        .eq("user_id", currentUserId)
        .maybeSingle();
      const balEl = document.getElementById("nav-balance");
      const balValEl = document.getElementById("nav-balance-val");
      if (balEl && data?.balance != null) {
        if (balValEl) balValEl.textContent = Number(data.balance).toLocaleString();
        balEl.classList.remove("hidden");
      }
    } catch {
      // WS updates still handle most cases; keep silent on poll failures.
    }
  }

  function defaultAvatar(_seed) {
    const accent = '#FFD600';
    // Plain SVG silhouette: circle head + body fill, flat monochrome
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'>
      <rect width='64' height='64' rx='8' fill='#0c1320'/>
      <circle cx='32' cy='23' r='12' fill='${accent}' opacity='0.88'/>
      <path d='M8 62 Q8 44 32 40 Q56 44 56 62Z' fill='${accent}' opacity='0.7'/>
      <rect width='64' height='64' rx='8' fill='none' stroke='${accent}' stroke-width='1' opacity='0.22'/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function isAllowedAvatarUrl(url) {
    if (!url || typeof url !== "string") return false;
    const u = url.trim();
    if (!u) return false;
    if (u.startsWith("data:image/")) return true;
    if (u.startsWith("blob:")) return true;
    if (u.startsWith("/")) return true;
    try {
      const parsed = new URL(u, window.location.origin);
      if (parsed.origin === window.location.origin) return true;
      if (parsed.hostname.endsWith(".supabase.co")) return true;
      return false;
    } catch {
      return false;
    }
  }

  function _applyNavSession(s) {
    if (!s) return;
    document.getElementById("nav-auth")?.classList.add("hidden");
    document.getElementById("nav-user")?.classList.remove("hidden");
    const user = s.user || {};
    const isAnon = Auth.isAnonymous(s);
    const avatarRaw = user.user_metadata?.avatar_url || "";
    const avatar = isAllowedAvatarUrl(avatarRaw)
      ? avatarRaw
      : defaultAvatar(user.id || user.email || "user");
    const navAvatar = document.getElementById("nav-avatar");
    if (navAvatar) {
      navAvatar.onerror = () => { navAvatar.src = defaultAvatar(user.id || "user"); };
      navAvatar.src = avatar;
    }
    if (isAnon) {
      // Show a guest badge next to balance
      const balEl = document.getElementById("nav-balance");
      if (balEl && !document.getElementById("nav-guest-badge")) {
        const badge = document.createElement("span");
        badge.id = "nav-guest-badge";
        badge.className = "nav-guest-badge";
        badge.textContent = "Guest";
        balEl.insertAdjacentElement("afterend", badge);
      }
    }
    if (user.app_metadata?.role === "admin") {
      document.getElementById("nav-admin-link")?.classList.remove("hidden");
      document.getElementById("btn-layout-editor")?.classList.remove("hidden");
    }
  }

  // Nav auth state
  _applyNavSession(session);

  // When a guest session is created mid-session, update nav + balance
  window.addEventListener("session:guest", async () => {
    const newSession = await Auth.getSession();
    _applyNavSession(newSession);
    refreshNavBalance();
  });

  // Play overlay
  document.getElementById("btn-play")?.addEventListener("click", () => {
    document.getElementById("live-video")?.play();
    document.getElementById("play-overlay")?.classList.add("hidden");
  });

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", () => Auth.logout());

  // ── Widget Layout Editor (admin only) ────────────────────────
  document.getElementById("btn-layout-editor")?.addEventListener("click", () => {
    if (window.WidgetLayout) window.WidgetLayout.enter();
  });
  // Load saved layout for all visitors
  if (window.WidgetLayout) window.WidgetLayout.loadLayout();

  // Load all active cameras for failover
  let _streamCameras = [];
  let _streamCamIdx = 0;
  let _failoverPending = false;
  try {
    const { data: camData } = await window.sb
      .from("cameras")
      .select("id, name, ipcam_alias, created_at")
      .eq("is_active", true);
    if (Array.isArray(camData)) {
      _streamCameras = camData
        .filter(c => {
          const a = String(c.ipcam_alias || "").trim();
          return a && a.toLowerCase() !== "your-alias";
        })
        .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    }
  } catch { /* silent — stream works without failover list */ }

  // Stream switching overlay — shown when user picks a new AI camera
  let _switchTimer1 = null, _switchTimer2 = null;
  function _showSwitchOverlay() {
    const ov = document.getElementById("stream-switching-overlay");
    if (!ov) return;
    ["sso-step-1","sso-step-2","sso-step-3"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove("active","done"); }
    });
    document.getElementById("sso-step-1")?.classList.add("active");
    ov.classList.remove("hidden");
    clearTimeout(_switchTimer1); clearTimeout(_switchTimer2);
    _switchTimer1 = setTimeout(() => {
      document.getElementById("sso-step-1")?.classList.replace("active","done");
      document.getElementById("sso-step-2")?.classList.add("active");
    }, 800);
    _switchTimer2 = setTimeout(() => {
      document.getElementById("sso-step-2")?.classList.replace("active","done");
      document.getElementById("sso-step-3")?.classList.add("active");
    }, 1800);
  }
  function _hideSwitchOverlay() {
    clearTimeout(_switchTimer1); clearTimeout(_switchTimer2);
    const ov = document.getElementById("stream-switching-overlay");
    ov?.classList.add("hidden");
  }

  window.addEventListener("stream:switching", () => { _showSwitchOverlay(); });

  window.addEventListener("camera:switched", (e) => {
    const { isAI, alias } = e.detail || {};
    if (!isAI) { _hideSwitchOverlay(); return; }
    // Clear stale detection boxes immediately
    DetectionOverlay.clearDetections?.();
    // Reset FPS samples so we get clean readings for the new stream
    FpsOverlay.reset();
    // Reset Vision HUD counters + re-seed from new camera's telemetry
    MlOverlay.resetForNewScene();
    // Immediately reload detection zones + landmarks for the switched-to camera
    ZoneOverlay.reloadZones(alias || null);
    // Update header cam chip label
    const chipNameEl = document.getElementById("header-cam-name");
    if (chipNameEl && alias) chipNameEl.textContent = alias;
    // Update scene chip location
    const chipLocEl = document.getElementById("chip-location");
    if (chipLocEl && alias) {
      chipLocEl.textContent = "📍 " + alias;
      chipLocEl.classList.remove("hidden");
    }
    // Update active pill
    document.querySelectorAll(".cam-pill").forEach(p => {
      p.classList.toggle("active", (p.dataset.alias || "") === (alias || ""));
    });
  });

  // Stream offline overlay + camera failover
  window.addEventListener("stream:status", (e) => {
    const overlay = document.getElementById("stream-offline-overlay");
    const infoEl = overlay?.querySelector(".stream-offline-info");

    if (e.detail?.status === "down") {
      overlay?.classList.remove("hidden");

      // Try next camera if multiple are configured
      if (!_failoverPending && _streamCameras.length > 1) {
        _failoverPending = true;
        _streamCamIdx = (_streamCamIdx + 1) % _streamCameras.length;
        const next = _streamCameras[_streamCamIdx];
        if (infoEl) infoEl.textContent = "Trying backup stream...";
        setTimeout(() => {
          Stream.setAlias(next?.ipcam_alias || "");
          _failoverPending = false;
        }, 2500);
      } else if (infoEl) {
        infoEl.textContent = "Reconnecting to live feed...";
      }
    } else if (e.detail?.status === "ok") {
      overlay?.classList.add("hidden");
      _failoverPending = false;
      _hideSwitchOverlay();
    }
  });

  // Stream — initialise with the AI-active camera alias so the correct feed
  // loads immediately without waiting for CameraSwitcher.init() to resolve.
  const video = document.getElementById("live-video");
  await Stream.init(video, { alias: _streamCameras[0]?.ipcam_alias || "" });
  await applyPublicFeedAppearance(video);
  setInterval(() => applyPublicFeedAppearance(video), 15000);
  FpsOverlay.init(video, document.getElementById("fps-overlay"));

  // Canvas overlays
  const zoneCanvas = document.getElementById("zone-canvas");
  ZoneOverlay.init(video, zoneCanvas);

  const detectionCanvas = document.getElementById("detection-canvas");
  DetectionOverlay.init(video, detectionCanvas);

  // Floating count widget
  const streamWrapper = document.querySelector(".stream-wrapper");
  FloatingCount.init(streamWrapper);

  // Count widget — mobile tap toggle (desktop uses CSS :hover)
  const countWidget = document.getElementById("count-widget");
  if (countWidget) {
    let _cwTouchMoved = false;
    countWidget.addEventListener("touchstart", () => { _cwTouchMoved = false; }, { passive: true });
    countWidget.addEventListener("touchmove",  () => { _cwTouchMoved = true;  }, { passive: true });
    countWidget.addEventListener("touchend", (e) => {
      if (_cwTouchMoved) return; // ignore scroll swipes
      e.stopPropagation();
      countWidget.classList.toggle("cw-active");
    }, { passive: true });
    document.addEventListener("touchstart", (e) => {
      if (!countWidget.contains(e.target)) countWidget.classList.remove("cw-active");
    }, { passive: true });
  }
  MlOverlay.init();

  // WS counter — hooks into floating widget
  Counter.init();

  // Patch Counter to update FloatingCount status dot
  window.addEventListener("count:update", () => FloatingCount.setStatus(true));

  // Markets + Live Bet panel
  LiveBet.init();
  Markets.init();

  // Chat
  Chat.init(session);
  StreamChatOverlay.init();

  // Activity — broadcasts to chat; leaderboard loads lazily on tab open
  Activity.init();
  let _lbWindow = 60;

  document.querySelector('.tab-btn[data-tab="leaderboard"]')?.addEventListener("click", () => {
    Activity.loadLeaderboard(_lbWindow);
  });
  document.getElementById("lb-refresh")?.addEventListener("click", () => {
    Activity.loadLeaderboard(_lbWindow);
  });

  // Window tab switching on leaderboard
  document.getElementById("tab-leaderboard")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".lb-wtab");
    if (!btn) return;
    _lbWindow = parseInt(btn.dataset.win, 10);
    document.querySelectorAll(".lb-wtab").forEach(b => b.classList.toggle("active", b === btn));
    Activity.loadLeaderboard(_lbWindow);
  });

  // ── Global heartbeat ─────────────────────────────────────────────────────
  // Supabase realtime: auto-refresh markets + banners when rounds/sessions/banners change.
  if (window.sb) {
    window.sb.channel("site-heartbeat")
      .on("postgres_changes", { event: "*", schema: "public", table: "bet_rounds" }, () => {
        Markets.loadMarkets();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "round_sessions" }, () => {
        Markets.loadMarkets();
        // Re-poll session state in banners (triggers play/default tile swap)
        if (window.Banners) window.Banners.show();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "banners" }, () => {
        if (window.Banners) window.Banners.show();
      })
      .subscribe();
  }

  MlShowcase.init();
  CameraSwitcher.init();

  // ws_account — per-user events (balance, bet resolution)
  if (session) {
    refreshNavBalance();
    setInterval(refreshNavBalance, 20000);
    _connectUserWs(session);
  }

  // Nav balance display from ws_account
  window.addEventListener("balance:update", (e) => {
    const balEl    = document.getElementById("nav-balance");
    const balValEl = document.getElementById("nav-balance-val");
    if (balEl) {
      if (balValEl) balValEl.textContent = (e.detail ?? 0).toLocaleString();
      balEl.classList.remove("hidden");
    }
  });

  // Reload markets on bet placed
  window.addEventListener("bet:placed", () => Markets.loadMarkets());
  window.addEventListener("bet:placed", refreshNavBalance);

  // Handle bet resolution from ws_account
  window.addEventListener("bet:resolved", (e) => {
    LiveBet.onBetResolved(e.detail);
    refreshNavBalance();
  });

  // ── Header cam chip — initial set from loaded camera list ──────────────────
  {
    const firstCam = _streamCameras[0];
    if (firstCam) {
      const chipNameEl = document.getElementById("header-cam-name");
      if (chipNameEl) chipNameEl.textContent = firstCam.name || firstCam.ipcam_alias || "Live Camera";
      const chipLocEl = document.getElementById("chip-location");
      if (chipLocEl) {
        chipLocEl.textContent = "📍 " + (firstCam.name || firstCam.ipcam_alias || "Jamaica");
        chipLocEl.classList.remove("hidden");
      }
    }
  }

  // ── Camera pill strip render ────────────────────────────────────────────────
  {
    const pillStrip = document.getElementById("cam-pill-strip");
    if (pillStrip && _streamCameras.length > 0) {
      const firstAlias = _streamCameras[0]?.ipcam_alias || "";
      pillStrip.innerHTML = _streamCameras.map(c => {
        const alias = c.ipcam_alias || "";
        const label = c.name || alias || "Camera";
        return `<button class="cam-pill${alias === firstAlias ? ' active' : ''}" data-alias="${alias}">
          <span class="cam-pill-dot"></span>${label}
        </button>`;
      }).join("");
      if (_streamCameras.length < 2) pillStrip.style.display = "none";
      pillStrip.addEventListener("click", (e) => {
        const pill = e.target.closest(".cam-pill");
        if (!pill || pill.classList.contains("active")) return;
        const alias = pill.dataset.alias || "";
        if (alias) CameraSwitcher.switchTo(alias);
      });
    }
  }

  // ── Health fetch — watching count ─────────────────────────────────────────
  try {
    const hRes = await fetch("/api/health");
    if (hRes.ok) {
      const hData = await hRes.json();
      const watchers = Number(hData.total_ws_connections || 0);
      const watchEl = document.getElementById("header-watching");
      const watchValEl = document.getElementById("header-watching-val");
      if (watchEl && watchers > 0) {
        if (watchValEl) watchValEl.textContent = watchers;
        watchEl.classList.remove("hidden");
      }
    }
  } catch { /* non-critical */ }
})();


// ── Bot info in VISION HUD — training day + knowledge % ──────────────────────
(function initBotHud() {
  const TRAIN_START  = new Date('2026-02-23T00:00:00');
  const BASE_KNOW    = 71.8;   // % on day 0
  const KNOW_PER_DAY = 0.35;   // % gained per day
  const KNOW_MAX     = 98.5;

  function update() {
    const days = Math.floor((Date.now() - TRAIN_START) / 86400000);
    const know = Math.min(KNOW_MAX, BASE_KNOW + days * KNOW_PER_DAY).toFixed(1);
    const el = document.getElementById('ml-hud-bot');
    if (el) el.innerHTML = `<span>TRAIN · DAY ${days}</span><span>KNOW · ${know}%</span>`;
  }

  update();
  // Schedule a re-tick at the next midnight, then daily after that
  const now = new Date();
  const msToMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  setTimeout(() => { update(); setInterval(update, 86400000); }, msToMidnight);
})();


// ── Logo AI frame — random pulse ──────────────────────────────────────────────
(function initLogoPulse() {
  const frame = document.querySelector('.logo-ai-frame');
  const logo  = document.querySelector('.logo');
  if (!frame || !logo) return;

  function schedule() {
    const delay = 4000 + Math.random() * 10000; // 4–14 s between pulses
    setTimeout(() => {
      if (logo.matches(':hover') || frame.classList.contains('logo-ai-pulsing')) {
        schedule(); // hovering or already animating — skip, try again soon
        return;
      }
      frame.classList.add('logo-ai-pulsing');
      frame.addEventListener('animationend', () => {
        frame.classList.remove('logo-ai-pulsing');
        schedule();
      }, { once: true });
    }, delay);
  }

  schedule();
})();


// ── User WebSocket (/ws/account) ──────────────────────────────────────────────
function _connectUserWs(session) {
  let ws = null;
  let backoff = 2000;
  let attempts = 0;
  let waitForToken = null;
  let reconnectTimer = null;

  async function connect() {
    const jwt = await Auth.getJwt();
    if (!jwt) return;
    const wssUrl = (typeof Stream !== "undefined" && Stream.getWssUrl)
      ? Stream.getWssUrl()
      : null;
    if (!wssUrl) {
      // WS URL not ready yet — retry after stream.js has fetched the token.
      setTimeout(connect, 3000);
      return;
    }
    const accountUrl = wssUrl.replace("/ws/live", "/ws/account");
    ws = new WebSocket(`${accountUrl}?token=${encodeURIComponent(jwt)}`);
    attempts += 1;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      backoff = 2000;
      attempts = 0;
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "balance") {
          window.dispatchEvent(new CustomEvent("balance:update", { detail: data.balance }));
        } else if (data.type === "bet_resolved") {
          if (data.user_id && String(data.user_id) !== String(session?.user?.id || "")) return;
          window.dispatchEvent(new CustomEvent("bet:resolved", { detail: data }));
        }
      } catch {}
    };

    ws.onclose = (evt) => {
      ws = null;
      const hardRejected = evt?.code === 4001 || evt?.code === 4003;
      if (hardRejected) {
        // Auth/origin failures won't self-heal with rapid retries.
        reconnectTimer = setTimeout(connect, 60000);
        return;
      }
      if (!opened && attempts >= 8) {
        // Keep nav balance alive via HTTP polling; stop aggressive WS retry loop.
        return;
      }
      backoff = Math.min(backoff * 2, 30000);
      reconnectTimer = setTimeout(connect, backoff);
    };

    ws.onerror = () => {
      // Browser prints socket errors to console; keep handler silent.
    };
  }

  // Wait for WS URL to be ready (populated by stream.js after /api/token fetch)
  waitForToken = setInterval(() => {
    const ready = typeof Stream !== "undefined" && Stream.getWssUrl && Stream.getWssUrl();
    if (ready) {
      clearInterval(waitForToken);
      connect();
    }
  }, 1000);

  window.addEventListener("beforeunload", () => {
    if (waitForToken) clearInterval(waitForToken);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try { ws?.close(); } catch {}
  });
}

// ── Login Modal ────────────────────────────────────────────────────────────────
(function _loginModal() {
  const modal    = document.getElementById("login-modal");
  const backdrop = document.getElementById("login-modal-backdrop");
  const closeBtn = document.getElementById("login-modal-close");
  const openBtn  = document.getElementById("btn-open-login");
  const form     = document.getElementById("modal-login-form");
  const errorEl  = document.getElementById("modal-auth-error");
  const submitBtn = document.getElementById("modal-submit-btn");

  if (!modal) return;

  function open() {
    modal.classList.remove("hidden");
    document.getElementById("modal-email")?.focus();
  }

  function close() {
    modal.classList.add("hidden");
    if (errorEl) errorEl.textContent = "";
    if (form) form.reset();
  }

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";

    try {
      await Auth.login(
        document.getElementById("modal-email").value,
        document.getElementById("modal-password").value
      );
      // Reload the page with the active session
      window.location.reload();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || "Login failed";
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
  });

  // Switch to register modal
  document.getElementById("switch-to-register")?.addEventListener("click", (e) => {
    e.preventDefault();
    close();
    document.getElementById("register-modal")?.classList.remove("hidden");
    document.getElementById("modal-reg-email")?.focus();
  });

  // Google login
  document.getElementById("modal-google-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("modal-google-btn");
    const errEl = document.getElementById("modal-auth-error");
    if (errEl) errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Redirecting to Google...";
    try {
      await Auth.signInWithGoogle();
    } catch (err) {
      if (errEl) errEl.textContent = err.message || "Google login failed.";
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google`;
    }
  });

  // Guest login
  document.getElementById("modal-guest-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("modal-guest-btn");
    const errEl = document.getElementById("modal-auth-error");
    if (errEl) errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Connecting...";
    try {
      await Auth.signInAnon();
      localStorage.setItem(GUEST_TS_KEY, String(Date.now()));
      window.location.reload();
    } catch (err) {
      console.error("[GuestLogin] Full error object:", err);
      const msg = err?.message || "Guest access unavailable.";
      // Surface actionable hint for the most common Supabase config issue
      const display = msg.toLowerCase().includes("disabled")
        ? "Anonymous sign-ins are disabled in Supabase. Enable under Authentication → Providers → Anonymous."
        : msg;
      if (errEl) errEl.textContent = display;
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg> Continue as Guest`;
    }
  });
}());

// ── Register Modal ─────────────────────────────────────────────────────────────
(function _registerModal() {
  const modal    = document.getElementById("register-modal");
  const backdrop = document.getElementById("register-modal-backdrop");
  const closeBtn = document.getElementById("register-modal-close");
  const openBtn  = document.getElementById("btn-open-register");
  const form     = document.getElementById("modal-register-form");
  const errorEl  = document.getElementById("modal-register-error");
  const submitBtn = document.getElementById("register-submit-btn");

  if (!modal) return;

  function open() {
    modal.classList.remove("hidden");
    document.getElementById("modal-reg-email")?.focus();
  }

  function close() {
    modal.classList.add("hidden");
    if (errorEl) errorEl.textContent = "";
    if (form) form.reset();
  }

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  // Google login (register modal)
  document.getElementById("reg-google-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("reg-google-btn");
    if (errorEl) errorEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Redirecting to Google...";
    try {
      await Auth.signInWithGoogle();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || "Google login failed.";
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google`;
    }
  });

  // Switch back to login
  document.getElementById("switch-to-login")?.addEventListener("click", (e) => {
    e.preventDefault();
    close();
    document.getElementById("login-modal")?.classList.remove("hidden");
    document.getElementById("modal-email")?.focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = "";
    const pass    = document.getElementById("modal-reg-password").value;
    const confirm = document.getElementById("modal-reg-confirm").value;
    if (pass !== confirm) {
      if (errorEl) errorEl.textContent = "Passwords do not match.";
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account...";
    try {
      await Auth.register(
        document.getElementById("modal-reg-email").value,
        pass
      );
      close();
      // Open login modal with success hint
      document.getElementById("login-modal")?.classList.remove("hidden");
      const authErr = document.getElementById("modal-auth-error");
      if (authErr) {
        authErr.style.color = "#00d4ff";
        authErr.textContent = "Account created. Please sign in.";
      }
      document.getElementById("modal-email")?.focus();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || "Registration failed.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account";
    }
  });
}());

// ── Header PLAY CTA ──────────────────────────────────────────────────────────
(function _initPlayCta() {
  const btn = document.getElementById("header-play-cta");
  if (!btn) return;

  // Update button state when a round opens / closes
  function _syncPlayBtn() {
    const roundOpen = !!document.querySelector(".bp-panel-active, #bet-panel:not(.hidden)");
    btn.classList.toggle("round-open", roundOpen);
    btn.textContent = roundOpen ? "PREDICT NOW" : "PLAY";
  }

  btn.addEventListener("click", () => {
    // Scroll sidebar to PLAY tab
    const playTab = document.querySelector('.tab-btn[data-tab="markets"]');
    if (playTab) playTab.click();
    document.getElementById("sidebar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.addEventListener("round:opened",  _syncPlayBtn);
  window.addEventListener("round:closed",  _syncPlayBtn);
  window.addEventListener("bet:placed",    _syncPlayBtn);
}());


// ── Government Mode Overlay (Analytics) ─────────────────────────────────────


// ── ML HUD expand / collapse toggle (new AI Pulse design) ───────────────────
(function _initAiPulseToggle() {
  const hud = document.getElementById("ml-hud");
  if (!hud) return;

  // Replace old is-collapsed toggle with new is-expanded toggle
  // (old code still runs for is-collapsed; this adds is-expanded)
  hud.addEventListener("click", () => {
    hud.classList.toggle("is-expanded");
  });
}());


// ── Onboarding Overlay ───────────────────────────────────────────────────────
(function _initOnboarding() {
  const OB_KEY    = "wlz.onboarding.done";
  const overlay   = document.getElementById("onboarding-overlay");
  const skipBtn   = document.getElementById("ob-skip");
  const nextBtn   = document.getElementById("ob-next");
  const steps     = Array.from(document.querySelectorAll(".ob-step"));
  const dots      = Array.from(document.querySelectorAll(".ob-dot"));

  if (!overlay || !steps.length) return;
  if (localStorage.getItem(OB_KEY)) return; // already seen

  let _step = 0;

  function _setStep(n) {
    _step = n;
    steps.forEach((s, i) => s.classList.toggle("active", i === n));
    dots.forEach((d,  i) => d.classList.toggle("active", i === n));
    if (nextBtn) nextBtn.textContent = n < steps.length - 1 ? "NEXT →" : "LET'S GO →";
  }

  function _done() {
    localStorage.setItem(OB_KEY, "1");
    overlay.classList.add("hidden");
  }

  _setStep(0);
  overlay.classList.remove("hidden");

  nextBtn?.addEventListener("click", () => {
    if (_step < steps.length - 1) _setStep(_step + 1);
    else _done();
  });
  skipBtn?.addEventListener("click", _done);

  document.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("hidden")) {
      if (e.key === "ArrowRight" || e.key === "Enter") nextBtn?.click();
      if (e.key === "Escape") _done();
    }
  });
}());


// ── Mobile Nav — bottom sheet + swipe gestures ───────────────────────────────
(function _initMobileNav() {
  const sidebar      = document.querySelector(".sidebar");
  const streamPanel  = document.querySelector(".stream-panel");
  const tabBtns      = document.querySelectorAll(".tab-btn");
  if (!sidebar || !tabBtns.length) return;

  const isMobile = () => window.innerWidth < 768;

  // ── Bottom sheet toggle ──────────────────────────────────────────────────
  function expandTo(tabBtn) {
    sidebar.classList.add("expanded");
    tabBtns.forEach(b => b.classList.remove("active"));
    if (tabBtn) tabBtn.classList.add("active");
    // Show the right tab content
    const target = tabBtn?.dataset?.tab;
    if (target) {
      document.querySelectorAll(".tab-content").forEach(el => {
        el.classList.toggle("active", el.id === `tab-${target}`);
      });
    }
  }

  function collapse() {
    sidebar.classList.remove("expanded");
  }

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      if (!isMobile()) return; // desktop handles tabs via existing logic

      const alreadyActive = btn.classList.contains("active") && sidebar.classList.contains("expanded");
      if (alreadyActive) {
        collapse();
        tabBtns.forEach(b => b.classList.remove("active"));
      } else {
        expandTo(btn);
        // Trigger lazy-load for leaderboard
        if (btn.dataset.tab === "leaderboard" && window.Activity) {
          const lbWin = parseInt(document.querySelector(".lb-wtab.active")?.dataset?.win || 60);
          Activity.loadLeaderboard(lbWin);
        }
      }
    });
  });

  // Auto-expand PLAY tab on mobile — always show game content by default
  function _autoExpand() {
    if (!isMobile()) return;
    const playBtn = document.querySelector('.tab-btn[data-tab="markets"]');
    if (playBtn) expandTo(playBtn);
  }
  setTimeout(_autoExpand, 300); // after DOM settles

  // ── Swipe up on stream → expand PLAY tab ───────────────────────────────
  let _touchStartY = 0;
  let _touchStartX = 0;

  streamPanel?.addEventListener("touchstart", e => {
    _touchStartY = e.touches[0].clientY;
    _touchStartX = e.touches[0].clientX;
  }, { passive: true });

  streamPanel?.addEventListener("touchend", e => {
    if (!isMobile()) return;
    const deltaY = _touchStartY - e.changedTouches[0].clientY;
    const deltaX = Math.abs(_touchStartX - e.changedTouches[0].clientX);
    if (deltaY > 55 && deltaX < 40) {
      const playBtn = document.querySelector('.tab-btn[data-tab="markets"]');
      expandTo(playBtn);
    }
  }, { passive: true });

  // ── Swipe down on sidebar → collapse ───────────────────────────────────
  let _sidebarTouchStartY = 0;
  sidebar.addEventListener("touchstart", e => {
    _sidebarTouchStartY = e.touches[0].clientY;
  }, { passive: true });

  sidebar.addEventListener("touchend", e => {
    if (!isMobile()) return;
    const delta = e.changedTouches[0].clientY - _sidebarTouchStartY;
    if (delta > 55 && sidebar.classList.contains("expanded")) {
      collapse();
      tabBtns.forEach(b => b.classList.remove("active"));
    }
  }, { passive: true });

  // ── Visual viewport — keyboard detection for chat ────────────────────────
  if ("visualViewport" in window) {
    window.visualViewport.addEventListener("resize", () => {
      const keyboardOpen = window.visualViewport.height < window.innerHeight * 0.75;
      document.querySelector("#tab-chat")?.classList.toggle("keyboard-open", keyboardOpen);
      // Scroll chat to bottom when keyboard opens
      if (keyboardOpen) {
        const msgs = document.getElementById("chat-messages");
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      }
    });
  }

  // ── Resize: on desktop restore normal layout ────────────────────────────
  window.addEventListener("resize", () => {
    if (!isMobile()) {
      sidebar.classList.remove("expanded");
      // Re-activate first active tab on desktop
      const activeContent = document.querySelector(".tab-content.active");
      if (activeContent) {
        const tabId = activeContent.id.replace("tab-", "");
        tabBtns.forEach(b => {
          b.classList.toggle("active", b.dataset.tab === tabId);
        });
      }
    }
  });

  // ── Nav user dropdown ───────────────────────────────────────────────────
  (function _initNavDropdown() {
    const trigger  = document.getElementById("nav-avatar-trigger");
    const dropdown = document.getElementById("nav-dropdown");
    if (!trigger || !dropdown) return;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !dropdown.hidden;
      dropdown.hidden = open;
      trigger.setAttribute("aria-expanded", String(!open));
    });
    document.addEventListener("click", () => {
      dropdown.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    });
    // Clicks inside dropdown don't close it
    dropdown.addEventListener("click", (e) => e.stopPropagation());
  }());

}());
// ── Gov Analytics Overlay ──────────────────────────────────────────────────
(function initGovOverlay() {
  const overlay  = document.getElementById("gov-overlay");
  const openBtn  = document.getElementById("btn-gov-mode");
  const closeBtn = document.getElementById("btn-close-gov");
  if (!overlay) return;

  // ── State ────────────────────────────────────────────────────────────────
  let _open         = false;
  let _camId        = null;
  let _camName      = null;
  let _lastPayload  = null;   // most recent count:update payload
  let _analyticsData = null;  // most recent analytics API response
  let _govHours     = 24;
  let _govFrom      = null;   // ISO date string or null
  let _govTo        = null;   // ISO date string or null
  let _govGranularity = "hour"; // "hour" | "day" | "week"
  let _chartJsReady = false;
  let _trendChart   = null;
  let _donutChart   = null;
  let _clsChart     = null;
  let _peakChart    = null;
  let _queueChart   = null;
  let _speedChart   = null;
  let _crossingsInterval = null;
  let _activeTab    = "live";
  let _dbKpisLoaded = false;  // true once analytics data has updated KPI cards from DB

  // ── Analytics loading progress ────────────────────────────────────────────
  function _setProgress(pct, label) {
    const wrap = el("gov-an-progress");
    const bar  = el("gov-an-progress-bar");
    const pctEl = el("gov-an-progress-pct");
    const lblEl = el("gov-an-progress-label");
    if (!wrap) return;
    if (pct >= 100) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    if (bar)   bar.style.width      = pct + "%";
    if (pctEl) pctEl.textContent    = pct + "%";
    if (lblEl) lblEl.textContent    = label || "Loading…";
  }

  // Chart color map
  const CLS_COLOR = { car:"#29B6F6", truck:"#FF7043", bus:"#AB47BC", motorcycle:"#FFD600" };
  const CLS_CSS   = { car:"gov-td-car", truck:"gov-td-truck", bus:"gov-td-bus", motorcycle:"gov-td-moto" };
  const CLS_SVG = {
    car:        '<svg class="gov-veh-svg" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Car"><path d="M1 10V8a1 1 0 0 1 1-1h20a1 1 0 0 1 1 1v2H1z"/><path d="M5 7V6c0-1 1.5-3 3.5-3h7c2 0 3.5 2 3.5 3v1"/><circle cx="5.5" cy="13" r="1.8"/><circle cx="18.5" cy="13" r="1.8"/></svg>',
    truck:      '<svg class="gov-veh-svg" viewBox="0 0 28 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Truck"><rect x="1" y="3" width="14" height="9" rx="1"/><path d="M15 6h7l2 4v3H15V6z"/><line x1="19" y1="6" x2="19" y2="13"/><circle cx="5" cy="14" r="1.8"/><circle cx="11" cy="14" r="1.8"/><circle cx="21.5" cy="14" r="1.8"/></svg>',
    bus:        '<svg class="gov-veh-svg" viewBox="0 0 28 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Bus"><rect x="1" y="2" width="26" height="11" rx="2"/><line x1="1" y1="6" x2="27" y2="6"/><line x1="14" y1="2" x2="14" y2="13"/><circle cx="6" cy="14.5" r="1.5"/><circle cx="22" cy="14.5" r="1.5"/><rect x="3" y="3" width="4" height="2.5" rx="0.5"/><rect x="9" y="3" width="4" height="2.5" rx="0.5"/><rect x="15" y="3" width="4" height="2.5" rx="0.5"/><rect x="21" y="3" width="4" height="2.5" rx="0.5"/></svg>',
    motorcycle: '<svg class="gov-veh-svg" viewBox="0 0 28 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Motorcycle"><circle cx="6" cy="12" r="3.5"/><circle cx="22" cy="12" r="3.5"/><path d="M9.5 12H16l3-6h3"/><path d="M13 6l2 6"/><path d="M19 4h4l1 2"/></svg>',
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const el  = (id) => document.getElementById(id);
  const txt = (id, val) => { const e = el(id); if (e) e.textContent = String(val ?? "—"); };

  // ── Listen for live count updates ────────────────────────────────────────
  window.addEventListener("count:update", (e) => {
    _lastPayload = e.detail || {};
    if (_open) _populateLive(_lastPayload);
  });

  // ── Tab switching ────────────────────────────────────────────────────────
  document.getElementById("gov-tabbar")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".gov-tab");
    if (!tab) return;
    const name = tab.dataset.tab;
    _setTab(name);
  });

  // ── Move only the video element into a slot (canvases never leave stream-wrapper) ──
  function _moveVideoGroup(slotId) {
    const slot  = el(slotId);
    const video = el("live-video");
    if (slot && video && !slot.contains(video)) {
      slot.appendChild(video);
      window.dispatchEvent(new Event("resize"));
    }
  }

  // Update only DOM classes (no video/canvas movement)
  function _setTabDom(name) {
    document.querySelectorAll(".gov-tab").forEach(t =>
      t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".gov-panel").forEach(p =>
      p.classList.toggle("active", p.id === `gov-panel-${name}`));
  }

  function _setTab(name) {
    _activeTab = name;
    _setTabDom(name);
    if (!_open) return;
    if (name === "analytics") {
      _moveVideoGroup("gov-an-video-slot");
      _startZoneCanvas();
      if (window.Chart && !_trendChart) _initAllCharts(_govHours);
      if (_govHours) _loadGovCrossings();
    } else {
      _stopZoneCanvas();
      _moveVideoGroup("gov-video-slot");
      if (name === "live") _startZoneCanvas(); // zones on live tab too
    }
    if (name === "agencies" && _analyticsData) _populateAgencyMetrics(_analyticsData.summary);
  }

  // ── Analytics zone canvas (draws admin zones on video in analytics slot) ──
  let _govAnZoneRaf = null;

  function _hexToRgba(hex, a) {
    const r = String(hex || "").replace("#", "").padEnd(6, "0").slice(0, 6);
    const n = parseInt(r, 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${Math.max(0,Math.min(1,a))})`;
  }

  const _ZONE_COLORS = {
    entry:"#4CAF50", exit:"#F44336", queue:"#FF9800",
    roi:"#AB47BC", speed_a:"#00BCD4", speed_b:"#009688",
  };

  // Returns a correctly-sized 2d context for canvas — always tied to the
  // passed canvas element, never a stale reference from another canvas.
  function _syncZoneCanvas(canvas, video) {
    const dpr = window.devicePixelRatio || 1;
    const w = video.clientWidth, h = video.clientHeight;
    if (!w || !h) return null;
    const nw = Math.round(w * dpr), nh = Math.round(h * dpr);
    if (canvas.width !== nw || canvas.height !== nh) {
      canvas.width  = nw;  canvas.height  = nh;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function _drawGovZones() {
    const canvasId = _activeTab === "analytics" ? "gov-an-zone-canvas" : "gov-live-zone-canvas";
    const canvas = el(canvasId);
    const video  = el("live-video");
    if (!canvas || !video || !window.getContentBounds) return;
    const ctx = _syncZoneCanvas(canvas, video);
    if (!ctx) return;
    const bounds = window.getContentBounds(video);
    ctx.clearRect(0, 0, video.clientWidth, video.clientHeight);

    const zones = window.DetectionOverlay?.getZones?.() || [];
    if (!zones.length) return;

    ctx.save();
    const now = Date.now();
    for (const zone of zones) {
      const pts = zone.points || [];
      if (pts.length < 3) continue;
      const px  = pts.map(p => window.contentToPixel(p.x, p.y, bounds));
      const col = zone.color || _ZONE_COLORS[zone.zone_type] || "#64748b";

      // Dashed polygon fill
      ctx.beginPath();
      ctx.moveTo(px[0].x, px[0].y);
      for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
      ctx.closePath();
      ctx.fillStyle   = _hexToRgba(col, 0.10);
      ctx.fill();

      // Animated dash offset for a "scanning" effect
      const dashOffset = ((now / 40) % 18);
      ctx.strokeStyle = _hexToRgba(col, 0.85);
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -dashOffset;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // Corner dots on each vertex
      ctx.fillStyle = _hexToRgba(col, 0.90);
      for (const p of px) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      }

      // Centroid label badge
      const cx = px.reduce((s, p) => s + p.x, 0) / px.length;
      const cy = px.reduce((s, p) => s + p.y, 0) / px.length;
      const label = (zone.name || zone.zone_type || "zone").toUpperCase();
      ctx.font = "700 9px 'JetBrains Mono',monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.beginPath();
      ctx.roundRect?.(cx - tw/2 - 5, cy - 8, tw + 10, 16, 3) || ctx.rect(cx - tw/2 - 5, cy - 8, tw + 10, 16);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.fillText(label, cx, cy);
    }
    ctx.restore();
  }

  function _zoneRafLoop() {
    _drawGovZones();
    _govAnZoneRaf = requestAnimationFrame(_zoneRafLoop);
  }

  function _startZoneCanvas() {
    if (_govAnZoneRaf) return; // already running
    _govAnZoneRaf = requestAnimationFrame(_zoneRafLoop);
  }

  function _stopZoneCanvas() {
    if (_govAnZoneRaf) { cancelAnimationFrame(_govAnZoneRaf); _govAnZoneRaf = null; }
    ["gov-an-zone-canvas", "gov-live-zone-canvas"].forEach(id => {
      const c = el(id);
      if (c) { const ctx = c.getContext("2d"); ctx?.clearRect(0, 0, c.width, c.height); }
    });
  }


  // ── Preloader helpers ─────────────────────────────────────────────────────
  const _pl = {
    el:    () => document.getElementById("gov-preloader"),
    pct:   () => document.getElementById("gov-pl-pct"),
    bar:   () => document.getElementById("gov-pl-bar"),
    label: () => document.getElementById("gov-pl-label"),
    show() {
      const e = this.el(); if (!e) return;
      e.classList.remove("hidden", "fading");
      document.body.style.overflow = "hidden";
    },
    set(pct, label) {
      const p = pct + "%";
      const pe = this.pct(); if (pe) pe.textContent = p;
      const be = this.bar(); if (be) be.style.width  = p;
      const le = this.label(); if (le && label) le.textContent = label;
    },
    hide() {
      const e = this.el(); if (!e) return;
      e.classList.add("fading");
      setTimeout(() => e.classList.add("hidden"), 380);
    },
  };

  // ── Analytics preload + open ──────────────────────────────────────────────
  async function openGovAnalytics() {
    if (_open) { _setTab("analytics"); return; }

    _pl.show();
    _pl.set(0, "Initialising…");

    // Step 1 — force-reload zones (user drew them in admin)
    _pl.set(10, "Loading zone data…");
    try { await window.DetectionOverlay.forceReloadZones(); } catch {}
    _pl.set(35, "Zone data ready");

    // Step 2 — load Chart.js
    _pl.set(40, "Loading chart engine…");
    await new Promise(resolve => _loadChartJs(resolve));
    _pl.set(65, "Chart engine ready");

    // Step 3 — pre-fetch analytics data + camera id
    _pl.set(70, "Fetching analytics data…");
    if (!_camId && window.sb) {
      try {
        const { data } = await window.sb.from("cameras")
          .select("id,ipcam_alias,name").eq("is_active", true).limit(1).single();
        _camId   = data?.id;
        _camName = data?.name || data?.ipcam_alias || "Camera 1";
      } catch {}
    }
    try { await _prefetchAnalytics(); } catch {}
    _pl.set(95, "Almost ready…");

    await new Promise(r => setTimeout(r, 250)); // let final bar animation play
    _pl.set(100, "Opening analytics…");
    await new Promise(r => setTimeout(r, 180));

    _pl.hide();
    _activeTab = "analytics"; // open directly on analytics tab
    openGov();
  }

  // Pre-fetches analytics data into _analyticsData before the overlay opens
  async function _prefetchAnalytics() {
    if (_analyticsData) return; // already loaded
    const url = `/api/analytics/traffic?hours=${_govHours}&granularity=${_govGranularity}${_camId ? `&camera_id=${_camId}` : ""}`;
    try {
      const res  = await fetch(url);
      const json = res.ok ? await res.json() : null;
      if (json) _analyticsData = json;
    } catch {}
  }

  // ── Open / Close ─────────────────────────────────────────────────────────
  openBtn?.addEventListener("click", openGovAnalytics);
  closeBtn?.addEventListener("click", closeGov);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _open) closeGov(); });

  function _setKpiLoading(on) {
    document.querySelector(".gov-kpi-strip")?.classList.toggle("is-loading", on);
  }

  async function openGov() {
    if (_open) return;
    _open = true;
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // Show loading bar until first live data arrives
    if (!_lastPayload) _setKpiLoading(true);

    // Resolve camera (may already be resolved by preloader)
    if (!_camId && window.sb) {
      try {
        const { data } = await window.sb.from("cameras")
          .select("id, ipcam_alias, name").eq("is_active", true).limit(1).single();
        _camId   = data?.id;
        _camName = data?.name || data?.ipcam_alias || "Camera 1";
      } catch {}
    }
    txt("gov-cam-subtitle", `Live Feed · ${_camName}`);
    txt("gov-cam-name", _camName);
    txt("gov-vid-cam", _camName);

    // Activate correct tab in DOM and route video/canvases
    _setTabDom(_activeTab);
    if (_activeTab === "analytics") {
      _moveVideoGroup("gov-an-video-slot");
      _startZoneCanvas();
      // Charts already loaded by preloader — just start crossings + zone analytics
      if (window.Chart && _analyticsData) {
        _initDonut();
        _buildTrendChart(_analyticsData.rows || []);
        _buildClsChart(_analyticsData.summary || {});
        _populateAgencyMetrics(_analyticsData.summary || {});
        _dbKpisLoaded = true;
        const rows = _analyticsData.rows || [];
        const summary = _analyticsData.summary || {};
        const totalPeriod = summary.period_total ?? rows.reduce((a, r) => a + (r.total || 0), 0);
        const totalIn  = rows.reduce((a, r) => a + (r.in  || 0), 0);
        const totalOut = rows.reduce((a, r) => a + (r.out || 0), 0);
        txt("gov-kpi-total", Number(totalPeriod).toLocaleString());
        if (totalIn  > 0) txt("gov-kpi-in",    totalIn.toLocaleString());
        if (totalOut > 0) txt("gov-kpi-out",   totalOut.toLocaleString());
        if (totalIn  > 0) txt("gov-inbound",   totalIn.toLocaleString());
        if (totalOut > 0) txt("gov-outbound",  totalOut.toLocaleString());
        _loadZoneAnalytics();
      } else {
        // Fallback: run full chart init
        _loadChartJs(() => { _initDonut(); _initAllCharts(_govHours); });
      }
    } else {
      _moveVideoGroup("gov-video-slot");
      _startZoneCanvas(); // draw admin zones over live feed
      // Populate live stats from last known payload
      if (_lastPayload) _populateLive(_lastPayload);
      _loadChartJs(() => { _initDonut(); _initAllCharts(_govHours); });
    }

    // Start crossings refresh
    _loadGovCrossings();
    _crossingsInterval = setInterval(_loadGovCrossings, 10000);

    // Set today's date defaults in export form
    const today = new Date().toISOString().slice(0, 10);
    const fromEl = el("gov-exp-from");
    const toEl   = el("gov-exp-to");
    if (fromEl && !fromEl.value) fromEl.value = today;
    if (toEl   && !toEl.value)   toEl.value   = today;
  }

  function closeGov() {
    if (!_open) return;
    _open = false;
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
    clearInterval(_crossingsInterval);
    _crossingsInterval = null;
    _stopZoneCanvas();

    // Return video to stream-wrapper (canvases never leave stream-wrapper)
    const wrapper = document.querySelector(".stream-wrapper");
    const video   = el("live-video");
    if (wrapper && video && !wrapper.contains(video)) {
      wrapper.insertBefore(video, wrapper.firstChild);
      window.dispatchEvent(new Event("resize"));
    }
  }

  // ── Live stats population ─────────────────────────────────────────────────
  function _populateLive(p) {
    _setKpiLoading(false);
    const bd    = p.per_class_total || p.vehicle_breakdown || {};
    const total = p.total ?? p.confirmed_crossings_total ?? 0;
    const fps   = p.fps != null ? Number(p.fps).toFixed(1) : null;

    // Header strip
    txt("gov-hdr-total", total.toLocaleString());
    txt("gov-hdr-fps",   fps ?? "—");
    txt("gov-hdr-load",  p.traffic_load || "—");

    // KPI cards — only from WS when DB analytics haven't loaded yet
    // (once _dbKpisLoaded, analytics API values take priority over session counter)
    if (!_dbKpisLoaded) {
      txt("gov-kpi-total", total.toLocaleString());
      txt("gov-kpi-in",  p.count_in  != null ? Number(p.count_in).toLocaleString()  : "—");
      txt("gov-kpi-out", p.count_out != null ? Number(p.count_out).toLocaleString() : "—");
    }
    // gov-kpi-peak is filled from analytics data

    // Flow sidebar
    txt("gov-inbound",  p.count_in  != null ? Number(p.count_in).toLocaleString()  : "—");
    txt("gov-outbound", p.count_out != null ? Number(p.count_out).toLocaleString() : "—");

    // Scene
    const scene = [p.scene_lighting, p.scene_weather].filter(Boolean).join(" / ") || p.scene_lighting || "—";
    txt("gov-scene", scene.toUpperCase());

    // Class breakdown with progress bars
    const classes  = ["car","truck","bus","motorcycle"];
    const barIds   = { car:"gov-bar-car", truck:"gov-bar-truck", bus:"gov-bar-bus", motorcycle:"gov-bar-moto" };
    const valIds   = { car:"gov-cars", truck:"gov-trucks", bus:"gov-buses", motorcycle:"gov-motos" };
    const pctIds   = { car:"gov-pct-car", truck:"gov-pct-truck", bus:"gov-pct-bus", motorcycle:"gov-pct-moto" };
    const counts   = classes.map(c => Number(bd[c] || 0));
    const maxCount = Math.max(...counts, 1);

    classes.forEach((cls, i) => {
      const cnt = counts[i];
      const pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
      txt(valIds[cls], cnt.toLocaleString());
      txt(pctIds[cls], `${pct}%`);
      const bar = el(barIds[cls]);
      if (bar) bar.style.width = `${Math.round((cnt / maxCount) * 100)}%`;
    });

    // System info
    txt("gov-model", fps ? `YOLOv8 · ${fps} fps` : "YOLOv8");
    txt("gov-last",  p.snapshot_at ? new Date(p.snapshot_at).toLocaleTimeString() : "—");

    // Live donut update
    if (_donutChart) {
      _donutChart.data.datasets[0].data = counts;
      _donutChart.update("none");
    }

    // Agency metrics (computed from live data)
    _populateAgencyMetricsLive(bd, total);
  }

  function _populateAgencyMetricsLive(bd, total) {
    const heavy   = (Number(bd.truck || 0) + Number(bd.bus || 0));
    const busCount = Number(bd.bus || 0);
    txt("gov-nwa-metric",     heavy.toLocaleString());
    txt("gov-taj-metric",     heavy.toLocaleString());
    txt("gov-jutc-metric",    busCount.toLocaleString());
    txt("gov-tourism-metric", total.toLocaleString());
    txt("gov-ooh-metric",     total.toLocaleString());
    // Insurance risk: rough density score (heavy vehicles weighted)
    const risk = total > 0 ? Math.min(100, Math.round((heavy / total) * 60 + (total / 500) * 40)) : 0;
    txt("gov-ins-metric", risk);
  }

  // ── Chart.js lazy load ────────────────────────────────────────────────────
  function _loadChartJs(cb) {
    if (window.Chart) { cb(); return; }
    if (_chartJsReady) { cb(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    s.onload = () => { _chartJsReady = true; cb(); };
    document.head.appendChild(s);
  }

  const CHART_DARK = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
    scales: {
      x: { grid: { color: "rgba(26,45,66,0.8)" }, ticks: { color: "#7A9BB5", font: { size: 9, family: "JetBrains Mono" } } },
      y: { grid: { color: "rgba(26,45,66,0.8)" }, ticks: { color: "#7A9BB5", font: { size: 9, family: "JetBrains Mono" } }, beginAtZero: true },
    },
  };

  // ── Mini donut (LIVE sidebar) ─────────────────────────────────────────────
  function _initDonut() {
    const canvas = el("gov-donut-canvas");
    if (!canvas || !window.Chart) return;
    if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
    _donutChart = new window.Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["Cars","Trucks","Buses","Motorcycles"],
        datasets: [{ data: [1,1,1,1], backgroundColor: ["#29B6F6","#FF7043","#AB47BC","#FFD600"], borderColor: "#080C14", borderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%", animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed}` } } },
      },
    });
  }

  // ── Analytics loading skeleton helpers ───────────────────────────────────
  function _skelBars(count) {
    const heights = [60,80,45,90,55,70,40,85,65,75,50,88].slice(0, count);
    return `<div class="gov-chart-skel-bars">${heights.map(h => `<span style="height:${h}%"></span>`).join("")}</div>`;
  }

  function _setAnalyticsLoading(on) {
    // Summary strip — add/remove class that CSS uses to render shimmer placeholders
    const strip = document.querySelector(".gov-an-toolbar-strip");
    if (strip) strip.classList.toggle("is-loading", on);

    // Chart cards — show/hide loading overlay + skeleton bars placeholder
    document.querySelectorAll(".gov-chart-card").forEach(card => {
      card.classList.toggle("is-loading", on);
      const body = card.querySelector(".gov-chart-body");
      if (!body) return;
      const skelId = "gov-skel-" + (card.id || Math.random());
      if (on) {
        if (!body.querySelector(".gov-chart-skel-bars")) {
          const d = document.createElement("div");
          d.className = "gov-chart-skel-bars"; d.id = skelId;
          d.innerHTML = [60,80,45,90,55,70,40,85,65,75,50,88].map(h => `<span style="height:${h}%"></span>`).join("");
          body.appendChild(d);
        }
      } else {
        body.querySelectorAll(".gov-chart-skel-bars").forEach(el => el.remove());
      }
    });
  }

  function _turningsSkeleton() {
    const rows = Array.from({length:5}, (_,i) => {
      const w1 = 60 + i * 10, w2 = 40 + (i % 3) * 15;
      return `<div class="gov-tur-skel-row">
        <div class="gov-tur-skel-label" style="width:${w1}px"></div>
        <div class="gov-tur-skel-bar" style="max-width:${w2}%"></div>
      </div>`;
    }).join("");
    return `<div class="gov-turnings-skel">${rows}</div>`;
  }

  function _crossingsSkeleton(count) {
    const widths = [[55,48,24,32,60,28],[60,52,28,36,55,30],[50,44,22,30,65,24]];
    return Array.from({length: count || 6}, (_, i) => {
      const w = widths[i % widths.length];
      return `<tr class="gov-xing-skel-row">
        ${w.map(pw => `<td><div class="gov-xing-skel-cell" style="width:${pw}px"></div></td>`).join("")}
      </tr>`;
    }).join("");
  }

  // ── Analytics charts (ANALYTICS panel) ───────────────────────────────────
  async function _initAllCharts(hours) {
    if (!window.Chart) return;
    _setAnalyticsLoading(true);
    _setProgress(30, "Fetching traffic data…");

    // Build URL — use date range if set, else fall back to hours
    let url;
    if (_govFrom || _govTo) {
      url = `/api/analytics/traffic?granularity=${_govGranularity}${_govFrom?`&from=${_govFrom}`:""}${_govTo?`&to=${_govTo}`:""}${_camId?`&camera_id=${_camId}`:""}`;
    } else {
      url = `/api/analytics/traffic?hours=${hours || _govHours}&granularity=${_govGranularity}${_camId?`&camera_id=${_camId}`:""}`;
    }
    try {
      const res  = await fetch(url);
      const json = res.ok ? await res.json() : null;
      if (!json) { _setAnalyticsLoading(false); _setProgress(100); return; }
      _analyticsData = json;
      const rows    = json.rows || [];
      const summary = json.summary || {};

      // ── Update KPI cards with DB-backed data ──────────────────────────────
      const totalPeriod = summary.period_total ?? rows.reduce((a, r) => a + (r.total || 0), 0);
      const totalIn  = rows.reduce((a, r) => a + (r.in  || 0), 0);
      const totalOut = rows.reduce((a, r) => a + (r.out || 0), 0);
      txt("gov-kpi-total", Number(totalPeriod).toLocaleString());
      if (totalIn  > 0) txt("gov-kpi-in",  totalIn.toLocaleString());
      if (totalOut > 0) txt("gov-kpi-out", totalOut.toLocaleString());
      if (totalIn  > 0) txt("gov-inbound",  totalIn.toLocaleString());
      if (totalOut > 0) txt("gov-outbound", totalOut.toLocaleString());
      _dbKpisLoaded = true;  // stop WS from overwriting with session counter

      // ── Update class breakdown bars from DB class totals ──────────────────
      const ct = summary.class_totals || {};
      const grandTotal = Object.values(ct).reduce((a, b) => a + b, 0) || 1;
      const barIds = { car:"gov-bar-car", truck:"gov-bar-truck", bus:"gov-bar-bus", motorcycle:"gov-bar-moto" };
      const valIds = { car:"gov-cars", truck:"gov-trucks", bus:"gov-buses", motorcycle:"gov-motos" };
      const pctIds = { car:"gov-pct-car", truck:"gov-pct-truck", bus:"gov-pct-bus", motorcycle:"gov-pct-moto" };
      for (const cls of ["car","truck","bus","motorcycle"]) {
        const count = ct[cls] || 0;
        const pct   = Math.round((count / grandTotal) * 100);
        const barEl = el(barIds[cls]);
        if (barEl) barEl.style.width = pct + "%";
        txt(valIds[cls], count.toLocaleString());
        txt(pctIds[cls], pct + "%");
      }

      // ── Summary strip ─────────────────────────────────────────────────────
      const peakLabel   = _formatPeriodLabel(summary.peak_period, _govGranularity);
      const peakVal     = summary.peak_value || 0;
      const heavyPct    = summary.class_pct
        ? Math.round(((summary.class_pct.truck||0) + (summary.class_pct.bus||0))) + "%"
        : "—";
      const granLabel = _govGranularity === "week" ? "weekly" : _govGranularity === "day" ? "daily" : "hourly";
      txt("gov-sum-total",  Number(totalPeriod).toLocaleString());
      txt("gov-sum-peak",   `${peakLabel} (${peakVal})`);
      txt("gov-sum-heavy",  heavyPct);
      txt("gov-sum-queue",  summary.avg_queue_depth != null ? summary.avg_queue_depth.toFixed(1) : "—");
      txt("gov-sum-speed",  summary.avg_speed_kmh   != null ? `${summary.avg_speed_kmh} km/h` : "—");
      txt("gov-kpi-peak",   peakLabel);
      txt("gov-trend-label", `— ${granLabel} view`);

      // Global lifetime total
      const g = summary.global;
      if (g) txt("gov-sum-global", Number(g.total||0).toLocaleString() + " total");

      _populateAgencyMetrics(summary);
      _setProgress(60, "Rendering charts…");
      _buildTrendChart(rows);
      _buildClsChart(summary);
      _buildPeakChart(rows);
      _setAnalyticsLoading(false);

      // Zone analytics (queue + turnings + speed) — progress continues inside
      _setProgress(80, "Loading zone analytics…");
      _loadZoneAnalytics();

    } catch (err) {
      console.warn("[GovAnalytics] Chart load failed:", err);
      _setAnalyticsLoading(false);
      _setProgress(100);
    }
  }

  function _formatPeriodLabel(period, gran) {
    if (!period) return "—";
    if (gran === "day" || gran === "week") return period.slice(0, 10);
    const d = new Date(period);
    if (isNaN(d)) return period;
    return `${String(d.getHours()).padStart(2,"0")}:00`;
  }

  function _buildTrendChart(rows) {
    const canvas = el("gov-trend-canvas");
    if (!canvas) return;
    if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
    const labels = rows.map(r => _formatPeriodLabel(r.period || r.hour, _govGranularity));
    const mk = (f) => rows.map(r => r[f] || 0);
    _trendChart = new window.Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label:"Cars",        data: mk("car"),        borderColor:"#29B6F6", backgroundColor:"rgba(41,182,246,0.05)",  tension:0.4, pointRadius:0, borderWidth:1.5 },
          { label:"Trucks",      data: mk("truck"),      borderColor:"#FF7043", backgroundColor:"rgba(255,112,67,0.05)",  tension:0.4, pointRadius:0, borderWidth:1.5 },
          { label:"Buses",       data: mk("bus"),        borderColor:"#AB47BC", backgroundColor:"rgba(171,71,188,0.05)",  tension:0.4, pointRadius:0, borderWidth:1.5 },
          { label:"Motorcycles", data: mk("motorcycle"), borderColor:"#FFD600", backgroundColor:"rgba(255,214,0,0.05)",   tension:0.4, pointRadius:0, borderWidth:1.5 },
        ],
      },
      options: { ...CHART_DARK, plugins: { ...CHART_DARK.plugins, legend: { display: true, labels: { color:"#7A9BB5", font:{ size:9, family:"JetBrains Mono" }, boxWidth:10, padding:12 } } } },
    });
  }

  function _buildClsChart(summary) {
    const canvas = el("gov-cls-canvas");
    if (!canvas) return;
    if (_clsChart) { _clsChart.destroy(); _clsChart = null; }
    const ct = summary.class_totals || {};
    _clsChart = new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Cars","Trucks","Buses","Motorcycles"],
        datasets: [{ data: [ct.car||0, ct.truck||0, ct.bus||0, ct.motorcycle||0], backgroundColor: ["#29B6F6","#FF7043","#AB47BC","#FFD600"], borderRadius: 3, borderWidth: 0 }],
      },
      options: { ...CHART_DARK, plugins: { legend: { display:false }, tooltip: { mode:"index", intersect:false } } },
    });
  }

  function _buildPeakChart(rows) {
    const canvas = el("gov-peak-canvas");
    if (!canvas) return;
    if (_peakChart) { _peakChart.destroy(); _peakChart = null; }
    const labels = rows.map(r => _formatPeriodLabel(r.period || r.hour, _govGranularity));
    const totals = rows.map(r => r.total || 0);
    const maxVal = Math.max(...totals, 1);
    const colors = totals.map(v => v >= maxVal * 0.8 ? "#FF7043" : v >= maxVal * 0.5 ? "#FFD600" : "#29B6F6");
    _peakChart = new window.Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ data: totals, backgroundColor: colors, borderRadius: 2, borderWidth: 0 }] },
      options: { ...CHART_DARK, plugins: { legend: { display:false }, tooltip: { mode:"index", intersect:false } } },
    });
  }

  // ── Zone analytics (queue depth + turning movements + speed) ──────────────
  async function _loadZoneAnalytics() {
    if (!_camId) return;
    // Show turnings skeleton while loading
    const tBody = el("gov-turnings-body");
    if (tBody) tBody.innerHTML = _turningsSkeleton();

    // Load zone list + turnings in parallel
    const fromParam = _govFrom || new Date(Date.now() - _govHours * 3600 * 1000).toISOString();
    const toParam   = _govTo   || new Date().toISOString();

    const [zonesRes, turningsRes] = await Promise.allSettled([
      fetch(`/api/analytics/data?type=zones&camera_id=${_camId}`),
      fetch(`/api/analytics/data?type=turnings&camera_id=${_camId}&from=${fromParam}&to=${toParam}`),
    ]);

    // Render active zones bar
    if (zonesRes.status === "fulfilled" && zonesRes.value.ok) {
      const zones = await zonesRes.value.json();
      _renderZonesBar(zones);
    }

    // Render turnings / queue / speed
    try {
      if (turningsRes.status !== "fulfilled" || !turningsRes.value.ok) throw new Error("turnings fetch failed");
      const data = await turningsRes.value.json();
      _buildQueueChart(data.queue_series || []);
      _buildSpeedChart(data);
      _renderTurningMovements(data);
    } catch (err) {
      console.warn("[GovAnalytics] Zone analytics failed:", err);
      if (tBody) tBody.innerHTML = `<p class="gov-turnings-empty">Failed to load zone analytics.</p>`;
    }
    _setProgress(100);
  }

  const _ZONE_TYPE_META = {
    entry:   { label: "Entry",    color: "#4CAF50" },
    exit:    { label: "Exit",     color: "#F44336" },
    queue:   { label: "Queue",    color: "#FF9800" },
    roi:     { label: "ROI",      color: "#AB47BC" },
    speed_a: { label: "Speed A",  color: "#00BCD4" },
    speed_b: { label: "Speed B",  color: "#009688" },
  };

  function _renderZonesBar(zones) {
    const chips = el("gov-zones-chips");
    if (!chips) return;
    if (!zones || !zones.length) {
      chips.innerHTML = `<span class="gov-zone-chip gov-zone-chip-loading">No active zones</span>`;
      return;
    }
    // Group by zone_type
    const groups = {};
    for (const z of zones) {
      const t = z.zone_type || "roi";
      groups[t] = (groups[t] || 0) + 1;
    }
    const order = ["entry", "exit", "queue", "roi", "speed_a", "speed_b"];
    chips.innerHTML = order
      .filter(t => groups[t])
      .map(t => {
        const meta  = _ZONE_TYPE_META[t] || { label: t, color: "#64748b" };
        const count = groups[t];
        const bg    = meta.color + "18";
        return `<span class="gov-zone-chip" style="background:${bg};border-color:${meta.color}60;color:${meta.color}">
          <span class="gov-zone-chip-dot" style="background:${meta.color}"></span>
          ${meta.label} ×${count}
        </span>`;
      }).join("") +
      `<span class="gov-zone-chip" style="background:rgba(122,155,181,0.06);border-color:rgba(122,155,181,0.2);color:#7A9BB5">
        Total ${zones.length}
      </span>`;
  }

  function _buildQueueChart(series) {
    const canvas = el("gov-queue-canvas");
    if (!canvas || !window.Chart) return;
    if (_queueChart) { _queueChart.destroy(); _queueChart = null; }
    if (!series.length) return;
    const labels = series.map(r => new Date(r.ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }));
    const data   = series.map(r => r.depth || 0);
    _queueChart = new window.Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Queue Depth",
          data,
          borderColor: "#FF9800",
          backgroundColor: "rgba(255,152,0,0.08)",
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.5,
          fill: true,
        }],
      },
      options: {
        ...CHART_DARK,
        plugins: { legend: { display: false }, tooltip: { mode:"index", intersect:false, callbacks: { label: (c) => ` ${c.parsed.y} vehicles` } } },
      },
    });
  }

  function _buildSpeedChart(data) {
    const canvas = el("gov-speed-canvas");
    if (!canvas || !window.Chart) return;
    if (_speedChart) { _speedChart.destroy(); _speedChart = null; }
    const sp = data.speed;
    if (!sp || !sp.samples) {
      if (_speedChart) { _speedChart.destroy(); _speedChart = null; }
      return;
    }
    // Create simple bar showing avg, p85, max
    _speedChart = new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Average", "85th Pct", "Max"],
        datasets: [{
          data: [sp.avg_kmh, sp.p85_kmh, sp.max_kmh],
          backgroundColor: ["#29B6F6","#FFD600","#FF7043"],
          borderRadius: 3,
          borderWidth: 0,
        }],
      },
      options: {
        ...CHART_DARK,
        plugins: { legend: { display:false }, tooltip: { mode:"index", intersect:false, callbacks: { label: (c) => ` ${c.parsed.y} km/h` } } },
      },
    });
  }

  function _renderTurningMovements(data) {
    const body = el("gov-turnings-body");
    if (!body) return;
    const top = data.top_movements || [];
    if (!top.length) {
      body.innerHTML = `<p class="gov-turnings-empty">No turning movement data for this period. Ensure entry and exit zones are defined in Admin → Analytics Zones.</p>`;
      return;
    }
    const maxTotal = Math.max(...top.map(m => m.total), 1);
    const qs = data.queue_summary || {};
    const sp = data.speed || {};
    body.innerHTML = `
      <div class="gov-turnings-summary">
        <div class="gov-tur-kpi"><div class="gov-tur-kpi-val">${data.period?.total_movements?.toLocaleString() || "—"}</div><div class="gov-tur-kpi-lbl">Total Movements</div></div>
        <div class="gov-tur-kpi"><div class="gov-tur-kpi-val">${qs.avg?.toFixed?.(1) || "—"}</div><div class="gov-tur-kpi-lbl">Avg Queue Depth</div></div>
        <div class="gov-tur-kpi"><div class="gov-tur-kpi-val">${qs.peak || "—"}</div><div class="gov-tur-kpi-lbl">Peak Queue</div></div>
        ${sp ? `<div class="gov-tur-kpi"><div class="gov-tur-kpi-val">${sp.avg_kmh || "—"}</div><div class="gov-tur-kpi-lbl">Avg Speed km/h</div></div>` : ""}
      </div>
      <div class="gov-turnings-list">
        ${top.map(m => {
          const pct = Math.round((m.total / maxTotal) * 100);
          const dominant = ["car","truck","bus","motorcycle"].reduce((a,b) => (m[a]||0) > (m[b]||0) ? a : b, "car");
          const color = { car:"#29B6F6", truck:"#FF7043", bus:"#AB47BC", motorcycle:"#FFD600" }[dominant] || "#29B6F6";
          return `<div class="gov-turning-row" data-from="${m.from}" data-to="${m.to}">
            <div class="gov-turning-route"><span class="gov-turning-from">${m.from}</span><span class="gov-turning-arrow">→</span><span class="gov-turning-to">${m.to}</span></div>
            <div class="gov-turning-bar-wrap"><div class="gov-turning-bar" style="width:${pct}%;background:${color}"></div></div>
            <span class="gov-turning-count" style="color:${color}">${m.total.toLocaleString()}</span>
          </div>`;
        }).join("")}
      </div>`;

    // Click turning row → modal with class breakdown
    body.querySelectorAll(".gov-turning-row").forEach(row => {
      row.addEventListener("click", () => {
        const from = row.dataset.from, toZone = row.dataset.to;
        const m = top.find(x => x.from === from && x.to === toZone);
        if (!m) return;
        _showModal(`${from} → ${toZone}`, `
          <div class="gov-modal-kpi-grid">
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${m.total.toLocaleString()}</div><div class="gov-modal-kpi-lbl">Total Vehicles</div></div>
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${m.avg_dwell_ms ? (m.avg_dwell_ms/1000).toFixed(1)+"s" : "—"}</div><div class="gov-modal-kpi-lbl">Avg Dwell Time</div></div>
          </div>
          <div class="gov-modal-data-rows">
            <div class="gov-modal-data-row"><span class="gov-modal-data-key">Cars</span><span class="gov-modal-data-val" style="color:#29B6F6">${m.car||0}</span></div>
            <div class="gov-modal-data-row"><span class="gov-modal-data-key">Trucks</span><span class="gov-modal-data-val" style="color:#FF7043">${m.truck||0}</span></div>
            <div class="gov-modal-data-row"><span class="gov-modal-data-key">Buses</span><span class="gov-modal-data-val" style="color:#AB47BC">${m.bus||0}</span></div>
            <div class="gov-modal-data-row"><span class="gov-modal-data-key">Motorcycles</span><span class="gov-modal-data-val" style="color:#FFD600">${m.motorcycle||0}</span></div>
          </div>`);
      });
    });
  }

  // ── Agency metrics from analytics data ────────────────────────────────────
  function _populateAgencyMetrics(summary) {
    if (!summary) return;
    const ct    = summary.class_totals || {};
    const total = summary.today_total  || 0;
    const heavy = (ct.truck||0) + (ct.bus||0);
    const peakV = summary.peak_value   || 0;
    const risk  = total > 0 ? Math.min(100, Math.round((heavy/total)*60 + (peakV/50)*40)) : 0;

    txt("gov-nwa-metric",     heavy.toLocaleString());
    txt("gov-taj-metric",     heavy.toLocaleString());
    txt("gov-jutc-metric",    (ct.bus||0).toLocaleString());
    txt("gov-tourism-metric", Number(total).toLocaleString());
    txt("gov-ooh-metric",     Number(total).toLocaleString());
    txt("gov-ins-metric",     risk);
  }

  // ── Crossings table ───────────────────────────────────────────────────────
  async function _loadGovCrossings() {
    if (!window.sb) return;
    const tbody = el("gov-crossings-body");
    if (tbody) tbody.innerHTML = _crossingsSkeleton(6);
    try {
      let q = window.sb.from("vehicle_crossings")
        .select("captured_at,vehicle_class,direction,confidence,scene_lighting,scene_weather,dwell_frames")
        .order("captured_at", { ascending: false }).limit(20);
      if (_camId) q = q.eq("camera_id", _camId);
      const { data } = await q;
      if (!tbody || !data?.length) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No crossings recorded yet</td></tr>`;
        return;
      }
      tbody.innerHTML = data.map(r => {
        const cls  = String(r.vehicle_class || "car").toLowerCase();
        const css  = CLS_CSS[cls]  || "gov-td-car";
        const icon = CLS_SVG[cls] || CLS_SVG.car;
        const dirCss = r.direction === "in" ? "gov-td-in" : "gov-td-out";
        const conf = r.confidence != null ? `${(Number(r.confidence)*100).toFixed(0)}%` : "—";
        const scene = [r.scene_lighting, r.scene_weather].filter(Boolean).join(" / ") || "—";
        const time  = r.captured_at ? new Date(r.captured_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "—";
        const dwell = r.dwell_frames != null ? `${r.dwell_frames}f` : "—";
        return `<tr data-crossing='${JSON.stringify({time,cls,dir:r.direction,conf,scene,dwell}).replace(/'/g,"&apos;")}'>
          <td>${time}</td>
          <td class="${css}">${icon} ${cls.toUpperCase()}</td>
          <td class="${dirCss}">${r.direction || "—"}</td>
          <td>${conf}</td>
          <td style="color:var(--muted);font-size:10px">${scene}</td>
          <td style="color:var(--dim);font-size:10px">${dwell}</td>
        </tr>`;
      }).join("");
    } catch (err) {
      console.warn("[GovAnalytics] Crossings failed:", err);
    }
  }

  // ── Date range controls ───────────────────────────────────────────────────
  function _setPreset(preset) {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const fromEl   = el("gov-date-from");
    const toEl     = el("gov-date-to");
    _govTo = null;
    if (toEl) toEl.value = todayStr;
    if (preset === "1d") {
      _govFrom = todayStr;
      if (fromEl) fromEl.value = todayStr;
      _govGranularity = "hour";
    } else if (preset === "7d") {
      const d = new Date(today - 7 * 86400000);
      _govFrom = d.toISOString().slice(0, 10);
      if (fromEl) fromEl.value = _govFrom;
      _govGranularity = "day";
    } else if (preset === "30d") {
      const d = new Date(today - 30 * 86400000);
      _govFrom = d.toISOString().slice(0, 10);
      if (fromEl) fromEl.value = _govFrom;
      _govGranularity = "day";
    } else if (preset === "all") {
      _govFrom = null;
      _govTo   = null;
      if (fromEl) fromEl.value = "";
      if (toEl)   toEl.value   = "";
      _govGranularity = "day";
    }
    // Sync granularity pills
    document.querySelectorAll(".gov-gran-pill").forEach(p => {
      p.classList.toggle("active", p.dataset.gran === _govGranularity);
    });
  }

  // Preset pill clicks
  overlay.addEventListener("click", (e) => {
    const pill = e.target.closest(".gov-period-pills .gov-pill");
    if (pill) {
      document.querySelectorAll(".gov-period-pills .gov-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      _setPreset(pill.dataset.preset || "1d");
      _loadChartJs(() => _initAllCharts(_govHours));
      return;
    }

    const gran = e.target.closest(".gov-gran-pill");
    if (gran) {
      document.querySelectorAll(".gov-gran-pill").forEach(p => p.classList.remove("active"));
      gran.classList.add("active");
      _govGranularity = gran.dataset.gran || "hour";
      _loadChartJs(() => _initAllCharts(_govHours));
      return;
    }
  });

  // Date input changes
  el("gov-date-from")?.addEventListener("change", (e) => {
    _govFrom = e.target.value || null;
    _loadChartJs(() => _initAllCharts(_govHours));
  });
  el("gov-date-to")?.addEventListener("change", (e) => {
    _govTo = e.target.value ? e.target.value + "T23:59:59Z" : null;
    _loadChartJs(() => _initAllCharts(_govHours));
  });

  // ── Export (analytics toolbar quick-export) ───────────────────────────────
  el("gov-export-btn")?.addEventListener("click", _triggerExport);

  // ── Export panel download ─────────────────────────────────────────────────
  el("gov-export-dl-btn")?.addEventListener("click", _triggerExport);

  async function _triggerExport() {
    const fromEl = el("gov-exp-from");
    const toEl   = el("gov-exp-to");
    const today  = new Date().toISOString().slice(0,10);
    const from   = new Date((fromEl?.value || today) + "T00:00:00");
    const to     = new Date((toEl?.value   || today) + "T23:59:59");
    const jwt    = await (window.Auth?.getJwt?.() || Promise.resolve(null));
    if (!jwt) { _showModal("EXPORT", `<p class="gov-modal-pitch">Please log in to export traffic data.</p>`); return; }
    const url = `/api/analytics/export?from=${from.toISOString()}&to=${to.toISOString()}${_camId ? `&camera_id=${_camId}` : ""}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
      if (!res.ok) { _showModal("EXPORT", `<p class="gov-modal-pitch">No data available for the selected date range.</p>`); return; }
      const blob    = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: blobUrl, download: `traffic-${from.toISOString().slice(0,10)}.csv` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch { _showModal("EXPORT", `<p class="gov-modal-pitch">Export failed — please try again.</p>`); }
  }

  // ── Modal system ──────────────────────────────────────────────────────────
  const modal       = el("gov-modal");
  const modalTitle  = el("gov-modal-title");
  const modalBody   = el("gov-modal-body");
  let   _modalChart = null;

  function _showModal(title, bodyHtml) {
    if (!modal) return;
    if (modalTitle) modalTitle.innerHTML = title;
    if (modalBody)  modalBody.innerHTML = bodyHtml;
    modal.classList.remove("hidden");
    // Render chart if canvas#gov-modal-chart exists in bodyHtml
    requestAnimationFrame(() => {
      const c = el("gov-modal-chart");
      if (c && c.dataset.chartConfig && window.Chart) {
        try {
          if (_modalChart) { _modalChart.destroy(); _modalChart = null; }
          _modalChart = new window.Chart(c, JSON.parse(c.dataset.chartConfig));
        } catch {}
      }
    });
  }

  function _closeModal() {
    if (!modal) return;
    modal.classList.add("hidden");
    if (_modalChart) { _modalChart.destroy(); _modalChart = null; }
  }

  el("gov-modal-close")?.addEventListener("click", _closeModal);
  el("gov-modal-backdrop")?.addEventListener("click", _closeModal);

  // ── KPI card clicks ───────────────────────────────────────────────────────
  el("gov-panel-live")?.addEventListener("click", (e) => {
    const card = e.target.closest(".gov-kpi-card");
    if (!card) return;
    const type = card.dataset.modal;
    _openKpiModal(type);
  });

  function _openKpiModal(type) {
    _loadChartJs(() => {
      const rows    = _analyticsData?.rows     || [];
      const summary = _analyticsData?.summary  || {};
      const ct      = summary.class_totals     || {};
      const mkLabel = r => _formatPeriodLabel(r.period || r.hour, _govGranularity);
      const granLbl = _govGranularity === "week" ? "Periods" : _govGranularity === "day" ? "Days" : "Hours";

      if (type === "total") {
        const labels = rows.map(mkLabel);
        const data   = rows.map(r => r.total || 0);
        const cfg    = { type:"bar", data:{ labels, datasets:[{ data, backgroundColor:"#29B6F6", borderRadius:3, borderWidth:0 }] }, options:{ ...CHART_DARK, plugins:{legend:{display:false}} } };
        _showModal("VEHICLES — BREAKDOWN", `
          <div class="gov-modal-kpi-grid">
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${Number(summary.period_total||0).toLocaleString()}</div><div class="gov-modal-kpi-lbl">Total (period)</div></div>
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${summary.peak_value||"—"}</div><div class="gov-modal-kpi-lbl">Peak Count</div></div>
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${rows.length}</div><div class="gov-modal-kpi-lbl">${granLbl} Recorded</div></div>
          </div>
          <div class="gov-modal-chart-wrap"><canvas id="gov-modal-chart" data-chart-config='${JSON.stringify(cfg).replace(/'/g,"&#39;")}'></canvas></div>`);

      } else if (type === "peak") {
        const labels = rows.map(mkLabel);
        const totals = rows.map(r => r.total || 0);
        const maxV   = Math.max(...totals, 1);
        const colors = totals.map(v => v >= maxV * 0.8 ? "#FF7043" : v >= maxV * 0.5 ? "#FFD600" : "rgba(26,45,66,0.8)");
        const cfg    = { type:"bar", data:{ labels, datasets:[{ data:totals, backgroundColor:colors, borderRadius:3, borderWidth:0 }] }, options:{ ...CHART_DARK, plugins:{legend:{display:false}} } };
        const peakLabel = _formatPeriodLabel(summary.peak_period, _govGranularity);
        _showModal("PEAK PERIOD ANALYSIS", `
          <div class="gov-modal-kpi-grid">
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${peakLabel}</div><div class="gov-modal-kpi-lbl">Peak Period</div></div>
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${summary.peak_value||"—"}</div><div class="gov-modal-kpi-lbl">Vehicles at Peak</div></div>
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${totals.filter(v => v >= maxV*0.8).length}</div><div class="gov-modal-kpi-lbl">High-Load Periods</div></div>
          </div>
          <div class="gov-modal-chart-wrap"><canvas id="gov-modal-chart" data-chart-config='${JSON.stringify(cfg).replace(/'/g,"&#39;")}'></canvas></div>
          <p class="gov-modal-note">Red bars = high load (&ge;80% of peak). Yellow bars = moderate load (&ge;50%).</p>`);

      } else if (type === "flow") {
        const labels  = rows.map(mkLabel);
        const inData  = rows.map(r => r.in  || 0);
        const outData = rows.map(r => r.out || 0);
        const cfg     = { type:"line", data:{ labels, datasets:[
          { label:"Inbound",  data:inData,  borderColor:"#00FF88", backgroundColor:"rgba(0,255,136,0.05)", tension:0.4, pointRadius:0, borderWidth:1.5 },
          { label:"Outbound", data:outData, borderColor:"#7A9BB5", backgroundColor:"rgba(122,155,181,0.05)", tension:0.4, pointRadius:0, borderWidth:1.5 },
        ]}, options:{...CHART_DARK, plugins:{...CHART_DARK.plugins, legend:{display:true, labels:{color:"#7A9BB5",font:{size:9,family:"JetBrains Mono"},boxWidth:10}}}} };
        const totalIn  = inData.reduce((a,b)=>a+b,0);
        const totalOut = outData.reduce((a,b)=>a+b,0);
        _showModal("TRAFFIC FLOW ANALYSIS", `
          <div class="gov-modal-kpi-grid">
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val" style="color:var(--green)">${totalIn.toLocaleString()}</div><div class="gov-modal-kpi-lbl">Total Inbound</div></div>
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val" style="color:var(--muted)">${totalOut.toLocaleString()}</div><div class="gov-modal-kpi-lbl">Total Outbound</div></div>
            <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${totalIn+totalOut > 0 ? Math.round(totalIn/(totalIn+totalOut)*100) : "—"}%</div><div class="gov-modal-kpi-lbl">Inbound Ratio</div></div>
          </div>
          <div class="gov-modal-chart-wrap"><canvas id="gov-modal-chart" data-chart-config='${JSON.stringify(cfg).replace(/'/g,"&#39;")}'></canvas></div>`);
      }
    });
  }

  // ── Class row clicks ──────────────────────────────────────────────────────
  el("gov-cls-rows") || document.querySelector(".gov-cls-rows");
  overlay.addEventListener("click", (e) => {
    const row = e.target.closest(".gov-cls-row");
    if (!row) return;
    const cls = row.dataset.modal?.replace("class-","");
    if (!cls) return;
    _loadChartJs(() => _openClassModal(cls));
  });

  function _openClassModal(cls) {
    const rows   = _analyticsData?.rows    || [];
    const summary = _analyticsData?.summary || {};
    const ct     = summary.class_totals     || {};
    const color  = CLS_COLOR[cls] || "#29B6F6";
    const icon   = CLS_SVG[cls]  || CLS_SVG.car;
    const labels = rows.map(r => _formatPeriodLabel(r.period || r.hour, _govGranularity));
    const data   = rows.map(r => r[cls] || 0);
    const total  = ct[cls] || data.reduce((a,b)=>a+b,0);
    const grandT = summary.period_total || 1;
    const pct    = Math.round((total / grandT) * 100);
    const cfg    = { type:"line", data:{ labels, datasets:[{ label:cls, data, borderColor:color, backgroundColor:`${color}0D`, tension:0.4, pointRadius:0, borderWidth:2 }] }, options:{ ...CHART_DARK, plugins:{legend:{display:false}} } };
    _showModal(`${icon} ${cls.toUpperCase()} — TREND DETAIL`, `
      <div class="gov-modal-kpi-grid">
        <div class="gov-modal-kpi"><div class="gov-modal-kpi-val" style="color:${color}">${total.toLocaleString()}</div><div class="gov-modal-kpi-lbl">Total (period)</div></div>
        <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${pct}%</div><div class="gov-modal-kpi-lbl">Share of Traffic</div></div>
        <div class="gov-modal-kpi"><div class="gov-modal-kpi-val">${data.length > 0 ? Math.round(total/Math.max(data.length,1)) : "—"}</div><div class="gov-modal-kpi-lbl">Avg / Hour</div></div>
      </div>
      <div class="gov-modal-chart-wrap"><canvas id="gov-modal-chart" data-chart-config='${JSON.stringify(cfg).replace(/'/g,"&#39;")}'></canvas></div>`);
  }

  // ── Crossing row clicks ───────────────────────────────────────────────────
  el("gov-crossings-body")?.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-crossing]");
    if (!row) return;
    try {
      const d = JSON.parse(row.dataset.crossing.replace(/&apos;/g,"'"));
      const cls = d.cls || "car";
      const color = CLS_COLOR[cls] || "#29B6F6";
      const icon  = CLS_SVG[cls]  || CLS_SVG.car;
      _showModal(`${icon} CROSSING DETAIL`, `
        <div class="gov-modal-data-rows">
          <div class="gov-modal-data-row"><span class="gov-modal-data-key">Time</span><span class="gov-modal-data-val">${d.time}</span></div>
          <div class="gov-modal-data-row"><span class="gov-modal-data-key">Class</span><span class="gov-modal-data-val" style="color:${color}">${icon} ${cls.toUpperCase()}</span></div>
          <div class="gov-modal-data-row"><span class="gov-modal-data-key">Direction</span><span class="gov-modal-data-val">${d.dir}</span></div>
          <div class="gov-modal-data-row"><span class="gov-modal-data-key">Confidence</span><span class="gov-modal-data-val">${d.conf}</span></div>
          <div class="gov-modal-data-row"><span class="gov-modal-data-key">Scene</span><span class="gov-modal-data-val">${d.scene}</span></div>
          <div class="gov-modal-data-row"><span class="gov-modal-data-key">Dwell Frames</span><span class="gov-modal-data-val">${d.dwell}</span></div>
        </div>`);
    } catch {}
  });

  // ── Agency modal ──────────────────────────────────────────────────────────
  overlay.addEventListener("click", (e) => {
    const btn = e.target.closest(".gov-agency-btn[data-modal]");
    if (!btn) return;
    _openAgencyModal(btn.dataset.modal.replace("agency-",""));
  });

  const AGENCY_DATA = {
    nwa: {
      abbr:"NWA", name:"National Works Agency", color:"#29B6F6",
      pitch:"Heavy vehicle volume directly determines road wear rates and maintenance budgeting cycles. Our AI-classified vehicle data provides a real-time heavy vehicle index (trucks + buses) per corridor, enabling evidence-based road maintenance scheduling and budget allocation.",
      metrics: [
        { key:"Data collected", val:"Truck + bus classification per crossing" },
        { key:"Update frequency", val:"Real-time (≤2s latency)" },
        { key:"Potential use", val:"Road wear index · maintenance trigger · infrastructure budget" },
        { key:"Data format", val:"CSV / REST API / scheduled feed" },
      ],
    },
    taj: {
      abbr:"TAJ", name:"Tax Administration Jamaica", color:"#FF7043",
      pitch:"Commercial vehicle frequency data enables cross-referencing against declared freight manifests and import records. Anomalies between observed corridor volume and declared shipments can flag compliance risks for audit prioritisation.",
      metrics: [
        { key:"Data collected", val:"Commercial vehicle (truck/bus) count by time-of-day" },
        { key:"Update frequency", val:"Hourly aggregates + real-time stream" },
        { key:"Potential use", val:"Freight audit · toll compliance · logistics pattern analysis" },
        { key:"Data format", val:"CSV export · API endpoint · scheduled reports" },
      ],
    },
    jutc: {
      abbr:"JUTC", name:"Jamaica Urban Transit Co.", color:"#AB47BC",
      pitch:"Bus detection frequency at key junctions provides independent headway measurement — tracking actual bus arrival intervals vs scheduled service. Peak commuter windows (AM/PM) are automatically identified from vehicle classification data.",
      metrics: [
        { key:"Data collected", val:"Bus classification count · time of day · direction" },
        { key:"Update frequency", val:"Real-time per crossing" },
        { key:"Potential use", val:"Headway analysis · route optimisation · schedule compliance" },
        { key:"Data format", val:"CSV / API / live WebSocket feed" },
      ],
    },
    tourism: {
      abbr:"JTB", name:"Jamaica Tourism Board", color:"#FFD600",
      pitch:"Total vehicle impressions along monitored corridors represent actual visitor mobility flow. Combined with time-of-day data, this enables identification of peak tourist movement windows and congestion hotspots affecting key tourism routes.",
      metrics: [
        { key:"Data collected", val:"Total crossings · time of day · vehicle class" },
        { key:"Update frequency", val:"Real-time + daily summary" },
        { key:"Potential use", val:"Visitor mobility mapping · congestion alerts · route planning" },
        { key:"Data format", val:"Dashboard API · CSV · periodic briefings" },
      ],
    },
    insurance: {
      abbr:"INS", name:"Insurance Industry", color:"#00FF88",
      pitch:"Traffic density combined with vehicle mix data produces a corridor-level risk density score. Peak-hour intensity and heavy vehicle percentage can inform actuarial models for accident probability, enabling more granular premium pricing by corridor and time window.",
      metrics: [
        { key:"Data collected", val:"Traffic density · vehicle mix · peak hours · dwell time" },
        { key:"Update frequency", val:"Hourly risk score · real-time feed available" },
        { key:"Potential use", val:"Actuarial risk modelling · premium pricing · claims geo-analysis" },
        { key:"Data format", val:"Risk score API · raw CSV · corridor reports" },
      ],
    },
    ooh: {
      abbr:"OOH", name:"Out-of-Home Advertising", color:"#00D4FF",
      pitch:"Every vehicle detected passing a camera-monitored location represents a guaranteed, AI-verified advertising impression. Unlike self-reported traffic counts, our data provides actual vehicle-level impressions with dwell time, enabling CPM pricing backed by ground truth.",
      metrics: [
        { key:"Data collected", val:"Vehicle crossings (= impressions) · dwell time · time of day" },
        { key:"Update frequency", val:"Real-time + daily total" },
        { key:"Potential use", val:"CPM pricing · campaign reach verification · inventory valuation" },
        { key:"Data format", val:"Daily impression reports · API · monthly audit export" },
      ],
    },
  };

  function _openAgencyModal(agency) {
    const d = AGENCY_DATA[agency];
    if (!d) return;
    const summary  = _analyticsData?.summary || {};
    const ct       = summary.class_totals || {};
    const total    = summary.today_total  || 0;
    const heavy    = (ct.truck||0) + (ct.bus||0);
    const heavyPct = total > 0 ? `${Math.round((heavy/total)*100)}%` : "—";

    // Dynamic live metric per agency
    const liveMetrics = {
      nwa:      [{ key:"Heavy vehicles (today)", val: heavy.toLocaleString() }, { key:"Heavy vehicle share", val: heavyPct }],
      taj:      [{ key:"Commercial vehicles (today)", val: heavy.toLocaleString() }, { key:"Commercial share", val: heavyPct }],
      jutc:     [{ key:"Buses detected (today)", val: (ct.bus||0).toLocaleString() }, { key:"Bus share", val: total > 0 ? `${Math.round(((ct.bus||0)/total)*100)}%` : "—" }],
      tourism:  [{ key:"Vehicle impressions (today)", val: Number(total).toLocaleString() }, { key:"Peak hour", val: summary.peak_hour ? `${String(new Date(summary.peak_hour).getHours()).padStart(2,"0")}:00` : "—" }],
      insurance:[{ key:"Risk density score", val: total > 0 ? Math.min(100,Math.round((heavy/total)*60+(( summary.peak_value||0)/50)*40)) : "0" }, { key:"Peak hour intensity", val: summary.peak_value||"—" }],
      ooh:      [{ key:"AI-verified impressions (today)", val: Number(total).toLocaleString() }, { key:"Peak window", val: summary.peak_hour ? `${String(new Date(summary.peak_hour).getHours()).padStart(2,"0")}:00` : "—" }],
    };
    const lm = liveMetrics[agency] || [];

    _showModal(`${d.abbr} — DATA PACKAGE`, `
      <div class="gov-modal-section">
        <div class="gov-modal-section-head" style="color:${d.color}">${d.name}</div>
        <p class="gov-modal-pitch">${d.pitch}</p>
      </div>
      <div class="gov-modal-section">
        <div class="gov-modal-section-head">LIVE DATA SNAPSHOT</div>
        <div class="gov-modal-data-rows">
          ${lm.map(r => `<div class="gov-modal-data-row"><span class="gov-modal-data-key">${r.key}</span><span class="gov-modal-data-val">${r.val}</span></div>`).join("")}
        </div>
      </div>
      <div class="gov-modal-section">
        <div class="gov-modal-section-head">DATA SPECIFICATION</div>
        <div class="gov-modal-data-rows">
          ${d.metrics.map(m => `<div class="gov-modal-data-row"><span class="gov-modal-data-key">${m.key}</span><span class="gov-modal-data-val">${m.val}</span></div>`).join("")}
        </div>
      </div>
      <p class="gov-modal-note">Contact us at data@whitelinez.com to request a sample dataset, API credentials, or pricing for a data partnership.</p>
      <button class="gov-modal-cta" onclick="window.location.href='mailto:data@whitelinez.com?subject=Data Partnership — ${d.abbr}'">Request Data Package</button>
    `);
  }

}());
