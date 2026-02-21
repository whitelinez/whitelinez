/**
 * admin-init.js — Admin dashboard: round creation, stats, recent rounds,
 * guardrail preview, user management, and dual zone editor init.
 */

let adminSession = null;

// ── Guardrail constants ────────────────────────────────────────────────────────
const MIN_DURATION_MIN      = 5;
const MAX_DURATION_MIN      = 480;
const THRESHOLD_MIN_PER_MIN = 0.5;
const THRESHOLD_MAX_PER_MIN = 25.0;
const CLASS_RATE = { car: 0.50, motorcycle: 0.20, truck: 0.15, bus: 0.10 };

// ── Historical baseline ────────────────────────────────────────────────────────
const hourlyBaseline = {};
let baselineLoaded   = false;
let baselineLoading  = false;

async function loadBaseline() {
  if (baselineLoaded || baselineLoading) return;
  baselineLoading = true;
  try {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data } = await window.sb
      .from("count_snapshots")
      .select("total, captured_at")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(5000);

    if (!data) return;
    const buckets = {};
    for (const row of data) {
      const hour = new Date(row.captured_at).getHours();
      if (!buckets[hour]) buckets[hour] = { sum: 0, count: 0 };
      buckets[hour].sum += row.total;
      buckets[hour].count += 1;
    }
    for (const h in buckets) {
      hourlyBaseline[h] = { avg: buckets[h].sum / buckets[h].count, count: buckets[h].count };
    }
    baselineLoaded = true;
  } catch (e) {
    console.warn("[admin-init] Baseline load failed:", e);
  } finally {
    baselineLoading = false;
  }
}

function getBaselineForHour(dateObj) {
  return hourlyBaseline[dateObj.getHours()] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtLocal(d) { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDurationMin(min) {
  if (min >= 60) { const h = Math.floor(min/60); const m = min%60; return m === 0 ? `${h}h` : `${h}h ${m}m`; }
  return `${min}m`;
}

function getComputedTimes() {
  const startsVal = document.getElementById("starts-at")?.value;
  const duration  = parseInt(document.getElementById("duration")?.value || "0", 10);
  const cutoff    = parseInt(document.getElementById("bet-cutoff")?.value || "1", 10);
  if (!startsVal || !duration) return null;
  const starts = new Date(startsVal);
  const ends   = new Date(starts.getTime() + duration * 60_000);
  const closes = new Date(ends.getTime()   - cutoff  * 60_000);
  return { starts, ends, closes, duration, cutoff };
}

// ── Live stats ────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    // Fetch latest snapshot
    const { data: snap } = await window.sb
      .from("count_snapshots")
      .select("total")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const countEl = document.getElementById("stat-count");
    if (countEl) countEl.textContent = snap?.total ?? "—";

    // Active round
    const { data: round } = await window.sb
      .from("bet_rounds")
      .select("status")
      .eq("status", "open")
      .limit(1)
      .maybeSingle();

    const roundEl = document.getElementById("stat-round");
    if (roundEl) roundEl.textContent = round ? "OPEN" : "—";

    // Bets placed today
    const since = new Date(); since.setHours(0,0,0,0);
    const { count: betCount } = await window.sb
      .from("bets")
      .select("id", { count: "exact", head: true })
      .gte("placed_at", since.toISOString());

    const betsEl = document.getElementById("stat-bets");
    if (betsEl) betsEl.textContent = betCount ?? "—";

    // WS users from health endpoint (best effort)
    try {
      const h = await fetch("/api/health");
      if (h.ok) {
        const hData = await h.json();
        const usersEl = document.getElementById("stat-users");
        if (usersEl) usersEl.textContent = hData.user_ws_connections ?? "—";
      }
    } catch {}
  } catch (e) {
    console.warn("[admin-init] Stats load failed:", e);
  }
}

