/**
 * zone-overlay.js - Read-only canvas overlay on the public live stream.
 * Draws count zone and (optionally) detect zone shape, with live confirmed total.
 */

const ZoneOverlay = (() => {
  let canvas, ctx, video;
  let countLine = null;
  let detectZone = null;
  let confirmedTotal = 0;
  let flashTimer = null;
  let isFlashing = false;

  function init(videoEl, canvasEl) {
    video = videoEl;
    canvas = canvasEl;
    ctx = canvas.getContext("2d");

    syncSize();
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
      if (crossings > 0) flash();
      else draw();
    });
  }

  function syncSize() {
    if (!video || !canvas) return;
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
  }

  async function loadAndDraw() {
    try {
      const { data } = await window.sb
        .from("cameras")
        .select("count_line, detect_zone")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      countLine = data?.count_line ?? null;
      detectZone = data?.detect_zone ?? null;
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

  function _drawZone(zone, color, flashing, label, pt) {
    if (zone.x3 !== undefined) {
      const pts = [
        pt(zone.x1, zone.y1),
        pt(zone.x2, zone.y2),
        pt(zone.x3, zone.y3),
        pt(zone.x4, zone.y4),
      ];

      const ys = pts.map((p) => p.y);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const polyFill = ctx.createLinearGradient(0, minY, 0, maxY);
      if (flashing) {
        polyFill.addColorStop(0, "rgba(0,255,136,0.08)");
        polyFill.addColorStop(1, "rgba(0,255,136,0.24)");
      } else if (color === "#00BCD4") {
        polyFill.addColorStop(0, "rgba(0,188,212,0.05)");
        polyFill.addColorStop(1, "rgba(0,188,212,0.16)");
      } else {
        polyFill.addColorStop(0, "rgba(255,214,0,0.06)");
        polyFill.addColorStop(1, "rgba(255,214,0,0.20)");
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = polyFill;
      ctx.fill();

      // Depth edge shadow
      ctx.shadowColor = flashing ? "rgba(0,255,136,0.45)" : rgba(color, 0.34);
      ctx.shadowBlur = flashing ? 18 : 12;
      ctx.shadowOffsetY = 1;
      ctx.strokeStyle = rgba(color, 0.35);
      ctx.lineWidth = flashing ? 7 : 6;
      ctx.setLineDash([]);
      ctx.stroke();

      // Sharp top stroke
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = color;
      ctx.lineWidth = flashing ? 3 : 2.2;
      ctx.setLineDash(flashing ? [] : (color === "#00BCD4" ? [8, 5] : [10, 4]));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      pts.forEach((p) => drawCornerNode(p, color, flashing));

      if (label) {
        const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textW = Math.ceil(ctx.measureText(label).width);
        const chipW = textW + 14;
        const chipH = 20;
        const rx = cx - chipW / 2;
        const ry = cy - chipH / 2;
        roundRect(rx, ry, chipW, chipH, 7);
        ctx.fillStyle = "rgba(7,12,20,0.55)";
        ctx.fill();
        ctx.strokeStyle = rgba(color, 0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(label, cx, cy);
      }
    } else if (zone.x1 !== undefined) {
      const p1 = pt(zone.x1, zone.y1);
      const p2 = pt(zone.x2, zone.y2);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.shadowColor = flashing ? "rgba(0,255,136,0.45)" : rgba(color, 0.34);
      ctx.shadowBlur = flashing ? 16 : 10;
      ctx.strokeStyle = rgba(color, 0.35);
      ctx.lineWidth = flashing ? 7 : 6;
      ctx.setLineDash([]);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = color;
      ctx.lineWidth = flashing ? 4 : 3;
      ctx.setLineDash(flashing ? [] : [10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      drawCornerNode(p1, color, flashing);
      drawCornerNode(p2, color, flashing);

      if (label) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2 - 10;
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textW = Math.ceil(ctx.measureText(label).width);
        const chipW = textW + 14;
        const chipH = 20;
        const rx = mx - chipW / 2;
        const ry = my - chipH / 2;
        roundRect(rx, ry, chipW, chipH, 7);
        ctx.fillStyle = "rgba(7,12,20,0.55)";
        ctx.fill();
        ctx.strokeStyle = rgba(color, 0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(label, mx, my);
      }
    }
  }

  function drawCornerNode(p, color, flashing) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, flashing ? 5.6 : 5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.26);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.85);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = "#EAFBFF";
    ctx.fill();
    ctx.restore();
  }

  function rgba(hex, alpha) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  return { init };
})();

window.ZoneOverlay = ZoneOverlay;
