/**
 * /api/admin/ml-retrain
 * - POST: trigger backend ML retraining pipeline
 */
export default async function handler(req, res) {
  if ((req.method || "GET") !== "POST") {
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
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const upstream = await fetch(`${railwayUrl}/admin/ml/retrain`, {
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
    console.error("[/api/admin/ml-retrain] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
