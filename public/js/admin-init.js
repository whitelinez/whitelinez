let adminSession = null;

// ── Constants matching backend guardrails ─────────────────────────────────────
const MIN_DURATION_MIN  = 5;
const MAX_DURATION_MIN  = 480;
const MIN_ODDS          = 1.20;
const THRESHOLD_MIN_PER_MIN = 0.5;
const THRESHOLD_MAX_PER_MIN = 25.0;

// ── Cached live traffic rate ──────────────────────────────────────────────────
let avgZoneOccupancy = null;   // avg vehicles in zone right now (from recent snapshots)
let rateLoadedAt     = 0;

async function fetchAvgRate() {
  // Refresh at most once per 30s
  if (avgZoneOccupancy !== null && Date.now() - rateLoadedAt < 30_000) return;
  try {
    const { data } = await window.sb
      .from("count_snapshots")
      .select("total")
      .order("captured_at", { ascending: false })
      .limit(60);
    if (data && data.length >= 5) {
      const avg = data.reduce((s, r) => s + r.total, 0) / data.length;
      avgZoneOccupancy = Math.round(avg * 10) / 10;
      rateLoadedAt = Date.now();
    }
  } catch {}
}

function fmtDurationMin(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return `${min}m`;
}

async function updatePreview() {
  const marketType = document.getElementById("market-type")?.value;
  const opensVal   = document.getElementById("opens-at")?.value;
  const endsVal    = document.getElementById("ends-at")?.value;
  const threshold  = parseInt(document.getElementById("threshold")?.value || "0", 10);

  const preview   = document.getElementById("round-preview");
  const prevDur   = document.getElementById("prev-duration");
  const prevRate  = document.getElementById("prev-rate");
  const prevExpRow = document.getElementById("prev-expected-row");
  const prevExp   = document.getElementById("prev-expected");
  const prevWarn  = document.getElementById("prev-warning");
  const prevOk    = document.getElementById("prev-ok");
  const submitBtn = document.getElementById("round-submit-btn");

  if (!opensVal || !endsVal) {
    preview?.classList.add("hidden");
    return;
  }

  const opens = new Date(opensVal);
  const ends  = new Date(endsVal);
  const durationSec = (ends - opens) / 1000;
  const durationMin = Math.round(durationSec / 60);

  if (durationSec <= 0) { preview?.classList.add("hidden"); return; }
  preview?.classList.remove("hidden");

  // Duration
  prevDur && (prevDur.textContent = fmtDurationMin(durationMin));

  // Rate
  await fetchAvgRate();
  if (prevRate) {
    prevRate.textContent = avgZoneOccupancy !== null
      ? `~${avgZoneOccupancy} vehicles/snapshot`
      : "no data yet";
  }

  // Reset state
  prevWarn && prevWarn.classList.add("hidden");
  prevOk   && prevOk.classList.add("hidden");

  const warnings = [];

  // Duration hard rules
  if (durationMin < MIN_DURATION_MIN) {
    warnings.push(`Too short — minimum round is ${MIN_DURATION_MIN} minutes.`);
  }
  if (durationMin > MAX_DURATION_MIN) {
    warnings.push(`Too long — maximum round is ${MAX_DURATION_MIN} minutes (8 hours).`);
  }

  // Threshold rules for over_under
  if (marketType === "over_under" && !isNaN(threshold)) {
    const minThresh = Math.ceil(durationMin * THRESHOLD_MIN_PER_MIN);
    const maxThresh = Math.floor(durationMin * THRESHOLD_MAX_PER_MIN);
    prevExpRow?.classList.remove("hidden");

    // Estimated expected vehicles using live zone avg as proxy for rate
    // Assumption: vehicles in zone at any instant × avg dwell time gives rough rate
    // We use occupancy × (durationMin / 1min dwell estimate) as a rough expected
    let expectedRange = `${minThresh}–${maxThresh}`;
    prevExp && (prevExp.textContent = `${minThresh}–${maxThresh} vehicles`);

    if (threshold < minThresh) {
      warnings.push(
        `Threshold ${threshold} is too low for a ${fmtDurationMin(durationMin)} round. ` +
        `Minimum is ${minThresh}. This would be a near-guaranteed "over" win.`
      );
    } else if (threshold > maxThresh) {
      warnings.push(
        `Threshold ${threshold} is extremely high for a ${fmtDurationMin(durationMin)} round. ` +
        `Maximum is ${maxThresh}. Almost no one would win.`
      );
    }
  } else {
    prevExpRow?.classList.add("hidden");
  }

  // Show result
  if (warnings.length > 0) {
    if (prevWarn) {
      prevWarn.innerHTML = warnings.map(w => `<div>⚠ ${w}</div>`).join("");
      prevWarn.classList.remove("hidden");
    }
    submitBtn && (submitBtn.disabled = true);
  } else if (durationMin >= MIN_DURATION_MIN) {
    prevOk?.classList.remove("hidden");
    submitBtn && (submitBtn.disabled = false);
  }
}

