/**
 * admin-init.js — Admin round creation with simplified timing,
 * vehicle_count support, live guardrail preview, and historical baseline.
 */

let adminSession = null;

// ── Guardrail constants (mirror models/round.py) ──────────────────────────────
const MIN_DURATION_MIN      = 5;
const MAX_DURATION_MIN      = 480;
const MIN_ODDS              = 1.20;
const THRESHOLD_MIN_PER_MIN = 0.5;
const THRESHOLD_MAX_PER_MIN = 25.0;

// Class-specific rate multipliers (fraction of total zone traffic)
const CLASS_RATE = { car: 0.50, motorcycle: 0.20, truck: 0.15, bus: 0.10 };

// ── Historical baseline (24/7 data) ───────────────────────────────────────────
// Keyed by hour-of-day (0-23): { avg, count }
const hourlyBaseline = {};
let baselineLoaded   = false;
let baselineLoading  = false;

async function loadBaseline() {
  if (baselineLoaded || baselineLoading) return;
  baselineLoading = true;
  try {
    // Pull last 7 days of snapshots; group by hour client-side
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data } = await window.sb
      .from("count_snapshots")
      .select("total, captured_at")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(5000);

    if (!data) return;

    // Group by hour-of-day
    const buckets = {};
    for (const row of data) {
      const hour = new Date(row.captured_at).getHours();
      if (!buckets[hour]) buckets[hour] = { sum: 0, count: 0 };
      buckets[hour].sum += row.total;
      buckets[hour].count += 1;
    }
    for (const h in buckets) {
      hourlyBaseline[h] = {
        avg: buckets[h].sum / buckets[h].count,
        count: buckets[h].count,
      };
    }
    baselineLoaded = true;
  } catch (e) {
    console.warn("[admin-init] Baseline load failed:", e);
  } finally {
    baselineLoading = false;
  }
}

