/**
 * GET /api/bets/history
 * Proxy to backend /bets/history using caller JWT.
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

  const limit = Number(req.query?.limit || 100);
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 100;
  const roundId = String(req.query?.round_id || "").trim();
  const qs = new URLSearchParams({ limit: String(safeLimit) });
  if (roundId) qs.set("round_id", roundId);

  try {
    const upstream = await fetch(`${railwayUrl}/bets/history?${qs.toString()}`, {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    const raw = await upstream.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : [];
    } catch {
      data = { detail: raw || "Upstream returned a non-JSON response" };
    }
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/bets/history] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
