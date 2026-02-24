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
  let optimisticPendingBet = null;
  let userBetPollTimer = null;
  let nextRoundPollTimer = null;
  let nextRoundTickTimer = null;
  let nextRoundAtIso = null;
  let hasInitialRender = false;
  let lastUserBetMarkup = "";
  let latestResolvedCard = null;
  let roundGuideCollapsed = false;
  const dismissedResolvedBetIds = new Set();
  const RESOLVED_CARD_STORAGE_KEY = "wlz_round_result_card_v1";
  const DISMISSED_RESOLVED_STORAGE_KEY = "wlz_round_result_dismissed_v1";
  const ROUND_GUIDE_COLLAPSE_KEY = "wlz_round_guide_collapsed_v1";

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
    const nowIso = new Date().toISOString();
    const recentLockedIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    // 1) Prefer currently open round.
    const { data: openRound, error: openErr } = await window.sb
      .from("bet_rounds")
      .select("*, markets(*)")
      .eq("status", "open")
      .gt("ends_at", nowIso)
      .order("opens_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!openErr && openRound) return openRound;

    // 2) Then a recently locked round (shows "resolving" while settlement runs).
    const { data: lockedRound, error: lockedErr } = await window.sb
      .from("bet_rounds")
      .select("*, markets(*)")
      .eq("status", "locked")
      .gte("ends_at", recentLockedIso)
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
          <div id="night-market-warning" class="night-market-warning" style="display:none;" role="status" aria-live="polite">
            <div class="night-market-art" aria-hidden="true">
              <svg viewBox="0 0 700 260" fill="none">
                <rect width="700" height="260" rx="16" fill="#090d15"/>
                <rect x="14" y="14" width="672" height="148" rx="12" fill="#121a2b"/>
                <circle cx="628" cy="40" r="14" fill="#ffe9a6"/>
                <circle cx="634" cy="36" r="14" fill="#121a2b"/>
                <circle cx="78" cy="42" r="2" fill="#d7e8ff"/>
                <circle cx="106" cy="30" r="1.6" fill="#b8cdf0"/>
                <circle cx="140" cy="44" r="1.8" fill="#d7e8ff"/>
                <rect x="14" y="126" width="672" height="36" fill="#0f1420"/>

                <g transform="translate(44,34)">
                  <rect x="0" y="0" width="188" height="110" rx="12" fill="none" stroke="#FFC400" stroke-opacity="0.35" stroke-width="3"/>
                  <path d="M12 30 V12 H30" stroke="#FFC400" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M158 12 H176 V30" stroke="#FFC400" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
                  <rect x="38" y="58" width="112" height="28" rx="7" fill="#D9DCE2"/>
                  <path d="M52 58 L74 36 H112 L136 58 Z" fill="#C7CBD4"/>
                  <circle cx="66" cy="90" r="11" fill="#2B2E35"/>
                  <circle cx="128" cy="90" r="11" fill="#2B2E35"/>
                </g>

                <g transform="translate(258,34)">
                  <rect x="0" y="0" width="188" height="110" rx="12" fill="#ff3b3b" fill-opacity="0.05" stroke="#FF3B3B" stroke-opacity="0.35" stroke-width="3"/>
                  <path d="M12 30 V12 H30" stroke="#FF3B3B" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M158 12 H176 V30" stroke="#FF3B3B" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
                  <rect x="32" y="52" width="104" height="42" rx="7" fill="#FFD23F"/>
                  <rect x="136" y="60" width="42" height="34" rx="6" fill="#D9DCE2"/>
                  <circle cx="64" cy="98" r="10" fill="#2B2E35"/>
                  <circle cx="112" cy="98" r="10" fill="#2B2E35"/>
                  <circle cx="154" cy="98" r="10" fill="#2B2E35"/>
                </g>

                <g transform="translate(472,34)">
                  <rect x="0" y="0" width="188" height="110" rx="12" fill="none" stroke="#FFC400" stroke-opacity="0.35" stroke-width="3"/>
                  <path d="M12 30 V12 H30" stroke="#FFC400" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M158 12 H176 V30" stroke="#FFC400" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
                  <rect x="18" y="56" width="150" height="38" rx="9" fill="#FFD23F"/>
                  <rect x="36" y="62" width="106" height="18" rx="5" fill="#273447"/>
                  <circle cx="54" cy="98" r="11" fill="#2B2E35"/>
                  <circle cx="138" cy="98" r="11" fill="#2B2E35"/>
                </g>

                <rect x="20" y="178" width="660" height="68" rx="12" fill="#10131b" stroke="#A67A2B" stroke-width="2"/>
                <text x="350" y="206" text-anchor="middle" fill="#F7E5C0" style="font:700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
                  Night pause keeps market outcomes fair in low light.
                </text>
                <text x="350" y="228" text-anchor="middle" fill="#CBBEA2" style="font:600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
                  We wait for better confidence before opening rounds.
                </text>
              </svg>
            </div>
            <div class="night-market-copy">
              <strong class="night-market-title">Night Pause Active</strong>
              <p>
                We pause rounds at night so the AI can avoid low-light misreads and keep market outcomes fair.
              </p>
              <p class="night-market-resume">
                Rounds resume at <strong id="night-resume-time">6:00 AM</strong>.
              </p>
            </div>
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

  function _vehicleClassLabel(cls) {
    const v = String(cls || "").toLowerCase();
    if (v === "car") return "Cars";
    if (v === "truck") return "Trucks";
    if (v === "bus") return "Buses";
    if (v === "motorcycle") return "Motorcycles";
    return "Vehicles";
  }

  function _roundGuide(round) {
    const params = round?.params || {};
    const marketType = String(round?.market_type || "");
    const threshold = Number(params?.threshold || 0);
    const vehicleClass = String(params?.vehicle_class || "").toLowerCase();

    if (marketType === "over_under") {
      return {
        title: "How This Round Works",
        summary: `Count starts at 0 when the round opens and tracks new vehicles only.`,
        winRule: `Guess OVER if final count finishes above ${threshold}. Guess UNDER if below ${threshold}. EXACT wins only on exactly ${threshold}.`,
      };
    }

    if (marketType === "vehicle_count") {
      const clsLabel = _vehicleClassLabel(vehicleClass);
      return {
        title: "How This Round Works",
        summary: `Count starts at 0 and tracks only new ${clsLabel.toLowerCase()} this round.`,
        winRule: `Guess OVER if final ${clsLabel.toLowerCase()} count finishes above ${threshold}. Guess UNDER if below ${threshold}. EXACT wins on exactly ${threshold}.`,
      };
    }

    if (marketType === "vehicle_type") {
      return {
        title: "How This Round Works",
        summary: "All vehicle classes are tracked from 0 during this round.",
        winRule: "Guess the vehicle class that finishes with the highest round total.",
      };
    }

    return {
      title: "How This Round Works",
      summary: "Choose one outcome before bets close.",
      winRule: "If your guess matches the final result, your bet wins.",
    };
  }

  function _friendlyMarketLabel(round, market) {
    const params = round?.params || {};
    const marketType = String(round?.market_type || "");
    const outcome = String(market?.outcome_key || "").toLowerCase();
    const threshold = Number(params?.threshold || 0);
    const cls = _vehicleClassLabel(params?.vehicle_class);

    if (marketType === "over_under") {
      if (outcome === "over") return `Over ${threshold} vehicles`;
      if (outcome === "under") return `Under ${threshold} vehicles`;
      if (outcome === "exact") return `Exactly ${threshold} vehicles`;
    }

    if (marketType === "vehicle_count") {
      if (outcome === "over") return `Over ${threshold} ${cls.toLowerCase()}`;
      if (outcome === "under") return `Under ${threshold} ${cls.toLowerCase()}`;
      if (outcome === "exact") return `Exactly ${threshold} ${cls.toLowerCase()}`;
    }

    if (marketType === "vehicle_type") {
      return `${String(market?.label || outcome || "Vehicle type")}`;
    }

    return String(market?.label || "Market");
  }

  function renderRound(round) {
    const container = document.getElementById("markets-container");
    if (!container) return;

    const isOpen = round.status === "open";
    const opensAt = round.opens_at ? new Date(round.opens_at) : null;
    const closesAt = round.closes_at ? new Date(round.closes_at) : null;
    const endsAt = round.ends_at ? new Date(round.ends_at) : null;
    const guide = _roundGuide(round);

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
      <div class="round-guide" role="note" aria-live="polite">
        <div class="round-guide-head">
          <p class="round-guide-title">${guide.title}</p>
          <button id="round-guide-toggle" class="round-guide-toggle" type="button">${roundGuideCollapsed ? "Show" : "Hide"}</button>
        </div>
        <div id="round-guide-body" class="round-guide-body${roundGuideCollapsed ? " collapsed" : ""}">
          <p class="round-guide-line">${guide.summary}</p>
          <p class="round-guide-line">${guide.winRule}</p>
        </div>
      </div>
      <div id="user-round-bet" class="user-round-bet hidden"></div>
      <div class="market-list" id="market-list">
        ${round.markets.map((m) => renderMarket(round, m, isOpen)).join("")}
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
    document.getElementById("round-guide-toggle")?.addEventListener("click", () => {
      _setRoundGuideCollapsed(!roundGuideCollapsed);
    });

    _renderUserRoundBet();
    _stopNextRoundCountdown();
    _renderResolvedOutcomeCard();
    hasInitialRender = true;
  }

  function renderMarket(round, market, isOpen) {
    const odds = parseFloat(market.odds || 0);
    const payout100 = odds > 0 ? Math.floor(100 * odds) : 0;
    const beginnerLabel = _friendlyMarketLabel(round, market);
    return `
      <div class="market-card"
           data-can-bet="${isOpen ? "1" : "0"}"
           data-market-id="${market.id}"
           data-label="${escAttr(beginnerLabel)}"
           data-odds="${market.odds}">
        <div class="market-label">${beginnerLabel}</div>
        <div class="market-payout">Bet 100 → ${payout100.toLocaleString()} credits</div>
        <div class="market-odds-note">Odds rate: ${odds.toFixed(2)}x payout multiplier</div>
        <div class="market-staked">${(market.total_staked || 0).toLocaleString()} staked</div>
        ${isOpen
          ? `<button class="btn-bet">Guess This Outcome</button>`
          : `<span class="market-closed">Closed</span>`}
      </div>`;
  }

  function _loadRoundGuidePref() {
    try {
      roundGuideCollapsed = localStorage.getItem(ROUND_GUIDE_COLLAPSE_KEY) === "1";
    } catch {
      roundGuideCollapsed = false;
    }
  }

  function _setRoundGuideCollapsed(next) {
    roundGuideCollapsed = !!next;
    try {
      localStorage.setItem(ROUND_GUIDE_COLLAPSE_KEY, roundGuideCollapsed ? "1" : "0");
    } catch {}
    const body = document.getElementById("round-guide-body");
    const toggle = document.getElementById("round-guide-toggle");
    if (body) body.classList.toggle("collapsed", roundGuideCollapsed);
    if (toggle) toggle.textContent = roundGuideCollapsed ? "Show" : "Hide";
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
    optimisticPendingBet = null;
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
      const jwt = await Auth.getJwt();
      if (!jwt) {
        userRoundBets = [];
        _renderUserRoundBet();
        return;
      }
      const qs = new URLSearchParams({
        round_id: String(currentRound.id),
        limit: "20",
      });
      const res = await fetch(`/api/bets/place?mode=my-round&${qs.toString()}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.detail || payload?.error || "Round bet load failed");
      }
      userRoundBets = Array.isArray(payload) ? payload : [];
      if (optimisticPendingBet?.id) {
        const matched = userRoundBets.some((b) => String(b?.id || "") === String(optimisticPendingBet.id));
        if (matched) optimisticPendingBet = null;
      }
      if (!userRoundBets.some((b) => String(b?.status || "").toLowerCase() === "pending")) {
        optimisticPendingBet = null;
      }
      await _hydrateBetBaselines(userRoundBets);
      _renderUserRoundBet();
    } catch (err) {
      console.warn("[Markets] User bet load failed:", err);
    }
  }

  async function _hydrateBetBaselines(bets) {
    if (!Array.isArray(bets) || !bets.length) return;
    if (!currentRound?.camera_id) return;

    const targets = bets.filter((b) => !!b?.placed_at);
    if (!targets.length) return;

    await Promise.all(targets.map(async (bet) => {
      try {
        const betType = String(bet?.bet_type || "market");
        const mt = String(currentRound?.market_type || "");
        const params = currentRound?.params || {};
        let vehicleClass = null;
        if (betType === "exact_count") {
          vehicleClass = bet?.vehicle_class || null;
        } else if (mt === "vehicle_count") {
          vehicleClass = params.vehicle_class || null;
        }

        const { data } = await window.sb
          .from("count_snapshots")
          .select("total, vehicle_breakdown")
          .eq("camera_id", currentRound.camera_id)
          .lte("captured_at", bet.placed_at)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!data) return;
        const derived = vehicleClass
          ? Number(data?.vehicle_breakdown?.[vehicleClass] || 0)
          : Number(data?.total || 0);
        if (Number.isFinite(derived)) {
          bet._derived_baseline_count = derived;
        }
      } catch {}
    }));
  }

  function _roundProgressCount() {
    if (!latestCountPayload) return null;
    if (!currentRound) return null;
    const mt = currentRound?.market_type;
    const params = currentRound?.params || {};
    const vehicleClass = mt === "vehicle_count" ? params.vehicle_class : null;
    const useRoundRelative = _shouldUseRoundRelativeCounts(currentRound);

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
    const useRoundRelative = _shouldUseRoundRelativeCounts(currentRound);

    const currentRaw = vehicleClass
      ? Number(latestCountPayload?.vehicle_breakdown?.[vehicleClass] || 0)
      : Number(latestCountPayload?.total || 0);

    if (!useRoundRelative) return Math.max(0, currentRaw);

    const baselineDb = Number(bet?.baseline_count);
    const baselineDerived = Number(bet?._derived_baseline_count);
    const betStatus = String(bet?.status || "").toLowerCase();
    if (
      betStatus === "pending"
      && Number.isFinite(baselineDb)
      && baselineDb <= 0
      && !Number.isFinite(baselineDerived)
    ) {
      return null;
    }
    let baseline = Number.isFinite(baselineDb) ? baselineDb : NaN;
    if (Number.isFinite(baselineDerived)) {
      baseline = Number.isFinite(baseline) ? Math.max(baseline, baselineDerived) : baselineDerived;
    }
    if (!Number.isFinite(baseline)) return null;

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
    if (!_shouldUseRoundRelativeCounts(currentRound)) {
      return Math.max(0, currentRaw);
    }
    const baselineDb = Number(bet?.baseline_count);
    const baselineDerived = Number(bet?._derived_baseline_count);
    const betStatus = String(bet?.status || "").toLowerCase();
    if (
      betStatus === "pending"
      && Number.isFinite(baselineDb)
      && baselineDb <= 0
      && !Number.isFinite(baselineDerived)
    ) {
      return null;
    }
    let baseline = Number.isFinite(baselineDb) ? baselineDb : NaN;
    if (Number.isFinite(baselineDerived)) {
      baseline = Number.isFinite(baseline) ? Math.max(baseline, baselineDerived) : baselineDerived;
    }
    if (!Number.isFinite(baseline)) return null;
    return Math.max(0, currentRaw - baseline);
  }

  function _shouldUseRoundRelativeCounts(round) {
    if (!round) return false;
    const status = String(round?.status || "").toLowerCase();
    const statusAllowsRelative = status === "upcoming" || status === "open" || status === "locked";
    if (!statusAllowsRelative) return false;
    const endsAtMs = round?.ends_at ? new Date(round.ends_at).getTime() : NaN;
    if (!Number.isFinite(endsAtMs)) return statusAllowsRelative;
    // Once round end timestamp passes, UI count views should return to global.
    return Date.now() < endsAtMs;
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
    const allPending = optimisticPendingBet ? [optimisticPendingBet, ...pending] : pending;
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

    if (!allPending.length && !latestResolved) {
      box.classList.add("hidden");
      if (box.innerHTML) box.innerHTML = "";
      lastUserBetMarkup = "";
      return;
    }

    const active = allPending[0] || null;
    const pendingCount = allPending.length;
    let body = "";

    if (active?.bet_type === "market") {
      const selection = String(active?.markets?.outcome_key || "").toLowerCase();
      const threshold = Number(currentRound?.params?.threshold ?? 0);
      const progress = _marketProgressCount(active);
      const isRoundActive = _shouldUseRoundRelativeCounts(currentRound);
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
        <div class="user-round-bet-row"><span>Your guess</span><strong>${(active?.markets?.label || "Market bet")}</strong></div>
        <div class="user-round-bet-row"><span>Stake</span><strong>${stake.toLocaleString()} credits</strong></div>
        <div class="user-round-bet-row"><span>Odds</span><strong>${odds ? odds.toFixed(2) + "x" : "—"}</strong></div>
        <div class="user-round-bet-row"><span>Potential payout</span><strong>${payout.toLocaleString()} credits</strong></div>
        <div class="user-round-bet-row"><span>${progressLabel}</span><strong>${progressText}</strong></div>
        <div class="user-round-bet-row"><span>Live likelihood</span><strong>${liveEdge}</strong></div>
        ${active?._optimistic ? `<div class="user-round-bet-row"><span>Validation</span><strong>Syncing ticket...</strong></div>` : ""}
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
        <div class="user-round-bet-row"><span>Your guess</span><strong>Exact ${target} (${cls})</strong></div>
        <div class="user-round-bet-row"><span>Stake</span><strong>${stake.toLocaleString()} credits</strong></div>
        <div class="user-round-bet-row"><span>Potential payout</span><strong>${payout.toLocaleString()} credits</strong></div>
        <div class="user-round-bet-row"><span>Window progress</span><strong>${liveText}</strong></div>
        ${active?._optimistic ? `<div class="user-round-bet-row"><span>Validation</span><strong>Syncing ticket...</strong></div>` : ""}
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
    _loadRoundGuidePref();
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

    window.addEventListener("bet:placed", (e) => {
      const d = e?.detail || {};
      let optimisticBaseline = null;
      try {
        if (latestCountPayload && currentRound) {
          if (d.bet_type === "exact_count") {
            const cls = d.vehicle_class || null;
            optimisticBaseline = cls
              ? Number(latestCountPayload?.vehicle_breakdown?.[cls] || 0)
              : Number(latestCountPayload?.total || 0);
          } else {
            const mt = String(currentRound?.market_type || "");
            const cls = mt === "vehicle_count" ? currentRound?.params?.vehicle_class : null;
            optimisticBaseline = cls
              ? Number(latestCountPayload?.vehicle_breakdown?.[cls] || 0)
              : Number(latestCountPayload?.total || 0);
          }
          if (!Number.isFinite(optimisticBaseline)) optimisticBaseline = null;
        }
      } catch {
        optimisticBaseline = null;
      }
      optimisticPendingBet = {
        id: String(d.bet_id || `temp-${Date.now()}`),
        round_id: d.round_id || currentRound?.id || null,
        bet_type: d.bet_type || "market",
        status: "pending",
        amount: Number(d.amount || 0),
        potential_payout: Number(d.potential_payout || 0),
        exact_count: d.exact_count ?? null,
        actual_count: null,
        vehicle_class: d.vehicle_class || null,
        window_duration_sec: Number(d.window_duration_sec || 0) || null,
        window_start: new Date().toISOString(),
        baseline_count: optimisticBaseline,
        placed_at: new Date().toISOString(),
        resolved_at: null,
        markets: d.bet_type === "market"
          ? {
              label: d.market_label || "Market bet",
              odds: Number(d.market_odds || 0) || 0,
              outcome_key: null,
            }
          : null,
        _optimistic: true,
      };
      _renderUserRoundBet();
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
        const target = e.target.closest(".btn-bet, .market-card");
        if (!target) return;
        const card = target.closest(".market-card");
        if (!card) return;
        if (card.dataset.canBet !== "1") return;
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
