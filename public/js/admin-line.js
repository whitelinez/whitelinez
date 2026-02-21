/**
 * admin-line.js — Canvas zone editor for the admin stream.
 * Click 4 points to define a polygon counting zone.
 * Coordinates are stored as content-relative [0,1] (video frame coords),
 * NOT canvas-pixel coords, so they display correctly on any screen size.
 */

const AdminLine = (() => {
  let canvas, ctx, video;
  let points   = [];   // [{rx, ry}] content-relative, max 4
  let cameraId = null;
  let isSaving = false;

  function init(videoEl, canvasEl, camId) {
    video    = videoEl;
    canvas   = canvasEl;
    ctx      = canvas.getContext("2d");
    cameraId = camId;

    syncSize();
    window.addEventListener("resize", () => { syncSize(); redraw(); });
    video.addEventListener("loadedmetadata", () => { syncSize(); loadExistingZone(); });

    canvas.addEventListener("click", handleClick);
    document.getElementById("btn-clear-line")?.addEventListener("click", clearLine);
    document.getElementById("btn-save-line")?.addEventListener("click", saveLine);

    // If video is already loaded (e.g. metadata already fired), load zone immediately
    if (video.videoWidth) loadExistingZone();
  }

  function syncSize() {
    if (!video || !canvas) return;
    canvas.width  = video.clientWidth;
    canvas.height = video.clientHeight;
  }

  async function loadExistingZone() {
    if (!cameraId) return;
    try {
      const { data } = await window.sb
        .from("cameras")
        .select("count_line")
        .eq("id", cameraId)
        .single();
      const line = data?.count_line;
      if (!line) return;

      // Convert stored relative coords back to point array
      if (line.x3 !== undefined) {
        points = [
          { rx: line.x1, ry: line.y1 },
          { rx: line.x2, ry: line.y2 },
          { rx: line.x3, ry: line.y3 },
          { rx: line.x4, ry: line.y4 },
        ];
        document.getElementById("btn-save-line")?.removeAttribute("disabled");
      } else if (line.x1 !== undefined) {
        points = [
          { rx: line.x1, ry: line.y1 },
          { rx: line.x2, ry: line.y2 },
        ];
      }

      redraw();
      const statusEl = document.getElementById("line-status");
      if (statusEl) statusEl.textContent = "Existing zone loaded — click to redraw";
    } catch (e) {
      console.warn("[AdminLine] Could not load existing zone:", e);
    }
  }

  function handleClick(e) {
    const rect  = canvas.getBoundingClientRect();
    const px    = e.clientX - rect.left;
    const py    = e.clientY - rect.top;
    const bounds = getContentBounds(video);
    const { x: rx, y: ry } = pixelToContent(px, py, bounds);

    if (points.length >= 4) {
      points = [];
      document.getElementById("btn-save-line")?.setAttribute("disabled", "true");
    }
    points.push({ rx, ry });
    redraw();

    if (points.length === 4) {
      document.getElementById("btn-save-line")?.removeAttribute("disabled");
    }
  }

  function toCanvas(rp) {
    const bounds = getContentBounds(video);
    return contentToPixel(rp.rx, rp.ry, bounds);
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length === 0) return;

    const px = points.map(toCanvas);

    if (points.length === 4) {
      // Filled polygon
      ctx.beginPath();
      ctx.moveTo(px[0].x, px[0].y);
      px.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle   = "rgba(255,214,0,0.12)";
      ctx.fill();
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth   = 2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const cx = px.reduce((s, p) => s + p.x, 0) / 4;
      const cy = px.reduce((s, p) => s + p.y, 0) / 4;
      ctx.font      = "bold 11px sans-serif";
      ctx.fillStyle = "#FFD600";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("COUNT ZONE", cx, cy);
    } else if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(px[0].x, px[0].y);
      px.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth   = 2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Corner dots numbered 1–4
    px.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle   = "#FFD600";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.font      = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i + 1, p.x, p.y);
    });
  }

  function clearLine() {
    points = [];
    redraw();
    document.getElementById("btn-save-line")?.setAttribute("disabled", "true");
    document.getElementById("line-status").textContent = "Zone cleared";
  }

  async function saveLine() {
    if (points.length < 4 || isSaving) return;
    isSaving = true;

    const statusEl = document.getElementById("line-status");
    if (statusEl) statusEl.textContent = "Saving...";

    // Points are already content-relative — save as-is
    const rel = {
      x1: points[0].rx, y1: points[0].ry,
      x2: points[1].rx, y2: points[1].ry,
      x3: points[2].rx, y3: points[2].ry,
      x4: points[3].rx, y4: points[3].ry,
    };

    try {
      const { error } = await window.sb
        .from("cameras")
        .update({ count_line: rel })
        .eq("id", cameraId);
      if (error) throw error;
      if (statusEl) statusEl.textContent = "Zone saved ✓ — AI picks it up within 30s";
    } catch (e) {
      console.error("[AdminLine] Save failed:", e);
      if (statusEl) statusEl.textContent = `Error: ${e.message}`;
    } finally {
      isSaving = false;
    }
  }

  return { init, clearLine, saveLine };
})();

window.AdminLine = AdminLine;
