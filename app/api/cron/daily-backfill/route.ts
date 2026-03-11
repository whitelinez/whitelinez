/**
 * POST /api/cron/daily-backfill
 *
 * Triggers the backend traffic_daily aggregation for yesterday's data.
 * Called nightly at 02:00 UTC by Vercel Cron (Pro/Team plan required).
 * Can also be triggered manually:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://aitrafficja.com/api/cron/daily-backfill
 *
 * Env vars required:
 *   CRON_SECRET         — shared secret for auth
 *   RAILWAY_BACKEND_URL — backend base URL
 *   ADMIN_SECRET        — Bearer token for Railway /admin/* endpoints
 *
 * Note: Vercel Cron sends GET by default. Both GET and POST are handled to
 * support both cron and manual curl invocations.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

async function runBackfill(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl)
    return NextResponse.json({ error: "RAILWAY_BACKEND_URL not configured" }, { status: 500 });

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error("[cron/daily-backfill] ADMIN_SECRET not configured — aborting");
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  try {
    const r = await fetch(`${railwayUrl}/admin/backfill-daily?date=${yesterday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminSecret}` },
    });
    const body = await r.json().catch(() => ({}));
    return NextResponse.json({ triggered_for: yesterday, ...body }, { status: r.ok ? 200 : r.status });
  } catch (err) {
    console.error("[cron/daily-backfill]", err);
    return NextResponse.json({ error: "Upstream request failed", triggered_for: yesterday }, { status: 502 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return runBackfill(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return runBackfill(req);
}
