/**
 * demo.js — Demo mode overlay: plays a pre-recorded video with frame-synced
 * YOLO detection replay drawn directly on a canvas overlay.
 *
 * Flow:
 *   1. activate()  → fetch /api/demo manifest → load events JSON
 *                  → open #demo-overlay → set <video> src → start RAF loop
 *   2. RAF loop    → on each video.currentTime advance, dispatch count:update
 *                    events matching timestamps AND draw detection boxes
 *   3. deactivate() → hide overlay → cancel RAF → reset state
 *
 * The #demo-overlay is fully self-contained — the live stream is untouched.
 */

import { getContentBounds, contentToPixel } from '../utils/coord-utils.js';
import { Stream } from './stream.js';
import { Counter } from './counter.js';
import { DetectionOverlay } from '../overlays/detection-overlay.js';

let _active      = false;
let _events      = [];      // sorted [{t, ...count:update payload}]
let _eventIdx    = 0;       // next event index to dispatch
let _lastVidTime = -1;      // previous video.currentTime, for loop detection
let _rafId       = null;
let _videoEl     = null;
let _canvasEl    = null;
let _ctx         = null;
let _manifest    = null;
let _latestDets  = [];      // detections from current event frame

// Tripwire state
let _tripLine    = null;    // {x1,y1,x2,y2} normalised content coords, or null
let _drawMode    = false;
let _drawStart   = null;    // {x,y} normalised, while dragging
let _tripFlash   = false;
let _tripFlashTimer = null;
let _prevTotal   = 0;       // for detecting new crossings

const DEMO_BTN_ID   = 'header-demo-btn';
const DEMO_BADGE_ID = 'stream-demo-badge';

const CLS_COLORS = {
  car:        '#29B6F6',
  truck:      '#FF7043',
  bus:        '#AB47BC',
  motorcycle: '#FFD600',
};

// ── Preloader controller ──────────────────────────────────────────────────────
const _dpl = {
  el:    () => document.getElementById('demo-preloader'),
  pct:   () => document.getElementById('demo-pl-pct'),
  bar:   () => document.getElementById('demo-pl-bar'),
  label: () => document.getElementById('demo-pl-label'),
  show() {
    const e = this.el(); if (!e) return;
    e.classList.remove('hidden', 'fading');
  },
  set(pct, label) {
    const p = pct + '%';
    const pe = this.pct(); if (pe) pe.textContent = p;
    const be = this.bar(); if (be) be.style.width  = p;
    const le = this.label(); if (le && label) le.textContent = label;
  },
  hide() {
    const e = this.el(); if (!e) return;
    e.classList.add('fading');
    setTimeout(() => e.classList.add('hidden'), 380);
  },
};

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Public API ────────────────────────────────────────────────────────────────

export const Demo = { activate, deactivate, isActive: () => _active, getManifest: () => _manifest };

