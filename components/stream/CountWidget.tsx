"use client";

/**
 * CountWidget.tsx — Floating vehicle count widget overlaid on the stream.
 *
 * NORMAL MODE: Live count + WS status dot.
 * GUESS MODE: X/Y layout with a color-coded progress bar (green→yellow→red).
 *
 * Position: absolute top-right, 16px from edges.
 * Background: glass effect (rgba(8,12,20,0.85) + backdrop-blur).
 * Font: JetBrains Mono for numbers; Rajdhani for labels.
 */

import { cn } from "@/lib/utils";

type WsStatus = "connected" | "disconnected" | "error" | "connecting";

interface GuessMode {
  current: number;
  target: number;
}

interface CountWidgetProps {
  count: number;
  wsStatus: WsStatus;
  guessMode?: GuessMode;
  className?: string;
}

function WsDot({ status }: { status: WsStatus }) {
  const colorClass =
    status === "connected"
      ? "bg-green-live shadow-green"
      : status === "connecting"
        ? "bg-accent"
        : "bg-destructive";

  return (
    <span
      aria-label={`WebSocket ${status}`}
      className={cn(
        "inline-block h-2 w-2 rounded-full flex-shrink-0",
        colorClass,
        status === "connected" && "animate-pulse-dot",
      )}
    />
  );
}

function progressColor(pct: number): string {
  if (pct >= 100) return "#ef4444";
  if (pct >= 80) return "#eab308";
  return "#22c55e";
}

export function CountWidget({ count, wsStatus, guessMode, className }: CountWidgetProps) {
  const isGuessMode = guessMode != null;
  const pct = isGuessMode && guessMode.target > 0
    ? Math.min(100, (guessMode.current / guessMode.target) * 100)
    : 0;
  const barColor = progressColor(pct);

  return (
    <div
      id="count-widget"
      aria-label="floating vehicle count widget"
      className={cn(
        "absolute top-4 right-4 z-20",
        "flex flex-col gap-1.5 rounded-md px-3 py-2.5",
        "glass",
        "min-w-[88px]",
        className,
      )}
    >
      {/* HUD strip label */}
      <div
        className="text-[9px] font-label font-semibold tracking-[0.12em] uppercase text-muted-foreground"
        aria-hidden="true"
      >
        LIVE COUNT — Vehicles
      </div>

      {isGuessMode ? (
        /* ── Guess mode ── */
        <div className="flex flex-col gap-1">
          {/* X / Y row */}
          <div className="flex items-baseline gap-1 font-mono">
            <span
              id="cw-gm-current"
              className="text-2xl font-bold leading-none"
              style={{ color: "#00FF88" }}
              aria-label="vehicle count value"
            >
              {guessMode.current.toLocaleString()}
            </span>
            <span className="text-lg text-muted-foreground leading-none">/</span>
            <span
              id="cw-gm-target"
              className="text-2xl font-bold leading-none text-accent"
            >
              {guessMode.target.toLocaleString()}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
            <div
              id="cw-gm-bar"
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${pct}%`, background: barColor }}
            />
          </div>
        </div>
      ) : (
        /* ── Normal mode ── */
        <div className="flex items-center justify-between gap-2">
          <span
            id="cw-total"
            aria-label="vehicle count value"
            className="font-mono text-3xl font-bold leading-none"
            style={{ color: "#00FF88" }}
          >
            {count.toLocaleString()}
          </span>
          <WsDot status={wsStatus} />
        </div>
      )}

      {/* WS dot in guess mode (keeps indicator visible) */}
      {isGuessMode && (
        <div className="flex items-center justify-end">
          <WsDot status={wsStatus} />
        </div>
      )}
    </div>
  );
}
