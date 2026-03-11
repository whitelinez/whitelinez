/**
 * /api/analytics — consolidated analytics handler.
 * Routes via _route query param:
 *   GET /api/analytics?_route=traffic  — hourly/daily/weekly traffic counts
 *   GET /api/analytics?_route=data     — turning movements + queue/speed data
 *   GET /api/analytics?_route=export   — CSV download (admin only)
 *   GET /api/analytics?_route=zones    — per-zone vehicle breakdown
 *
 * Uses Supabase service role key for all queries — bypasses RLS.
 * Node.js runtime: uses Response/NextResponse pattern with complex aggregation logic.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Prevent CSV formula injection by prefixing cells that start with formula chars. */
function csvSanitize(value: unknown): string {
  const s = String(value == null ? "" : value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function parseDate(s: string | null | undefined, fallback: Date): Date | null {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function getEnv(): { supabaseUrl: string; serviceKey: string } | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return { supabaseUrl, serviceKey };
}

function sbHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey:          serviceKey,
    Authorization:   `Bearer ${serviceKey}`,
    "Content-Type":  "application/json",
  };
}

function getMondayISO(dateStr: string): string {
  const d   = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

// ── Route dispatcher ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const { searchParams } = new URL(req.url);
  const route = searchParams.get("_route") ?? "";

  switch (route) {
    case "traffic": return handleTraffic(req);
    case "data":    return handleData(req);
    case "export":  return handleExport(req);
    case "zones":   return handleZones(req);
    default:
      return NextResponse.json({ error: `Unknown analytics route: ${route}` }, { status: 404 });
  }
}

// POST routes for data/zones writes
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const route = searchParams.get("_route") ?? "";
  if (route === "data") return handleData(req);
  return NextResponse.json({ error: `Unknown analytics route: ${route}` }, { status: 404 });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const route = searchParams.get("_route") ?? "";
  if (route === "data") return handleData(req);
  return NextResponse.json({ error: `Unknown analytics route: ${route}` }, { status: 404 });
}

// ── /api/analytics?_route=traffic ────────────────────────────────────────────

