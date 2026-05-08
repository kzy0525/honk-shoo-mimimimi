import { FaceLandmarker, FilesetResolver } from './vendor/vision_bundle.mjs';
import { DetectionState } from './detection.js';

const video    = document.getElementById('video');
const detState = new DetectionState();

const SEND_INTERVAL = 100; // ms between metric messages to background
let lastSendMs = 0;

// ── Init MediaPipe FaceLandmarker ─────────────────────────────────────────────
const vision = await FilesetResolver.forVisionTasks(
  chrome.runtime.getURL('vendor/wasm')
);

const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: chrome.runtime.getURL('vendor/face_landmarker.task'),
    delegate: 'GPU',
  },
  outputFaceBlendshapes: false,
  runningMode: 'VIDEO',
  numFaces: 1,
});

// ── Processing loop ───────────────────────────────────────────────────────────
function processFrame() {
  if (video.readyState < 2) return;

  const now    = Date.now();
  const result = faceLandmarker.detectForVideo(video, now);
  if (now - lastSendMs < SEND_INTERVAL) return;
  lastSendMs = now;

  let data;
  if (result.faceLandmarks && result.faceLandmarks.length > 0) {
    data = { faceDetected: true, ...detState.update(result.faceLandmarks[0], now) };
  } else {
    data = {
      faceDetected: false,
      leftEar: 0, rightEar: 0, mar: 0, headAngle: 0,
      blinkDuration: detState.lastBlinkMs,
      yawnCount:     detState.yawnTs.length,
      drowsinessScore: detState.lastScore,
    };
  }

  chrome.runtime.sendMessage({ type: 'METRICS', data }).catch(() => {});
}

setInterval(processFrame, 33); // run at ~30fps, throttle sends to 10fps

// ── Camera init ───────────────────────────────────────────────────────────────
try {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
  });
  video.srcObject = stream;
  await video.play();
} catch (err) {
  chrome.runtime.sendMessage({ type: 'CAMERA_ERROR', error: err.message }).catch(() => {});
}
