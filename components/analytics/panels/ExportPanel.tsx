"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExportType = "traffic" | "zones" | "agency";

interface ExportConfig {
  type: ExportType;
  label: string;
  description: string;
  filename: (from: string) => string;
  route: string;
}

const EXPORTS: ExportConfig[] = [
  {
    type: "traffic",
    label: "Traffic Data",
    description: "Individual vehicle detections — timestamp, class, direction, confidence, dwell time",
    filename: (from) => `traffic-${from}.csv`,
    route: "export",
  },
  {
    type: "zones",
    label: "Zone Flow",
    description: "Entry/exit counts grouped by detection zone — vehicles by class per zone",
    filename: (from) => `zone-flow-${from}.csv`,
    route: "zones",
  },
  {
    type: "agency",
    label: "Agency Report",
    description: "Daily summary report — total, class breakdown, inbound/outbound — one row per day",
    filename: (from) => `agency-report-${from}.csv`,
    route: "traffic",
  },
];

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  message,
}: {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
}) {
  if (status === "idle") return null;
  return (
    <span className={cn(
      "text-[11px] font-mono-data px-2 py-0.5 rounded",
      status === "loading" && "text-muted-foreground bg-surface animate-pulse",
      status === "success" && "text-green-active bg-green-active/10",
      status === "error"   && "text-destructive bg-destructive/10",
    )}>
      {status === "loading" && "Preparing download…"}
      {status === "success" && (message ?? "Downloaded")}
      {status === "error"   && (message ?? "Export failed")}
    </span>
  );
}

// ── Single export row ─────────────────────────────────────────────────────────

function ExportRow({
  config,
  fromDate,
  toDate,
  cameraId,
  jwt,
}: {
  config: ExportConfig;
  fromDate: string;
  toDate: string;
  cameraId: string;
  jwt: string | null;
}) {
  const [status,  setStatus]  = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | undefined>(undefined);

  const handleDownload = useCallback(async () => {
    if (status === "loading") return;
    setStatus("loading");
    setMessage(undefined);

    try {
      const from = new Date(fromDate + "T00:00:00").toISOString();
      const to   = new Date(toDate   + "T23:59:59").toISOString();

      let url: string;
      let headers: Record<string, string> = {};

      if (config.type === "traffic") {
        // Full export requires auth
        if (!jwt) {
          setStatus("error");
          setMessage("Login required to export data");
          return;
        }
        const qs = new URLSearchParams({ _route: "export", from, to });
        if (cameraId) qs.set("camera_id", cameraId);
        url = `/api/analytics?${qs}`;
        headers = { Authorization: `Bearer ${jwt}` };
      } else if (config.type === "zones") {
        const qs = new URLSearchParams({ _route: "zones", from, to });
        if (cameraId) qs.set("camera_id", cameraId);
        url = `/api/analytics?${qs}`;
      } else {
        // Agency report — use traffic daily granularity
        const qs = new URLSearchParams({ _route: "traffic", from, to, granularity: "day" });
        if (cameraId) qs.set("camera_id", cameraId);
        url = `/api/analytics?${qs}`;
      }

      const res = await fetch(url, { headers });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        setStatus("error");
        setMessage((err as { error?: string }).error ?? "Export failed");
        return;
      }

      let blob: Blob;
      const contentType = res.headers.get("Content-Type") ?? "";

      if (contentType.includes("csv")) {
        blob = await res.blob();
      } else {
        // JSON response — convert to CSV for agency/zones
        const data = await res.json();
        const csv  = _jsonToCsv(data, config.type);
        blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), {
        href: blobUrl,
        download: config.filename(fromDate),
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

      const rows = res.headers.get("X-Total-Rows");
      setStatus("success");
      setMessage(rows ? `Downloaded ${Number(rows).toLocaleString()} rows` : "Downloaded");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Download failed");
    }
  }, [config, fromDate, toDate, cameraId, jwt, status]);

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-display font-semibold text-foreground">{config.label}</span>
        <span className="text-[11px] text-muted-foreground leading-relaxed">{config.description}</span>
        {status !== "idle" && <StatusBadge status={status} message={message} />}
      </div>
      <button
        onClick={handleDownload}
        disabled={status === "loading"}
        className={cn(
          "shrink-0 px-4 py-2 rounded text-[12px] font-label font-bold tracking-wider",
          "bg-surface border border-border text-muted-foreground",
          "hover:border-primary hover:text-primary transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "flex items-center gap-2"
        )}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 1v9M4 7l4 4 4-4M2 14h12"/>
        </svg>
        {status === "loading" ? "Preparing…" : "Download CSV"}
      </button>
    </div>
  );
}

