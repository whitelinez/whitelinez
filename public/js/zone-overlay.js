/**
 * zone-overlay.js — Read-only canvas overlay showing the admin-defined
 * counting zone on the public live stream. Fetches from Supabase and redraws
 * every 30s to pick up any admin changes.
 */

const ZoneOverlay = (() => {
  let canvas, ctx, video;

  function init(videoEl, canvasEl) {
    video = videoEl;
    canvas = canvasEl;
    ctx = canvas.getContext("2d");

    syncSize();
    window.addEventListener("resize", () => { syncSize(); draw(); });
    video.addEventListener("loadedmetadata", () => { syncSize(); loadAndDraw(); });

    loadAndDraw();
    setInterval(loadAndDraw, 30_000);
  }

  function syncSize() {
    if (!video || !canvas) return;
    canvas.width = video.clientWidth;
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

      draw(data?.count_line);
    } catch (e) {
      console.warn("[ZoneOverlay] Failed to load zone:", e);
    }
  }

  function draw(line) {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!line) return;

    const w = canvas.width;
    const h = canvas.height;

    if (line.x3 !== undefined) {
      // 4-point polygon zone
      const pts = [
        { x: line.x1 * w, y: line.y1 * h },
        { x: line.x2 * w, y: line.y2 * h },
        { x: line.x3 * w, y: line.y3 * h },
        { x: line.x4 * w, y: line.y4 * h },
      ];

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 214, 0, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corner dots
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#FFD600";
        ctx.fill();
      }

      // Label
      ctx.fillStyle = "rgba(255, 214, 0, 0.9)";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("COUNT ZONE", (pts[0].x + pts[1].x) / 2, pts[0].y - 8);

    } else if (line.x1 !== undefined) {
      // 2-point line
      ctx.beginPath();
      ctx.moveTo(line.x1 * w, line.y1 * h);
      ctx.lineTo(line.x2 * w, line.y2 * h);
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(255, 214, 0, 0.9)";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("COUNT LINE", (line.x1 + line.x2) / 2 * w, line.y1 * h - 8);
    }
  }

  return { init };
})();

window.ZoneOverlay = ZoneOverlay;
