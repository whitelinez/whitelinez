/**
 * demo.js — Demo mode: plays a pre-recorded video with frame-synced detection replay.
 *
 * Flow:
 *   1. activate()  → fetch /api/demo manifest → load events JSON → swap <video> src
 *   2. RAF loop    → on each video timeupdate, dispatch stored count:update events
 *                    matching video.currentTime
 *   3. deactivate() → destroy HLS → restore live stream → dispatch scene:reset
 *
 * Events dispatched during replay are identical in shape to live WebSocket events,
 * so all existing overlays (detection, zone, count widget) work without changes.
 */

import { Stream } from './stream.js';

let _active      = false;
let _events      = [];      // sorted [{t, ...count:update payload}]
let _eventIdx    = 0;       // next event index to dispatch
let _lastVidTime = -1;      // previous video.currentTime, for loop detection
let _rafId       = null;
let _videoEl     = null;
let _manifest    = null;

const DEMO_BTN_ID   = 'header-demo-btn';
const DEMO_BADGE_ID = 'stream-demo-badge';

// ── Public API ────────────────────────────────────────────────────────────────

export const Demo = { activate, deactivate, isActive: () => _active, getManifest: () => _manifest };

export async function activate() {
  if (_active) return;

  // 1. Fetch manifest
  let manifest;
  try {
    const res = await fetch('/api/demo');
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    console.warn('[Demo] Failed to fetch manifest:', e);
    _showToast('Demo not available yet — record first');
    return;
  }

  if (!manifest?.available) {
    _showToast('No demo recording found yet');
    return;
  }
  _manifest = manifest;

  // 2. Load events JSON
  try {
    const res = await fetch(manifest.events_url);
    if (!res.ok) throw new Error(`events ${res.status}`);
    _events = await res.json();
  } catch (e) {
    console.warn('[Demo] Failed to load events:', e);
    _showToast('Demo events unavailable');
    return;
  }

  // 3. Swap stream to demo video
  _videoEl = document.getElementById('live-video');
  if (!_videoEl) return;

  Stream.destroy();
  _videoEl.src    = manifest.video_url;
  _videoEl.loop   = true;
  _videoEl.muted  = true;
  _videoEl.playsInline = true;
  _videoEl.load();
  _videoEl.play().catch(() => {});

  // 4. Reset replay state
  _eventIdx    = 0;
  _lastVidTime = -1;
  _active      = true;

  // 5. Dispatch scene reset so overlays/count reset
  window.dispatchEvent(new CustomEvent('scene:reset'));

  // 6. Start replay loop
  _rafId = requestAnimationFrame(_replayTick);

  // 7. Update UI
  _updateUI(true);
}

export function deactivate() {
  if (!_active) return;
  _active = false;

  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

  // Restore HLS live stream
  if (_videoEl) {
    _videoEl.pause();
    _videoEl.removeAttribute('src');
    _videoEl.loop = false;
    _videoEl.load();
    Stream.init(_videoEl);
  }

  _events   = [];
  _eventIdx = 0;
  _manifest = null;

  window.dispatchEvent(new CustomEvent('scene:reset'));
  _updateUI(false);
}

// ── Replay tick ───────────────────────────────────────────────────────────────

function _replayTick() {
  if (!_active) return;
  _rafId = requestAnimationFrame(_replayTick);

  if (!_videoEl || _videoEl.paused || _videoEl.readyState < 2) return;

  const vt = _videoEl.currentTime;

  // Detect video loop (time jumped backward significantly)
  if (_lastVidTime > 0 && vt < _lastVidTime - 1.0) {
    _eventIdx = 0;
    window.dispatchEvent(new CustomEvent('scene:reset'));
  }
  _lastVidTime = vt;

  // Dispatch all events whose timestamp ≤ current video time
  while (_eventIdx < _events.length && _events[_eventIdx].t <= vt) {
    const ev = _events[_eventIdx];
    window.dispatchEvent(new CustomEvent('count:update', { detail: ev }));
    _eventIdx++;
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function _updateUI(on) {
  const btn = document.getElementById(DEMO_BTN_ID);
  if (btn) {
    btn.textContent  = on ? 'EXIT DEMO' : 'DEMO';
    btn.classList.toggle('demo-btn--active', on);
  }

  const badge = document.getElementById(DEMO_BADGE_ID);
  if (badge) badge.classList.toggle('hidden', !on);
}

function _showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast toast-info';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
