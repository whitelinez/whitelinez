/**
 * GET /api/bets/my-round
 * Proxy to backend /bets/my-round using caller JWT.
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

  const roundId = String(req.query?.round_id || "").trim();
  if (!roundId) {
    return res.status(400).json({ error: "Missing round_id" });
  }

  const limit = Number(req.query?.limit || 20);
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20;
  const qs = new URLSearchParams({
    round_id: roundId,
    limit: String(safeLimit),
  });

  try {
    const upstream = await fetch(`${railwayUrl}/bets/my-round?${qs.toString()}`, {
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
    console.error("[/api/bets/my-round] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
