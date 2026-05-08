// Shared drowsiness detection — ES module, imported by offscreen.js and debug.js.

// ── Thresholds ────────────────────────────────────────────────────────────────
export const EAR_OPEN     = 0.27;
export const EAR_DROOPING = 0.22;
export const EAR_CLOSED   = 0.15;

export const MAR_YAWN_THRESH = 0.5;
export const YAWN_MIN_MS     = 2000;
export const YAWN_WINDOW_MS  = 300_000; // 5 minutes

export const MAX_HEAD_DEG  = 30;
export const MAX_BLINK_MS  = 800;
export const MAX_YAWNS_WIN = 5;

// ── Landmark indices (same as Phase 1 Python) ─────────────────────────────────
export const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
export const LEFT_EYE  = [362, 385, 387, 263, 373, 380];

export const MOUTH_L  = 61;  export const MOUTH_R  = 291;
export const MOUTH_TL = 82;  export const MOUTH_BL = 87;
export const MOUTH_TC = 13;  export const MOUTH_BC = 14;
export const MOUTH_TR = 312; export const MOUTH_BR = 317;
export const MOUTH_OUTLINE = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];

export const NOSE_TIP = 1;
export const FOREHEAD = 10;

// ── Pure helpers ──────────────────────────────────────────────────────────────
export function lmDist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calcEAR(lms, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map(i => lms[i]);
  return (lmDist(p2, p6) + lmDist(p3, p5)) / (2 * lmDist(p1, p4) + 1e-6);
}

export function calcMAR(lms) {
  const vert  = lmDist(lms[MOUTH_TL], lms[MOUTH_BL])
              + lmDist(lms[MOUTH_TC], lms[MOUTH_BC])
              + lmDist(lms[MOUTH_TR], lms[MOUTH_BR]);
  const horiz = lmDist(lms[MOUTH_L], lms[MOUTH_R]);
  return vert / (3 * horiz + 1e-6);
}

export function calcHeadAngle(lms) {
  const dx = lms[FOREHEAD].x - lms[NOSE_TIP].x;
  const dy = lms[FOREHEAD].y - lms[NOSE_TIP].y;
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}

export function earColor(ear) {
  if (ear >= EAR_OPEN)     return '#00dc00';
  if (ear >= EAR_DROOPING) return '#dcdc00';
  return '#dc0000';
}

export function scoreColor(pct) {
  if (pct < 40) return '#00dc00';
  if (pct < 70) return '#dcdc00';
  return '#dc0000';
}

// ── Stateful detection ────────────────────────────────────────────────────────
export class DetectionState {
  constructor() {
    this.blinkStart  = null;
    this.lastBlinkMs = 0;
    this.yawnStart   = null;
    this.yawnActive  = false;
    this.yawnTs      = [];
    this.lastScore   = 0;
  }

  update(lms, now = Date.now()) {
    const rightEar  = calcEAR(lms, RIGHT_EYE);
    const leftEar   = calcEAR(lms, LEFT_EYE);
    const avgEar    = (leftEar + rightEar) / 2;
    const mar       = calcMAR(lms);
    const headAngle = calcHeadAngle(lms);

    // Eye closure 0→1
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
    let yawnJustDetected = false;
    if (mar > MAR_YAWN_THRESH) {
      if (this.yawnStart === null) this.yawnStart = now;
      else if (!this.yawnActive && (now - this.yawnStart) >= YAWN_MIN_MS) {
        this.yawnTs.push(now);
        this.yawnActive  = true;
        yawnJustDetected = true;
      }
    } else {
      this.yawnStart  = null;
      this.yawnActive = false;
    }

    // Evict old yawns
    const cutoff = now - YAWN_WINDOW_MS;
    this.yawnTs  = this.yawnTs.filter(t => t > cutoff);
    const yawnScore = Math.min(1, this.yawnTs.length / MAX_YAWNS_WIN);

    const headScore = Math.min(1, Math.abs(headAngle) / MAX_HEAD_DEG);

    const drowsinessScore = (
      0.4 * eyeScore +
      0.2 * headScore +
      0.2 * blinkScore +
      0.2 * yawnScore
    ) * 100;

    this.lastScore = drowsinessScore;

    return { leftEar, rightEar, mar, headAngle,
             blinkDuration: this.lastBlinkMs,
             yawnCount: this.yawnTs.length,
             drowsinessScore,
             yawnJustDetected };
  }
}
