/**
 * counter.js — WebSocket consumer for /ws/live.
 * Fires count:update and round:update events for other modules.
 * Also updates FloatingCount WS status dot.
 */

const Counter = (() => {
  let ws = null;
  let reconnectTimer = null;
  let backoff = 2000;
  const MAX_BACKOFF = 30000;

  function setStatus(ok) {
    if (window.FloatingCount) FloatingCount.setStatus(ok);
  }

  function update(data) {
    window.dispatchEvent(new CustomEvent("count:update", { detail: data }));
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
    if (ws) ws.close();
  }

  return { init, destroy };
})();

window.Counter = Counter;
