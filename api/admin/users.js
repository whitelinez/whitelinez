/**
 * GET /api/admin/users
 * Proxy admin users list to Railway backend.
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

  try {
    const page = Number(req.query?.page || 1);
    const perPage = Number(req.query?.per_page || 200);
    const upstream = await fetch(
      `${railwayUrl}/admin/users?page=${encodeURIComponent(page)}&per_page=${encodeURIComponent(perPage)}`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      }
    );

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/users] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
