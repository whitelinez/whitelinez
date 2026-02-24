/**
 * activity.js — Global bet activity feed via Supabase realtime.
 * Anonymized: shows "Someone bet X credits — Exact: N cars in 30s"
 */

const Activity = (() => {
  let _channel = null;
  const MAX_ITEMS = 50;

  function init() {
    _showSkeletons();
    _loadHistory();
    _subscribe();
  }

  function _showSkeletons() {
    const container = document.getElementById("activity-feed");
    if (!container) return;
    container.innerHTML = Array(4).fill(
      `<div class="skeleton" style="height:52px;border-radius:8px;"></div>`
    ).join("");
  }

  function _showEmpty() {
    const container = document.getElementById("activity-feed");
    if (!container) return;
    container.innerHTML = `<div class="empty-state">No betting activity yet.<br><span>Be the first to place a bet.</span></div>`;
  }

  function _showError() {
    const container = document.getElementById("activity-feed");
    if (!container) return;
    container.innerHTML = `<div class="empty-state">Couldn't load activity.<br><span>Run SQL migrations if this persists.</span></div>`;
  }

  async function _loadHistory() {
    try {
      const { data, error } = await window.sb
        .from("bets")
        .select("amount, bet_type, exact_count, vehicle_class, window_duration_sec, placed_at")
        .order("placed_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      const container = document.getElementById("activity-feed");
      if (!container) return;
      container.innerHTML = ""; // clear skeletons

      if (!data || data.length === 0) {
        _showEmpty();
        return;
      }

      const reversed = [...data].reverse();
      reversed.forEach(renderItem);
    } catch (e) {
      console.warn("[Activity] History load failed:", e);
      _showError();
    }
  }

  function _subscribe() {
    if (_channel) window.sb.removeChannel(_channel);
    _channel = window.sb
      .channel("activity")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bets" },
        (payload) => { renderItem(payload.new, true); }
      )
      .subscribe();
  }

  function renderItem(bet, prepend = false) {
    const container = document.getElementById("activity-feed");
    if (!container) return;

    // Clear empty/error state if present
    const empty = container.querySelector(".empty-state");
    if (empty) empty.remove();

    while (container.children.length >= MAX_ITEMS) {
      container.removeChild(prepend ? container.lastChild : container.firstChild);
    }

    const time = bet.placed_at
      ? new Date(bet.placed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

    let desc = "Market bet";
    if (bet.bet_type === "exact_count") {
      const cls = bet.vehicle_class ? `${bet.vehicle_class}s` : "vehicles";
      const win = _secLabel(bet.window_duration_sec);
      desc = `Exact: <strong>${bet.exact_count} ${cls}</strong> in ${win}`;
    }

    const div = document.createElement("div");
    div.className = "activity-item";
    div.innerHTML = `
      <span class="act-time">${time}</span>
      Someone bet <strong>${(bet.amount || 0).toLocaleString()} ₡</strong> — ${desc}
    `;
    if (prepend) container.prepend(div);
    else container.appendChild(div);
  }

  function _secLabel(sec) {
    if (!sec) return "—";
    if (sec < 60) return sec + "s";
    return Math.floor(sec / 60) + "m";
  }

  return { init };
})();

window.Activity = Activity;
