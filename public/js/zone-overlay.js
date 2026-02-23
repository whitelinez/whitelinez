/**
 * zone-overlay.js - Read-only canvas overlay on the public live stream.
 * Draws count zone and detect zone with confirmed total.
 */

const ZoneOverlay = (() => {
  let canvas, ctx, video;
  let countLine = null;
  let detectZone = null;
  let confirmedTotal = 0;
  let flashTimer = null;
  let isFlashing = false;

  async function resolveActiveCamera() {
    const { data, error } = await window.sb
      .from("cameras")
      .select("id, ipcam_alias, created_at, count_line, detect_zone")
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
      const cam = await resolveActiveCamera();
      countLine = cam?.count_line ?? null;
      detectZone = cam?.detect_zone ?? null;
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

      poly.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      if (label) {
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.fillStyle = `${color}DD`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy);
      }
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
    }
  }

  return { init };
})();

window.ZoneOverlay = ZoneOverlay;
