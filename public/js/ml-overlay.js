/**
 * ml-overlay.js - Live vision status overlay for the public stream.
 * Uses count:update payloads + scene inference for user-friendly status text.
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
    sceneLighting: "unknown",
    sceneWeather: "unknown",
    sceneConfidence: 0,
  };

  let _bound = false;
  let _pollTimer = null;
  let _titleTimer = null;
  let _titleIndex = 0;

  function init() {
    if (_bound) return;
    _bound = true;
    state.startedAt = Date.now();

    window.addEventListener("count:update", (e) => updateFromCount(e.detail || {}));
    seedFromTelemetry();
    pollHealth();
    _pollTimer = setInterval(pollHealth, 20000);
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
    const sceneLighting = String(data?.scene_lighting || "").trim();
    const sceneWeather = String(data?.scene_weather || "").trim();
    const sceneConfidence = Number(data?.scene_confidence);
    if (sceneLighting) state.sceneLighting = sceneLighting;
    if (sceneWeather) state.sceneWeather = sceneWeather;
    if (Number.isFinite(sceneConfidence)) {
      state.sceneConfidence = Math.max(0, Math.min(1, sceneConfidence));
    }

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

  function mapSceneValue(value, fallback) {
    const v = String(value || "").trim().toLowerCase();
    if (!v || v === "unknown" || v === "none" || v === "null") return fallback;
    return v.replaceAll("_", " ");
  }

  function getSceneDisplay() {
    const lighting = mapSceneValue(state.sceneLighting, "scanning");
    const weather = mapSceneValue(state.sceneWeather, "scanning");
    const confPct = Math.round(Math.max(0, Math.min(1, Number(state.sceneConfidence) || 0)) * 100);
    const hasRealScene = lighting !== "scanning" || weather !== "scanning";
    if (!hasRealScene && state.frames === 0) return "Idle";
    if (!hasRealScene || confPct < 18) return "Scanning...";
    const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    return `${title(lighting)} | ${title(weather)}`;
  }

  function getHudState(avgConf) {
    const sceneText = getSceneDisplay();
    if (state.frames === 0) return "Idle";
    if (sceneText === "Scanning..." || state.lastDelayMs == null) return "Scanning";
    const lighting = mapSceneValue(state.sceneLighting, "scanning");
    if (lighting === "night") return "Night";
    if (lighting === "day") return "Day";
    if (Number.isFinite(avgConf) && avgConf >= 0.56 && state.detections > 150) return "Ready";
    return "Scanning";
  }

  function percent(n) {
    const v = Math.max(0, Math.min(100, Number(n) || 0));
    return `${Math.round(v)}%`;
  }

  function render() {
    const titleEl = document.querySelector(".ml-hud-title");
    const levelEl = document.getElementById("ml-hud-level");
    const msgEl = document.getElementById("ml-hud-msg");
    const framesEl = document.getElementById("ml-hud-frames");
    const detsEl = document.getElementById("ml-hud-dets");
    const confEl = document.getElementById("ml-hud-conf");
    const sceneEl = document.getElementById("ml-hud-profile");
    const delayEl = document.getElementById("ml-hud-delay");
    const confBarEl = document.getElementById("ml-hud-conf-bar");
    const sceneBarEl = document.getElementById("ml-hud-scene-bar");
    const sceneConfEl = document.getElementById("ml-hud-scene-conf");
    if (!titleEl || !levelEl || !msgEl || !framesEl || !detsEl || !confEl || !sceneEl || !delayEl || !confBarEl || !sceneBarEl || !sceneConfEl) return;

    const level = getLevel();
    const avgConf = getAvgConf();
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    const title = isMobile ? "VISION" : "LIVE VISION HUD";
    const hudState = getHudState(avgConf);
    const modeLabel = state.runtimeProfile ? state.runtimeProfile.replaceAll("_", " ") : "balanced";
    const sceneLabel = getSceneDisplay();
    const delayText = Number.isFinite(state.lastDelayMs)
      ? `${Math.round(state.lastDelayMs)}ms`
      : (state.frames > 0 ? "Scanning..." : "Idle");
    const reasonText = state.runtimeReason ? state.runtimeReason.replaceAll("_", " ") : "";
    const confPct = avgConf == null ? 0 : Math.max(0, Math.min(100, avgConf * 100));
    const scenePct = Math.max(0, Math.min(100, (Number(state.sceneConfidence) || 0) * 100));

    titleEl.textContent = title;
    levelEl.textContent = hudState;
    levelEl.classList.toggle("is-live", hudState === "Day" || hudState === "Ready");
    levelEl.classList.toggle("is-scan", hudState === "Scanning");
    msgEl.textContent = `${level.label}. Mode: ${modeLabel}${reasonText ? ` (${reasonText})` : ""}.`;
    framesEl.textContent = state.frames.toLocaleString();
    detsEl.textContent = state.detections.toLocaleString();
    confEl.textContent = percent(confPct);
    confBarEl.style.width = `${confPct.toFixed(1)}%`;
    sceneConfEl.textContent = percent(scenePct);
    sceneBarEl.style.width = `${scenePct.toFixed(1)}%`;
    sceneEl.textContent = sceneLabel;
    delayEl.textContent = delayText;
  }

  function destroy() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
    _titleTimer = null;
    _bound = false;
  }

  return { init, destroy };
})();

window.MlOverlay = MlOverlay;
