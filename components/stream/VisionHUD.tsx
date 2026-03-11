"use client";

/**
 * VisionHUD.tsx — AI inference HUD panel on the left side of the stream.
 *
 * Collapsed: small "VISION HUD" label + state badge.
 * Expanded: detection rate bar, traffic load text, frames + objects counts.
 *
 * Animates expand/collapse with Framer Motion.
 */

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface VisionHUDProps {
  fps: number;
  detectionRate: number;   // 0-100 percentage for the detection rate bar
  frameCount: number;
  objectCount: number;
  trafficMsg: string;
  isExpanded: boolean;
  onToggle: () => void;
  stateLabel?: string;
  className?: string;
}

function DetectionRateBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const barColor =
    pct >= 80 ? "#00FF88" : pct >= 40 ? "#FFB800" : "#FF3D6B";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-label uppercase tracking-wider text-muted-foreground">
          Detection Rate
        </span>
        <strong
          className="font-mono text-[10px]"
          style={{ color: barColor }}
        >
          {value.toFixed(1)}/m
        </strong>
      </div>
      <div className="h-1 w-full rounded-full bg-muted/20 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

export function VisionHUD({
  fps,
  detectionRate,
  frameCount,
  objectCount,
  trafficMsg,
  isExpanded,
  onToggle,
  stateLabel = "Idle",
  className,
}: VisionHUDProps) {
  return (
    <div
      id="ml-hud"
      title="Toggle AI details"
      className={cn(
        "absolute left-3 top-3 z-20 cursor-pointer select-none",
        "rounded-md glass px-2.5 py-2",
        "max-w-[188px] min-w-[112px]",
        "transition-all duration-200",
        className,
      )}
      onClick={onToggle}
      role="button"
      aria-expanded={isExpanded}
      aria-label="Toggle VISION HUD"
    >
      {/* Header — always visible */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-label text-[10px] font-bold tracking-[0.14em] uppercase text-primary">
          VISION HUD
        </span>
        <span className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-green-active animate-pulse-dot flex-shrink-0"
            aria-hidden="true"
          />
          {stateLabel}
        </span>
      </div>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="hud-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 flex flex-col gap-2.5">
              {/* Detection rate bar */}
              <DetectionRateBar value={detectionRate} />

              {/* Traffic load */}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-label uppercase tracking-wider text-muted-foreground">
                  Traffic Load
                </span>
                <span
                  id="ml-hud-traffic-msg"
                  className="font-mono text-[10px] text-foreground truncate"
                >
                  {trafficMsg || "Waiting for data…"}
                </span>
              </div>

              {/* Metrics row */}
              <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-border/40">
                <span className="text-[9px] font-mono text-muted-foreground">
                  Frames{" "}
                  <strong
                    id="ml-hud-frames"
                    className="text-foreground"
                  >
                    {frameCount.toLocaleString()}
                  </strong>
                </span>
                <span className="text-[9px] font-mono text-muted-foreground">
                  Objects{" "}
                  <strong
                    id="ml-hud-dets"
                    className="text-foreground"
                  >
                    {objectCount}
                  </strong>
                </span>
              </div>

              {/* FPS hint */}
              {fps > 0 && (
                <div className="text-[9px] font-mono text-muted-foreground">
                  {fps.toFixed(1)} fps
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
