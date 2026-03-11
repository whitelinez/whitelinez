"use client";

/**
 * ZoneOverlay.tsx — Renders the AI detection zone polygon on a canvas
 * overlaid on the live stream.
 *
 * - zone: [[x, y], ...] normalized 0-1 coords relative to native video resolution
 * - contentToPixel transform aligns the zone to the letterboxed video frame
 * - Hover: ray-casting point-in-polygon, brightens stroke + fill, crosshair cursor
 * - Corner dots at each vertex
 * - pointer-events: none by default; pointer-events: all on hover
 */

import {
  useEffect,
  useRef,
  useCallback,
  type RefObject,
} from "react";

export interface ZoneOverlayProps {
  zone: number[][];
  videoRef: RefObject<HTMLVideoElement>;
  isActive?: boolean;
  onZoneHover?: (hovering: boolean) => void;
  className?: string;
}

// ── coord utils ──────────────────────────────────────────────────────────────
function getContentBounds(video: HTMLVideoElement) {
  const cssW = video.clientWidth;
  const cssH = video.clientHeight;
  const nW = video.videoWidth || cssW;
  const nH = video.videoHeight || cssH;
  if (!nW || !nH) return { x: 0, y: 0, w: cssW, h: cssH };
  const scale = Math.min(cssW / nW, cssH / nH);
  const w = nW * scale;
  const h = nH * scale;
  return { x: (cssW - w) / 2, y: (cssH - h) / 2, w, h };
}

function contentToPixel(
  rx: number,
  ry: number,
  b: { x: number; y: number; w: number; h: number },
) {
  return { x: rx * b.w + b.x, y: ry * b.h + b.y };
}

// ── point-in-polygon (ray casting) ──────────────────────────────────────────
function pointInPoly(px: number, py: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function ZoneOverlay({
  zone,
  videoRef,
  isActive = true,
  onZoneHover,
  className,
}: ZoneOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);
  const hoverRef = useRef(false);
  const lastHoverMsRef = useRef(0);

  // ── size sync ──────────────────────────────────────────────────
  const syncSize = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const cssW = video.clientWidth;
    const cssH = video.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [videoRef]);

  // ── draw ───────────────────────────────────────────────────────
  const draw = useCallback(
    (hovering: boolean) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !zone.length) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = dprRef.current;
      const cssW = canvas.width / dpr;
      const cssH = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      if (!isActive || zone.length < 3) return;

      const bounds = getContentBounds(video);
      const poly = zone.map(([rx, ry]) => contentToPixel(rx, ry, bounds));

      // Fill
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = hovering ? "rgba(0,212,255,0.12)" : "rgba(0,212,255,0.06)";
      ctx.fill();

      // Stroke
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.strokeStyle = hovering ? "rgba(0,212,255,1)" : "rgba(0,212,255,0.6)";
      ctx.lineWidth = hovering ? 2 : 1.5;
      ctx.setLineDash(hovering ? [] : [6, 4]);
      if (hovering) {
        ctx.shadowColor = "rgba(0,212,255,0.8)";
        ctx.shadowBlur = 12;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);

      // SCAN label at topmost vertex
      const top = poly.reduce((t, p) => (p.y < t.y ? p : t), poly[0]);
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillStyle = hovering ? "rgba(0,212,255,1)" : "rgba(0,212,255,0.7)";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("SCAN", top.x, top.y - 4);

      // Corner dots
      for (const p of poly) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = hovering ? "#00D4FF" : "rgba(0,212,255,0.7)";
        if (hovering) {
          ctx.shadowColor = "#00D4FF";
          ctx.shadowBlur = 6;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    },
    [zone, videoRef, isActive],
  );

  // ── init size + observe ────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    syncSize();
    draw(false);

    const ro = new ResizeObserver(() => {
      syncSize();
      draw(hoverRef.current);
    });
    ro.observe(video);
    window.addEventListener("resize", () => {
      syncSize();
      draw(hoverRef.current);
    });

    const onMeta = () => {
      syncSize();
      draw(hoverRef.current);
    };
    video.addEventListener("loadedmetadata", onMeta);

    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [videoRef, syncSize, draw]);

  // ── redraw on zone/isActive change ────────────────────────────
  useEffect(() => {
    draw(hoverRef.current);
  }, [zone, isActive, draw]);

  // ── hover detection ────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!zone.length) return;
      const now = Date.now();
      if (now - lastHoverMsRef.current < 80) return; // ~12fps throttle
      lastHoverMsRef.current = now;

      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      const bounds = getContentBounds(video);
      const poly = zone.map(([rx, ry]) => contentToPixel(rx, ry, bounds));
      const nowHover = pointInPoly(cssX, cssY, poly);

      if (nowHover !== hoverRef.current) {
        hoverRef.current = nowHover;
        canvas.style.cursor = nowHover ? "crosshair" : "";
        onZoneHover?.(nowHover);
        draw(nowHover);
      }
    },
    [zone, videoRef, onZoneHover, draw],
  );

  const handleMouseLeave = useCallback(() => {
    if (hoverRef.current) {
      hoverRef.current = false;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = "";
      onZoneHover?.(false);
      draw(false);
    }
  }, [onZoneHover, draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseLeave]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "all",
        zIndex: 11,
      }}
    />
  );
}
