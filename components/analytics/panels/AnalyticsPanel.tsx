"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { CLS_COLORS } from "@/lib/constants";
import type { Granularity, TrafficResponse, TrafficRow } from "@/types/analytics";

// ── Recharts dark theme constants ─────────────────────────────────────────────

const GRID_COLOR  = "rgba(26,45,66,0.8)";   // --border
const TEXT_COLOR  = "#7A9BB5";               // --muted
const CYAN        = "#00D4FF";               // --primary
// CYAN_FILL reserved for future fill usage: "rgba(0,212,255,0.12)"

// ── Date helpers ──────────────────────────────────────────────────────────────

function _toLocalDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function _todayRange(): { from: string; to: string } {
  const now  = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { from: from.toISOString(), to: now.toISOString() };
}

function _last7Range(): { from: string; to: string } {
  const now  = new Date();
  const from = new Date(now.getTime() - 7 * 86400 * 1000);
  return { from: from.toISOString(), to: now.toISOString() };
}

function _last30Range(): { from: string; to: string } {
  const now  = new Date();
  const from = new Date(now.getTime() - 30 * 86400 * 1000);
  return { from: from.toISOString(), to: now.toISOString() };
}

// ── Axis label formatter ──────────────────────────────────────────────────────

function _axisLabel(period: string, granularity: Granularity): string {
  const d = new Date(period);
  if (isNaN(d.getTime())) return period.slice(-5);
  if (granularity === "hour") return `${d.getUTCHours().toString().padStart(2, "0")}:00`;
  if (granularity === "week") return `W${_weekNum(d)}`;
  return `${(d.getUTCMonth() + 1).toString().padStart(2, "0")}/${d.getUTCDate().toString().padStart(2, "0")}`;
}

function _weekNum(d: Date): number {
  const startOfYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-[11px] font-mono-data min-w-[120px]">
      <p className="text-muted-foreground mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-3">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-foreground tabular-nums">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 min-w-0">
      <div className="text-lg font-display font-bold tabular-nums text-foreground leading-none mb-1">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-[11px] font-label tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}

// ── Granularity pills ─────────────────────────────────────────────────────────

const GRANS: Granularity[] = ["hour", "day", "week"];
const GRAN_LABELS: Record<Granularity, string> = { hour: "Hour", day: "Day", week: "Week" };

// ── Preset pills ──────────────────────────────────────────────────────────────

type Preset = "1d" | "7d" | "30d";
const PRESETS: Preset[] = ["1d", "7d", "30d"];
const PRESET_LABELS: Record<Preset, string> = { "1d": "Today", "7d": "Last 7 Days", "30d": "Last 30 Days" };

// ── Main AnalyticsPanel ───────────────────────────────────────────────────────

interface AnalyticsPanelProps {
  cameraId: string;
}

