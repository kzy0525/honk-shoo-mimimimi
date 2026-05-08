'use strict';

const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const badge  = document.getElementById('header-badge');

const detState = new DetectionState();

// Current metrics (updated in onResults, read by draw)
let metrics = {
  faceDetected: false,
  leftEar: 0, rightEar: 0, mar: 0,
  headAngle: 0, blinkDuration: 0,
  yawnCount: 0, drowsinessScore: 0,
};

// ── Drawing helpers ───────────────────────────────────────────────────────────
function lmX(lm) { return lm.x * canvas.width; }
function lmY(lm) { return lm.y * canvas.height; }

function drawOutlineText(text, x, y, fillColor, size = 13) {
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
  pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  pts.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawMouth(lms) {
  const pts = MOUTH_OUTLINE.map(i => [lmX(lms[i]), lmY(lms[i])]);
  ctx.strokeStyle = '#00dcdc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#00dcdc';
  pts.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHeadLine(lms) {
  const nx = lmX(lms[NOSE_TIP]), ny = lmY(lms[NOSE_TIP]);
  const fx = lmX(lms[FOREHEAD]), fy = lmY(lms[FOREHEAD]);
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  [[nx, ny], [fx, fy]].forEach(([x, y]) => {
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHUD(m) {
  const W = canvas.width;
  const panelW = 210, panelH = 26 * 7 + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, panelW, panelH);

  const rows = [
    [`Left  EAR : ${m.leftEar.toFixed(3)}`,        earColor(m.leftEar)],
    [`Right EAR : ${m.rightEar.toFixed(3)}`,        earColor(m.rightEar)],
    [`MAR       : ${m.mar.toFixed(3)}`,              '#00dcdc'],
    [`Head Tilt : ${m.headAngle.toFixed(1)}°`,       '#ff8800'],
    [`Blink Dur : ${m.blinkDuration.toFixed(0)} ms`, '#e0e0e0'],
    [`Yawns/5m  : ${m.yawnCount}`,                  '#dcdc00'],
    [`Drowsy    : ${m.drowsinessScore.toFixed(1)}%`, scoreColor(m.drowsinessScore)],
  ];

  rows.forEach(([text, color], i) => {
    drawOutlineText(text, 10, 24 + i * 26, color, 13);
  });
}

function drawBar(score) {
  const W = canvas.width, H = canvas.height;
  const bx = 10, bh = 22, by = H - bh - 10, bw = W - 20;
  ctx.fillStyle = '#333';
  ctx.fillRect(bx, by, bw, bh);
  const fill = Math.min(100, score) / 100 * bw;
  if (fill > 0) {
    ctx.fillStyle = scoreColor(score);
    ctx.fillRect(bx, by, fill, bh);
  }
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px monospace';
  ctx.fillText('DROWSINESS', bx + 6, by + bh - 6);
}

// ── Main render (called per frame from onResults) ─────────────────────────────
function renderFrame(lms) {
  const W = canvas.width, H = canvas.height;

  // 1. Video frame
  ctx.drawImage(video, 0, 0, W, H);

  if (lms) {
    // 2. Eye overlays
    drawEye(lms, RIGHT_EYE, earColor(metrics.rightEar));
    drawEye(lms, LEFT_EYE,  earColor(metrics.leftEar));

    // 3. Mouth outline
    drawMouth(lms);

    // 4. Head tilt line
    drawHeadLine(lms);
  }

  // 5. HUD metrics
  drawHUD(metrics);

  // 6. Drowsiness bar
  drawBar(metrics.drowsinessScore);

  // 7. Badge
  badge.textContent = lms
    ? `${metrics.drowsinessScore.toFixed(1)}% drowsy`
    : 'No face detected';
  badge.style.color     = lms ? scoreColor(metrics.drowsinessScore) : '#aaa';
  badge.style.background = lms ? 'rgba(0,0,0,0.4)' : '#1a1a1a';
}

// ── MediaPipe setup ───────────────────────────────────────────────────────────
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
  const lms = results.multiFaceLandmarks?.[0] ?? null;
  const now = Date.now();

  if (lms) {
    metrics = { faceDetected: true, ...detState.update(lms, now) };
  } else {
    metrics = {
      faceDetected: false,
      leftEar: 0, rightEar: 0, mar: 0, headAngle: 0,
      blinkDuration: detState.lastBlinkMs,
      yawnCount: detState.yawnTs.length,
      drowsinessScore: detState.lastScore,
    };
  }

  renderFrame(lms);
});

// ── Frame loop ────────────────────────────────────────────────────────────────
let busy = false;

function loop() {
  requestAnimationFrame(loop);
  if (busy || video.readyState < 2) return;
  busy = true;
  faceMesh.send({ image: video })
    .catch(console.error)
    .finally(() => { busy = false; });
}

// ── Camera init ───────────────────────────────────────────────────────────────
(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    video.srcObject = stream;
    await video.play();

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;

    badge.textContent = 'Initializing…';
    loop();
  } catch (err) {
    document.getElementById('no-camera').style.display = 'block';
    badge.textContent = 'Camera error';
    badge.style.color = '#dc0000';
    console.error('Camera error:', err);
  }
})();