export async function activate() {
  if (_active) return;

  // Show preloader immediately so user sees feedback right away
  _dpl.show();
  _dpl.set(0, 'Initialising…');
  await _wait(250);

  // 1. Fetch manifest
  _dpl.set(20, 'Checking demo archive…');
  await _wait(300);
  let manifest = null;
  try {
    const res = await fetch('/api/demo');
    if (res.ok) manifest = await res.json();
  } catch (e) {
    console.warn('[Demo] Failed to fetch manifest:', e);
  }

  _dpl.set(45, 'Loading recording manifest…');
  await _wait(350);

  const hasRecording = Boolean(manifest?.available);

  // 2. Load events JSON (only if recording available)
  if (hasRecording) {
    try {
      _dpl.set(60, 'Fetching detection events…');
      await _wait(250);
      const res = await fetch(manifest.events_url);
      if (!res.ok) throw new Error(`events ${res.status}`);
      _events = await res.json();
      _manifest = manifest;
    } catch (e) {
      console.warn('[Demo] Failed to load events:', e);
      // treat as no recording
      _events = [];
      _manifest = null;
    }
  }

  _dpl.set(85, 'Preparing replay…');
  await _wait(400);
  _dpl.set(100, 'Opening demo…');
  await _wait(320);

  // 3. Open overlay
  const overlay = document.getElementById('demo-overlay');
  if (!overlay) { _dpl.hide(); return; }

  _active = true;

  if (hasRecording && _events.length > 0) {
    // Show video area, hide no-content
    const videoArea = document.getElementById('demo-video-area');
    const noContent = document.getElementById('demo-no-content');
    if (videoArea) videoArea.classList.remove('hidden');
    if (noContent) noContent.classList.add('hidden');

    // Set up video
    _videoEl  = document.getElementById('demo-video');
    _canvasEl = document.getElementById('demo-canvas');
    if (_videoEl && _canvasEl) {
      _videoEl.src         = manifest.video_url;
      _videoEl.loop        = true;
      _videoEl.muted       = true;
      _videoEl.playsInline = true;
      _videoEl.load();
      _videoEl.play().catch(() => {});

      _ctx = _canvasEl.getContext('2d');
      _syncCanvasSize();
      window.addEventListener('resize', _syncCanvasSize);
      if (window.ResizeObserver) new ResizeObserver(_syncCanvasSize).observe(_videoEl);
      _videoEl.addEventListener('loadedmetadata', _syncCanvasSize);
    }

    // Reset replay state
    _eventIdx    = 0;
    _lastVidTime = -1;
    _latestDets  = [];

    _rafId = requestAnimationFrame(_replayTick);
  } else {
    // No recording — show no-content state
    const videoArea = document.getElementById('demo-video-area');
    const noContent = document.getElementById('demo-no-content');
    if (videoArea) videoArea.classList.add('hidden');
    if (noContent) noContent.classList.remove('hidden');
  }

  // Pause live AI stream — flush stale detection queue, demo owns the canvas now
  Counter.pause();
  DetectionOverlay.clearDetections();

  overlay.classList.remove('hidden');
  _dpl.hide();
  _updateUI(true);
  _initSidebar();
  _initTripwire();
}

export function deactivate() {
  if (!_active) return;
  _active = false;

  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

  // Hide overlay and reset content areas
  const overlay = document.getElementById('demo-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.getElementById('demo-video-area')?.classList.add('hidden');
  document.getElementById('demo-no-content')?.classList.add('hidden');

  if (_videoEl) {
    _videoEl.pause();
    _videoEl.removeAttribute('src');
    _videoEl.load();
    _videoEl = null;
  }

  // Clear canvas
  if (_ctx && _canvasEl) {
    _ctx.clearRect(0, 0, _canvasEl.width, _canvasEl.height);
  }
  _ctx = null;
  _canvasEl = null;

  window.removeEventListener('resize', _syncCanvasSize);

  _events     = [];
  _eventIdx   = 0;
  _latestDets = [];
  _manifest   = null;
  _teardownGuess();
  _teardownTripwire();

  // Reset count HUD
  const val = document.getElementById('demo-count-val');
  if (val) val.textContent = '—';

  // Restore live stream + AI — HLS may have dropped while demo was open.
  // Stream.init() destroys any stale instance and reconnects immediately.
  // Counter.resume() reconnects the WebSocket so live count:update events flow again.
  const liveVideo = document.getElementById('live-video');
  if (liveVideo) Stream.init(liveVideo).catch(() => {});
  Counter.resume();

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
    _eventIdx   = 0;
    _latestDets = [];
    _prevTotal  = 0;
    window.dispatchEvent(new CustomEvent('scene:reset'));
  }
  _lastVidTime = vt;

  // Dispatch all events whose timestamp ≤ current video time
  let dispatched = 0;
  while (_eventIdx < _events.length && _events[_eventIdx].t <= vt) {
    const ev = _events[_eventIdx];
    // Use demo:count — NOT count:update — so DetectionOverlay/ZoneOverlay
    // on the live canvas never receive demo events and don't render stale boxes.
    window.dispatchEvent(new CustomEvent('demo:count', { detail: ev }));
    // Keep latest detections for canvas drawing
    if (ev.detections) _latestDets = ev.detections;
    // Update count HUD
    const total = Number(ev.total ?? ev.count_in ?? 0);
    const valEl = document.getElementById('demo-count-val');
    if (valEl) valEl.textContent = total.toLocaleString();
    // Flash tripwire when count increases (new vehicle crossing)
    if (_tripLine && total > _prevTotal) _tripFlashOn();
    _prevTotal = Math.max(_prevTotal, total);
    _eventIdx++;
    dispatched++;
  }

  // Redraw detection boxes + tripwire on every frame
  _drawDetections(_latestDets);
  _drawTripwire();
}

