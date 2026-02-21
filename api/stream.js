/**
 * GET /api/stream
 * Server-side proxy for the HLS manifest.
 * Vercel fetches from ipcamlive (no CORS/block issues) and returns it to the browser.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const streamUrl = process.env.HLS_STREAM_URL;
  if (!streamUrl) {
    return res.status(500).json({ error: "Stream not configured" });
  }

  let response;
  try {
    response = await fetch(streamUrl, {
      headers: {
        "Referer": "https://www.ipcamlive.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    });
  } catch (err) {
    console.error("[/api/stream] fetch error:", err);
    return res.status(502).json({ error: "Stream unavailable" });
  }

  if (!response.ok) {
    console.error("[/api/stream] upstream status:", response.status);
    return res.status(502).json({ error: "Stream unavailable" });
  }

  const text = await response.text();

  // Rewrite relative URLs in the manifest to absolute ipcamlive URLs
  const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf("/") + 1);
  const rewritten = text
    .split("\n")
    .map((line) => {
      const stripped = line.trim();
      if (stripped && !stripped.startsWith("#") && !stripped.startsWith("http")) {
        return baseUrl + stripped;
      }
      return line;
    })
    .join("\n");

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-cache, no-store");
  return res.status(200).send(rewritten);
}
