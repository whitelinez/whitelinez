/**
 * activity.js — Bet activity broadcaster + leaderboard loader.
 * Dispatches `activity:bet` events consumed by chat.js (main chat + stream overlay).
 */

const Activity = (() => {
  let _channel = null;

  function init() {
    _loadHistory();
    _subscribe();
  }

  async function _loadHistory() {
    try {
      const { data, error } = await window.sb
        .from("bets")
        .select("amount, bet_type, exact_count, vehicle_class, window_duration_sec, placed_at")
        .order("placed_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      if (!data?.length) return;
      // Dispatch in chronological order (oldest first = natural chat flow)
      [...data].reverse().forEach(bet => _dispatch(bet));
    } catch (e) {
      console.warn("[Activity] History load failed:", e);
    }
  }

  function _subscribe() {
    if (_channel) window.sb.removeChannel(_channel);
    _channel = window.sb
      .channel("activity")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bets" },
        (payload) => { _dispatch(payload.new, true); }
      )
      .subscribe();
  }

  function _dispatch(bet, isNew = false) {
    window.dispatchEvent(new CustomEvent("activity:bet", { detail: { ...bet, isNew } }));
  }

  // ── Leaderboard ───────────────────────────────────────────────
  function _esc(v) {
    return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  async function loadLeaderboard() {
    const container = document.getElementById("leaderboard-list");
    if (!container) return;
    container.innerHTML = `<div class="lb-loading"><span class="skeleton" style="height:36px;border-radius:8px;display:block;margin-bottom:6px;"></span><span class="skeleton" style="height:36px;border-radius:8px;display:block;margin-bottom:6px;"></span><span class="skeleton" style="height:36px;border-radius:8px;display:block;"></span></div>`;

    try {
      const { data: balances, error } = await window.sb
        .from("user_balances")
        .select("user_id, balance")
        .order("balance", { ascending: false })
        .limit(20);

      if (error) throw error;
      if (!balances?.length) {
        container.innerHTML = `<div class="empty-state">No players yet.<br><span>Be the first to make a guess.</span></div>`;
        return;
      }

      // Try to resolve usernames from profiles
      const userIds = balances.map(b => b.user_id).filter(Boolean);
      let nameMap = {};
      try {
        const { data: profiles } = await window.sb
          .from("profiles")
          .select("user_id, username")
          .in("user_id", userIds);
        (profiles || []).forEach(p => { nameMap[p.user_id] = p.username; });
      } catch { /* profiles table may not exist — graceful */ }

      const medals = ["🥇", "🥈", "🥉"];
      container.innerHTML = balances.map((b, i) => {
        const name = nameMap[b.user_id] || ("Player " + String(b.user_id || "").slice(0, 5));
        const rank = i < 3 ? `<span class="lb-medal">${medals[i]}</span>` : `<span class="lb-rank-num">#${i + 1}</span>`;
        const topClass = i < 3 ? ` lb-row-top lb-row-top-${i}` : "";
        return `
          <div class="lb-row${topClass}">
            ${rank}
            <span class="lb-name">${_esc(name)}</span>
            <span class="lb-balance">${Number(b.balance || 0).toLocaleString()} pts</span>
          </div>`;
      }).join("");
    } catch (e) {
      console.error("[Activity] Leaderboard load failed:", e);
      container.innerHTML = `<div class="empty-state">Could not load leaderboard.<br><span>${_esc(e?.message || "")}</span></div>`;
    }
  }

  return { init, loadLeaderboard };
})();

window.Activity = Activity;