// ── JSON → CSV conversion helpers ─────────────────────────────────────────────

function _csvSanitize(value: unknown): string {
  const s = String(value == null ? "" : value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function _jsonToCsv(data: unknown, type: ExportType): string {
  if (type === "zones") {
    const d = data as { zones?: Array<{ zone_name: string; total: number; car: number; truck: number; bus: number; motorcycle: number; pct_of_total: number }> };
    if (!d.zones?.length) return "zone_name,total,car,truck,bus,motorcycle,pct_of_total\n";
    const lines = ["zone_name,total,car,truck,bus,motorcycle,pct_of_total"];
    for (const z of d.zones) {
      lines.push([
        _csvSanitize(z.zone_name), z.total, z.car, z.truck, z.bus, z.motorcycle, z.pct_of_total,
      ].join(","));
    }
    return lines.join("\n");
  }

  if (type === "agency") {
    const d = data as { rows?: Array<{ period: string; total: number; car: number; truck: number; bus: number; motorcycle: number; in: number; out: number }> };
    if (!d.rows?.length) return "period,total,car,truck,bus,motorcycle,inbound,outbound\n";
    const lines = ["period,total,car,truck,bus,motorcycle,inbound,outbound"];
    for (const r of d.rows) {
      lines.push([
        _csvSanitize(r.period), r.total ?? 0, r.car ?? 0, r.truck ?? 0, r.bus ?? 0, r.motorcycle ?? 0, r.in ?? 0, r.out ?? 0,
      ].join(","));
    }
    return lines.join("\n");
  }

  return "";
}

// ── Main ExportPanel ──────────────────────────────────────────────────────────

interface ExportPanelProps {
  cameraId: string;
  jwt: string | null;
}

export function ExportPanel({ cameraId, jwt }: ExportPanelProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate,   setToDate]   = useState<string>(today);

  return (
    <div className="flex flex-col gap-5 pb-6">

      {/* Date range controls */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <div className="text-[11px] font-label font-bold tracking-[0.14em] text-muted-foreground uppercase">
          Export Date Range
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">From</label>
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={cn(
                "bg-surface border border-border rounded px-2 py-1",
                "text-[12px] font-mono-data text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary"
              )}
            />
          </div>
          <span className="text-muted-foreground text-[11px]">→</span>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              className={cn(
                "bg-surface border border-border rounded px-2 py-1",
                "text-[12px] font-mono-data text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary"
              )}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/60">
          Maximum 90-day range per export. Traffic Data requires authentication.
        </p>
      </div>

      {/* Export rows */}
      <div className="flex flex-col gap-3">
        {EXPORTS.map((cfg) => (
          <ExportRow
            key={cfg.type}
            config={cfg}
            fromDate={fromDate}
            toDate={toDate}
            cameraId={cameraId}
            jwt={jwt}
          />
        ))}
      </div>

      {/* Note for unauthenticated users */}
      {!jwt && (
        <div className="bg-surface border border-border rounded-lg px-4 py-3 text-[12px] text-muted-foreground">
          <span className="text-accent font-semibold">Note: </span>
          Traffic Data export requires an admin account. Zone Flow and Agency Report are publicly accessible.
        </div>
      )}
    </div>
  );
}
