"use client";
/**
 * components/sidebar/Sidebar.tsx
 * 380px sidebar wrapper. Tab bar + panel routing.
 * Tabs: PLAY | RANKINGS | LIVE | INTEL
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import MarketsTab from "./MarketsTab";
import LeaderboardTab from "./LeaderboardTab";
import ChatTab from "./ChatTab";
import IntelTab, { type MlStats } from "./IntelTab";
import { LAYOUT } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = "markets" | "leaderboard" | "chat" | "intel";

interface Camera {
  id: string;
  name: string;
  alias?: string;
}

interface RoundInfo {
  id?: string;
  status?: string;
  title?: string;
}

type WsStatus = "connected" | "connecting" | "disconnected" | "error";

interface Props {
  cameras?: Camera[];
  activeCameraId?: string;
  wsCount?: number;
  roundInfo?: RoundInfo | null;
  wsStatus?: WsStatus;
  mlStats?: MlStats | null;
}

// ── Tab config ───────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; ariaLabel: string }[] = [
  { id: "markets",     label: "PLAY",     ariaLabel: "Guess panel" },
  { id: "leaderboard", label: "RANKINGS", ariaLabel: "Leaderboard rankings" },
  { id: "chat",        label: "LIVE",     ariaLabel: "Live chat" },
  { id: "intel",       label: "INTEL",    ariaLabel: "AI intelligence data" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function Sidebar({
  mlStats,
  wsStatus,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("markets");
  const [chatUnread, setChatUnread] = useState(0);

  // Listen for programmatic tab switches (e.g. "View Rankings" from bet result)
  useEffect(() => {
    function onTabSwitch(e: Event) {
      const tab = (e as CustomEvent<Tab>).detail;
      if (TABS.some((t) => t.id === tab)) {
        setActiveTab(tab);
        if (tab === "chat") setChatUnread(0);
      }
    }
    window.addEventListener("sidebar:tab", onTabSwitch);
    return () => window.removeEventListener("sidebar:tab", onTabSwitch);
  }, []);

  // Track chat unread when not on chat tab
  useEffect(() => {
    function onMessage() {
      if (activeTab !== "chat") setChatUnread((n) => n + 1);
    }
    window.addEventListener("chat:message-received", onMessage);
    return () => window.removeEventListener("chat:message-received", onMessage);
  }, [activeTab]);

  function handleTabClick(tab: Tab) {
    setActiveTab(tab);
    if (tab === "chat") setChatUnread(0);
  }

  return (
    <aside
      className="flex flex-col bg-surface border-l border-border h-full overflow-hidden"
      style={{ width: LAYOUT.SIDEBAR_W, minWidth: LAYOUT.SIDEBAR_W, maxWidth: LAYOUT.SIDEBAR_W }}
      aria-label="Game sidebar"
    >
      {/* Tab bar */}
      <nav
        className="flex-shrink-0 flex items-stretch bg-background border-b border-border sticky top-0 z-10"
        role="tablist"
        aria-label="Sidebar tabs"
      >
        {TABS.map((tab) => {
          const isActive   = activeTab === tab.id;
          const showBadge  = tab.id === "chat" && chatUnread > 0 && !isActive;
          const showOnline = tab.id === "chat" && wsStatus === "connected" && !showBadge;

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.ariaLabel}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "relative flex-1 flex items-center justify-center gap-1 py-3 text-[10px] font-label font-semibold tracking-wider transition-colors",
                isActive
                  ? "text-primary border-b-2 border-primary -mb-px"
                  : "text-muted hover:text-foreground border-b-2 border-transparent -mb-px"
              )}
            >
              {tab.label}

              {/* Chat unread badge */}
              {showBadge && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}

              {/* Live dot when connected on chat tab */}
              {showOnline && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-active animate-pulse-dot" />
              )}
            </button>
          );
        })}
      </nav>

      {/* WS status bar */}
      {wsStatus && wsStatus !== "connected" && (
        <div
          className={cn(
            "flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-label font-semibold tracking-wider",
            wsStatus === "connecting"
              ? "bg-amber-500/10 text-amber-400 border-b border-amber-500/20"
              : "bg-destructive/10 text-destructive border-b border-destructive/20"
          )}
        >
          <span className={cn(
            "w-1.5 h-1.5 rounded-full",
            wsStatus === "connecting" ? "bg-amber-400 animate-pulse" : "bg-destructive"
          )} />
          {wsStatus === "connecting" ? "Connecting..." : "Disconnected — retrying"}
        </div>
      )}

      {/* Tab panels */}
      <div
        className="flex-1 overflow-hidden"
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === activeTab)?.ariaLabel}
      >
        {/* Each panel mounted/unmounted for clean state */}
        {activeTab === "markets" && (
          <div className="h-full overflow-y-auto">
            <MarketsTab />
          </div>
        )}
        {activeTab === "leaderboard" && (
          <div className="h-full overflow-hidden flex flex-col">
            <LeaderboardTab />
          </div>
        )}
        {activeTab === "chat" && (
          <div className="h-full overflow-hidden flex flex-col">
            <ChatTab />
          </div>
        )}
        {activeTab === "intel" && (
          <div className="h-full overflow-y-auto">
            <IntelTab mlStats={mlStats} />
          </div>
        )}
      </div>
    </aside>
  );
}
