"use client";

import { cn } from "@/lib/utils";
import type { AgencyConfig, TrafficSummary } from "@/types/analytics";

interface AgencyCardProps {
  config: AgencyConfig;
  summary: TrafficSummary | null;
  featured?: boolean;
  className?: string;
}

export function AgencyCard({ config, summary, featured = false, className }: AgencyCardProps) {
  const metric = summary
    ? config.getMetric(summary)
    : { value: "—", sub: "loading…" };

  if (featured) {
    return (
      <div
        className={cn(
          "rounded-lg border p-5 flex flex-col gap-3 md:flex-row md:items-start",
          "bg-card border-border",
          className
        )}
        style={{ borderLeftColor: config.color, borderLeftWidth: 3 }}
      >
        {/* Left: pitch */}
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-display font-bold tracking-[0.14em] px-2 py-0.5 rounded"
              style={{ color: config.color, background: `${config.color}18` }}
            >
              FEATURED · OUT-OF-HOME ADVERTISING
            </span>
          </div>
          <p className="text-[15px] font-display font-semibold text-foreground leading-snug">
            {config.question}
          </p>
          <ul className="space-y-1.5">
            {config.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-muted-foreground leading-relaxed">
                <span style={{ color: config.color }} className="mt-0.5 shrink-0">◈</span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: metric */}
        <div className="flex flex-col items-center justify-center min-w-[140px] gap-1 text-center">
          <div className="text-[11px] font-label font-bold tracking-widest text-muted-foreground">
            {config.abbr}
          </div>
          <div
            className="text-3xl font-display font-bold tabular-nums leading-none"
            style={{ color: config.color }}
          >
            {metric.value}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight">{config.unit}</div>
          <div className="text-[10px] text-muted-foreground/60">{metric.sub}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card p-4 flex flex-col gap-3 overflow-hidden",
        "transition-colors hover:border-white/10",
        className
      )}
      style={{ borderLeftColor: config.color, borderLeftWidth: 3 }}
    >
      {/* Corner frame decoration */}
      <span className="pointer-events-none absolute inset-0 rounded-lg" aria-hidden="true"
        style={{ boxShadow: `inset 0 0 0 1px ${config.color}12` }} />

      {/* Header row */}
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded flex items-center justify-center text-[11px] font-display font-bold shrink-0"
          style={{ background: `${config.color}18`, color: config.color }}
        >
          {config.abbr.slice(0, 2)}
        </div>
        <div>
          <div className="text-[12px] font-display font-bold" style={{ color: config.color }}>
            {config.abbr}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight">{config.name}</div>
        </div>
      </div>

      {/* Question */}
      <p className="text-[11px] text-muted-foreground italic leading-snug">
        {config.question}
      </p>

      {/* Metric */}
      <div className="flex items-baseline gap-2">
        <span
          className="text-2xl font-display font-bold tabular-nums"
          style={{ color: config.color }}
        >
          {metric.value}
        </span>
        <span className="text-[11px] text-muted-foreground leading-tight">{config.unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground/60">{metric.sub}</div>

      {/* Bullets */}
      <ul className="mt-1 space-y-1">
        {config.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
            <span style={{ color: config.color }} className="mt-0.5 shrink-0 text-[9px]">◈</span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}
