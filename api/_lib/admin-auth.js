/**
 * Shared admin JWT verification helper.
 * Verifies the Bearer token against Supabase and confirms admin role.
 *
 * Returns { ok: true } on success, or { ok: false, status, error } on failure.
 */
export async function verifyAdminJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return { ok: false, status: 401, error: "Missing Bearer token" };

  const token = authHeader.slice(7).trim();
  if (token.split(".").length !== 3)
    return { ok: false, status: 401, error: "Malformed token" };

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey)
    return { ok: false, status: 500, error: "Server misconfiguration" };

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error("[admin-auth] Supabase /auth/v1/user status:", res.status, "url:", supabaseUrl.slice(0,50));
      return { ok: false, status: 401, error: "Invalid or expired token" };
    }
    const user = await res.json();
    const role = user?.app_metadata?.role;
    console.error("[admin-auth] uid:", user?.id?.slice(0,8), "role:", role, "email:", user?.email);
    if (role !== "admin")
      return { ok: false, status: 403, error: "Admin role required" };
    return { ok: true };
  } catch (e) {
    console.error("[admin-auth] exception:", e?.message);
    return { ok: false, status: 401, error: "Token verification failed" };
  }
}
