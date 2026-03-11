/**
 * /api/bets/place
 * Single endpoint for:
 *   POST ?live=1  → /bets/place-live  (live round guess)
 *   POST          → /bets/place       (market guess)
 *   GET  ?mode=history           → /bets/history
 *   GET  ?mode=my-round&round_id → /bets/my-round
 *
 * All requests require Authorization: Bearer <JWT> forwarded from client.
 * Node.js runtime: body parsing needs Node APIs for reliability.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mode = (searchParams.get("mode") ?? "").trim().toLowerCase();

  try {
    let upstream: Response;

    if (mode === "history") {
      const limitRaw  = Number(searchParams.get("limit") ?? 100);
      const safeLimit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 100;
      const roundId   = (searchParams.get("round_id") ?? "").trim();
      const qs        = new URLSearchParams({ limit: String(safeLimit) });
      if (roundId) qs.set("round_id", roundId);
      upstream = await fetch(`${railwayUrl}/bets/history?${qs.toString()}`, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
    } else if (mode === "my-round") {
      const roundId = (searchParams.get("round_id") ?? "").trim();
      if (!roundId) {
        return NextResponse.json({ error: "Missing round_id" }, { status: 400 });
      }
      const limitRaw  = Number(searchParams.get("limit") ?? 20);
      const safeLimit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 20;
      const qs        = new URLSearchParams({ round_id: roundId, limit: String(safeLimit) });
      upstream = await fetch(`${railwayUrl}/bets/my-round?${qs.toString()}`, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
    } else {
      return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
    }

    const raw = await upstream.text();
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : [];
    } catch {
      data = { detail: raw || "Upstream returned a non-JSON response" };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    console.error("[/api/bets/place GET] Upstream error:", err);
    return NextResponse.json({ error: "Upstream request failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const railwayUrl = process.env.RAILWAY_BACKEND_URL;
  if (!railwayUrl) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const isLive       = searchParams.get("live") === "1";
  const upstreamPath = isLive ? "/bets/place-live" : "/bets/place";

  try {
    const upstream = await fetch(`${railwayUrl}${upstreamPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    const raw = await upstream.text();
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { detail: raw || "Upstream returned a non-JSON response" };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    console.error("[/api/bets/place POST] Upstream error:", err);
    return NextResponse.json({ error: "Upstream request failed" }, { status: 502 });
  }
}
