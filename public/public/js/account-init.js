let accountWs = null;

async function init() {
  const session = await Auth.requireAuth("/login.html");
  if (!session) return;

  const jwt = session.access_token;

  await loadHistory(jwt);
  connectAccountWs(jwt);
}

async function loadHistory(jwt) {
  const { data, error } = await window.sb
    .from("bets")
    .select("*")
    .order("placed_at", { ascending: false })
    .limit(50);

  const container = document.getElementById("history-container");
  if (error || !data?.length) {
    container.innerHTML = `<p class="muted">No bets yet. <a href="/index.html">Place your first bet!</a></p>`;
    return;
  }

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Amount</th>
          <th>Payout</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(b => `
          <tr class="bet-${b.status}">
            <td>${new Date(b.placed_at).toLocaleString()}</td>
            <td>${b.amount.toLocaleString()}</td>
            <td>${b.potential_payout.toLocaleString()}</td>
            <td><span class="badge badge-${b.status}">${b.status}</span></td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function connectAccountWs(jwt) {
  fetch("/api/token").then(r => r.json()).then(({ wss_url }) => {
    const wsUrl = wss_url.replace("/ws/live", "/ws/account");
    accountWs = new WebSocket(`${wsUrl}?token=${encodeURIComponent(jwt)}`);

    const statusEl = document.getElementById("account-ws-status");
    const balanceEl = document.getElementById("balance-display");

    accountWs.onopen = () => {
      if (statusEl) { statusEl.textContent = "Live"; statusEl.className = "ws-status ws-ok"; }
    };

    accountWs.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "balance" && balanceEl) {
        balanceEl.textContent = data.balance.toLocaleString();
      }
      if (data.type === "bet_resolved") {
        Auth.getJwt().then(jwt => loadHistory(jwt));
      }
    };

    accountWs.onclose = () => {
      if (statusEl) { statusEl.textContent = "Disconnected"; statusEl.className = "ws-status ws-err"; }
    };
  }).catch(console.error);
}

document.getElementById("btn-logout")?.addEventListener("click", () => Auth.logout());

init();
