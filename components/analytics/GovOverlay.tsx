"use client";

/**
 * components/analytics/GovOverlay.tsx
 *
 * Full-screen Gov Analytics overlay for AI Traffic Jamaica.
 * Slides in from the right on desktop; full-screen modal on mobile.
 * Tabs: LIVE | ANALYTICS | AGENCIES | EXPORT
 *
 * Usage:
 *   <GovOverlay open={open} onClose={() => setOpen(false)} cameraId={id} cameraName={name} />
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAnalytics } from "@/hooks/useAnalytics";
import { LivePanel }      from "@/components/analytics/panels/LivePanel";
import { AnalyticsPanel } from "@/components/analytics/panels/AnalyticsPanel";
import { AgenciesPanel }  from "@/components/analytics/panels/AgenciesPanel";
import { ExportPanel }    from "@/components/analytics/panels/ExportPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GovTab = "live" | "analytics" | "agencies" | "export";

export interface GovOverlayProps {
  open:       boolean;
  onClose:    () => void;
  cameraId:   string;
  cameraName: string;
}

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS: { id: GovTab; label: string }[] = [
  { id: "live",      label: "LIVE"      },
  { id: "analytics", label: "ANALYTICS" },
  { id: "agencies",  label: "AGENCIES"  },
  { id: "export",    label: "EXPORT"    },
];

// ── Framer Motion variants ────────────────────────────────────────────────────

const backdropVariants: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1 },
  exit:    { opacity: 0 },
};

const panelVariants: Variants = {
  hidden:  { x: "100%" },
  visible: { x: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } },
  exit:    { x: "100%", transition: { duration: 0.22, ease: [0.4, 0, 0.6, 1] } },
};

// ── Logo (inline SVG replicating the header identity) ────────────────────────

function GovLogo() {
  return (
    <div className="relative w-8 h-8 shrink-0">
      {/* Outer ring */}
      <span className="absolute inset-0 rounded-full border border-primary/30 animate-pulse-dot" aria-hidden="true" />
      {/* Icon placeholder — matches iconinframes.png style */}
      <div className="w-full h-full rounded-full bg-primary/10 flex items-center justify-center">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
          className="w-4 h-4 text-primary" aria-hidden="true">
          <circle cx="10" cy="10" r="7"/>
          <path d="M10 6v4l2.5 2.5" strokeLinecap="round"/>
        </svg>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function GovHeader({
  cameraName,
  onClose,
}: {
  cameraName: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border shrink-0">
      {/* Left: identity */}
      <div className="flex items-center gap-3 min-w-0">
        <GovLogo />
        <div className="w-px h-7 bg-border shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-[11px] font-label font-bold tracking-[0.18em] text-primary uppercase leading-none">
            Traffic Intelligence
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {cameraName || "Initialising…"}
          </div>
        </div>
      </div>

      {/* Right: close */}
      <button
        onClick={onClose}
        aria-label="Close Traffic Intelligence"
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded",
          "text-[11px] font-label font-bold tracking-wider text-muted-foreground",
          "bg-surface border border-border hover:border-primary/40 hover:text-foreground",
          "transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
        )}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 4L4 12M4 4l8 8"/>
        </svg>
        PLAY
      </button>
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function GovTabBar({
  activeTab,
  onTab,
}: {
  activeTab: GovTab;
  onTab: (tab: GovTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Analytics sections"
      className="flex border-b border-border shrink-0 bg-surface"
    >
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          role="tab"
          aria-selected={activeTab === id}
          aria-controls={`gov-panel-${id}`}
          onClick={() => onTab(id)}
          className={cn(
            "flex-1 py-2.5 text-[11px] font-label font-bold tracking-[0.14em]",
            "transition-colors border-b-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
            activeTab === id
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function OverlaySkeleton() {
  return (
    <div className="p-4 flex flex-col gap-4 animate-pulse">
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 h-16 rounded-lg bg-border" />
        ))}
      </div>
      <div className="h-[200px] rounded-lg bg-border" />
      <div className="h-[120px] rounded-lg bg-border" />
    </div>
  );
}

// ── Main GovOverlay ───────────────────────────────────────────────────────────

export function GovOverlay({ open, onClose, cameraId, cameraName }: GovOverlayProps) {
  const [activeTab, setActiveTab] = useState<GovTab>("live");

  // jwt for export auth — read from Supabase session if available
  const [jwt, setJwt] = useState<string | null>(null);

  // Live analytics load
  const todayFrom = useRef(new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
  const todayTo   = useRef(new Date().toISOString());
  const { data: liveData, isLoading: liveLoading, refetch } = useAnalytics(cameraId, {
    from: todayFrom.current,
    to:   todayTo.current,
    granularity: "hour",
  });

  // Fetch live data when overlay opens
  useEffect(() => {
    if (open) {
      // Update today range on each open
      todayFrom.current = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      todayTo.current   = new Date().toISOString();
      refetch();

      // Try to get JWT for export
      try {
        const sbSession = localStorage.getItem("supabase.auth.token");
        if (sbSession) {
          const parsed = JSON.parse(sbSession);
          setJwt(parsed?.currentSession?.access_token ?? null);
        }
      } catch {
        // no-op
      }
    }
  }, [open, refetch]);

  // Lock body scroll when overlay is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Keyboard dismiss
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleTab = useCallback((tab: GovTab) => {
    setActiveTab(tab);
  }, []);

  const liveSummary = liveData?.summary ?? null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="gov-backdrop"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
            aria-hidden="true"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="gov-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Traffic Analytics"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex flex-col",
              "w-full md:max-w-4xl",
              "bg-background border-l border-border",
              "shadow-2xl"
            )}
          >
            {/* Header */}
            <GovHeader cameraName={cameraName} onClose={onClose} />

            {/* Tab bar */}
            <GovTabBar activeTab={activeTab} onTab={handleTab} />

            {/* Panel content — scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain">
              <div className="max-w-[900px] mx-auto px-4 pt-5">

                {/* LIVE tab */}
                <div
                  id="gov-panel-live"
                  role="tabpanel"
                  aria-labelledby="live"
                  hidden={activeTab !== "live"}
                >
                  {liveLoading && !liveData ? (
                    <OverlaySkeleton />
                  ) : (
                    <LivePanel summary={liveSummary} isLoading={liveLoading} />
                  )}
                </div>

                {/* ANALYTICS tab */}
                <div
                  id="gov-panel-analytics"
                  role="tabpanel"
                  aria-labelledby="analytics"
                  hidden={activeTab !== "analytics"}
                >
                  {activeTab === "analytics" && (
                    <AnalyticsPanel cameraId={cameraId} />
                  )}
                </div>

                {/* AGENCIES tab */}
                <div
                  id="gov-panel-agencies"
                  role="tabpanel"
                  aria-labelledby="agencies"
                  hidden={activeTab !== "agencies"}
                >
                  {activeTab === "agencies" && (
                    <AgenciesPanel summary={liveSummary} isLoading={liveLoading} />
                  )}
                </div>

                {/* EXPORT tab */}
                <div
                  id="gov-panel-export"
                  role="tabpanel"
                  aria-labelledby="export"
                  hidden={activeTab !== "export"}
                >
                  {activeTab === "export" && (
                    <ExportPanel cameraId={cameraId} jwt={jwt} />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
