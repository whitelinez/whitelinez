/**
 * zone-overlay.js - Read-only canvas overlay on the public live stream.
 * Draws count zone and detect zone with confirmed total.
 */

const ZoneOverlay = (() => {
  let canvas, ctx, video;
  let pixiApp = null;
  let pixiEnabled = false;
  let pixiGraphics = null;
  let pixiTexts = [];
  let countLine = null;
  let detectZone = null;
  let latestDetections = [];
  let overlaySettings = {
    ground_overlay_enabled: true,
    ground_occlusion_cutout: 0.38,
  };
  let confirmedTotal = 0;
  let flashTimer = null;
  let isFlashing = false;

  function hexToPixi(hex) {
    const raw = String(hex || "").replace("#", "");
    const safe = raw.length === 3
      ? raw.split("").map((c) => c + c).join("")
      : raw.padEnd(6, "0").slice(0, 6);
    const n = Number.parseInt(safe, 16);
    return Number.isFinite(n) ? n : 0x66bb6a;
  }

  function initPixiRenderer() {
    if (!canvas || !window.PIXI) return false;
    let hasWebGL = false;
    try {
      const probe = document.createElement("canvas");
      hasWebGL = Boolean(
        probe.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
        probe.getContext("webgl", { failIfMajorPerformanceCaveat: true }) ||
        probe.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: true })
      );
    } catch {
      hasWebGL = false;
    }
    if (!hasWebGL) return false;

    try {
      pixiApp = new window.PIXI.Application({
        view: canvas,
        width: Math.max(1, canvas.width || 1),
        height: Math.max(1, canvas.height || 1),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.max(1, window.devicePixelRatio || 1),
        powerPreference: "high-performance",
      });
      pixiGraphics = new window.PIXI.Graphics();
      pixiApp.stage.addChild(pixiGraphics);
      pixiEnabled = true;
      return true;
    } catch {
      pixiApp = null;
      pixiGraphics = null;
      pixiEnabled = false;
      return false;
    }
  }

  function clearPixiTexts() {
    if (!pixiApp || !pixiTexts.length) return;
    for (const t of pixiTexts) {
      try {
        pixiApp.stage.removeChild(t);
        t.destroy();
      } catch {}
    }
    pixiTexts = [];
  }

  function addPixiLabel(text, x, y, color) {
    if (!pixiApp || !text) return;
    const node = new window.PIXI.Text(String(text), {
      fontFamily: "Manrope, sans-serif",
      fontWeight: "700",
      fontSize: 12,
      fill: color,
    });
    node.anchor.set(0.5, 0.5);
    node.x = x;
    node.y = y;
    pixiApp.stage.addChild(node);
    pixiTexts.push(node);
  }

  async function resolveActiveCamera() {
    const { data, error } = await window.sb
      .from("cameras")
      .select("id, ipcam_alias, created_at, count_line, detect_zone, feed_appearance")
      .eq("is_active", true);
    if (error) throw error;
    const cams = Array.isArray(data) ? data : [];
    if (!cams.length) return null;
    const rank = (cam) => {
      const alias = String(cam?.ipcam_alias || "").trim();
      if (!alias) return 0;
      if (alias.toLowerCase() === "your-alias") return 1;
      return 2;
    };
    cams.sort((a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar !== br) return br - ar;
      const at = Date.parse(a?.created_at || 0) || 0;
      const bt = Date.parse(b?.created_at || 0) || 0;
      if (at !== bt) return bt - at;
      return String(b?.id || "").localeCompare(String(a?.id || ""));
    });
    return cams[0] || null;
  }

  function init(videoEl, canvasEl) {
    video = videoEl;
    canvas = canvasEl;

    syncSize();
    if (!initPixiRenderer()) {
      ctx = canvas.getContext("2d");
      pixiEnabled = false;
    }
    window.addEventListener("resize", () => {
      syncSize();
      draw();
    });
    video.addEventListener("loadedmetadata", () => {
      syncSize();
      loadAndDraw();
    });

    loadAndDraw();
    setInterval(loadAndDraw, 30000);

    window.addEventListener("count:update", (e) => {
      const detail = e.detail || {};
      const crossings = detail.new_crossings ?? 0;
      confirmedTotal = Number(detail.confirmed_crossings_total ?? confirmedTotal ?? 0);
      latestDetections = Array.isArray(detail.detections) ? detail.detections : [];
      if (crossings > 0) flash();
      else draw();
    });
  }

  function syncSize() {
    if (!video || !canvas) return;
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    if (pixiEnabled && pixiApp?.renderer) {
      pixiApp.renderer.resize(Math.max(1, canvas.width), Math.max(1, canvas.height));
    }
  }

  async function loadAndDraw() {
    try {
      const cam = await resolveActiveCamera();
      countLine = cam?.count_line ?? null;
      detectZone = cam?.detect_zone ?? null;
      const detOverlay = cam?.feed_appearance?.detection_overlay || {};
      overlaySettings = {
        ...overlaySettings,
        ground_overlay_enabled: detOverlay.ground_overlay_enabled !== false,
        ground_occlusion_cutout: Number(detOverlay.ground_occlusion_cutout ?? overlaySettings.ground_occlusion_cutout),
      };
      draw();
    } catch (e) {
      console.warn("[ZoneOverlay] Failed to load zones:", e);
    }
  }

  function flash() {
    isFlashing = true;
    draw();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      isFlashing = false;
      draw();
    }, 350);
  }

  function draw() {
    if (pixiEnabled && pixiGraphics) {
      drawPixi();
      return;
    }
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bounds = getContentBounds(video);
    const pt = (rx, ry) => contentToPixel(rx, ry, bounds);

    if (detectZone) {
      _drawZone(detectZone, "#00BCD4", false, "", pt);
    }

    if (countLine) {
      const color = isFlashing ? "#00FF88" : "#FFD600";
      _drawZone(countLine, color, isFlashing, String(confirmedTotal), pt);
    }
  }

  function drawPixi() {
    if (!pixiGraphics || !canvas) return;
    pixiGraphics.clear();
    clearPixiTexts();

    const bounds = getContentBounds(video);
    const pt = (rx, ry) => contentToPixel(rx, ry, bounds);

    if (detectZone) {
      _drawZonePixi(detectZone, "#00BCD4", false, "", pt);
    }

    if (countLine) {
      const color = isFlashing ? "#00FF88" : "#FFD600";
      _drawZonePixi(countLine, color, isFlashing, String(confirmedTotal), pt);
    }
  }

  function _toPoints(zone, pt) {
    if (zone && Array.isArray(zone.points) && zone.points.length >= 3) {
      return zone.points
        .filter((p) => p && typeof p.x === "number" && typeof p.y === "number")
        .map((p) => pt(p.x, p.y));
    }
    if (zone && zone.x3 !== undefined) {
      return [
        pt(zone.x1, zone.y1),
        pt(zone.x2, zone.y2),
        pt(zone.x3, zone.y3),
        pt(zone.x4, zone.y4),
      ];
    }
    return null;
  }

  function _drawZone(zone, color, flashing, label, pt) {
    const poly = _toPoints(zone, pt);
    if (poly && poly.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      poly.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.closePath();

      ctx.fillStyle = flashing
        ? "rgba(0,255,136,0.16)"
        : color === "#00BCD4"
          ? "rgba(0,188,212,0.08)"
          : "rgba(255,214,0,0.10)";
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = flashing ? 3 : 2;
      ctx.setLineDash(flashing || color !== "#00BCD4" ? [] : [8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (label) {
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.fillStyle = `${color}DD`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy);
      }
      applyVehicleOcclusion();
      return;
    }

    if (zone && zone.x1 !== undefined) {
      const p1 = pt(zone.x1, zone.y1);
      const p2 = pt(zone.x2, zone.y2);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = flashing ? 4 : 3;
      ctx.setLineDash(flashing ? [] : [10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (label) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2 - 10;
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.fillStyle = `${color}DD`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, mx, my);
      }
      applyVehicleOcclusion();
    }
  }

  function _drawZonePixi(zone, color, flashing, label, pt) {
    const poly = _toPoints(zone, pt);
    const colorNum = hexToPixi(color);
    if (poly && poly.length >= 3) {
      const fillAlpha = flashing
        ? 0.16
        : color === "#00BCD4"
          ? 0.08
          : 0.10;

      pixiGraphics.beginFill(colorNum, fillAlpha);
      pixiGraphics.lineStyle(flashing ? 3 : 2, colorNum, 1);
      pixiGraphics.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i += 1) {
        pixiGraphics.lineTo(poly[i].x, poly[i].y);
      }
      pixiGraphics.lineTo(poly[0].x, poly[0].y);
      pixiGraphics.endFill();

      if (label) {
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        addPixiLabel(label, cx, cy, colorNum);
      }
      return;
    }

    if (zone && zone.x1 !== undefined) {
      const p1 = pt(zone.x1, zone.y1);
      const p2 = pt(zone.x2, zone.y2);
      pixiGraphics.lineStyle(flashing ? 4 : 3, colorNum, 1);
      pixiGraphics.moveTo(p1.x, p1.y);
      pixiGraphics.lineTo(p2.x, p2.y);
      if (label) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2 - 10;
        addPixiLabel(label, mx, my, colorNum);
      }
    }
  }

  function applyVehicleOcclusion() {
    if (!ctx) return;
    if (!Array.isArray(latestDetections) || latestDetections.length === 0) return;
    const bounds = getContentBounds(video);
    const cut = Math.max(0, Math.min(0.85, Number(overlaySettings.ground_occlusion_cutout) || 0.38));
    if (cut <= 0) return;
    for (const det of latestDetections) {
      const dp1 = contentToPixel(det?.x1, det?.y1, bounds);
      const dp2 = contentToPixel(det?.x2, det?.y2, bounds);
      const bw = dp2.x - dp1.x;
      const bh = dp2.y - dp1.y;
      if (bw < 3 || bh < 3) continue;
      const ch = bh * cut;
      const cy = dp2.y - ch;
      ctx.clearRect(dp1.x - 1, cy, bw + 2, ch + 2);
    }
  }

  return { init };
})();

window.ZoneOverlay = ZoneOverlay;
