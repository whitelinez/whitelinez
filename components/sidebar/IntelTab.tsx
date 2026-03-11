"use client";
/**
 * components/sidebar/IntelTab.tsx
 * INTEL tab — ML model info + detection metrics showcase.
 */

import { cn } from "@/lib/utils";
import { CLS_COLORS, CLS_LABELS, VEHICLE_CLASSES, type VehicleClass } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MlStats {
  model?: string;
  status?: "active" | "idle" | "offline";
  fps?: number;
  confidence?: number;        // 0–100
  detections_hr?: number;
  scene?: string;
  vehicle_distribution?: Partial<Record<VehicleClass, number>>; // last 1h counts
}

interface Props {
  mlStats?: MlStats | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatRow({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-b-0">
      <span className="text-muted text-xs">{label}</span>
      <span className={cn("text-foreground text-xs font-semibold", mono && "font-mono text-primary")}>
        {value}
      </span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function IntelTab({ mlStats }: Props) {
  if (!mlStats) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
        <div className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
          </svg>
        </div>
        <div>
          <p className="text-muted text-sm">Waiting for AI data...</p>
          <p className="text-muted/50 text-xs mt-0.5">Live when detection is running</p>
        </div>
      </div>
    );
  }

  const {
    model        = "YOLOv8",
    status       = "idle",
    fps,
    confidence,
    detections_hr,
    scene,
    vehicle_distribution,
  } = mlStats;

  const statusStyles: Record<string, string> = {
    active:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    idle:    "bg-amber-500/15 text-amber-400 border-amber-500/30",
    offline: "bg-muted/10 text-muted border-border",
  };

  // Build distribution bar data
  const distTotal = vehicle_distribution
    ? VEHICLE_CLASSES.reduce((sum, cls) => sum + (vehicle_distribution[cls] ?? 0), 0)
    : 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Model header */}
      <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-label font-bold text-sm tracking-wider text-foreground">{model}</p>
          <p className="text-muted text-[10px] mt-0.5">
            {scene ?? "Live detection engine"}
          </p>
        </div>
        <span className={cn(
          "font-label font-semibold text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-full border",
          statusStyles[status] ?? statusStyles.idle
        )}>
          {status}
        </span>
      </div>

      {/* Metrics */}
      <div className="bg-card border border-border rounded-lg px-4 py-2">
        <p className="font-label font-semibold text-[10px] tracking-widest text-muted uppercase mb-1">
          Detection Metrics
        </p>
        {fps !== undefined && (
          <StatRow label="Frame rate" value={`${fps.toFixed(1)} FPS`} mono />
        )}
        {confidence !== undefined && (
          <StatRow label="Avg confidence" value={`${confidence.toFixed(1)}%`} mono />
        )}
        {detections_hr !== undefined && (
          <StatRow label="Detections / hr" value={detections_hr.toLocaleString()} mono />
        )}
        {fps === undefined && confidence === undefined && detections_hr === undefined && (
          <p className="text-muted text-xs py-2">No metrics available</p>
        )}
      </div>

      {/* Vehicle distribution */}
      {vehicle_distribution && distTotal > 0 && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-2.5">
          <p className="font-label font-semibold text-[10px] tracking-widest text-muted uppercase">
            Vehicle Mix (last 1h)
          </p>
          {VEHICLE_CLASSES.map((cls) => {
            const count  = vehicle_distribution[cls] ?? 0;
            const pct    = distTotal > 0 ? (count / distTotal) * 100 : 0;
            const color  = CLS_COLORS[cls];
            const label  = CLS_LABELS[cls];
            return (
              <div key={cls} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <span
                      className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ background: color }}
                    />
                    {label}
                  </span>
                  <span className="font-mono text-xs" style={{ color }}>
                    {count.toLocaleString()}
                    <span className="text-muted/60 ml-0.5 font-sans text-[10px]">
                      ({pct.toFixed(0)}%)
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(pct, 1)}%`, background: color + "cc" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer note */}
      <p className="text-[10px] text-muted/50 text-center">
        Detection data refreshes with each WebSocket frame
      </p>
    </div>
  );
}
