/**
 * detection-overlay.js — Draws live vehicle bounding boxes on a canvas
 * overlaid on the public stream. Receives detection data via count:update events
 * dispatched by counter.js. Boxes are color-coded by vehicle class.
 */

const DetectionOverlay = (() => {
  let canvas, ctx, video;

  const CLASS_COLORS = {
    car:        "#29B6F6",  // sky blue
    truck:      "#FF7043",  // orange-red
    bus:        "#AB47BC",  // purple
    motorcycle: "#FFD600",  // yellow (matches zone color)
    vehicle:    "#66BB6A",  // green fallback
  };

  function init(videoEl, canvasEl) {
    video  = videoEl;
    canvas = canvasEl;
    ctx    = canvas.getContext("2d");

    syncSize();
    window.addEventListener("resize", () => { syncSize(); });

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

    const w = canvas.width;
    const h = canvas.height;

    for (const det of detections) {
      const x1 = det.x1 * w;
      const y1 = det.y1 * h;
      const x2 = det.x2 * w;
      const y2 = det.y2 * h;
      const bw = x2 - x1;
      const bh = y2 - y1;
      const color = CLASS_COLORS[det.cls] ?? CLASS_COLORS.vehicle;

      // Box
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(x1, y1, bw, bh);

      // Semi-transparent fill
      ctx.fillStyle = color + "18";  // ~10% opacity
      ctx.fillRect(x1, y1, bw, bh);

      // Label background
      const label = det.cls;
      ctx.font = "bold 10px sans-serif";
      const tw = ctx.measureText(label).width + 6;
      const lx = x1;
      const ly = y1 > 14 ? y1 - 14 : y1 + bh;
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly, tw, 13);

      // Label text
      ctx.fillStyle = "#000";
      ctx.fillText(label, lx + 3, ly + 10);
    }
  }

  return { init };
})();

window.DetectionOverlay = DetectionOverlay;
