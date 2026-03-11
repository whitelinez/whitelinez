"use client";
/**
 * lib/supabase-client.ts — Browser-side Supabase singleton.
 * Ported from src/core/supabase.js. Import this in Client Components only.
 * Server Components use lib/supabase-server.ts instead.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("[supabase-client] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
}

// Single instance — createClient is safe to call at module level on the client.
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce" },
});
