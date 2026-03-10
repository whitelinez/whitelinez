/**
 * GET /api/demo
 * Proxies the public demo manifest from the Railway backend.
 * Returns {available, video_url, events_url, duration_sec, recorded_at} or {available:false}.
 */
export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const backendBase = (process.env.RAILWAY_BACKEND_URL || "").replace(/\/+$/, "");
  if (!backendBase) {
    return new Response(JSON.stringify({ available: false }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  try {
    const upstream = await fetch(`${backendBase}/demo/manifest`, {
      headers: { "User-Agent": "Vercel-DemoProxy/1.0" },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.ok ? 200 : 502,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response(JSON.stringify({ available: false }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
