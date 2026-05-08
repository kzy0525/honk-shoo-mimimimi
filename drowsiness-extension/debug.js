import { FaceLandmarker, FilesetResolver } from './vendor/vision_bundle.mjs';
import {
  DetectionState,
  RIGHT_EYE, LEFT_EYE, MOUTH_OUTLINE, NOSE_TIP, FOREHEAD,
  earColor, scoreColor,
} from './detection.js';

const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const badge  = document.getElementById('header-badge');

const detState = new DetectionState();

let metrics = {
  faceDetected: false,
  leftEar: 0, rightEar: 0, mar: 0,
  headAngle: 0, blinkDuration: 0,
  yawnCount: 0, drowsinessScore: 0,
};

// ── Drawing helpers ───────────────────────────────────────────────────────────
const W = () => canvas.width;
const H = () => canvas.height;

function lmX(lm) { return lm.x * W(); }
function lmY(lm) { return lm.y * H(); }

function outlineText(text, x, y, fillColor, size = 13) {
  ctx.font = `${size}px monospace`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

function drawEye(lms, indices, color) {
  const pts = indices.map(i => [lmX(lms[i]), lmY(lms[i])]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  for (const [x, y] of pts) {
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawMouth(lms) {
  const pts = MOUTH_OUTLINE.map(i => [lmX(lms[i]), lmY(lms[i])]);
  ctx.strokeStyle = '#00dcdc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#00dcdc';
  for (const [x, y] of pts) {
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHeadLine(lms) {
  const nx = lmX(lms[NOSE_TIP]), ny = lmY(lms[NOSE_TIP]);
  const fx = lmX(lms[FOREHEAD]),  fy = lmY(lms[FOREHEAD]);
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.fillStyle = '#ff8800';
  for (const [x, y] of [[nx, ny], [fx, fy]]) {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHUD(m) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 215, 26 * 7 + 16);

  const rows = [
    [`Left  EAR : ${m.leftEar.toFixed(3)}`,        earColor(m.leftEar)],
    [`Right EAR : ${m.rightEar.toFixed(3)}`,        earColor(m.rightEar)],
    [`MAR       : ${m.mar.toFixed(3)}`,              '#00dcdc'],
    [`Head Tilt : ${m.headAngle.toFixed(1)}°`,       '#ff8800'],
    [`Blink Dur : ${m.blinkDuration.toFixed(0)} ms`, '#e0e0e0'],
    [`Yawns/5m  : ${m.yawnCount}`,                  '#dcdc00'],
    [`Drowsy    : ${m.drowsinessScore.toFixed(1)}%`, scoreColor(m.drowsinessScore)],
  ];
  rows.forEach(([text, color], i) => outlineText(text, 10, 24 + i * 26, color, 13));
}

function drawBar(score) {
  const bx = 10, bh = 22, by = H() - bh - 10, bw = W() - 20;
  ctx.fillStyle = '#333';
  ctx.fillRect(bx, by, bw, bh);
  const fill = Math.min(100, score) / 100 * bw;
  if (fill > 0) { ctx.fillStyle = scoreColor(score); ctx.fillRect(bx, by, fill, bh); }
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px monospace';
  ctx.fillText('DROWSINESS', bx + 6, by + bh - 6);
}

function renderFrame(lms) {
  ctx.drawImage(video, 0, 0, W(), H());
  if (lms) {
    drawEye(lms, RIGHT_EYE, earColor(metrics.rightEar));
    drawEye(lms, LEFT_EYE,  earColor(metrics.leftEar));
    drawMouth(lms);
    drawHeadLine(lms);
  }
  drawHUD(metrics);
  drawBar(metrics.drowsinessScore);

  badge.textContent      = lms ? `${metrics.drowsinessScore.toFixed(1)}% drowsy` : 'No face detected';
  badge.style.color      = lms ? scoreColor(metrics.drowsinessScore) : '#aaa';
  badge.style.background = lms ? 'rgba(0,0,0,0.4)' : '#1a1a1a';
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

// ── Frame loop ────────────────────────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);
  if (video.readyState < 2) return;

  const now    = Date.now();
  const result = faceLandmarker.detectForVideo(video, now);
  const lms    = result.faceLandmarks?.[0] ?? null;

  if (lms) {
    metrics = { faceDetected: true, ...detState.update(lms, now) };
  } else {
    metrics = {
      faceDetected: false,
      leftEar: 0, rightEar: 0, mar: 0, headAngle: 0,
      blinkDuration: detState.lastBlinkMs,
      yawnCount:     detState.yawnTs.length,
      drowsinessScore: detState.lastScore,
    };
  }

  renderFrame(lms);
}

// ── Camera init ───────────────────────────────────────────────────────────────
try {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
  });
  video.srcObject = stream;
  await video.play();
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  loop();
} catch (err) {
  document.getElementById('no-camera').style.display = 'block';
  badge.textContent = 'Camera error';
  badge.style.color = '#dc0000';
}
