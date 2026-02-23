/**
 * ml-overlay.js - Subtle live ML progress overlay for the public stream.
 * Uses count:update payloads to show session learning signal and confidence trend.
 */

const MlOverlay = (() => {
  const state = {
    startedAt: Date.now(),
    frames: 0,
    detections: 0,
    confSum: 0,
    confCount: 0,
    modelLoop: "unknown",
    seededFromTelemetry: false,
    runtimeProfile: "",
    runtimeReason: "",
    lastDelayMs: null,
  };

  let _bound = false;
  let _pollTimer = null;
  let _titleTimer = null;
  let _titleIndex = 0;

  const TITLE_MESSAGES_DESKTOP = [
    "AI Learning",
    "Learning vehicle patterns",
    "Count accuracy improves",
  ];

  const TITLE_MESSAGES_MOBILE = [
    "AI Learning",
    "Learning vehicles",
    "Count improving",
  ];

  function init() {
    if (_bound) return;
    _bound = true;
    state.startedAt = Date.now();

    window.addEventListener("count:update", (e) => updateFromCount(e.detail || {}));
    seedFromTelemetry();
    pollHealth();
    _pollTimer = setInterval(pollHealth, 20000);
    _titleTimer = setInterval(() => {
      _titleIndex = (_titleIndex + 1) % TITLE_MESSAGES_DESKTOP.length;
      render();
    }, 7000);
    render();
  }

  async function seedFromTelemetry() {
    if (state.seededFromTelemetry) return;
    if (!window.sb?.from) return;
    try {
      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data } = await window.sb
        .from("ml_detection_events")
        .select("avg_confidence,detections_count")
        .gte("captured_at", since)
        .order("captured_at", { ascending: false })
        .limit(120);
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) return;

      let detCount = 0;
      let confWeighted = 0;
      for (const row of rows) {
        const d = Number(row?.detections_count || 0);
        const c = Number(row?.avg_confidence);
        if (Number.isFinite(d) && d > 0 && Number.isFinite(c) && c >= 0 && c <= 1) {
          detCount += d;
          confWeighted += c * d;
        }
      }
      if (detCount > 0) {
        state.confSum += confWeighted;
        state.confCount += detCount;
        state.detections += detCount;
      }
      state.frames += rows.length;
      state.seededFromTelemetry = true;
      render();
    } catch {
      // Keep live-only mode if telemetry query fails.
    }
  }

  function updateFromCount(data) {
    state.frames += 1;
    const dets = Array.isArray(data?.detections) ? data.detections : [];
    state.detections += dets.length;

    for (const d of dets) {
      const conf = Number(d?.conf);
      if (Number.isFinite(conf) && conf >= 0 && conf <= 1) {
        state.confSum += conf;
        state.confCount += 1;
      }
    }

    const profile = String(data?.runtime_profile || "").trim();
    const reason = String(data?.runtime_profile_reason || "").trim();
    if (profile) state.runtimeProfile = profile;
    if (reason) state.runtimeReason = reason;

    const ts = Date.parse(String(data?.captured_at || ""));
    if (Number.isFinite(ts)) {
      const delay = Date.now() - ts;
      state.lastDelayMs = Math.max(0, delay);
    }

    render();
  }

  async function pollHealth() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const payload = await res.json();
      state.modelLoop = payload?.ml_retrain_task_running ? "active" : "idle";
      const latest = payload?.latest_ml_detection || null;
      const conf = Number(latest?.avg_confidence);
      if (Number.isFinite(conf) && conf >= 0 && conf <= 1 && state.confCount === 0) {
        // Seed confidence immediately after deploy/reload even before first WS frame.
        state.confSum = conf;
        state.confCount = 1;
      }
      render();
    } catch {
      // Keep existing state.
    }
  }

  function getAvgConf() {
    if (!state.confCount) return null;
    return state.confSum / state.confCount;
  }

  function getLevel() {
    const elapsedMin = Math.max(1, (Date.now() - state.startedAt) / 60000);
    const frameRate = state.frames / elapsedMin;
    const detRate = state.detections / elapsedMin;
    const avgConf = getAvgConf();

    let score = 0;
    score += Math.min(50, (state.frames / 500) * 50);
    score += Math.min(30, (detRate / 40) * 30);
    if (avgConf != null) score += Math.min(20, (avgConf / 0.6) * 20);

    if (score >= 80) return { label: "Stabilizing", msg: "Detection quality is improving as more traffic is observed." };
    if (score >= 55) return { label: "Adapting", msg: "The model is adapting to this camera and roadway pattern." };
    if (score >= 30) return { label: "Learning", msg: "Vehicle detection gets better over time with more samples." };
    return { label: "Warming up", msg: "Early learning stage. Confidence will increase as data accumulates." };
  }

  function render() {
    const titleEl = document.querySelector(".ml-hud-title");
    const levelEl = document.getElementById("ml-hud-level");
    const msgEl = document.getElementById("ml-hud-msg");
    const warnEl = document.querySelector(".ml-hud-warning");
    const framesEl = document.getElementById("ml-hud-frames");
    const detsEl = document.getElementById("ml-hud-dets");
    const confEl = document.getElementById("ml-hud-conf");
    const profileEl = document.getElementById("ml-hud-profile");
    const delayEl = document.getElementById("ml-hud-delay");
    if (!titleEl || !levelEl || !msgEl || !framesEl || !detsEl || !confEl || !profileEl || !delayEl) return;

    const level = getLevel();
    const avgConf = getAvgConf();
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    const titleMessages = isMobile ? TITLE_MESSAGES_MOBILE : TITLE_MESSAGES_DESKTOP;
    const title = titleMessages[_titleIndex % titleMessages.length];
    const loopTag = state.modelLoop === "active"
      ? (isMobile ? "" : " | retrain loop on")
      : "";
    const compactLabel = isMobile
      ? level.label.replace("Stabilizing", "Stable").replace("Warming up", "Warmup")
      : level.label;
    const nowHour = new Date().getHours();
    const showNightWarning = nowHour >= 18 || nowHour < 6;
    const profileLabel = state.runtimeProfile
      ? state.runtimeProfile.replaceAll("_", " ")
      : "default";
    const delayText = Number.isFinite(state.lastDelayMs)
      ? `${Math.round(state.lastDelayMs)}ms`
      : "-";
    const reasonText = state.runtimeReason
      ? ` | ${state.runtimeReason.replaceAll("_", " ")}`
      : "";

    titleEl.textContent = title;
    levelEl.textContent = `${compactLabel}${loopTag}`;
    msgEl.textContent = `${level.msg} Runtime: ${profileLabel}${reasonText}.`;
    if (warnEl) warnEl.style.display = showNightWarning ? "block" : "none";
    framesEl.textContent = state.frames.toLocaleString();
    detsEl.textContent = state.detections.toLocaleString();
    confEl.textContent = avgConf == null ? "-" : `${(avgConf * 100).toFixed(1)}%`;
    profileEl.textContent = profileLabel;
    delayEl.textContent = delayText;
  }

  function destroy() {
    if (_pollTimer) clearInterval(_pollTimer);
    if (_titleTimer) clearInterval(_titleTimer);
    _pollTimer = null;
    _titleTimer = null;
    _bound = false;
  }

  return { init, destroy };
})();

window.MlOverlay = MlOverlay;
