/**
 * activity.js — Global bet activity feed via Supabase realtime.
 * Anonymized: shows "Someone bet X credits — Exact: N cars in 30s"
 */

const Activity = (() => {
  let _channel = null;
  const MAX_ITEMS = 50;

  function init() {
    _loadHistory();
    _subscribe();
  }

  async function _loadHistory() {
    try {
      const { data } = await window.sb
        .from("bets")
        .select("amount, bet_type, exact_count, vehicle_class, window_duration_sec, placed_at")
        .order("placed_at", { ascending: false })
        .limit(20);
      if (data) {
        const reversed = [...data].reverse();
        reversed.forEach(renderItem);
      }
    } catch (e) {
      console.warn("[Activity] History load failed:", e);
    }
  }

  function _subscribe() {
    if (_channel) window.sb.removeChannel(_channel);

    _channel = window.sb
      .channel("activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bets" },
        (payload) => {
          renderItem(payload.new, true);
        }
      )
      .subscribe();
  }

  function renderItem(bet, prepend = false) {
    const container = document.getElementById("activity-feed");
    if (!container) return;

    // Clear placeholder
    const placeholder = container.querySelector(".loading");
    if (placeholder) placeholder.remove();

    // Trim
    while (container.children.length >= MAX_ITEMS) {
      if (prepend) container.removeChild(container.lastChild);
      else container.removeChild(container.firstChild);
    }

    const time = bet.placed_at
      ? new Date(bet.placed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

    let desc = "";
    if (bet.bet_type === "exact_count") {
      const cls = bet.vehicle_class ? `${bet.vehicle_class}s` : "vehicles";
      const win = _secLabel(bet.window_duration_sec);
      desc = `Exact: <strong>${bet.exact_count} ${cls}</strong> in ${win}`;
    } else {
      desc = `Market bet`;
    }

    const div = document.createElement("div");
    div.className = "activity-item";
    div.innerHTML = `
      <span class="act-time">${time}</span>
      Someone bet <strong>${(bet.amount || 0).toLocaleString()} credits</strong>
      — ${desc}
    `;

    if (prepend) {
      container.prepend(div);
    } else {
      container.appendChild(div);
    }
  }

  function _secLabel(sec) {
    if (!sec) return "—";
    if (sec < 60) return sec + "s";
    return Math.floor(sec / 60) + "m";
  }

  return { init };
})();

window.Activity = Activity;
