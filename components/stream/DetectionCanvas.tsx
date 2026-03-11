"use client";

/**
 * DetectionCanvas.tsx — Renders YOLO bounding boxes over the live stream.
 *
 * - Canvas sized to match video display via ResizeObserver
 * - Corner-bracket style boxes per vehicle class color
 * - Label pill above each box: "Car 93%"
 * - Font: JetBrains Mono 11px
 * - Clears on empty detections
 */

import { useEffect, useRef, type RefObject } from "react";
import { CLS_COLORS } from "@/lib/constants";

export interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  confidence?: number;
  conf?: number;
  cls?: string;
  cls_id?: number;
  color?: string;
  tracker_id?: number;
  in_detect_zone?: boolean;
}

interface DetectionCanvasProps {
  detections: Detection[];
  videoRef: RefObject<HTMLVideoElement>;
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
  return {
    x: (cssW - w) / 2,
    y: (cssH - h) / 2,
    w,
    h,
  };
}

function contentToPixel(
  rx: number,
  ry: number,
  bounds: { x: number; y: number; w: number; h: number },
) {
  return {
    x: rx * bounds.w + bounds.x,
    y: ry * bounds.h + bounds.y,
  };
}

// ── drawing helpers ──────────────────────────────────────────────────────────
const CLS_NAME_MAP: Record<string, string> = {
  car: "Car",
  truck: "Truck",
  bus: "Bus",
  motorcycle: "Moto",
};

const DEFAULT_COLOR = "#66BB6A";

function drawCornerBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  lineWidth: number,
) {
  const c = Math.max(6, Math.min(20, Math.floor(Math.min(w, h) * 0.22)));
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, y + c);
  ctx.lineTo(x, y);
  ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + c);
  ctx.moveTo(x + w, y + h - c);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - c, y + h);
  ctx.moveTo(x + c, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function resolveColor(det: Detection): string {
  if (det.color) return det.color;
  const cls = String(det.cls ?? "").toLowerCase() as keyof typeof CLS_COLORS;
  return CLS_COLORS[cls] ?? DEFAULT_COLOR;
}

function drawDetection(
  ctx: CanvasRenderingContext2D,
  det: Detection,
  bounds: ReturnType<typeof getContentBounds>,
  dpr: number,
) {
  void dpr; // reserved for high-DPI canvas scaling if needed
  const p1 = contentToPixel(det.x1, det.y1, bounds);
  const p2 = contentToPixel(det.x2, det.y2, bounds);
  const bw = p2.x - p1.x;
  const bh = p2.y - p1.y;
  if (bw < 4 || bh < 4) return;

  const color = resolveColor(det);
  const lw = 1.8;

  // glow halo
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  drawCornerBox(ctx, p1.x, p1.y, bw, bh, color, lw);
  ctx.shadowBlur = 0;
  ctx.restore();

  // label pill
  const clsKey = String(det.cls ?? "").toLowerCase();
  const clsStr = det.label ?? CLS_NAME_MAP[clsKey] ?? "Vehicle";
  const conf = det.confidence ?? det.conf;
  const confStr = conf != null ? ` ${Math.round(Number(conf) * 100)}%` : "";
  const labelText = clsStr + confStr;

  const fs = 11;
  ctx.font = `700 ${fs}px "JetBrains Mono", monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const tw = ctx.measureText(labelText).width;
  const px = 4;
  const py = 2;
  const tagW = tw + px * 2;
  const tagH = fs + py * 2;
  const tx = p1.x;
  const ty = p1.y - tagH >= 0 ? p1.y - tagH : p1.y;

  ctx.fillStyle = color;
  ctx.beginPath();
  type CtxWithRoundRect = CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  if ((ctx as CtxWithRoundRect).roundRect) {
    (ctx as CtxWithRoundRect).roundRect!(tx, ty, tagW, tagH, 3);
  } else {
    ctx.rect(tx, ty, tagW, tagH);
  }
  ctx.fill();
  ctx.fillStyle = "#000000";
  ctx.fillText(labelText, tx + px, ty + py);
}

export function DetectionCanvas({
  detections,
  videoRef,
  className,
}: DetectionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);

  // Sync canvas size to video via ResizeObserver
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    function syncSize() {
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
    }

    syncSize();

    const ro = new ResizeObserver(() => {
      syncSize();
    });
    ro.observe(video);
    window.addEventListener("resize", syncSize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncSize);
    };
  }, [videoRef]);

  // Redraw on detections change
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = dprRef.current;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!detections.length || !video) return;

    const bounds = getContentBounds(video);

    for (const det of detections) {
      drawDetection(ctx, det, bounds, dpr);
    }
  }, [detections, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    />
  );
}
