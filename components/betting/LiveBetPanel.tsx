"use client";
/**
 * components/betting/LiveBetPanel.tsx
 * Core guess submission form — the main game mechanic.
 * State machine: idle → submitting → active → resolved
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Round {
  id: string;
  status: "open" | "locked" | "upcoming" | "resolved" | string;
  window_duration_sec?: number;
  camera_id?: string;
  closes_at?: string | null;
  ends_at?: string | null;
}

interface BetResolvedPayload {
  won: boolean;
  payout?: number;
  actual?: number | string;
  exact?: number | string;
  score_tier?: "exact" | "close" | "miss";
}

interface PlaceResponse {
  window_end: string;
  round_id?: string;
  window_duration_sec?: number;
  exact_count?: number;
  [key: string]: unknown;
}

type PanelState = "idle" | "submitting" | "active" | "resolved";

const WINDOW_OPTIONS = [
  { value: 60,  label: "1MIN" },
  { value: 180, label: "3MIN" },
  { value: 300, label: "5MIN" },
] as const;

type WindowSec = 60 | 180 | 300;

interface Props {
  round: Round;
  onBetPlaced?: (bet: PlaceResponse) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCountdown(endMs: number): string {
  const diffRaw = Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
  const m = Math.floor(diffRaw / 60).toString().padStart(2, "0");
  const s = (diffRaw % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LiveBetPanel({ round, onBetPlaced }: Props) {
  const { user, session, isLoading: authLoading } = useAuth();

  const [panelState, setPanelState]   = useState<PanelState>("idle");
  const [windowSec, setWindowSec]     = useState<WindowSec>(60);
  const [count, setCount]             = useState(5);
  const [error, setError]             = useState("");
  const [countdown, setCountdown]     = useState("00:00");
  const [activeGuess, setActiveGuess] = useState<number | null>(null);
  const [resolved, setResolved]       = useState<BetResolvedPayload | null>(null);

  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const windowEndRef  = useRef<number>(0);

  // ── Countdown ticker ────────────────────────────────────────────────────

  const startCountdown = useCallback((windowEndIso: string) => {
    windowEndRef.current = new Date(windowEndIso).getTime();
    if (countdownRef.current) clearInterval(countdownRef.current);
    const tick = () => {
      const cd = formatCountdown(windowEndRef.current);
      setCountdown(cd);
      if (Date.now() >= windowEndRef.current) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        setCountdown("00:00");
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── bet:resolved DOM event ───────────────────────────────────────────────

  useEffect(() => {
    function onResolved(e: Event) {
      const data = (e as CustomEvent<BetResolvedPayload>).detail;
      if (countdownRef.current) clearInterval(countdownRef.current);
      setResolved(data);
      setPanelState("resolved");
    }
    document.addEventListener("bet:resolved", onResolved);
    return () => document.removeEventListener("bet:resolved", onResolved);
  }, []);

  // ── Count stepper ────────────────────────────────────────────────────────

  const decrement = () => setCount((v) => Math.max(1, v - 1));
  const increment = () => setCount((v) => Math.min(999, v + 1));

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setError("");

    if (!round || String(round.status).toLowerCase() !== "open") {
      setError("Round is not open for guesses");
      return;
    }
    if (round.closes_at) {
      const closesAt = new Date(round.closes_at).getTime();
      if (Number.isFinite(closesAt) && Date.now() >= closesAt) {
        setError("Guess window has closed");
        return;
      }
    }
    if (count < 1 || count > 999) {
      setError("Enter a count between 1 and 999");
      return;
    }

    setPanelState("submitting");

    try {
      const jwt = (session as { access_token?: string } | null)?.access_token ?? "";

      const res = await fetch("/api/bets/place?live=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({
          round_id:           round.id,
          window_duration_sec: windowSec,
          exact_count:        count,
          amount:             1,
        }),
      });

      const data: PlaceResponse = await res.json();

      if (!res.ok) {
        const errMsg =
          res.status === 400 ? (data?.detail as string ?? data?.error as string ?? "Invalid guess")          :
          res.status === 401 ? "Session expired — please sign in again"                                       :
          res.status === 403 ? "Round is no longer accepting guesses"                                         :
          res.status === 409 ? "You already have an active guess for this round"                              :
          (data?.detail as string ?? data?.error as string ?? "Something went wrong — try again");
        setError(errMsg);
        setPanelState("idle");
        return;
      }

      setActiveGuess(count);
      startCountdown(data.window_end);
      setPanelState("active");
      onBetPlaced?.(data);

      window.dispatchEvent(
        new CustomEvent("bet:placed", {
          detail: {
            ...data,
            bet_type:            "exact_count",
            round_id:            round.id,
            window_duration_sec: windowSec,
            exact_count:         count,
          },
        })
      );
    } catch {
      setError("Network error — try again");
      setPanelState("idle");
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  function handleReset() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setResolved(null);
    setActiveGuess(null);
    setCount(5);
    setError("");
    setPanelState("idle");
  }

  function goToRankings() {
    window.dispatchEvent(new CustomEvent("sidebar:tab", { detail: "leaderboard" }));
  }

  // ── Auth gate ────────────────────────────────────────────────────────────

  if (!authLoading && !user) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
        <p className="text-muted text-sm leading-snug">
          Login to make a guess and compete on the leaderboard.
        </p>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("auth:open"))}
          className="px-5 py-2 rounded-md bg-primary text-primary-foreground font-label font-semibold text-xs tracking-wider hover:opacity-90 transition-opacity"
        >
          LOGIN
        </button>
      </div>
    );
  }

  // ── Resolved card ────────────────────────────────────────────────────────

  if (panelState === "resolved" && resolved) {
    const { won, payout = 0, actual, exact: resolvedExact, score_tier } = resolved;
    const isExact = score_tier === "exact" || (won && String(actual) === String(resolvedExact));
    const tier    = score_tier ?? (isExact ? "exact" : won ? "close" : "miss");

    const tierStyles = {
      exact: {
        badge: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
        pts:   "text-emerald-400",
        label: "EXACT",
      },
      close: {
        badge: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
        pts:   "text-amber-400",
        label: "CLOSE",
      },
      miss: {
        badge: "bg-destructive/15 text-destructive border border-destructive/30",
        pts:   "text-muted",
        label: "MISS",
      },
    }[tier] ?? {
      badge: "bg-muted/10 text-muted border border-border",
      pts:   "text-muted",
      label: tier.toUpperCase(),
    };

    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        {/* Badge row */}
        <div className="flex items-center justify-between">
          <span className={cn("font-label font-bold tracking-widest text-xs px-3 py-1 rounded-full", tierStyles.badge)}>
            {tierStyles.label}
          </span>
          {tier !== "miss" && (
            <span className={cn("font-display font-bold text-lg", tierStyles.pts)}>
              +{Number(payout).toLocaleString()} pts
            </span>
          )}
          {tier === "miss" && (
            <span className="font-display font-bold text-lg text-muted">0 pts</span>
          )}
        </div>

        {/* Detail row */}
        <div className="bg-card border border-border rounded-lg px-3 py-3 text-sm text-muted flex flex-col gap-1">
          <div className="flex justify-between">
            <span>Your guess</span>
            <span className="text-foreground font-semibold">{resolvedExact ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Actual count</span>
            <span className="text-foreground font-semibold">{actual ?? "—"}</span>
          </div>
          {tier !== "miss" && (
            <div className="flex justify-between border-t border-border pt-1 mt-1">
              <span>Points earned</span>
              <span className={cn("font-semibold", tierStyles.pts)}>
                +{Number(payout).toLocaleString()} pts
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-1">
          <button
            onClick={handleReset}
            className="flex-1 py-2 rounded-md bg-card border border-border text-foreground text-xs font-label font-semibold tracking-wider hover:border-primary/50 hover:text-primary transition-colors"
          >
            Guess Again
          </button>
          <button
            onClick={goToRankings}
            className="flex-1 py-2 rounded-md bg-primary/10 border border-primary/30 text-primary text-xs font-label font-semibold tracking-wider hover:bg-primary/20 transition-colors"
          >
            Rankings
          </button>
        </div>
      </div>
    );
  }

  // ── Active receipt ───────────────────────────────────────────────────────

  if (panelState === "active") {
    const winLabel = { 60: "1 MIN", 180: "3 MIN", 300: "5 MIN" }[windowSec] ?? `${Math.round(windowSec / 60)} MIN`;
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="bg-card border border-border rounded-lg px-4 py-4 flex flex-col gap-3">
          {/* Receipt header */}
          <div className="flex items-center justify-between">
            <span className="font-label font-semibold text-xs tracking-wider text-muted uppercase">
              Active Guess
            </span>
            <span className="text-xs bg-primary/10 text-primary border border-primary/30 rounded-full px-2 py-0.5 font-label font-semibold tracking-wider">
              {winLabel}
            </span>
          </div>

          {/* Guess value */}
          <div className="flex items-baseline gap-2">
            <span className="text-muted text-sm">Your guess:</span>
            <span className="font-display font-bold text-2xl text-foreground">
              {activeGuess}
            </span>
            <span className="text-muted text-sm">vehicles</span>
          </div>

          {/* Countdown */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Round ends in</span>
              <span className="font-mono text-primary font-semibold text-base">{countdown}</span>
            </div>
            <div className="h-1 w-full bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary/50 rounded-full animate-pulse" style={{ width: "100%" }} />
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted">
          Waiting for round to end...
        </p>
      </div>
    );
  }

  // ── Idle form ────────────────────────────────────────────────────────────

  const isSubmitting = panelState === "submitting";
  const roundOpen    = String(round.status).toLowerCase() === "open";

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {/* Window selector */}
      <div className="flex flex-col gap-1.5">
        <label className="font-label font-semibold text-xs tracking-wider text-muted uppercase">
          Time Window
        </label>
        <div className="flex gap-2">
          {WINDOW_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setWindowSec(value)}
              disabled={isSubmitting}
              className={cn(
                "flex-1 py-2 rounded-md text-xs font-label font-semibold tracking-wider border transition-colors",
                windowSec === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted border-border hover:border-primary/50 hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Count input */}
      <div className="flex flex-col gap-1.5">
        <label className="font-label font-semibold text-xs tracking-wider text-muted uppercase">
          Vehicle Count
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={decrement}
            disabled={isSubmitting || count <= 1}
            aria-label="Decrease count"
            className="w-9 h-9 rounded-md bg-card border border-border text-foreground text-lg font-semibold flex items-center justify-center hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-40"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={999}
            value={count}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) setCount(Math.min(999, Math.max(1, v)));
            }}
            disabled={isSubmitting}
            className="flex-1 h-9 rounded-md bg-card border border-border text-foreground text-center font-mono font-semibold text-base focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/30 disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={increment}
            disabled={isSubmitting || count >= 999}
            aria-label="Increase count"
            className="w-9 h-9 rounded-md bg-card border border-border text-foreground text-lg font-semibold flex items-center justify-center hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-destructive text-xs bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !roundOpen || authLoading}
        className={cn(
          "w-full py-2.5 rounded-md font-label font-bold text-sm tracking-wider transition-all",
          roundOpen && !isSubmitting
            ? "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]"
            : "bg-card border border-border text-muted cursor-not-allowed opacity-60"
        )}
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
            Submitting...
          </span>
        ) : (
          "Submit Guess"
        )}
      </button>

      {!roundOpen && (
        <p className="text-center text-xs text-muted">
          Round is {round.status} — guesses closed
        </p>
      )}
    </div>
  );
}
