/**
 * GET /api/stream/ts?p=<base64url-encoded-segment-url>
 *
 * Proxies HLS transport-stream segments through Vercel so the upstream
 * camera CDN URL is never visible in the browser's network tab.
 *
 * The Railway backend validates and re-proxies to the actual CDN.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl) {
    return res.status(502).end();
  }

  const p = req.query?.p;
  if (!p || typeof p !== "string" || p.length > 512) {
    return res.status(400).end();
  }

  const backendBase = railwayUrl.replace(/\/+$/, "");
  const segmentUrl = `${backendBase}/stream/ts?p=${encodeURIComponent(p)}`;

  try {
    const upstream = await fetch(segmentUrl, {
      headers: { "User-Agent": "Vercel-SegmentProxy/1.0" },
    });
    if (!upstream.ok) {
      return res.status(502).end();
    }
    const contentType = upstream.headers.get("content-type") || "video/MP2T";
    const buffer = await upstream.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=10");
    return res.status(200).send(Buffer.from(buffer));
  } catch {
    return res.status(502).end();
  }
}
