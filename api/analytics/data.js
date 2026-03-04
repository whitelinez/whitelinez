/**
 * GET/POST/DELETE /api/analytics/data?type=zones|turnings
 *
 * type=zones:
 *   GET    ?camera_id=X            → list active zones
 *   POST   body:{camera_id,zones}  → bulk insert
 *   DELETE ?zone_id=X              → soft-delete (active=false)
 *
 * type=turnings:
 *   GET    ?camera_id=X&from=ISO&to=ISO → turning matrix + queue series + speed stats
 */
export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: "Server misconfiguration" });

  const { type } = req.query;
  if (type === "zones")    return handleZones(req, res, SUPABASE_URL, SERVICE_KEY);
  if (type === "turnings") return handleTurnings(req, res, SUPABASE_URL, SERVICE_KEY);
  return res.status(400).json({ error: "type must be 'zones' or 'turnings'" });
}

// ── ZONES ─────────────────────────────────────────────────────────────────────
async function handleZones(req, res, SUPABASE_URL, SERVICE_KEY) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  if (req.method === "GET") {
    const { camera_id } = req.query;
    let url = `${SUPABASE_URL}/rest/v1/camera_zones?active=eq.true&select=id,name,zone_type,points,metadata,color,created_at`;
    if (camera_id) url += `&camera_id=eq.${encodeURIComponent(camera_id)}`;
    url += "&order=created_at.asc";
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json(await r.json());
    } catch (err) { return res.status(502).json({ error: String(err) }); }
  }

  if (req.method === "POST") {
    const { camera_id, zones } = req.body || {};
    if (!camera_id || !Array.isArray(zones) || !zones.length)
      return res.status(400).json({ error: "camera_id and zones[] required" });
    const rows = zones.map(z => ({
      camera_id,
      zone_type: z.zone_type,
      name:      z.name,
      points:    z.points,
      metadata:  z.metadata || null,
      color:     z.color || null,
      active:    true,
    }));
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/camera_zones`, {
        method: "POST", headers, body: JSON.stringify(rows),
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(201).json(await r.json());
    } catch (err) { return res.status(502).json({ error: String(err) }); }
  }

  if (req.method === "DELETE") {
    const { zone_id } = req.query;
    if (!zone_id) return res.status(400).json({ error: "zone_id required" });
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/camera_zones?id=eq.${encodeURIComponent(zone_id)}`,
        { method: "PATCH", headers, body: JSON.stringify({ active: false }) }
      );
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json({ ok: true });
    } catch (err) { return res.status(502).json({ error: String(err) }); }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ── TURNINGS ──────────────────────────────────────────────────────────────────
async function handleTurnings(req, res, SUPABASE_URL, SERVICE_KEY) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const { camera_id, from, to } = req.query;
  const toDate   = to   ? new Date(to)   : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate - 24 * 3600 * 1000);
  const fromISO  = fromDate.toISOString();
  const toISO    = toDate.toISOString();

  const h = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // ── Turning movements ──────────────────────────────────────────────────
    let tmUrl = `${SUPABASE_URL}/rest/v1/turning_movements`
      + `?select=entry_zone,exit_zone,vehicle_class,dwell_ms,captured_at`
      + `&captured_at=gte.${encodeURIComponent(fromISO)}`
      + `&captured_at=lte.${encodeURIComponent(toISO)}`
      + `&limit=5000`;
    if (camera_id) tmUrl += `&camera_id=eq.${encodeURIComponent(camera_id)}`;

    const tmRows = await fetch(tmUrl, { headers: h }).then(r => r.ok ? r.json() : []);

    const matrix = {};
    const clsTotals = { car: 0, truck: 0, bus: 0, motorcycle: 0 };
    const hourly = {};
    for (const r of tmRows) {
      const key = `${r.entry_zone}→${r.exit_zone}`;
      if (!matrix[key]) matrix[key] = { from: r.entry_zone, to: r.exit_zone, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0, avg_dwell_ms: 0, _dwell_sum: 0 };
      matrix[key].total += 1;
      const cls = (r.vehicle_class || "car").toLowerCase();
      if (cls in matrix[key]) matrix[key][cls] += 1;
      if (cls in clsTotals)   clsTotals[cls] += 1;
      if (r.dwell_ms) matrix[key]._dwell_sum += r.dwell_ms;
      // Hourly bucket
      if (r.captured_at) {
        const hour = new Date(r.captured_at).toISOString().slice(0, 13) + ":00:00Z";
        if (!hourly[hour]) hourly[hour] = { period: hour, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0 };
        hourly[hour].total += 1;
        if (cls in hourly[hour]) hourly[hour][cls] += 1;
      }
    }
    for (const k of Object.keys(matrix)) {
      const m = matrix[k];
      m.avg_dwell_ms = m.total > 0 ? Math.round(m._dwell_sum / m.total) : 0;
      delete m._dwell_sum;
    }
    const topMovements = Object.values(matrix).sort((a, b) => b.total - a.total).slice(0, 10);
    const hourlySeries = Object.values(hourly).sort((a, b) => a.period.localeCompare(b.period));

    // ── Queue series ───────────────────────────────────────────────────────
    let qUrl = `${SUPABASE_URL}/rest/v1/traffic_snapshots`
      + `?select=captured_at,queue_depth,total_visible`
      + `&captured_at=gte.${encodeURIComponent(fromISO)}`
      + `&captured_at=lte.${encodeURIComponent(toISO)}`
      + `&order=captured_at.asc&limit=2000`;
    if (camera_id) qUrl += `&camera_id=eq.${encodeURIComponent(camera_id)}`;

    const qRows = await fetch(qUrl, { headers: h }).then(r => r.ok ? r.json() : []);
    const queueSeries = qRows.map(r => ({ ts: r.captured_at, depth: r.queue_depth || 0, visible: r.total_visible || 0 }));
    const depths = queueSeries.map(r => r.depth);
    const queueSummary = depths.length > 0
      ? { avg: +(depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(2), peak: Math.max(...depths), samples: depths.length }
      : { avg: 0, peak: 0, samples: 0 };

    // ── Speed stats ────────────────────────────────────────────────────────
    let speedUrl = `${SUPABASE_URL}/rest/v1/vehicle_crossings`
      + `?select=speed_kmh&speed_kmh=not.is.null`
      + `&captured_at=gte.${encodeURIComponent(fromISO)}`
      + `&captured_at=lte.${encodeURIComponent(toISO)}`
      + `&limit=2000`;
    if (camera_id) speedUrl += `&camera_id=eq.${encodeURIComponent(camera_id)}`;

    const spRows = await fetch(speedUrl, { headers: h }).then(r => r.ok ? r.json() : []);
    const speeds = spRows.map(r => r.speed_kmh).filter(s => s > 0 && s < 300).sort((a, b) => a - b);
    const speedStats = speeds.length > 0
      ? { avg_kmh: +(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1), p85_kmh: speeds[Math.floor(speeds.length * 0.85)] || null, min_kmh: speeds[0], max_kmh: speeds[speeds.length - 1], samples: speeds.length }
      : null;

    return res.status(200).json({
      matrix, top_movements: topMovements, queue_series: queueSeries,
      queue_summary: queueSummary, speed: speedStats, class_totals: clsTotals,
      hourly_series: hourlySeries,
      period: { from: fromISO, to: toISO, total_movements: tmRows.length },
    });
  } catch (err) {
    console.error("[/api/analytics/data?type=turnings]", err);
    return res.status(502).json({ error: "Analytics query failed" });
  }
}