export function AnalyticsPanel({ cameraId }: AnalyticsPanelProps) {
  const today = _toLocalDate(new Date());

  const [fromDate,    setFromDate]    = useState<string>(today);
  const [toDate,      setToDate]      = useState<string>(today);
  const [granularity, setGranularity] = useState<Granularity>("hour");
  const [activePreset,setActivePreset]= useState<Preset | null>("1d");
  const [chartData,   setChartData]   = useState<TrafficResponse | null>(null);
  const [isLoading,   setLoading]     = useState(false);
  const [loadError,   setLoadError]   = useState<string | null>(null);

  const applyPreset = useCallback((preset: Preset) => {
    setActivePreset(preset);
    if (preset === "1d") {
      const r = _todayRange();
      setFromDate(r.from.slice(0, 10));
      setToDate(r.to.slice(0, 10));
      setGranularity("hour");
    } else if (preset === "7d") {
      const r = _last7Range();
      setFromDate(r.from.slice(0, 10));
      setToDate(r.to.slice(0, 10));
      setGranularity("day");
    } else {
      const r = _last30Range();
      setFromDate(r.from.slice(0, 10));
      setToDate(r.to.slice(0, 10));
      setGranularity("day");
    }
  }, []);

  const handleLoad = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({
        _route:      "traffic",
        from:        new Date(fromDate + "T00:00:00").toISOString(),
        to:          new Date(toDate   + "T23:59:59").toISOString(),
        granularity,
      });
      if (cameraId) qs.set("camera_id", cameraId);
      const res = await fetch(`/api/analytics?${qs}`);
      if (!res.ok) throw new Error("Analytics query failed");
      const data: TrafficResponse = await res.json();
      setChartData(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cameraId, fromDate, toDate, granularity]);

  // Build chart series from rows
  const series = useMemo(() => {
    if (!chartData) return [];
    return chartData.rows.map((r: TrafficRow) => ({
      name: _axisLabel(r.period, granularity),
      total: r.total ?? 0,
      cars:  r.car   ?? 0,
      trucks:r.truck ?? 0,
      buses: r.bus   ?? 0,
      motos: r.motorcycle ?? 0,
    }));
  }, [chartData, granularity]);

  const summary = chartData?.summary;

  const dailyAvg = useMemo(() => {
    if (!summary || !chartData?.rows.length) return "—";
    const days = granularity === "hour"
      ? 1
      : chartData.rows.length;
    return Math.round(summary.period_total / Math.max(days, 1)).toLocaleString();
  }, [summary, chartData, granularity]);

  const peakLabel = useMemo(() => {
    if (!summary?.peak_period) return "—";
    const d = new Date(summary.peak_period);
    if (isNaN(d.getTime())) return summary.peak_period;
    return _axisLabel(summary.peak_period, granularity);
  }, [summary, granularity]);

  const inboundPct = useMemo(() => {
    if (!chartData?.rows) return "—";
    const totalIn  = chartData.rows.reduce((a, r) => a + (r.in  ?? 0), 0);
    const totalOut = chartData.rows.reduce((a, r) => a + (r.out ?? 0), 0);
    const tot = totalIn + totalOut;
    return tot > 0 ? `${Math.round((totalIn / tot) * 100)}%` : "—";
  }, [chartData]);

  return (
    <div className="flex flex-col gap-4 pb-6">

      {/* Toolbar */}
      <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-3">
        {/* Row 1: date range + granularity */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => { setFromDate(e.target.value); setActivePreset(null); }}
              className={cn(
                "bg-surface border border-border rounded px-2 py-1",
                "text-[12px] font-mono-data text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary"
              )}
            />
            <span className="text-muted-foreground text-[11px]">→</span>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => { setToDate(e.target.value); setActivePreset(null); }}
              className={cn(
                "bg-surface border border-border rounded px-2 py-1",
                "text-[12px] font-mono-data text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary"
              )}
            />
          </div>

          {/* Granularity pills */}
          <div className="flex gap-1">
            {GRANS.map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={cn(
                  "px-2 py-1 rounded text-[11px] font-label font-semibold tracking-wider transition-colors",
                  granularity === g
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface border border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {GRAN_LABELS[g]}
              </button>
            ))}
          </div>

          {/* Load button */}
          <button
            onClick={handleLoad}
            disabled={isLoading}
            className={cn(
              "ml-auto px-4 py-1.5 rounded text-[12px] font-label font-bold tracking-wider",
              "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isLoading ? "Loading…" : "Load"}
          </button>
        </div>

        {/* Row 2: preset pills */}
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-label font-semibold tracking-wider transition-colors",
                activePreset === p
                  ? "bg-primary/20 text-primary border border-primary/40"
                  : "bg-surface border border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {loadError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 text-[12px] text-destructive">
          {loadError}
        </div>
      )}

      {/* Empty / prompt state */}
      {!chartData && !isLoading && !loadError && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-[13px] text-muted-foreground">
            Select a date range and press <span className="text-primary font-semibold">Load</span> to view vehicle flow data.
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="bg-card border border-border rounded-lg p-4 animate-pulse h-[280px]">
          <div className="h-full rounded bg-border/50" />
        </div>
      )}

      {/* Chart */}
      {chartData && !isLoading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Period Total"  value={summary?.period_total ?? 0} />
            <SummaryCard label="Daily Avg"     value={dailyAvg} />
            <SummaryCard label="Peak Period"   value={peakLabel} />
            <SummaryCard label="Inbound %"     value={inboundPct} />
          </div>

          {/* Area chart — Vehicle Flow */}
          <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-label font-bold tracking-[0.14em] text-muted-foreground uppercase">
                Vehicle Flow
              </span>
              <span className="text-[11px] font-mono-data text-muted-foreground/60">
                {fromDate} → {toDate}
              </span>
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cyanGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={CYAN} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={CYAN} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: TEXT_COLOR, fontSize: 10, fontFamily: "JetBrains Mono" }}
                    tickLine={false}
                    axisLine={{ stroke: GRID_COLOR }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: TEXT_COLOR, fontSize: 10, fontFamily: "JetBrains Mono" }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke={CYAN}
                    strokeWidth={2}
                    fill="url(#cyanGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: CYAN, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Class breakdown chart */}
          {series.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
              <span className="text-[11px] font-label font-bold tracking-[0.14em] text-muted-foreground uppercase">
                Class Breakdown
              </span>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <defs>
                      {Object.entries(CLS_COLORS).map(([cls, color]) => (
                        <linearGradient key={cls} id={`grad-${cls}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={color} stopOpacity={0.01} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: TEXT_COLOR, fontSize: 10, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={{ stroke: GRID_COLOR }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: TEXT_COLOR, fontSize: 10, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 10, color: TEXT_COLOR, fontFamily: "JetBrains Mono" }}
                    />
                    {[
                      { key: "cars",   name: "Cars",        color: CLS_COLORS.car },
                      { key: "trucks", name: "Trucks",      color: CLS_COLORS.truck },
                      { key: "buses",  name: "Buses",       color: CLS_COLORS.bus },
                      { key: "motos",  name: "Motorcycles", color: CLS_COLORS.motorcycle },
                    ].map(({ key, name, color }) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={name}
                        stroke={color}
                        strokeWidth={1.5}
                        fill={`url(#grad-${key === "motos" ? "motorcycle" : key.replace("s", "")})`}
                        dot={false}
                        activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
