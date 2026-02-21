/**
 * admin-line.js — Canvas draw tool for defining the vehicle count line.
 * Overlays a <canvas> on the live stream <video>.
 * Saves relative coordinates (0–1) to Supabase cameras table via admin JWT.
 */

const AdminLine = (() => {
  let canvas, ctx, video;
  let points = []; // [{x, y}] in pixel coords — max 4
  let cameraId = null;
  let isSaving = false;

  function init(videoEl, canvasEl, camId) {
    video = videoEl;
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    cameraId = camId;

    syncCanvasSize();
    window.addEventListener("resize", syncCanvasSize);

    canvas.addEventListener("click", handleClick);
    document.getElementById("btn-clear-line")?.addEventListener("click", clearLine);
    document.getElementById("btn-save-line")?.addEventListener("click", saveLine);
  }

  function syncCanvasSize() {
    if (!video || !canvas) return;
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    redraw();
  }

  function handleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (points.length >= 4) {
      points = [];
      document.getElementById("btn-save-line")?.setAttribute("disabled", "true");
    }
    points.push({ x, y });
    redraw();

    if (points.length === 4) {
      document.getElementById("btn-save-line")?.removeAttribute("disabled");
    }
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length === 0) return;

    // Draw filled polygon when all 4 points are set
    if (points.length === 4) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 214, 0, 0.15)";
      ctx.fill();
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (points.length > 1) {
      // Draw partial polygon edges as we go
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw corner dots
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#FFD600";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
      // Label corner number
      ctx.fillStyle = "#000";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i + 1, p.x, p.y);
    }
  }

  function clearLine() {
    points = [];
    redraw();
    document.getElementById("btn-save-line")?.setAttribute("disabled", "true");
    document.getElementById("line-status").textContent = "Line cleared";
  }

  async function saveLine() {
    if (points.length < 4 || isSaving) return;
    isSaving = true;

    const statusEl = document.getElementById("line-status");
    if (statusEl) statusEl.textContent = "Saving...";

    // Convert pixel → relative (0–1)
    const rel = {
      x1: points[0].x / canvas.width,
      y1: points[0].y / canvas.height,
      x2: points[1].x / canvas.width,
      y2: points[1].y / canvas.height,
      x3: points[2].x / canvas.width,
      y3: points[2].y / canvas.height,
      x4: points[3].x / canvas.width,
      y4: points[3].y / canvas.height,
    };

    try {
      const { error } = await window.sb
        .from("cameras")
        .update({ count_line: rel })
        .eq("id", cameraId);

      if (error) throw error;
      if (statusEl) statusEl.textContent = `Zone saved ✓ — AI will pick it up within 30s`;
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
