/**
 * admin-line.js — Dual zone canvas editor for admin.
 * Two modes toggled by buttons:
 *   - DETECT ZONE (cyan): bounding-box filter zone
 *   - COUNT ZONE (yellow): crossing/counting zone
 * Click 4 points to define each zone as a polygon.
 */

const AdminLine = (() => {
  let canvas, ctx, video;
  let cameraId = null;
  let isSaving = false;

  // Active mode: "detect" | "count"
  let activeMode = "count";

  // Points per zone
  let detectPoints = [];  // [{rx, ry}]
  let countPoints  = [];  // [{rx, ry}]

  function init(videoEl, canvasEl, camId) {
    video    = videoEl;
    canvas   = canvasEl;
    ctx      = canvas.getContext("2d");
    cameraId = camId;

    syncSize();
    window.addEventListener("resize", () => { syncSize(); redraw(); });
    video.addEventListener("loadedmetadata", () => { syncSize(); loadExistingZones(); });

    canvas.addEventListener("click", handleClick);
    document.getElementById("btn-clear-line")?.addEventListener("click", clearActive);
    document.getElementById("btn-save-line")?.addEventListener("click", saveZones);

    // Zone toggle buttons
    document.getElementById("btn-zone-detect")?.addEventListener("click", () => setMode("detect"));
    document.getElementById("btn-zone-count")?.addEventListener("click",  () => setMode("count"));

    if (video.videoWidth) loadExistingZones();
    updateModeUI();
  }

  function setMode(mode) {
    activeMode = mode;
    updateModeUI();
    updateStatus(`Editing: ${mode === "detect" ? "DETECT ZONE (cyan)" : "COUNT ZONE (yellow)"}`);
  }

  function updateModeUI() {
    const btnDetect = document.getElementById("btn-zone-detect");
    const btnCount  = document.getElementById("btn-zone-count");
    if (btnDetect) btnDetect.classList.toggle("active", activeMode === "detect");
    if (btnCount)  btnCount.classList.toggle("active",  activeMode === "count");
  }

  function syncSize() {
    if (!video || !canvas) return;
    canvas.width  = video.clientWidth;
    canvas.height = video.clientHeight;
  }

  async function loadExistingZones() {
    if (!cameraId) return;
    try {
      const { data } = await window.sb
        .from("cameras")
        .select("count_line, detect_zone")
        .eq("id", cameraId)
        .single();

      const countLine  = data?.count_line;
      const detectZone = data?.detect_zone;

      if (countLine?.x3 !== undefined) {
        countPoints = [
          { rx: countLine.x1, ry: countLine.y1 },
          { rx: countLine.x2, ry: countLine.y2 },
          { rx: countLine.x3, ry: countLine.y3 },
          { rx: countLine.x4, ry: countLine.y4 },
        ];
      } else if (countLine?.x1 !== undefined) {
        countPoints = [
          { rx: countLine.x1, ry: countLine.y1 },
          { rx: countLine.x2, ry: countLine.y2 },
        ];
      }

      if (detectZone?.x3 !== undefined) {
        detectPoints = [
          { rx: detectZone.x1, ry: detectZone.y1 },
          { rx: detectZone.x2, ry: detectZone.y2 },
          { rx: detectZone.x3, ry: detectZone.y3 },
          { rx: detectZone.x4, ry: detectZone.y4 },
        ];
      } else if (detectZone?.x1 !== undefined) {
        detectPoints = [
          { rx: detectZone.x1, ry: detectZone.y1 },
          { rx: detectZone.x2, ry: detectZone.y2 },
        ];
      }

      redraw();
      updateStatus("Zones loaded — click to redraw active zone");
    } catch (e) {
      console.warn("[AdminLine] Could not load zones:", e);
    }
  }

  function handleClick(e) {
    const rect  = canvas.getBoundingClientRect();
    const px    = e.clientX - rect.left;
    const py    = e.clientY - rect.top;
    const bounds = getContentBounds(video);
    const { x: rx, y: ry } = pixelToContent(px, py, bounds);

    const pts = activeMode === "detect" ? detectPoints : countPoints;

    if (pts.length >= 4) {
      if (activeMode === "detect") detectPoints = [];
      else countPoints = [];
    }

    if (activeMode === "detect") detectPoints.push({ rx, ry });
    else countPoints.push({ rx, ry });

    redraw();

    const saveBtn = document.getElementById("btn-save-line");
    if ((countPoints.length === 4 || detectPoints.length === 4) && saveBtn) {
      saveBtn.removeAttribute("disabled");
    }
  }

  function toCanvas(rp) {
    const bounds = getContentBounds(video);
    return contentToPixel(rp.rx, rp.ry, bounds);
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw detect zone (cyan)
    if (detectPoints.length > 0) {
      _drawPoints(detectPoints, "#00BCD4", "DETECT ZONE");
    }

    // Draw count zone (yellow)
    if (countPoints.length > 0) {
      _drawPoints(countPoints, "#FFD600", "COUNT ZONE");
    }
  }

  function _drawPoints(pts, color, label) {
    const px = pts.map(toCanvas);

    if (pts.length === 4) {
      ctx.beginPath();
      ctx.moveTo(px[0].x, px[0].y);
      px.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();

      const hex = color === "#00BCD4" ? "rgba(0,188,212,0.1)" : "rgba(255,214,0,0.12)";
      ctx.fillStyle = hex;
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      const cx = px.reduce((s, p) => s + p.x, 0) / 4;
      const cy = px.reduce((s, p) => s + p.y, 0) / 4;
      ctx.font      = "bold 11px sans-serif";
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy);
    } else if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(px[0].x, px[0].y);
      px.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Corner dots
    px.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle   = color;
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

  function clearActive() {
    if (activeMode === "detect") detectPoints = [];
    else countPoints = [];
    redraw();
    updateStatus("Zone cleared");
  }

  async function saveZones() {
    if (isSaving) return;
    isSaving = true;
    updateStatus("Saving...");

    const toRel = (pts) => {
      if (pts.length < 4) return null;
      return {
        x1: pts[0].rx, y1: pts[0].ry,
        x2: pts[1].rx, y2: pts[1].ry,
        x3: pts[2].rx, y3: pts[2].ry,
        x4: pts[3].rx, y4: pts[3].ry,
      };
    };

    const updateData = {};
    if (countPoints.length >= 4) {
      updateData.count_line = toRel(countPoints);
    }
    if (detectPoints.length >= 4) {
      updateData.detect_zone = toRel(detectPoints);
    } else if (detectPoints.length === 0) {
      updateData.detect_zone = null; // clear if empty
    }

    try {
      const { error } = await window.sb
        .from("cameras")
        .update(updateData)
        .eq("id", cameraId);
      if (error) throw error;
      updateStatus("Zones saved ✓ — AI picks up within 30s");
    } catch (e) {
      console.error("[AdminLine] Save failed:", e);
      updateStatus(`Error: ${e.message}`);
    } finally {
      isSaving = false;
    }
  }

  function updateStatus(msg) {
    const el = document.getElementById("line-status");
    if (el) el.textContent = msg;
  }

  return { init, clearActive, saveZones };
})();

window.AdminLine = AdminLine;
