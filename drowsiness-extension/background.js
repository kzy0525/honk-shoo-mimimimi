'use strict';

let appState = {
  active: true,
  faceDetected: false,
  leftEar: 0,
  rightEar: 0,
  mar: 0,
  headAngle: 0,
  blinkDuration: 0,
  yawnCount: 0,
  drowsinessScore: 0,
  alertLevel: 0,   // 0=none 1=warning 2=alert
  cameraError: null,
};

async function createOffscreenDoc() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Webcam capture and audio alerts for drowsiness detection',
    });
  } catch (e) {
    console.error('createOffscreenDoc failed:', e);
  }
}

async function removeOffscreenDoc() {
  try {
    if (await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    console.error('removeOffscreenDoc failed:', e);
  }
}

chrome.runtime.onInstalled.addListener(() => createOffscreenDoc());
chrome.runtime.onStartup.addListener(() => createOffscreenDoc());

// Ensure the offscreen doc exists whenever the service worker wakes up
createOffscreenDoc();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'METRICS') {
    Object.assign(appState, msg.data, { cameraError: null });
    return false;
  }

  if (msg.type === 'CAMERA_ERROR') {
    appState.cameraError = msg.error;
    appState.faceDetected = false;
    return false;
  }

  if (msg.type === 'GET_STATE') {
    sendResponse({ ...appState });
    return false;
  }

  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['muted', 'volume']).then(sendResponse).catch(() => sendResponse({}));
    return true; // async response
  }

  if (msg.type === 'SET_ACTIVE') {
    appState.active = msg.active;
    const op = msg.active ? createOffscreenDoc() : removeOffscreenDoc();
    op.then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // async response
  }

  return false;
});

// Forward storage changes to offscreen document
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !('muted' in changes || 'volume' in changes)) return;
  const settings = await chrome.storage.local.get(['muted', 'volume']);
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATE', ...settings }).catch(() => {});
});