// ── Recent rounds ─────────────────────────────────────────────────────────────
async function loadRecentRounds() {
  const container = document.getElementById("recent-rounds");
  if (!container) return;

  try {
    const { data } = await window.sb
      .from("bet_rounds")
      .select("id, status, market_type, opens_at, ends_at")
      .order("opens_at", { ascending: false })
      .limit(10);

    if (!data || data.length === 0) {
      container.innerHTML = `<p class="muted" style="font-size:0.85rem">No rounds yet.</p>`;
      return;
    }

    container.innerHTML = data.map(r => {
      const d = new Date(r.opens_at);
      const timeStr = d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
      const locked = r.status === "locked";
      return `
        <div class="round-row">
          <div class="round-row-info">
            <span class="round-row-id">${r.id.slice(0,8)}…</span>
            <span class="round-row-meta">
              <span class="round-badge round-${r.status}">${r.status.toUpperCase()}</span>
              ${r.market_type.replace(/_/g," ")} · ${timeStr}
            </span>
          </div>
          ${locked ? `<button class="btn-resolve" data-round-id="${r.id}">Resolve</button>` : ""}
        </div>`;
    }).join("");

    // Resolve buttons
    container.querySelectorAll(".btn-resolve").forEach(btn => {
      btn.addEventListener("click", () => resolveRound(btn.dataset.roundId, btn));
    });

  } catch (e) {
    console.warn("[admin-init] Recent rounds load failed:", e);
  }
}