// ── Detection canvas drawing ──────────────────────────────────────────────────

function _syncCanvasSize() {
  if (!_videoEl || !_canvasEl) return;
  const dpr  = window.devicePixelRatio || 1;
  const cssW = _videoEl.clientWidth;
  const cssH = _videoEl.clientHeight;
  _canvasEl.width  = Math.round(cssW * dpr);
  _canvasEl.height = Math.round(cssH * dpr);
  _canvasEl.style.width  = cssW + 'px';
  _canvasEl.style.height = cssH + 'px';
  if (_ctx) _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function _drawDetections(dets) {
  if (!_ctx || !_canvasEl || !_videoEl) return;

  const dpr  = window.devicePixelRatio || 1;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _ctx.clearRect(0, 0, _videoEl.clientWidth, _videoEl.clientHeight);

  if (!dets || !dets.length) return;

  const bounds = getContentBounds(_videoEl);

  for (const det of dets) {
    const x1 = det.x1 * bounds.w + bounds.x;
    const y1 = det.y1 * bounds.h + bounds.y;
    const x2 = det.x2 * bounds.w + bounds.x;
    const y2 = det.y2 * bounds.h + bounds.y;
    const bw = x2 - x1, bh = y2 - y1;
    if (bw < 4 || bh < 4) continue;

    const color = CLS_COLORS[det.cls] || '#66BB6A';
    _drawCornerBox(x1, y1, bw, bh, color);
    _drawLabel(x1, y1, det, color);
  }
}

function _drawCornerBox(x, y, w, h, color) {
  const c = Math.max(6, Math.min(20, Math.floor(Math.min(w, h) * 0.22)));
  _ctx.save();
  _ctx.strokeStyle = color;
  _ctx.lineWidth   = 1.8;
  _ctx.lineCap     = 'round';
  _ctx.shadowColor = color;
  _ctx.shadowBlur  = 8;
  _ctx.setLineDash([]);
  _ctx.beginPath();
  _ctx.moveTo(x,     y + c); _ctx.lineTo(x,     y    ); _ctx.lineTo(x + c, y    );
  _ctx.moveTo(x + w - c, y); _ctx.lineTo(x + w, y    ); _ctx.lineTo(x + w, y + c);
  _ctx.moveTo(x + w, y + h - c); _ctx.lineTo(x + w, y + h); _ctx.lineTo(x + w - c, y + h);
  _ctx.moveTo(x + c, y + h); _ctx.lineTo(x,     y + h); _ctx.lineTo(x,     y + h - c);
  _ctx.stroke();
  _ctx.restore();
}

function _drawLabel(x, y, det, color) {
  const CLS_NAME = { car: 'Car', truck: 'Truck', bus: 'Bus', motorcycle: 'Moto' };
  const cls  = CLS_NAME[String(det?.cls || '').toLowerCase()] || 'Vehicle';
  const conf = det.conf != null ? ` ${Math.round(Number(det.conf) * 100)}%` : '';
  const lbl  = cls + conf;
  const fs   = 10;
  _ctx.font = `700 ${fs}px "JetBrains Mono", monospace`;
  const tw  = _ctx.measureText(lbl).width;
  const px  = 4, py = 2;
  const tx  = x, ty = (y - (fs + py * 2)) >= 0 ? y - (fs + py * 2) : y;
  _hexFill(color, 0.88);
  _ctx.fillRect(tx, ty, tw + px * 2, fs + py * 2);
  _ctx.fillStyle    = '#000';
  _ctx.textAlign    = 'left';
  _ctx.textBaseline = 'top';
  _ctx.fillText(lbl, tx + px, ty + py);
}

function _hexFill(hex, alpha) {
  const raw  = String(hex).replace('#', '').padEnd(6, '0').slice(0, 6);
  const n    = parseInt(raw, 16);
  const r    = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  _ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
}

// ── Demo sidebar guess logic ──────────────────────────────────────────────────

let _guessState = {
  selectedSecs:  60,
  selectedLabel: '1 MIN',
  guessVal:       5,
  active:         false,
  startCount:     0,   // cumulative total at guess submission
  latestCount:    0,   // tracks latest count:update total
  countAtReset:   0,   // cumulative offset across video loops
  loopTotal:      0,   // total from last complete loop (for wrap-around)
  timerId:        null,
  secsLeft:       0,
};

function _initSidebar() {
  const pills = document.getElementById('demo-window-pills');
  if (!pills) return;

  // Pill selection
  pills.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill || _guessState.active) return;
    pills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    _guessState.selectedSecs  = parseInt(pill.dataset.val, 10) || 60;
    _guessState.selectedLabel = pill.textContent.trim();
  });

  // Count −/+
  document.getElementById('demo-count-minus')?.addEventListener('click', () => {
    if (_guessState.active) return;
    const inp = document.getElementById('demo-guess-input');
    if (!inp) return;
    const v = Math.max(0, parseInt(inp.value, 10) - 1);
    inp.value = v;
    _guessState.guessVal = v;
  });
  document.getElementById('demo-count-plus')?.addEventListener('click', () => {
    if (_guessState.active) return;
    const inp = document.getElementById('demo-guess-input');
    if (!inp) return;
    const v = Math.min(99999, parseInt(inp.value, 10) + 1);
    inp.value = v;
    _guessState.guessVal = v;
  });
  document.getElementById('demo-guess-input')?.addEventListener('input', e => {
    _guessState.guessVal = Math.max(0, parseInt(e.target.value, 10) || 0);
  });

  // Submit
  document.getElementById('demo-guess-submit')?.addEventListener('click', _submitGuess);

  // Try Again
  document.getElementById('demo-guess-again')?.addEventListener('click', _resetGuess);

  // Track cumulative count across loops — use demo:count, not count:update
  window.addEventListener('demo:count', _onGuessCountUpdate);
  window.addEventListener('scene:reset', _onGuessSceneReset);
}

