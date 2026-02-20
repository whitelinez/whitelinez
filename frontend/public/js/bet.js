/**
 * bet.js — Place bet via /api/bets/place (Vercel proxy).
 * Attaches the user's Supabase JWT automatically.
 */

const Bet = (() => {
  let _modalMarketId = null;
  let _modalOdds = null;

  function openModal(marketId, label, odds) {
    _modalMarketId = marketId;
    _modalOdds = odds;

    const modal = document.getElementById("bet-modal");
    const round = Markets.getCurrentRound();
    if (!modal || !round) return;

    document.getElementById("modal-market-label").textContent = label;
    document.getElementById("modal-odds").textContent = parseFloat(odds).toFixed(2) + "x";
    document.getElementById("modal-amount").value = "";
    document.getElementById("modal-payout").textContent = "—";
    document.getElementById("modal-error").textContent = "";
    modal.classList.remove("hidden");
    document.getElementById("modal-amount").focus();
  }

  function closeModal() {
    document.getElementById("bet-modal")?.classList.add("hidden");
    _modalMarketId = null;
    _modalOdds = null;
  }

  function updatePayout() {
    const amount = parseInt(document.getElementById("modal-amount")?.value ?? 0, 10);
    const payoutEl = document.getElementById("modal-payout");
    if (!payoutEl) return;
    if (amount > 0 && _modalOdds) {
      payoutEl.textContent = Math.floor(amount * _modalOdds).toLocaleString();
    } else {
      payoutEl.textContent = "—";
    }
  }

  async function submit() {
    const amountEl = document.getElementById("modal-amount");
    const errorEl = document.getElementById("modal-error");
    const submitBtn = document.getElementById("modal-submit");

    const amount = parseInt(amountEl?.value ?? 0, 10);
    const round = Markets.getCurrentRound();

    if (!amount || amount <= 0) {
      if (errorEl) errorEl.textContent = "Enter a valid amount";
      return;
    }
    if (!round) {
      if (errorEl) errorEl.textContent = "No active round";
      return;
    }

    const jwt = await Auth.getJwt();
    if (!jwt) {
      window.location.href = "/login.html";
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (errorEl) errorEl.textContent = "";

    try {
      const res = await fetch("/api/bets/place", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          round_id: round.id,
          market_id: _modalMarketId,
          amount,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (errorEl) errorEl.textContent = data.detail || "Bet failed";
        return;
      }

      // Success
      closeModal();
      window.dispatchEvent(new CustomEvent("bet:placed", { detail: data }));
      showToast(`Bet placed! Potential payout: ${data.potential_payout.toLocaleString()} credits`);
    } catch (e) {
      if (errorEl) errorEl.textContent = "Network error — try again";
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  return { openModal, closeModal, updatePayout, submit };
})();

window.Bet = Bet;
