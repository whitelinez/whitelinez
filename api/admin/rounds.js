/**
 * /api/admin/rounds
 * - POST: create round (or create session when mode=sessions)
 * - PATCH: manual override resolve (or stop session when mode=session-stop)
 * - GET: list sessions when mode=sessions
 * Forwards the admin's Supabase JWT — Railway validates it and checks admin role.
 */
export default async function handler(req, res) {
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
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

  const mode = String(req.query?.mode || "").toLowerCase();
  const isSessionList = req.method === "GET" && mode === "sessions";
  const isSessionCreate = req.method === "POST" && mode === "sessions";
  const isSessionStop = req.method === "PATCH" && mode === "session-stop";

  let body = {};
  if (req.method !== "GET") {
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  try {
    let upstreamUrl = `${railwayUrl}/admin/rounds`;
    if (isSessionList || isSessionCreate) {
      upstreamUrl = `${railwayUrl}/admin/round-sessions`;
      if (isSessionList && req.query?.limit) {
        upstreamUrl += `?limit=${encodeURIComponent(String(req.query.limit))}`;
      }
    } else if (isSessionStop) {
      const sid = String(req.query?.id || "");
      if (!sid) return res.status(400).json({ error: "Missing session id" });
      upstreamUrl = `${railwayUrl}/admin/round-sessions/${encodeURIComponent(sid)}/stop`;
    }

    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: req.method === "GET" ? undefined : JSON.stringify(body),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/rounds] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