function _onGuessCountUpdate(e) {
  const total = e.detail?.total ?? e.detail?.count_in ?? 0;
  _guessState.latestCount = _guessState.countAtReset + Number(total);

  if (_guessState.active) {
    const elapsed = _guessState.latestCount - _guessState.startCount;
    const pct = Math.min(100, Math.round((elapsed / Math.max(1, _guessState.guessVal)) * 100));
    const fill = document.getElementById('demo-prog-fill');
    if (fill) {
      fill.style.width = pct + '%';
      fill.style.background =
        pct < 50 ? 'var(--accent)' :
        pct < 85 ? '#f59e0b' : '#ef4444';
    }
    const lv = document.getElementById('demo-live-count');
    if (lv) lv.textContent = elapsed.toLocaleString();
  }
}

function _onGuessSceneReset() {
  // Video looped — add the last known "raw" total before reset to our cumulative offset
  // _latestDets-based total before reset is stored in loopTotal via last count:update
  // We approximate: countAtReset = latestCount (already cumulative)
  _guessState.countAtReset = _guessState.latestCount;
}

function _submitGuess() {
  const secs  = _guessState.selectedSecs;
  const label = _guessState.selectedLabel;
  const guess = Math.max(0, parseInt(document.getElementById('demo-guess-input')?.value, 10) || 0);
  _guessState.guessVal    = guess;
  _guessState.startCount  = _guessState.latestCount;
  _guessState.active      = true;
  _guessState.secsLeft    = secs;

  // Show active state + count HUD
  document.getElementById('demo-count-hud')?.classList.add('visible');
  document.getElementById('demo-guess-form')?.classList.add('hidden');
  const activeEl = document.getElementById('demo-active');
  if (activeEl) activeEl.classList.remove('hidden');

  const wtag = document.getElementById('demo-window-tag');
  if (wtag) wtag.textContent = label;
  const rg = document.getElementById('demo-receipt-guess');
  if (rg) rg.textContent = guess.toLocaleString();
  const lv = document.getElementById('demo-live-count');
  if (lv) lv.textContent = '0';
  const fill = document.getElementById('demo-prog-fill');
  if (fill) { fill.style.width = '0%'; fill.style.background = 'var(--accent)'; }

  // Countdown
  _updateCountdownEl(secs);
  _guessState.timerId = setInterval(() => {
    _guessState.secsLeft--;
    _updateCountdownEl(_guessState.secsLeft);
    if (_guessState.secsLeft <= 0) {
      clearInterval(_guessState.timerId);
      _guessState.timerId = null;
      _evaluateGuess();
    }
  }, 1000);
}

