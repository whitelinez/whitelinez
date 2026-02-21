(async () => {
  const session = await Auth.getSession();

  // Nav auth state
  if (session) {
    document.getElementById("nav-auth")?.classList.add("hidden");
    document.getElementById("nav-user")?.classList.remove("hidden");
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

  // Canvas overlays
  const zoneCanvas = document.getElementById("zone-canvas");
  ZoneOverlay.init(video, zoneCanvas);

  const detectionCanvas = document.getElementById("detection-canvas");
  DetectionOverlay.init(video, detectionCanvas);

  // Floating count widget
  const streamWrapper = document.querySelector(".stream-wrapper");
  FloatingCount.init(streamWrapper);

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

  // ws_account — per-user events (balance, bet resolution)
  if (session) {
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

  // Handle bet resolution from ws_account
  window.addEventListener("bet:resolved", (e) => {
    LiveBet.onBetResolved(e.detail);
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
