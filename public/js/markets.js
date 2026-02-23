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
  let nextRoundPollTimer = null;
  let nextRoundTickTimer = null;
  let nextRoundAtIso = null;
  let hasInitialRender = false;
  let lastUserBetMarkup = "";
  let latestResolvedCard = null;
  const dismissedResolvedBetIds = new Set();
  const RESOLVED_CARD_STORAGE_KEY = "wlz_round_result_card_v1";
  const DISMISSED_RESOLVED_STORAGE_KEY = "wlz_round_result_dismissed_v1";

  const USER_BET_POLL_MS = 5000;
  const NIGHT_PAUSE_START_HOUR = 18;
  const NIGHT_RESUME_HOUR = 6;

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
    if (!hasInitialRender) _showSkeleton();
    try {
      await _ensureCurrentUser();
      const round = await _fetchPreferredRound();

      if (!round) {
        renderNoRound();
        return;
      }

      if (currentRound?.id !== round.id) {
        if (latestResolvedCard?.round_id && latestResolvedCard.round_id !== round.id) {
          _clearResolvedOutcomeCard();
        }
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

  async function _fetchPreferredRound() {
    // 1) Prefer currently open round.
    const { data: openRound, error: openErr } = await window.sb
      .from("bet_rounds")
      .select("*, markets(*)")
      .eq("status", "open")
      .order("opens_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!openErr && openRound) return openRound;

    // 2) Then a recently locked round (shows "resolving" while settlement runs).
    const { data: lockedRound, error: lockedErr } = await window.sb
      .from("bet_rounds")
      .select("*, markets(*)")
      .eq("status", "locked")
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lockedErr && lockedRound) return lockedRound;

    // 3) Finally, next upcoming round.
    const { data: upcomingRound, error: upcomingErr } = await window.sb
      .from("bet_rounds")
      .select("*, markets(*)")
      .eq("status", "upcoming")
      .order("opens_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!upcomingErr && upcomingRound) return upcomingRound;

    return null;
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
      const html = `
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
          <span id="next-round-note">Checking next round schedule...</span>
          <strong id="next-round-countdown" style="font-size:0.95rem;color:var(--accent);">--:--</strong>
          <div id="night-market-warning" style="display:none;margin-top:10px;padding:10px;border:1px solid rgba(241,179,124,0.42);border-radius:8px;background:rgba(56,41,24,0.35);color:#f6cd93;font-size:0.83rem;line-height:1.35;">
            Night pause active: rounds are paused because AI night detection is still being trained for accuracy.
            Rounds resume at <strong id="night-resume-time">6:00 AM</strong>.
          </div>
        </div>`;
      if (container.innerHTML !== html) container.innerHTML = html;
    }
    updateRoundStrip(null);
    _startNextRoundCountdown();
    _renderResolvedOutcomeCard();
    hasInitialRender = true;
  }

  function _isNightTrainingPause(now = new Date()) {
    const hour = now.getHours();
    return hour >= NIGHT_PAUSE_START_HOUR || hour < NIGHT_RESUME_HOUR;
  }

  function _nextResumeAtSixLocal(now = new Date()) {
    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setMinutes(0);
    target.setHours(NIGHT_RESUME_HOUR);
    if (now.getHours() >= NIGHT_RESUME_HOUR) target.setDate(target.getDate() + 1);
    return target;
  }

  function _setNightMarketWarning(visible, resumeAt = null) {
    const warningEl = document.getElementById("night-market-warning");
    const resumeEl = document.getElementById("night-resume-time");
    if (!warningEl) return;
    warningEl.style.display = visible ? "block" : "none";
    if (visible && resumeEl && resumeAt) {
      resumeEl.textContent = resumeAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
  }

  function renderRound(round) {
    const container = document.getElementById("markets-container");
    if (!container) return;

    const isOpen = round.status === "open";
    const opensAt = round.opens_at ? new Date(round.opens_at) : null;
    const closesAt = round.closes_at ? new Date(round.closes_at) : null;
    const endsAt = round.ends_at ? new Date(round.ends_at) : null;

    const html = `
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
    if (container.innerHTML !== html) container.innerHTML = html;

    startTimers(opensAt, closesAt, endsAt);

    document.getElementById("btn-open-live-bet")?.addEventListener("click", () => {
      LiveBet.open(currentRound);
    });

    _renderUserRoundBet();
    _stopNextRoundCountdown();
    _renderResolvedOutcomeCard();
    hasInitialRender = true;
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
        const elapsedRaw = Math.floor((now - opensAt) / 1000);
        if (!Number.isFinite(elapsedRaw) || elapsedRaw < 0) {
          elapsedEl.textContent = "--:--";
        } else {
          elapsedEl.textContent = `${fmtDuration(elapsedRaw)} ago`;
        }
      }

      const closesEl = document.getElementById("rt-closes");
      if (closesEl && closesAt) {
        const diffRaw = Math.floor((closesAt - now) / 1000);
        const diff = Number.isFinite(diffRaw) ? Math.max(0, diffRaw) : 0;
        closesEl.textContent = diff === 0 ? "Closed" : `in ${fmtDuration(diff)}`;
        if (diff === 0 && !closedFired) {
          closedFired = true;
          setTimeout(loadMarkets, 1500);
        }
      }

      const endsEl = document.getElementById("rt-ends");
      if (endsEl && endsAt) {
        const diffRaw = Math.floor((endsAt - now) / 1000);
        const diff = Number.isFinite(diffRaw) ? Math.max(0, diffRaw) : 0;
        endsEl.textContent = diff === 0 ? "Resolving..." : `in ${fmtDuration(diff)}`;
        if (diff === 0 && !endedFired) {
          endedFired = true;
          setTimeout(loadMarkets, 4000);
        }
      }
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

  function _loadPersistedResolvedCard() {
    try {
      const rawCard = localStorage.getItem(RESOLVED_CARD_STORAGE_KEY);
      if (rawCard) {
        const parsed = JSON.parse(rawCard);
        if (parsed && parsed.bet_id) latestResolvedCard = parsed;
      }
      const rawDismissed = localStorage.getItem(DISMISSED_RESOLVED_STORAGE_KEY);
      if (rawDismissed) {
        const arr = JSON.parse(rawDismissed);
        if (Array.isArray(arr)) {
          arr.slice(0, 200).forEach((id) => dismissedResolvedBetIds.add(String(id)));
        }
      }
    } catch {}
  }

  function _persistResolvedCard() {
    try {
      if (!latestResolvedCard || !latestResolvedCard.bet_id) {
        localStorage.removeItem(RESOLVED_CARD_STORAGE_KEY);
        return;
      }
      localStorage.setItem(RESOLVED_CARD_STORAGE_KEY, JSON.stringify(latestResolvedCard));
    } catch {}
  }

  function _persistDismissedResolved() {
    try {
      localStorage.setItem(
        DISMISSED_RESOLVED_STORAGE_KEY,
        JSON.stringify(Array.from(dismissedResolvedBetIds).slice(-200)),
      );
    } catch {}
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

  function _formatCountdown(sec) {
    const n = Math.max(0, Math.floor(sec));
    const m = Math.floor(n / 60).toString().padStart(2, "0");
    const s = (n % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function _stopNextRoundCountdown() {
    clearInterval(nextRoundPollTimer);
    clearInterval(nextRoundTickTimer);
    nextRoundPollTimer = null;
    nextRoundTickTimer = null;
    nextRoundAtIso = null;
  }

  async function _pollNextRoundAt() {
    const noteEl = document.getElementById("next-round-note");
    const cdEl = document.getElementById("next-round-countdown");
    if (!noteEl || !cdEl) return;
    try {
      nextRoundAtIso = null;
      const now = new Date();
      const nightPaused = _isNightTrainingPause(now);
      if (nightPaused) {
        const resumeAt = _nextResumeAtSixLocal(now);
        nextRoundAtIso = resumeAt.toISOString();
        noteEl.textContent = "Rounds paused overnight while AI improves night detection. Resuming at 6:00 AM.";
        const diffNight = Math.max(0, Math.floor((resumeAt.getTime() - Date.now()) / 1000));
        cdEl.textContent = _formatCountdown(diffNight);
        _setNightMarketWarning(true, resumeAt);
        return;
      }
      _setNightMarketWarning(false);

      // 1) Try backend health first, but do not fail hard if unavailable.
      try {
        const h = await fetch("/api/health");
        if (h.ok) {
          const health = await h.json();
          nextRoundAtIso = health?.next_round_at || null;
        }
      } catch {}

      // 2) Fallback to active session scheduler timestamp.
      if (!nextRoundAtIso && window.sb) {
        const { data: session } = await window.sb
          .from("round_sessions")
          .select("next_round_at,status")
          .eq("status", "active")
          .not("next_round_at", "is", null)
          .order("next_round_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        nextRoundAtIso = session?.next_round_at || null;
      }

      // 3) Final fallback to upcoming rounds table.
      if (!nextRoundAtIso && window.sb) {
        const { data } = await window.sb
          .from("bet_rounds")
          .select("id, opens_at, status")
          .eq("status", "upcoming")
          .order("opens_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        nextRoundAtIso = data?.opens_at || null;
      }
      if (!nextRoundAtIso) {
        noteEl.textContent = "New round schedule will appear shortly.";
        cdEl.textContent = "--:--";
        return;
      }
      noteEl.textContent = "Next round starts soon.";
      const diff = Math.max(0, Math.floor((new Date(nextRoundAtIso).getTime() - Date.now()) / 1000));
      cdEl.textContent = _formatCountdown(diff);
    } catch {
      noteEl.textContent = "Schedule temporarily unavailable.";
      cdEl.textContent = "--:--";
    }
  }

  function _startNextRoundCountdown() {
    _stopNextRoundCountdown();
    _pollNextRoundAt();
    nextRoundPollTimer = setInterval(_pollNextRoundAt, 15000);
    nextRoundTickTimer = setInterval(() => {
      const cdEl = document.getElementById("next-round-countdown");
      const noteEl = document.getElementById("next-round-note");
      if (!cdEl || !nextRoundAtIso) return;
      const diff = Math.max(0, Math.floor((new Date(nextRoundAtIso).getTime() - Date.now()) / 1000));
      cdEl.textContent = _formatCountdown(diff);
      if (diff <= 0) {
        if (noteEl) noteEl.textContent = "Starting next round...";
        _pollNextRoundAt();
        loadMarkets();
      }
    }, 1000);
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
        .select("id, round_id, bet_type, status, amount, potential_payout, exact_count, actual_count, vehicle_class, window_duration_sec, window_start, baseline_count, placed_at, resolved_at, markets(label, odds, outcome_key)")
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
    if (!currentRound) return null;
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

  function _marketProgressCount(bet) {
    if (!latestCountPayload || !currentRound || !bet) return null;
    const mt = currentRound.market_type;
    const params = currentRound.params || {};
    const vehicleClass = mt === "vehicle_count" ? params.vehicle_class : null;
    const status = String(currentRound.status || "").toLowerCase();
    const useRoundRelative = status === "upcoming" || status === "open" || status === "locked";

    const currentRaw = vehicleClass
      ? Number(latestCountPayload?.vehicle_breakdown?.[vehicleClass] || 0)
      : Number(latestCountPayload?.total || 0);

    if (!useRoundRelative) return Math.max(0, currentRaw);

    const baseline = Number(
      bet?.baseline_count ??
      (vehicleClass
        ? (roundBaseline?.vehicle_breakdown?.[vehicleClass] || 0)
        : (roundBaseline?.total || 0))
    ) || 0;

    return Math.max(0, currentRaw - baseline);
  }

  function _estimateMarketChance(selection, progress, threshold, placedAtIso) {
    if (progress == null || !Number.isFinite(threshold)) return null;
    const now = Date.now();
    const placed = placedAtIso ? new Date(placedAtIso).getTime() : now;
    const ends = currentRound?.ends_at ? new Date(currentRound.ends_at).getTime() : now;
    const elapsedMin = Math.max(0.5, (now - placed) / 60000);
    const leftMin = Math.max(0, (ends - now) / 60000);
    const rate = progress / elapsedMin;
    const projected = progress + (rate * leftMin);

    if (selection === "over") {
      if (progress > threshold) return 100;
      return Math.max(5, Math.min(95, Math.round(50 + ((projected - (threshold + 1)) * 6))));
    }
    if (selection === "under") {
      if (progress > threshold) return 0;
      return Math.max(5, Math.min(95, Math.round(50 + (((threshold - projected)) * 6))));
    }
    if (selection === "exact") {
      const distance = Math.abs(threshold - projected);
      return Math.max(1, Math.min(60, Math.round(35 - (distance * 4))));
    }
    return null;
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
    if (latestResolved && !dismissedResolvedBetIds.has(String(latestResolved.id))) {
      latestResolvedCard = {
        bet_id: latestResolved.id,
        round_id: latestResolved.round_id || currentRound?.id || null,
        won: latestResolved.status === "won",
        payout: Number(latestResolved.potential_payout || 0),
        actual: latestResolved.actual_count,
        exact: latestResolved.exact_count,
        vehicle_class: latestResolved.vehicle_class || null,
        amount: Number(latestResolved.amount || 0),
        market_label: latestResolved?.markets?.label || null,
        status: latestResolved.status,
      };
      _persistResolvedCard();
      _renderResolvedOutcomeCard();
    }

    if (!pending.length && !latestResolved) {
      box.classList.add("hidden");
      if (box.innerHTML) box.innerHTML = "";
      lastUserBetMarkup = "";
      return;
    }

    const active = pending[0] || null;
    const pendingCount = pending.length;
    let body = "";

    if (active?.bet_type === "market") {
      const selection = String(active?.markets?.outcome_key || "").toLowerCase();
      const threshold = Number(currentRound?.params?.threshold ?? 0);
      const progress = _marketProgressCount(active);
      const status = String(currentRound?.status || "").toLowerCase();
      const isRoundActive = status === "upcoming" || status === "open" || status === "locked";
      const progressLabel = isRoundActive ? "Round progress" : "Global count";
      const progressText = progress == null || !Number.isFinite(threshold)
        ? "—"
        : `${progress.toLocaleString()}/${threshold.toLocaleString()}`;
      const chance = _estimateMarketChance(selection, progress, threshold, active?.placed_at);
      const liveEdge = chance == null
        ? "—"
        : `${chance}%`;
      const odds = Number(active?.markets?.odds || 0);
      const payout = Number(active?.potential_payout || 0);
      const stake = Number(active?.amount || 0);
      body = `
        <div class="user-round-bet-row"><span>Your pick</span><strong>${(active?.markets?.label || "Market bet")}</strong></div>
        <div class="user-round-bet-row"><span>Stake</span><strong>${stake.toLocaleString()} credits</strong></div>
        <div class="user-round-bet-row"><span>Odds</span><strong>${odds ? odds.toFixed(2) + "x" : "—"}</strong></div>
        <div class="user-round-bet-row"><span>Potential payout</span><strong>${payout.toLocaleString()} credits</strong></div>
        <div class="user-round-bet-row"><span>${progressLabel}</span><strong>${progressText}</strong></div>
        <div class="user-round-bet-row"><span>Live likelihood</span><strong>${liveEdge}</strong></div>
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
      const payout = Number(active?.potential_payout || 0);
      const stake = Number(active?.amount || 0);
      body = `
        <div class="user-round-bet-row"><span>Your pick</span><strong>Exact ${target} (${cls})</strong></div>
        <div class="user-round-bet-row"><span>Stake</span><strong>${stake.toLocaleString()} credits</strong></div>
        <div class="user-round-bet-row"><span>Potential payout</span><strong>${payout.toLocaleString()} credits</strong></div>
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

    const markup = `
      <div class="user-round-bet-head">
        <span>Your Bet Status</span>
        <span class="badge badge-pending">${pendingCount} pending</span>
      </div>
      <div class="user-round-bet-row"><span>Receipt</span><strong>#${String(active?.id || "").slice(0, 8)}</strong></div>
      ${body}
      ${resolvedBlock}
    `;

    box.classList.remove("hidden");
    if (markup !== lastUserBetMarkup) {
      box.innerHTML = markup;
      lastUserBetMarkup = markup;
    }
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

    window.addEventListener("bet:resolved", (e) => {
      const d = e.detail || {};
      if (d.bet_id && dismissedResolvedBetIds.has(String(d.bet_id))) return;
      latestResolvedCard = {
        bet_id: d.bet_id,
        round_id: d.round_id || currentRound?.id || null,
        won: !!d.won,
        payout: Number(d.payout || 0),
        actual: d.actual,
        exact: d.exact,
        vehicle_class: d.vehicle_class || null,
        amount: Number(d.amount || 0),
        market_label: d.market_label || null,
        status: d.won ? "won" : "lost",
      };
      _persistResolvedCard();
      _renderResolvedOutcomeCard();
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

    document.getElementById("tab-markets")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-dismiss-resolved]");
      if (!btn) return;
      const id = String(btn.getAttribute("data-dismiss-resolved") || "");
      if (id) {
        dismissedResolvedBetIds.add(id);
        _persistDismissedResolved();
      }
      _clearResolvedOutcomeCard();
    });

    _loadPersistedResolvedCard();
    _renderResolvedOutcomeCard();
  }

  function _clearResolvedOutcomeCard() {
    latestResolvedCard = null;
    _persistResolvedCard();
    const card = document.getElementById("round-result-card");
    if (card) card.remove();
  }

  function _renderResolvedOutcomeCard() {
    const tab = document.getElementById("tab-markets");
    if (!tab || !latestResolvedCard || !latestResolvedCard.bet_id) return;
    if (dismissedResolvedBetIds.has(String(latestResolvedCard.bet_id))) return;

    const existing = document.getElementById("round-result-card");
    if (existing) existing.remove();

    const card = document.createElement("div");
    card.id = "round-result-card";
    card.className = `round-result-card ${latestResolvedCard.won ? "result-win" : "result-loss"}`;

    const badge = latestResolvedCard.won ? "WIN" : "LOSS";
    const subtitle = latestResolvedCard.market_label
      ? latestResolvedCard.market_label
      : `Exact ${latestResolvedCard.exact ?? "?"}${latestResolvedCard.vehicle_class ? ` (${latestResolvedCard.vehicle_class})` : ""}`;

    const payoutText = latestResolvedCard.won
      ? `+${Number(latestResolvedCard.payout || 0).toLocaleString()} credits`
      : `-${Number(latestResolvedCard.amount || 0).toLocaleString()} credits`;

    card.innerHTML = `
      <div class="round-result-head">
        <span class="round-result-badge">${badge}</span>
        <button class="round-result-close" type="button" data-dismiss-resolved="${latestResolvedCard.bet_id}" aria-label="Dismiss">x</button>
      </div>
      <div class="round-result-title">${subtitle}</div>
      <div class="round-result-row"><span>Receipt</span><strong>#${String(latestResolvedCard.bet_id).slice(0, 8)}</strong></div>
      <div class="round-result-row"><span>Outcome</span><strong>${payoutText}</strong></div>
      <div class="round-result-row"><span>Actual</span><strong>${latestResolvedCard.actual ?? "-"}</strong></div>
      <div class="round-result-row"><span>Target</span><strong>${latestResolvedCard.exact ?? "-"}</strong></div>
    `;

    const container = document.getElementById("markets-container");
    if (container) tab.insertBefore(card, container);
    else tab.prepend(card);
  }

  return { init, loadMarkets, getCurrentRound: () => currentRound };
})();

window.Markets = Markets;
