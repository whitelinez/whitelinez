/**
 * markets.js - Renders active bet markets in the sidebar.
 * Manages sidebar tab switching.
 * Connects market cards to bet panel (LiveBet) instead of a modal.
 */

const Markets = (() => {
  let currentRound = null;
  let timersInterval = null;
  let lastRoundId = null;
  let currentUserId = null;
  let latestCountPayload = null;
  let roundBaseline = null;
  let userRoundBets = [];
  let userBetPollTimer = null;

  const USER_BET_POLL_MS = 5000;

  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${tab}`)?.classList.add("active");
      });
    });
  }

  async function loadMarkets() {
    _showSkeleton();
    try {
      await _ensureCurrentUser();
      const { data: round, error } = await window.sb
        .from("bet_rounds")
        .select("*, markets(*)")
        .in("status", ["open", "upcoming"])
        .order("opens_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error || !round) {
        renderNoRound();
        return;
      }

      if (currentRound?.id !== round.id) {
        _resetRoundLiveState();
      }

      currentRound = round;
      LiveBet.setRound(round);
      renderRound(round);
      updateRoundStrip(round);
      await _ensureRoundBaseline(round);
      await _loadUserRoundBets();
      _startUserBetPolling();
    } catch (e) {
      console.error("[Markets] Failed to load:", e);
      renderNoRound();
    }
  }

  function _showSkeleton() {
    const container = document.getElementById("markets-container");
    if (!container) return;
    container.innerHTML = `
      <div class="skeleton" style="height:22px;width:60%;margin-bottom:10px;border-radius:6px;"></div>
      <div class="skeleton" style="height:14px;width:100%;margin-bottom:16px;border-radius:4px;"></div>
      ${Array(3).fill(`<div class="skeleton" style="height:88px;border-radius:8px;margin-bottom:8px;"></div>`).join("")}
    `;
  }

  function renderNoRound() {
    clearInterval(timersInterval);
    timersInterval = null;
    lastRoundId = null;
    _stopUserBetPolling();
    _resetRoundLiveState();
    const container = document.getElementById("markets-container");
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"></circle>
              <circle cx="12" cy="12" r="3"></circle>
              <line x1="12" y1="3" x2="12" y2="6"></line>
              <line x1="12" y1="18" x2="12" y2="21"></line>
              <line x1="3" y1="12" x2="6" y2="12"></line>
              <line x1="18" y1="12" x2="21" y2="12"></line>
            </svg>
          </div>
          No active round right now.
          <span>Check back soon - rounds open regularly.</span>
        </div>`;
    }
    updateRoundStrip(null);
  }

  function renderRound(round) {
    const container = document.getElementById("markets-container");
    if (!container) return;

    const isOpen = round.status === "open";
    const opensAt = round.opens_at ? new Date(round.opens_at) : null;
    const closesAt = round.closes_at ? new Date(round.closes_at) : null;
    const endsAt = round.ends_at ? new Date(round.ends_at) : null;

    container.innerHTML = `
      <div class="round-header">
        <span class="round-badge round-${round.status}">${round.status.toUpperCase()}</span>
        <span class="round-type">${round.market_type.replace(/_/g, " ")}</span>
      </div>
      <div class="round-timing">
        ${opensAt ? `<div class="timing-row"><span>Started</span><strong id="rt-elapsed"></strong></div>` : ""}
        ${closesAt ? `<div class="timing-row"><span>Bets close</span><strong id="rt-closes"></strong></div>` : ""}
        ${endsAt ? `<div class="timing-row"><span>Round ends</span><strong id="rt-ends"></strong></div>` : ""}
      </div>
      <div id="user-round-bet" class="user-round-bet hidden"></div>
      <div class="market-list" id="market-list">
        ${round.markets.map((m) => renderMarket(m, isOpen)).join("")}
      </div>
      ${isOpen ? `
      <div style="margin-top:12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top:10px;">
        <button class="btn-live-bet btn-full" id="btn-open-live-bet">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          Exact Count Live Bet (8x)
        </button>
      </div>` : ""}
    `;

    startTimers(opensAt, closesAt, endsAt);

    document.getElementById("btn-open-live-bet")?.addEventListener("click", () => {
      LiveBet.open(currentRound);
    });

    _renderUserRoundBet();
  }

  function renderMarket(market, isOpen) {
    return `
      <div class="market-card"
           data-market-id="${market.id}"
           data-label="${escAttr(market.label)}"
           data-odds="${market.odds}">
        <div class="market-label">${market.label}</div>
        <div class="market-odds">${parseFloat(market.odds).toFixed(2)}x</div>
        <div class="market-staked">${(market.total_staked || 0).toLocaleString()} staked</div>
        ${isOpen
          ? `<button class="btn-bet">Place Bet</button>`
          : `<span class="market-closed">Closed</span>`}
      </div>`;
  }

  function updateRoundStrip(round) {
    const strip = document.getElementById("round-strip");
    const badge = document.getElementById("rs-badge");
    const timer = document.getElementById("rs-timer");
    if (!strip) return;

    if (!round) {
      strip.classList.add("hidden");
      return;
    }

    strip.classList.remove("hidden");
    if (badge) badge.textContent = round.status.toUpperCase();

    const endsAt = round.ends_at ? new Date(round.ends_at) : null;
    if (!endsAt || !timer) return;

    const tick = () => {
      const diff = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
      timer.textContent = `${fmtDuration(diff)} left`;
    };
    tick();
    clearInterval(window._roundStripTimer);
    window._roundStripTimer = setInterval(tick, 1000);
  }

  function escAttr(str) {
    return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDuration(sec) {
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
      const s = (sec % 60).toString().padStart(2, "0");
      return `${h}:${m}:${s}`;
    }
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function startTimers(opensAt, closesAt, endsAt) {
    clearInterval(timersInterval);
    let closedFired = false;
    let endedFired = false;

    timersInterval = setInterval(() => {
      const now = Date.now();

      const elapsedEl = document.getElementById("rt-elapsed");
      if (elapsedEl && opensAt) {
        const elapsed = Math.max(0, Math.floor((now - opensAt) / 1000));
        elapsedEl.textContent = `${fmtDuration(elapsed)} ago`;
      }

      const closesEl = document.getElementById("rt-closes");
      if (closesEl && closesAt) {
        const diff = Math.max(0, Math.floor((closesAt - now) / 1000));
        closesEl.textContent = diff === 0 ? "Closed" : `in ${fmtDuration(diff)}`;
        if (diff === 0 && !closedFired) {
          closedFired = true;
          setTimeout(loadMarkets, 1500);
        }
      }

      const endsEl = document.getElementById("rt-ends");
      if (endsEl && endsAt) {
        const diff = Math.max(0, Math.floor((endsAt - now) / 1000));
        endsEl.textContent = diff === 0 ? "Resolving..." : `in ${fmtDuration(diff)}`;
        if (diff === 0 && !endedFired) {
          endedFired = true;
          setTimeout(loadMarkets, 4000);
        }
      }
      _renderUserRoundBet();
    }, 1000);
  }

  async function _ensureCurrentUser() {
    if (currentUserId !== null) return;
    const session = await Auth.getSession();
    currentUserId = session?.user?.id || "";
  }

  function _resetRoundLiveState() {
    roundBaseline = null;
    userRoundBets = [];
  }

  function _stopUserBetPolling() {
    clearInterval(userBetPollTimer);
    userBetPollTimer = null;
  }

  function _startUserBetPolling() {
    _stopUserBetPolling();
    if (!currentRound || !currentUserId) return;
    userBetPollTimer = setInterval(() => {
      _loadUserRoundBets();
    }, USER_BET_POLL_MS);
  }

  async function _ensureRoundBaseline(round) {
    if (!round || !round.camera_id || roundBaseline) return;

    try {
      const opensAt = round.opens_at || new Date().toISOString();
      const { data } = await window.sb
        .from("count_snapshots")
        .select("total, vehicle_breakdown, captured_at")
        .eq("camera_id", round.camera_id)
        .lte("captured_at", opensAt)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      roundBaseline = {
        total: Number(data?.total || 0),
        vehicle_breakdown: data?.vehicle_breakdown || {},
      };
    } catch {
      roundBaseline = { total: 0, vehicle_breakdown: {} };
    }

    _renderUserRoundBet();
  }

  async function _loadUserRoundBets() {
    const box = document.getElementById("user-round-bet");
    if (!box) return;
    if (!currentRound || !currentUserId) {
      userRoundBets = [];
      _renderUserRoundBet();
      return;
    }

    try {
      const { data } = await window.sb
        .from("bets")
        .select("id, bet_type, status, amount, potential_payout, exact_count, actual_count, vehicle_class, window_duration_sec, window_start, baseline_count, placed_at, resolved_at, markets(label, odds, outcome_key)")
        .eq("user_id", currentUserId)
        .eq("round_id", currentRound.id)
        .order("placed_at", { ascending: false })
        .limit(20);

      userRoundBets = data || [];
      _renderUserRoundBet();
    } catch (err) {
      console.warn("[Markets] User bet load failed:", err);
    }
  }

  function _roundProgressCount() {
    if (!latestCountPayload) return null;
    const mt = currentRound?.market_type;
    const params = currentRound?.params || {};
    const vehicleClass = mt === "vehicle_count" ? params.vehicle_class : null;
    const status = String(currentRound?.status || "").toLowerCase();
    const useRoundRelative = status === "upcoming" || status === "open" || status === "locked";

    const currentRaw = vehicleClass
      ? Number(latestCountPayload?.vehicle_breakdown?.[vehicleClass] || 0)
      : Number(latestCountPayload?.total || 0);

    if (!useRoundRelative) {
      return Math.max(0, currentRaw);
    }

    const baselineRaw = vehicleClass
      ? Number(roundBaseline?.vehicle_breakdown?.[vehicleClass] || 0)
      : Number(roundBaseline?.total || 0);

    return Math.max(0, currentRaw - baselineRaw);
  }

  function _liveExactProgress(bet) {
    if (!latestCountPayload || !bet) return null;
    const vehicleClass = bet.vehicle_class || null;
    const currentRaw = vehicleClass
      ? Number(latestCountPayload?.vehicle_breakdown?.[vehicleClass] || 0)
      : Number(latestCountPayload?.total || 0);
    const baseline = Number(bet.baseline_count || 0);
    return Math.max(0, currentRaw - baseline);
  }

  function _marketHint(selection, progress, threshold) {
    if (progress == null || !Number.isFinite(threshold)) return "Waiting for live count...";
    if (selection === "over") {
      const need = Math.max(0, threshold + 1 - progress);
      return need === 0 ? "Over line reached." : `Need ${need} more to clear over.`;
    }
    if (selection === "under") {
      if (progress > threshold) return "Under is currently busted.";
      const left = Math.max(0, threshold - progress);
      return `${left} left before under breaks.`;
    }
    if (selection === "exact") {
      const diff = Math.abs(threshold - progress);
      return diff === 0 ? "On exact target." : `${diff} away from exact target.`;
    }
    return "Tracking round progress live.";
  }

  function _renderUserRoundBet() {
    const box = document.getElementById("user-round-bet");
    if (!box) return;

    const pending = userRoundBets.filter((b) => b.status === "pending");
    const latestResolved = userRoundBets.find((b) => b.status !== "pending");

    if (!pending.length && !latestResolved) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }

    const active = pending[0] || null;
    const pendingCount = pending.length;
    let body = "";

    if (active?.bet_type === "market") {
      const selection = String(active?.markets?.outcome_key || "").toLowerCase();
      const threshold = Number(currentRound?.params?.threshold ?? 0);
      const progress = _roundProgressCount();
      const status = String(currentRound?.status || "").toLowerCase();
      const isRoundActive = status === "upcoming" || status === "open" || status === "locked";
      const progressLabel = isRoundActive ? "Round progress" : "Global count";
      const progressText = progress == null || !Number.isFinite(threshold)
        ? "—"
        : `${progress.toLocaleString()}/${threshold.toLocaleString()}`;
      body = `
        <div class="user-round-bet-row"><span>Your pick</span><strong>${(active?.markets?.label || "Market bet")}</strong></div>
        <div class="user-round-bet-row"><span>${progressLabel}</span><strong>${progressText}</strong></div>
        <div class="user-round-bet-note">${_marketHint(selection, progress, threshold)}</div>
      `;
    } else if (active?.bet_type === "exact_count") {
      const live = _liveExactProgress(active);
      const target = Number(active?.exact_count || 0);
      const cls = active?.vehicle_class || "all vehicles";
      const liveText = live == null ? "—" : `${live.toLocaleString()}/${target.toLocaleString()}`;
      const hint = live == null
        ? "Waiting for live count..."
        : (live === target ? "On target right now." : `Need ${Math.max(0, target - live)} more to hit target.`);
      body = `
        <div class="user-round-bet-row"><span>Your pick</span><strong>Exact ${target} (${cls})</strong></div>
        <div class="user-round-bet-row"><span>Window progress</span><strong>${liveText}</strong></div>
        <div class="user-round-bet-note">${hint}</div>
      `;
    }

    const resolvedBlock = latestResolved
      ? `
        <div class="user-round-bet-resolved">
          <span class="badge badge-${latestResolved.status}">${latestResolved.status}</span>
          <span>${latestResolved.status === "won"
            ? `Won +${Number(latestResolved.potential_payout || 0).toLocaleString()}`
            : "Lost"}</span>
        </div>
      `
      : "";

    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="user-round-bet-head">
        <span>Your Bet Status</span>
        <span class="badge badge-pending">${pendingCount} pending</span>
      </div>
      ${body}
      ${resolvedBlock}
    `;
  }

  function init() {
    initTabs();
    loadMarkets();

    setInterval(loadMarkets, 60000);

    window.addEventListener("round:update", (e) => {
      if (e.detail) {
        if (e.detail.id !== lastRoundId) {
          lastRoundId = e.detail.id;
          loadMarkets();
        }
      } else {
        lastRoundId = null;
        renderNoRound();
      }
    });

    window.addEventListener("count:update", (e) => {
      latestCountPayload = e.detail || null;
      _renderUserRoundBet();
    });

    window.addEventListener("bet:placed", () => {
      _loadUserRoundBets();
    });

    window.addEventListener("bet:resolved", () => {
      _loadUserRoundBets();
    });

    const container = document.getElementById("markets-container");
    if (container) {
      container.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-bet");
        if (!btn) return;
        const card = btn.closest(".market-card");
        if (!card) return;
        Bet.openModal(
          card.dataset.marketId,
          card.dataset.label,
          parseFloat(card.dataset.odds)
        );
      });
    }
  }

  return { init, loadMarkets, getCurrentRound: () => currentRound };
})();

window.Markets = Markets;
