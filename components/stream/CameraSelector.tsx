"use client";

/**
 * CameraSelector.tsx — Camera selector pill strip at the bottom of the stream panel.
 *
 * - Horizontal pill row with active state (cyan border + text)
 * - AI badge for cameras with has_ai=true
 * - Bottom gradient fade
 * - Horizontal scroll on overflow
 */

import { cn } from "@/lib/utils";

export interface Camera {
  id: string;
  name: string;
  is_active: boolean;
  has_ai: boolean;
}

interface CameraSelectorProps {
  cameras: Camera[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function CameraSelector({
  cameras,
  activeId,
  onChange,
  className,
}: CameraSelectorProps) {
  if (!cameras || cameras.length <= 1) return null;

  return (
    <div
      id="cam-pill-strip"
      aria-label="Camera selector"
      className={cn(
        "absolute bottom-0 left-0 right-0 z-20",
        "flex items-end",
        className,
      )}
    >
      {/* Gradient scrim behind pills */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, rgba(8,12,20,0.92) 0%, transparent 100%)",
        }}
        aria-hidden="true"
      />

      {/* Scrollable pill strip */}
      <div
        className="relative flex items-center gap-1.5 overflow-x-auto px-3 pb-2.5 pt-6 w-full"
        style={{ scrollbarWidth: "none" }}
      >
        {cameras.map((cam) => {
          const isActive = cam.id === activeId;
          return (
            <button
              key={cam.id}
              onClick={() => onChange(cam.id)}
              aria-pressed={isActive}
              aria-label={`Switch to ${cam.name}${cam.has_ai ? " (AI camera)" : ""}`}
              className={cn(
                "flex-shrink-0 flex items-center gap-1.5",
                "rounded-full px-3 py-1 text-[11px] font-label font-semibold tracking-wide",
                "transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                isActive
                  ? "border border-primary text-primary bg-primary/10"
                  : "border border-border/60 text-muted-foreground bg-background/60 hover:border-primary/50 hover:text-foreground",
              )}
            >
              {/* Active live dot */}
              {isActive && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-green-live animate-pulse-dot flex-shrink-0"
                  aria-hidden="true"
                />
              )}

              {cam.name}

              {/* AI badge */}
              {cam.has_ai && (
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1 py-px",
                    "text-[8px] font-mono font-bold tracking-widest",
                    isActive
                      ? "bg-primary/20 text-primary"
                      : "bg-muted/40 text-muted-foreground",
                  )}
                  aria-label="AI detection active"
                >
                  AI
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
