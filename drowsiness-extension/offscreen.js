'use strict';

const video = document.getElementById('video');
const detectionState = new DetectionState();

let lastSendMs = 0;
const SEND_INTERVAL = 100; // send metrics at most 10×/sec

// ── MediaPipe Face Mesh setup ─────────────────────────────────────────────────
const faceMesh = new FaceMesh({
  locateFile: (file) => chrome.runtime.getURL(`vendor/${file}`),
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

faceMesh.onResults((results) => {
  const now = Date.now();
  if (now - lastSendMs < SEND_INTERVAL) return;
  lastSendMs = now;

  let data;
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    data = {
      faceDetected: true,
      ...detectionState.update(results.multiFaceLandmarks[0], now),
    };
  } else {
    data = {
      faceDetected: false,
      leftEar: 0,
      rightEar: 0,
      mar: 0,
      headAngle: 0,
      blinkDuration: detectionState.lastBlinkMs,
      yawnCount: detectionState.yawnTs.length,
      drowsinessScore: detectionState.lastScore,
    };
  }

  chrome.runtime.sendMessage({ type: 'METRICS', data }).catch(() => {});
});

// ── Processing loop ───────────────────────────────────────────────────────────
let busy = false;

function startLoop() {
  setInterval(async () => {
    if (busy || video.readyState < 2) return;
    busy = true;
    try {
      await faceMesh.send({ image: video });
    } catch (e) {
      console.error('faceMesh.send error:', e);
    } finally {
      busy = false;
    }
  }, 100);
}

// ── Camera init ───────────────────────────────────────────────────────────────
(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    video.srcObject = stream;
    await video.play();
    startLoop();
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'CAMERA_ERROR',
      error: err.message,
    }).catch(() => {});
  }
})();
