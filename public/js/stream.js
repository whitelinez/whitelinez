/**
 * stream.js — Load HLS stream using hls.js.
 * Stream URL is never stored in JS — it's fetched from /api/token.
 */

const Stream = (() => {
  let hlsInstance = null;

  async function init(videoEl) {
    const res = await fetch("/api/token");
    if (!res.ok) throw new Error("Failed to get stream token");
    const { wss_url, token } = await res.json();

    // Store token for WebSocket consumers (counter.js, markets.js)
    window._wsToken = token;
    window._wssUrl = wss_url;

    // Stream proxied through Vercel — avoids ipcamlive CORS restriction
    const streamUrl = "/api/stream";

    if (Hls.isSupported()) {
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hlsInstance.loadSource(streamUrl);
      hlsInstance.attachMedia(videoEl);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {
          // Autoplay blocked — show play button
          document.getElementById("play-overlay")?.classList.remove("hidden");
        });
      });
      hlsInstance.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error("[Stream] Fatal HLS error:", data);
          setTimeout(() => init(videoEl), 5000); // retry
        }
      });
    } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      videoEl.src = streamUrl;
      videoEl.addEventListener("loadedmetadata", () => videoEl.play().catch(() => {}));
    } else {
      console.error("[Stream] HLS not supported in this browser");
    }
  }

  function destroy() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  }

  return { init, destroy };
})();

window.Stream = Stream;