// ── Submission ────────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const errorEl   = document.getElementById("round-error");
  const successEl = document.getElementById("round-success");
  const btn       = document.getElementById("round-submit-btn");

  errorEl.textContent   = "";
  successEl.textContent = "";
  btn.disabled = true;

  const jwt = adminSession?.access_token;
  if (!jwt) return;

  const marketType = document.getElementById("market-type").value;
  const threshold  = parseInt(document.getElementById("threshold").value, 10);
  const opensAt    = new Date(document.getElementById("opens-at").value).toISOString();
  const closesAt   = new Date(document.getElementById("closes-at").value).toISOString();
  const endsAt     = new Date(document.getElementById("ends-at").value).toISOString();

  // Client-side odds validation
  const over_odds  = 1.90;
  const under_odds = 1.90;
  const exact_odds = 15.00;
  if (over_odds < MIN_ODDS || under_odds < MIN_ODDS) {
    errorEl.textContent = `Odds must be at least ${MIN_ODDS}x.`;
    btn.disabled = false;
    return;
  }

  const { data: cameras } = await window.sb
    .from("cameras").select("id").eq("is_active", true).limit(1);
  const cameraId = cameras?.[0]?.id;

  const markets = marketType === "over_under"
    ? [
        { label: `Over ${threshold} vehicles`,   outcome_key: "over",  odds: over_odds },
        { label: `Under ${threshold} vehicles`,  outcome_key: "under", odds: under_odds },
        { label: `Exactly ${threshold} vehicles`, outcome_key: "exact", odds: exact_odds },
      ]
    : [
        { label: "Cars lead",        outcome_key: "car",        odds: 2.00 },
        { label: "Trucks lead",      outcome_key: "truck",      odds: 3.50 },
        { label: "Buses lead",       outcome_key: "bus",        odds: 4.00 },
        { label: "Motorcycles lead", outcome_key: "motorcycle", odds: 5.00 },
      ];

  try {
    const res = await fetch("/api/admin/rounds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        camera_id: cameraId,
        market_type: marketType,
        params: {
          threshold,
          duration_sec: Math.floor((new Date(endsAt) - new Date(opensAt)) / 1000),
        },
        opens_at: opensAt,
        closes_at: closesAt,
        ends_at: endsAt,
        markets,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to create round");
    }

    successEl.textContent = "Round created! It will auto-open at the scheduled time.";
    document.getElementById("round-form").reset();
    document.getElementById("round-preview")?.classList.add("hidden");
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  adminSession = await Auth.requireAdmin("/index.html");
  if (!adminSession) return;

  const { data: cameras } = await window.sb
    .from("cameras")
    .select("id, name")
    .eq("is_active", true)
    .limit(1);
  const cameraId = cameras?.[0]?.id;

  const video = document.getElementById("admin-video");
  await Stream.init(video);

  video.addEventListener("loadedmetadata", () => {
    const canvas = document.getElementById("line-canvas");
    AdminLine.init(video, canvas, cameraId);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-logout")
    ?.addEventListener("click", () => Auth.logout());

  document.getElementById("round-form")
    ?.addEventListener("submit", handleSubmit);

  // Live preview on any form field change
  ["market-type", "threshold", "opens-at", "closes-at", "ends-at"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });

  // Hide threshold field when not over_under
  document.getElementById("market-type")?.addEventListener("change", (e) => {
    const threshField = document.getElementById("threshold-field");
    if (threshField) threshField.style.display = e.target.value === "over_under" ? "" : "none";
  });

  // Set default datetime values (now + 1min open, now + 6min close, now + 11min end)
  const now = new Date();
  const toLocal = (d) => {
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  };
  const opens  = new Date(now.getTime() + 1  * 60_000);
  const closes = new Date(now.getTime() + 6  * 60_000);
  const ends   = new Date(now.getTime() + 11 * 60_000);
  const opensEl  = document.getElementById("opens-at");
  const closesEl = document.getElementById("closes-at");
  const endsEl   = document.getElementById("ends-at");
  if (opensEl)  opensEl.value  = toLocal(opens);
  if (closesEl) closesEl.value = toLocal(closes);
  if (endsEl)   endsEl.value   = toLocal(ends);

  updatePreview();
});

init();
