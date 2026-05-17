import { FaceLandmarker, FilesetResolver, ImageSegmenter } from './vendor/vision_bundle.mjs';
import { DetectionState } from './detection.js';

const video    = document.getElementById('video');
const detState = new DetectionState();

const SEND_INTERVAL = 100;
let lastSendMs = 0;

// ── Audio settings (routed through background — chrome.storage unavailable here) ──
let muted        = false;
let globalVolume = 0.8;

chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
  .then(s => { if (s) { muted = s.muted ?? false; globalVolume = (s.volume ?? 80) / 100; } })
  .catch(() => {});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SETTINGS_UPDATE') {
    if (msg.muted  !== undefined) muted        = msg.muted;
    if (msg.volume !== undefined) globalVolume = msg.volume / 100;
  }
  if (msg.type === 'TEST_SEGMENTATION') {
    captureAndSegment()
      .then(data => {
        if (data) chrome.runtime.sendMessage({ type: 'SHOW_OVERLAY', ...data }).catch(() => {});
      })
      .catch(e => console.error('[seg] test failed:', e));
  }
});

// ── Web Audio setup ───────────────────────────────────────────────────────────
const audioCtx = new AudioContext();

async function loadSound(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return audioCtx.decodeAudioData(buf);
}


const sounds = {};

async function initAudio() {
  const base = chrome.runtime.getURL('assets/sounds/');
  console.log('[audio] loading sounds from', base);
  try {
    sounds.teamsCall = await loadSound(base + 'teams_call.mp3');
    console.log('[audio] sounds loaded — teamsCall:', !!sounds.teamsCall);
  } catch (e) {
    console.error('[audio] initAudio failed:', e);
  }
}

// ── Alert timing state ────────────────────────────────────────────────────────
let alertLevel   = 0;
let alertSource  = null; // currently playing looping source node

function stopAlert() {
  if (alertSource) {
    try { alertSource.stop(); } catch (_) {}
    alertSource = null;
  }
}

function startAlert(buffer) {
  if (muted || !buffer) return;
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  const src  = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, globalVolume));
  src.buffer = buffer;
  src.loop   = true;
  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
  src.onended = () => { if (alertSource === src) alertSource = null; };
  alertSource = src;
}

function updateAudio(drowsinessScore) {
  const level = drowsinessScore >= 60 ? 2 : 0;
  alertLevel  = level;

  if (level === 2) {
    if (!alertSource) startAlert(sounds.teamsCall);
  } else {
    stopAlert();
  }
}

// ── MediaPipe FaceLandmarker ──────────────────────────────────────────────────
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

await initAudio();

// ── MediaPipe ImageSegmenter (selfie segmentation) ────────────────────────────
const imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: chrome.runtime.getURL('vendor/selfie_segmenter.tflite'),
    delegate: 'CPU',
  },
  runningMode: 'VIDEO',
  outputCategoryMask: true,
  outputConfidenceMasks: false,
});

// ── Segmentation capture ──────────────────────────────────────────────────────
async function captureAndSegment() {
  if (video.readyState < 2) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;

  const frameCanvas = new OffscreenCanvas(w, h);
  const ctx = frameCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  const frameData = ctx.getImageData(0, 0, w, h);

  const segResult = imageSegmenter.segmentForVideo(video, Date.now());
  const mask      = segResult.categoryMask;
  const maskArr   = mask.getAsUint8Array();
  mask.close();

  const bgPixels   = new Uint8ClampedArray(frameData.data);
  const userPixels = new Uint8ClampedArray(frameData.data);
  const pixelCount = Math.min(maskArr.length, w * h);
  for (let i = 0; i < pixelCount; i++) {
    const px = i * 4;
    if (maskArr[i] > 0) bgPixels[px + 3]   = 0; // erase person from background
    else                userPixels[px + 3] = 0; // erase background from user
  }

  const toDataURL = async (pixels) => {
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.readAsDataURL(blob);
    });
  };

  const [bgDataURL, userDataURL] = await Promise.all([
    toDataURL(bgPixels),
    toDataURL(userPixels),
  ]);
  return { bgDataURL, userDataURL };
}

// ── Drowsiness overlay trigger ────────────────────────────────────────────────
let drowsyTriggerStart = null;
let overlayActive      = false;

function checkTrigger(score, now) {
  if (score >= 70) {
    if (drowsyTriggerStart === null) drowsyTriggerStart = now;
    else if (!overlayActive && now - drowsyTriggerStart >= 2000) {
      overlayActive = true;
      captureAndSegment()
        .then(data => {
          if (data) chrome.runtime.sendMessage({ type: 'SHOW_OVERLAY', ...data }).catch(() => {});
          setTimeout(() => { overlayActive = false; }, 4000);
        })
        .catch(() => { overlayActive = false; });
    }
  } else {
    drowsyTriggerStart = null;
  }
}

// ── Processing loop ───────────────────────────────────────────────────────────
function processFrame() {
  if (video.readyState < 2) return;

  const now    = Date.now();
  const result = faceLandmarker.detectForVideo(video, now);
  const lms    = result.faceLandmarks?.[0] ?? null;

  let metrics;
  if (lms) {
    const detected = detState.update(lms, now);
    updateAudio(detected.drowsinessScore);
    checkTrigger(detected.drowsinessScore, now);
    metrics = { faceDetected: true, alertLevel, ...detected };
  } else {
    alertLevel = 0;
    metrics = {
      faceDetected: false,
      alertLevel: 0,
      leftEar: 0, rightEar: 0, mar: 0, headAngle: 0,
      blinkDuration: detState.lastBlinkMs,
      yawnCount:     detState.yawnTs.length,
      drowsinessScore: detState.lastScore,
      yawnJustDetected: false,
    };
  }

  if (now - lastSendMs >= SEND_INTERVAL) {
    lastSendMs = now;
    chrome.runtime.sendMessage({ type: 'METRICS', data: metrics }).catch(() => {});
  }
}

setInterval(processFrame, 33);

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
