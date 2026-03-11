"use client";

/**
 * HLSVideo.tsx — HLS.js video player for the live stream.
 *
 * - Dynamically imports HLS.js (window-only, avoids SSR crash)
 * - Native HLS fallback for Safari
 * - Exposes videoRef so sibling canvases can overlay on the same element
 * - Emits onPlayStateChange, onError, onLoad callbacks
 */

import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  type RefObject,
} from "react";

export interface HLSVideoRef {
  videoRef: RefObject<HTMLVideoElement>;
  getVideoLag: () => number;
}

interface HLSVideoProps {
  streamUrl: string;
  onPlayStateChange?: (playing: boolean) => void;
  onError?: (reason: string) => void;
  onLoad?: () => void;
  className?: string;
}

const MEDIA_RECOVERY_MAX = 2;

const HLSVideo = forwardRef<HLSVideoRef, HLSVideoProps>(function HLSVideo(
  { streamUrl, onPlayStateChange, onError, onLoad, className },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<InstanceType<typeof import("hls.js").default> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecoveryRef = useRef(0);

  useImperativeHandle(ref, () => ({
    videoRef: videoRef as RefObject<HTMLVideoElement>,
    getVideoLag,
  }));

  function getVideoLag(): number {
    const vid = videoRef.current;
    if (!vid) return 0;
    try {
      if (!vid.buffered.length) return 0;
      const liveEdge = vid.buffered.end(vid.buffered.length - 1);
      return Math.max(0, (liveEdge - vid.currentTime) * 1000);
    } catch {
      return 0;
    }
  }

  function clearRetry() {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }

  function destroyHls() {
    clearRetry();
    mediaRecoveryRef.current = 0;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }

  useEffect(() => {
    if (!streamUrl) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    async function attachHls() {
      const HlsModule = await import("hls.js");
      const Hls = HlsModule.default;

      if (cancelled || !video) return;

      if (Hls.isSupported()) {
        destroyHls();

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 2,
          maxBufferLength: 4,
          maxMaxBufferLength: 8,
          liveSyncDurationCount: 1,
          liveMaxLatencyDurationCount: 3,
          fragLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 4,
          manifestLoadingMaxRetry: 3,
        });
        hlsRef.current = hls;

        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          mediaRecoveryRef.current = 0;
          onLoad?.();
          video
            .play()
            .then(() => onPlayStateChange?.(true))
            .catch(() => onPlayStateChange?.(false));
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (cancelled || !data.fatal) return;

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (mediaRecoveryRef.current === 0) {
              mediaRecoveryRef.current++;
              hls.recoverMediaError();
              return;
            }
            if (mediaRecoveryRef.current < MEDIA_RECOVERY_MAX) {
              mediaRecoveryRef.current++;
              hls.swapAudioCodec();
              hls.recoverMediaError();
              return;
            }
          }

          const reason = (data as { details?: string }).details ?? "fatal_error";
          onError?.(reason);
          clearRetry();
          retryTimerRef.current = setTimeout(() => {
            if (!cancelled) attachHls();
          }, 6000);
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS
        video.src = streamUrl;
        video.addEventListener(
          "loadedmetadata",
          () => {
            if (cancelled) return;
            onLoad?.();
            video
              .play()
              .then(() => onPlayStateChange?.(true))
              .catch(() => onPlayStateChange?.(false));
          },
          { once: true },
        );
        video.addEventListener(
          "error",
          () => {
            if (!cancelled) onError?.("native_error");
          },
          { once: true },
        );
      } else {
        onError?.("unsupported_browser");
      }
    }

    attachHls().catch(() => onError?.("init_failed"));

    return () => {
      cancelled = true;
      destroyHls();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      className={className}
      aria-label="Live traffic stream"
    />
  );
});

HLSVideo.displayName = "HLSVideo";

export { HLSVideo };
