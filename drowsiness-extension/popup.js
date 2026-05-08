'use strict';

function scoreColor(pct) {
  if (pct < 40) return '#00dc00';
  if (pct < 70) return '#dcdc00';
  return '#dc0000';
}

function fmt3(n) { return Number(n).toFixed(3); }
function fmt1(n) { return Number(n).toFixed(1); }
function fmt0(n) { return Number(n).toFixed(0); }

function render(state) {
  const dot  = document.getElementById('dot');
  const text = document.getElementById('status-text');

  if (!state.active) {
    dot.className = 'dot inactive';
    text.textContent = 'Inactive';
  } else if (state.cameraError) {
    dot.className = 'dot error';
    text.textContent = 'Camera error';
  } else if (state.faceDetected) {
    dot.className = 'dot active';
    text.textContent = 'Monitoring';
  } else {
    dot.className = 'dot active';
    text.textContent = 'No face detected';
  }

  const score = Number(state.drowsinessScore) || 0;
  const color = scoreColor(score);

  const scoreEl = document.getElementById('score');
  scoreEl.textContent = `${fmt1(score)}%`;
  scoreEl.style.color = color;

  const bar = document.getElementById('bar');
  bar.style.width = `${Math.min(100, score)}%`;
  bar.style.backgroundColor = color;

  document.getElementById('m-lear').textContent  = fmt3(state.leftEar);
  document.getElementById('m-rear').textContent  = fmt3(state.rightEar);
  document.getElementById('m-mar').textContent   = fmt3(state.mar);
  document.getElementById('m-head').textContent  = `${fmt1(state.headAngle)}°`;
  document.getElementById('m-blink').textContent = `${fmt0(state.blinkDuration)} ms`;
  document.getElementById('m-yawn').textContent  = state.yawnCount;
}

async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  document.getElementById('toggle').checked = state.active;
  render(state);

  setInterval(async () => {
    try { render(await chrome.runtime.sendMessage({ type: 'GET_STATE' })); }
    catch (_) {}
  }, 250);

  document.getElementById('toggle').addEventListener('change', async (e) => {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_ACTIVE', active: e.target.checked });
    } catch (_) {}
  });

  document.getElementById('debug-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('debug.html') });
  });
}

init().catch(console.error);
