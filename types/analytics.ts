/**
 * types/analytics.ts — Shared TypeScript interfaces for the Gov Analytics Overlay.
 * Used by hooks/useAnalytics.ts, components/analytics/*, and app/api/analytics route.
 */

// ── Traffic row from /api/analytics?_route=traffic ───────────────────────────

export interface TrafficRow {
  period: string;       // ISO date or hour string
  total: number;
  car: number;
  truck: number;
  bus: number;
  motorcycle: number;
  in: number;
  out: number;
  avg_queue?: number | null;
  avg_speed?: number | null;
  peak_queue?: number | null;
  peak_hour?: number | null;
}

export interface TrafficSummary {
  period_total: number;
  peak_period: string | null;
  peak_value: number;
  class_totals: {
    car: number;
    truck: number;
    bus: number;
    motorcycle: number;
  };
  class_pct: {
    car: number;
    truck: number;
    bus: number;
    motorcycle: number;
  };
  avg_queue_depth: number | null;
  peak_queue_depth: number | null;
  avg_speed_kmh: number | null;
  global: { total: number } | null;
  first_date: string | null;
  granularity: Granularity;
  from: string;
  to: string;
}

export interface TrafficResponse {
  rows: TrafficRow[];
  summary: TrafficSummary;
}

// ── Zone data from /api/analytics?_route=zones ───────────────────────────────

export interface ZoneEntry {
  zone_name: string;
  total: number;
  car: number;
  truck: number;
  bus: number;
  motorcycle: number;
  pct_of_total: number;
}

export interface ZonesResponse {
  zones: ZoneEntry[];
  period_total: number;
  from: string;
  to: string;
}

// ── Live data from /api/analytics?_route=data ────────────────────────────────

export interface TurningMovement {
  from: string;
  to: string;
  total: number;
  car: number;
  truck: number;
  bus: number;
  motorcycle: number;
  avg_dwell_ms: number;
}

export interface QueuePoint {
  ts: string;
  depth: number;
  visible: number;
}

export interface QueueSummary {
  avg: number;
  peak: number;
  samples: number;
  active_samples?: number;
}

export interface SpeedStats {
  avg_kmh: number;
  p85_kmh: number | null;
  min_kmh: number;
  max_kmh: number;
  samples: number;
}

export interface DataResponse {
  matrix: Record<string, TurningMovement>;
  top_movements: TurningMovement[];
  queue_series: QueuePoint[];
  queue_summary: QueueSummary;
  speed: SpeedStats | null;
  class_totals: { car: number; truck: number; bus: number; motorcycle: number };
  time_series: TrafficRow[];
  period: { from: string; to: string; total_movements: number };
}

// ── Shared params ─────────────────────────────────────────────────────────────

export type Granularity = "hour" | "day" | "week";

export interface AnalyticsParams {
  cameraId: string;
  from?: string;   // ISO date string
  to?: string;     // ISO date string
  granularity?: Granularity;
}

// ── Hook return shape ─────────────────────────────────────────────────────────

export interface UseAnalyticsReturn {
  data: TrafficResponse | null;
  zoneData: ZonesResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// ── Agency config ─────────────────────────────────────────────────────────────

export type AgencyKey = "nwa" | "taj" | "jutc" | "tourism" | "fsc" | "ooh";

export interface AgencyConfig {
  key: AgencyKey;
  abbr: string;
  name: string;
  color: string;
  question: string;
  unit: string;
  bullets: string[];
  getMetric: (summary: TrafficSummary) => { value: string; sub: string };
}
