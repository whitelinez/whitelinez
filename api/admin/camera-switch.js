export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl)
    return res.status(500).json({ error: "Server misconfiguration" });

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing Bearer token" });

  try {
    const upstream = await fetch(`${railwayUrl}/admin/camera-switch`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body || {}),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/camera-switch] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