async function resolveRound(roundId, btn) {
  if (!adminSession) return;
  btn.disabled = true;
  btn.textContent = "Resolving...";
  try {
    const res = await fetch(`/api/admin/rounds`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSession.access_token}`,
      },
      body: JSON.stringify({ round_id: roundId }),
    });
    if (res.ok) {
      loadRecentRounds();
    } else {
      btn.textContent = "Error";
      btn.disabled = false;
    }
  } catch {
    btn.textContent = "Error";
    btn.disabled = false;
  }
}

// ── Preview update ────────────────────────────────────────────────────────────
async function updatePreview() {
  const marketType   = document.getElementById("market-type")?.value;
  const vehicleClass = document.getElementById("vehicle-class")?.value;
  const threshold    = parseInt(document.getElementById("threshold")?.value || "0", 10);

  const preview    = document.getElementById("round-preview");
  const prevDur    = document.getElementById("prev-duration");
  const prevRate   = document.getElementById("prev-rate");
  const prevExpRow = document.getElementById("prev-expected-row");
  const prevExp    = document.getElementById("prev-expected");
  const prevWarn   = document.getElementById("prev-warning");
  const prevOk     = document.getElementById("prev-ok");
  const submitBtn  = document.getElementById("round-submit-btn");
  const ctRow      = document.getElementById("computed-times");
  const ctCloses   = document.getElementById("computed-closes");
  const ctEnds     = document.getElementById("computed-ends");

  const times = getComputedTimes();
  if (!times) {
    preview?.classList.add("hidden");
    if (ctRow) ctRow.style.display = "none";
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  const { starts, ends, closes, duration } = times;
  if (ctRow) ctRow.style.display = "";
  if (ctCloses) ctCloses.textContent = fmtLocal(closes);
  if (ctEnds)   ctEnds.textContent   = fmtLocal(ends);

  preview?.classList.remove("hidden");
  if (prevDur) prevDur.textContent = fmtDurationMin(duration);

  await loadBaseline();
  const baseline = getBaselineForHour(starts);
  const avgOccupancy = baseline?.avg ?? null;

  if (prevRate) {
    prevRate.textContent = avgOccupancy !== null
      ? `~${avgOccupancy.toFixed(1)} vehicles (${baseline.count} samples)`
      : "No historical data yet";
  }

  prevWarn?.classList.add("hidden");
  prevOk?.classList.add("hidden");
  const warnings = [];

  if (duration < MIN_DURATION_MIN)
    warnings.push(`Too short — minimum is ${MIN_DURATION_MIN} minutes.`);
  if (duration > MAX_DURATION_MIN)
    warnings.push(`Too long — maximum is ${MAX_DURATION_MIN} minutes.`);

  if (marketType === "over_under" || marketType === "vehicle_count") {
    prevExpRow?.classList.remove("hidden");
    const multiplier = marketType === "vehicle_count" ? (CLASS_RATE[vehicleClass] ?? 0.25) : 1.0;
    const minThresh = Math.max(1, Math.ceil(duration * THRESHOLD_MIN_PER_MIN * multiplier));
    const maxThresh = Math.max(5, Math.floor(duration * THRESHOLD_MAX_PER_MIN * multiplier));

    let expectedText = `${minThresh}–${maxThresh}`;
    if (avgOccupancy !== null) {
      const est = Math.round(avgOccupancy * duration * multiplier * 0.4);
      expectedText = `~${est} vehicles (valid: ${minThresh}–${maxThresh})`;
    }
    if (prevExp) prevExp.textContent = expectedText;

    const typeLabel = marketType === "vehicle_count"
      ? `for ${vehicleClass}s in ${fmtDurationMin(duration)}`
      : `for ${fmtDurationMin(duration)}`;

    if (!isNaN(threshold)) {
      if (threshold < minThresh)
        warnings.push(`Threshold ${threshold} too low ${typeLabel}. Min: ${minThresh}.`);
      else if (threshold > maxThresh)
        warnings.push(`Threshold ${threshold} too high ${typeLabel}. Max: ${maxThresh}.`);
    }
  } else {
    prevExpRow?.classList.add("hidden");
  }

  if (warnings.length) {
    if (prevWarn) {
      prevWarn.innerHTML = warnings.map(w => `<div>⚠ ${w}</div>`).join("");
      prevWarn.classList.remove("hidden");
    }
    if (submitBtn) submitBtn.disabled = true;
  } else if (duration >= MIN_DURATION_MIN) {
    prevOk?.classList.remove("hidden");
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ── Market builder ────────────────────────────────────────────────────────────
function buildMarkets(marketType, vehicleClass, threshold) {
  if (marketType === "over_under") {
    return [
      { label: `Over ${threshold} vehicles`,    outcome_key: "over",  odds: 1.85 },
      { label: `Under ${threshold} vehicles`,   outcome_key: "under", odds: 1.85 },
      { label: `Exactly ${threshold} vehicles`, outcome_key: "exact", odds: 15.0 },
    ];
  }
  if (marketType === "vehicle_count") {
    const label = { car:"cars", truck:"trucks", bus:"buses", motorcycle:"motorcycles" }[vehicleClass] ?? vehicleClass;
    return [
      { label: `Over ${threshold} ${label}`,    outcome_key: "over",  odds: 1.85 },
      { label: `Under ${threshold} ${label}`,   outcome_key: "under", odds: 1.85 },
      { label: `Exactly ${threshold} ${label}`, outcome_key: "exact", odds: 15.0 },
    ];
  }
  if (marketType === "vehicle_type") {
    return [
      { label: "Cars lead",        outcome_key: "car",        odds: 2.00 },
      { label: "Trucks lead",      outcome_key: "truck",      odds: 3.50 },
      { label: "Buses lead",       outcome_key: "bus",        odds: 4.00 },
      { label: "Motorcycles lead", outcome_key: "motorcycle", odds: 5.00 },
    ];
  }
  return [];
}

// ── Form submission ───────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const errorEl   = document.getElementById("round-error");
  const successEl = document.getElementById("round-success");
  const btn       = document.getElementById("round-submit-btn");
  errorEl.textContent = "";
  successEl.textContent = "";
  btn.disabled = true;

  const jwt = adminSession?.access_token;
  if (!jwt) return;

  const marketType   = document.getElementById("market-type").value;
  const vehicleClass = document.getElementById("vehicle-class").value;
  const threshold    = parseInt(document.getElementById("threshold").value, 10);
  const times        = getComputedTimes();
  if (!times) { errorEl.textContent = "Fill in start time and duration."; btn.disabled = false; return; }

  const { starts, ends, closes } = times;
  const { data: cameras } = await window.sb.from("cameras").select("id").eq("is_active", true).limit(1);
  const cameraId = cameras?.[0]?.id;
  if (!cameraId) { errorEl.textContent = "No active camera found."; btn.disabled = false; return; }

  const markets = buildMarkets(marketType, vehicleClass, threshold);
  const params  = {
    threshold,
    vehicle_class: marketType === "vehicle_count" ? vehicleClass : undefined,
    duration_sec: Math.floor((ends - starts) / 1000),
  };

  try {
    const res = await fetch("/api/admin/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        camera_id: cameraId,
        market_type: marketType,
        params,
        opens_at:  starts.toISOString(),
        closes_at: closes.toISOString(),
        ends_at:   ends.toISOString(),
        markets,
      }),
    });

    if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "Failed"); }

    successEl.textContent = "Round created! Auto-opens at scheduled time.";
    document.getElementById("round-form").reset();
    document.getElementById("round-preview")?.classList.add("hidden");
    document.getElementById("computed-times").style.display = "none";
    setDefaultTimes();
    loadRecentRounds();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ── User management ───────────────────────────────────────────────────────────
async function handleSetAdmin() {
  const emailEl = document.getElementById("admin-email-input");
  const msgEl   = document.getElementById("user-mgmt-msg");
  const email   = emailEl?.value?.trim();
  if (!email) return;
  if (!adminSession?.access_token) return;
  msgEl.textContent = "Setting...";
  try {
    // Use Supabase admin RPC or update user_metadata
    // This calls an RPC set_admin_by_email if available, otherwise shows a note
    const { error } = await window.sb.rpc("set_admin_by_email", { p_email: email });
    if (error) throw error;
    msgEl.style.color = "var(--green)";
    msgEl.textContent = `Admin role set for ${email}`;
  } catch (e) {
    msgEl.style.color = "var(--red)";
    msgEl.textContent = e.message || "Failed — ensure set_admin_by_email RPC exists";
  }
}

// ── Default times ─────────────────────────────────────────────────────────────
function setDefaultTimes() {
  const now = new Date(); now.setSeconds(0, 0);
  const starts = new Date(now.getTime() + 60_000);
  const pad = (n) => String(n).padStart(2, "0");
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const el = document.getElementById("starts-at");
  if (el) el.value = toLocal(starts);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  adminSession = await Auth.requireAdmin("/index.html");
  if (!adminSession) return;

  const { data: cameras } = await window.sb.from("cameras").select("id").eq("is_active", true).limit(1);
  const cameraId = cameras?.[0]?.id;

  const video  = document.getElementById("admin-video");
  const canvas = document.getElementById("line-canvas");
  await Stream.init(video);

  video.addEventListener("loadedmetadata", () => {
    AdminLine.init(video, canvas, cameraId);
  });
  if (video.videoWidth) AdminLine.init(video, canvas, cameraId);

  // Load stats + recent rounds
  loadBaseline();
  loadStats();
  loadRecentRounds();
  setInterval(loadStats, 10_000);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-logout")?.addEventListener("click", () => Auth.logout());
  document.getElementById("round-form")?.addEventListener("submit", handleSubmit);
  document.getElementById("btn-set-admin")?.addEventListener("click", handleSetAdmin);

  // Market type visibility
  document.getElementById("market-type")?.addEventListener("change", (e) => {
    const type = e.target.value;
    document.getElementById("threshold-field").style.display  = type === "vehicle_type" ? "none" : "";
    document.getElementById("vehicle-class-field").style.display = type === "vehicle_count" ? "" : "none";
    const lbl = document.getElementById("threshold-label");
    if (lbl) lbl.textContent = type === "vehicle_count" ? "Threshold (vehicles of that type)" : "Threshold (vehicles)";
    updatePreview();
  });

  ["market-type","vehicle-class","threshold","starts-at","duration","bet-cutoff"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",  updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });

  setDefaultTimes();
  updatePreview();
});

init();
