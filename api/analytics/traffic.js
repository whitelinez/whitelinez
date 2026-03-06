/**
 * GET /api/analytics/traffic
 *
 * Query params:
 *   camera_id   — UUID (optional)
 *   hours       — 1-168 (legacy, default 24; used when from/to not supplied)
 *   from        — ISO date/datetime (e.g. "2025-03-01")
 *   to          — ISO date/datetime (e.g. "2025-03-07")
 *   granularity — "hour" | "day" | "week"  (default: "hour")
 *
 * When granularity=day or granularity=week, queries traffic_daily (pre-aggregated).
 * When granularity=hour, queries vehicle_crossings grouped by hour.
 * Always returns global lifetime totals in summary.global.
 *
 * Response:
 * {
 *   rows: [{period, total, car, truck, bus, motorcycle, in, out, avg_queue, avg_speed}],
 *   summary: {
 *     period_total, peak_period, peak_value,
 *     class_totals, class_pct,
 *     avg_queue_depth, peak_queue_depth,
 *     avg_speed_kmh,
 *     global: {total, car, truck, bus, motorcycle},
 *     granularity, from, to
 *   }
 * }
 */
export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: "Server misconfiguration" });

  const { camera_id, hours = "24", from, to, granularity = "hour" } = req.query;

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── Resolve date range ────────────────────────────────────────────────────
  let fromISO, toISO;
  if (from || to) {
    fromISO = from ? new Date(from).toISOString() : new Date(0).toISOString();
    toISO   = to   ? new Date(to).toISOString()   : new Date().toISOString();
  } else {
    const hoursInt = Math.min(168, Math.max(1, parseInt(hours, 10) || 24));
    toISO   = new Date().toISOString();
    fromISO = new Date(Date.now() - hoursInt * 3600 * 1000).toISOString();
  }

  try {
    let rows = [];

    // ── Day/Week granularity → traffic_daily table ─────────────────────────
    if (granularity === "day" || granularity === "week") {
      const fromDate = fromISO.slice(0, 10);
      const toDate   = toISO.slice(0, 10);
      let url = `${SUPABASE_URL}/rest/v1/traffic_daily`
        + `?date=gte.${fromDate}&date=lte.${toDate}`
        + `&order=date.asc&limit=400`;
      if (camera_id) url += `&camera_id=eq.${encodeURIComponent(camera_id)}`;

      const r = await fetch(url, { headers });
      const dailyRows = r.ok ? (await r.json()) : [];

      if (granularity === "week") {
        // Aggregate into ISO weeks
        const weeks = {};
        for (const d of dailyRows) {
          const monday = getMondayISO(d.date);
          if (!weeks[monday]) weeks[monday] = { period: monday, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0, in: 0, out: 0, avg_queue: 0, avg_speed: 0, _q_sum: 0, _q_n: 0, _s_sum: 0, _s_n: 0 };
          const w = weeks[monday];
          w.total       += d.total_crossings || 0;
          w.car         += d.car_count       || 0;
          w.truck       += d.truck_count     || 0;
          w.bus         += d.bus_count       || 0;
          w.motorcycle  += d.motorcycle_count || 0;
          w.in          += d.count_in        || 0;
          w.out         += d.count_out       || 0;
          if (d.avg_queue_depth != null) { w._q_sum += parseFloat(d.avg_queue_depth); w._q_n += 1; }
          if (d.avg_speed_kmh   != null) { w._s_sum += parseFloat(d.avg_speed_kmh);   w._s_n += 1; }
        }
        rows = Object.values(weeks).map(w => ({
          period: w.period, total: w.total, car: w.car, truck: w.truck, bus: w.bus, motorcycle: w.motorcycle,
          in: w.in, out: w.out,
          avg_queue: w._q_n > 0 ? +(w._q_sum / w._q_n).toFixed(2) : null,
          avg_speed: w._s_n > 0 ? +(w._s_sum / w._s_n).toFixed(1) : null,
        })).sort((a, b) => a.period.localeCompare(b.period));
      } else {
        rows = dailyRows.map(d => ({
          period: d.date, total: d.total_crossings, car: d.car_count, truck: d.truck_count,
          bus: d.bus_count, motorcycle: d.motorcycle_count, in: d.count_in, out: d.count_out,
          avg_queue: d.avg_queue_depth, avg_speed: d.avg_speed_kmh,
          peak_queue: d.peak_queue_depth, peak_hour: d.peak_hour,
        }));
      }

      // If no daily data yet, fall back to vehicle_crossings hourly
      if (rows.length === 0) {
        rows = await _hourlyFallback(SUPABASE_URL, headers, camera_id, fromISO, toISO, "day");
      }
    } else {
      // ── Hour granularity → vehicle_crossings via RPC ────────────────────
      rows = await _hourlyData(SUPABASE_URL, headers, camera_id, fromISO, toISO);
    }

    // ── Summary ────────────────────────────────────────────────────────────
    let periodTotal = 0, peakPeriod = null, peakVal = 0;
    const classTotals = { car: 0, truck: 0, bus: 0, motorcycle: 0 };
    const qDepths = [], speeds = [];

    for (const r of rows) {
      const t = r.total || 0;
      periodTotal += t;
      if (t > peakVal) { peakVal = t; peakPeriod = r.period || r.hour; }
      classTotals.car         += r.car          || 0;
      classTotals.truck       += r.truck        || 0;
      classTotals.bus         += r.bus          || 0;
      classTotals.motorcycle  += r.motorcycle   || 0;
      if (r.avg_queue != null) qDepths.push(parseFloat(r.avg_queue));
      if (r.avg_speed != null) speeds.push(parseFloat(r.avg_speed));
    }

    const grand    = Object.values(classTotals).reduce((a, b) => a + b, 0) || 1;
    const classPct = Object.fromEntries(
      Object.entries(classTotals).map(([k, v]) => [k, Math.round((v / grand) * 100)])
    );

    // ── Global lifetime totals + first date ────────────────────────────────
    const [globalTotals, firstDate] = await Promise.all([
      _globalTotals(SUPABASE_URL, headers, camera_id),
      _firstDate(SUPABASE_URL, headers, camera_id),
    ]);

    return res.status(200).json({
      rows,
      summary: {
        period_total:    periodTotal,
        peak_period:     peakPeriod,
        peak_value:      peakVal,
        class_totals:    classTotals,
        class_pct:       classPct,
        avg_queue_depth: qDepths.length > 0 ? +(qDepths.reduce((a, b) => a + b, 0) / qDepths.length).toFixed(2) : null,
        peak_queue_depth: qDepths.length > 0 ? Math.max(...qDepths) : null,
        avg_speed_kmh:   speeds.length > 0   ? +(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1) : null,
        global:          globalTotals,
        first_date:      firstDate,
        granularity,
        from: fromISO,
        to:   toISO,
      },
    });
  } catch (err) {
    console.error("[/api/analytics/traffic]", err);
    return res.status(502).json({ error: "Analytics query failed" });
  }
}