async function handleTraffic(req: NextRequest): Promise<NextResponse> {
  if (req.method !== "GET")
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });

  const env = getEnv();
  if (!env) return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  const { supabaseUrl, serviceKey } = env;
  const headers = sbHeaders(serviceKey);

  const { searchParams } = new URL(req.url);
  const cameraId    = searchParams.get("camera_id") ?? undefined;
  const hours       = searchParams.get("hours") ?? "24";
  const from        = searchParams.get("from");
  const to          = searchParams.get("to");
  const granularity = searchParams.get("granularity") ?? "hour";

  let fromISO: string, toISO: string;
  if (from || to) {
    const fd = parseDate(from, new Date(0));
    const td = parseDate(to,   new Date());
    if (!fd || !td)
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD or ISO 8601." }, { status: 400 });
    fromISO = fd.toISOString();
    toISO   = td.toISOString();
  } else {
    const hoursInt = Math.min(Math.max(1, parseInt(hours, 10) || 24), 8760);
    toISO   = new Date().toISOString();
    fromISO = new Date(Date.now() - hoursInt * 3600 * 1000).toISOString();
  }

  try {
    let rows: TrafficRow[] = [];

    if (granularity === "day" || granularity === "week") {
      const fromDate = fromISO.slice(0, 10);
      const toDate   = toISO.slice(0, 10);
      let url = `${supabaseUrl}/rest/v1/traffic_daily`
        + `?date=gte.${fromDate}&date=lte.${toDate}`
        + `&order=date.asc`;
      if (cameraId) url += `&camera_id=eq.${encodeURIComponent(cameraId)}`;

      const [r, outMap] = await Promise.all([
        fetch(url, { headers }),
        outboundCounts(supabaseUrl, headers, cameraId, fromISO, toISO, granularity),
      ]);
      const dailyRows = r.ok ? (await r.json() as DailyRow[]) : [];

      if (granularity === "week") {
        const weeks: Record<string, WeekAcc> = {};
        for (const d of dailyRows) {
          const monday = getMondayISO(d.date);
          if (!weeks[monday]) weeks[monday] = { period: monday, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0, in: 0, out: 0, avg_queue: 0, avg_speed: 0, _q_sum: 0, _q_n: 0, _s_sum: 0, _s_n: 0 };
          const w = weeks[monday];
          w.total      += d.total_crossings  ?? 0;
          w.car        += d.car_count        ?? 0;
          w.truck      += d.truck_count      ?? 0;
          w.bus        += d.bus_count        ?? 0;
          w.motorcycle += d.motorcycle_count ?? 0;
          w.in         += d.count_in         ?? 0;
          w.out        += d.count_out        ?? 0;
          if (d.avg_queue_depth != null) { w._q_sum += parseFloat(String(d.avg_queue_depth)); w._q_n += 1; }
          if (d.avg_speed_kmh   != null) { w._s_sum += parseFloat(String(d.avg_speed_kmh));   w._s_n += 1; }
        }
        rows = Object.values(weeks).map(w => ({
          period: w.period, total: w.total, car: w.car, truck: w.truck, bus: w.bus, motorcycle: w.motorcycle,
          in: w.in, out: outMap[w.period] ?? w.out,
          avg_queue: w._q_n > 0 ? +(w._q_sum / w._q_n).toFixed(2) : null,
          avg_speed: w._s_n > 0 ? +(w._s_sum / w._s_n).toFixed(1) : null,
        })).sort((a, b) => a.period.localeCompare(b.period));
      } else {
        rows = dailyRows.map(d => ({
          period:     d.date,
          total:      d.total_crossings,
          car:        d.car_count,
          truck:      d.truck_count,
          bus:        d.bus_count,
          motorcycle: d.motorcycle_count,
          in:         d.count_in,
          out:        outMap[d.date] ?? d.count_out ?? 0,
          avg_queue:  d.avg_queue_depth != null ? parseFloat(String(d.avg_queue_depth)) : null,
          avg_speed:  d.avg_speed_kmh   != null ? parseFloat(String(d.avg_speed_kmh))   : null,
          peak_queue: d.peak_queue_depth,
          peak_hour:  d.peak_hour,
        }));
      }

      if (rows.length === 0)
        rows = await hourlyFallback(supabaseUrl, headers, cameraId, fromISO, toISO, "day");
    } else {
      rows = await hourlyData(supabaseUrl, headers, cameraId, fromISO, toISO);
    }

    let periodTotal = 0, peakPeriod: string | null = null, peakVal = 0;
    const classTotals = { car: 0, truck: 0, bus: 0, motorcycle: 0 };
    const qDepths: number[] = [], speeds: number[] = [];
    for (const r of rows) {
      const t = r.total ?? 0;
      periodTotal += t;
      if (t > peakVal) { peakVal = t; peakPeriod = r.period; }
      classTotals.car        += r.car        ?? 0;
      classTotals.truck      += r.truck      ?? 0;
      classTotals.bus        += r.bus        ?? 0;
      classTotals.motorcycle += r.motorcycle ?? 0;
      if (r.avg_queue != null) qDepths.push(parseFloat(String(r.avg_queue)));
      if (r.avg_speed != null) speeds.push(parseFloat(String(r.avg_speed)));
    }

    const grand    = Object.values(classTotals).reduce((a, b) => a + b, 0) || 1;
    const classPct = Object.fromEntries(
      Object.entries(classTotals).map(([k, v]) => [k, Math.round((v / grand) * 100)])
    );

    const [globalTotals, firstDate] = await Promise.all([
      globalTotalsQuery(supabaseUrl, headers, cameraId),
      firstDateQuery(supabaseUrl, headers, cameraId),
    ]);

    return NextResponse.json(
      {
        rows,
        summary: {
          period_total:     periodTotal,
          peak_period:      peakPeriod,
          peak_value:       peakVal,
          class_totals:     classTotals,
          class_pct:        classPct,
          avg_queue_depth:  qDepths.length > 0 ? +(qDepths.reduce((a, b) => a + b, 0) / qDepths.length).toFixed(2) : null,
          peak_queue_depth: qDepths.length > 0 ? Math.max(...qDepths) : null,
          avg_speed_kmh:    speeds.length > 0  ? +(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1) : null,
          global:           globalTotals,
          first_date:       firstDate,
          granularity,
          from: fromISO,
          to:   toISO,
        },
      },
      {
        status: 200,
        headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
      }
    );
  } catch (err) {
    console.error("[/api/analytics?_route=traffic]", err);
    return NextResponse.json({ error: "Analytics query failed" }, { status: 502 });
  }
}

// ── Traffic sub-queries ───────────────────────────────────────────────────────

interface TrafficRow {
  period:     string;
  total:      number | null;
  car:        number | null;
  truck:      number | null;
  bus:        number | null;
  motorcycle: number | null;
  in?:        number | null;
  out?:       number | null;
  avg_queue?: number | null;
  avg_speed?: number | null;
  peak_queue?: number | null;
  peak_hour?:  string | null;
}

