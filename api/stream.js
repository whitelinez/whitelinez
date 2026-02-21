/**
 * GET /api/stream
 * Server-side HLS manifest proxy.
 * Reads the current stream URL from Supabase (kept fresh by Railway url_refresh_loop),
 * fetches the manifest from ipcamlive server-side (no CORS issues), rewrites
 * relative segment URLs to absolute, and returns to the browser.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  // Read the current stream URL from Supabase cameras table
  let streamUrl;
  try {
    const camResp = await fetch(
      `${supabaseUrl}/rest/v1/cameras?is_active=eq.true&select=stream_url&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    if (!camResp.ok) {
      throw new Error(`Supabase returned ${camResp.status}`);
    }
    const [cam] = await camResp.json();
    streamUrl = cam?.stream_url;
  } catch (err) {
    console.error("[/api/stream] Supabase fetch error:", err);
    return res.status(502).json({ error: "Could not fetch stream config" });
  }

  if (!streamUrl) {
    return res.status(503).json({ error: "Stream URL not yet available — try again shortly" });
  }

  // Fetch the HLS manifest from ipcamlive server-side
  let response;
  try {
    response = await fetch(streamUrl, {
      headers: {
        Referer: "https://www.ipcamlive.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    });
  } catch (err) {
    console.error("[/api/stream] fetch error:", err);
    return res.status(502).json({ error: "Stream unavailable" });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[/api/stream] upstream status:", response.status, body.slice(0, 200));
    return res.status(502).json({ error: "Stream unavailable", upstream_status: response.status });
  }

  const text = await response.text();

  // Rewrite relative segment/playlist URLs to absolute ipcamlive URLs
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
