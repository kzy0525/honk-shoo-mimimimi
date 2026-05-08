// Shared drowsiness detection constants, pure functions, and stateful class.
// Included via <script> in both offscreen.html and debug.html.

// ── Thresholds (mirrored from Phase 1 Python) ────────────────────────────────
const EAR_OPEN     = 0.27;
const EAR_DROOPING = 0.22;
const EAR_CLOSED   = 0.15;

const MAR_YAWN_THRESH = 0.5;
const YAWN_MIN_MS     = 2000;
const YAWN_WINDOW_MS  = 300_000; // 5 minutes

const MAX_HEAD_DEG  = 30;
const MAX_BLINK_MS  = 800;
const MAX_YAWNS_WIN = 5;

const DROWSY_SCORE_PCT = 70;

// ── Landmark indices ──────────────────────────────────────────────────────────
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE  = [362, 385, 387, 263, 373, 380];

const MOUTH_L  = 61,  MOUTH_R  = 291;
const MOUTH_TL = 82,  MOUTH_BL = 87;
const MOUTH_TC = 13,  MOUTH_BC = 14;
const MOUTH_TR = 312, MOUTH_BR = 317;
const MOUTH_OUTLINE = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];

const NOSE_TIP = 1;
const FOREHEAD = 10;

// ── Pure helpers ──────────────────────────────────────────────────────────────
function lmDist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function calcEAR(lms, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map(i => lms[i]);
  return (lmDist(p2, p6) + lmDist(p3, p5)) / (2 * lmDist(p1, p4) + 1e-6);
}

function calcMAR(lms) {
  const vert  = lmDist(lms[MOUTH_TL], lms[MOUTH_BL])
              + lmDist(lms[MOUTH_TC], lms[MOUTH_BC])
              + lmDist(lms[MOUTH_TR], lms[MOUTH_BR]);
  const horiz = lmDist(lms[MOUTH_L], lms[MOUTH_R]);
  return vert / (3 * horiz + 1e-6);
}

function calcHeadAngle(lms) {
  const dx = lms[FOREHEAD].x - lms[NOSE_TIP].x;
  const dy = lms[FOREHEAD].y - lms[NOSE_TIP].y;
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}

function earColor(ear) {
  if (ear >= EAR_OPEN)     return '#00dc00';
  if (ear >= EAR_DROOPING) return '#dcdc00';
  return '#dc0000';
}

function scoreColor(pct) {
  if (pct < 40) return '#00dc00';
  if (pct < 70) return '#dcdc00';
  return '#dc0000';
}

// ── Stateful detection (one instance per page) ────────────────────────────────
class DetectionState {
  constructor() {
    this.blinkStart  = null;
    this.lastBlinkMs = 0;
    this.yawnStart   = null;
    this.yawnActive  = false;
    this.yawnTs      = [];
    this.lastScore   = 0;
  }

  // lms: array of {x, y, z} normalized landmarks from MediaPipe Face Mesh
  // returns a plain metrics object
  update(lms, now = Date.now()) {
    const rightEar  = calcEAR(lms, RIGHT_EYE);
    const leftEar   = calcEAR(lms, LEFT_EYE);
    const avgEar    = (leftEar + rightEar) / 2;
    const mar       = calcMAR(lms);
    const headAngle = calcHeadAngle(lms);

    // Eye closure score 0→1
    let eyeScore;
    if (avgEar >= EAR_OPEN)        eyeScore = 0;
    else if (avgEar <= EAR_CLOSED) eyeScore = 1;
    else eyeScore = (EAR_OPEN - avgEar) / (EAR_OPEN - EAR_CLOSED);

    // Blink tracking
    if (avgEar < EAR_CLOSED) {
      if (this.blinkStart === null) this.blinkStart = now;
    } else {
      if (this.blinkStart !== null) {
        const dur = now - this.blinkStart;
        if (dur > 40) this.lastBlinkMs = dur;
        this.blinkStart = null;
      }
    }
    const blinkScore = Math.min(1, this.lastBlinkMs / MAX_BLINK_MS);

    // Yawn tracking
    if (mar > MAR_YAWN_THRESH) {
      if (this.yawnStart === null) this.yawnStart = now;
      else if (!this.yawnActive && (now - this.yawnStart) >= YAWN_MIN_MS) {
        this.yawnTs.push(now);
        this.yawnActive = true;
      }
    } else {
      this.yawnStart  = null;
      this.yawnActive = false;
    }

    // Evict yawns outside rolling window
    const cutoff = now - YAWN_WINDOW_MS;
    this.yawnTs  = this.yawnTs.filter(t => t > cutoff);
    const yawnScore = Math.min(1, this.yawnTs.length / MAX_YAWNS_WIN);

    // Head tilt score
    const headScore = Math.min(1, Math.abs(headAngle) / MAX_HEAD_DEG);

    const drowsinessScore = (
      0.4 * eyeScore +
      0.2 * headScore +
      0.2 * blinkScore +
      0.2 * yawnScore
    ) * 100;

    this.lastScore = drowsinessScore;

    return {
      leftEar,
      rightEar,
      mar,
      headAngle,
      blinkDuration: this.lastBlinkMs,
      yawnCount:     this.yawnTs.length,
      drowsinessScore,
    };
  }
}