function _updateCountdownEl(secs) {
  const el = document.getElementById('demo-countdown');
  if (!el) return;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = m > 0
    ? `${m}:${String(s).padStart(2, '0')}`
    : `0:${String(Math.max(0, s)).padStart(2, '0')}`;
}

function _evaluateGuess() {
  const windowCount = _guessState.latestCount - _guessState.startCount;
  const guess       = _guessState.guessVal;
  const diff        = Math.abs(windowCount - guess);
  const pct         = windowCount > 0 ? diff / windowCount : (diff > 0 ? 1 : 0);

  let badge, pts, badgeClass;
  if (diff === 0) {
    badge = 'EXACT'; pts = 100; badgeClass = '';
  } else if (pct <= 0.4) {
    badge = 'CLOSE'; pts = Math.round(100 * (1 - pct / 0.4)); badgeClass = '';
  } else {
    badge = 'MISS'; pts = 0; badgeClass = 'bpr-badge-miss';
  }

  document.getElementById('demo-count-hud')?.classList.remove('visible');
  document.getElementById('demo-active')?.classList.add('hidden');
  const resultEl = document.getElementById('demo-result');
  if (resultEl) resultEl.classList.remove('hidden');

  const badgeEl = document.getElementById('demo-res-badge');
  if (badgeEl) { badgeEl.textContent = badge; badgeEl.className = 'bpr-badge' + (badgeClass ? ' ' + badgeClass : ''); }
  const ptsEl = document.getElementById('demo-res-pts');
  if (ptsEl) { ptsEl.textContent = pts + ' pts'; ptsEl.className = 'bpr-pts' + (badge === 'MISS' ? ' bpr-pts-miss' : ''); }
  const rgEl = document.getElementById('demo-res-guess');
  if (rgEl) rgEl.textContent = guess.toLocaleString();
  const raEl = document.getElementById('demo-res-actual');
  if (raEl) raEl.textContent = windowCount.toLocaleString();

  _guessState.active = false;
}

function _resetGuess() {
  if (_guessState.timerId) { clearInterval(_guessState.timerId); _guessState.timerId = null; }
  _guessState.active = false;

  document.getElementById('demo-count-hud')?.classList.remove('visible');
  document.getElementById('demo-result')?.classList.add('hidden');
  document.getElementById('demo-active')?.classList.add('hidden');
  document.getElementById('demo-guess-form')?.classList.remove('hidden');

  const fill = document.getElementById('demo-prog-fill');
  if (fill) { fill.style.width = '0%'; fill.style.background = 'var(--accent)'; }
}

