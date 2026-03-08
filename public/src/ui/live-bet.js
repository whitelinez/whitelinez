import { Auth } from '../services/auth.js';

/**
 * live-bet.js — Exact-count micro-bet panel logic.
 * Works with the bet-panel in the sidebar.
 */

export const LiveBet = (() => {
  let _round = null;
  let _vehicleClass = "";    // "" = all
  let _windowSec = 60;
  let _countdownTimer = null;
  let _wsAccountRef = null;  // set by index-init
  let _baselineCount = null; // count at bet placement time (for window delta)
  let _guessCount = 0;       // user's exact-count guess (for progress bar)
  let _lastKnownTotal = null; // latest global count — updated on every count:update
  let _windowHistory = [];    // [{t, v}] — delta samples recorded during window for replay chart
  let _replayChart = null;
  let _betActive = false;    // true while countdown is running
  let _resultPending = false; // true while result card is visible

  // Track latest global total so we can use it as baseline if API doesn't send one
  window.addEventListener("count:update", (e) => {
    if (e.detail?.total != null) _lastKnownTotal = Number(e.detail.total);
  });

  function _ensureSpinnerStyle() {
    if (document.getElementById("live-bet-spinner-style")) return;
    const style = document.createElement("style");
    style.id = "live-bet-spinner-style";
    style.textContent = `
      .wlz-inline-spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-right: 6px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.25);
        border-top-color: currentColor;
        animation: wlzSpin .8s linear infinite;
        vertical-align: -2px;
      }
      @keyframes wlzSpin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  // ── Open / close panel ────────────────────────────────────────────

  function open(round) {
    // If a bet is in flight or result is showing, just re-show — don't reset
    if (_betActive || _resultPending) {
      _ensurePanelVisible();
      return;
    }

    _round = round;

    const panel = document.getElementById("bet-panel");
    if (!panel) return;

    // Reset form
    document.getElementById("bp-error").textContent = "";
    document.getElementById("bp-count").value = "5";
    _hideBpActiveBet();
    _hideBpResult();

    // Reset pills
    _setPill("bp-vehicle-pills", "");
    _setPill("bp-window-pills", "60");

    panel.classList.remove("hidden");
    requestAnimationFrame(() => panel.classList.add("visible"));
  }

  // Re-show panel without resetting any state (used when returning to PLAY tab)
  function restore() {
    if (_betActive || _resultPending) {
      _ensurePanelVisible();
    }
  }

  function _ensurePanelVisible() {
    const panel = document.getElementById("bet-panel");
    if (!panel) return;
    panel.classList.remove("hidden");
    requestAnimationFrame(() => panel.classList.add("visible"));
  }

  function close() {
    const panel = document.getElementById("bet-panel");
    if (!panel) return;
    panel.classList.remove("visible");
    setTimeout(() => panel.classList.add("hidden"), 260);
  }

  // ── Pill selection ────────────────────────────────────────────────

  function _setPill(groupId, val) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll(".pill").forEach(p => {
      p.classList.toggle("active", p.dataset.val === val);
    });
  }

  // ── Submit ────────────────────────────────────────────────────────

  async function submit() {
    const errorEl = document.getElementById("bp-error");
    const submitBtn = document.getElementById("bp-submit");
    errorEl.textContent = "";

    const amount = 10;
    const exact = parseInt(document.getElementById("bp-count")?.value ?? 0, 10);

    if (!_round) { errorEl.textContent = "No active round"; return; }
    if (isNaN(exact) || exact < 0) { errorEl.textContent = "Enter a valid count"; return; }
    if (String(_round.status || "").toLowerCase() !== "open") { errorEl.textContent = "Round is not open for guesses"; return; }
    if (_round.closes_at) {
      const closesAt = new Date(_round.closes_at).getTime();
      if (Number.isFinite(closesAt) && Date.now() >= closesAt) {
        errorEl.textContent = "Guess window has closed";
        return;
      }
    }
    if (_round.ends_at) {
      const endsAt = new Date(_round.ends_at).getTime();
      if (Number.isFinite(endsAt) && (Date.now() + (_windowSec * 1000)) > endsAt) {
        errorEl.textContent = "Selected window extends past match end";
        return;
      }
    }

    let jwt = await Auth.getJwt();
    if (!jwt) {
      submitBtn.disabled = true;
      errorEl.textContent = "Starting guest session…";
      try {
        jwt = await Auth.signInAnon();
        if (!jwt) throw new Error("Guest session failed");
        window.dispatchEvent(new CustomEvent("session:guest"));
      } catch (e) {
        errorEl.textContent = e.message || "Login required to submit a guess";
        submitBtn.disabled = false;
        return;
      }
    }

    if (submitBtn && !submitBtn.dataset.defaultHtml) {
      submitBtn.dataset.defaultHtml = submitBtn.innerHTML;
    }
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="wlz-inline-spinner" aria-hidden="true"></span>Submitting...`;
    errorEl.textContent = "";

    try {
      const res = await fetch("/api/bets/place?live=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          round_id: _round.id,
          window_duration_sec: _windowSec,
          vehicle_class: _vehicleClass || null,
          exact_count: exact,
          amount,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.detail || "Submission failed";
        return;
      }

      // Show countdown + receipt
      _showBpActiveBet(data.window_end, exact, data.baseline_count);
      window.dispatchEvent(new CustomEvent("bet:placed", {
        detail: {
          ...data,
          bet_type: "exact_count",
          round_id: _round?.id || null,
          window_duration_sec: _windowSec,
          vehicle_class: _vehicleClass || null,
          exact_count: exact,
        },
      }));

    } catch (e) {
      errorEl.textContent = "Network error — try again";
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitBtn.dataset.defaultHtml || "Submit Guess";
    }
  }

  function _showBpActiveBet(windowEndIso, guessCount, baseline) {
    const activeEl  = document.getElementById("bp-active-bet");
    const cdEl      = document.getElementById("bp-countdown");
    const hintEl    = document.getElementById("bp-active-hint");
    const submitBtn = document.getElementById("bp-submit");
    if (!activeEl || !cdEl) return;

    // Store for progress tracking
    _betActive     = true;
    _guessCount    = Number(guessCount) || 0;
    // Use API baseline if provided; fall back to latest known total from count:update
    _baselineCount = (baseline != null) ? Number(baseline) : _lastKnownTotal;
    _windowHistory = [];

    // Receipt fields
    const receiptGuessEl = document.getElementById("bpa-receipt-guess");
    if (receiptGuessEl) receiptGuessEl.textContent = guessCount ?? "—";

    const winTagEl = document.getElementById("bpa-window-tag");
    if (winTagEl) {
      const labels = { 60: "1 MIN", 180: "3 MIN", 300: "5 MIN" };
      winTagEl.textContent = labels[_windowSec] || `${Math.round(_windowSec / 60)} MIN`;
    }

    // Reset progress bar
    const fill = document.getElementById("bpa-progress-fill");
    if (fill) { fill.style.width = "0%"; fill.className = "bpa-prog-fill"; }

    activeEl.classList.remove("hidden");
    submitBtn.classList.add("hidden");
    document.body.classList.add("bet-active"); // hide count widget on mobile

    // Hide form fields — user is just watching the count
    document.querySelector("#bp-window-pills")?.closest(".bp-field")?.classList.add("hidden");
    document.querySelector("#bp-count")?.closest(".bp-field")?.classList.add("hidden");
    document.getElementById("bp-prize-hint")?.classList.add("hidden");
    document.getElementById("bp-title")?.classList.add("hidden");
    document.getElementById("bp-market-label")?.classList.add("hidden");

    // Live count listener
    window.addEventListener("count:update", _onBpCountUpdate);

    const endTime = new Date(windowEndIso).getTime();

    clearInterval(_countdownTimer);
    _countdownTimer = setInterval(() => {
      const diffRaw = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      const m = Math.floor(diffRaw / 60).toString().padStart(2, "0");
      const s = (diffRaw % 60).toString().padStart(2, "0");
      cdEl.textContent = `${m}:${s}`;
      if (diffRaw === 0) {
        clearInterval(_countdownTimer);
        cdEl.textContent = "00:00";
        if (hintEl) hintEl.textContent = "Calculating your score...";
      }
    }, 200);
  }

  function _onBpCountUpdate(e) {
    if (e.detail?.total == null) return;
    const total = Number(e.detail.total);
    const delta = (_baselineCount != null) ? Math.max(0, total - _baselineCount) : total;

    // Record for replay chart
    _windowHistory.push({ t: Date.now(), v: delta });

    const el = document.getElementById("bpa-live-count");
    if (el) {
      el.textContent = (_guessCount > 0)
        ? `${delta.toLocaleString()} / ${_guessCount.toLocaleString()}`
        : delta.toLocaleString();
    }

    const fill = document.getElementById("bpa-progress-fill");
    if (fill && _guessCount > 0) {
      const pct = Math.min(100, Math.round((delta / _guessCount) * 100));
      fill.style.width = `${pct}%`;
      fill.className = pct >= 100 ? "bpa-prog-fill bpa-prog-fill--hit" : "bpa-prog-fill";
    }
  }

  function _hideBpActiveBet(showSubmit = true) {
    _betActive = false;
    clearInterval(_countdownTimer);
    window.removeEventListener("count:update", _onBpCountUpdate);
    document.getElementById("bp-active-bet")?.classList.add("hidden");
    document.body.classList.remove("bet-active"); // restore count widget on mobile
    // Restore hidden form fields
    document.querySelector("#bp-window-pills")?.closest(".bp-field")?.classList.remove("hidden");
    document.querySelector("#bp-count")?.closest(".bp-field")?.classList.remove("hidden");
    document.getElementById("bp-prize-hint")?.classList.remove("hidden");
    document.getElementById("bp-title")?.classList.remove("hidden");
    document.getElementById("bp-market-label")?.classList.remove("hidden");
    if (showSubmit) document.getElementById("bp-submit")?.classList.remove("hidden");
  }

  // ── Handle ws_account bet_resolved event ─────────────────────────

  function onBetResolved(data) {
    _hideBpActiveBet(false); // don't show submit — result panel takes over

    // Ensure user is on the PLAY tab and panel is visible before showing result
    const playTab = document.querySelector('.tab-btn[data-tab="markets"]');
    if (playTab && !playTab.classList.contains("active")) playTab.click();
    _ensurePanelVisible();

    _showBpResult(data);
  }

  function _showBpResult(data) {
    const resultEl = document.getElementById("bp-result");
    if (!resultEl) {
      // Fallback toast if HTML not present
      const tier = data.score_tier || (data.won ? (String(data.actual) === String(data.exact) ? "exact" : "close") : "miss");
      const toastMsg = tier === "exact"
        ? `EXACT! +${Number(data.payout || 0).toLocaleString()} pts — count was ${data.actual}`
        : tier === "close"
          ? `CLOSE! +${Number(data.payout || 0).toLocaleString()} pts — count was ${data.actual}, you guessed ${data.exact}`
          : `MISS — count was ${data.actual}, you guessed ${data.exact}`;
      _showToast(toastMsg, tier === "miss" ? "loss" : "win");
      return;
    }

    const won    = !!data.won;
    const payout = Number(data.payout || 0);
    const actual = data.actual ?? "—";
    const exact  = data.exact  ?? "—";
    const isExact = won && String(actual) === String(exact);

    const badgeEl = document.getElementById("bpr-badge");
    if (badgeEl) {
      if (isExact) {
        badgeEl.textContent = "EXACT";
        badgeEl.className   = "bpr-badge bpr-badge-exact";
      } else if (won) {
        badgeEl.textContent = "CLOSE";
        badgeEl.className   = "bpr-badge bpr-badge-close";
      } else {
        badgeEl.textContent = "MISS";
        badgeEl.className   = "bpr-badge bpr-badge-miss";
      }
    }

    const ptsEl = document.getElementById("bpr-pts");
    if (ptsEl) {
      ptsEl.textContent = won ? `+${payout.toLocaleString()} pts` : "No pts";
      ptsEl.className   = `bpr-pts ${won ? "bpr-pts-win" : "bpr-pts-miss"}`;
    }

    const guessEl  = document.getElementById("bpr-guess");
    const actualEl = document.getElementById("bpr-actual");
    const payEl    = document.getElementById("bpr-payout");
    if (guessEl)  guessEl.textContent  = exact;
    if (actualEl) actualEl.textContent = actual;
    if (payEl)    payEl.textContent    = won ? `+${payout.toLocaleString()} pts` : "0 pts";

    // Show tolerance info so user understands close/miss boundary
    const tolRow = document.getElementById("bpr-tolerance-row");
    const tolLbl = document.getElementById("bpr-tolerance-lbl");
    const tolVal = document.getElementById("bpr-tolerance-val");
    if (tolRow && tolLbl && tolVal && Number.isFinite(+exact) && Number.isFinite(+actual)) {
      const diff      = Math.abs(+actual - +exact);
      const tolerance = Math.max(1, Math.round(+exact * 0.40));
      tolRow.style.display = "";
      const unit = diff === 1 ? "car" : "cars";
      tolLbl.textContent = "Off by";
      tolVal.textContent = diff === 0
        ? "0 — perfect!"
        : diff <= tolerance
          ? `${diff} ${unit} — close enough!`
          : `${diff} ${unit}`;
      tolVal.style.color = diff === 0 ? "#4ade80" : diff <= tolerance ? "var(--accent)" : "#f87171";
    }

    _resultPending = true;
    document.getElementById("bp-submit")?.classList.add("hidden");
    resultEl.classList.remove("hidden");

    // Render replay sparkline from in-memory window history
    _renderReplayChart(Number(exact));
  }

  function _renderReplayChart(guessVal) {
    const replayEl = document.getElementById("bpr-replay");
    const canvas   = document.getElementById("bpr-replay-canvas");
    if (!replayEl || !canvas || !window.Chart) { replayEl?.classList.add("hidden"); return; }

    if (_windowHistory.length < 2) { replayEl.classList.add("hidden"); return; }

    if (_replayChart) { _replayChart.destroy(); _replayChart = null; }

    // Downsample to max 60 points so the chart stays readable
    const src  = _windowHistory;
    const step = Math.max(1, Math.floor(src.length / 60));
    const pts  = src.filter((_, i) => i % step === 0);

    const t0     = pts[0].t;
    const labels = pts.map(p => {
      const s = Math.round((p.t - t0) / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    });
    const counts = pts.map(p => p.v);

    const lineColor  = "#29B6F6";
    const guessColor = "#facc15";
    const mutedColor = "rgba(255,255,255,0.12)";

    _replayChart = new window.Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Count", data: counts,
            borderColor: lineColor, backgroundColor: `${lineColor}22`,
            fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
          },
          {
            label: "Your guess", data: new Array(counts.length).fill(guessVal),
            borderColor: guessColor, borderWidth: 1.5, borderDash: [4, 3],
            pointRadius: 0, fill: false, tension: 0,
          },
        ],
      },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: {
            display: true,
            ticks: { maxTicksLimit: 3, font: { size: 9 }, color: mutedColor },
            grid: { color: mutedColor }, border: { display: false },
          },
        },
      },
    });

    replayEl.classList.remove("hidden");
  }

  function _hideBpResult() {
    _resultPending = false;
    document.getElementById("bp-result")?.classList.add("hidden");
    document.getElementById("bp-submit")?.classList.remove("hidden");
    document.getElementById("bpr-replay")?.classList.add("hidden");
    if (_replayChart) { _replayChart.destroy(); _replayChart = null; }
    _windowHistory = [];
    const tolRow = document.getElementById("bpr-tolerance-row");
    if (tolRow) tolRow.style.display = "none";
    // Reset form so the panel feels fresh for the next guess
    const countEl = document.getElementById("bp-count");
    if (countEl) countEl.value = "5";
    const errEl = document.getElementById("bp-error");
    if (errEl) errEl.textContent = "";
    _setPill("bp-window-pills", "60");
    _windowSec = 60;
    document.getElementById("bet-panel")?.scrollTo?.(0, 0);
  }

  function _showToast(msg, type = "info") {
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ── Init ──────────────────────────────────────────────────────────

  function init() {
    _ensureSpinnerStyle();
    // Back button
    document.getElementById("bet-panel-back")?.addEventListener("click", close);

    // Window pill selection
    document.getElementById("bp-window-pills")?.addEventListener("click", (e) => {
      const pill = e.target.closest(".pill");
      if (!pill) return;
      _windowSec = parseInt(pill.dataset.val, 10);
      _setPill("bp-window-pills", pill.dataset.val);
    });

    // Count adjusters
    document.getElementById("bp-count-minus")?.addEventListener("click", () => {
      const el = document.getElementById("bp-count");
      if (el) el.value = Math.max(0, parseInt(el.value || 0, 10) - 1);
    });
    document.getElementById("bp-count-plus")?.addEventListener("click", () => {
      const el = document.getElementById("bp-count");
      if (el) el.value = Math.min(10000, parseInt(el.value || 0, 10) + 1);
    });

    // Submit
    document.getElementById("bp-submit")?.addEventListener("click", submit);

    // Result panel actions
    document.getElementById("bpr-again-btn")?.addEventListener("click", () => {
      _hideBpResult();
    });

    document.getElementById("bpr-leaderboard-btn")?.addEventListener("click", () => {
      // Switch to leaderboard tab — keep bet panel state intact so user can return
      const lbTab = document.querySelector('.tab-btn[data-tab="leaderboard"]');
      if (lbTab) lbTab.click();
    });
  }

  return { init, open, close, restore, onBetResolved, setRound: (r) => { _round = r; } };
})();
