'use strict';

function scoreColor(pct) {
  if (pct < 40) return '#00dc00';
  if (pct < 60) return '#dcdc00';
  return '#dc0000';
}
function fmt3(n) { return Number(n).toFixed(3); }
function fmt1(n) { return Number(n).toFixed(1); }
function fmt0(n) { return Number(n).toFixed(0); }

const ALERT_LABELS = ['', 'Warning', 'Alert'];
const ALERT_COLORS = ['', '#dcdc00', '#dc0000'];

function render(state) {
  // Status dot
  const dot  = document.getElementById('dot');
  const text = document.getElementById('status-text');
  if (!state.active) {
    dot.className = 'dot inactive'; text.textContent = 'Inactive';
  } else if (state.cameraError) {
    dot.className = 'dot error';    text.textContent = 'Camera error';
  } else if (state.faceDetected) {
    dot.className = 'dot active';   text.textContent = 'Monitoring';
  } else {
    dot.className = 'dot active';   text.textContent = 'No face detected';
  }

  // Alert badge
  const badge = document.getElementById('alert-badge');
  const level = state.alertLevel || 0;
  badge.textContent   = level ? `● ${ALERT_LABELS[level]}` : '';
  badge.style.color   = ALERT_COLORS[level] || '';
  badge.style.display = level ? 'inline' : 'none';

  // Score + bar
  const score = Number(state.drowsinessScore) || 0;
  const color = scoreColor(score);
  const scoreEl = document.getElementById('score');
  scoreEl.textContent   = `${fmt1(score)}%`;
  scoreEl.style.color   = color;
  const bar = document.getElementById('bar');
  bar.style.width           = `${Math.min(100, score)}%`;
  bar.style.backgroundColor = color;

  // Metrics
  document.getElementById('m-lear').textContent  = fmt3(state.leftEar);
  document.getElementById('m-rear').textContent  = fmt3(state.rightEar);
  document.getElementById('m-mar').textContent   = fmt3(state.mar);
  document.getElementById('m-head').textContent  = `${fmt1(state.headAngle)}°`;
  document.getElementById('m-blink').textContent = `${fmt0(state.blinkDuration)} ms`;
  document.getElementById('m-yawn').textContent  = state.yawnCount;
}

async function init() {
  // Load persisted sound settings
  const { muted = false, volume = 80 } =
    await chrome.storage.local.get(['muted', 'volume']);

  const muteCb      = document.getElementById('mute-cb');
  const muteLabel   = document.getElementById('mute-label');
  const slider      = document.getElementById('volume-slider');
  const volPct      = document.getElementById('vol-pct');
  const volumeRow   = document.getElementById('volume-row');

  function applyMute(m) {
    muteCb.checked       = m;
    muteLabel.textContent = m ? 'Unmute' : 'Mute';
    volumeRow.style.opacity      = m ? '0.35' : '1';
    volumeRow.style.pointerEvents = m ? 'none' : '';
  }

  applyMute(muted);
  slider.value   = volume;
  volPct.textContent = `${volume}%`;

  muteCb.addEventListener('change', () => {
    const m = muteCb.checked;
    applyMute(m);
    chrome.storage.local.set({ muted: m });
  });

  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    volPct.textContent = `${v}%`;
    chrome.storage.local.set({ volume: v });
  });

  // Load monitoring state
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  document.getElementById('toggle').checked = state.active;
  render(state);

  // Poll for live updates
  setInterval(async () => {
    try { render(await chrome.runtime.sendMessage({ type: 'GET_STATE' })); }
    catch (_) {}
  }, 250);

  document.getElementById('toggle').addEventListener('change', async (e) => {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_ACTIVE', active: e.target.checked });
    } catch (_) {}
  });

  document.getElementById('test-seg-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TEST_SEGMENTATION' }).catch(() => {});
  });

  document.getElementById('debug-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('debug.html') });
  });
}

init().catch(console.error);
