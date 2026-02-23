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
  async function resolveActiveCamera() {
    const { data, error } = await window.sb
      .from("cameras")
      .select("id, ipcam_alias, created_at, feed_appearance")
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
      const appearance = cfg.auto_day_night
        ? (isNightWindowNow() ? PUBLIC_NIGHT_PRESET : PUBLIC_DAY_PRESET)
        : (cfg.appearance || {});
      videoEl.style.filter = buildVideoFilter(appearance);
    } catch {
      // Keep public view resilient if appearance config fetch fails.
    }
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
      if (balEl && data?.balance != null) {
        balEl.textContent = Number(data.balance).toLocaleString() + " ₡";
        balEl.classList.remove("hidden");
      }
    } catch {
      // WS updates still handle most cases; keep silent on poll failures.
    }
  }

  function defaultAvatar(seed) {
    const src = String(seed || "whitelinez-user");
    let hash = 0;
    for (let i = 0; i < src.length; i += 1) hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    const hue2 = (hue + 28) % 360;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'>
      <defs>
        <linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='hsl(${hue},66%,34%)'/>
          <stop offset='100%' stop-color='hsl(${hue2},74%,20%)'/>
        </linearGradient>
      </defs>
      <rect width='96' height='96' rx='48' fill='url(#bg)'/>
      <circle cx='48' cy='48' r='41' fill='none' stroke='rgba(255,255,255,0.24)' stroke-width='1.5'/>
      <path d='M24 56l6-14h34l7 14' fill='none' stroke='#d8f8ff' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/>
      <rect x='20' y='56' width='56' height='12' rx='4' fill='none' stroke='#d8f8ff' stroke-width='3.2'/>
      <circle cx='34' cy='69' r='5' fill='none' stroke='#ffd600' stroke-width='2.6'/>
      <circle cx='62' cy='69' r='5' fill='none' stroke='#ffd600' stroke-width='2.6'/>
      <path d='M33 48h22' stroke='#7de3ff' stroke-width='2.2' stroke-linecap='round'/>
      <path d='M28 28h9M59 28h9M28 28v7M68 28v7' stroke='#ffd600' stroke-width='2' stroke-linecap='round'/>
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

  // Nav auth state
  if (session) {
    document.getElementById("nav-auth")?.classList.add("hidden");
    document.getElementById("nav-user")?.classList.remove("hidden");

    const user = session.user || {};
    const avatarRaw = user.user_metadata?.avatar_url || "";
    const avatar = isAllowedAvatarUrl(avatarRaw)
      ? avatarRaw
      : defaultAvatar(user.id || user.email || "user");
    const navAvatar = document.getElementById("nav-avatar");
    if (navAvatar) {
      navAvatar.onerror = () => {
        navAvatar.src = defaultAvatar(user.id || user.email || "user");
      };
      navAvatar.src = avatar;
    }

    if (user.app_metadata?.role === "admin") {
      document.getElementById("nav-admin-link")?.classList.remove("hidden");
    }
  }

  // Play overlay
  document.getElementById("btn-play")?.addEventListener("click", () => {
    document.getElementById("live-video")?.play();
    document.getElementById("play-overlay")?.classList.add("hidden");
  });

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", () => Auth.logout());

  // Stream
  const video = document.getElementById("live-video");
  await Stream.init(video);
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

  // Activity feed
  Activity.init();
  MlShowcase.init();

  // ws_account — per-user events (balance, bet resolution)
  if (session) {
    refreshNavBalance();
    setInterval(refreshNavBalance, 20000);
    _connectUserWs(session);
  }

  // Nav balance display from ws_account
  window.addEventListener("balance:update", (e) => {
    const balEl = document.getElementById("nav-balance");
    if (balEl) {
      balEl.textContent = (e.detail ?? 0).toLocaleString() + " ₡";
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
})();


// ── User WebSocket (/ws/account) ──────────────────────────────────────────────
function _connectUserWs(session) {
  let ws = null;
  let backoff = 2000;

  async function connect() {
    const jwt = await Auth.getJwt();
    if (!jwt) return;
    const wssUrl = window._wssUrl;
    if (!wssUrl) {
      // Derive from public WS URL by replacing /ws/live → /ws/account
      // Try again once ws token is available
      setTimeout(connect, 3000);
      return;
    }
    const accountUrl = wssUrl.replace("/ws/live", "/ws/account");
    ws = new WebSocket(`${accountUrl}?token=${encodeURIComponent(jwt)}`);

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "balance") {
          window.dispatchEvent(new CustomEvent("balance:update", { detail: data.balance }));
        } else if (data.type === "bet_resolved") {
          window.dispatchEvent(new CustomEvent("bet:resolved", { detail: data }));
        }
      } catch {}
    };

    ws.onclose = () => {
      ws = null;
      backoff = Math.min(backoff * 2, 30000);
      setTimeout(connect, backoff);
    };
  }

  // Wait for ws token to be available (set by Counter.init/stream.js)
  const waitForToken = setInterval(() => {
    if (window._wssUrl) {
      clearInterval(waitForToken);
      connect();
    }
  }, 1000);
}
