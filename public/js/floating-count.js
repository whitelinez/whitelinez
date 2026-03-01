/**
 * floating-count.js — Floating count widget on the video stream.
 *
 * NORMAL MODE: shows global total.
 * GUESS MODE: hides global total; shows X/Y progress toward the user's guess,
 *   with a colour-coded bar (green → yellow → red as it approaches/exceeds target).
 */

const FloatingCount = (() => {
  let _wrapper         = null;
  let _lastTotal       = 0;
  let _guessBaseline   = null;   // total at moment guess was placed
  let _guessTarget     = null;   // user's guessed count
  let _currentCameraId = null;   // null = show all; set when camera is switched

  function init(streamWrapper) {
    _wrapper = streamWrapper;

    window.addEventListener("count:update", (e) => {
      const data = e.detail;
      // Only update if no camera filter set, or payload matches current camera
      if (_currentCameraId && data.camera_id && data.camera_id !== _currentCameraId) return;
      update(data);
    });

    // Camera switched — show that camera's count
    window.addEventListener("camera:switched", (e) => {
      const { cameraId, name, isAI } = e.detail || {};
      _currentCameraId = cameraId || null;
      _setCamLabel(name || null, isAI);
      if (isAI) {
        // Reset count display until new stream data arrives
        _lastTotal = 0;
        const totalEl = document.getElementById("cw-total");
        if (totalEl) totalEl.textContent = "0";
        ["cw-cars","cw-trucks","cw-buses","cw-motos"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = "0";
        });
        const fpsEl = document.getElementById("cw-fps");
        if (fpsEl) fpsEl.textContent = "--";
      } else if (cameraId) {
        _loadCameraSnapshot(cameraId);
      }
    });

    // Enter guess mode when a guess is submitted.
    window.addEventListener("bet:placed", (e) => {
      const detail = e.detail || {};
      _guessTarget   = detail.exact_count ?? null;
      _guessBaseline = _lastTotal;
      _enterGuessMode();
    });

    // Return to normal mode when result comes back.
    window.addEventListener("bet:resolved", _exitGuessMode);
  }

  // ── Mode switches ─────────────────────────────────────────────

  function _enterGuessMode() {
    document.getElementById("cw-normal")?.classList.add("hidden");
    const gm = document.getElementById("cw-guess-mode");
    if (gm) gm.classList.remove("hidden");

    const targetEl = document.getElementById("cw-gm-target");
    if (targetEl) targetEl.textContent = _guessTarget ?? "—";

    _setGuessProgress(0);
  }

  function _exitGuessMode() {
    _guessBaseline = null;
    _guessTarget   = null;
    document.getElementById("cw-normal")?.classList.remove("hidden");
    document.getElementById("cw-guess-mode")?.classList.add("hidden");
  }

  function _setGuessProgress(sinceGuess) {
    const currentEl = document.getElementById("cw-gm-current");
    const barEl     = document.getElementById("cw-gm-bar");
    if (currentEl) currentEl.textContent = sinceGuess;
    if (barEl && _guessTarget > 0) {
      const pct = Math.min(100, (sinceGuess / _guessTarget) * 100);
      barEl.style.width = pct + "%";
      barEl.style.background =
        pct >= 100 ? "#ef4444" :   // red — overshot
        pct >= 80  ? "#eab308" :   // yellow — getting close
                     "#22c55e";    // green — on track
    }
  }

  // ── Count update ──────────────────────────────────────────────

  function update(data) {
    const total    = data.total ?? 0;
    const bd       = data.vehicle_breakdown ?? {};
    const crossings = data.new_crossings ?? 0;

    _lastTotal = total;
    window._lastCountPayload = data;

    const totalEl  = document.getElementById("cw-total");
    const carsEl   = document.getElementById("cw-cars");
    const trucksEl = document.getElementById("cw-trucks");
    const busesEl  = document.getElementById("cw-buses");
    const motosEl  = document.getElementById("cw-motos");
    const fpsEl    = document.getElementById("cw-fps");

    if (totalEl)  totalEl.textContent  = total.toLocaleString();
    if (carsEl)   carsEl.textContent   = bd.car        ?? 0;
    if (trucksEl) trucksEl.textContent = bd.truck      ?? 0;
    if (busesEl)  busesEl.textContent  = bd.bus        ?? 0;
    if (motosEl)  motosEl.textContent  = bd.motorcycle ?? 0;
    if (fpsEl) {
      const fps = data.fps ?? data.fps_estimate ?? null;
      fpsEl.textContent = fps != null ? `${Number(fps).toFixed(1)} fps` : "--.- fps";
      fpsEl.className = "cw-fps" + (fps == null ? " cw-fps-na" : fps < 3 ? " cw-fps-bad" : "");
    }

    // Update guess-mode progress bar if active
    if (_guessBaseline !== null && _guessTarget !== null) {
      const sinceGuess = Math.max(0, total - _guessBaseline);
      _setGuessProgress(sinceGuess);
    }

    if (crossings > 0) spawnPop(crossings);
  }

  function setStatus(ok) {
    const dot = document.getElementById("cw-ws-dot");
    if (!dot) return;
    dot.className = ok ? "cw-ws-dot cw-ws-ok" : "cw-ws-dot cw-ws-err";
  }

  function _setCamLabel(name, isAI) {
    const el = document.getElementById("cw-cam-label");
    if (!el) return;
    if (name) {
      el.textContent = name;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
    // Show snapshot badge when not on the AI cam
    const badge = document.getElementById("cw-snapshot-badge");
    if (badge) badge.classList.toggle("hidden", !!isAI);
  }

  async function _loadCameraSnapshot(cameraId) {
    try {
      const [snapResp, fpsResp] = await Promise.all([
        window.sb
          .from("count_snapshots")
          .select("camera_id, captured_at, total, count_in, count_out, vehicle_breakdown")
          .eq("camera_id", cameraId)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Compute FPS: events in last 5 min / elapsed seconds
        window.sb
          .from("ml_detection_events")
          .select("captured_at")
          .eq("camera_id", cameraId)
          .gte("captured_at", new Date(Date.now() - 5 * 60_000).toISOString())
          .order("captured_at", { ascending: true }),
      ]);

      let fps = null;
      const rows = fpsResp?.data || [];
      if (rows.length >= 2) {
        const elapsed = (new Date(rows.at(-1).captured_at) - new Date(rows[0].captured_at)) / 1000;
        if (elapsed > 0) fps = rows.length / elapsed;
      }

      const snap = snapResp?.data;
      update({
        camera_id: cameraId,
        total: snap?.total || 0,
        vehicle_breakdown: snap?.vehicle_breakdown || {},
        new_crossings: 0,
        fps,
        snapshot: true,
      });
    } catch {}
  }

  function spawnPop(n) {
    if (!_wrapper) return;
    const el = document.createElement("div");
    el.className = "count-pop";
    el.textContent = "+" + n;

    const widget = document.getElementById("count-widget");
    if (widget) {
      const rect  = widget.getBoundingClientRect();
      const wRect = _wrapper.getBoundingClientRect();
      el.style.left = (rect.left - wRect.left + rect.width / 2) + "px";
      el.style.top  = (rect.top  - wRect.top  - 10) + "px";
    } else {
      el.style.left   = "80px";
      el.style.bottom = "60px";
    }

    _wrapper.appendChild(el);
    setTimeout(() => el.remove(), 1050);
  }

  return { init, update, setStatus };
})();

window.FloatingCount = FloatingCount;