function _teardownGuess() {
  if (_guessState.timerId) { clearInterval(_guessState.timerId); _guessState.timerId = null; }
  _guessState.active       = false;
  _guessState.latestCount  = 0;
  _guessState.countAtReset = 0;
  _guessState.startCount   = 0;
  window.removeEventListener('demo:count', _onGuessCountUpdate);
  window.removeEventListener('scene:reset', _onGuessSceneReset);
  _resetGuess();
}

// ── Tripwire drawing ──────────────────────────────────────────────────────────

function _initTripwire() {
  const btn  = document.getElementById('demo-draw-btn');
  const wrap = document.getElementById('demo-video-area');
  if (!btn || !wrap) return;

  btn.addEventListener('click', () => {
    _drawMode = !_drawMode;
    btn.classList.toggle('active', _drawMode);
    wrap.classList.toggle('draw-mode', _drawMode);
    if (!_drawMode) _drawStart = null;
  });

  // Use video element for pointer events (canvas is pointer-events:none)
  _videoEl.addEventListener('mousedown',  _onTripDown);
  _videoEl.addEventListener('mousemove',  _onTripMove);
  _videoEl.addEventListener('mouseup',    _onTripUp);
  _videoEl.addEventListener('touchstart', _onTripTouchStart, { passive: true });
  _videoEl.addEventListener('touchend',   _onTripTouchEnd,   { passive: true });
}

