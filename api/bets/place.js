/**
 * POST /api/bets/place
 * Proxy to Railway backend — keeps RAILWAY_BACKEND_URL out of the browser.
 * Forwards the user's Supabase JWT in the Authorization header.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
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

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  try {
    const isLive = String(req.query?.live || "") === "1";
    const upstreamPath = isLive ? "/bets/place-live" : "/bets/place";
    const upstream = await fetch(`${railwayUrl}${upstreamPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
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
    console.error("[/api/bets/place] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
