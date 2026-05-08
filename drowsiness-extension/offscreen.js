import { FaceLandmarker, FilesetResolver } from './vendor/vision_bundle.mjs';
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
  if (msg.type !== 'SETTINGS_UPDATE') return;
  if (msg.muted  !== undefined) muted        = msg.muted;
  if (msg.volume !== undefined) globalVolume = msg.volume / 100;
});

// ── Web Audio setup ───────────────────────────────────────────────────────────
const audioCtx = new AudioContext();

async function loadSound(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return audioCtx.decodeAudioData(buf);
}

async function playBuffer(buffer) {
  if (muted)   { console.log('[audio] muted, skipping'); return; }
  if (!buffer) { console.warn('[audio] buffer is null/undefined'); return; }
  try {
    if (audioCtx.state !== 'running') {
      console.log('[audio] context state:', audioCtx.state, '— resuming');
      await audioCtx.resume();
      console.log('[audio] context state after resume:', audioCtx.state);
    }
    const src  = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, globalVolume));
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
    console.log('[audio] played buffer, duration:', buffer.duration.toFixed(2), 's');
  } catch (e) {
    console.error('[audio] playBuffer error:', e);
  }
}

const sounds = {};

async function initAudio() {
  const base = chrome.runtime.getURL('assets/sounds/');
  console.log('[audio] loading sounds from', base);
  try {
    [sounds.beep, sounds.alarm, sounds.chime] = await Promise.all([
      loadSound(base + 'beep.wav'),
      loadSound(base + 'alarm.wav'),
      loadSound(base + 'chime.wav'),
    ]);
    console.log('[audio] sounds loaded — beep:', !!sounds.beep,
                'alarm:', !!sounds.alarm, 'chime:', !!sounds.chime);
  } catch (e) {
    console.error('[audio] initAudio failed:', e);
  }
}

// ── Alert timing state ────────────────────────────────────────────────────────
let alertLevel    = 0;
let lastBeepTime  = 0;
let lastAlarmTime = 0;

function updateAudio(drowsinessScore, yawnJustDetected) {
  const now   = Date.now();
  const level = drowsinessScore >= 60 ? 2 : drowsinessScore >= 40 ? 1 : 0;
  alertLevel  = level;

  if (level === 2) {
    // Loud alarm every 5 s, overrides beep
    if (now - lastAlarmTime >= 5000) {
      playBuffer(sounds.alarm);
      lastAlarmTime = now;
    }
  } else if (level === 1) {
    // Soft beep every 10 s
    if (now - lastBeepTime >= 10000) {
      playBuffer(sounds.beep);
      lastBeepTime = now;
    }
  } else {
    // Safe zone — reset beep timer so next warning fires immediately
    lastBeepTime = 0;
  }

  if (yawnJustDetected) playBuffer(sounds.chime);
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

// ── Processing loop ───────────────────────────────────────────────────────────
function processFrame() {
  if (video.readyState < 2) return;

  const now    = Date.now();
  const result = faceLandmarker.detectForVideo(video, now);
  const lms    = result.faceLandmarks?.[0] ?? null;

  let metrics;
  if (lms) {
    const detected = detState.update(lms, now);
    updateAudio(detected.drowsinessScore, detected.yawnJustDetected);
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
