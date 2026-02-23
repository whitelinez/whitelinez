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
  const SETTINGS_KEY = "whitelinez.detection.overlay_settings.v4";
  let pixiApp = null;
  let pixiEnabled = false;
  let isMobileClient = false;
  const pixiGraphicsPool = [];
  const pixiTextPool = [];
  let pixiGraphicsUsed = 0;
  let pixiTextUsed = 0;
  let forceRender = true;
  let lastFrameKey = "";
  let ghostSeq = 0;
  const laneSmoothing = new Map();

  let settings = {
    box_style: "solid",
    line_width: 2,
    fill_alpha: 0.10,
    max_boxes: 10,
    show_labels: true,
    detect_zone_only: true,
    outside_scan_enabled: true,
    outside_scan_min_conf: 0.45,
    outside_scan_max_boxes: 25,
    outside_scan_hold_ms: 220,
    colors: {
      car: "#29B6F6",
      truck: "#FF7043",
      bus: "#AB47BC",
      motorcycle: "#FFD600",
    },
  };
  const outsideGhosts = new Map();

  function detectMobileClient() {
    try {
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      const narrow = window.matchMedia && window.matchMedia("(max-width: 980px)").matches;
      const ua = String(navigator.userAgent || "").toLowerCase();
      const uaMobile = /android|iphone|ipad|ipod|mobile|tablet/.test(ua);
      return Boolean(coarse || narrow || uaMobile);
    } catch {
      return false;
    }
  }

  function hexToPixi(hex) {
    const raw = String(hex || "").replace("#", "");
    const safe = raw.length === 3
      ? raw.split("").map((c) => c + c).join("")
      : raw.padEnd(6, "0").slice(0, 6);
    const n = Number.parseInt(safe, 16);
    return Number.isFinite(n) ? n : 0x66bb6a;
  }

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
    forceRender = true;
  }

  function buildFrameKey(detections) {
    if (!Array.isArray(detections) || detections.length === 0) return "empty";
    const lim = Math.min(detections.length, 80);
    let key = `${lim}|`;
    for (let i = 0; i < lim; i += 1) {
      const d = detections[i] || {};
      key += [
        d.tracker_id ?? -1,
        d.cls || "u",
        Number(d.conf || 0).toFixed(2),
        Number(d.x1 || 0).toFixed(3),
        Number(d.y1 || 0).toFixed(3),
        Number(d.x2 || 0).toFixed(3),
        Number(d.y2 || 0).toFixed(3),
        d.in_detect_zone === false ? "0" : "1",
      ].join(",");
      key += ";";
    }
    return key;
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

  function drawCornerBoxPixi(g, x, y, w, h, colorNum, lineWidth) {
    const c = Math.max(6, Math.min(20, Math.floor(Math.min(w, h) * 0.2)));
    g.lineStyle(lineWidth, colorNum, 1);
    g.moveTo(x, y + c); g.lineTo(x, y); g.lineTo(x + c, y);
    g.moveTo(x + w - c, y); g.lineTo(x + w, y); g.lineTo(x + w, y + c);
    g.moveTo(x + w, y + h - c); g.lineTo(x + w, y + h); g.lineTo(x + w - c, y + h);
    g.moveTo(x + c, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - c);
  }

  function initPixiRenderer() {
    if (!canvas || !window.PIXI) return false;
    const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    const desktopCfg = {
      view: canvas,
      width: Math.max(1, canvas.width || 1),
      height: Math.max(1, canvas.height || 1),
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, dpr),
      powerPreference: "high-performance",
      preference: "webgl",
    };
    const mobileCfg = {
      view: canvas,
      width: Math.max(1, canvas.width || 1),
      height: Math.max(1, canvas.height || 1),
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      resolution: 1,
      powerPreference: "low-power",
      preference: "webgl",
    };
    const tries = isMobileClient ? [mobileCfg, desktopCfg] : [desktopCfg, mobileCfg];
    try {
      for (const cfg of tries) {
        try {
          pixiApp = new window.PIXI.Application(cfg);
          pixiEnabled = true;
          const mode = isMobileClient ? "mobile" : "desktop";
          console.info(`[DetectionOverlay] Renderer: WebGL (PixiJS, ${mode})`);
          window.dispatchEvent(new CustomEvent("detection:renderer", { detail: { mode: "webgl", profile: mode } }));
          return true;
        } catch (e) {
          pixiApp = null;
        }
      }
      return false;
    } catch (err) {
      console.warn("[DetectionOverlay] Pixi init failed, falling back to 2D:", err);
      pixiEnabled = false;
      pixiApp = null;
      return false;
    }
  }

  function beginPixiFrame() {
    pixiGraphicsUsed = 0;
    pixiTextUsed = 0;
  }

  function endPixiFrame() {
    for (let i = pixiGraphicsUsed; i < pixiGraphicsPool.length; i += 1) {
      pixiGraphicsPool[i].visible = false;
    }
    for (let i = pixiTextUsed; i < pixiTextPool.length; i += 1) {
      pixiTextPool[i].visible = false;
    }
  }

  function getPixiGraphic() {
    if (!pixiApp) return null;
    if (pixiGraphicsUsed >= pixiGraphicsPool.length) {
      const g = new window.PIXI.Graphics();
      g.visible = false;
      pixiGraphicsPool.push(g);
      pixiApp.stage.addChild(g);
    }
    const g = pixiGraphicsPool[pixiGraphicsUsed];
    pixiGraphicsUsed += 1;
    g.clear();
    g.visible = true;
    return g;
  }

  function getPixiText() {
    if (!pixiApp) return null;
    if (pixiTextUsed >= pixiTextPool.length) {
      const t = new window.PIXI.Text("", {
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
        fill: 0x0d1118,
      });
      t.visible = false;
      pixiTextPool.push(t);
      pixiApp.stage.addChild(t);
    }
    const t = pixiTextPool[pixiTextUsed];
    pixiTextUsed += 1;
    t.visible = true;
    return t;
  }

  function buildGhostKey(det) {
    const tid = Number(det?.tracker_id);
    if (Number.isFinite(tid) && tid >= 0) return `t:${tid}:${String(det?.cls || "vehicle")}`;
    const x1 = Math.round(Number(det?.x1 || 0) * 100);
    const y1 = Math.round(Number(det?.y1 || 0) * 100);
    const x2 = Math.round(Number(det?.x2 || 0) * 100);
    const y2 = Math.round(Number(det?.y2 || 0) * 100);
    return `b:${String(det?.cls || "vehicle")}:${x1}:${y1}:${x2}:${y2}`;
  }

  function centerOf(det) {
    return {
      x: (Number(det?.x1 || 0) + Number(det?.x2 || 0)) * 0.5,
      y: (Number(det?.y1 || 0) + Number(det?.y2 || 0)) * 0.5,
    };
  }

  function findMatchingGhostKey(det) {
    const target = centerOf(det);
    let bestKey = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [k, v] of outsideGhosts.entries()) {
      const gd = v?.det;
      if (!gd) continue;
      if (String(gd?.cls || "") !== String(det?.cls || "")) continue;
      const c = centerOf(gd);
      const dx = target.x - c.x;
      const dy = target.y - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.08 && dist < bestDist) {
        bestDist = dist;
        bestKey = k;
      }
    }
    return bestKey;
  }

  function smoothLaneDetections(detections, now) {
    const out = [];
    for (const det of detections) {
      const tid = Number(det?.tracker_id);
      if (!Number.isFinite(tid) || tid < 0) {
        out.push(det);
        continue;
      }
      const key = `lane:${tid}:${String(det?.cls || "vehicle")}`;
      const prev = laneSmoothing.get(key);
      if (!prev) {
        laneSmoothing.set(key, {
          x1: det.x1, y1: det.y1, x2: det.x2, y2: det.y2, ts: now,
        });
        out.push(det);
        continue;
      }
      const alpha = 0.42;
      const sm = {
        ...det,
        x1: prev.x1 + (det.x1 - prev.x1) * alpha,
        y1: prev.y1 + (det.y1 - prev.y1) * alpha,
        x2: prev.x2 + (det.x2 - prev.x2) * alpha,
        y2: prev.y2 + (det.y2 - prev.y2) * alpha,
      };
      laneSmoothing.set(key, {
        x1: sm.x1, y1: sm.y1, x2: sm.x2, y2: sm.y2, ts: now,
      });
      out.push(sm);
    }

    for (const [k, v] of laneSmoothing.entries()) {
      if (!v || Number(v.ts || 0) + 1200 < now) laneSmoothing.delete(k);
    }
    return out;
  }

  function drawDetectionBox(det, bounds, opts = {}) {
    if (pixiEnabled && pixiApp) {
      return drawDetectionBoxPixi(det, bounds, opts);
    }
    if (!ctx) return;
    const p1 = contentToPixel(det.x1, det.y1, bounds);
    const p2 = contentToPixel(det.x2, det.y2, bounds);
    const bw = p2.x - p1.x;
    const bh = p2.y - p1.y;
    if (bw < 4 || bh < 4) return;

    const color = opts.color || settings.colors?.[det.cls] || "#66BB6A";
    const lineWidth = Math.max(1, Number(opts.lineWidth ?? settings.line_width) || 1.5);
    const alpha = Math.max(0, Math.min(0.45, Number(opts.alpha ?? settings.fill_alpha) || 0));
    const style = String(opts.style || settings.box_style || "solid");
    const showLabels = opts.showLabels !== false;
    const labelText = opts.labelText;

    ctx.fillStyle = hexToRgba(color, alpha);
    ctx.fillRect(p1.x, p1.y, bw, bh);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (style === "dashed") ctx.setLineDash([8, 4]);
    else ctx.setLineDash([]);
    if (style === "corner") drawCornerBox(p1.x, p1.y, bw, bh, color, lineWidth);
    else ctx.strokeRect(p1.x, p1.y, bw, bh);

    if (showLabels) {
      const defaultConf = Number(det?.conf || 0) > 0 ? ` ${(Number(det.conf) * 100).toFixed(0)}%` : "";
      const label = labelText || `${String(det?.cls || "vehicle").toUpperCase()}${defaultConf}`;
      ctx.setLineDash([]);
      ctx.font = "11px Inter, sans-serif";
      const padX = 6;
      const padY = 4;
      const tw = Math.max(30, Math.ceil(ctx.measureText(label).width + padX * 2));
      const th = 18;
      const lx = p1.x;
      const ly = Math.max(2, p1.y - th - 2);
      ctx.fillStyle = hexToRgba(color, opts.labelBgAlpha ?? 0.85);
      ctx.fillRect(lx, ly, tw, th);
      ctx.fillStyle = opts.labelColor || "#0d1118";
      ctx.fillText(label, lx + padX, ly + th - padY);
    }
  }

  function drawDetectionBoxPixi(det, bounds, opts = {}) {
    const g = getPixiGraphic();
    if (!g) return;
    const p1 = contentToPixel(det.x1, det.y1, bounds);
    const p2 = contentToPixel(det.x2, det.y2, bounds);
    const bw = p2.x - p1.x;
    const bh = p2.y - p1.y;
    if (bw < 4 || bh < 4) {
      g.visible = false;
      return;
    }

    const color = opts.color || settings.colors?.[det.cls] || "#66BB6A";
    const colorNum = hexToPixi(color);
    const lineWidth = Math.max(1, Number(opts.lineWidth ?? settings.line_width) || 1.5);
    const alpha = Math.max(0, Math.min(0.45, Number(opts.alpha ?? settings.fill_alpha) || 0));
    const style = String(opts.style || settings.box_style || "solid");
    const showLabels = opts.showLabels !== false;
    const labelText = opts.labelText;

    g.beginFill(colorNum, alpha);
    g.drawRect(p1.x, p1.y, bw, bh);
    g.endFill();

    if (style === "corner") {
      drawCornerBoxPixi(g, p1.x, p1.y, bw, bh, colorNum, lineWidth);
    } else {
      g.lineStyle(lineWidth, colorNum, 1);
      g.drawRect(p1.x, p1.y, bw, bh);
    }

    if (!showLabels) return;

    const defaultConf = Number(det?.conf || 0) > 0 ? ` ${(Number(det.conf) * 100).toFixed(0)}%` : "";
    const label = labelText || `${String(det?.cls || "vehicle").toUpperCase()}${defaultConf}`;
    const txt = getPixiText();
    if (!txt) return;

    txt.text = label;
    txt.style.fill = hexToPixi(opts.labelColor || "#0d1118");

    const padX = 6;
    const th = 18;
    const tw = Math.max(30, Math.ceil(txt.width + padX * 2));
    const lx = p1.x;
    const ly = Math.max(2, p1.y - th - 2);

    g.beginFill(colorNum, Math.max(0, Math.min(1, Number(opts.labelBgAlpha ?? 0.85))));
    g.drawRect(lx, ly, tw, th);
    g.endFill();

    txt.x = lx + padX;
    txt.y = ly + 2;
  }

  function init(videoEl, canvasEl) {
    video  = videoEl;
    canvas = canvasEl;
    isMobileClient = detectMobileClient();
    loadSettings();

    syncSize();
    if (!initPixiRenderer()) {
      ctx = canvas.getContext("2d");
      pixiEnabled = false;
      console.info("[DetectionOverlay] Renderer: Canvas2D fallback");
      window.dispatchEvent(new CustomEvent("detection:renderer", { detail: { mode: "canvas", profile: isMobileClient ? "mobile" : "desktop" } }));
    }

    window.addEventListener("resize", syncSize);
    video.addEventListener("loadedmetadata", syncSize);

    window.addEventListener("count:update", (e) => {
      latestDetections = e.detail?.detections ?? [];
      const nextKey = buildFrameKey(latestDetections);
      if (nextKey !== lastFrameKey) {
        forceRender = true;
        lastFrameKey = nextKey;
      }
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
    if (!forceRender) return;
    draw(latestDetections);
  }

  function syncSize() {
    if (!video || !canvas) return;
    const prevW = canvas.width;
    const prevH = canvas.height;
    canvas.width  = video.clientWidth;
    canvas.height = video.clientHeight;
    if (pixiEnabled && pixiApp?.renderer) {
      pixiApp.renderer.resize(Math.max(1, canvas.width), Math.max(1, canvas.height));
    }
    if (canvas.width !== prevW || canvas.height !== prevH) {
      forceRender = true;
    }
  }

  function draw(detections) {
    if (!canvas) return;
    if (pixiEnabled) beginPixiFrame();
    else if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    else return;
    if (!detections.length) {
      if (pixiEnabled) endPixiFrame();
      return;
    }

    const bounds = getContentBounds(video);
    const laneHardCap = isMobileClient ? 12 : 15;
    const laneMaxBoxes = Math.max(1, Math.min(laneHardCap, Number(settings.max_boxes) || 10));
    const laneDetections = [];
    const outsideDetections = [];
    for (const det of detections) {
      if (det?.in_detect_zone === false) outsideDetections.push(det);
      else laneDetections.push(det);
    }

    const now = Date.now();
    const smoothedLane = smoothLaneDetections(laneDetections.slice(0, laneMaxBoxes), now);
    for (const det of smoothedLane) {
      drawDetectionBox(det, bounds, {
        style: settings.box_style,
        lineWidth: settings.line_width,
        alpha: settings.fill_alpha,
        showLabels: settings.show_labels !== false,
      });
    }

    if (settings.detect_zone_only || settings.outside_scan_enabled === false) {
      if (pixiEnabled) endPixiFrame();
      return;
    }

    const minConf = Math.max(0, Math.min(1, Number(settings.outside_scan_min_conf) || 0.45));
    const outsideHardCap = isMobileClient ? 24 : 35;
    const outsideMax = Math.max(1, Math.min(outsideHardCap, Number(settings.outside_scan_max_boxes) || 25));
    const holdMs = Math.max(100, Number(settings.outside_scan_hold_ms) || 600);
    const fresh = outsideDetections
      .filter((d) => Number(d?.conf || 0) >= minConf)
      .sort((a, b) => Number(b?.conf || 0) - Number(a?.conf || 0))
      .slice(0, outsideMax);

    for (const det of fresh) {
      const stableKey =
        findMatchingGhostKey(det) ||
        (Number.isFinite(Number(det?.tracker_id)) && Number(det?.tracker_id) >= 0
          ? buildGhostKey(det)
          : `g:${String(det?.cls || "vehicle")}:${ghostSeq++}`);
      outsideGhosts.set(stableKey, { det, exp: now + holdMs });
    }

    for (const [k, v] of outsideGhosts.entries()) {
      if (!v || !v.det || Number(v.exp || 0) < now) outsideGhosts.delete(k);
    }

    const ghosts = Array.from(outsideGhosts.values())
      .sort((a, b) => Number(b.det?.conf || 0) - Number(a.det?.conf || 0))
      .slice(0, outsideMax);

    for (const g of ghosts) {
      drawDetectionBox(g.det, bounds, {
        style: "dashed",
        lineWidth: 1.25,
        alpha: 0.035,
        showLabels: true,
        labelText: "SCAN",
        labelBgAlpha: 0.25,
        labelColor: "#D7E6F5",
      });
    }
    if (pixiEnabled) endPixiFrame();
    forceRender = false;
  }

  return { init };
})();

window.DetectionOverlay = DetectionOverlay;
