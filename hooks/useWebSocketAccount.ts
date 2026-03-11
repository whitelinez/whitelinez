"use client";
/**
 * hooks/useWebSocketAccount.ts
 * Per-user WebSocket hook for the authenticated /ws/account endpoint.
 * Handles balance updates and bet resolution notifications.
 *
 * Usage:
 *   const { balance, lastBetResult, wsStatus } = useWebSocketAccount(userId, jwt)
 *
 * Features:
 *   - Connects to /ws/account with JWT Bearer auth
 *   - Parses: balance:update, bet:resolved
 *   - Exponential backoff reconnect (2s → 30s)
 *   - Auto-disconnects when userId/jwt become null
 *   - Dispatches legacy DOM events for backward compat
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_EVENTS, TIMING } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BetResult {
  bet_id:       string;
  round_id:     string;
  outcome:      "exact" | "close" | "miss";
  points_delta: number;
  new_balance:  number;
  actual_count: number;
  guessed_count: number;
  resolved_at:  string;
  [key: string]: unknown;
}

export type WsStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface UseWebSocketAccountReturn {
  balance:       number | null;
  lastBetResult: BetResult | null;
  wsStatus:      WsStatus;
  isConnected:   boolean;
}

// ── Account WSS URL helper ────────────────────────────────────────────────────

function buildAccountWssUrl(jwt: string): string {
  const railwayBase =
    process.env.NEXT_PUBLIC_WS_BACKEND_URL ??
    // Fall back to nothing — the hook handles the null case gracefully
    "";
  if (!railwayBase) return "";
  const wssBase = railwayBase.replace(/^https?:\/\//, "wss://").replace(/\/+$/, "");
  return `${wssBase}/ws/account?token=${encodeURIComponent(jwt)}`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWebSocketAccount(
  userId: string | null | undefined,
  jwt:    string | null | undefined
): UseWebSocketAccountReturn {
  const [balance,       setBalance]       = useState<number | null>(null);
  const [lastBetResult, setLastBetResult] = useState<BetResult | null>(null);
  const [wsStatus,      setWsStatus]      = useState<WsStatus>("idle");

  const wsRef          = useRef<WebSocket | null>(null);
  const backoffRef     = useRef<number>(TIMING.WS_BACKOFF_INITIAL);
  const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef   = useRef<boolean>(false);
  // Track the jwt that was used for the current connection to detect credential changes
  const connectedJwtRef = useRef<string | null>(null);

  // ── Message handler ──────────────────────────────────────────────────────
  const handleMessage = useCallback((raw: string) => {
    let msg: { type?: string; event?: string; [key: string]: unknown };
    try { msg = JSON.parse(raw); }
    catch { return; }

    const type = (msg.type ?? msg.event ?? "") as string;

    switch (type) {
      case WS_EVENTS.BALANCE_UPDATE: {
        const newBalance = (msg.balance ?? msg.new_balance ?? null) as number | null;
        if (newBalance != null) setBalance(newBalance);
        document.dispatchEvent(new CustomEvent(WS_EVENTS.BALANCE_UPDATE, { detail: msg }));
        break;
      }
      case WS_EVENTS.BET_RESOLVED: {
        const result = msg as unknown as BetResult;
        setLastBetResult(result);
        if (result.new_balance != null) setBalance(result.new_balance);
        document.dispatchEvent(new CustomEvent(WS_EVENTS.BET_RESOLVED, { detail: msg }));
        break;
      }
      default:
        break;
    }
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────
  const connect = useCallback((currentJwt: string) => {
    if (unmountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000, "reconnect");
      wsRef.current = null;
    }

    const wssUrl = buildAccountWssUrl(currentJwt);
    if (!wssUrl) {
      console.error("[useWebSocketAccount] WS_BACKEND_URL not configured");
      setWsStatus("error");
      return;
    }

    setWsStatus("connecting");
    connectedJwtRef.current = currentJwt;

    const ws = new WebSocket(wssUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      setWsStatus("connected");
      backoffRef.current = TIMING.WS_BACKOFF_INITIAL;
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
      if (event.code !== 1000 && event.code !== 1001) {
        console.warn(`[useWebSocketAccount] closed code=${event.code} reason="${event.reason}"`);
      }
      setWsStatus("disconnected");
      connectedJwtRef.current = null;
      // Only reconnect if we still have valid credentials
      if (jwt && userId) scheduleReconnect(jwt);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleMessage, jwt, userId]);

  const scheduleReconnect = useCallback((currentJwt: string) => {
    if (unmountedRef.current) return;
    if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, TIMING.WS_BACKOFF_MAX);
    reconnTimerRef.current = setTimeout(() => {
      if (!unmountedRef.current && jwt && userId) connect(currentJwt);
    }, delay);
  }, [connect, jwt, userId]);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  useEffect(() => {
    unmountedRef.current = false;

    if (!userId || !jwt) {
      // No credentials — tear down any existing socket
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, "no-credentials");
        wsRef.current = null;
      }
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      setWsStatus("idle");
      return;
    }

    // Connect only if not already connected with the same JWT
    if (connectedJwtRef.current !== jwt || wsRef.current?.readyState !== WebSocket.OPEN) {
      backoffRef.current = TIMING.WS_BACKOFF_INITIAL;
      connect(jwt);
    }

    return () => {
      // Only run full teardown on actual unmount, not on jwt/userId change
    };
  }, [userId, jwt, connect]);

  // Separate cleanup effect for unmount only
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, "unmount");
        wsRef.current = null;
      }
    };
  }, []);

  return {
    balance,
    lastBetResult,
    wsStatus,
    isConnected: wsStatus === "connected",
  };
}
