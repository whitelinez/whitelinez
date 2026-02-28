/**
 * counter.js — WebSocket consumer for /ws/live.
 * Fires count:update and round:update events for other modules.
 * Also updates FloatingCount WS status dot.
 */

const Counter = (() => {
  let ws = null;
  let reconnectTimer = null;
  let backoff = 2000;
  let started = false;
  let lastRoundSig = "";
  let lastCountTsMs = 0;
  const MAX_BACKOFF = 30000;
  const MAX_BOX_STALE_MS = 350;
  const _eventQueue = [];
  let _queueTimer = null;

  function _drainQueue() {
    const now = Date.now();
    while (_eventQueue.length && _eventQueue[0].showAt <= now) {
      const { data } = _eventQueue.shift();
      const sanitized = sanitizeCountPayload(data, true);
      if (!sanitized) continue;
      update(sanitized);
      if ("round" in data) emitRoundIfChanged(data.round);
    }
    if (_eventQueue.length) {
      _queueTimer = setTimeout(_drainQueue, 50);
    } else {
      _queueTimer = null;
    }
  }

  function enqueue(data) {
    const delayMs = Math.round((window.Stream?.getLatency?.() ?? 0) * 1000);
    _eventQueue.push({ data, showAt: Date.now() + delayMs });
    if (!_queueTimer) _queueTimer = setTimeout(_drainQueue, Math.max(delayMs, 50));
  }

  function setStatus(ok) {
    if (window.FloatingCount) FloatingCount.setStatus(ok);
  }

  function update(data) {
    window.dispatchEvent(new CustomEvent("count:update", { detail: data }));
  }

  function sanitizeCountPayload(data, fromQueue = false) {
    if (!data || typeof data !== "object") return data;
    const tsRaw = data.captured_at;
    const tsMs = tsRaw ? Date.parse(tsRaw) : NaN;
    const now = Date.now();

    if (Number.isFinite(tsMs)) {
      // Keep the newest payload only; drop out-of-order frames.
      if (lastCountTsMs && tsMs < lastCountTsMs) return null;
      lastCountTsMs = tsMs;

      // Queued events are intentionally delayed — don't strip boxes for age.
      if (!fromQueue) {
        const ageMs = now - tsMs;
        if (ageMs > MAX_BOX_STALE_MS) {
          return { ...data, detections: [] };
        }
      }
    }
    return data;
  }

  function roundSignature(round) {
    if (!round) return "none";
    return [
      round.id || "",
      round.status || "",
      round.opens_at || "",
      round.closes_at || "",
      round.ends_at || "",
    ].join("|");
  }

  function emitRoundIfChanged(round) {
    const sig = roundSignature(round);
    if (sig === lastRoundSig) return;
    lastRoundSig = sig;
    window.dispatchEvent(new CustomEvent("round:update", { detail: round || null }));
  }

  async function bootstrapFromHealth() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const health = await res.json();
      const snap = health?.latest_snapshot;
      if (!snap || typeof snap !== "object") return;
      const payload = {
        type: "count",
        camera_id: snap.camera_id || null,
        captured_at: snap.captured_at || null,
        count_in: Number(snap.count_in || 0),
        count_out: Number(snap.count_out || 0),
        total: Number(snap.total || 0),
        vehicle_breakdown: snap.vehicle_breakdown || {},
        new_crossings: 0,
        detections: [],
        bootstrap: true,
      };
      update(payload);
    } catch {}
  }

  async function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let token, wssUrl;
    try {
      const res = await fetch("/api/token");
      if (!res.ok) throw new Error(`token fetch ${res.status}`);
      ({ token, wss_url: wssUrl } = await res.json());
      window._wsToken = token;
      window._wssUrl = wssUrl;
    } catch (err) {
      setStatus(false);
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
        connect();
      }, backoff);
      return;
    }

    setStatus(false);
    ws = new WebSocket(`${wssUrl}?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      setStatus(true);
      backoff = 2000;
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "count") {
          enqueue(data);
        } else if (data.type === "round") {
          emitRoundIfChanged(data.round);
        }
      } catch {}
    };

    ws.onerror = () => setStatus(false);

    ws.onclose = () => {
      setStatus(false);
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
        connect();
      }, backoff);
    };
  }

  function init() {
    if (started) return;
    started = true;
    bootstrapFromHealth();
    if (document.readyState === "complete") connect();
    else window.addEventListener("load", connect, { once: true });
    if (window._wsToken) connect();
  }

  function destroy() {
    clearTimeout(reconnectTimer);
    if (ws) ws.close();
  }

  return { init, destroy };
})();

window.Counter = Counter;
