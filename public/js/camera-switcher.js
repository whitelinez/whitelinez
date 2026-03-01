/**
 * camera-switcher.js
 * Camera picker modal triggered by the CAMERAS banner tile.
 * Loads cameras from Supabase, grouped by area.
 * Switches between HLS/AI stream (primary) and ipcamlive iframe (others).
 */
const CameraSwitcher = (() => {
  let _cameras = [];
  let _aiAlias = null;
  let _activeAlias = null;
  let _modal = null;

  const _AI_SHOW = ['live-video', 'detection-canvas', 'zone-canvas', 'fps-overlay'];

  async function init() {
    try {
      const { data } = await window.sb
        .from('cameras')
        .select('name, area, ipcam_alias, player_host, is_active')
        .order('area', { ascending: true })
        .order('created_at', { ascending: true });

      if (!data?.length) return;
      _cameras = data;
      _aiAlias = _cameras.find(c => c.is_active)?.ipcam_alias || null;
      _activeAlias = _aiAlias;

      _buildIframe();
      _buildModal();
      _wireCameraTile();
    } catch {}
  }

  // ── Inject iframe into stream-wrapper ────────────────────────
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
  function _buildModal() {
    if (document.getElementById('cam-picker-modal')) return;

    const areas = {};
    _cameras.forEach(c => {
      const a = c.area || 'Other';
      if (!areas[a]) areas[a] = [];
      areas[a].push(c);
    });

    let gridHtml = '';
    Object.entries(areas).forEach(([area, cams]) => {
      gridHtml += `<div class="cp-area-label">${area}</div><div class="cp-area-grid">`;
      cams.forEach(c => {
        const isAI = c.is_active;
        gridHtml += `
          <button class="cp-cam-card${isAI ? ' cp-cam-ai' : ''}" data-alias="${c.ipcam_alias}">
            ${isAI ? '<span class="cp-ai-badge">AI LIVE</span>' : ''}
            <span class="cp-cam-name">${c.name}</span>
            <span class="cp-cam-area">${c.area || ''}</span>
          </button>`;
      });
      gridHtml += `</div>`;
    });

    const modal = document.createElement('div');
    modal.id = 'cam-picker-modal';
    modal.className = 'cam-picker-modal hidden';
    modal.innerHTML = `
      <div class="cam-picker-inner">
        <div class="cam-picker-head">
          <span class="cam-picker-title">CAMERA SELECT</span>
          <button class="cam-picker-close" aria-label="Close">✕</button>
        </div>
        <div class="cam-picker-grid">${gridHtml}</div>
      </div>`;

    document.body.appendChild(modal);
    _modal = modal;

    modal.querySelector('.cam-picker-close').addEventListener('click', _closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); });
    modal.querySelectorAll('.cp-cam-card').forEach(btn => {
      btn.addEventListener('click', () => {
        _switchTo(btn.dataset.alias);
        _closeModal();
      });
    });
  }

  // ── Wire the CAMERAS banner tile (rendered dynamically) ───────
  function _wireCameraTile() {
    // Use event delegation — tile is re-rendered by banners.js
    document.addEventListener('click', e => {
      if (e.target.closest('#bnr-camera-tile')) _openModal();
    });
  }

  function _openModal() {
    if (!_modal) return;
    _modal.classList.remove('hidden');
    // Highlight current camera
    _modal.querySelectorAll('.cp-cam-card').forEach(btn => {
      btn.classList.toggle('cp-cam-active', btn.dataset.alias === _activeAlias);
    });
  }

  function _closeModal() {
    _modal?.classList.add('hidden');
  }

  // ── Switch stream ─────────────────────────────────────────────
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

    // Hide offline overlay when on non-AI cam
    if (!isAI) document.getElementById('stream-offline-overlay')?.classList.add('hidden');

    // Update current cam name in stream UI
    const label = document.getElementById('active-cam-label');
    if (label) label.textContent = cam.name;

    window.dispatchEvent(new CustomEvent('camera:switched', { detail: { alias, isAI, cam } }));
  }

  function isOnAiCam() { return _activeAlias === _aiAlias; }

  return { init, isOnAiCam };
})();

window.CameraSwitcher = CameraSwitcher;
