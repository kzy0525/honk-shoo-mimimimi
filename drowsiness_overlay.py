#!/usr/bin/env python3
"""
Drowsiness Detection Overlay — Phase 1
Real-time facial landmark visualization with drowsiness metrics via webcam.
Press 'q' to quit.
"""

import os
import time
import urllib.request
from collections import deque

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions

# ── Model download (runs once, ~6 MB) ─────────────────────────────────────────
_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_landmarker.task")
_MODEL_URL  = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
)

def _ensure_model():
    if not os.path.exists(_MODEL_PATH):
        print("Downloading face landmarker model (~6 MB) ...")
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
        print("Model ready.")

# ── Landmark index groups ──────────────────────────────────────────────────────
# Eye points ordered for EAR: [outer, upper-outer, upper-inner, inner, lower-inner, lower-outer]
RIGHT_EYE = [33, 160, 158, 133, 153, 144]
LEFT_EYE  = [362, 385, 387, 263, 373, 380]

# Mouth corners and vertical pairs used for MAR
MOUTH_L    = 61
MOUTH_R    = 291
MOUTH_TL   = 82   # upper-left inner
MOUTH_BL   = 87   # lower-left inner
MOUTH_TC   = 13   # upper-center inner
MOUTH_BC   = 14   # lower-center inner
MOUTH_TR   = 312  # upper-right inner
MOUTH_BR   = 317  # lower-right inner

# Outer lip contour for drawing (closed polygon)
MOUTH_OUTLINE = [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
    291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
]

NOSE_TIP = 1
FOREHEAD = 10

# ── Thresholds ─────────────────────────────────────────────────────────────────
EAR_OPEN     = 0.27   # fully open
EAR_DROOPING = 0.22   # starting to droop
EAR_CLOSED   = 0.15   # effectively closed

MAR_YAWN_THRESH   = 0.5
YAWN_MIN_SECS     = 2.0    # MAR must stay above threshold this long to register
YAWN_WINDOW_SECS  = 300    # count yawns in last 5 minutes

MAX_HEAD_DEG  = 30.0   # tilt degrees → score 1.0
MAX_BLINK_MS  = 800.0  # blink ms     → score 1.0
MAX_YAWNS_WIN = 5      # yawns in window → score 1.0

DROWSY_SCORE_PCT  = 70.0
DROWSY_HOLD_SECS  = 2.0

# ── Colors (BGR) ──────────────────────────────────────────────────────────────
C_GREEN  = (0, 220, 0)
C_YELLOW = (0, 220, 220)
C_RED    = (0, 0, 220)
C_WHITE  = (255, 255, 255)
C_BLACK  = (0, 0, 0)
C_CYAN   = (220, 220, 0)
C_ORANGE = (0, 140, 255)
C_GRAY   = (120, 120, 120)

FONT = cv2.FONT_HERSHEY_SIMPLEX


# ── Helpers ────────────────────────────────────────────────────────────────────

def lm_px(lm, w, h):
    return (int(lm.x * w), int(lm.y * h))


def vdist(a, b):
    return np.linalg.norm(np.array(a, float) - np.array(b, float))


def ear_color(ear):
    if ear >= EAR_OPEN:
        return C_GREEN
    if ear >= EAR_DROOPING:
        return C_YELLOW
    return C_RED


def calc_ear(pts):
    p = [np.array(p, float) for p in pts]
    vert = vdist(p[1], p[5]) + vdist(p[2], p[4])
    horiz = vdist(p[0], p[3])
    return vert / (2.0 * horiz + 1e-6)


def draw_eye_overlay(frame, pts, color):
    n = len(pts)
    for i in range(n):
        cv2.line(frame, pts[i], pts[(i + 1) % n], color, 1, cv2.LINE_AA)
    for p in pts:
        cv2.circle(frame, p, 3, color, -1, cv2.LINE_AA)


def put_label(frame, text, row, color=C_WHITE, scale=0.58, thick=1, x=12):
    y = 28 + row * 26
    cv2.putText(frame, text, (x, y), FONT, scale, C_BLACK, thick + 2, cv2.LINE_AA)
    cv2.putText(frame, text, (x, y), FONT, scale, color,  thick,     cv2.LINE_AA)


def center_text(frame, text, cy, scale, color, thick):
    (tw, th), _ = cv2.getTextSize(text, FONT, scale, thick)
    x = (frame.shape[1] - tw) // 2
    y = cy + th // 2
    cv2.putText(frame, text, (x, y), FONT, scale, C_BLACK, thick + 2, cv2.LINE_AA)
    cv2.putText(frame, text, (x, y), FONT, scale, color,  thick,     cv2.LINE_AA)


