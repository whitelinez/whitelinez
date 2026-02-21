/**
 * GET /api/admin/bets
 * Proxy admin recent bets feed from Railway backend.
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

  const limit = Number(req.query?.limit || 200);

  try {
    const upstream = await fetch(`${railwayUrl}/admin/bets?limit=${encodeURIComponent(limit)}`, {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/bets] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
