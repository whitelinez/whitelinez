/**
 * /api/admin/ml-models
 * - GET: list model registry rows
 * - POST: promote model
 */
export default async function handler(req, res) {
  const method = req.method || "GET";
  if (!["GET", "POST"].includes(method)) {
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
    if (method === "GET") {
      const limit = req.query?.limit ? String(req.query.limit) : "100";
      const upstream = await fetch(`${railwayUrl}/admin/ml/models?limit=${encodeURIComponent(limit)}`, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
      const data = await upstream.json();
      return res.status(upstream.status).json(data);
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const upstream = await fetch(`${railwayUrl}/admin/ml/models/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/ml-models] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
