/**
 * markets.js - Renders active bet markets in the sidebar.
 * Manages sidebar tab switching.
 * Connects market cards to bet panel (LiveBet) instead of a modal.
 */

const Markets = (() => {
  let currentRound = null;
  let timersInterval = null;
  let lastRoundId = null;

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

      currentRound = round;
      LiveBet.setRound(round);
      renderRound(round);
      updateRoundStrip(round);
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
    }, 1000);
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