function getBaselineForHour(dateObj) {
  const h = dateObj.getHours();
  return hourlyBaseline[h] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtLocal(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDurationMin(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return `${min}m`;
}

// ── Compute closes_at / ends_at from form inputs ──────────────────────────────
function getComputedTimes() {
  const startsVal = document.getElementById("starts-at")?.value;
  const duration  = parseInt(document.getElementById("duration")?.value || "0", 10);
  const cutoff    = parseInt(document.getElementById("bet-cutoff")?.value || "1", 10);
  if (!startsVal || !duration) return null;

  const starts  = new Date(startsVal);
  const ends    = new Date(starts.getTime() + duration * 60_000);
  const closes  = new Date(ends.getTime()  - cutoff  * 60_000);
  return { starts, ends, closes, duration, cutoff };
}

// ── Live preview update ───────────────────────────────────────────────────────
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
    ctRow && (ctRow.style.display = "none");
    submitBtn && (submitBtn.disabled = true);
    return;
  }

  const { starts, ends, closes, duration } = times;

  // Computed time summary
  if (ctRow) ctRow.style.display = "";
  if (ctCloses) ctCloses.textContent = fmtLocal(closes);
  if (ctEnds)   ctEnds.textContent   = fmtLocal(ends);

  preview?.classList.remove("hidden");
  prevDur && (prevDur.textContent = fmtDurationMin(duration));

  // Load baseline if not done yet
  await loadBaseline();
  const baseline = getBaselineForHour(starts);
  const avgOccupancy = baseline?.avg ?? null;

  if (prevRate) {
    prevRate.textContent = avgOccupancy !== null
      ? `~${avgOccupancy.toFixed(1)} vehicles (${baseline.count} samples)`
      : "No historical data yet";
  }

  // Reset
  prevWarn?.classList.add("hidden");
  prevOk?.classList.add("hidden");

  const warnings = [];

  // Duration rules
  if (duration < MIN_DURATION_MIN)
    warnings.push(`Too short — minimum is ${MIN_DURATION_MIN} minutes.`);
  if (duration > MAX_DURATION_MIN)
    warnings.push(`Too long — maximum is ${MAX_DURATION_MIN} minutes (8 hours).`);

  // Threshold rules for over_under and vehicle_count
  if (marketType === "over_under" || marketType === "vehicle_count") {
    prevExpRow?.classList.remove("hidden");
    const multiplier = marketType === "vehicle_count"
      ? (CLASS_RATE[vehicleClass] ?? 0.25)
      : 1.0;

    const minThresh = Math.max(1, Math.ceil(duration * THRESHOLD_MIN_PER_MIN * multiplier));
    const maxThresh = Math.max(5, Math.floor(duration * THRESHOLD_MAX_PER_MIN * multiplier));

    // Expected range from baseline
    let expectedText = `${minThresh}–${maxThresh}`;
    if (avgOccupancy !== null) {
      // Rough estimate: avg occupancy × duration × multiplier
      // (occupancy is "vehicles in zone at a snapshot", so scale conservatively)
      const est = Math.round(avgOccupancy * duration * multiplier * 0.4);
      expectedText = `~${est} vehicles (valid: ${minThresh}–${maxThresh})`;
    }
    prevExp && (prevExp.textContent = expectedText);

    const typeLabel = marketType === "vehicle_count"
      ? `for ${vehicleClass}s in ${fmtDurationMin(duration)}`
      : `for ${fmtDurationMin(duration)}`;

    if (!isNaN(threshold)) {
      if (threshold < minThresh) {
        warnings.push(`Threshold ${threshold} is too low ${typeLabel}. Minimum: ${minThresh}. Near-guaranteed "over" win — don't do it!`);
      } else if (threshold > maxThresh) {
        warnings.push(`Threshold ${threshold} is extremely high ${typeLabel}. Maximum: ${maxThresh}. Almost impossible to reach.`);
      }
    }
  } else {
    prevExpRow?.classList.add("hidden");
  }

  // Show result
  if (warnings.length) {
    if (prevWarn) {
      prevWarn.innerHTML = warnings.map(w => `<div>⚠ ${w}</div>`).join("");
      prevWarn.classList.remove("hidden");
    }
    submitBtn && (submitBtn.disabled = true);
  } else if (duration >= MIN_DURATION_MIN) {
    prevOk?.classList.remove("hidden");
    submitBtn && (submitBtn.disabled = false);
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
    const cls = vehicleClass;
    const label = { car: "cars", truck: "trucks", bus: "buses", motorcycle: "motorcycles" }[cls] ?? cls;
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

  const { data: cameras } = await window.sb
    .from("cameras").select("id").eq("is_active", true).limit(1);
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        camera_id:  cameraId,
        market_type: marketType,
        params,
        opens_at:  starts.toISOString(),
        closes_at: closes.toISOString(),
        ends_at:   ends.toISOString(),
        markets,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to create round");
    }

    successEl.textContent = "Round created! It auto-opens at the scheduled start time.";
    document.getElementById("round-form").reset();
    document.getElementById("round-preview")?.classList.add("hidden");
    document.getElementById("computed-times").style.display = "none";
    setDefaultTimes();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ── Set default times ─────────────────────────────────────────────────────────
function setDefaultTimes() {
  const now    = new Date();
  now.setSeconds(0, 0);
  // Default: start 1 minute from now
  const starts = new Date(now.getTime() + 60_000);
  const toLocal = (d) => {
    // datetime-local format: YYYY-MM-DDTHH:MM
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const el = document.getElementById("starts-at");
  if (el) el.value = toLocal(starts);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  adminSession = await Auth.requireAdmin("/index.html");
  if (!adminSession) return;

  const { data: cameras } = await window.sb
    .from("cameras").select("id").eq("is_active", true).limit(1);
  const cameraId = cameras?.[0]?.id;

  const video = document.getElementById("admin-video");
  await Stream.init(video);

  video.addEventListener("loadedmetadata", () => {
    const canvas = document.getElementById("line-canvas");
    AdminLine.init(video, canvas, cameraId);
  });

  // Begin baseline data load in background
  loadBaseline();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-logout")
    ?.addEventListener("click", () => Auth.logout());

  document.getElementById("round-form")
    ?.addEventListener("submit", handleSubmit);

  // Threshold/vehicle-class field visibility by market type
  document.getElementById("market-type")?.addEventListener("change", (e) => {
    const type = e.target.value;
    const threshField  = document.getElementById("threshold-field");
    const classField   = document.getElementById("vehicle-class-field");
    const threshLabel  = document.getElementById("threshold-label");

    if (threshField) threshField.style.display = type === "vehicle_type" ? "none" : "";
    if (classField)  classField.style.display  = type === "vehicle_count" ? "" : "none";
    if (threshLabel && type === "vehicle_count")
      threshLabel.textContent = "Threshold (vehicles of that type)";
    else if (threshLabel)
      threshLabel.textContent = "Threshold (vehicles)";
    updatePreview();
  });

  // Live preview on any change
  ["market-type","vehicle-class","threshold","starts-at","duration","bet-cutoff"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",  updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });

  setDefaultTimes();
  updatePreview();
});

init();
