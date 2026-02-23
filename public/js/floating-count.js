/**
 * floating-count.js — Floating count widget on the video stream.
 * Reads count:update events, updates the widget, spawns +N float animations.
 */

const FloatingCount = (() => {
  let _wrapper = null;

  function init(streamWrapper) {
    _wrapper = streamWrapper;

    window.addEventListener("count:update", (e) => {
      update(e.detail);
    });
  }

  function update(data) {
    const total = data.total ?? 0;
    const bd = data.vehicle_breakdown ?? {};
    const crossings = data.new_crossings ?? 0;

    const totalEl = document.getElementById("cw-total");
    const carsEl = document.getElementById("cw-cars");
    const trucksEl = document.getElementById("cw-trucks");
    const busesEl = document.getElementById("cw-buses");
    const motosEl = document.getElementById("cw-motos");

    if (totalEl) totalEl.textContent = total;
    if (carsEl) carsEl.textContent = bd.car ?? 0;
    if (trucksEl) trucksEl.textContent = bd.truck ?? 0;
    if (busesEl) busesEl.textContent = bd.bus ?? 0;
    if (motosEl) motosEl.textContent = bd.motorcycle ?? 0;

    if (crossings > 0) spawnPop(crossings);
  }

  function setStatus(ok) {
    const dot = document.getElementById("cw-ws-dot");
    if (!dot) return;
    dot.className = ok ? "cw-ws-dot cw-ws-ok" : "cw-ws-dot cw-ws-err";
  }

  function spawnPop(n) {
    if (!_wrapper) return;
    const el = document.createElement("div");
    el.className = "count-pop";
    el.textContent = "+" + n;

    // Position near the count widget (bottom-left area)
    const widget = document.getElementById("count-widget");
    if (widget) {
      const rect = widget.getBoundingClientRect();
      const wRect = _wrapper.getBoundingClientRect();
      el.style.left = (rect.left - wRect.left + rect.width / 2) + "px";
      el.style.top  = (rect.top  - wRect.top  - 10) + "px";
    } else {
      el.style.left = "80px";
      el.style.bottom = "60px";
    }

    _wrapper.appendChild(el);
    setTimeout(() => el.remove(), 1050);
  }

  return { init, setStatus };
})();

window.FloatingCount = FloatingCount;