def score_bar(frame, value_pct, x, y, w, h):
    """Draw a green→yellow→red progress bar."""
    cv2.rectangle(frame, (x, y), (x + w, y + h), C_GRAY, -1)
    fill = int(w * min(value_pct, 100) / 100.0)
    if value_pct < 40:
        color = C_GREEN
    elif value_pct < 70:
        color = C_YELLOW
    else:
        color = C_RED
    if fill > 0:
        cv2.rectangle(frame, (x, y), (x + fill, y + h), color, -1)
    cv2.rectangle(frame, (x, y), (x + w, y + h), C_WHITE, 1)


# ── Main ───────────────────────────────────────────────────────────────────────

def _pick_camera():
    """Return an opened VideoCapture, letting the user choose if >1 camera found."""
    found = []
    for i in range(6):
        c = cv2.VideoCapture(i)
        if c.isOpened():
            found.append(i)
            c.release()

    if not found:
        return None

    if len(found) == 1:
        return cv2.VideoCapture(found[0])

    print("\nMultiple cameras detected:")
    for idx in found:
        print(f"  [{idx}] Camera {idx}")
    while True:
        try:
            choice = int(input(f"Select camera index {found}: "))
            if choice in found:
                return cv2.VideoCapture(choice)
        except (ValueError, EOFError):
            pass
        print("Invalid choice, try again.")


