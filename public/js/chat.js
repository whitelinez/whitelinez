/**
 * chat.js — Global chat via Supabase realtime (postgres_changes on messages).
 * Guests can read. Logged-in users can send.
 */

const Chat = (() => {
  let _channel = null;
  let _userSession = null;
  let _username = "User";
  let _historyLoaded = false;
  const MAX_MESSAGES = 100;

  function init(session) {
    _userSession = session;
    const hint = document.getElementById("chat-login-hint");
    const inputRow = document.querySelector(".chat-input-row");

    if (session) {
      _username = session.user?.user_metadata?.username
        || session.user?.email?.split("@")[0]
        || "User";
      hint?.classList.add("hidden");
      if (inputRow) inputRow.style.display = "";
    } else {
      hint?.classList.remove("hidden");
      if (inputRow) inputRow.style.display = "none";
    }

    _showSkeleton();
    _loadHistory();
    _subscribe();

    document.getElementById("chat-send")?.addEventListener("click", send);
    document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  function _showSkeleton() {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    container.innerHTML = Array(5).fill(
      `<div class="skeleton" style="height:36px;border-radius:6px;"></div>`
    ).join("");
  }

  function _showEmpty() {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    container.innerHTML = `<div class="empty-state">No messages yet.<br><span>Start the conversation.</span></div>`;
  }

  async function _loadHistory() {
    try {
      const { data, error } = await window.sb
        .from("messages")
        .select("username, content, created_at")
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) throw error;

      const container = document.getElementById("chat-messages");
      if (!container) return;
      container.innerHTML = ""; // clear skeleton
      _historyLoaded = true;

      if (!data || data.length === 0) {
        _showEmpty();
        return;
      }

      data.forEach(renderMsg);
      _scrollToBottom();
    } catch (e) {
      console.warn("[Chat] History load failed:", e);
      const container = document.getElementById("chat-messages");
      if (container) {
        container.innerHTML = `<div class="empty-state">Chat unavailable.<br><span>Run SQL migrations to enable chat.</span></div>`;
      }
    }
  }

  function _subscribe() {
    if (_channel) window.sb.removeChannel(_channel);
    _channel = window.sb
      .channel("chat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          // Clear empty state on first real message
          const container = document.getElementById("chat-messages");
          const empty = container?.querySelector(".empty-state");
          if (empty) empty.remove();

          renderMsg(payload.new);
          _scrollToBottom();
        }
      )
      .subscribe();
  }

  function renderMsg(msg) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    while (container.children.length >= MAX_MESSAGES) {
      container.removeChild(container.firstChild);
    }

    const time = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

    const div = document.createElement("div");
    div.className = "chat-msg";
    div.innerHTML = `<span class="chat-user">${esc(msg.username || "User")}</span><span class="chat-text">${esc(msg.content)}</span><span class="chat-time">${time}</span>`;
    container.appendChild(div);
  }

  function _scrollToBottom() {
    const c = document.getElementById("chat-messages");
    if (c) c.scrollTop = c.scrollHeight;
  }

  async function send() {
    if (!_userSession) return;
    const input = document.getElementById("chat-input");
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    input.value = "";
    input.disabled = true;

    try {
      const { error } = await window.sb.from("messages").insert({
        user_id: _userSession.user.id,
        username: _username,
        content,
      });
      if (error) throw error;
    } catch (e) {
      console.error("[Chat] Send failed:", e);
      input.value = content;
    } finally {
      input.disabled = false;
      input.focus();
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
