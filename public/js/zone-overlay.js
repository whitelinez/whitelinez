/**
 * zone-overlay.js — Read-only canvas overlay showing the admin-defined
 * counting zone on the public live stream.
 * - Coordinates are content-relative [0,1] via coord-utils.js
 * - Flashes the zone border green when vehicles cross/enter
 */

const ZoneOverlay = (() => {
  let canvas, ctx, video;
  let currentLine = null;
  let flashTimer  = null;
  let isFlashing  = false;

  function init(videoEl, canvasEl) {
    video  = videoEl;
    canvas = canvasEl;
    ctx    = canvas.getContext("2d");

    syncSize();
    window.addEventListener("resize", () => { syncSize(); draw(currentLine); });
    video.addEventListener("loadedmetadata", () => { syncSize(); loadAndDraw(); });

    loadAndDraw();
    setInterval(loadAndDraw, 30_000);

    // Flash zone on crossing events from WS
    window.addEventListener("count:update", (e) => {
      const crossings = e.detail?.new_crossings ?? 0;
      if (crossings > 0) flash();
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
        .select("count_line")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      currentLine = data?.count_line ?? null;
      draw(currentLine);
    } catch (e) {
      console.warn("[ZoneOverlay] Failed to load zone:", e);
    }
  }

  function flash() {
    isFlashing = true;
    draw(currentLine, "#00FF88");   // bright green flash
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      isFlashing = false;
      draw(currentLine, "#FFD600"); // back to yellow
    }, 350);
  }

  function draw(line, color = "#FFD600") {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!line) return;

    const bounds = getContentBounds(video);
    const pt = (rx, ry) => contentToPixel(rx, ry, bounds);

    if (line.x3 !== undefined) {
      // 4-point polygon zone
      const pts = [
        pt(line.x1, line.y1),
        pt(line.x2, line.y2),
        pt(line.x3, line.y3),
        pt(line.x4, line.y4),
      ];

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();

      // Fill — brighter on flash
      ctx.fillStyle = isFlashing
        ? "rgba(0,255,136,0.18)"
        : "rgba(255,214,0,0.10)";
      ctx.fill();

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth   = isFlashing ? 3 : 2;
      ctx.setLineDash(isFlashing ? [] : [8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corner dots
      pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      // Label centred in zone
      const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
      const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
      ctx.font         = "bold 11px sans-serif";
      ctx.fillStyle    = color + "DD";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("COUNT ZONE", cx, cy);

    } else if (line.x1 !== undefined) {
      // 2-point count line
      const p1 = pt(line.x1, line.y1);
      const p2 = pt(line.x2, line.y2);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = color;
      ctx.lineWidth   = isFlashing ? 4 : 3;
      ctx.setLineDash(isFlashing ? [] : [10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2 - 10;
      ctx.font         = "bold 11px sans-serif";
      ctx.fillStyle    = color + "DD";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("COUNT LINE", mx, my);
    }
  }

  return { init };
})();

window.ZoneOverlay = ZoneOverlay;
