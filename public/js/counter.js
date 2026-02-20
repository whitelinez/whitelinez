/**
 * counter.js — WebSocket consumer for /ws/live.
 * Receives count snapshots and updates the DOM count display.
 */

const Counter = (() => {
  let ws = null;
  let reconnectTimer = null;
  let backoff = 2000;
  const MAX_BACKOFF = 30000;

  const els = {
    total: null,
    cars: null,
    trucks: null,
    buses: null,
    motorcycles: null,
    status: null,
  };

  function bindElements() {
    els.total = document.getElementById("count-total");
    els.cars = document.getElementById("count-cars");
    els.trucks = document.getElementById("count-trucks");
    els.buses = document.getElementById("count-buses");
    els.motorcycles = document.getElementById("count-motorcycles");
    els.status = document.getElementById("ws-status");
  }

  function setStatus(text, ok = true) {
    if (els.status) {
      els.status.textContent = text;
      els.status.className = ok ? "ws-status ws-ok" : "ws-status ws-err";
    }
  }

  function update(data) {
    if (els.total) els.total.textContent = data.total ?? 0;
    const bd = data.vehicle_breakdown ?? {};
    if (els.cars) els.cars.textContent = bd.car ?? 0;
    if (els.trucks) els.trucks.textContent = bd.truck ?? 0;
    if (els.buses) els.buses.textContent = bd.bus ?? 0;
    if (els.motorcycles) els.motorcycles.textContent = bd.motorcycle ?? 0;

    // Fire event for markets.js to react to
    window.dispatchEvent(new CustomEvent("count:update", { detail: data }));
  }

  async function connect() {
    const token = window._wsToken;
    const wssUrl = window._wssUrl;
    if (!token || !wssUrl) {
      setStatus("Waiting for token...", false);
      setTimeout(connect, 1000);
      return;
    }

    setStatus("Connecting...", false);
    ws = new WebSocket(`${wssUrl}?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      setStatus("Live", true);
      backoff = 2000;
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "count") update(data);
      } catch {}
    };

    ws.onerror = () => setStatus("Error", false);

    ws.onclose = () => {
      setStatus("Reconnecting...", false);
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
        connect();
      }, backoff);
    };
  }

  function init() {
    bindElements();
    // Wait for stream.js to populate token
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
