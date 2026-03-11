"use client";
/**
 * hooks/useWebSocketLive.ts
 * WebSocket hook for the public /ws/live endpoint.
 * Ports the logic from counter.js + ws_public.py integration.
 *
 * Usage:
 *   const { count, detections, roundInfo, isConnected, wsStatus } = useWebSocketLive(cameraId)
 *
 * Features:
 *   - Fetches HMAC token from /api/token
 *   - Connects to wss_url returned by token endpoint
 *   - Exponential backoff reconnect (2s initial → 30s max)
 *   - Token refresh before expiry (4 min TTL cache)
 *   - Dispatches legacy DOM events for backward compat with vanilla JS modules
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_EVENTS, TIMING } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

/** Canonical Detection shape — matches DetectionCanvas props */
export interface Detection {
  x1:              number;
  y1:              number;
  x2:              number;
  y2:              number;
  label?:          string;
  confidence?:     number;
  conf?:           number;
  cls?:            string;
  cls_id?:         number;
  color?:          string;
  tracker_id?:     number;
  in_detect_zone?: boolean;
  track_id?:       number | string;
  /** Raw bbox array from WS if server sends [x1,y1,x2,y2] format */
  bbox?:           [number, number, number, number];
}

export interface RoundInfo {
  id:                   string;
  status:               string;
  window_duration_sec:  number;
  started_at:           string | null;
  ends_at:              string | null;
  current_count?:       number;
  [key: string]:        unknown;
}

export type WsStatus = "connecting" | "connected" | "disconnected" | "error";

export interface UseWebSocketLiveReturn {
  count:       number;
  detections:  Detection[];
  roundInfo:   RoundInfo | null;
  isConnected: boolean;
  wsStatus:    WsStatus;
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface TokenCache {
  token:    string;
  wssUrl:   string;
  fetchedAt: number;  // ms timestamp
}

let _tokenCache: TokenCache | null = null;

async function fetchWsToken(): Promise<TokenCache> {
  // Return cached token if still within TTL window
  if (_tokenCache && Date.now() - _tokenCache.fetchedAt < TIMING.WS_TOKEN_TTL_MS) {
    return _tokenCache;
  }

  const res = await fetch("/api/token");
  if (!res.ok) throw new Error(`[useWebSocketLive] token fetch failed: ${res.status}`);

  const data = await res.json() as { token: string; wss_url: string; expires_in: number };
  _tokenCache = { token: data.token, wssUrl: data.wss_url, fetchedAt: Date.now() };
  return _tokenCache;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWebSocketLive(cameraId?: string): UseWebSocketLiveReturn {
  const [count,       setCount]       = useState<number>(0);
  const [detections,  setDetections]  = useState<Detection[]>([]);
  const [roundInfo,   setRoundInfo]   = useState<RoundInfo | null>(null);
  const [wsStatus,    setWsStatus]    = useState<WsStatus>("disconnected");

  const wsRef         = useRef<WebSocket | null>(null);
  const backoffRef    = useRef<number>(TIMING.WS_BACKOFF_INITIAL);
  const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef  = useRef<boolean>(false);

  // ── Message handler ────────────────────────────────────────────────────────
  const handleMessage = useCallback((raw: string) => {
    let msg: { type?: string; event?: string; [key: string]: unknown };
    try { msg = JSON.parse(raw); }
    catch { return; }

    const type = (msg.type ?? msg.event ?? "") as string;

    switch (type) {
      case WS_EVENTS.COUNT_UPDATE: {
        const total = (msg.count ?? msg.total ?? 0) as number;
        setCount(total);
        if (msg.detections) setDetections(msg.detections as Detection[]);
        // Legacy DOM event for vanilla JS modules still in the tree
        document.dispatchEvent(new CustomEvent(WS_EVENTS.COUNT_UPDATE, { detail: msg }));
        break;
      }
      case WS_EVENTS.ROUND_UPDATE: {
        setRoundInfo(msg as RoundInfo);
        document.dispatchEvent(new CustomEvent(WS_EVENTS.ROUND_UPDATE, { detail: msg }));
        break;
      }
      case WS_EVENTS.DEMO_MODE: {
        document.dispatchEvent(new CustomEvent(WS_EVENTS.DEMO_MODE, { detail: msg }));
        break;
      }
      case WS_EVENTS.BET_PLACED: {
        document.dispatchEvent(new CustomEvent(WS_EVENTS.BET_PLACED, { detail: msg }));
        break;
      }
      case WS_EVENTS.BET_RESOLVED: {
        document.dispatchEvent(new CustomEvent(WS_EVENTS.BET_RESOLVED, { detail: msg }));
        break;
      }
      case WS_EVENTS.SESSION_GUEST: {
        document.dispatchEvent(new CustomEvent(WS_EVENTS.SESSION_GUEST, { detail: msg }));
        break;
      }
      default:
        break;
    }
  }, []);

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (unmountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    // Close any existing socket cleanly before reconnecting
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000, "reconnect");
      wsRef.current = null;
    }

    setWsStatus("connecting");

    let tokenData: TokenCache;
    try {
      tokenData = await fetchWsToken();
    } catch (err) {
      console.error("[useWebSocketLive] token error:", err);
      setWsStatus("error");
      scheduleReconnect();
      return;
    }

    if (unmountedRef.current) return;

    // Build WSS URL with token (and optional camera alias)
    let wssUrl = `${tokenData.wssUrl}?token=${encodeURIComponent(tokenData.token)}`;
    if (cameraId) wssUrl += `&alias=${encodeURIComponent(cameraId)}`;

    const ws = new WebSocket(wssUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      setWsStatus("connected");
      backoffRef.current = TIMING.WS_BACKOFF_INITIAL; // reset backoff on successful connect
    };

    ws.onmessage = (event) => {
      handleMessage(typeof event.data === "string" ? event.data : "");
    };

    ws.onerror = () => {
      if (unmountedRef.current) return;
      setWsStatus("error");
    };

    ws.onclose = (event) => {
      if (unmountedRef.current) return;
      // 1000/1001 = normal close, don't log as error
      if (event.code !== 1000 && event.code !== 1001) {
        console.warn(`[useWebSocketLive] closed code=${event.code} reason="${event.reason}"`);
      }
      setWsStatus("disconnected");
      scheduleReconnect();
    };
  }, [cameraId, handleMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reconnect with exponential backoff ────────────────────────────────────
  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, TIMING.WS_BACKOFF_MAX);
    reconnTimerRef.current = setTimeout(() => {
      if (!unmountedRef.current) connect();
    }, delay);
  }, [connect]);

  // ── Token refresh before expiry ───────────────────────────────────────────
  // Re-connect when the cached token approaches expiry to avoid mid-session drops
  useEffect(() => {
    const refreshTimer = setInterval(() => {
      if (unmountedRef.current) return;
      // Invalidate cache to force a fresh token on next connect
      _tokenCache = null;
      // Only reconnect if already connected — no need to disrupt a disconnected state
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, "token-refresh");
        // onclose handler will trigger scheduleReconnect → connect with fresh token
      }
    }, TIMING.WS_TOKEN_TTL_MS);

    return () => clearInterval(refreshTimer);
  }, []);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, "unmount");
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    count,
    detections,
    roundInfo,
    isConnected: wsStatus === "connected",
    wsStatus,
  };
}
