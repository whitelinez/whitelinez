/**
 * detection-overlay.js — Draws live vehicle bounding boxes on a canvas
 * overlaid on the public stream. Receives detection data via count:update events.
 * Coordinates are content-relative [0,1] and mapped via coord-utils.js,
 * so boxes align correctly regardless of container aspect ratio.
 */

const DetectionOverlay = (() => {
  let canvas, ctx, video;
  let latestDetections = [];
  let rafId = null;
  const SETTINGS_KEY = "whitelinez.detection.overlay_settings.v1";

  let settings = {
    box_style: "solid",
    line_width: 1.5,
    fill_alpha: 0.09,
    max_boxes: 120,
    show_labels: true,
    detect_zone_only: false,
    colors: {
      car: "#29B6F6",
      truck: "#FF7043",
      bus: "#AB47BC",
      motorcycle: "#FFD600",
    },
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      settings = {
        ...settings,
        ...parsed,
        colors: { ...settings.colors, ...(parsed?.colors || {}) },
      };
    } catch {}
  }

  function applySettings(nextSettings) {
    if (!nextSettings || typeof nextSettings !== "object") return;
    settings = {
      ...settings,
      ...nextSettings,
      colors: { ...settings.colors, ...(nextSettings?.colors || {}) },
    };
  }

  function hexToRgba(hex, alpha) {
    const raw = String(hex || "").replace("#", "");
    const safe = raw.length === 3
      ? raw.split("").map((c) => c + c).join("")
      : raw.padEnd(6, "0").slice(0, 6);
    const n = Number.parseInt(safe, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
  }

  function drawCornerBox(x, y, w, h, color, lineWidth) {
    const c = Math.max(6, Math.min(20, Math.floor(Math.min(w, h) * 0.2)));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
    ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
    ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
    ctx.stroke();
  }

  function init(videoEl, canvasEl) {
    video  = videoEl;
    canvas = canvasEl;
    ctx    = canvas.getContext("2d");
    loadSettings();

    syncSize();
    window.addEventListener("resize", syncSize);
    video.addEventListener("loadedmetadata", syncSize);

    window.addEventListener("count:update", (e) => {
      latestDetections = e.detail?.detections ?? [];
      if (!rafId) {
        rafId = requestAnimationFrame(renderFrame);
      }
    });

    window.addEventListener("detection:settings-update", (e) => {
      applySettings(e.detail);
      if (!rafId) rafId = requestAnimationFrame(renderFrame);
    });
  }

  function renderFrame() {
    rafId = null;
    draw(latestDetections);
  }

  function syncSize() {
    if (!video || !canvas) return;
    canvas.width  = video.clientWidth;
    canvas.height = video.clientHeight;
  }

  function draw(detections) {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!detections.length) return;

    const bounds = getContentBounds(video);
    const maxBoxes = Math.max(1, Number(settings.max_boxes) || 120);
    const lineWidth = Math.max(1, Number(settings.line_width) || 1.5);
    const style = String(settings.box_style || "solid");
    const showLabels = settings.show_labels !== false;
    const alpha = Math.max(0, Math.min(0.45, Number(settings.fill_alpha) || 0));

    for (const det of detections.slice(0, maxBoxes)) {
      if (settings.detect_zone_only && det?.in_detect_zone === false) continue;
      const p1 = contentToPixel(det.x1, det.y1, bounds);
      const p2 = contentToPixel(det.x2, det.y2, bounds);
      const bw = p2.x - p1.x;
      const bh = p2.y - p1.y;
      const color = settings.colors?.[det.cls] ?? "#66BB6A";

      // Skip degenerate boxes
      if (bw < 4 || bh < 4) continue;

      // Semi-transparent fill
      ctx.fillStyle = hexToRgba(color, alpha);
      ctx.fillRect(p1.x, p1.y, bw, bh);

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (style === "dashed") ctx.setLineDash([8, 4]);
      else ctx.setLineDash([]);
      if (style === "corner") drawCornerBox(p1.x, p1.y, bw, bh, color, lineWidth);
      else ctx.strokeRect(p1.x, p1.y, bw, bh);

      if (showLabels) {
        const confPct = Number(det?.conf || 0) > 0 ? ` ${(Number(det.conf) * 100).toFixed(0)}%` : "";
        const label = `${String(det?.cls || "vehicle").toUpperCase()}${confPct}`;
        ctx.setLineDash([]);
        ctx.font = "11px Inter, sans-serif";
        const padX = 6;
        const padY = 4;
        const tw = Math.max(30, Math.ceil(ctx.measureText(label).width + padX * 2));
        const th = 18;
        const lx = p1.x;
        const ly = Math.max(2, p1.y - th - 2);
        ctx.fillStyle = hexToRgba(color, 0.85);
        ctx.fillRect(lx, ly, tw, th);
        ctx.fillStyle = "#0d1118";
        ctx.fillText(label, lx + padX, ly + th - padY);
      }

      // Keep overlay lightweight: box-only rendering reduces jitter on slower devices.
    }
  }

  return { init };
})();

window.DetectionOverlay = DetectionOverlay;
