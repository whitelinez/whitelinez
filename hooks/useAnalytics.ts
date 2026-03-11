"use client";

/**
 * hooks/useAnalytics.ts
 *
 * Fetches analytics data from /api/analytics.
 * Stale-while-revalidate: returns cached data immediately, then updates in background.
 * useAnalytics(cameraId, params) — returns { data, zoneData, isLoading, error, refetch }
 */

import { useCallback, useRef, useState } from "react";
import type {
  AnalyticsParams,
  TrafficResponse,
  UseAnalyticsReturn,
  ZonesResponse,
} from "@/types/analytics";
import { TIMING } from "@/lib/constants";

// ── Module-level SWR cache ────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const _trafficCache = new Map<string, CacheEntry<TrafficResponse>>();
const _zoneCache    = new Map<string, CacheEntry<ZonesResponse>>();

function _cacheKey(cameraId: string, params: Partial<AnalyticsParams>): string {
  return [cameraId, params.from ?? "", params.to ?? "", params.granularity ?? "hour"].join("|");
}

function _isFresh<T>(entry: CacheEntry<T> | undefined): boolean {
  return !!entry && Date.now() - entry.ts < TIMING.ANALYTICS_CACHE_MS;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAnalytics(
  cameraId: string,
  params: Partial<AnalyticsParams> = {}
): UseAnalyticsReturn {
  const [data,     setData]     = useState<TrafficResponse | null>(null);
  const [zoneData, setZoneData] = useState<ZonesResponse | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Prevent double-fetch on React StrictMode double-invoke
  const _inFlight = useRef(false);

  const refetch = useCallback(async () => {
    if (!cameraId || _inFlight.current) return;
    _inFlight.current = true;
    setError(null);

    const key      = _cacheKey(cameraId, params);
    const cached   = _trafficCache.get(key);
    const cachedZ  = _zoneCache.get(key);

    // Serve stale immediately so UI is never blank
    if (cached)  setData(cached.data);
    if (cachedZ) setZoneData(cachedZ.data);

    // Skip network if both entries are fresh
    if (_isFresh(cached) && _isFresh(cachedZ)) {
      _inFlight.current = false;
      return;
    }

    setLoading(true);

    try {
      const qs = new URLSearchParams({ _route: "traffic" });
      if (cameraId)        qs.set("camera_id",   cameraId);
      if (params.from)     qs.set("from",         params.from);
      if (params.to)       qs.set("to",           params.to);
      if (params.granularity) qs.set("granularity", params.granularity);

      const zonesQs = new URLSearchParams({ _route: "zones" });
      if (cameraId)    zonesQs.set("camera_id", cameraId);
      if (params.from) zonesQs.set("from",      params.from);
      if (params.to)   zonesQs.set("to",        params.to);

      const [trafficRes, zonesRes] = await Promise.allSettled([
        fetch(`/api/analytics?${qs.toString()}`),
        fetch(`/api/analytics?${zonesQs.toString()}`),
      ]);

      if (trafficRes.status === "fulfilled" && trafficRes.value.ok) {
        const json: TrafficResponse = await trafficRes.value.json();
        _trafficCache.set(key, { data: json, ts: Date.now() });
        setData(json);
      } else if (trafficRes.status === "fulfilled") {
        setError("Failed to load traffic data");
      } else {
        setError("Network error loading traffic data");
      }

      if (zonesRes.status === "fulfilled" && zonesRes.value.ok) {
        const json: ZonesResponse = await zonesRes.value.json();
        _zoneCache.set(key, { data: json, ts: Date.now() });
        setZoneData(json);
      }
      // Zone failure is non-fatal — silently ignore
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analytics fetch failed");
    } finally {
      setLoading(false);
      _inFlight.current = false;
    }
  }, [cameraId, params.from, params.to, params.granularity]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, zoneData, isLoading, error, refetch };
}
