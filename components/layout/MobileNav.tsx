"use client";
/**
 * components/layout/MobileNav.tsx
 * Mobile-only bottom nav bar + slide-up sheet for sidebar content.
 * Visible below lg breakpoint. Mirrors Sidebar tab structure.
 */

import { useEffect, useState } from "react";
import { Target, Trophy, MessageSquare, BrainCircuit, X } from "lucide-react";
import { cn } from "@/lib/utils";
import MarketsTab     from "@/components/sidebar/MarketsTab";
import LeaderboardTab from "@/components/sidebar/LeaderboardTab";
import ChatTab        from "@/components/sidebar/ChatTab";
import IntelTab, { type MlStats } from "@/components/sidebar/IntelTab";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "markets" | "leaderboard" | "chat" | "intel";
type WsStatus = "connected" | "connecting" | "disconnected" | "error";

interface Props {
  wsStatus?: WsStatus;
  mlStats?:  MlStats | null;
}

// ── Tab config ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: "markets",     label: "PLAY",     Icon: Target         },
  { id: "leaderboard", label: "TOP",      Icon: Trophy         },
  { id: "chat",        label: "LIVE",     Icon: MessageSquare  },
  { id: "intel",       label: "INTEL",    Icon: BrainCircuit   },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function MobileNav({ wsStatus, mlStats }: Props) {
  const [activeTab,   setActiveTab]   = useState<Tab | null>(null);
  const [chatUnread,  setChatUnread]  = useState(0);

  // Listen for programmatic tab switches (e.g. "Rankings" from bet resolved card)
  useEffect(() => {
    function onTabSwitch(e: Event) {
      const tab = (e as CustomEvent<Tab>).detail;
      if (TABS.some(t => t.id === tab)) {
        setActiveTab(tab);
        if (tab === "chat") setChatUnread(0);
      }
    }
    window.addEventListener("sidebar:tab", onTabSwitch);
    return () => window.removeEventListener("sidebar:tab", onTabSwitch);
  }, []);

  // Unread badge for chat messages received while not on chat tab
  useEffect(() => {
    function onMsg() {
      if (activeTab !== "chat") setChatUnread(n => n + 1);
    }
    window.addEventListener("chat:message-received", onMsg);
    return () => window.removeEventListener("chat:message-received", onMsg);
  }, [activeTab]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (activeTab) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [activeTab]);

  function handleTabClick(tab: Tab) {
    setActiveTab(prev => (prev === tab ? null : tab));
    if (tab === "chat") setChatUnread(0);
  }

  const isOpen = activeTab !== null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden"
          onClick={() => setActiveTab(null)}
          aria-hidden
        />
      )}

      {/* Bottom Sheet */}
      <div
        className={cn(
          "fixed bottom-14 left-0 right-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-surface shadow-2xl transition-transform duration-300 ease-out lg:hidden",
          isOpen ? "translate-y-0" : "translate-y-full pointer-events-none"
        )}
        style={{ height: "76vh" }}
        aria-hidden={!isOpen}
      >
        {/* Drag handle + close */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-border mx-auto" />
          <button
            onClick={() => setActiveTab(null)}
            aria-label="Close panel"
            className="absolute right-3 top-2.5 p-1.5 rounded-md text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* WS status strip */}
        {wsStatus && wsStatus !== "connected" && (
          <div className={cn(
            "flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-label font-semibold tracking-wider border-b",
            wsStatus === "connecting"
              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              wsStatus === "connecting" ? "bg-amber-400 animate-pulse" : "bg-destructive"
            )} />
            {wsStatus === "connecting" ? "Connecting..." : "Disconnected — retrying"}
          </div>
        )}

        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "markets"     && <div className="h-full overflow-y-auto"><MarketsTab /></div>}
          {activeTab === "leaderboard" && <div className="h-full overflow-hidden flex flex-col"><LeaderboardTab /></div>}
          {activeTab === "chat"        && <div className="h-full overflow-hidden flex flex-col"><ChatTab /></div>}
          {activeTab === "intel"       && <div className="h-full overflow-y-auto"><IntelTab mlStats={mlStats} /></div>}
        </div>
      </div>

      {/* Bottom Nav Bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-stretch border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
        aria-label="Mobile navigation"
      >
        {TABS.map(({ id, label, Icon }) => {
          const isActive   = activeTab === id;
          const showBadge  = id === "chat" && chatUnread > 0 && !isActive;

          return (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              aria-label={label}
              aria-pressed={isActive}
              className={cn(
                "relative flex-1 flex flex-col items-center justify-center gap-1 text-[9px] font-label font-semibold tracking-wider transition-colors",
                isActive ? "text-primary" : "text-muted hover:text-foreground"
              )}
            >
              {/* Active indicator line */}
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" />
              )}

              <span className="relative">
                <Icon className="h-5 w-5" aria-hidden />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[14px] h-3.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold leading-none flex items-center justify-center px-0.5">
                    {chatUnread > 9 ? "9+" : chatUnread}
                  </span>
                )}
              </span>

              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
