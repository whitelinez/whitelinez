"use client";
/**
 * components/sidebar/ChatTab.tsx
 * LIVE tab — public chat with Supabase realtime.
 * Guests can chat, profiles shown via profiles table.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { sb } from "@/lib/supabase-client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  user_id: string | null;
  guest_id?: string | null;
  username: string | null;
  content: string;
  created_at: string;
  system?: boolean;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

interface ProfileCache {
  name: string;
  avatarUrl: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_MESSAGES     = 100;
const CHAR_LIMIT       = 280;
const SEND_COOLDOWN_MS = 1500;
const LOAD_LIMIT       = 40;

const GUEST_ID_KEY   = "wlz.chat.guest_id";
const GUEST_NAME_KEY = "wlz.chat.guest_name";

// ── Helpers ──────────────────────────────────────────────────────────────────

function userAccent(seed: string): string {
  const palette = ["#00d4ff","#22c55e","#a78bfa","#f472b6","#fb923c","#4ade80","#e879f9","#60a5fa","#f59e0b","#2dd4bf"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(hash >> 3) % palette.length];
}

function defaultAvatarSvg(seed: string): string {
  const color = userAccent(seed);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 64 64'><rect width='64' height='64' rx='8' fill='#0c1320'/><circle cx='32' cy='23' r='12' fill='${color}' opacity='0.88'/><path d='M8 62 Q8 44 32 40 Q56 44 56 62Z' fill='${color}' opacity='0.7'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getOrCreateGuest(): { id: string; username: string } {
  let id = "", name = "";
  try {
    id   = localStorage.getItem(GUEST_ID_KEY)   ?? "";
    name = localStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch { /* SSR */ }
  if (!id) {
    id = `guest-${Math.random().toString(36).slice(2, 10)}`;
    try { localStorage.setItem(GUEST_ID_KEY, id); } catch {}
  }
  if (!name) {
    name = `Guest-${id.slice(-4).toUpperCase()}`;
    try { localStorage.setItem(GUEST_NAME_KEY, name); } catch {}
  }
  return { id, username: name };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Message row ──────────────────────────────────────────────────────────────

interface MsgRowProps {
  msg: Message;
  profile: ProfileCache | undefined;
  continued: boolean;
  ownName: string;
}

