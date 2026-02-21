/**
 * detection-overlay.js — Draws live vehicle bounding boxes on a canvas
 * overlaid on the public stream. Receives detection data via count:update events.
 * Coordinates are content-relative [0,1] and mapped via coord-utils.js,
 * so boxes align correctly regardless of container aspect ratio.
 */

const DetectionOverlay = (() => {
  let canvas, ctx, video;

  const CLASS_COLORS = {
    person:     "#7DD3FC",   // light cyan
    car:        "#29B6F6",   // sky blue
    truck:      "#FF7043",   // orange-red
    bus:        "#AB47BC",   // purple
    motorcycle: "#FFD600",   // yellow
  };

  function init(videoEl, canvasEl) {
    video  = videoEl;
    canvas = canvasEl;
    ctx    = canvas.getContext("2d");

    syncSize();
    window.addEventListener("resize", syncSize);
    video.addEventListener("loadedmetadata", syncSize);

    window.addEventListener("count:update", (e) => {
      draw(e.detail?.detections ?? []);
    });
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

    for (const det of detections) {
      const p1 = contentToPixel(det.x1, det.y1, bounds);
      const p2 = contentToPixel(det.x2, det.y2, bounds);
      const bw = p2.x - p1.x;
      const bh = p2.y - p1.y;
      const color = CLASS_COLORS[det.cls] ?? "#66BB6A";

      // Skip degenerate boxes
      if (bw < 4 || bh < 4) continue;

      // Semi-transparent fill with subtle glow
      ctx.save();
      ctx.shadowColor = color + "55";
      ctx.shadowBlur = 8;
      _roundRect(p1.x, p1.y, bw, bh, 5);
      ctx.fillStyle = color + "1C";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();

      // Corner accents for a cleaner look
      const c = 7;
      _corner(p1.x, p1.y, c, color, "tl");
      _corner(p2.x, p1.y, c, color, "tr");
      _corner(p1.x, p2.y, c, color, "bl");
      _corner(p2.x, p2.y, c, color, "br");

      // Label chip above box (or below if too close to top)
      ctx.font = "600 10px system-ui, sans-serif";
      const tw = ctx.measureText(det.cls).width + 12;
      const lx = p1.x;
      const ly = p1.y > 18 ? p1.y - 17 : p1.y + bh + 3;
      _roundRect(lx, ly, tw, 14, 4);
      ctx.fillStyle = "rgba(8,10,14,0.9)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(det.cls, lx + 6, ly + 10.2);
    }
  }

  function _roundRect(x, y, w, h, r = 4) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function _corner(x, y, len, color, pos) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (pos === "tl") { ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); }
    if (pos === "tr") { ctx.moveTo(x - len, y); ctx.lineTo(x, y); ctx.lineTo(x, y + len); }
    if (pos === "bl") { ctx.moveTo(x, y - len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); }
    if (pos === "br") { ctx.moveTo(x - len, y); ctx.lineTo(x, y); ctx.lineTo(x, y - len); }
    ctx.stroke();
    ctx.restore();
  }

  return { init };
})();

window.DetectionOverlay = DetectionOverlay;