interface DailyRow {
  date:              string;
  total_crossings:   number | null;
  car_count:         number | null;
  truck_count:       number | null;
  bus_count:         number | null;
  motorcycle_count:  number | null;
  count_in:          number | null;
  count_out:         number | null;
  avg_queue_depth:   number | string | null;
  avg_speed_kmh:     number | string | null;
  peak_queue_depth?: number | null;
  peak_hour?:        string | null;
}

interface WeekAcc {
  period: string; total: number; car: number; truck: number; bus: number; motorcycle: number;
  in: number; out: number; avg_queue: number; avg_speed: number;
  _q_sum: number; _q_n: number; _s_sum: number; _s_n: number;
}

async function hourlyData(
  supabaseUrl: string,
  headers: Record<string, string>,
  cameraId: string | undefined,
  fromISO: string,
  toISO: string
): Promise<TrafficRow[]> {
  const [rpcRes, outMap] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/rpc/analytics_traffic_hourly`, {
      method: "POST", headers,
      body: JSON.stringify({ p_camera_id: cameraId ?? null, p_since: fromISO }),
    }),
    outboundCounts(supabaseUrl, headers, cameraId, fromISO, toISO, "hour"),
  ]);
  if (rpcRes.ok) {
    const rows = await rpcRes.json() as Array<Record<string, unknown>>;
    if (rows && rows.length > 0)
      return rows.map(r => {
        const key = new Date(r.hour as string).toISOString().slice(0, 13) + ":00:00Z";
        const base = r as unknown as TrafficRow;
        return { ...base, period: r.hour as string, out: outMap[key] ?? 0 };
      });
  }
  // RPC only covers live vehicle_crossings (24h retention).
  // Try unpacking hour_buckets from traffic_daily for historical requests.
  const hist = await hourlyFromDailyBuckets(supabaseUrl, headers, cameraId, fromISO, toISO);
  if (hist.length > 0) return hist;
  return hourlyFallback(supabaseUrl, headers, cameraId, fromISO, toISO, "hour", outMap);
}

async function hourlyFromDailyBuckets(
  supabaseUrl: string,
  headers: Record<string, string>,
  cameraId: string | undefined,
  fromISO: string,
  toISO: string
): Promise<TrafficRow[]> {
  try {
    const fromDate = fromISO.slice(0, 10);
    const toDate   = toISO.slice(0, 10);
    let url = `${supabaseUrl}/rest/v1/traffic_daily`
      + `?select=date,hour_buckets`
      + `&date=gte.${fromDate}&date=lte.${toDate}`
      + `&hour_buckets=not.is.null`
      + `&order=date.asc`;
    if (cameraId) url += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return [];
    const dailyRows = await r.json() as Array<{ date: string; hour_buckets: Record<string, Record<string, number>> | null }>;
    if (!dailyRows || dailyRows.length === 0) return [];

    const result: TrafficRow[] = [];
    for (const d of dailyRows) {
      if (!d.hour_buckets || typeof d.hour_buckets !== "object") continue;
      for (const [hStr, hv] of Object.entries(d.hour_buckets)) {
        const h = parseInt(hStr, 10);
        if (isNaN(h) || h < 0 || h > 23) continue;
        const period = `${d.date}T${String(h).padStart(2, "0")}:00:00Z`;
        result.push({
          period,
          total:      hv.total      ?? 0,
          in:         hv.in         ?? 0,
          out:        hv.out        ?? 0,
          car:        hv.car        ?? 0,
          truck:      hv.truck      ?? 0,
          bus:        hv.bus        ?? 0,
          motorcycle: hv.motorcycle ?? 0,
        });
      }
    }
    return result.sort((a, b) => a.period.localeCompare(b.period));
  } catch { return []; }
}

async function hourlyFallback(
  supabaseUrl: string,
  headers: Record<string, string>,
  cameraId: string | undefined,
  fromISO: string,
  toISO: string,
  targetGranularity: string,
  outMap?: Record<string, number>
): Promise<TrafficRow[]> {
  if (!outMap) outMap = await outboundCounts(supabaseUrl, headers, cameraId, fromISO, toISO, targetGranularity);
  let url = `${supabaseUrl}/rest/v1/vehicle_crossings`
    + `?select=captured_at,vehicle_class,direction,zone_source,track_id`
    + `&captured_at=gte.${encodeURIComponent(fromISO)}`
    + `&captured_at=lte.${encodeURIComponent(toISO)}`
    + `&zone_source=eq.entry`;
  if (cameraId) url += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
  const r = await fetch(url, { headers });
  if (!r.ok) return [];
  const rows = await r.json() as Array<{ captured_at: string; vehicle_class: string; direction: string; track_id?: string }>;
  const seen    = new Set<string>();
  const buckets: Record<string, TrafficRow> = {};
  for (const row of rows) {
    const dt  = new Date(row.captured_at);
    const key = targetGranularity === "hour"
      ? dt.toISOString().slice(0, 13) + ":00:00Z"
      : dt.toISOString().slice(0, 10);
    const dedupeKey = row.track_id != null ? `${key}:${row.track_id}` : null;
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);
    if (!buckets[key]) buckets[key] = { period: key, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0, in: 0, out: 0 };
    buckets[key].total = (buckets[key].total ?? 0) + 1;
    const cls = (row.vehicle_class ?? "car").toLowerCase() as keyof typeof buckets[string];
    if (cls in buckets[key]) (buckets[key][cls] as number) += 1;
    if (row.direction === "in")  buckets[key].in  = (buckets[key].in  ?? 0) + 1;
    if (row.direction === "out") buckets[key].out = (buckets[key].out ?? 0) + 1;
  }
  for (const [key, val] of Object.entries(outMap)) {
    if (buckets[key]) buckets[key].out = val;
  }
  return Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period));
}

async function outboundCounts(
  supabaseUrl: string,
  headers: Record<string, string>,
  cameraId: string | undefined,
  fromISO: string,
  toISO: string,
  targetGranularity: string
): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/analytics_turnings_hourly`, {
      method: "POST", headers,
      body: JSON.stringify({ p_camera_id: cameraId ?? null, p_since: fromISO, p_until: toISO }),
    });
    if (!res.ok) return {};
    const rows = await res.json() as Array<{ hour: string; total: number }>;
    const map: Record<string, number> = {};
    for (const r of rows) {
      const h   = r.hour;
      const key = targetGranularity === "hour"
        ? new Date(h).toISOString().slice(0, 13) + ":00:00Z"
        : targetGranularity === "day"
          ? new Date(h).toISOString().slice(0, 10)
          : getMondayISO(new Date(h).toISOString().slice(0, 10));
      map[key] = (map[key] ?? 0) + Number(r.total ?? 0);
    }
    return map;
  } catch { return {}; }
}

