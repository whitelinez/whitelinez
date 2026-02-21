/**
 * chat.js — Global chat via Supabase realtime (postgres_changes on messages).
 * Guests can read. Logged-in users can send.
 */

const Chat = (() => {
  let _channel = null;
  let _userSession = null;
  let _username = "User";
  const MAX_MESSAGES = 100;

  function init(session) {
    _userSession = session;
    const hint = document.getElementById("chat-login-hint");
    const inputRow = document.querySelector(".chat-input-row");

    if (session) {
      // Fetch username from profile
      _username = session.user?.user_metadata?.username || session.user?.email?.split("@")[0] || "User";
      if (hint) hint.classList.add("hidden");
      if (inputRow) inputRow.style.display = "";
    } else {
      if (hint) hint.classList.remove("hidden");
      if (inputRow) inputRow.style.display = "none";
    }

    _loadHistory();
    _subscribe();

    document.getElementById("chat-send")?.addEventListener("click", send);
    document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  async function _loadHistory() {
    try {
      const { data } = await window.sb
        .from("messages")
        .select("username, content, created_at")
        .order("created_at", { ascending: true })
        .limit(50);
      if (data) data.forEach(renderMsg);
      _scrollToBottom();
    } catch (e) {
      console.warn("[Chat] History load failed:", e);
    }
  }

  function _subscribe() {
    if (_channel) {
      window.sb.removeChannel(_channel);
    }
    _channel = window.sb
      .channel("chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          renderMsg(payload.new);
          _scrollToBottom();
        }
      )
      .subscribe();
  }

  function renderMsg(msg) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    // Trim if over limit
    while (container.children.length >= MAX_MESSAGES) {
      container.removeChild(container.firstChild);
    }

    const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const div = document.createElement("div");
    div.className = "chat-msg";
    div.innerHTML = `<span class="chat-user">${esc(msg.username || "User")}</span><span class="chat-text">${esc(msg.content)}</span><span class="chat-time">${time}</span>`;
    container.appendChild(div);
  }

  function _scrollToBottom() {
    const container = document.getElementById("chat-messages");
    if (container) container.scrollTop = container.scrollHeight;
  }

  async function send() {
    if (!_userSession) return;
    const input = document.getElementById("chat-input");
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    input.value = "";

    try {
      const { error } = await window.sb.from("messages").insert({
        user_id: _userSession.user.id,
        username: _username,
        content,
      });
      if (error) throw error;
    } catch (e) {
      console.error("[Chat] Send failed:", e);
      input.value = content; // restore on failure
    }
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init };
})();

window.Chat = Chat;
