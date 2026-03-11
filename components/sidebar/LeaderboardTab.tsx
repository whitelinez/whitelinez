"use client";
/**
 * components/sidebar/LeaderboardTab.tsx
 * RANKINGS tab — aggregated leaderboard by time window.
 * 30s auto-refresh, manual refresh button.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "@/lib/supabase-client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface RawBet {
  user_id: string | null;
  payout_pts: number | null;
  window_duration_sec: number | null;
  resolved_at: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface LeaderEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  totalPts: number;
  guessCount: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WINDOWS = [
  { sec: 60,  label: "1MIN" },
  { sec: 180, label: "3MIN" },
  { sec: 300, label: "5MIN" },
] as const;

type WindowSec = 60 | 180 | 300;

const MEDAL_COLORS: Record<number, string> = {
  0: "#FFD700",
  1: "#C0C0C0",
  2: "#CD7F32",
};

// ── Avatar helper ────────────────────────────────────────────────────────────

function defaultAvatarSvg(seed: string): string {
  const palette = ["#00d4ff","#22c55e","#a78bfa","#f472b6","#fb923c","#4ade80","#e879f9","#60a5fa","#f59e0b","#2dd4bf"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  const color = palette[Math.abs(hash >> 3) % palette.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 64 64'><rect width='64' height='64' rx='8' fill='#0c1320'/><circle cx='32' cy='23' r='12' fill='${color}' opacity='0.88'/><path d='M8 62 Q8 44 32 40 Q56 44 56 62Z' fill='${color}' opacity='0.7'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LeaderboardTab() {
  const [activeWindow, setActiveWindow] = useState<WindowSec>(60);
  const [entries, setEntries]           = useState<LeaderEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (window: WindowSec) => {
    setLoading(true);
    setError("");

    try {
      // Pull resolved bets for this window in last 24h
      const { data: bets, error: bErr } = await sb
        .from("bets")
        .select("user_id, payout_pts, window_duration_sec, resolved_at")
        .eq("status", "resolved")
        .eq("window_duration_sec", window)
        .gt("resolved_at", new Date(Date.now() - 86_400_000).toISOString())
        .order("payout_pts", { ascending: false }) as { data: RawBet[] | null; error: unknown };

      if (bErr) throw bErr;
      if (!bets?.length) {
        setEntries([]);
        return;
      }

      // Aggregate by user
      const userMap = new Map<string, { totalPts: number; guessCount: number }>();
      for (const b of bets) {
        if (!b.user_id) continue;
        const existing = userMap.get(b.user_id) ?? { totalPts: 0, guessCount: 0 };
        existing.totalPts  += Number(b.payout_pts ?? 0);
        existing.guessCount += 1;
        userMap.set(b.user_id, existing);
      }

      const sorted = [...userMap.entries()]
        .sort((a, b) => b[1].totalPts - a[1].totalPts)
        .slice(0, 20);

      const userIds = sorted.map(([id]) => id);

      // Resolve profiles
      const profileMap = new Map<string, { name: string; avatarUrl: string | null }>();
      try {
        const { data: profiles } = await sb
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds) as { data: ProfileRow[] | null };
        (profiles ?? []).forEach((p) => {
          profileMap.set(p.id, { name: p.display_name ?? `Player ${p.id.slice(0, 5)}`, avatarUrl: p.avatar_url ?? null });
        });
      } catch {
        // profiles table optional
      }

      setEntries(
        sorted.map(([userId, stats]) => {
          const p = profileMap.get(userId);
          return {
            userId,
            name:       p?.name ?? `Player ${userId.slice(0, 5)}`,
            avatarUrl:  p?.avatarUrl ?? null,
            totalPts:   stats.totalPts,
            guessCount: stats.guessCount,
          };
        })
      );
    } catch (e) {
      console.error("[LeaderboardTab]", e);
      setError("Could not load rankings. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + window switch
  useEffect(() => { load(activeWindow); }, [activeWindow, load]);

  // 30s auto-refresh
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    autoRefreshRef.current = setInterval(() => load(activeWindow), 30_000);
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [activeWindow, load]);

  return (
    <div className="flex flex-col h-full">
      {/* Window selector */}
      <div className="flex gap-1 px-4 pt-4 pb-3">
        {WINDOWS.map(({ sec, label }) => (
          <button
            key={sec}
            onClick={() => setActiveWindow(sec as WindowSec)}
            className={cn(
              "flex-1 py-1.5 rounded-md text-xs font-label font-semibold tracking-wider border transition-colors",
              activeWindow === sec
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted border-border hover:border-primary/40 hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => load(activeWindow)}
          disabled={loading}
          aria-label="Refresh leaderboard"
          className="w-8 flex items-center justify-center rounded-md bg-card border border-border text-muted hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-40"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={loading ? "animate-spin" : ""}
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && (
          <div className="flex flex-col gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-card border border-border animate-pulse" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-8">
            <p className="text-muted text-sm">{error}</p>
            <button
              onClick={() => load(activeWindow)}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="text-center py-10">
            <p className="text-muted text-sm">No rankings yet for this window.</p>
            <p className="text-muted/60 text-xs mt-1">Be the first to guess in this window.</p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <ol className="flex flex-col gap-1.5" aria-label="Leaderboard">
            {entries.map((entry, i) => {
              const medal  = MEDAL_COLORS[i];
              const isTop3 = i < 3;
              const avatar = entry.avatarUrl ?? defaultAvatarSvg(entry.userId);

              return (
                <li
                  key={entry.userId}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
                    isTop3
                      ? "bg-card border-border"
                      : "bg-card/60 border-border/60"
                  )}
                >
                  {/* Rank */}
                  <div className="w-6 flex-shrink-0 text-center">
                    {isTop3 ? (
                      <span
                        className="font-label font-bold text-sm"
                        style={{ color: medal }}
                      >
                        {i + 1}
                      </span>
                    ) : (
                      <span className="text-muted text-xs font-mono">#{i + 1}</span>
                    )}
                  </div>

                  {/* Avatar */}
                  <img
                    src={avatar}
                    alt={entry.name}
                    width={28}
                    height={28}
                    className="rounded-md flex-shrink-0 object-cover"
                    style={isTop3 ? { outline: `1px solid ${medal}55` } : undefined}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = defaultAvatarSvg(entry.userId);
                    }}
                  />

                  {/* Name + detail */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-semibold text-sm truncate"
                      style={isTop3 ? { color: medal } : undefined}
                    >
                      {entry.name}
                    </p>
                    <p className="text-muted text-[10px]">
                      {entry.guessCount} guess{entry.guessCount !== 1 ? "es" : ""}
                    </p>
                  </div>

                  {/* Points */}
                  <span
                    className="font-display font-bold text-sm flex-shrink-0"
                    style={isTop3 ? { color: medal } : undefined}
                  >
                    {entry.totalPts.toLocaleString()}
                    <span className="text-muted/60 font-normal text-[10px] ml-0.5">pts</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
