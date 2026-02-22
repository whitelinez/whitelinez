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
    pollHealth();
    _pollTimer = setInterval(pollHealth, 20000);
    _titleTimer = setInterval(() => {
      _titleIndex = (_titleIndex + 1) % TITLE_MESSAGES_DESKTOP.length;
      render();
    }, 7000);
    render();
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

    render();
  }

  async function pollHealth() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const payload = await res.json();
      state.modelLoop = payload?.ml_retrain_task_running ? "active" : "idle";
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
    const framesEl = document.getElementById("ml-hud-frames");
    const detsEl = document.getElementById("ml-hud-dets");
    const confEl = document.getElementById("ml-hud-conf");
    if (!titleEl || !levelEl || !msgEl || !framesEl || !detsEl || !confEl) return;

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

    titleEl.textContent = title;
    levelEl.textContent = `${compactLabel}${loopTag}`;
    msgEl.textContent = level.msg;
    framesEl.textContent = state.frames.toLocaleString();
    detsEl.textContent = state.detections.toLocaleString();
    confEl.textContent = avgConf == null ? "-" : `${(avgConf * 100).toFixed(1)}%`;
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
