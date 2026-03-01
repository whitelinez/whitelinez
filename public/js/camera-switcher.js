/**
 * camera-switcher.js
 * Camera picker modal triggered by the CAMERAS banner tile.
 * Live previews via stagger-loaded ipcamlive iframes.
 * Click-shield div over each preview captures clicks (iframes eat pointer events).
 */
const CameraSwitcher = (() => {
  let _cameras = [];
  let _aiAlias = null;
  let _activeAlias = null;
  let _modal = null;
  let _previewsLoaded = false;

  const _AI_SHOW = ['live-video', 'detection-canvas', 'zone-canvas', 'fps-overlay'];

  async function init() {
    try {
      const { data } = await window.sb
        .from('cameras')
        .select('id, name, area, ipcam_alias, player_host, is_active, quality_snapshot')
        .order('area', { ascending: true })
        .order('created_at', { ascending: true });

      if (!data?.length) return;
      _cameras = data;
      _aiAlias = _cameras.find(c => c.is_active)?.ipcam_alias || null;
      _activeAlias = _aiAlias;

      // Set header cam chip to human-readable name on load
      const activeCam = _cameras.find(c => c.ipcam_alias === _aiAlias);
      const camNameEl = document.getElementById('header-cam-name');
      if (camNameEl && activeCam) camNameEl.textContent = activeCam.name || activeCam.ipcam_alias;

      _buildIframe();
      _buildModal();
      _wireCameraTile();
      _wireNonAiOverlay();
      _loadFpsBadges();
    } catch {}
  }

  // ── Fetch FPS per camera from ml_detection_events ────────────
  async function _loadFpsBadges() {
    try {
      const since = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: rows } = await window.sb
        .from("ml_detection_events")
        .select("camera_id, captured_at")
        .gte("captured_at", since)
        .order("captured_at", { ascending: true });

      if (!rows?.length) return;

      // Group by camera_id, compute events/sec
      const groups = {};
      rows.forEach(r => {
        (groups[r.camera_id] = groups[r.camera_id] || []).push(r.captured_at);
      });

      // Also poll health for current AI FPS
      let aiFps = null;
      try {
        const h = await fetch("/api/health").then(r => r.json());
        aiFps = h?.ai_fps_estimate ?? null;
      } catch {}

      _cameras.forEach(cam => {
        const fpsEl = _modal?.querySelector(`.cp-cam-card[data-alias="${cam.ipcam_alias}"] .cp-fps-badge`);
        if (!fpsEl) return;

        let fps = null;
        if (cam.is_active && aiFps != null) {
          fps = Number(aiFps);
        } else {
          const ts = groups[cam.id];
          if (ts && ts.length >= 2) {
            const elapsed = (new Date(ts.at(-1)) - new Date(ts[0])) / 1000;
            if (elapsed > 0) fps = ts.length / elapsed;
          }
        }
        if (fps == null) return;
        // Human-friendly label instead of raw "x.x fps"
        const label = fps >= 8 ? 'Smooth' : fps >= 4 ? 'Live' : fps > 0 ? 'Slow' : null;
        if (!label) return;
        fpsEl.textContent = label;
        fpsEl.classList.remove("hidden");
      });
    } catch {}
  }

  // ── Inject full-cover iframe into stream-wrapper ──────────────
  function _buildIframe() {
    const wrapper = document.querySelector('.stream-wrapper');
    if (!wrapper || document.getElementById('camera-iframe')) return;
    const iframe = document.createElement('iframe');
    iframe.id = 'camera-iframe';
    iframe.className = 'camera-iframe';
    iframe.allow = 'autoplay';
    iframe.setAttribute('allowfullscreen', '');
    iframe.style.display = 'none';
    wrapper.insertBefore(iframe, document.getElementById('count-widget') || null);
  }

  // ── Build picker modal ────────────────────────────────────────
  function _qualityLabel(score) {
    if (score == null) return '';
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  }

  function _buildModal() {
    if (document.getElementById('cam-picker-modal')) return;

    // Flat grid — no area categories
    let gridHtml = '';
    _cameras.forEach(c => {
      const isAI = c.is_active;
      const q = c.quality_snapshot;
      const qScore = q?.quality_score != null ? Math.round(q.quality_score) : null;
      const qCls = qScore == null ? '' : qScore >= 60 ? 'cp-quality-good' : qScore >= 40 ? 'cp-quality-mid' : 'cp-quality-bad';
      const lightIcon = q?.lighting === 'night' ? '🌙' : q?.lighting === 'day' ? '☀' : '';
      const qualBadge = qScore != null
        ? `<span class="cp-quality-badge ${qCls}">${lightIcon ? `<span class="cp-light-icon">${lightIcon}</span>` : ''}${_qualityLabel(qScore)}</span>`
        : '';
      gridHtml += `
        <div class="cp-cam-card${isAI ? ' cp-cam-ai' : ''}" data-alias="${c.ipcam_alias}" tabindex="0" role="button" aria-label="${c.name}">
          <div class="cp-preview-wrap">
            <iframe class="cp-preview-iframe"
              data-alias="${c.ipcam_alias}"
              data-host="${c.player_host || 'g3'}"
              allow="autoplay"
              scrolling="no"
              frameborder="0"></iframe>
            <div class="cp-click-shield"></div>
            <div class="cp-preview-loader"><span></span></div>
          </div>
          <div class="cp-cam-info">
            ${isAI ? '<span class="cp-ai-badge"><span class="cp-ai-dot"></span>AI Live</span>' : ''}
            <span class="cp-cam-name">${c.name}</span>
            <div class="cp-cam-meta">
              <span class="cp-fps-badge hidden"></span>
              ${qualBadge}
            </div>
          </div>
        </div>`;
    });

    const modal = document.createElement('div');
    modal.id = 'cam-picker-modal';
    modal.className = 'cam-picker-modal hidden';
    modal.innerHTML = `
      <div class="cam-picker-inner">
        <div class="cam-picker-head">
          <div class="cam-picker-head-left">
            <span class="cam-picker-title">Live Cameras</span>
            <span class="cam-picker-count">${_cameras.length} feeds</span>
          </div>
          <button class="cam-picker-close" aria-label="Close">✕</button>
        </div>
        <div class="cam-picker-grid">${gridHtml}</div>
      </div>`;

    document.body.appendChild(modal);
    _modal = modal;

    modal.querySelector('.cam-picker-close').addEventListener('click', _closeModal);
    modal.addEventListener('click', e => {
      if (e.target === modal) { _closeModal(); return; }
      const card = e.target.closest('.cp-cam-card');
      if (card) { _switchTo(card.dataset.alias); _closeModal(); }
    });
    modal.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.cp-cam-card');
        if (card) { _switchTo(card.dataset.alias); _closeModal(); }
      }
      if (e.key === 'Escape') _closeModal();
    });
  }

  // ── Non-AI overlay ────────────────────────────────────────────
  function _wireNonAiOverlay() {
    const btn = document.getElementById("btn-go-ai-cam");
    if (!btn) return;
    // Populate AI camera name
    const aiCam = _cameras.find(c => c.is_active);
    const nameEl = document.getElementById("non-ai-cam-name");
    if (nameEl && aiCam?.name) nameEl.textContent = aiCam.name;
    btn.addEventListener("click", () => {
      if (_aiAlias) _switchTo(_aiAlias);
    });
  }

  function _setNonAiOverlay(visible) {
    document.getElementById("non-ai-overlay")?.classList.toggle("hidden", !visible);
  }

  // ── Wire the CAMERAS banner tile (rendered dynamically) ───────
  function _wireCameraTile() {
    document.addEventListener('click', e => {
      if (e.target.closest('#bnr-camera-tile')) _openModal();
    });
  }

  function _openModal() {
    if (!_modal) return;
    _modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Highlight current selection
    _modal.querySelectorAll('.cp-cam-card').forEach(card => {
      card.classList.toggle('cp-cam-active', card.dataset.alias === _activeAlias);
    });

    // Stagger-load previews (only once)
    if (!_previewsLoaded) {
      _previewsLoaded = true;
      _modal.querySelectorAll('.cp-preview-iframe').forEach((iframe, i) => {
        setTimeout(() => {
          const host = iframe.dataset.host || 'g3';
          const alias = iframe.dataset.alias;
          iframe.src = `https://${host}.ipcamlive.com/player/player.php?alias=${alias}&autoplay=1`;
          iframe.addEventListener('load', () => {
            iframe.closest('.cp-preview-wrap')?.classList.add('cp-preview-loaded');
          }, { once: true });
        }, i * 500);
      });
    }
  }

  function _closeModal() {
    _modal?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ── Switch main stream ────────────────────────────────────────
  function _switchTo(alias) {
    if (alias === _activeAlias) return;
    _activeAlias = alias;
    const cam = _cameras.find(c => c.ipcam_alias === alias);
    if (!cam) return;

    const iframe = document.getElementById('camera-iframe');
    const isAI = cam.is_active;

    _AI_SHOW.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = isAI ? '' : 'none';
    });

    if (isAI) {
      window.dispatchEvent(new CustomEvent('stream:switching', { detail: { alias } }));
      window.Stream?.setAlias(alias);
    }

    if (iframe) {
      if (isAI) {
        iframe.src = '';
        iframe.style.display = 'none';
      } else {
        const host = cam.player_host || 'g3';
        iframe.src = `https://${host}.ipcamlive.com/player/player.php?alias=${alias}&autoplay=1`;
        iframe.style.display = 'block';
      }
    }

    if (!isAI) document.getElementById('stream-offline-overlay')?.classList.add('hidden');
    _setNonAiOverlay(!isAI);

    // Hide AI-only widgets when viewing a non-AI camera
    document.getElementById('ml-hud')?.classList.toggle('hidden', !isAI);
    document.getElementById('count-widget')?.classList.toggle('hidden', !isAI);

    const label = document.getElementById('active-cam-label');
    if (label) label.textContent = cam.name;

    const camNameEl = document.getElementById('header-cam-name');
    if (camNameEl) camNameEl.textContent = cam.name || alias;

    window.dispatchEvent(new CustomEvent('camera:switched', {
      detail: { alias, cameraId: cam.id, name: cam.name, isAI }
    }));
  }

  function isOnAiCam() { return _activeAlias === _aiAlias; }

  return { init, isOnAiCam };
})();

window.CameraSwitcher = CameraSwitcher;
