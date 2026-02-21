/**
 * markets.js — Renders active bet markets.
 * Receives real-time round updates via round:update events (from counter.js WS).
 * Falls back to polling Supabase every 60s.
 */

const Markets = (() => {
  let currentRound = null;
  let timersInterval = null;
  let lastRoundId = null;

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
      renderRound(round);
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
  }

  function renderRound(round) {
    const container = document.getElementById("markets-container");
    if (!container) return;

    const isOpen = round.status === "open";
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
      </div>`;

    startTimers(opensAt, closesAt, endsAt);
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

  function init() {
    loadMarkets();
    // Fallback poll
    setInterval(loadMarkets, 60_000);

    // Real-time round updates from WS
    window.addEventListener("round:update", (e) => {
      if (e.detail) {
        // Only reload if round changed (avoids re-render on every count tick)
        if (e.detail.id !== lastRoundId) {
          lastRoundId = e.detail.id;
          loadMarkets();
        }
      } else {
        lastRoundId = null;
        renderNoRound();
      }
    });

    // Event delegation for bet buttons (avoids inline onclick — CSP safe)
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
