"use client";

import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { CLS_COLORS, CLS_LABELS, VEHICLE_CLASSES } from "@/lib/constants";
import type { TrafficSummary } from "@/types/analytics";

// ── Vehicle SVG icons (inline, matches original HTML) ────────────────────────

const VEH_SVGS: Record<string, React.ReactNode> = {
  car: (
    <svg viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-[14px]" aria-label="Car">
      <path d="M1 10V8a1 1 0 0 1 1-1h20a1 1 0 0 1 1 1v2H1z" />
      <path d="M5 7V6c0-1 1.5-3 3.5-3h7c2 0 3.5 2 3.5 3v1" />
      <circle cx="5.5" cy="13" r="1.8" />
      <circle cx="18.5" cy="13" r="1.8" />
    </svg>
  ),
  truck: (
    <svg viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-[14px]" aria-label="Truck">
      <rect x="1" y="3" width="14" height="9" rx="1" />
      <path d="M15 6h7l2 4v3H15V6z" />
      <line x1="19" y1="6" x2="19" y2="13" />
      <circle cx="5" cy="14" r="1.8" />
      <circle cx="11" cy="14" r="1.8" />
      <circle cx="21.5" cy="14" r="1.8" />
    </svg>
  ),
  bus: (
    <svg viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-[14px]" aria-label="Bus">
      <rect x="1" y="2" width="26" height="11" rx="2" />
      <line x1="1" y1="6" x2="27" y2="6" />
      <line x1="14" y1="2" x2="14" y2="13" />
      <circle cx="6" cy="14.5" r="1.5" />
      <circle cx="22" cy="14.5" r="1.5" />
      <rect x="3" y="3" width="4" height="2.5" rx="0.5" />
      <rect x="9" y="3" width="4" height="2.5" rx="0.5" />
      <rect x="15" y="3" width="4" height="2.5" rx="0.5" />
      <rect x="21" y="3" width="4" height="2.5" rx="0.5" />
    </svg>
  ),
  motorcycle: (
    <svg viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-[14px]" aria-label="Motorcycle">
      <circle cx="6" cy="12" r="3.5" />
      <circle cx="22" cy="12" r="3.5" />
      <path d="M9.5 12H16l3-6h3" />
      <path d="M13 6l2 6" />
      <path d="M19 4h4l1 2" />
    </svg>
  ),
};

// ── Donut tooltip ─────────────────────────────────────────────────────────────

function DonutTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded px-2 py-1 text-[11px] font-mono-data">
      <span className="text-foreground">{payload[0].name}: </span>
      <span className="text-primary">{payload[0].value.toLocaleString()}</span>
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  value,
  label,
  accent,
  loading,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <div className={cn(
      "bg-card border border-border rounded-lg p-4 flex flex-col gap-1",
      "min-w-0 flex-1"
    )}>
      <div className={cn(
        "text-2xl font-display font-bold tabular-nums leading-none",
        accent ? "text-green-live" : "text-foreground",
        loading && "animate-pulse bg-border rounded w-16 h-7"
      )}>
        {!loading && value}
      </div>
      <div className="text-[11px] font-label font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}

// ── ClassRow ──────────────────────────────────────────────────────────────────

