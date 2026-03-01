/**
 * stream.js — Load HLS stream using hls.js.
 * Stream URL is never stored in JS — it's fetched from /api/token.
 */

const Stream = (() => {
  let hlsInstance = null;
  let currentAlias = "";
  let currentVideoEl = null;
  let retryTimer = null;
  let _wssUrl = null;   // Railway WS URL — kept in module scope, NOT on window

  function emitStatus(status, detail = {}) {
    window.dispatchEvent(new CustomEvent("stream:status", { detail: { status, ...detail } }));
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function buildStreamUrl() {
    // Always route through the Vercel proxy — never expose the upstream URL.
    const qs = currentAlias ? `?alias=${encodeURIComponent(currentAlias)}` : "";
    return `/api/stream${qs}`;
  }

  async function init(videoEl, opts = {}) {
    currentVideoEl = videoEl;
    if (opts && Object.prototype.hasOwnProperty.call(opts, "alias")) {
      currentAlias = String(opts.alias || "").trim();
    }
    clearRetry();
    const res = await fetch("/api/token");
    if (!res.ok) throw new Error("Failed to get stream token");
    const { wss_url, token } = await res.json();

    // Share token with other modules (counter.js etc.) via window.
    // wss_url is kept in module scope only — not exposed on window.
    window._wsToken = token;
    _wssUrl = wss_url;

    // Stream proxied through Vercel — avoids ipcamlive CORS restriction
    const streamUrl = buildStreamUrl();

    if (Hls.isSupported()) {
      destroy();
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hlsInstance.loadSource(streamUrl);
      hlsInstance.attachMedia(videoEl);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        emitStatus("ok", { alias: currentAlias });
        videoEl.play().catch(() => {
          // Autoplay blocked — show play button
          document.getElementById("play-overlay")?.classList.remove("hidden");
        });
      });
      hlsInstance.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          // Log type/details only — do not log the full data object (may contain URLs).
          console.error("[Stream] Fatal HLS error:", data?.type, data?.details);
          emitStatus("down", { alias: currentAlias, reason: data?.details || "fatal_error" });
          clearRetry();
          retryTimer = setTimeout(() => init(videoEl, { alias: currentAlias }), 5000); // retry
        }
      });
    } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      videoEl.src = streamUrl;
      videoEl.addEventListener("loadedmetadata", () => {
        emitStatus("ok", { alias: currentAlias });
        videoEl.play().catch(() => {});
      });
      videoEl.addEventListener("error", () => {
        emitStatus("down", { alias: currentAlias, reason: "native_error" });
      });
    } else {
      console.error("[Stream] HLS not supported in this browser");
      emitStatus("down", { alias: currentAlias, reason: "unsupported_browser" });
    }
  }

  function setAlias(alias) {
    currentAlias = String(alias || "").trim();
    if (currentVideoEl) {
      init(currentVideoEl, { alias: currentAlias });
    }
  }

  function destroy() {
    clearRetry();
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  }

  function getWssUrl() { return _wssUrl; }

  return { init, destroy, setAlias, getWssUrl };
})();

window.Stream = Stream;
