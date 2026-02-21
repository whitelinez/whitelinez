/**
 * counter.js — WebSocket consumer for /ws/live.
 * Fires count:update and round:update events for other modules.
 * Also updates FloatingCount WS status dot.
 */

const Counter = (() => {
  let ws = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let backoff = 2000;
  const MAX_BACKOFF = 30000;

  function setStatus(ok) {
    if (window.FloatingCount) FloatingCount.setStatus(ok);
  }

  function update(data) {
    window.dispatchEvent(new CustomEvent("count:update", { detail: data }));
  }

  async function pollLatestSnapshot() {
    try {
      const { data } = await window.sb
        .from("count_snapshots")
        .select("camera_id, captured_at, total, count_in, count_out, vehicle_breakdown")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;
      update({
        type: "count",
        camera_id: data.camera_id,
        captured_at: data.captured_at,
        total: data.total || 0,
        count_in: data.count_in || 0,
        count_out: data.count_out || 0,
        vehicle_breakdown: data.vehicle_breakdown || {},
        detections: [],
        new_crossings: 0,
      });
    } catch {
      // keep silent, websocket path is primary
    }
  }

  function startPollFallback() {
    if (pollTimer) return;
    pollTimer = setInterval(pollLatestSnapshot, 2000);
    pollLatestSnapshot();
  }

  function stopPollFallback() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function connect() {
    let token, wssUrl;
    try {
      const res = await fetch("/api/token");
      if (!res.ok) throw new Error(`token fetch ${res.status}`);
      ({ token, wss_url: wssUrl } = await res.json());
      window._wsToken = token;
      window._wssUrl = wssUrl;
    } catch (err) {
      setStatus(false);
      startPollFallback();
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
      stopPollFallback();
      backoff = 2000;
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "count") {
          update(data);
          if ("round" in data) {
            window.dispatchEvent(new CustomEvent("round:update", { detail: data.round }));
          }
        } else if (data.type === "round") {
          window.dispatchEvent(new CustomEvent("round:update", { detail: data.round }));
        }
      } catch {}
    };

    ws.onerror = () => setStatus(false);

    ws.onclose = () => {
      setStatus(false);
      startPollFallback();
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
        connect();
      }, backoff);
    };
  }

  function init() {
    window.addEventListener("load", connect);
    if (window._wsToken) connect();
  }

  function destroy() {
    clearTimeout(reconnectTimer);
    stopPollFallback();
    if (ws) ws.close();
  }

  return { init, destroy };
})();

window.Counter = Counter;