def main():
    _ensure_model()

    cap = _pick_camera()
    if cap is None or not cap.isOpened():
        print("Error: cannot open webcam.")
        return

    # Blink tracking
    blink_start    = None
    last_blink_ms  = 0.0

    # Yawn tracking
    yawn_start      = None
    yawn_active     = False
    yawn_timestamps = deque()   # timestamps of confirmed yawns
    yawn_flash_end  = 0.0       # when to stop flashing "YAWN DETECTED"

    # Drowsy alert tracking
    drowsy_start  = None
    drowsy_alert  = False

    options = FaceLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=_MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    t0_ms = int(time.time() * 1000)

    with FaceLandmarker.create_from_options(options) as landmarker:

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            now  = time.time()

            # Semi-transparent HUD background (left panel)
            panel_w = 230
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, 0), (panel_w, 26 * 7 + 14), C_BLACK, -1)
            cv2.addWeighted(overlay, 0.45, frame, 0.55, 0, frame)

            rgb      = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            ts_ms    = int(time.time() * 1000) - t0_ms
            result   = landmarker.detect_for_video(mp_image, ts_ms)

            # Defaults (no face)
            left_ear = right_ear = mar = head_angle = 0.0
            eye_score = blink_score = head_score = yawn_score = 0.0

            if result.face_landmarks:
                lms = result.face_landmarks[0]

                def px(idx):
                    return lm_px(lms[idx], w, h)

                def np_pt(idx):
                    return np.array([lms[idx].x * w, lms[idx].y * h])

                # ── Eyes ──────────────────────────────────────────────────────
                r_pts = [px(i) for i in RIGHT_EYE]
                l_pts = [px(i) for i in LEFT_EYE]
                right_ear = calc_ear(r_pts)
                left_ear  = calc_ear(l_pts)
                avg_ear   = (left_ear + right_ear) / 2.0

                draw_eye_overlay(frame, r_pts, ear_color(right_ear))
                draw_eye_overlay(frame, l_pts, ear_color(left_ear))

                # Eye closure score 0→1
                if avg_ear >= EAR_OPEN:
                    eye_score = 0.0
                elif avg_ear <= EAR_CLOSED:
                    eye_score = 1.0
                else:
                    eye_score = (EAR_OPEN - avg_ear) / (EAR_OPEN - EAR_CLOSED)

                # ── Blink duration ─────────────────────────────────────────────
                if avg_ear < EAR_CLOSED:
                    if blink_start is None:
                        blink_start = now
                else:
                    if blink_start is not None:
                        dur = (now - blink_start) * 1000.0
                        if dur > 40:          # ignore noise < 40 ms
                            last_blink_ms = dur
                        blink_start = None

                blink_score = min(1.0, last_blink_ms / MAX_BLINK_MS)

                # ── Mouth / MAR ────────────────────────────────────────────────
                tl = np_pt(MOUTH_TL); bl = np_pt(MOUTH_BL)
                tc = np_pt(MOUTH_TC); bc = np_pt(MOUTH_BC)
                tr = np_pt(MOUTH_TR); br = np_pt(MOUTH_BR)
                lc = np_pt(MOUTH_L);  rc = np_pt(MOUTH_R)

                vert  = vdist(tl, bl) + vdist(tc, bc) + vdist(tr, br)
                horiz = vdist(lc, rc)
                mar   = vert / (3.0 * horiz + 1e-6)

                # Draw mouth outline
                m_pts = [px(i) for i in MOUTH_OUTLINE]
                for i in range(len(m_pts)):
                    cv2.line(frame, m_pts[i], m_pts[(i + 1) % len(m_pts)], C_CYAN, 1, cv2.LINE_AA)
                for p in m_pts:
                    cv2.circle(frame, p, 2, C_CYAN, -1, cv2.LINE_AA)

                # ── Yawn logic ─────────────────────────────────────────────────
                if mar > MAR_YAWN_THRESH:
                    if yawn_start is None:
                        yawn_start = now
                    elif not yawn_active and (now - yawn_start) >= YAWN_MIN_SECS:
                        yawn_timestamps.append(now)
                        yawn_active    = True
                        yawn_flash_end = now + 3.0
                else:
                    yawn_start  = None
                    yawn_active = False

                # Evict yawns outside the rolling window
                cutoff = now - YAWN_WINDOW_SECS
                while yawn_timestamps and yawn_timestamps[0] < cutoff:
                    yawn_timestamps.popleft()

                yawn_score = min(1.0, len(yawn_timestamps) / MAX_YAWNS_WIN)

                # ── Head tilt ──────────────────────────────────────────────────
                nose_pt = px(NOSE_TIP)
                fore_pt = px(FOREHEAD)
                dx = fore_pt[0] - nose_pt[0]
                dy = fore_pt[1] - nose_pt[1]
                # angle from vertical; positive = tilted right in mirrored image
                head_angle = float(np.degrees(np.arctan2(dx, -dy)))

                cv2.line(frame, nose_pt, fore_pt, C_ORANGE, 2, cv2.LINE_AA)
                cv2.circle(frame, nose_pt, 4, C_ORANGE, -1, cv2.LINE_AA)
                cv2.circle(frame, fore_pt, 4, C_ORANGE, -1, cv2.LINE_AA)

                head_score = min(1.0, abs(head_angle) / MAX_HEAD_DEG)

            else:
                put_label(frame, "NO FACE DETECTED", 0, C_RED)

            # ── Drowsiness score ────────────────────────────────────────────────
            drowsiness = (
                0.4 * eye_score   +
                0.2 * head_score  +
                0.2 * blink_score +
                0.2 * yawn_score
            ) * 100.0

            if drowsiness >= DROWSY_SCORE_PCT:
                if drowsy_start is None:
                    drowsy_start = now
                drowsy_alert = (now - drowsy_start) >= DROWSY_HOLD_SECS
            else:
                drowsy_start = None
                drowsy_alert = False

            # ── HUD metrics ────────────────────────────────────────────────────
            yawn_count = len(yawn_timestamps)

            d_color = C_RED if drowsiness >= 70 else C_YELLOW if drowsiness >= 40 else C_GREEN

            put_label(frame, f"Left  EAR : {left_ear:.3f}",     0, ear_color(left_ear))
            put_label(frame, f"Right EAR : {right_ear:.3f}",    1, ear_color(right_ear))
            put_label(frame, f"MAR       : {mar:.3f}",          2, C_CYAN)
            put_label(frame, f"Head Tilt : {head_angle:+.1f}d", 3, C_ORANGE)
            put_label(frame, f"Blink Dur : {last_blink_ms:.0f} ms", 4, C_WHITE)
            put_label(frame, f"Yawns/5m  : {yawn_count}",       5, C_YELLOW)
            put_label(frame, f"Drowsy    : {drowsiness:.1f}%",  6, d_color, scale=0.65, thick=2)

            # ── Drowsiness bar ─────────────────────────────────────────────────
            bx, bh = 10, 22
            by = h - bh - 10
            bw = w - 20
            score_bar(frame, drowsiness, bx, by, bw, bh)
            put_label(frame, "DROWSINESS", 0, C_WHITE, scale=0.42, thick=1, x=bx + 6)
            # reposition label inside bar
            cv2.putText(frame, "DROWSINESS",
                        (bx + 6, by + bh - 5), FONT, 0.42, C_WHITE, 1, cv2.LINE_AA)

            # ── Alert overlays ─────────────────────────────────────────────────
            if now < yawn_flash_end:
                # Flash ~2.5 times per second
                if int(now * 2.5) % 2 == 0:
                    center_text(frame, "YAWN DETECTED", h // 2 - 60, 1.2, C_YELLOW, 3)

            if drowsy_alert:
                center_text(frame, "DROWSY DETECTED", h // 2 + 20, 1.5, C_RED, 4)

            cv2.imshow("Drowsiness Detector — press Q to quit", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
