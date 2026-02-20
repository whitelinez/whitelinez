/**
 * admin-line.js — Canvas draw tool for defining the vehicle count line.
 * Overlays a <canvas> on the live stream <video>.
 * Saves relative coordinates (0–1) to Supabase cameras table via admin JWT.
 */

const AdminLine = (() => {
  let canvas, ctx, video;
  let points = []; // [{x, y}] in pixel coords — max 2
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

    if (points.length >= 2) {
      points = [];
    }
    points.push({ x, y });
    redraw();

    if (points.length === 2) {
      document.getElementById("btn-save-line")?.removeAttribute("disabled");
    }
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (points.length === 0) return;

    // Draw dot(s)
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#FFD600";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw line between two points
    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Direction arrow
      drawArrow(points[0], points[1]);
    }
  }

  function drawArrow(from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const len = 16;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(
      midX - len * Math.cos(angle - Math.PI / 6),
      midY - len * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(midX, midY);
    ctx.lineTo(
      midX - len * Math.cos(angle + Math.PI / 6),
      midY - len * Math.sin(angle + Math.PI / 6)
    );
    ctx.strokeStyle = "#FFD600";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function clearLine() {
    points = [];
    redraw();
    document.getElementById("btn-save-line")?.setAttribute("disabled", "true");
    document.getElementById("line-status").textContent = "Line cleared";
  }

  async function saveLine() {
    if (points.length < 2 || isSaving) return;
    isSaving = true;

    const statusEl = document.getElementById("line-status");
    if (statusEl) statusEl.textContent = "Saving...";

    // Convert pixel → relative (0–1)
    const rel = {
      x1: points[0].x / canvas.width,
      y1: points[0].y / canvas.height,
      x2: points[1].x / canvas.width,
      y2: points[1].y / canvas.height,
    };

    try {
      const { error } = await window.sb
        .from("cameras")
        .update({ count_line: rel })
        .eq("id", cameraId);

      if (error) throw error;
      if (statusEl) statusEl.textContent = `Line saved ✓ — AI will pick it up within 30s`;
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
