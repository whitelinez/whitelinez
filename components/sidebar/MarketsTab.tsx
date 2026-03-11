"use client";
/**
 * components/sidebar/MarketsTab.tsx
 * PLAY tab — active round display + embedded guess panel.
 * Polls Supabase bet_rounds every 15s.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "@/lib/supabase-client";
import { cn } from "@/lib/utils";
import LiveBetPanel, { type Round } from "@/components/betting/LiveBetPanel";

// ── Types ────────────────────────────────────────────────────────────────────

interface BetRound extends Round {
  title?: string;
  camera_name?: string;
  opens_at?: string | null;
  closes_at?: string | null;
  ends_at?: string | null;
  next_round_at?: string | null;
  actual_count?: number | null;
  created_at?: string;
}

interface ResolvedCard {
  round: BetRound;
  won: boolean;
  payout: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCountdown(endIso: string | null | undefined): string {
  if (!endIso) return "--:--";
  const diff = Math.max(0, Math.ceil((new Date(endIso).getTime() - Date.now()) / 1000));
  const m = Math.floor(diff / 60).toString().padStart(2, "0");
  const s = (diff % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    locked:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
    upcoming: "bg-muted/10 text-muted border-border",
    resolved: "bg-muted/10 text-muted border-border",
  };
  const s = String(status).toLowerCase();
  return (
    <span
      className={cn(
        "font-label font-semibold text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-full border",
        styles[s] ?? "bg-muted/10 text-muted border-border"
      )}
    >
      {s === "open" ? "LIVE" : s.toUpperCase()}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MarketsTab() {
  const [round, setRound]               = useState<BetRound | null>(null);
  const [loading, setLoading]           = useState(true);
  const [countdown, setCountdown]       = useState("--:--");
  const [nextCountdown, setNextCountdown] = useState("--:--");
  const [resolved, setResolved]         = useState<ResolvedCard | null>(null);

  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextCdRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolvedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch round ────────────────────────────────────────────────────────

  const fetchRound = useCallback(async () => {
    try {
      const { data, error } = await sb
        .from("bet_rounds")
        .select("*")
        .in("status", ["open", "locked", "upcoming"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setRound(data ?? null);
    } catch (e) {
      console.warn("[MarketsTab] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Countdown tick ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!round) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }

    const targetIso =
      round.status === "open"   ? round.closes_at ?? round.ends_at :
      round.status === "locked" ? round.ends_at                     :
      round.opens_at;

    if (countdownRef.current) clearInterval(countdownRef.current);
    const tick = () => setCountdown(formatCountdown(targetIso));
    tick();
    countdownRef.current = setInterval(tick, 500);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [round]);

  // ── Poll every 15s ─────────────────────────────────────────────────────

  useEffect(() => {
    fetchRound();
    pollRef.current = setInterval(fetchRound, 15_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchRound]);

  // ── bet:resolved DOM event → show resolved card for 30s ───────────────

  useEffect(() => {
    function onResolved(e: Event) {
      const detail = (e as CustomEvent).detail ?? {};
      if (!round) return;
      setResolved({ round, won: !!detail.won, payout: Number(detail.payout ?? 0) });
      if (resolvedTimeout.current) clearTimeout(resolvedTimeout.current);
      resolvedTimeout.current = setTimeout(() => {
        setResolved(null);
        fetchRound();
      }, 30_000);
    }
    document.addEventListener("bet:resolved", onResolved);
    return () => document.removeEventListener("bet:resolved", onResolved);
  }, [round, fetchRound]);

  // ── round:update DOM event → re-fetch immediately ─────────────────────

  useEffect(() => {
    function onRoundUpdate() { fetchRound(); }
    window.addEventListener("round:update", onRoundUpdate);
    return () => window.removeEventListener("round:update", onRoundUpdate);
  }, [fetchRound]);

  // ── Next-round countdown ───────────────────────────────────────────────

  useEffect(() => {
    if (!round?.next_round_at || round.status !== "upcoming") {
      if (nextCdRef.current) clearInterval(nextCdRef.current);
      return;
    }
    if (nextCdRef.current) clearInterval(nextCdRef.current);
    const tick = () => setNextCountdown(formatCountdown(round.next_round_at));
    tick();
    nextCdRef.current = setInterval(tick, 500);
    return () => { if (nextCdRef.current) clearInterval(nextCdRef.current); };
  }, [round]);

  // ── Cleanup ────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (countdownRef.current)    clearInterval(countdownRef.current);
      if (nextCdRef.current)       clearInterval(nextCdRef.current);
      if (pollRef.current)         clearInterval(pollRef.current);
      if (resolvedTimeout.current) clearTimeout(resolvedTimeout.current);
    };
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  // ── Resolved card ──────────────────────────────────────────────────────

  if (resolved) {
    const { won, payout } = resolved;
    return (
      <div className="flex flex-col gap-3 p-4">
        <div
          className={cn(
            "rounded-lg border px-4 py-4 flex flex-col gap-2",
            won
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-destructive/10 border-destructive/30"
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-label font-bold tracking-widest text-xs px-2 py-0.5 rounded-full border",
                won
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "bg-destructive/15 text-destructive border-destructive/30"
              )}
            >
              {won ? "WIN" : "MISS"}
            </span>
            {won && (
              <span className="font-display font-bold text-emerald-400">
                +{payout.toLocaleString()} pts
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            {won ? "Your guess was close enough — points awarded." : "Your guess missed this round."}
          </p>
        </div>
        <p className="text-center text-xs text-muted">Next round loading...</p>
      </div>
    );
  }

  // ── No round ───────────────────────────────────────────────────────────

  if (!round) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
        <div className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <p className="text-muted text-sm">Next round coming soon</p>
        {round === null && (
          <p className="font-mono text-primary text-sm">{nextCountdown}</p>
        )}
        <button
          onClick={fetchRound}
          className="mt-1 text-xs text-muted hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  // ── Round card ─────────────────────────────────────────────────────────

  const isOpen   = round.status === "open";
  const isLocked = round.status === "locked";

  return (
    <div className="flex flex-col gap-0">
      {/* Round info card */}
      <div className="mx-4 mt-4 mb-0 bg-card border border-border rounded-t-lg px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-label font-semibold text-xs tracking-wider text-muted uppercase">
            {round.camera_name ?? "Live Camera"}
          </span>
          <StatusBadge status={round.status} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-foreground font-semibold text-sm">
            {round.title ?? "Live Prediction Round"}
          </span>
          <div className="text-right">
            <p className="font-mono font-bold text-base text-primary">{countdown}</p>
            <p className="text-[10px] text-muted">
              {isOpen ? "closes in" : isLocked ? "ends in" : "opens in"}
            </p>
          </div>
        </div>
      </div>

      {/* Bet panel — embedded flush below round card when open */}
      {isOpen && (
        <div className="mx-4 mb-4 bg-card/50 border border-t-0 border-border rounded-b-lg">
          <div className="h-px bg-border" />
          <LiveBetPanel round={round} />
        </div>
      )}

      {/* Locked state */}
      {isLocked && (
        <div className="mx-4 mb-4 bg-card/50 border border-t-0 border-border rounded-b-lg px-4 py-4 text-center">
          <p className="text-amber-400 text-sm font-label font-semibold tracking-wider">
            GUESSES LOCKED
          </p>
          <p className="text-xs text-muted mt-1">Waiting for round to end...</p>
        </div>
      )}

      {/* Upcoming state */}
      {round.status === "upcoming" && (
        <div className="mx-4 mb-4 bg-card/50 border border-t-0 border-border rounded-b-lg px-4 py-4 text-center">
          <p className="text-muted text-sm">Round opens in</p>
          <p className="font-mono text-primary font-bold text-xl">{countdown}</p>
        </div>
      )}
    </div>
  );
}
