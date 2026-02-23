/**
 * /api/admin/[...route]
 * Catch-all admin proxy to Railway backend.
 * Reduces function count for Vercel Hobby plan limits.
 */
export const config = {
  maxDuration: 300,
};

function routeFromUrl(url) {
  try {
    const u = new URL(url || "", "http://localhost");
    const parts = (u.pathname || "")
      .split("/")
      .filter(Boolean);
    const apiIdx = parts.indexOf("api");
    const adminIdx = parts.indexOf("admin");
    if (apiIdx === -1 || adminIdx === -1 || adminIdx <= apiIdx) return [];
    return parts.slice(adminIdx + 1);
  } catch {
    return [];
  }
}

function buildQuery(reqQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(reqQuery || {})) {
    if (k === "route") continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, String(item));
    } else if (typeof v !== "undefined") {
      params.set(k, String(v));
    }
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

export default async function handler(req, res) {
  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }

  const rawRoute = req.query?.route;
  let routeParts = Array.isArray(rawRoute)
    ? rawRoute
    : (typeof rawRoute === "string" && rawRoute.trim() ? [rawRoute] : []);
  if (!routeParts.length) {
    routeParts = routeFromUrl(req.url);
  }
  if (!routeParts.length) {
    return res.status(400).json({ error: "Missing admin route" });
  }

  const upstreamPath = routeParts.map((s) => encodeURIComponent(String(s))).join("/");
  const upstreamUrl = `${railwayUrl}/admin/${upstreamPath}${buildQuery(req.query)}`;
  const method = req.method || "GET";

  try {
    const headers = {
      Authorization: authHeader,
      "Content-Type": "application/json",
    };
    const init = { method, headers };

    if (!["GET", "HEAD"].includes(method)) {
      const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
      init.body = body;
    }

    const upstream = await fetch(upstreamUrl, init);
    const raw = await upstream.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { detail: raw || "Upstream returned a non-JSON response" };
    }
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[/api/admin/[...route]] Upstream error:", err);
    return res.status(502).json({ error: "Upstream request failed" });
  }
}
