"use client";

/**
 * app/page.tsx — Main dashboard.
 * Wires: SiteHeader + OnboardingOverlay + StreamPanel + Sidebar + GovOverlay.
 * Auth via useAuth() context. WS via useWebSocketLive().
 */

import { useCallback, useEffect, useState } from "react";
import { SiteHeader }         from "@/components/layout/SiteHeader";
import { OnboardingOverlay }  from "@/components/layout/OnboardingOverlay";
import { StreamPanel, type StreamPanelProps } from "@/components/stream/StreamPanel";
import Sidebar                from "@/components/sidebar/Sidebar";
import { GovOverlay }         from "@/components/analytics/GovOverlay";
import { useWebSocketLive }   from "@/hooks/useWebSocketLive";
import { useAuth }            from "@/contexts/AuthContext";
import { sb }                 from "@/lib/supabase-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Camera {
  id:       string;
  name:     string;
  alias?:   string;
  has_ai:   boolean;
  is_active:boolean;
  stream_url?:  string;
  detect_zone?: number[][];
}

// ── Fallback stream URL ───────────────────────────────────────────────────────

const BACKEND_URL =
  process.env.NEXT_PUBLIC_WS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_RAILWAY_BACKEND_URL ??
  "https://whitelinez-backend-production.up.railway.app";

function buildStreamUrl(alias?: string) {
  const base = BACKEND_URL.replace(/\/$/, "");
  return alias ? `${base}/stream?alias=${alias}` : `${base}/stream`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const { isAdmin } = useAuth();

  // Camera list
  const [cameras,        setCameras]       = useState<Camera[]>([]);
  const [activeCam,      setActiveCam]     = useState<Camera | null>(null);

  // Overlay states
  const [govOpen,        setGovOpen]       = useState(false);
  const [loginOpen,      setLoginOpen]     = useState(false);
  const [registerOpen,   setRegisterOpen]  = useState(false);
  const [demoActive,     setDemoActive]    = useState(false);

  // ── Fetch cameras from Supabase ────────────────────────────────────────────
  useEffect(() => {
    sb.from("cameras")
      .select("id, name, alias, has_ai, is_active, stream_url, detect_zone")
      .eq("is_active", true)
      .order("has_ai", { ascending: false })
      .then(({ data }) => {
        if (!data?.length) return;
        setCameras(data as Camera[]);
        setActiveCam(data.find((c) => c.has_ai) ?? data[0]);
      });
  }, []);

  // ── WebSocket (live count + detection) ────────────────────────────────────
  const { count, detections, roundInfo, wsStatus } = useWebSocketLive(
    activeCam?.alias ?? activeCam?.id ?? undefined,
  );

  // ── Camera switch ─────────────────────────────────────────────────────────
  const handleCameraChange = useCallback((id: string) => {
    const cam = cameras.find((c) => c.id === id);
    if (cam) setActiveCam(cam);
  }, [cameras]);

  // ── Demo toggle (admin only) ──────────────────────────────────────────────
  const handleDemo = useCallback(async () => {
    await fetch("/api/demo?action=toggle", { method: "POST" });
    setDemoActive((v) => !v);
  }, []);

  // ── Stream URL ────────────────────────────────────────────────────────────
  const streamUrl = activeCam?.stream_url ?? buildStreamUrl(activeCam?.alias);

  return (
    <>
      {/* ── Onboarding ────────────────────────────────────────────────────── */}
      <OnboardingOverlay />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <SiteHeader
        onAnalyticsClick={() => setGovOpen(true)}
        onLoginClick={()    => setLoginOpen(true)}
        onRegisterClick={() => setRegisterOpen(true)}
        showDemo={isAdmin}
        onDemoClick={handleDemo}
      />

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <main className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Stream panel — flex-1, black bg */}
        <div className="relative flex-1 min-w-0">
          {activeCam ? (
            <StreamPanel
              cameras={cameras}
              activeCameraId={activeCam.id}
              onCameraChange={handleCameraChange}
              streamUrl={streamUrl}
              zone={activeCam.detect_zone ?? []}
              wsCount={count}
              wsDetections={detections}
              wsStatus={wsStatus}
              roundInfo={roundInfo as StreamPanelProps["roundInfo"]}
              hudData={undefined}
              className="h-full"
            />
          ) : (
            /* Loading state */
            <div className="flex h-full items-center justify-center bg-black">
              <div className="flex flex-col items-center gap-3">
                <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="font-mono text-xs text-muted tracking-widest uppercase">
                  Connecting…
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — fixed 380px, hidden on mobile (mobile: full-screen tabs) */}
        <div className="hidden lg:flex flex-col w-[380px] shrink-0 border-l border-border bg-surface overflow-hidden">
          <Sidebar
            cameras={cameras}
            activeCameraId={activeCam?.id ?? ""}
            wsCount={count}
            roundInfo={roundInfo ? {
              id:     roundInfo.id,
              status: roundInfo.status,
              title:  `Camera: ${activeCam?.name ?? "—"}`,
            } : undefined}
            wsStatus={wsStatus}
          />
        </div>
      </main>

      {/* ── Gov Analytics Overlay ─────────────────────────────────────────── */}
      {activeCam && (
        <GovOverlay
          open={govOpen}
          onClose={() => setGovOpen(false)}
          cameraId={activeCam.id}
          cameraName={activeCam.name}
        />
      )}

      {/* ── Login / Register placeholder (wired in Phase 2 full auth) ──────── */}
      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setLoginOpen(false)}
        >
          <div
            className="glass rounded-xl p-8 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-xl font-bold text-foreground mb-1">Sign in</h2>
            <p className="text-sm text-muted mb-6">Log in to make predictions and track your score.</p>
            <button
              onClick={async () => {
                await sb.auth.signInWithOAuth({ provider: "google",
                  options: { redirectTo: `${location.origin}/` } });
              }}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-white/5 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://www.google.com/favicon.ico" alt="" className="h-4 w-4" />
              Continue with Google
            </button>
            <button
              onClick={() => setLoginOpen(false)}
              className="mt-4 w-full text-center text-xs text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Demo mode indicator */}
      {demoActive && (
        <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse-dot" />
          DEMO ACTIVE
        </div>
      )}

      {/* suppress unused register modal state warning */}
      {registerOpen && null}
    </>
  );
}
