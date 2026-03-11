"use client";
/**
 * contexts/AuthContext.tsx
 * Provides auth state + profile across the app via React context.
 *
 * Usage:
 *   // In layout.tsx (or any server/client boundary parent):
 *   <AuthProvider>...</AuthProvider>
 *
 *   // In any client component:
 *   const { user, profile, balance, isAdmin, isLoading, signOut } = useAuth();
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { sb } from "@/lib/supabase-client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id:           string;
  username:     string | null;
  display_name: string | null;
  avatar_url:   string | null;
  points:       number;
  role:         string | null;
}

export interface AuthState {
  user:      User | null;
  session:   Session | null;
  profile:   UserProfile | null;
  balance:   number;
  isAdmin:   boolean;
  isLoading: boolean;
  signOut:   () => Promise<void>;
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,      setUser]      = useState<User | null>(null);
  const [session,   setSession]   = useState<Session | null>(null);
  const [profile,   setProfile]   = useState<UserProfile | null>(null);
  const [balance,   setBalance]   = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // ── Fetch profile from `profiles` table ───────────────────────────────────
  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await sb
      .from("profiles")
      .select("id, username, display_name, avatar_url, points, role")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("[AuthContext] profile fetch error:", error.message);
      return;
    }
    if (data) {
      const p: UserProfile = {
        id:           data.id           as string,
        username:     data.username     as string | null,
        display_name: data.display_name as string | null,
        avatar_url:   data.avatar_url   as string | null,
        points:       (data.points      as number) ?? 0,
        role:         data.role         as string | null,
      };
      setProfile(p);
      setBalance(p.points);
    }
  }, []);

  // ── Bootstrap on mount ────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    // Get the initial session synchronously from storage
    sb.auth.getSession().then(({ data: { session: initial } }) => {
      if (!mounted) return;
      setSession(initial);
      setUser(initial?.user ?? null);
      if (initial?.user) {
        fetchProfile(initial.user.id).finally(() => {
          if (mounted) setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    // Subscribe to future auth state changes
    const { data: { subscription } } = sb.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          fetchProfile(newSession.user.id);
        } else {
          setProfile(null);
          setBalance(0);
        }
        setIsLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // ── Realtime: listen for balance/profile updates ──────────────────────────
  useEffect(() => {
    if (!user) return;

    const channel = sb
      .channel(`profile:${user.id}`)
      .on(
        "postgres_changes",
        {
          event:  "UPDATE",
          schema: "public",
          table:  "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as Partial<UserProfile>;
          setProfile(prev => prev ? { ...prev, ...updated } : null);
          if (updated.points != null) setBalance(updated.points);
        }
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [user]);

  // ── Sign out ──────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    await sb.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setBalance(0);
  }, []);

  const isAdmin = profile?.role === "admin";

  return (
    <AuthContext.Provider
      value={{ user, session, profile, balance, isAdmin, isLoading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
