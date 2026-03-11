"use client";

import { AgencyCard } from "@/components/analytics/AgencyCard";
import type { AgencyConfig, TrafficSummary } from "@/types/analytics";

// ── Agency configurations ─────────────────────────────────────────────────────

const AGENCIES: AgencyConfig[] = [
  {
    key: "nwa",
    abbr: "NWA",
    name: "National Works Agency",
    color: "#29B6F6",
    question: '"Which roads are taking the heaviest commercial load?"',
    unit: "heavy vehicles today",
    bullets: [
      "Road stress by vehicle type, per corridor — ready for budget reports",
      "Peak congestion hours — schedule maintenance windows around real data",
      "Truck vs. bus vs. car split for infrastructure and pavement planning",
    ],
    getMetric: (s) => {
      const heavy = (s.class_totals.truck + s.class_totals.bus);
      const pct   = s.period_total > 0 ? Math.round((heavy / s.period_total) * 100) : 0;
      return { value: heavy.toLocaleString(), sub: `${pct}% of today's total traffic` };
    },
  },
  {
    key: "taj",
    abbr: "TAJ",
    name: "Tax Administration Jamaica",
    color: "#FF7043",
    question: '"Are the trucks on the road matching what\'s declared at customs?"',
    unit: "commercial vehicles today",
    bullets: [
      "Compare commercial vehicle volume against declared freight manifests",
      "Truck movement patterns by time of day — flag anomalies automatically",
      "Corridor-level counts for toll and licensing compliance cross-check",
    ],
    getMetric: (s) => {
      const commercial = s.class_totals.truck + s.class_totals.bus;
      return {
        value: commercial.toLocaleString(),
        sub: `Trucks: ${s.class_totals.truck.toLocaleString()} + Buses: ${s.class_totals.bus.toLocaleString()}`,
      };
    },
  },
  {
    key: "jutc",
    abbr: "JUTC",
    name: "Jamaica Urban Transit Co.",
    color: "#AB47BC",
    question: '"Is bus frequency actually matching commuter demand?"',
    unit: "buses detected today",
    bullets: [
      "See how often buses actually arrive — compare against schedule",
      "AM/PM peak commuter demand windows — backed by vehicle counts",
      "Identify under-served routes from real headway gaps",
    ],
    getMetric: (s) => {
      const buses = s.class_totals.bus;
      const pct   = s.period_total > 0 ? Math.round((buses / s.period_total) * 100) : 0;
      return { value: buses.toLocaleString(), sub: `${pct}% of total traffic` };
    },
  },
  {
    key: "tourism",
    abbr: "JTB",
    name: "Jamaica Tourism Board",
    color: "#FFD600",
    question: '"Which tourist corridors are congested, and when?"',
    unit: "verified vehicle passes today",
    bullets: [
      "Monitor airport corridor and resort zone vehicle flow 24/7",
      "Identify congestion windows that affect tourist arrival times",
      "Tour bus frequency data for route and partnership planning",
    ],
    getMetric: (s) => {
      const passenger = s.class_totals.car + s.class_totals.motorcycle;
      return {
        value: passenger.toLocaleString(),
        sub: `Cars + motorcycles (passenger vehicles)`,
      };
    },
  },
  {
    key: "fsc",
    abbr: "FSC",
    name: "Financial Services Commission",
    color: "#66BB6A",
    question: '"Where and when do high-risk traffic conditions occur?"',
    unit: "heavy vehicles today",
    bullets: [
      "Risk index based on heavy vehicle concentration at peak hours",
      "Collision-prone period identification using volume and type data",
      "Actuary-grade traffic density reports exportable as CSV",
    ],
    getMetric: (s) => {
      const heavy   = s.class_totals.truck + s.class_totals.bus;
      const riskIdx = s.period_total > 0 ? ((heavy / s.period_total) * 100).toFixed(1) : "0.0";
      return { value: heavy.toLocaleString(), sub: `Risk index: ${riskIdx}%` };
    },
  },
  {
    key: "ooh",
    abbr: "OOH",
    name: "Out-of-Home Advertising",
    color: "#22C55E",
    question: "How many vehicles actually passed your billboard today?",
    unit: "AI-verified impressions today",
    bullets: [
      "Bill advertisers on AI-counted vehicle passes — not panel estimates",
      "Daypart breakdown — morning peak, afternoon, evening — for rate-card pricing",
      "Auditable impression count, updated every second, exportable as CSV",
    ],
    getMetric: (s) => {
      return {
        value: s.period_total.toLocaleString(),
        sub: "guaranteed reach, auditable",
      };
    },
  },
];

// ── OOH featured config ───────────────────────────────────────────────────────

const OOH_CONFIG = AGENCIES.find((a) => a.key === "ooh")!;
const GRID_AGENCIES = AGENCIES.filter((a) => a.key !== "ooh");

// ── Trust badges ──────────────────────────────────────────────────────────────

function TrustBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground border border-border rounded-full px-3 py-1">
      <span className="text-primary text-[9px]">◈</span>
      {children}
    </span>
  );
}

// ── How it works step ─────────────────────────────────────────────────────────

function HiwStep({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg border border-border bg-surface flex items-center justify-center shrink-0 text-primary">
        {icon}
      </div>
      <div>
        <div className="text-[12px] font-semibold text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface AgenciesPanelProps {
  summary: TrafficSummary | null;
  isLoading: boolean;
}

export function AgenciesPanel({ summary, isLoading }: AgenciesPanelProps) {
  return (
    <div className="flex flex-col gap-5 pb-6">

      {/* Header pitch */}
      <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3">
        <p className="text-[15px] font-display font-semibold text-foreground">
          Know what&apos;s moving on Jamaica&apos;s roads — before anyone else does.
        </p>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Real-time AI traffic counts, verified by camera, updated every second. Used by agencies
          for planning, compliance, and investment decisions.
        </p>
        <div className="flex flex-wrap gap-2 mt-1">
          <TrustBadge>Live AI · Updated every frame</TrustBadge>
          <TrustBadge>
            <span className="font-mono-data tabular-nums">
              {isLoading ? "—" : (summary?.period_total ?? 0).toLocaleString()}
            </span>
            {" "}vehicles counted today
          </TrustBadge>
          <TrustBadge>24/7 monitoring, no manual counting</TrustBadge>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <HiwStep
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <rect x="2" y="6" width="20" height="13" rx="2"/>
              <circle cx="12" cy="12.5" r="3"/>
              <path d="M2 9h20"/>
            </svg>
          }
          title="AI monitors live CCTV"
          sub="Camera feed, 24/7"
        />
        <span className="text-muted-foreground text-[13px] hidden sm:block">→</span>
        <HiwStep
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V11h2a2 2 0 0 1 2 2v2h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1v-2a2 2 0 0 1 2-2h2V9.5C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
            </svg>
          }
          title="Counts & classifies every vehicle"
          sub="Car, truck, bus, motorcycle"
        />
        <span className="text-muted-foreground text-[13px] hidden sm:block">→</span>
        <HiwStep
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          }
          title="Data packaged for your agency"
          sub="CSV, API, or live dashboard"
        />
      </div>

      {/* Featured OOH card */}
      <AgencyCard
        config={OOH_CONFIG}
        summary={summary}
        featured
      />

      {/* 2-column agency grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {GRID_AGENCIES.map((cfg) => (
          <AgencyCard key={cfg.key} config={cfg} summary={summary} />
        ))}
      </div>
    </div>
  );
}