function _videoCoords(e) {
  const rect   = _videoEl.getBoundingClientRect();
  const bounds = getContentBounds(_videoEl);
  const cssX   = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - rect.left;
  const cssY   = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - rect.top;
  // Normalise to content (0-1) coords
  const nx = (cssX - bounds.x) / bounds.w;
  const ny = (cssY - bounds.y) / bounds.h;
  return { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
}

function _onTripDown(e)  { if (!_drawMode) return; e.preventDefault(); _drawStart = _videoCoords(e); }
function _onTripMove(e)  {
  if (!_drawMode || !_drawStart) return;
  // Live preview — store tentative end, redraw happens in RAF
  _tripLine = { x1: _drawStart.x, y1: _drawStart.y, ..._videoCoords(e) };
}
function _onTripUp(e) {
  if (!_drawMode || !_drawStart) return;
  const end = _videoCoords(e);
  _tripLine  = { x1: _drawStart.x, y1: _drawStart.y, x2: end.x, y2: end.y };
  _drawStart = null;
  _drawMode  = false;
  document.getElementById('demo-draw-btn')?.classList.remove('active');
  document.getElementById('demo-video-area')?.classList.remove('draw-mode');
}
function _onTripTouchStart(e) { _onTripDown(e.touches[0]  || e); }
function _onTripTouchEnd(e)   { _onTripUp(e.changedTouches[0] || e); }

function _tripFlashOn() {
  _tripFlash = true;
  clearTimeout(_tripFlashTimer);
  _tripFlashTimer = setTimeout(() => { _tripFlash = false; }, 600);
}

function _drawTripwire() {
  if (!_tripLine || !_ctx || !_videoEl) return;
  const { x1, y1, x2, y2 } = _tripLine;
  const bounds = getContentBounds(_videoEl);
  const pt  = (rx, ry) => contentToPixel(rx, ry, bounds);
  const p1  = pt(x1, y1);
  const p2  = pt(x2, y2);
  const dx  = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx  = -dy / len, ny = dx / len;
  const fl  = _tripFlash;
  const col = fl ? '#00FF88' : '#FFD600';

  // Wide soft glow halo
  _ctx.save();
  _ctx.beginPath(); _ctx.moveTo(p1.x, p1.y); _ctx.lineTo(p2.x, p2.y);
  _ctx.strokeStyle = col; _ctx.lineWidth = fl ? 14 : 10;
  _ctx.globalAlpha = 0.12; _ctx.shadowColor = col; _ctx.shadowBlur = fl ? 28 : 18;
  _ctx.lineCap = 'round'; _ctx.stroke(); _ctx.restore();

  // Tight glow
  _ctx.save();
  _ctx.beginPath(); _ctx.moveTo(p1.x, p1.y); _ctx.lineTo(p2.x, p2.y);
  _ctx.strokeStyle = col; _ctx.lineWidth = fl ? 6 : 4;
  _ctx.globalAlpha = 0.22; _ctx.shadowColor = col; _ctx.shadowBlur = fl ? 16 : 10;
  _ctx.lineCap = 'round'; _ctx.stroke(); _ctx.restore();

  // Main line
  _ctx.save();
  _ctx.beginPath(); _ctx.moveTo(p1.x, p1.y); _ctx.lineTo(p2.x, p2.y);
  _ctx.strokeStyle = col; _ctx.lineWidth = fl ? 2.5 : 1.5;
  _ctx.globalAlpha = 1; _ctx.shadowColor = col; _ctx.shadowBlur = fl ? 10 : 5;
  _ctx.lineCap = 'round'; _ctx.stroke(); _ctx.restore();

  // Tick marks
  const tickSpacing = 24, tickLen = fl ? 7 : 5;
  const nTicks = Math.floor(len / tickSpacing);
  _ctx.save(); _ctx.strokeStyle = col; _ctx.lineWidth = 1;
  _ctx.globalAlpha = fl ? 0.55 : 0.30; _ctx.lineCap = 'round';
  for (let i = 1; i < nTicks; i++) {
    const t = i / nTicks;
    const tx = p1.x + dx * t, ty = p1.y + dy * t;
    _ctx.beginPath();
    _ctx.moveTo(tx + nx * tickLen, ty + ny * tickLen);
    _ctx.lineTo(tx - nx * tickLen, ty - ny * tickLen);
    _ctx.stroke();
  }
  _ctx.restore();

  // Scan particle
  if (!fl) {
    const period = 2400;
    const tRaw   = (Date.now() % (period * 2)) / period;
    const tB     = tRaw <= 1 ? tRaw : 2 - tRaw;
    _ctx.save();
    _ctx.beginPath(); _ctx.arc(p1.x + dx * tB, p1.y + dy * tB, 3, 0, Math.PI * 2);
    _ctx.fillStyle = '#FFF'; _ctx.shadowColor = col; _ctx.shadowBlur = 10;
    _ctx.globalAlpha = 0.85; _ctx.fill(); _ctx.restore();
  }

  // End caps
  [p1, p2].forEach(p => {
    _ctx.save();
    _ctx.beginPath(); _ctx.arc(p.x, p.y, fl ? 5 : 4, 0, Math.PI * 2);
    _ctx.fillStyle = col; _ctx.shadowColor = col; _ctx.shadowBlur = fl ? 14 : 8; _ctx.fill();
    _ctx.beginPath();
    _ctx.moveTo(p.x + nx * 8, p.y + ny * 8); _ctx.lineTo(p.x - nx * 8, p.y - ny * 8);
    _ctx.strokeStyle = col; _ctx.lineWidth = fl ? 2 : 1.5; _ctx.globalAlpha = 0.6; _ctx.stroke();
    _ctx.restore();
  });
}

function _teardownTripwire() {
  if (!_videoEl) return;
  _videoEl.removeEventListener('mousedown',  _onTripDown);
  _videoEl.removeEventListener('mousemove',  _onTripMove);
  _videoEl.removeEventListener('mouseup',    _onTripUp);
  _videoEl.removeEventListener('touchstart', _onTripTouchStart);
  _videoEl.removeEventListener('touchend',   _onTripTouchEnd);
  clearTimeout(_tripFlashTimer);
  _tripLine = null; _drawMode = false; _drawStart = null; _tripFlash = false; _prevTotal = 0;
  document.getElementById('demo-draw-btn')?.classList.remove('active');
  document.getElementById('demo-video-area')?.classList.remove('draw-mode');
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function _updateUI(on) {
  const btn = document.getElementById(DEMO_BTN_ID);
  if (btn) {
    btn.textContent = on ? 'EXIT DEMO' : 'DEMO';
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
