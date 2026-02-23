/**
 * admin-night-profile.js
 * Admin controls for runtime night tracking profile.
 */

(function () {
  const PRESETS = {
    conservative: {
      yolo_conf: 0.36,
      infer_size: 576,
      iou: 0.50,
      max_det: 90,
    },
    aggressive: {
      yolo_conf: 0.24,
      infer_size: 768,
      iou: 0.42,
      max_det: 150,
    },
  };

  function el(id) {
    return document.getElementById(id);
  }

  async function getJwt() {
    const session = await window.Auth?.getSession?.();
    return session?.access_token || null;
  }

  function setMsg(text, ok) {
    const msg = el("night-profile-msg");
    if (!msg) return;
    msg.textContent = text || "";
    if (!text) return;
    msg.style.color = ok ? "var(--green)" : "var(--red)";
  }

  function fillForm(s) {
    if (!s) return;
    if (el("night-profile-enabled")) el("night-profile-enabled").value = s.enabled ? "1" : "0";
    if (el("night-start-hour")) el("night-start-hour").value = Number(s.start_hour ?? 18);
    if (el("night-end-hour")) el("night-end-hour").value = Number(s.end_hour ?? 6);
    if (el("night-yolo-conf")) el("night-yolo-conf").value = Number(s.yolo_conf ?? 0.30);
    if (el("night-infer-size")) el("night-infer-size").value = Number(s.infer_size ?? 640);
    if (el("night-iou")) el("night-iou").value = Number(s.iou ?? 0.45);
    if (el("night-max-det")) el("night-max-det").value = Number(s.max_det ?? 120);
    detectModeFromFields();
  }

  function detectModeFromFields() {
    const modeEl = el("night-profile-mode");
    if (!modeEl) return;
    const conf = Number(el("night-yolo-conf")?.value || 0);
    const infer = Number(el("night-infer-size")?.value || 0);
    const iou = Number(el("night-iou")?.value || 0);
    const maxDet = Number(el("night-max-det")?.value || 0);
    const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;
    if (
      eq(conf, PRESETS.aggressive.yolo_conf) &&
      eq(infer, PRESETS.aggressive.infer_size) &&
      eq(iou, PRESETS.aggressive.iou) &&
      eq(maxDet, PRESETS.aggressive.max_det)
    ) {
      modeEl.value = "aggressive";
      return;
    }
    modeEl.value = "conservative";
  }

  function applyPreset() {
    const mode = String(el("night-profile-mode")?.value || "conservative");
    const preset = PRESETS[mode] || PRESETS.conservative;
    if (el("night-yolo-conf")) el("night-yolo-conf").value = preset.yolo_conf;
    if (el("night-infer-size")) el("night-infer-size").value = preset.infer_size;
    if (el("night-iou")) el("night-iou").value = preset.iou;
    if (el("night-max-det")) el("night-max-det").value = preset.max_det;
    setMsg(`${mode[0].toUpperCase() + mode.slice(1)} preset applied. Click Save to activate.`, true);
  }

  async function loadSettings() {
    const btn = el("btn-save-night-profile");
    if (!btn) return;
    const jwt = await getJwt();
    if (!jwt) return;
    try {
      setMsg("Loading...", true);
      const res = await fetch("/api/admin/ml-night-profile", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.detail || "Failed to load");
      fillForm(payload);
      setMsg("Loaded", true);
      setTimeout(() => setMsg("", true), 1200);
    } catch (e) {
      setMsg(e?.message || "Failed to load", false);
    }
  }

  async function saveSettings() {
    const jwt = await getJwt();
    if (!jwt) {
      setMsg("Missing admin session", false);
      return;
    }
    try {
      setMsg("Saving...", true);
      const body = {
        enabled: Number(el("night-profile-enabled")?.value || 0) === 1,
        start_hour: Number(el("night-start-hour")?.value || 18),
        end_hour: Number(el("night-end-hour")?.value || 6),
        yolo_conf: Number(el("night-yolo-conf")?.value || 0.30),
        infer_size: Number(el("night-infer-size")?.value || 640),
        iou: Number(el("night-iou")?.value || 0.45),
        max_det: Number(el("night-max-det")?.value || 120),
      };
      const res = await fetch("/api/admin/ml-night-profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.detail || "Failed to save");
      fillForm(payload?.settings || body);
      setMsg("Saved. Applied immediately.", true);
    } catch (e) {
      setMsg(e?.message || "Failed to save", false);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = el("btn-save-night-profile");
    const presetBtn = el("btn-apply-night-preset");
    if (!btn) return;
    if (presetBtn) presetBtn.addEventListener("click", applyPreset);
    ["night-yolo-conf", "night-infer-size", "night-iou", "night-max-det"].forEach((id) => {
      el(id)?.addEventListener("input", detectModeFromFields);
      el(id)?.addEventListener("change", detectModeFromFields);
    });
    btn.addEventListener("click", saveSettings);
    loadSettings();
  });
})();
