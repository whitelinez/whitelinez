/**
 * GET /api/stream  — returns a 302 redirect to the Railway HLS manifest.
 * HLS.js follows the redirect and fetches manifest + segments directly from
 * Railway, so no video bytes pass through Vercel (eliminates Fast Origin
 * Transfer costs).
 *
 * Edge Function: minimal — just mints an HMAC token and redirects.
 */
export const config = { runtime: "edge" };

async function generateHmacToken(secret) {
  const ts         = Math.floor(Date.now() / 1000).toString();
  const nonceBytes = new Uint8Array(8);
  crypto.getRandomValues(nonceBytes);
  const nonce   = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const payload = `${ts}.${nonce}.`;

  const encoder = new TextEncoder();
  const key     = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const sig    = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${ts}.${nonce}.${sig}`;
}

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  const secret     = process.env.WS_AUTH_SECRET;
  if (!railwayUrl || !secret) {
    return new Response(JSON.stringify({ error: "Stream not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const backendBase = railwayUrl.replace(/\/+$/, "");
  const url         = new URL(req.url);
  const aliasRaw    = (url.searchParams.get("alias") || "").trim();
  const alias       = /^[A-Za-z0-9_-]+$/.test(aliasRaw) ? aliasRaw : "";

  const token       = await generateHmacToken(secret);
  const manifestUrl = `${backendBase}/stream/live.m3u8?token=${encodeURIComponent(token)}`
    + (alias ? `&alias=${encodeURIComponent(alias)}` : "");

  // Redirect — HLS.js follows this and fetches stream + segments directly
  // from Railway. Zero video bytes pass through Vercel.
  return Response.redirect(manifestUrl, 302);
}
