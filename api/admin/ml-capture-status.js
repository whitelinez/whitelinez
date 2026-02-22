/**
 * /api/admin/ml-capture-status
 * - GET: fetch backend live capture/upload status and recent events
 */
export default async function handler(req, res) {
  if ((req.method || "GET") !== "GET") {
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

  try {
    const limit = Number(req.query?.limit || 50);
    const upstream = await fetch(`${railwayUrl}/admin/ml/capture-status?limit=${Number.isFinite(limit) ? limit : 50}`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/ml-capture-status] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