async function firstDateQuery(
  supabaseUrl: string,
  headers: Record<string, string>,
  cameraId: string | undefined
): Promise<string | null> {
  try {
    let url = `${supabaseUrl}/rest/v1/traffic_daily?select=date&order=date.asc&limit=1`;
    if (cameraId) url += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json() as Array<{ date: string }>;
      if (rows[0]?.date) return rows[0].date;
    }
    let vcUrl = `${supabaseUrl}/rest/v1/vehicle_crossings?select=captured_at&zone_source=in.(entry,game)&order=captured_at.asc&limit=1`;
    if (cameraId) vcUrl += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
    const vcr = await fetch(vcUrl, { headers });
    if (!vcr.ok) return null;
    const vcRows = await vcr.json() as Array<{ captured_at: string }>;
    return vcRows[0]?.captured_at?.slice(0, 10) ?? null;
  } catch { return null; }
}

async function globalTotalsQuery(
  supabaseUrl: string,
  headers: Record<string, string>,
  cameraId: string | undefined
): Promise<{ total: number } | null> {
  try {
    let dailyUrl = `${supabaseUrl}/rest/v1/traffic_daily?select=total_crossings`;
    if (cameraId) dailyUrl += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
    const dr = await fetch(dailyUrl, { headers });
    let historicalTotal = 0;
    if (dr.ok) {
      const rows = await dr.json() as Array<{ total_crossings: number | null }>;
      historicalTotal = rows.reduce((sum, r) => sum + (r.total_crossings ?? 0), 0);
    }
    const todayMidnight = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
    let liveUrl = `${supabaseUrl}/rest/v1/vehicle_crossings?select=id&zone_source=eq.entry&captured_at=gte.${encodeURIComponent(todayMidnight)}&limit=1`;
    if (cameraId) liveUrl += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
    const lr = await fetch(liveUrl, { headers: { ...headers, Prefer: "count=exact" } });
    let liveCount = 0;
    if (lr.ok) {
      const range = lr.headers.get("Content-Range");
      liveCount = range ? (parseInt(range.split("/")[1]) || 0) : 0;
    }
    return { total: historicalTotal + liveCount };
  } catch { return null; }
}

// ── /api/analytics?_route=data ───────────────────────────────────────────────

async function handleData(req: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  if (!env) return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  const { supabaseUrl, serviceKey } = env;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  if (type === "zones")    return handleDataZones(req, supabaseUrl, serviceKey);
  if (type === "turnings") return handleDataTurnings(req, supabaseUrl, serviceKey);
  return NextResponse.json({ error: "type must be 'zones' or 'turnings'" }, { status: 400 });
}