function MsgRow({ msg, profile, continued, ownName }: MsgRowProps) {
  if (msg.system) {
    return (
      <div className="flex items-center justify-center gap-2 py-1">
        <span className="text-[10px] text-muted/70 bg-card/50 border border-border/50 rounded-full px-2 py-0.5">
          {msg.content}
        </span>
        {msg.created_at && (
          <span className="text-[9px] text-muted/40">{formatTime(msg.created_at)}</span>
        )}
      </div>
    );
  }

  const name   = profile?.name ?? msg.username ?? "User";
  const avatar = profile?.avatarUrl ?? defaultAvatarSvg(msg.user_id ?? name);
  const color  = userAccent(msg.user_id ?? name);

  // Mention highlighting
  const renderContent = () => {
    const selfNorm = ownName.trim().toLowerCase();
    const parts    = msg.content.split(/((?:^|[\s(])@[a-zA-Z0-9_.-]{1,32})/g);
    return parts.map((part, idx) => {
      const mentionMatch = part.match(/@([a-zA-Z0-9_.-]{1,32})/);
      if (mentionMatch) {
        const isSelf = mentionMatch[1].toLowerCase() === selfNorm;
        return (
          <span
            key={idx}
            className={cn(
              "font-semibold",
              isSelf ? "text-accent bg-accent/10 rounded px-0.5" : "text-primary"
            )}
          >
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className={cn("flex gap-2 px-3", continued ? "pt-0.5 pb-0" : "pt-2 pb-0")}>
      {continued ? (
        <div className="w-6 flex-shrink-0" />
      ) : (
        <img
          src={avatar}
          alt={name}
          width={24}
          height={24}
          className="rounded-md flex-shrink-0 mt-0.5 object-cover"
          style={{ outline: `1px solid ${color}44` }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultAvatarSvg(msg.user_id ?? name); }}
        />
      )}
      <div className="flex-1 min-w-0">
        {!continued && (
          <div className="flex items-baseline gap-1.5 mb-0.5">
            <span className="font-semibold text-xs" style={{ color }}>{escapeHtml(name)}</span>
            <span className="text-[9px] text-muted/50">{msg.created_at ? formatTime(msg.created_at) : ""}</span>
          </div>
        )}
        <p className="text-foreground/90 text-sm leading-snug break-words">
          {renderContent()}
        </p>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ChatTab() {
  const { user, isLoading: authLoading } = useAuth();

  const [messages, setMessages]     = useState<Message[]>([]);
  const [profiles, setProfiles]     = useState<Map<string, ProfileCache>>(new Map());
  const [onlineCount, setOnlineCount] = useState(0);
  const [input, setInput]           = useState("");
  const [sending, setSending]       = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef     = useRef<RealtimeChannel | null>(null);
  const presenceRef    = useRef<RealtimeChannel | null>(null);
  const lastSentRef    = useRef(0);
  const guestRef       = useRef<{ id: string; username: string } | null>(null);

  // ── Guest identity ─────────────────────────────────────────────────────

  const getGuestId = useCallback(() => {
    if (!guestRef.current) guestRef.current = getOrCreateGuest();
    return guestRef.current;
  }, []);

  const myName = useCallback(() => {
    if (user) {
      return (user as { user_metadata?: { username?: string }; email?: string }).user_metadata?.username
        ?? (user as { email?: string }).email?.split("@")[0]
        ?? "User";
    }
    return getGuestId().username;
  }, [user, getGuestId]);

  // ── Profile loader ─────────────────────────────────────────────────────

  const loadProfiles = useCallback(async (ids: string[]) => {
    const newIds = ids.filter((id) => id && !profiles.has(id));
    if (!newIds.length) return;
    try {
      const { data } = await sb
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", newIds);
      if (!data) return;
      setProfiles((prev) => {
        const next = new Map(prev);
        for (const p of data) {
          next.set(p.id, { name: p.display_name ?? `Player ${p.id.slice(0, 5)}`, avatarUrl: p.avatar_url ?? null });
        }
        return next;
      });
    } catch { /* non-fatal */ }
  }, [profiles]);

  // ── Scroll to bottom ───────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  // ── Load history ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await sb
          .from("messages")
          .select("id, user_id, guest_id, username, content, created_at")
          .order("created_at", { ascending: true })
          .limit(LOAD_LIMIT);
        if (error) throw error;
        if (cancelled) return;
        const msgs = (data ?? []) as Message[];
        setMessages(msgs);
        const userIds = msgs.map((m) => m.user_id).filter(Boolean) as string[];
        await loadProfiles(userIds);
        scrollToBottom();
      } catch {
        // graceful — chat may not have table yet
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Realtime subscription ──────────────────────────────────────────────

  useEffect(() => {
    if (channelRef.current) sb.removeChannel(channelRef.current);

    channelRef.current = sb
      .channel("chat-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const msg = payload.new as Message;
          if (msg.user_id) await loadProfiles([msg.user_id]);
          setMessages((prev) => {
            const next = [...prev, msg];
            return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
          });
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) sb.removeChannel(channelRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Presence ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (presenceRef.current) sb.removeChannel(presenceRef.current);

    const presenceKey = (user as { id?: string } | null)?.id ?? getGuestId().id;

    presenceRef.current = sb
      .channel("chat-presence", { config: { presence: { key: presenceKey } } })
      .on("presence", { event: "sync" }, function (this: RealtimeChannel) {
        const state = (this as { presenceState?: () => Record<string, unknown[]> }).presenceState?.() ?? {};
        setOnlineCount(Object.values(state).flat().length);
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        const payload = (user as { id?: string } | null)?.id
          ? { user_id: (user as { id: string }).id, username: myName(), online_at: new Date().toISOString() }
          : { guest_id: getGuestId().id, username: myName(), is_guest: true, online_at: new Date().toISOString() };
        await presenceRef.current?.track(payload);
      });

    return () => {
      if (presenceRef.current) sb.removeChannel(presenceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Send ───────────────────────────────────────────────────────────────

  async function handleSend() {
    const now = Date.now();
    if (now - lastSentRef.current < SEND_COOLDOWN_MS) return;
    const content = input.trim();
    if (!content || content.length > CHAR_LIMIT) return;

    setSending(true);
    lastSentRef.current = now;
    setInput("");

    try {
      const uid   = (user as { id?: string } | null)?.id;
      const guest = getGuestId();
      const payload: Record<string, unknown> = {
        username: myName(),
        content,
      };
      if (uid)  payload.user_id  = uid;
      else      payload.guest_id = guest.id;

      const { error } = await sb.from("messages").insert(payload);
      if (error) throw error;
    } catch {
      setInput(input); // restore on failure
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Build last-sender map for grouping ────────────────────────────────

  const getLastSenderId = (messages: Message[], idx: number): string | null => {
    if (idx === 0) return null;
    const prev = messages[idx - 1];
    return prev.system ? null : (prev.user_id ?? prev.username ?? null);
  };

  const currentSenderId = (msg: Message) => msg.user_id ?? msg.username ?? null;

  const guestInfo = !authLoading && !user ? getGuestId() : null;

  return (
    <div className="flex flex-col h-full">
      {/* Online badge */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-xs text-muted">
          {onlineCount > 0 ? (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-active mr-1 animate-pulse-dot" />
              {onlineCount} online
            </>
          ) : (
            "Live chat"
          )}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {loadingHistory ? (
          <div className="flex flex-col gap-2 px-4 py-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-2">
                <div className="w-6 h-6 rounded-md bg-card border border-border animate-pulse flex-shrink-0" />
                <div className="flex-1 h-8 rounded-md bg-card border border-border animate-pulse" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full py-10">
            <p className="text-muted text-sm text-center">
              No messages yet.<br />
              <span className="text-muted/60 text-xs">Start the conversation.</span>
            </p>
          </div>
        ) : (
          <div className="pb-2">
            {messages.map((msg, idx) => {
              const prevId    = getLastSenderId(messages, idx);
              const currId    = currentSenderId(msg);
              const continued = !msg.system && prevId !== null && prevId === currId;
              return (
                <MsgRow
                  key={msg.id ?? `${msg.created_at}-${idx}`}
                  msg={msg}
                  profile={msg.user_id ? profiles.get(msg.user_id) : undefined}
                  continued={continued}
                  ownName={myName()}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Guest hint */}
      {guestInfo && (
        <div className="px-4 py-1.5 text-[11px] text-muted/70 bg-background/50 border-t border-border/50">
          Chatting as <strong className="text-muted">{guestInfo.username}</strong>.{" "}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("auth:open"))}
            className="text-primary hover:underline"
          >
            Login
          </button>{" "}
          to keep your profile.
        </div>
      )}

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-border p-3 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, CHAR_LIMIT))}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Send a message..."
          disabled={sending}
          className="flex-1 resize-none rounded-md bg-card border border-border text-foreground text-sm px-3 py-2 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 placeholder:text-muted/50 disabled:opacity-50 max-h-20 overflow-y-auto"
          style={{ minHeight: "36px" }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          aria-label="Send message"
          className="flex-shrink-0 w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? (
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </div>

      {/* Char counter */}
      {input.length > CHAR_LIMIT * 0.8 && (
        <div className="px-4 pb-2 text-right">
          <span className={cn("text-[10px]", input.length >= CHAR_LIMIT ? "text-destructive" : "text-muted")}>
            {input.length}/{CHAR_LIMIT}
          </span>
        </div>
      )}
    </div>
  );
}
