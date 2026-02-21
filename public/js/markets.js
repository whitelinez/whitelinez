/**
 * markets.js — Renders active bet markets from WS feed.
 * Listens for count:update events from counter.js and fetches market data
 * from Supabase directly (public read via anon key + RLS).
 */

const Markets = (() => {
  let currentRound = null;
  let refreshTimer = null;

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

    const closesAt = round.closes_at ? new Date(round.closes_at) : null;
    const isOpen = round.status === "open";

    container.innerHTML = `
      <div class="round-header">
        <span class="round-badge round-${round.status}">${round.status.toUpperCase()}</span>
        <span class="round-type">${round.market_type.replace("_", " ")}</span>
        ${closesAt ? `<span class="closes-at">Closes: <strong id="round-countdown"></strong></span>` : ""}
      </div>
      <div class="market-list">
        ${round.markets.map((m) => renderMarket(m, isOpen)).join("")}
      </div>`;

    if (closesAt) startCountdown(closesAt);
  }

  function renderMarket(market, isOpen) {
    return `
      <div class="market-card" data-market-id="${market.id}">
        <div class="market-label">${market.label}</div>
        <div class="market-odds">${parseFloat(market.odds).toFixed(2)}x</div>
        <div class="market-staked">${market.total_staked.toLocaleString()} staked</div>
        ${
          isOpen
            ? `<button class="btn-bet" onclick="Bet.openModal('${market.id}', '${market.label}', ${market.odds})">
                Place Bet
               </button>`
            : `<span class="market-closed">Closed</span>`
        }
      </div>`;
  }

  function startCountdown(closesAt) {
    const el = document.getElementById("round-countdown");
    if (!el) return;
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      const diff = Math.max(0, Math.floor((closesAt - Date.now()) / 1000));
      const m = Math.floor(diff / 60).toString().padStart(2, "0");
      const s = (diff % 60).toString().padStart(2, "0");
      el.textContent = `${m}:${s}`;
      if (diff === 0) {
        clearInterval(refreshTimer);
        loadMarkets(); // reload to show locked state
      }
    }, 1000);
  }

  function init() {
    loadMarkets();
    // Refresh every 60s in case a new round opens
    setInterval(loadMarkets, 60_000);
  }

  return { init, loadMarkets, getCurrentRound: () => currentRound };
})();

window.Markets = Markets;