// ── Hourly data via RPC (or fallback) ────────────────────────────────────────
async function _hourlyData(SUPABASE_URL, headers, camera_id, fromISO, toISO) {
  // Try the existing RPC
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analytics_traffic_hourly`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_camera_id: camera_id || null, p_since: fromISO }),
  });
  if (rpcRes.ok) {
    const rows = await rpcRes.json();
    if (rows && rows.length > 0) {
      return rows.map(r => ({ ...r, period: r.hour }));
    }
  }
  // Fallback: direct query
  return _hourlyFallback(SUPABASE_URL, headers, camera_id, fromISO, toISO, "hour");
}

async function _hourlyFallback(SUPABASE_URL, headers, camera_id, fromISO, toISO, targetGranularity) {
  // zone_source=entry → true intersection throughput from named entry zones.
  // Falls back to all rows if no entry-source rows exist yet (e.g. no zones defined).
  let url = `${SUPABASE_URL}/rest/v1/vehicle_crossings`
    + `?select=captured_at,vehicle_class,direction,zone_source`
    + `&captured_at=gte.${encodeURIComponent(fromISO)}`
    + `&captured_at=lte.${encodeURIComponent(toISO)}`
    + `&zone_source=eq.entry`
    + `&limit=10000`;
  if (camera_id) url += `&camera_id=eq.${encodeURIComponent(camera_id)}`;

  const r = await fetch(url, { headers });
  if (!r.ok) return [];
  const rows = await r.json();

  // If no entry-zone rows, fall back to all zone_sources (covers cameras without zones defined)
  const sourceRows = rows.filter(r => r.zone_source === "entry");
  const effectiveRows = sourceRows.length > 0 ? sourceRows : rows;

  const buckets = {};
  for (const row of effectiveRows) {
    const dt   = new Date(row.captured_at);
    const key  = targetGranularity === "hour"
      ? dt.toISOString().slice(0, 13) + ":00:00Z"
      : dt.toISOString().slice(0, 10);
    if (!buckets[key]) buckets[key] = { period: key, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0, in: 0, out: 0 };
    buckets[key].total += 1;
    const cls = (row.vehicle_class || "car").toLowerCase();
    if (cls in buckets[key]) buckets[key][cls] += 1;
    if (row.direction === "in")  buckets[key].in  += 1;
    if (row.direction === "out") buckets[key].out += 1;
  }
  return Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period));
}

async function _firstDate(SUPABASE_URL, headers, camera_id) {
  try {
    let url = `${SUPABASE_URL}/rest/v1/traffic_daily?select=date&order=date.asc&limit=1`;
    if (camera_id) url += `&camera_id=eq.${encodeURIComponent(camera_id)}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0]?.date || null;
  } catch { return null; }
}

async function _globalTotals(SUPABASE_URL, headers, camera_id) {
  try {
    // zone_source=entry → true intersection throughput (not game line).
    // Falls back to all rows if no entry rows yet.
    let url = `${SUPABASE_URL}/rest/v1/vehicle_crossings?select=id&zone_source=eq.entry&limit=1`;
    if (camera_id) url += `&camera_id=eq.${encodeURIComponent(camera_id)}`;
    const r = await fetch(url, {
      headers: { ...headers, Prefer: "count=exact" },
    });
    if (!r.ok) return null;
    const range = r.headers.get("Content-Range"); // "0-0/12345" or "*"
    const total = range ? (parseInt(range.split("/")[1]) || 0) : 0;
    return { total };
  } catch { return null; }
}

function getMondayISO(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
