/**
 * markets.js — Renders active bet markets in the sidebar.
 * Manages sidebar tab switching.
 * Connects market cards to bet panel (LiveBet) instead of a modal.
 */

const Markets = (() => {
  let currentRound = null;
  let timersInterval = null;
  let lastRoundId = null;

  // ── Tab switching ─────────────────────────────────────────────────

  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${tab}`)?.classList.add("active");
      });
    });
  }

  // ── Market loading ────────────────────────────────────────────────

  async function loadMarkets() {
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
    }
  }

  function renderNoRound() {
    clearInterval(timersInterval);
    timersInterval = null;
    lastRoundId = null;
    const container = document.getElementById("markets-container");
    if (container) {
      container.innerHTML = `
        <div class="no-round">
          <p>No active betting round right now.</p>
          <p class="muted">Check back soon.</p>
        </div>`;
    }
    updateRoundStrip(null);
  }

  function renderRound(round) {
    const container = document.getElementById("markets-container");
    if (!container) return;

    const isOpen  = round.status === "open";
    const opensAt  = round.opens_at  ? new Date(round.opens_at)  : null;
    const closesAt = round.closes_at ? new Date(round.closes_at) : null;
    const endsAt   = round.ends_at   ? new Date(round.ends_at)   : null;

    container.innerHTML = `
      <div class="round-header">
        <span class="round-badge round-${round.status}">${round.status.toUpperCase()}</span>
        <span class="round-type">${round.market_type.replace(/_/g, " ")}</span>
      </div>
      <div class="round-timing">
        ${opensAt  ? `<div class="timing-row"><span>Started</span><strong id="rt-elapsed"></strong></div>` : ""}
        ${closesAt ? `<div class="timing-row"><span>Bets close</span><strong id="rt-closes"></strong></div>` : ""}
        ${endsAt   ? `<div class="timing-row"><span>Round ends</span><strong id="rt-ends"></strong></div>` : ""}
      </div>
      <div class="market-list" id="market-list">
        ${round.markets.map((m) => renderMarket(m, isOpen)).join("")}
      </div>
      ${isOpen ? `
      <div style="margin-top:12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top:10px;">
        <button class="btn-live-bet btn-full" id="btn-open-live-bet">
          ⚡ Exact Count Live Bet (8x)
        </button>
      </div>` : ""}
    `;

    startTimers(opensAt, closesAt, endsAt);

    // Live bet button
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

  // ── Round strip on video ──────────────────────────────────────────

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

    // Timer shows time until closes_at (for open rounds)
    const endsAt = round.ends_at ? new Date(round.ends_at) : null;
    if (!endsAt || !timer) return;

    const tick = () => {
      const diff = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
      timer.textContent = fmtDuration(diff) + " left";
    };
    tick();
    clearInterval(window._roundStripTimer);
    window._roundStripTimer = setInterval(tick, 1000);
  }

  // ── Timers ────────────────────────────────────────────────────────

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
        elapsedEl.textContent = fmtDuration(elapsed) + " ago";
      }

      const closesEl = document.getElementById("rt-closes");
      if (closesEl && closesAt) {
        const diff = Math.max(0, Math.floor((closesAt - now) / 1000));
        closesEl.textContent = diff === 0 ? "Closed" : "in " + fmtDuration(diff);
        if (diff === 0 && !closedFired) {
          closedFired = true;
          setTimeout(loadMarkets, 1500);
        }
      }

      const endsEl = document.getElementById("rt-ends");
      if (endsEl && endsAt) {
        const diff = Math.max(0, Math.floor((endsAt - now) / 1000));
        endsEl.textContent = diff === 0 ? "Resolving..." : "in " + fmtDuration(diff);
        if (diff === 0 && !endedFired) {
          endedFired = true;
          setTimeout(loadMarkets, 4000);
        }
      }
    }, 1000);
  }

  // ── Init ──────────────────────────────────────────────────────────

  function init() {
    initTabs();
    loadMarkets();

    // Fallback poll
    setInterval(loadMarkets, 60_000);

    // Real-time round updates from WS
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

    // Event delegation for market bet buttons
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
