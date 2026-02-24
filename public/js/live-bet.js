/**
 * live-bet.js — Exact-count micro-bet panel logic.
 * Works with the bet-panel in the sidebar.
 */

const LiveBet = (() => {
  let _round = null;
  let _vehicleClass = "";    // "" = all
  let _windowSec = 30;
  let _countdownTimer = null;
  let _wsAccountRef = null;  // set by index-init

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
    _round = round;

    const panel = document.getElementById("bet-panel");
    if (!panel) return;

    // Reset form
    document.getElementById("bp-error").textContent = "";
    document.getElementById("bp-amount").value = "";
    document.getElementById("bp-count").value = "5";
    document.getElementById("bp-payout").textContent = "-";
    _hideBpActiveBet();

    // Reset pills
    _setPill("bp-vehicle-pills", "");
    _setPill("bp-window-pills", "30");

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

  // ── Payout calc ───────────────────────────────────────────────────

  function _updatePayout() {
    const amount = parseInt(document.getElementById("bp-amount")?.value ?? 0, 10);
    const el = document.getElementById("bp-payout");
    if (!el) return;
    el.textContent = (amount > 0) ? (amount * 8).toLocaleString() + " credits" : "—";
  }

  // ── Submit ────────────────────────────────────────────────────────

  async function submit() {
    const errorEl = document.getElementById("bp-error");
    const submitBtn = document.getElementById("bp-submit");
    errorEl.textContent = "";

    const amount = parseInt(document.getElementById("bp-amount")?.value ?? 0, 10);
    const exact = parseInt(document.getElementById("bp-count")?.value ?? 0, 10);

    if (!_round) { errorEl.textContent = "No active round"; return; }
    if (!amount || amount <= 0) { errorEl.textContent = "Enter a valid amount"; return; }
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
        errorEl.textContent = "Selected window runs past round end";
        return;
      }
    }

    const jwt = await Auth.getJwt();
    if (!jwt) { window.location.href = "/login.html"; return; }

    if (submitBtn && !submitBtn.dataset.defaultHtml) {
      submitBtn.dataset.defaultHtml = submitBtn.innerHTML;
    }
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="wlz-inline-spinner" aria-hidden="true"></span>Validating...`;
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
        errorEl.textContent = data.detail || "Guess failed";
        return;
      }

      // Show countdown
      _showBpActiveBet(data.window_end);
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
      errorEl.textContent = "Network error - try again";
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitBtn.dataset.defaultHtml || "Submit Guess";
    }
  }

  function _showBpActiveBet(windowEndIso) {
    const activeEl = document.getElementById("bp-active-bet");
    const cdEl = document.getElementById("bp-countdown");
    const submitBtn = document.getElementById("bp-submit");
    if (!activeEl || !cdEl) return;

    activeEl.classList.remove("hidden");
    submitBtn.classList.add("hidden");

    const endTime = new Date(windowEndIso).getTime();

    clearInterval(_countdownTimer);
    _countdownTimer = setInterval(() => {
      const diff = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      cdEl.textContent = diff + "s";
      if (diff === 0) {
        clearInterval(_countdownTimer);
        cdEl.textContent = "Resolving...";
      }
    }, 500);
  }

  function _hideBpActiveBet() {
    clearInterval(_countdownTimer);
    document.getElementById("bp-active-bet")?.classList.add("hidden");
    document.getElementById("bp-submit")?.classList.remove("hidden");
  }

  // ── Handle ws_account bet_resolved event ─────────────────────────

  function onBetResolved(data) {
    _hideBpActiveBet();
    if (data.won) {
      _showToast(`WIN! +${data.payout.toLocaleString()} credits — got ${data.actual} (target: ${data.exact})`, "win");
    } else {
      _showToast(`LOSS — got ${data.actual}, needed ${data.exact}`, "loss");
    }
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

    // Vehicle pill selection
    document.getElementById("bp-vehicle-pills")?.addEventListener("click", (e) => {
      const pill = e.target.closest(".pill");
      if (!pill) return;
      _vehicleClass = pill.dataset.val;
      _setPill("bp-vehicle-pills", _vehicleClass);
    });

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
      if (el) el.value = Math.min(999, parseInt(el.value || 0, 10) + 1);
    });

    // Amount → payout
    document.getElementById("bp-amount")?.addEventListener("input", _updatePayout);

    // Submit
    document.getElementById("bp-submit")?.addEventListener("click", submit);
  }

  return { init, open, close, onBetResolved, setRound: (r) => { _round = r; } };
})();

window.LiveBet = LiveBet;
