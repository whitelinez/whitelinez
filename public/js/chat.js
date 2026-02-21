/**
 * chat.js - Global chat via Supabase realtime.
 * Guests can read. Logged-in users can send.
 * Avatar and display names are sourced from public profiles table.
 */

const Chat = (() => {
  let _channel = null;
  let _userSession = null;
  let _username = "User";
  const _profileByUserId = new Map();
  const MAX_MESSAGES = 100;

  function defaultAvatar(seed) {
    const safe = encodeURIComponent(seed || "whitelinez-user");
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${safe}&backgroundColor=1e222b,0d0f14`;
  }

  function init(session) {
    _userSession = session;
    const hint = document.getElementById("chat-login-hint");
    const inputRow = document.querySelector(".chat-input-row");

    if (session) {
      _username = session.user?.user_metadata?.username
        || session.user?.email?.split("@")[0]
        || "User";
      const ownAvatar = session.user?.user_metadata?.avatar_url || "";
      _profileByUserId.set(session.user.id, {
        username: _username,
        avatar_url: ownAvatar,
      });
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

  async function _loadProfiles(userIds) {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return;

    try {
      const { data, error } = await window.sb
        .from("profiles")
        .select("user_id, username, avatar_url")
        .in("user_id", ids);
      if (error || !Array.isArray(data)) return;
      for (const p of data) {
        _profileByUserId.set(p.user_id, {
          username: p.username || "User",
          avatar_url: p.avatar_url || "",
        });
      }
    } catch {
      // profiles table may not exist yet
    }
  }

  async function _loadHistory() {
    try {
      const { data, error } = await window.sb
        .from("messages")
        .select("user_id, username, content, created_at")
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) throw error;

      await _loadProfiles((data || []).map((m) => m.user_id));

      const container = document.getElementById("chat-messages");
      if (!container) return;
      container.innerHTML = "";

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
        async (payload) => {
          const container = document.getElementById("chat-messages");
          const empty = container?.querySelector(".empty-state");
          if (empty) empty.remove();

          const msg = payload.new || {};
          if (msg.user_id && !_profileByUserId.has(msg.user_id)) {
            await _loadProfiles([msg.user_id]);
          }

          renderMsg(msg);
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

    const profile = msg.user_id ? _profileByUserId.get(msg.user_id) : null;
    const username = profile?.username || msg.username || "User";
    const avatar = profile?.avatar_url || defaultAvatar(msg.user_id || username);
    const time = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

    const div = document.createElement("div");
    div.className = "chat-msg";
    div.innerHTML = `
      <img class="chat-avatar" src="${escAttr(avatar)}" alt="${escAttr(username)}" />
      <div class="chat-body">
        <div class="chat-head"><span class="chat-user">${esc(username)}</span><span class="chat-time">${time}</span></div>
        <div class="chat-text">${esc(msg.content)}</div>
      </div>
    `;
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
      .replace(/\"/g, "&quot;");
  }

  function escAttr(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/\"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  return { init };
})();

window.Chat = Chat;