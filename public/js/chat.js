/**
 * chat.js - Global chat via Supabase realtime.
 * Guests can read. Logged-in users can send.
 * Avatar and display names are sourced from public profiles table.
 */

const Chat = (() => {
  let _channel = null;
  let _presenceChannel = null;
  let _userSession = null;
  let _username = "User";
  const _profileByUserId = new Map();
  const _onlineUsers = new Map();
  const MAX_MESSAGES = 100;
  let _unread = 0;
  let _presenceInitialized = false;
  let _lastRoundEvent = null;
  let _boundRoundUpdates = false;

  function defaultAvatar(seed) {
    const src = String(seed || "whitelinez-user");
    let hash = 0;
    for (let i = 0; i < src.length; i += 1) hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    const hue2 = (hue + 28) % 360;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'>
      <defs><linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='hsl(${hue},66%,34%)'/>
        <stop offset='100%' stop-color='hsl(${hue2},74%,20%)'/>
      </linearGradient></defs>
      <rect width='96' height='96' rx='48' fill='url(#bg)'/>
      <circle cx='48' cy='48' r='41' fill='none' stroke='rgba(255,255,255,0.24)' stroke-width='1.5'/>
      <path d='M24 56l6-14h34l7 14' fill='none' stroke='#d8f8ff' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/>
      <rect x='20' y='56' width='56' height='12' rx='4' fill='none' stroke='#d8f8ff' stroke-width='3.2'/>
      <circle cx='34' cy='69' r='5' fill='none' stroke='#ffd600' stroke-width='2.6'/>
      <circle cx='62' cy='69' r='5' fill='none' stroke='#ffd600' stroke-width='2.6'/>
      <path d='M33 48h22' stroke='#7de3ff' stroke-width='2.2' stroke-linecap='round'/>
      <path d='M28 28h9M59 28h9M28 28v7M68 28v7' stroke='#ffd600' stroke-width='2' stroke-linecap='round'/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function isAllowedAvatarUrl(url) {
    if (!url || typeof url !== "string") return false;
    const u = url.trim();
    if (!u) return false;
    if (u.startsWith("data:image/")) return true;
    if (u.startsWith("blob:")) return true;
    if (u.startsWith("/")) return true;
    try {
      const parsed = new URL(u, window.location.origin);
      if (parsed.origin === window.location.origin) return true;
      if (parsed.hostname.endsWith(".supabase.co")) return true;
      return false;
    } catch {
      return false;
    }
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
    _subscribePresence();
    _bindTabIndicator();
    _bindRoundAnnouncements();
    _bindOnlineMentionClicks();
    _renderOnlineUi();

    document.getElementById("chat-send")?.addEventListener("click", send);
    document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  function _chatTabBtn() {
    return document.querySelector('.tab-btn[data-tab="chat"]');
  }

  function _isChatTabActive() {
    return _chatTabBtn()?.classList.contains("active");
  }

  function _renderUnread() {
    const btn = _chatTabBtn();
    const badge = document.getElementById("chat-tab-indicator");
    if (!btn || !badge) return;
    if (_unread > 0) {
      badge.textContent = _unread > 99 ? "99+" : String(_unread);
      badge.classList.remove("hidden");
      btn.classList.add("has-unread");
    } else {
      badge.classList.add("hidden");
      btn.classList.remove("has-unread");
    }
  }

  function _clearUnread() {
    _unread = 0;
    _renderUnread();
  }

  function _bindTabIndicator() {
    const btn = _chatTabBtn();
    if (btn) {
      btn.addEventListener("click", _clearUnread);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && _isChatTabActive()) _clearUnread();
    });
    window.addEventListener("focus", () => {
      if (_isChatTabActive()) _clearUnread();
    });
    _renderUnread();
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

  function _bindOnlineMentionClicks() {
    const list = document.getElementById("chat-online-users");
    if (!list || list.dataset.wired === "1") return;
    list.dataset.wired = "1";
    list.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mention]");
      if (!btn) return;
      _insertMention(btn.dataset.mention || "");
    });
  }

  function _insertMention(name) {
    const cleaned = String(name || "").replace(/\s+/g, "");
    if (!cleaned) return;
    const input = document.getElementById("chat-input");
    if (!input) return;
    const token = `@${cleaned}`;
    const existing = input.value.trim();
    input.value = existing ? `${existing} ${token} ` : `${token} `;
    input.focus();
  }

  function _normalizeName(v) {
    return String(v || "").trim().toLowerCase();
  }

  function _renderOnlineUi() {
    const countEl = document.getElementById("chat-online-count");
    const listEl = document.getElementById("chat-online-users");
    const online = [..._onlineUsers.values()];
    if (countEl) countEl.textContent = `${online.length} online`;
    if (!listEl) return;
    if (!online.length) {
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = online
      .slice(0, 10)
      .map((name) => `<button type="button" class="chat-online-user" data-mention="${escAttr(name)}">@${esc(name)}</button>`)
      .join("");
  }

  function _subscribePresence() {
    if (_presenceChannel) window.sb.removeChannel(_presenceChannel);
    _presenceInitialized = false;
    _onlineUsers.clear();
    _renderOnlineUi();

    const presenceKey = _userSession?.user?.id || `guest-${Math.random().toString(36).slice(2)}`;
    _presenceChannel = window.sb
      .channel("chat-presence", { config: { presence: { key: presenceKey } } })
      .on("presence", { event: "sync" }, () => {
        const state = _presenceChannel?.presenceState?.() || {};
        const nowOnline = new Map();

        Object.values(state).forEach((entries) => {
          if (!Array.isArray(entries)) return;
          entries.forEach((entry) => {
            const uid = String(entry?.user_id || "").trim();
            const uname = String(entry?.username || "").trim();
            if (!uid || !uname) return; // only logged-in tracked users
            if (!nowOnline.has(uid)) nowOnline.set(uid, uname);
          });
        });

        if (_presenceInitialized) {
          for (const [uid, name] of nowOnline.entries()) {
            if (!_onlineUsers.has(uid)) _addSystemMessage(`${name} joined`);
          }
        }

        _onlineUsers.clear();
        nowOnline.forEach((name, uid) => _onlineUsers.set(uid, name));
        _renderOnlineUi();
        _presenceInitialized = true;
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        if (!_userSession?.user?.id) return;
        await _presenceChannel.track({
          user_id: _userSession.user.id,
          username: _username,
          online_at: new Date().toISOString(),
        });
      });
  }

  function _bindRoundAnnouncements() {
    if (_boundRoundUpdates) return;
    _boundRoundUpdates = true;
    window.addEventListener("round:update", (e) => {
      const round = e.detail || null;
      const current = round ? {
        id: round.id || null,
        status: String(round.status || "").toLowerCase(),
        opens_at: round.opens_at || null,
      } : null;
      const prev = _lastRoundEvent;
      const becameOpen = !!current
        && current.status === "open"
        && !!prev
        && (prev.id !== current.id || prev.status !== "open");
      if (becameOpen) {
        _addSystemMessage("New round started. Bets are now open.");
      }
      _lastRoundEvent = current;
    });
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

          const isOwn = !!_userSession?.user?.id && msg.user_id === _userSession.user.id;
          if (!isOwn && !_isChatTabActive()) {
            _unread += 1;
            _renderUnread();
          } else if (_isChatTabActive()) {
            _clearUnread();
          }
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

    if (msg.system) {
      const time = msg.created_at
        ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";
      const div = document.createElement("div");
      div.className = "chat-msg system";
      div.innerHTML = `<span>${esc(msg.content || "")}</span>${time ? `<span class="chat-time">${time}</span>` : ""}`;
      container.appendChild(div);
      return;
    }

    const profile = msg.user_id ? _profileByUserId.get(msg.user_id) : null;
    const username = profile?.username || msg.username || "User";
    const avatar = isAllowedAvatarUrl(profile?.avatar_url)
      ? profile.avatar_url
      : defaultAvatar(msg.user_id || username);
    const time = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

    const div = document.createElement("div");
    div.className = "chat-msg";
    div.innerHTML = `
      <img class="chat-avatar" src="${escAttr(avatar)}" alt="${escAttr(username)}" />
      <div class="chat-body">
        <div class="chat-head"><span class="chat-user">${esc(username)}</span><span class="chat-time">${time}</span></div>
        <div class="chat-text">${_formatContent(msg.content)}</div>
      </div>
    `;
    container.appendChild(div);
  }

  function _formatContent(content) {
    const raw = esc(content || "");
    const self = _normalizeName(_username);
    return raw.replace(/(^|[\s(])@([a-zA-Z0-9_.-]{1,32})/g, (full, lead, mention) => {
      const cls = _normalizeName(mention) === self ? "chat-mention chat-mention-self" : "chat-mention";
      return `${lead}<span class="${cls}">@${mention}</span>`;
    });
  }

  function _addSystemMessage(text) {
    renderMsg({
      system: true,
      content: text,
      created_at: new Date().toISOString(),
    });
    _scrollToBottom();
    if (!_isChatTabActive()) {
      _unread += 1;
      _renderUnread();
    }
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
