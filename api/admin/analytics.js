/**
 * GET /api/admin/analytics?hours=24
 * Proxy admin analytics overview to backend.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }

  const hours = req.query?.hours ? String(req.query.hours) : "24";

  try {
    const upstream = await fetch(`${railwayUrl}/admin/analytics/overview?hours=${encodeURIComponent(hours)}`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/analytics] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
