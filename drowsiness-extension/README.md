## Setup

### 1. Install vendor files

```bash
cd drowsiness-extension
npm install
node setup.js
```

This copies MediaPipe Face Mesh WASM and JS files from `node_modules` into `vendor/`. The `vendor/` directory must exist before loading the extension.

### 2. Load the extension in Chrome

1. Open **chrome://extensions**
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `drowsiness-extension/` folder

The extension icon will appear in the Chrome toolbar.

### 3. Grant camera access

The first time the extension runs it will request webcam access.

- A camera permission prompt will appear — click **Allow**
- If you miss the prompt, click the camera icon in the address bar to grant access manually
- If camera access is denied, go to **chrome://settings/content/camera** and allow `chrome-extension://` origins

### 4. Open the debug view

Click the extension icon → **Open Debug View**

This opens a full-page tab showing:
- Live webcam feed with landmark overlays
- Color-coded eyes (green → yellow → red by EAR)
- Cyan mouth outline with MAR tracking
- Orange nose–forehead head tilt line
- Live metrics panel (EAR, MAR, head angle, blink duration, yawn count, drowsiness %)
- Color-coded drowsiness bar at the bottom

## File structure

```
drowsiness-extension/
├── manifest.json       MV3 manifest
├── background.js       Service worker — manages offscreen doc and stores state
├── offscreen.html      Hidden page with webcam + MediaPipe (background processing)
├── offscreen.js        Detection loop, sends metrics to background every 100 ms
├── detection.js        Shared constants, EAR/MAR/head math, DetectionState class
├── popup.html          Toolbar popup UI
├── popup.js            Popup logic — polls background for state
├── popup.css           Popup styles
├── debug.html          Full debug view page
├── debug.js            Debug canvas rendering with all landmark overlays
├── package.json        npm config for @mediapipe/face_mesh
├── setup.js            Copies vendor files from node_modules
└── vendor/             MediaPipe WASM + JS files (created by setup.js)
```
