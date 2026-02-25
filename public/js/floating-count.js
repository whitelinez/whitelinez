/**
 * floating-count.js — Floating count widget on the video stream.
 * Reads count:update events, updates the widget, spawns +N float animations.
 *
 * BET MODE: while the user has an active bet, the main total switches to
 * showing bet-relative progress (cars since bet was placed, starting at 0).
 * Once the bet resolves or is dismissed, the widget returns to global total.
 */

const FloatingCount = (() => {
  let _wrapper = null;
  let _lastTotal = 0;         // latest global total from WS
  let _betBaseline = null;    // global total at moment bet was placed; null = no active bet
  let _betVehicleClass = null; // vehicle class for the active bet (null = all)

  function init(streamWrapper) {
    _wrapper = streamWrapper;

    window.addEventListener("count:update", (e) => {
      update(e.detail);
    });

    // Switch to bet mode when user places a bet.
    window.addEventListener("bet:placed", (e) => {
      const detail = e.detail || {};
      _betVehicleClass = detail.vehicle_class || null;
      // Anchor baseline to the current live count at bet placement time.
      if (_betVehicleClass) {
        const bd = window._lastCountPayload?.vehicle_breakdown ?? {};
        _betBaseline = Number(bd[_betVehicleClass] ?? 0);
      } else {
        _betBaseline = _lastTotal;
      }
      _refreshBetModeLabel(true);
    });

    // Return to global mode when bet resolves.
    window.addEventListener("bet:resolved", () => {
      _betBaseline = null;
      _betVehicleClass = null;
      _refreshBetModeLabel(false);
    });
  }

  function _refreshBetModeLabel(isBetMode) {
    const labelEl = document.getElementById("cw-total-label");
    if (!labelEl) return;
    labelEl.textContent = isBetMode ? "MY BET" : "TOTAL";
  }

  function update(data) {
    const total = data.total ?? 0;
    const bd = data.vehicle_breakdown ?? {};
    const crossings = data.new_crossings ?? 0;

    _lastTotal = total;
    // Expose latest payload globally so bet:placed handler can read vehicle breakdown.
    window._lastCountPayload = data;

    const totalEl = document.getElementById("cw-total");
    const carsEl = document.getElementById("cw-cars");
    const trucksEl = document.getElementById("cw-trucks");
    const busesEl = document.getElementById("cw-buses");
    const motosEl = document.getElementById("cw-motos");

    // In bet mode: show cars since bet was placed (starts at 0 for the bettor).
    let displayTotal = total;
    if (_betBaseline !== null) {
      if (_betVehicleClass) {
        const currentClass = Number(bd[_betVehicleClass] ?? 0);
        displayTotal = Math.max(0, currentClass - _betBaseline);
      } else {
        displayTotal = Math.max(0, total - _betBaseline);
      }
    }

    if (totalEl) totalEl.textContent = displayTotal.toLocaleString();
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
