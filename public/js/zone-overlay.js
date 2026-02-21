/**
 * zone-overlay.js — Read-only canvas overlay on the public live stream.
 * Draws:
 *   - Count zone (yellow) — vehicles crossing this are counted
 *   - Detect zone (cyan, dashed) — bounding boxes visible only here
 * Flashes count zone on crossing events.
 */

const ZoneOverlay = (() => {
  let canvas, ctx, video;
  let countLine = null;
  let detectZone = null;
  let confirmedTotal = 0;
  let flashTimer = null;
  let isFlashing = false;

  function init(videoEl, canvasEl) {
    video  = videoEl;
    canvas = canvasEl;
    ctx    = canvas.getContext("2d");

    syncSize();
    window.addEventListener("resize", () => { syncSize(); draw(); });
    video.addEventListener("loadedmetadata", () => { syncSize(); loadAndDraw(); });

    loadAndDraw();
    setInterval(loadAndDraw, 30_000);

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
    canvas.width  = video.clientWidth;
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
      countLine  = data?.count_line  ?? null;
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

    // Draw detect zone (cyan, always dashed)
    if (detectZone) {
      _drawZone(detectZone, "#00BCD4", false, "DETECT ZONE", pt);
    }

    // Draw count zone (yellow, flashes green on crossing)
    if (countLine) {
      const color = isFlashing ? "#00FF88" : "#FFD600";
      _drawZone(countLine, color, isFlashing, String(confirmedTotal), pt);
    }
  }

  function _drawZone(zone, color, flashing, label, pt) {
    if (zone.x3 !== undefined) {
      // 4-point polygon
      const pts = [
        pt(zone.x1, zone.y1),
        pt(zone.x2, zone.y2),
        pt(zone.x3, zone.y3),
        pt(zone.x4, zone.y4),
      ];

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();

      ctx.fillStyle = flashing
        ? "rgba(0,255,136,0.18)"
        : color === "#00BCD4"
          ? "rgba(0,188,212,0.08)"
          : "rgba(255,214,0,0.10)";
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth   = flashing ? 3 : 2;
      ctx.setLineDash(flashing ? [] : [8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
      const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
      ctx.font         = "bold 10px sans-serif";
      ctx.fillStyle    = color + "DD";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy);

    } else if (zone.x1 !== undefined) {
      // 2-point line
      const p1 = pt(zone.x1, zone.y1);
      const p2 = pt(zone.x2, zone.y2);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = color;
      ctx.lineWidth   = flashing ? 4 : 3;
      ctx.setLineDash(flashing ? [] : [10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2 - 10;
      ctx.font         = "bold 10px sans-serif";
      ctx.fillStyle    = color + "DD";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, mx, my);
    }
  }

  return { init };
})();

window.ZoneOverlay = ZoneOverlay;
