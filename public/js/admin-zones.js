/**
 * admin-zones.js — Analytics Zone Editor
 * Draws named polygon zones over a live camera frame.
 * Zone types: queue | entry | exit | speed_a | speed_b | roi
 * Zones are stored in the camera_zones Supabase table via /api/analytics/data?type=zones.
 */

const AdminZones = (() => {
  // ── Zone type config ───────────────────────────────────────────────────────
  const ZONE_CONFIG = {
    queue:   { color: "#FF9800", label: "Queue / Stop-line",  desc: "Polygon covering the queue area near the stop line. Measures how many vehicles are waiting at any given moment." },
    entry:   { color: "#4CAF50", label: "Entry Approach",      desc: "Polygon over an approach road. Records when a vehicle enters this leg (combined with an Exit zone to form turning movements)." },
    exit:    { color: "#F44336", label: "Exit Lane",            desc: "Polygon over an exit road. When a vehicle leaves through this zone after entering a different zone, a turning movement is recorded." },
    speed_a: { color: "#00BCD4", label: "Speed Trap — Line A", desc: "First speed measurement line. Draw near the start of the measurement distance. Set the real-world distance to Line B in metres." },
    speed_b: { color: "#009688", label: "Speed Trap — Line B", desc: "Second speed measurement line. Vehicle speed is computed as distance ÷ time between Line A and Line B crossings." },
    roi:     { color: "#AB47BC", label: "Region of Interest",  desc: "General occupancy zone. Counts how many vehicles are inside this area at each snapshot interval." },
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let bgCanvas, drawCanvas, bgCtx, drawCtx;
  let cameraId   = null;
  let frameImg   = null;   // ImageBitmap of captured frame
  let savedZones = [];     // zones loaded from API [{id,name,zone_type,points,metadata,color}]
  let draftZones = [];     // newly drawn zones not yet saved
  let drawing    = false;  // true while placing vertices
  let draftPts   = [];     // [{rx,ry}] current in-progress polygon (normalized 0-1)
  let rafId      = null;
  let isInitialized = false;

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (isInitialized) return;
    isInitialized = true;

    bgCanvas   = document.getElementById("az-bg-canvas");
    drawCanvas = document.getElementById("az-draw-canvas");
    if (!bgCanvas || !drawCanvas) return;

    bgCtx   = bgCanvas.getContext("2d");
    drawCtx = drawCanvas.getContext("2d");

    // Zone type → show/hide speed distance, update legend
    document.getElementById("az-zone-type")?.addEventListener("change", updateTypeUI);
    updateTypeUI();

    // Draw button
    document.getElementById("az-draw-btn")?.addEventListener("click", startDraw);

    // Canvas clicks for polygon placement
    drawCanvas.addEventListener("click", handleCanvasClick);
    drawCanvas.addEventListener("mousemove", handleMouseMove);

    // Undo / cancel
    document.getElementById("az-undo-btn")?.addEventListener("click", undoPoint);
    document.getElementById("az-cancel-btn")?.addEventListener("click", cancelDraw);

    // Save
    document.getElementById("az-save-btn")?.addEventListener("click", saveZones);

    // Keyboard
    document.addEventListener("keydown", e => {
      if (document.getElementById("panel-analytics-zones")?.classList.contains("active")) {
        if (e.key === "Enter" && drawing && draftPts.length >= 3) closePoly();
        if (e.key === "Escape") cancelDraw();
        if ((e.key === "z" || e.key === "Z") && e.ctrlKey) undoPoint();
      }
    });

    // Resize
    window.addEventListener("resize", () => { resizeCanvas(); renderAll(); });

    resizeCanvas();
    startRaf();
  }

  // ── Start with a known camera ID (called from admin-init after resolving active cam) ──
  async function start(camId) {
    if (!camId) return;
    cameraId = camId;

    // Update hidden input (kept for any legacy reads) + label
    const hiddenSel = document.getElementById("az-camera-select");
    if (hiddenSel) hiddenSel.value = camId;

    // Resolve camera name for display
    const lbl = document.getElementById("az-cam-label");
    if (lbl) {
      try {
        const { data } = await window.sb
          .from("cameras")
          .select("name,alias")
          .eq("id", camId)
          .maybeSingle();
        lbl.textContent = data?.name || data?.alias || camId;
      } catch (_) {
        lbl.textContent = camId;
      }
    }

    // Enable draw button and kick off frame + zones load
    document.getElementById("az-draw-btn")?.removeAttribute("disabled");
    savedZones = [];
    draftZones = [];
    cancelDraw();
    captureFrame();
    loadZones();
  }

  // ── Frame capture ──────────────────────────────────────────────────────────
  function captureFrame() {
    const adminVideo = document.getElementById("admin-video");
    if (!adminVideo || !adminVideo.videoWidth) {
      setMsg("Waiting for stream…");
      setTimeout(captureFrame, 1000);
      return;
    }
    setMsg("");
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width  = adminVideo.videoWidth;
    tmpCanvas.height = adminVideo.videoHeight;
    tmpCanvas.getContext("2d").drawImage(adminVideo, 0, 0);
    createImageBitmap(tmpCanvas).then(bmp => {
      frameImg = bmp;
      resizeCanvas();
      renderAll();
    });
  }

  // ── Canvas sizing ──────────────────────────────────────────────────────────
  function resizeCanvas() {
    const wrap = document.getElementById("az-canvas-wrap");
    if (!wrap || !bgCanvas) return;
    const w = wrap.clientWidth;
    const h = frameImg
      ? Math.round(w * (frameImg.height / frameImg.width))
      : Math.round(w * (9 / 16));
    bgCanvas.width   = w;
    bgCanvas.height  = h;
    drawCanvas.width  = w;
    drawCanvas.height = h;
    wrap.style.height = h + "px";
  }

  // ── Render loop ────────────────────────────────────────────────────────────
  function startRaf() {
    const loop = () => { renderAll(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
  }

  function renderAll() {
    if (!bgCtx || !drawCtx) return;
    const W = bgCanvas.width, H = bgCanvas.height;

    // Background
    bgCtx.clearRect(0, 0, W, H);
    if (frameImg) {
      bgCtx.drawImage(frameImg, 0, 0, W, H);
    } else {
      bgCtx.fillStyle = "#080C14";
      bgCtx.fillRect(0, 0, W, H);
    }

    drawCtx.clearRect(0, 0, W, H);

    // Saved zones (filled polygons)
    for (const z of savedZones) {
      drawZonePoly(z.points, ZONE_CONFIG[z.zone_type]?.color || "#FFB800", z.name, 0.22, false);
    }

    // Draft zones
    for (const z of draftZones) {
      drawZonePoly(z.points, ZONE_CONFIG[z.zone_type]?.color || "#FFB800", z.name, 0.28, true);
    }

    // In-progress polygon
    if (drawing && draftPts.length > 0) {
      const color = ZONE_CONFIG[getZoneType()]?.color || "#FFB800";
      drawCtx.save();
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = 2;
      drawCtx.setLineDash([6, 3]);
      drawCtx.beginPath();
      draftPts.forEach((p, i) => {
        const [x, y] = toPixel(p.rx, p.ry);
        if (i === 0) drawCtx.moveTo(x, y); else drawCtx.lineTo(x, y);
      });
      drawCtx.stroke();
      drawCtx.setLineDash([]);
      // Vertices
      draftPts.forEach((p, i) => {
        const [x, y] = toPixel(p.rx, p.ry);
        drawCtx.beginPath();
        drawCtx.arc(x, y, i === 0 ? 7 : 5, 0, Math.PI * 2);
        drawCtx.fillStyle = i === 0 ? "#fff" : color;
        drawCtx.fill();
        drawCtx.strokeStyle = color;
        drawCtx.lineWidth = 1.5;
        drawCtx.stroke();
      });
      drawCtx.restore();
    }
  }

  function drawZonePoly(points, color, label, alpha, isDraft) {
    if (!points || points.length < 3) return;
    const W = drawCanvas.width, H = drawCanvas.height;
    drawCtx.save();
    drawCtx.beginPath();
    points.forEach((p, i) => {
      const x = p.x * W, y = p.y * H;
      if (i === 0) drawCtx.moveTo(x, y); else drawCtx.lineTo(x, y);
    });
    drawCtx.closePath();
    drawCtx.fillStyle = hexAlpha(color, alpha);
    drawCtx.fill();
    drawCtx.strokeStyle = color;
    drawCtx.lineWidth = isDraft ? 2 : 1.5;
    if (isDraft) drawCtx.setLineDash([5, 3]);
    drawCtx.stroke();
    drawCtx.setLineDash([]);
    // Label
    if (label) {
      const cx = points.reduce((s, p) => s + p.x * W, 0) / points.length;
      const cy = points.reduce((s, p) => s + p.y * H, 0) / points.length;
      drawCtx.font = "bold 11px 'JetBrains Mono', monospace";
      drawCtx.textAlign = "center";
      drawCtx.textBaseline = "middle";
      const tw = drawCtx.measureText(label).width;
      drawCtx.fillStyle = "rgba(0,0,0,0.65)";
      drawCtx.fillRect(cx - tw / 2 - 5, cy - 9, tw + 10, 18);
      drawCtx.fillStyle = color;
      drawCtx.fillText(label, cx, cy);
    }
    drawCtx.restore();
  }

  // ── Drawing interaction ────────────────────────────────────────────────────
  function startDraw() {
    if (!cameraId) return;
    const name = document.getElementById("az-zone-name")?.value.trim();
    if (!name) { setStatus("Enter a zone name first.", true); return; }
    drawing  = true;
    draftPts = [];
    document.getElementById("az-draft-card").style.display = "";
    document.getElementById("az-undo-btn").removeAttribute("disabled");
    document.getElementById("az-cancel-btn").removeAttribute("disabled");
    document.getElementById("az-draw-btn").setAttribute("disabled", "");
    setHint("Click to place vertices — click near first point (or press Enter) to close polygon");
    updateDraftInfo();
  }

  function handleCanvasClick(e) {
    if (!drawing) return;
    const rect = drawCanvas.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / drawCanvas.width;
    const ry = (e.clientY - rect.top)  / drawCanvas.height;
    // Check if click is near first point (close polygon)
    if (draftPts.length >= 3) {
      const [fx, fy] = toPixel(draftPts[0].rx, draftPts[0].ry);
      const dist = Math.hypot(e.clientX - rect.left - fx, e.clientY - rect.top - fy);
      if (dist < 14) { closePoly(); return; }
    }
    draftPts.push({ rx, ry });
    updateDraftInfo();
  }

  let _mouseX = -1, _mouseY = -1;
  function handleMouseMove(e) {
    const rect = drawCanvas.getBoundingClientRect();
    _mouseX = e.clientX - rect.left;
    _mouseY = e.clientY - rect.top;
  }

  function closePoly() {
    if (draftPts.length < 3) { setStatus("Need at least 3 points.", true); return; }
    const type = getZoneType();
    const name = document.getElementById("az-zone-name")?.value.trim() || `Zone ${draftZones.length + 1}`;
    const distM = type === "speed_a" ? parseFloat(document.getElementById("az-speed-dist")?.value || "0") : null;
    draftZones.push({
      zone_type: type,
      name,
      points: draftPts.map(p => ({ x: parseFloat(p.rx.toFixed(5)), y: parseFloat(p.ry.toFixed(5)) })),
      metadata: distM ? { distance_m: distM } : null,
      color: ZONE_CONFIG[type]?.color || "#FFB800",
    });
    cancelDraw();
    renderZoneList();
    document.getElementById("az-save-btn")?.removeAttribute("disabled");
    setStatus(`"${name}" added. Click Save All to persist.`);
    document.getElementById("az-zone-name").value = "";
  }

  function undoPoint() {
    if (draftPts.length > 0) { draftPts.pop(); updateDraftInfo(); }
  }

  function cancelDraw() {
    drawing = false;
    draftPts = [];
    document.getElementById("az-draft-card").style.display = "none";
    document.getElementById("az-undo-btn").setAttribute("disabled", "");
    document.getElementById("az-cancel-btn").setAttribute("disabled", "");
    if (cameraId) document.getElementById("az-draw-btn")?.removeAttribute("disabled");
    setHint("Click to place polygon vertices");
    updateDraftInfo();
  }

  // ── Load zones from API ────────────────────────────────────────────────────
  async function loadZones() {
    if (!cameraId) return;
    try {
      const res = await fetch(`/api/analytics/data?type=zones&camera_id=${cameraId}`);
      if (res.ok) {
        savedZones = await res.json();
        renderZoneList();
        updateZoneCount();
      }
    } catch (e) {
      console.warn("[AdminZones] loadZones failed:", e);
    }
  }

  // ── Save zones to API ──────────────────────────────────────────────────────
  async function saveZones() {
    if (!cameraId || draftZones.length === 0) return;
    const btn = document.getElementById("az-save-btn");
    btn.textContent = "Saving…";
    btn.setAttribute("disabled", "");
    try {
      const res = await fetch("/api/analytics/data?type=zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera_id: cameraId, zones: draftZones }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved = await res.json();
      savedZones = [...savedZones, ...saved];
      draftZones = [];
      renderZoneList();
      updateZoneCount();
      btn.textContent = "Save All";
      setStatus(`Saved ${saved.length} zone(s) successfully.`);
    } catch (e) {
      btn.textContent = "Save All";
      btn.removeAttribute("disabled");
      setStatus("Save failed: " + e.message, true);
    }
  }

  // ── Delete zone ────────────────────────────────────────────────────────────
  async function deleteZone(zoneId, isDraft, name) {
    if (isDraft) {
      draftZones = draftZones.filter((_, i) => i !== zoneId);
    } else {
      try {
        await fetch(`/api/analytics/data?type=zones&zone_id=${zoneId}`, { method: "DELETE" });
        savedZones = savedZones.filter(z => z.id !== zoneId);
      } catch (e) {
        setStatus("Delete failed: " + e.message, true);
        return;
      }
    }
    if (draftZones.length === 0 && !isDraft) {
      document.getElementById("az-save-btn")?.setAttribute("disabled", "");
    }
    renderZoneList();
    updateZoneCount();
    setStatus(`"${name}" removed.`);
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────
  function renderZoneList() {
    const list = document.getElementById("az-zones-list");
    if (!list) return;
    const allZones = [
      ...savedZones.map(z => ({ ...z, isDraft: false })),
      ...draftZones.map((z, i) => ({ ...z, id: i, isDraft: true })),
    ];
    if (allZones.length === 0) {
      list.innerHTML = `<p class="az-empty-msg">No zones defined. Select a camera and draw a zone.</p>`;
      return;
    }
    list.innerHTML = allZones.map((z, idx) => {
      const cfg   = ZONE_CONFIG[z.zone_type] || {};
      const color = cfg.color || "#FFB800";
      const delId = z.isDraft ? z.id : z.id;
      return `<div class="az-zone-item" data-id="${delId}" data-draft="${z.isDraft}">
        <span class="az-zone-dot" style="background:${color}"></span>
        <div class="az-zone-item-info">
          <span class="az-zone-item-name">${z.name}</span>
          <span class="az-zone-item-type">${cfg.label || z.zone_type}${z.isDraft ? " · unsaved" : ""}</span>
        </div>
        <button class="az-zone-del-btn" data-idx="${idx}" data-id="${delId}" data-draft="${z.isDraft}" data-name="${z.name}" title="Remove zone">✕</button>
      </div>`;
    }).join("");

    list.querySelectorAll(".az-zone-del-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const isDraft = btn.dataset.draft === "true";
        const id      = isDraft ? parseInt(btn.dataset.idx, 10) - savedZones.length : btn.dataset.id;
        deleteZone(id, isDraft, btn.dataset.name);
      });
    });
  }

  function updateTypeUI() {
    const type = getZoneType();
    const cfg  = ZONE_CONFIG[type] || {};
    const dot  = document.getElementById("az-type-dot");
    const desc = document.getElementById("az-type-desc");
    const distRow = document.getElementById("az-speed-dist-row");
    if (dot)  dot.style.background  = cfg.color || "#FFB800";
    if (desc) desc.textContent       = cfg.desc  || "";
    if (distRow) distRow.style.display = type === "speed_a" ? "" : "none";
  }

  function updateDraftInfo() {
    const el = document.getElementById("az-draft-pts");
    if (el) el.textContent = `${draftPts.length} point${draftPts.length !== 1 ? "s" : ""} placed`;
  }

  function updateZoneCount() {
    const el = document.getElementById("az-zone-count");
    if (el) el.textContent = savedZones.length + draftZones.length;
  }

  function getZoneType()  { return document.getElementById("az-zone-type")?.value || "queue"; }
  function setMsg(msg)    { const e = document.getElementById("az-canvas-msg"); if (e) { e.textContent = msg; e.style.display = msg ? "" : "none"; } }
  function setHint(h)     { const e = document.getElementById("az-canvas-hint"); if (e) e.textContent = h; }
  function setStatus(msg, isErr) {
    const e = document.getElementById("az-status");
    if (!e) return;
    e.textContent = msg;
    e.style.color = isErr ? "#ef4444" : "var(--ok, #4CAF50)";
    clearTimeout(e._t);
    e._t = setTimeout(() => { e.textContent = ""; }, 4000);
  }

  function toPixel(rx, ry) {
    return [rx * drawCanvas.width, ry * drawCanvas.height];
  }

  function hexAlpha(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ── Panel activation hook ─────────────────────────────────────────────────
  // Called by admin-init.js panel switcher when this panel becomes active
  function onPanelActivated() {
    resizeCanvas();
    renderAll();
    if (cameraId) captureFrame();
  }

  return { init, start, onPanelActivated };
})();

// admin-init.js handles panel-change and calls AdminZones.init() + AdminZones.start(activeCameraId)
