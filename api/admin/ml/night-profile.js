/**
 * /api/admin/ml/night-profile
 * - GET: fetch runtime night profile settings
 * - PATCH: update runtime night profile settings
 */
export default async function handler(req, res) {
  const method = req.method || "GET";
  if (!["GET", "PATCH"].includes(method)) {
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
    const upstream = await fetch(`${railwayUrl}/admin/ml/night-profile`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: method === "PATCH" ? JSON.stringify(body) : undefined,
    });

    const raw = await upstream.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { detail: raw || "Upstream returned a non-JSON response" };
    }

    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/ml/night-profile] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
