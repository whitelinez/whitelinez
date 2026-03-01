/**
 * GET /api/stream           — HLS manifest proxy
 * GET /api/stream?p=<enc>   — HLS segment proxy (keeps CDN URL hidden from browser)
 *
 * Dual-mode keeps us within Vercel Hobby's 12-function limit.
 */
import crypto from "crypto";

function generateHmacToken(secret) {
  const ts    = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString("hex"); // v2: ts.nonce.sig
  const payload = `${ts}.${nonce}.`;                   // extra="" → trailing dot
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return `${ts}.${nonce}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl) {
    return res.status(500).json({ error: "Stream not configured" });
  }

  const backendBase = railwayUrl.replace(/\/+$/, "");

  // ── Segment proxy mode ──────────────────────────────────────────────────
  // When ?p= is present, forward to Railway /stream/ts which proxies to CDN.
  const p = req.query?.p;
  if (p) {
    if (typeof p !== "string" || p.length > 512) {
      return res.status(400).end();
    }
    try {
      const upstream = await fetch(
        `${backendBase}/stream/ts?p=${encodeURIComponent(p)}`,
        { headers: { "User-Agent": "Vercel-SegmentProxy/1.0" } }
      );
      if (!upstream.ok) return res.status(502).end();
      const contentType = upstream.headers.get("content-type") || "video/MP2T";
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=10");
      return res.status(200).send(Buffer.from(buffer));
    } catch {
      return res.status(502).end();
    }
  }

  // ── Manifest proxy mode ─────────────────────────────────────────────────
  const secret = process.env.WS_AUTH_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Stream not configured" });
  }

  const token = generateHmacToken(secret);
  const aliasRaw = String(req.query?.alias || "").trim();
  const alias = /^[A-Za-z0-9_-]+$/.test(aliasRaw) ? aliasRaw : "";
  const manifestUrl =
    `${backendBase}/stream/live.m3u8?token=${encodeURIComponent(token)}`
    + (alias ? `&alias=${encodeURIComponent(alias)}` : "");

  try {
    const upstream = await fetch(manifestUrl);
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      console.error("[/api/stream] backend status:", upstream.status, body.slice(0, 200));
      return res.status(502).json({ error: "Stream unavailable", upstream_status: upstream.status });
    }
    const text = await upstream.text();
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache, no-store");
    return res.status(200).send(text);
  } catch (err) {
    console.error("[/api/stream] manifest fetch error:", err);
    return res.status(502).json({ error: "Stream unavailable" });
  }
}
