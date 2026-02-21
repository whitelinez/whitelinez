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

  const CLASS_COLORS = {
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
      latestDetections = e.detail?.detections ?? [];
      if (!rafId) {
        rafId = requestAnimationFrame(renderFrame);
      }
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

    for (const det of detections) {
      const p1 = contentToPixel(det.x1, det.y1, bounds);
      const p2 = contentToPixel(det.x2, det.y2, bounds);
      const bw = p2.x - p1.x;
      const bh = p2.y - p1.y;
      const color = CLASS_COLORS[det.cls] ?? "#66BB6A";

      // Skip degenerate boxes
      if (bw < 4 || bh < 4) continue;

      // Semi-transparent fill
      ctx.fillStyle = color + "18";
      ctx.fillRect(p1.x, p1.y, bw, bh);

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(p1.x, p1.y, bw, bh);

      // Keep overlay lightweight: box-only rendering reduces jitter on slower devices.
    }
  }

  return { init };
})();

window.DetectionOverlay = DetectionOverlay;