async function handleDataZones(req: NextRequest, supabaseUrl: string, serviceKey: string): Promise<NextResponse> {
  const headers = { ...sbHeaders(serviceKey), Prefer: "return=representation" };
  const { searchParams } = new URL(req.url);

  if (req.method === "GET") {
    const cameraId = searchParams.get("camera_id");
    let url = `${supabaseUrl}/rest/v1/camera_zones?active=eq.true&select=id,name,zone_type,points,metadata,color,created_at`;
    if (cameraId) url += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
    url += "&order=created_at.asc";
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) {
        console.error("[zones GET] Supabase error:", await r.text());
        return NextResponse.json({ error: "Zone query failed" }, { status: 502 });
      }
      return NextResponse.json(await r.json());
    } catch (err) {
      console.error("[zones GET]", err);
      return NextResponse.json({ error: "Zone query failed" }, { status: 502 });
    }
  }

  if (req.method === "POST" || req.method === "DELETE") {
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    if (!jwt) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    try {
      const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
      });
      if (!verifyRes.ok) return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      const user = await verifyRes.json() as { app_metadata?: { role?: string } };
      if (user?.app_metadata?.role !== "admin")
        return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "Token verification failed" }, { status: 401 });
    }
  }

  if (req.method === "POST") {
    let body: { camera_id?: string; zones?: unknown[] };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const { camera_id, zones } = body;
    if (!camera_id || !Array.isArray(zones) || !zones.length)
      return NextResponse.json({ error: "camera_id and zones[] required" }, { status: 400 });

    const VALID_ZONE_TYPES = new Set(["detection", "counting", "entry", "exit", "exclusion"]);
    let rows: unknown[];
    try {
      rows = (zones as Array<{ zone_type?: string; name?: string; points?: unknown[]; color?: string }>).slice(0, 50).map(z => {
        if (!VALID_ZONE_TYPES.has(z.zone_type ?? "")) throw new Error("Invalid zone_type");
        if (typeof z.name !== "string" || z.name.length > 100) throw new Error("Invalid name");
        if (!Array.isArray(z.points) || z.points.length > 200) throw new Error("Invalid points");
        const colorHex = /^#[0-9a-fA-F]{3,8}$/.test(z.color ?? "") ? z.color : null;
        return { camera_id, zone_type: z.zone_type, name: z.name.slice(0, 100),
                 points: z.points, metadata: null, color: colorHex, active: true };
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/camera_zones`, {
        method: "POST", headers, body: JSON.stringify(rows),
      });
      if (!r.ok) {
        console.error("[zones POST] Supabase error:", await r.text());
        return NextResponse.json({ error: "Zone write failed" }, { status: 502 });
      }
      return NextResponse.json(await r.json(), { status: 201 });
    } catch (err) {
      console.error("[zones POST]", err);
      return NextResponse.json({ error: "Zone write failed" }, { status: 502 });
    }
  }

  if (req.method === "DELETE") {
    const zoneId = searchParams.get("zone_id");
    if (!zoneId) return NextResponse.json({ error: "zone_id required" }, { status: 400 });
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/camera_zones?id=eq.${encodeURIComponent(zoneId)}`,
        { method: "PATCH", headers, body: JSON.stringify({ active: false }) }
      );
      if (!r.ok) {
        console.error("[zones DELETE] Supabase error:", await r.text());
        return NextResponse.json({ error: "Zone update failed" }, { status: 502 });
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[zones DELETE]", err);
      return NextResponse.json({ error: "Zone update failed" }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

async function handleDataTurnings(req: NextRequest, supabaseUrl: string, serviceKey: string): Promise<NextResponse> {
  if (req.method !== "GET")
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });

  const { searchParams } = new URL(req.url);
  const cameraId    = searchParams.get("camera_id") ?? undefined;
  const granularity = searchParams.get("granularity") ?? "hour";

  const toDateObj   = parseDate(searchParams.get("to"),   new Date());
  const fromDateObj = parseDate(searchParams.get("from"), new Date((toDateObj ?? new Date()).getTime() - 24 * 3600 * 1000));
  if (!fromDateObj || !toDateObj)
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD or ISO 8601." }, { status: 400 });
  const fromISO = fromDateObj.toISOString();
  const toISO   = toDateObj.toISOString();

  function bucketKey(isoStr: string): string {
    const d = new Date(isoStr);
    if (granularity === "day")  return d.toISOString().slice(0, 10);
    if (granularity === "week") {
      const day = d.getUTCDay();
      const mon = new Date(d);
      mon.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
      return mon.toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 13) + ":00:00Z";
  }

  const h = sbHeaders(serviceKey);

  try {
    const rpcBase = { method: "POST" as const, headers: h };
    const tmCountBase = `${supabaseUrl}/rest/v1/turning_movements`
      + `?captured_at=gte.${encodeURIComponent(fromISO)}`
      + `&captured_at=lte.${encodeURIComponent(toISO)}`
      + (cameraId ? `&camera_id=eq.${encodeURIComponent(cameraId)}` : "");

    const [hourlyRes, matrixRes, tmCountRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/rpc/analytics_turnings_hourly`, {
        ...rpcBase,
        body: JSON.stringify({ p_camera_id: cameraId ?? null, p_since: fromISO, p_until: toISO }),
      }),
      fetch(`${supabaseUrl}/rest/v1/rpc/analytics_turnings_matrix`, {
        ...rpcBase,
        body: JSON.stringify({ p_camera_id: cameraId ?? null, p_since: fromISO, p_until: toISO }),
      }),
      fetch(tmCountBase + `&select=id&limit=1`, { headers: { ...h, Prefer: "count=exact" } }),
    ]);

    type HourlyRow = { hour: string; total: number; car: number; truck: number; bus: number; motorcycle: number };
    type MatrixRow = { entry_zone: string; exit_zone: string; total: number; car: number; truck: number; bus: number; motorcycle: number; avg_dwell_ms: number };

    const hourlyRows = hourlyRes.ok ? (await hourlyRes.json() as HourlyRow[]) : [];
    const matrixRows = matrixRes.ok ? (await matrixRes.json() as MatrixRow[]) : [];
    const tmCountRange = tmCountRes.headers?.get("Content-Range") ?? "";
    const totalMovements = parseInt(tmCountRange.split("/")[1] ?? "") || 0;

    const matrix: Record<string, unknown> = {};
    const clsTotals = { car: 0, truck: 0, bus: 0, motorcycle: 0 };
    for (const r of matrixRows) {
      const key = `${r.entry_zone}→${r.exit_zone}`;
      matrix[key] = {
        from: r.entry_zone, to: r.exit_zone,
        total: Number(r.total), car: Number(r.car), truck: Number(r.truck),
        bus: Number(r.bus), motorcycle: Number(r.motorcycle),
        avg_dwell_ms: Number(r.avg_dwell_ms) || 0,
      };
      for (const cls of ["car", "truck", "bus", "motorcycle"] as const)
        clsTotals[cls] += Number(r[cls]) || 0;
    }

    const timeBuckets: Record<string, { period: string; total: number; car: number; truck: number; bus: number; motorcycle: number }> = {};
    for (const r of hourlyRows) {
      const bucket = bucketKey(r.hour);
      if (!timeBuckets[bucket]) timeBuckets[bucket] = { period: bucket, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0 };
      timeBuckets[bucket].total      += Number(r.total);
      timeBuckets[bucket].car        += Number(r.car);
      timeBuckets[bucket].truck      += Number(r.truck);
      timeBuckets[bucket].bus        += Number(r.bus);
      timeBuckets[bucket].motorcycle += Number(r.motorcycle);
    }

    const qFetch = async (from: string, to: string) => {
      let u = `${supabaseUrl}/rest/v1/traffic_snapshots`
        + `?select=captured_at,queue_depth,total_visible`
        + `&captured_at=gte.${encodeURIComponent(from)}`
        + `&captured_at=lte.${encodeURIComponent(to)}&order=captured_at.asc`;
      if (cameraId) u += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
      const r = await fetch(u, { headers: h });
      return r.ok ? (r.json() as Promise<Array<{ captured_at: string; queue_depth: number; total_visible: number }>>) : [];
    };
    let qRows = await qFetch(fromISO, toISO);
    if (!qRows.length) {
      const fallbackFrom = new Date(toDateObj.getTime() - 7 * 24 * 3600 * 1000).toISOString();
      qRows = await qFetch(fallbackFrom, toISO);
    }
    const queueSeries  = qRows.map(r => ({ ts: r.captured_at, depth: r.queue_depth ?? 0, visible: r.total_visible ?? 0 }));
    const depths       = queueSeries.map(r => r.depth);
    const activeDepths = depths.filter(d => d > 0);
    const queueSummary = depths.length > 0
      ? { avg: activeDepths.length > 0 ? +(activeDepths.reduce((a, b) => a + b, 0) / activeDepths.length).toFixed(2) : 0,
          peak: Math.max(...depths), samples: depths.length, active_samples: activeDepths.length }
      : { avg: 0, peak: 0, samples: 0 };

    let speedUrl = `${supabaseUrl}/rest/v1/vehicle_crossings`
      + `?select=speed_kmh&speed_kmh=not.is.null`
      + `&captured_at=gte.${encodeURIComponent(fromISO)}`
      + `&captured_at=lte.${encodeURIComponent(toISO)}`;
    if (cameraId) speedUrl += `&camera_id=eq.${encodeURIComponent(cameraId)}`;

    const spRows  = await fetch(speedUrl, { headers: h }).then(r => r.ok ? r.json() as Promise<Array<{ speed_kmh: number }>> : []);
    const speeds  = (await spRows).map(r => r.speed_kmh).filter(s => s > 0 && s < 300).sort((a, b) => a - b);
    const speedStats = speeds.length > 0
      ? { avg_kmh: +(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1), p85_kmh: speeds[Math.floor(speeds.length * 0.85)] ?? null, min_kmh: speeds[0], max_kmh: speeds[speeds.length - 1], samples: speeds.length }
      : null;

    const downsample = <T>(arr: T[], maxPts: number): T[] => {
      if (arr.length <= maxPts) return arr;
      const step = arr.length / maxPts;
      return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
    };

    return NextResponse.json({
      matrix,
      top_movements: Object.values(matrix).sort((a, b) => (b as { total: number }).total - (a as { total: number }).total).slice(0, 10),
      queue_series: downsample(queueSeries, 50), queue_summary: queueSummary,
      speed: speedStats, class_totals: clsTotals,
      time_series: Object.values(timeBuckets).sort((a, b) => a.period.localeCompare(b.period)),
      period: { from: fromISO, to: toISO, total_movements: totalMovements },
    });
  } catch (err) {
    console.error("[/api/analytics?_route=data&type=turnings]", err);
    return NextResponse.json({ error: "Analytics query failed" }, { status: 502 });
  }
}

// ── /api/analytics?_route=export ─────────────────────────────────────────────

async function handleExport(req: NextRequest): Promise<Response> {
  if (req.method !== "GET")
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!jwt) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const env = getEnv();
  if (!env) return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500, headers: { "Content-Type": "application/json" } });
  const { supabaseUrl, serviceKey } = env;

  try {
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
    });
    if (!verifyRes.ok) return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const user = await verifyRes.json() as { app_metadata?: { role?: string } };
    if (user?.app_metadata?.role !== "admin")
      return new Response(JSON.stringify({ error: "Admin role required for data export" }), { status: 403, headers: { "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "Token verification failed" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const { searchParams } = new URL(req.url);
  const cameraId = searchParams.get("camera_id");
  const _fd = parseDate(searchParams.get("from"), new Date(Date.now() - 24 * 3600 * 1000));
  const _td = parseDate(searchParams.get("to"),   new Date());
  if (!_fd || !_td)
    return new Response(JSON.stringify({ error: "Invalid date format. Use YYYY-MM-DD or ISO 8601." }), { status: 400, headers: { "Content-Type": "application/json" } });

  const diffDays = (_td.getTime() - _fd.getTime()) / 86400000;
  if (diffDays > 90)
    return new Response(JSON.stringify({ error: "Date range exceeds 90 days. Narrow your selection and try again." }), { status: 400, headers: { "Content-Type": "application/json" } });

  const fromDate = _fd.toISOString();
  const toDate   = _td.toISOString();
  const dateStr  = fromDate.slice(0, 10);
  const headers  = sbHeaders(serviceKey);

  try {
    let url = `${supabaseUrl}/rest/v1/vehicle_crossings`
      + `?select=captured_at,track_id,vehicle_class,direction,confidence,scene_lighting,scene_weather,dwell_frames,cameras(name)`
      + `&vehicle_class=in.(car,truck,bus,motorcycle)`
      + `&captured_at=gte.${encodeURIComponent(fromDate)}`
      + `&captured_at=lte.${encodeURIComponent(toDate)}`
      + `&order=captured_at.asc&limit=50000`;
    if (cameraId) url += `&camera_id=eq.${encodeURIComponent(cameraId)}`;

    const dataRes = await fetch(url, { headers });
    if (!dataRes.ok) return new Response(JSON.stringify({ error: "Data query failed" }), { status: 502, headers: { "Content-Type": "application/json" } });

    type CrossingRow = {
      captured_at: string; track_id?: string; vehicle_class: string; direction: string;
      confidence?: number; scene_lighting?: string; scene_weather?: string; dwell_frames?: number;
      cameras?: { name?: string };
    };
    const rows = await dataRes.json() as CrossingRow[];

    const seenTracks = new Set<string>();
    const deduped = rows.filter(r => {
      if (!r.track_id) return true;
      if (seenTracks.has(r.track_id)) return false;
      seenTracks.add(r.track_id); return true;
    });

    if (deduped.length === 0) {
      let dailyUrl = `${supabaseUrl}/rest/v1/traffic_daily`
        + `?select=date,total_crossings,count_in,count_out,cameras(name)`
        + `&date=gte.${encodeURIComponent(fromDate.slice(0, 10))}`
        + `&date=lte.${encodeURIComponent(toDate.slice(0, 10))}`
        + `&order=date.asc`;
      if (cameraId) dailyUrl += `&camera_id=eq.${encodeURIComponent(cameraId)}`;
      const dailyRes  = await fetch(dailyUrl, { headers });
      const dailyRows = dailyRes.ok ? (await dailyRes.json() as Array<{ date: string; total_crossings?: number; count_in?: number; count_out?: number; cameras?: { name?: string } }>) : [];
      if (dailyRows.length === 0) return new Response(null, { status: 204 });

      const csvLines = ["date,camera,total,inbound,outbound"];
      for (const r of dailyRows) {
        csvLines.push([
          csvSanitize(r.date),
          csvSanitize((r.cameras?.name ?? "").replace(/,/g, ";")),
          r.total_crossings ?? "",
          r.count_in  ?? "",
          r.count_out ?? "",
        ].join(","));
      }
      return new Response(csvLines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="traffic-${dateStr}.csv"`,
          "Cache-Control": "no-store",
          "X-Total-Rows": String(dailyRows.length),
        },
      });
    }

    const csvLines = ["timestamp,camera,vehicle_class,direction,confidence,scene_lighting,scene_weather,dwell_frames,track_id"];
    for (const r of deduped) {
      csvLines.push([
        csvSanitize(r.captured_at),
        csvSanitize((r.cameras?.name ?? "").replace(/,/g, ";")),
        csvSanitize(r.vehicle_class),
        csvSanitize(r.direction),
        r.confidence  != null ? r.confidence  : "",
        csvSanitize(r.scene_lighting),
        csvSanitize(r.scene_weather),
        r.dwell_frames != null ? r.dwell_frames : "",
        csvSanitize(r.track_id),
      ].join(","));
    }
    return new Response(csvLines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="traffic-${dateStr}.csv"`,
        "Cache-Control": "no-store",
        "X-Total-Rows": String(deduped.length),
      },
    });
  } catch (err) {
    console.error("[/api/analytics?_route=export]", err);
    return new Response(JSON.stringify({ error: "Export failed" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

// ── /api/analytics?_route=zones ──────────────────────────────────────────────

async function handleZones(req: NextRequest): Promise<NextResponse> {
  if (req.method !== "GET")
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });

  const env = getEnv();
  if (!env) return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  const { supabaseUrl, serviceKey } = env;
  const headers = sbHeaders(serviceKey);

  const { searchParams } = new URL(req.url);
  const cameraId = searchParams.get("camera_id");

  const toISO   = searchParams.get("to")   ? new Date(searchParams.get("to")!).toISOString()   : new Date().toISOString();
  const fromISO = searchParams.get("from") ? new Date(searchParams.get("from")!).toISOString()
                                           : new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  try {
    let url = `${supabaseUrl}/rest/v1/vehicle_crossings`
      + `?select=zone_name,vehicle_class&zone_source=in.(entry,game)`
      + `&captured_at=gte.${encodeURIComponent(fromISO)}`
      + `&captured_at=lte.${encodeURIComponent(toISO)}`;
    if (cameraId) url += `&camera_id=eq.${encodeURIComponent(cameraId)}`;

    const r = await fetch(url, { headers });
    if (!r.ok) return NextResponse.json({ error: "DB query failed" }, { status: 502 });

    const rows = await r.json() as Array<{ zone_name?: string; vehicle_class?: string }>;
    const zones: Record<string, { zone_name: string; total: number; car: number; truck: number; bus: number; motorcycle: number }> = {};
    for (const row of rows) {
      const name = row.zone_name ?? "Unknown";
      if (!zones[name]) zones[name] = { zone_name: name, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0 };
      zones[name].total += 1;
      const cls = (row.vehicle_class ?? "car").toLowerCase() as "car" | "truck" | "bus" | "motorcycle";
      if (cls in zones[name]) zones[name][cls] += 1;
      else zones[name].car += 1;
    }

    const periodTotal = rows.length;
    const zoneList = Object.values(zones)
      .sort((a, b) => b.total - a.total)
      .map(z => ({ ...z, pct_of_total: periodTotal > 0 ? Math.round((z.total / periodTotal) * 100) : 0 }));

    return NextResponse.json({ zones: zoneList, period_total: periodTotal, from: fromISO, to: toISO });
  } catch (err) {
    console.error("[/api/analytics?_route=zones]", err);
    return NextResponse.json({ error: "Zone analytics query failed" }, { status: 502 });
  }
}
