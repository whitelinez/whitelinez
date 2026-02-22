/**
 * POST /api/admin/set-role
 * Proxy admin user operations to Railway backend.
 * - GET: list users (proxies to /admin/users)
 * - POST: set role (proxies to /admin/set-role)
 */
export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
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
    let upstream;
    if (req.method === "GET") {
      const page = Number(req.query?.page || 1);
      const perPage = Number(req.query?.per_page || 200);
      upstream = await fetch(
        `${railwayUrl}/admin/users?page=${encodeURIComponent(page)}&per_page=${encodeURIComponent(perPage)}`,
        {
          method: "GET",
          headers: { Authorization: authHeader },
        }
      );
    } else {
      let body;
      try {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
      upstream = await fetch(`${railwayUrl}/admin/set-role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(body),
      });
    }

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/set-role] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
