/**
 * GET /api/analytics/export?camera_id=X&from=ISO&to=ISO
 * Streams vehicle_crossings as CSV. Requires valid Supabase JWT.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check — require Bearer JWT
  const authHeader = req.headers.authorization || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!jwt) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  // Verify JWT is a valid Supabase token (basic check — service role validates via API)
  try {
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!verifyRes.ok) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  } catch {
    return res.status(401).json({ error: "Token verification failed" });
  }

  const { camera_id, from, to } = req.query;

  const fromDate = from || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const toDate = to || new Date().toISOString();
  const dateStr = fromDate.slice(0, 10);

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    let url = `${SUPABASE_URL}/rest/v1/vehicle_crossings?select=captured_at,vehicle_class,direction,confidence,scene_lighting,scene_weather,dwell_frames,cameras(name)&captured_at=gte.${encodeURIComponent(fromDate)}&captured_at=lte.${encodeURIComponent(toDate)}&order=captured_at.asc&limit=50000`;
    if (camera_id) url += `&camera_id=eq.${encodeURIComponent(camera_id)}`;

    const dataRes = await fetch(url, { headers });
    if (!dataRes.ok) {
      return res.status(502).json({ error: "Data query failed" });
    }
    const rows = await dataRes.json();

    // Build CSV
    const csvLines = [
      "timestamp,camera,vehicle_class,direction,confidence,scene_lighting,scene_weather,dwell_frames",
    ];
    for (const r of rows) {
      const cols = [
        r.captured_at || "",
        (r.cameras?.name || "").replace(/,/g, ";"),
        r.vehicle_class || "",
        r.direction || "",
        r.confidence != null ? r.confidence : "",
        r.scene_lighting || "",
        r.scene_weather || "",
        r.dwell_frames != null ? r.dwell_frames : "",
      ];
      csvLines.push(cols.join(","));
    }

    const csv = csvLines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="traffic-${dateStr}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(csv);
  } catch (err) {
    console.error("[/api/analytics/export]", err);
    return res.status(502).json({ error: "Export failed" });
  }
}
