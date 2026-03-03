/**
 * GET /api/analytics/traffic?camera_id=X&hours=24
 * Returns hourly vehicle crossing aggregates + daily summary.
 * Falls back to ml_detection_events if vehicle_crossings has no data yet.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { camera_id, hours = "24" } = req.query;
  const hoursInt = Math.min(168, Math.max(1, parseInt(hours, 10) || 24));

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const since = new Date(Date.now() - hoursInt * 3600 * 1000).toISOString();

    // ── Primary: vehicle_crossings grouped by hour ──────────────────────────
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analytics_traffic_hourly`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_camera_id: camera_id || null, p_since: since }),
    });

    let hourlyRows = null;
    if (rpcRes.ok) {
      hourlyRows = await rpcRes.json();
    }

    // ── Fallback: ml_detection_events class_counts JSONB ───────────────────
    if (!hourlyRows || hourlyRows.length === 0) {
      let q = `${SUPABASE_URL}/rest/v1/ml_detection_events?select=captured_at,class_counts,new_crossings&captured_at=gte.${encodeURIComponent(since)}&order=captured_at.asc&limit=2000`;
      if (camera_id) q += `&camera_id=eq.${encodeURIComponent(camera_id)}`;

      const fbRes = await fetch(q, { headers });
      const fbRows = fbRes.ok ? await fbRes.json() : [];

      // Aggregate into hourly buckets
      const buckets = {};
      for (const row of fbRows) {
        const hour = row.captured_at?.slice(0, 13) + ":00:00Z";
        if (!buckets[hour]) {
          buckets[hour] = { hour, total: 0, car: 0, truck: 0, bus: 0, motorcycle: 0, in: 0, out: 0 };
        }
        const cc = row.class_counts || {};
        const rowTotal = (cc.car || 0) + (cc.truck || 0) + (cc.bus || 0) + (cc.motorcycle || 0);
        buckets[hour].total += rowTotal;
        buckets[hour].car += cc.car || 0;
        buckets[hour].truck += cc.truck || 0;
        buckets[hour].bus += cc.bus || 0;
        buckets[hour].motorcycle += cc.motorcycle || 0;
        buckets[hour].in += row.new_crossings || 0;
      }
      hourlyRows = Object.values(buckets).sort((a, b) => a.hour.localeCompare(b.hour));
    }

    // ── Summary stats ───────────────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let todayTotal = 0, peakHour = null, peakVal = 0;
    const classTotals = { car: 0, truck: 0, bus: 0, motorcycle: 0 };

    for (const row of hourlyRows) {
      const rowDate = new Date(row.hour);
      if (rowDate >= todayStart) todayTotal += row.total || 0;
      if ((row.total || 0) > peakVal) { peakVal = row.total; peakHour = row.hour; }
      classTotals.car += row.car || 0;
      classTotals.truck += row.truck || 0;
      classTotals.bus += row.bus || 0;
      classTotals.motorcycle += row.motorcycle || 0;
    }

    const grandTotal = classTotals.car + classTotals.truck + classTotals.bus + classTotals.motorcycle || 1;
    const classPct = {
      car: Math.round((classTotals.car / grandTotal) * 100),
      truck: Math.round((classTotals.truck / grandTotal) * 100),
      bus: Math.round((classTotals.bus / grandTotal) * 100),
      motorcycle: Math.round((classTotals.motorcycle / grandTotal) * 100),
    };

    return res.status(200).json({
      hourly: hourlyRows,
      summary: {
        today_total: todayTotal,
        peak_hour: peakHour,
        peak_value: peakVal,
        class_totals: classTotals,
        class_pct: classPct,
        hours_range: hoursInt,
      },
    });
  } catch (err) {
    console.error("[/api/analytics/traffic]", err);
    return res.status(502).json({ error: "Analytics query failed" });
  }
}