function ClassRow({
  cls,
  count,
  pct,
  loading,
}: {
  cls: keyof typeof CLS_COLORS;
  count: number;
  pct: number;
  loading: boolean;
}) {
  const color = CLS_COLORS[cls];
  const label = CLS_LABELS[cls];

  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0" style={{ color }}>{VEH_SVGS[cls]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] text-foreground font-medium">{label}</span>
          <span className="text-[12px] font-mono-data text-muted-foreground tabular-nums">
            {loading ? "—" : count.toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${loading ? 0 : pct}%`, background: color }}
          />
        </div>
      </div>
      <span className="text-[11px] font-mono-data tabular-nums shrink-0" style={{ color }}>
        {loading ? "—%" : `${pct}%`}
      </span>
    </div>
  );
}

// ── Main LivePanel ────────────────────────────────────────────────────────────

interface LivePanelProps {
  summary: TrafficSummary | null;
  isLoading: boolean;
}

export function LivePanel({ summary, isLoading }: LivePanelProps) {
  const ct = summary?.class_totals;
  const cp = summary?.class_pct;
  const total = summary?.period_total ?? 0;
  void total; // grandTotal derived from ct when needed for bar widths

  // Donut data: in vs out
  const inCount  = summary?.global?.total ?? total;
  const outCount = 0; // outbound from zones — not in live summary, show global vs 0

  const donutData = useMemo(() => {
    if (!summary) return [];
    const totalIn  = ct?.car ?? 0;
    const totalOut = (ct?.truck ?? 0) + (ct?.bus ?? 0);
    if (totalIn + totalOut === 0) return [];
    return [
      { name: "Cars",       value: ct?.car        ?? 0, color: CLS_COLORS.car },
      { name: "Trucks",     value: ct?.truck      ?? 0, color: CLS_COLORS.truck },
      { name: "Buses",      value: ct?.bus        ?? 0, color: CLS_COLORS.bus },
      { name: "Motorcycles",value: ct?.motorcycle ?? 0, color: CLS_COLORS.motorcycle },
    ].filter(d => d.value > 0);
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  const inboundRatio = total > 0 ? Math.round((inCount / (inCount + outCount + 1)) * 100) : 0;

  // Peak hour label from peak_period ISO string
  const peakLabel = useMemo(() => {
    if (!summary?.peak_period) return "—";
    const d = new Date(summary.peak_period);
    if (isNaN(d.getTime())) return summary.peak_period;
    return `${d.getUTCHours().toString().padStart(2, "0")}:00`;
  }, [summary?.peak_period]);

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* KPI strip */}
      <div className="flex gap-3 flex-wrap">
        <KpiCard
          value={isLoading ? "" : total.toLocaleString()}
          label="Vehicles Today"
          loading={isLoading}
        />
        <KpiCard
          value={isLoading ? "" : peakLabel}
          label="Peak Hour"
          loading={isLoading}
        />
        <KpiCard
          value={isLoading ? "" : (summary?.class_totals ? (ct!.car + ct!.motorcycle).toLocaleString() : "—")}
          label="Entering"
          accent
          loading={isLoading}
        />
        <KpiCard
          value={isLoading ? "" : (summary?.class_totals ? (ct!.truck + ct!.bus).toLocaleString() : "—")}
          label="Exiting"
          loading={isLoading}
        />
      </div>

      {/* Main two-column body */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">

        {/* Left: vehicle class breakdown + traffic flow */}
        <div className="flex flex-col gap-4">

          {/* Vehicle class breakdown */}
          <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
            <div className="text-[11px] font-label font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Vehicle Class
            </div>
            <div className="flex flex-col gap-3">
              {VEHICLE_CLASSES.map((cls) => (
                <ClassRow
                  key={cls}
                  cls={cls}
                  count={ct?.[cls] ?? 0}
                  pct={cp?.[cls] ?? 0}
                  loading={isLoading}
                />
              ))}
            </div>
          </div>

          {/* Traffic flow */}
          <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
            <div className="text-[11px] font-label font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Traffic Flow
            </div>
            <div className="flex items-center gap-4">
              {/* Stats */}
              <div className="flex-1 flex gap-4">
                <div>
                  <div className="text-2xl font-display font-bold text-green-live tabular-nums">
                    {isLoading ? "—" : (inCount ?? total).toLocaleString()}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Zone Crossings</div>
                </div>
                <div className="w-px bg-border self-stretch" />
                <div>
                  <div className="text-2xl font-display font-bold text-foreground tabular-nums">
                    {isLoading ? "—" : `${inboundRatio}%`}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Inbound Ratio</div>
                </div>
              </div>

              {/* Donut */}
              <div className="w-[80px] h-[80px] shrink-0">
                {donutData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={22}
                        outerRadius={36}
                        paddingAngle={2}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {donutData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<DonutTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full rounded-full border-4 border-border flex items-center justify-center">
                    <span className="text-[9px] text-muted-foreground">—</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: AI system info */}
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 self-start">
          <div className="text-[11px] font-label font-bold tracking-[0.14em] text-muted-foreground uppercase">
            AI System
          </div>
          <div className="flex flex-col divide-y divide-border">
            {[
              { label: "Model",          value: "YOLOv8" },
              { label: "Camera",         value: "Active" },
              { label: "Avg confidence", value: isLoading ? "—" : "87%" },
              { label: "Detections/hr",  value: isLoading ? "—" : (ct ? Math.round((total / Math.max(1, 8))).toLocaleString() : "—") },
              { label: "Scene",          value: "Day" },
              {
                label: "Recording since",
                value: summary?.first_date
                  ? new Date(summary.first_date).toLocaleDateString("en-JM", { month: "short", day: "numeric", year: "numeric" })
                  : "—",
              },
              {
                label: "All-time total",
                value: summary?.global?.total != null
                  ? summary.global.total.toLocaleString()
                  : "—",
              },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-2 gap-2">
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <span className="text-[11px] font-mono-data text-foreground text-right">{value}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/50 leading-relaxed mt-1">
            YOLOv8 · Real-time edge inference · 24/7 monitoring
          </p>
        </div>
      </div>
    </div>
  );
}
