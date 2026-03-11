/**
 * lib/supabase-server.ts — Server-side Supabase client (RSC / Route Handlers).
 * Uses @supabase/ssr for cookie-based session access in Server Components.
 * Import ONLY in server-side files (app/api/*, Server Components).
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string)                            { return cookieStore.get(name)?.value; },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set(name: string, value: string, opts: object) { try { (cookieStore as any).set(name, value, opts); } catch {} },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        remove(name: string, opts: object)           { try { (cookieStore as any).set(name, "", opts);    } catch {} },
      },
    }
  );
}

/** Service-role client for admin API routes — bypasses RLS. */
export function createSupabaseAdminClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: () => undefined, set: () => {}, remove: () => {} } }
  );
}
