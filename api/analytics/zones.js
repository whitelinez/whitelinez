/**
 * GET /api/analytics/zones
 *
 * Returns per-zone entry breakdown for the analytics overlay.
 *
 * Query params:
 *   camera_id  — UUID (required)
 *   from       — ISO datetime (default: 24h ago)
 *   to         — ISO datetime (default: now)
 *
 * Response:
 * {
 *   zones: [{ zone_name, total, car, truck, bus, motorcycle, pct_of_total }],
 *   period_total: number,
 *   from: ISO, to: ISO
 * }
 */
export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: "Server misconfiguration" });

  const { camera_id, from, to } = req.query;
  if (!camera_id)
    return res.status(400).json({ error: "camera_id is required" });

  const toISO   = to   ? new Date(to).toISOString()   : new Date().toISOString();
  const fromISO = from ? new Date(from).toISOString()
                       : new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const url = `${SUPABASE_URL}/rest/v1/vehicle_crossings`
      + `?select=zone_name,vehicle_class`
      + `&zone_source=eq.entry`
      + `&camera_id=eq.${encodeURIComponent(camera_id)}`
      + `&captured_at=gte.${encodeURIComponent(fromISO)}`
      + `&captured_at=lte.${encodeURIComponent(toISO)}`
      + `&limit=50000`;

    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(502).json({ error: "DB query failed" });
    const rows = await r.json();

    // Aggregate by zone_name
    const zones = {};
    for (const row of rows) {
      const name = row.zone_name || "Unknown";
      if (!zones[name]) {
        zones[name] = { zone_name: name, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0 };
      }
      zones[name].total += 1;
      const cls = (row.vehicle_class || "car").toLowerCase();
      if (cls in zones[name]) zones[name][cls] += 1;
      else zones[name].car += 1;
    }

    const periodTotal = rows.length;
    const zoneList = Object.values(zones)
      .sort((a, b) => b.total - a.total)
      .map(z => ({
        ...z,
        pct_of_total: periodTotal > 0 ? Math.round((z.total / periodTotal) * 100) : 0,
      }));

    return res.status(200).json({ zones: zoneList, period_total: periodTotal, from: fromISO, to: toISO });
  } catch (err) {
    console.error("[/api/analytics/zones]", err);
    return res.status(502).json({ error: "Zone analytics query failed" });
  }
}
