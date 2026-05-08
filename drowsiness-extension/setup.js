// Copies @mediapipe/tasks-vision files into vendor/ and downloads the model.
// Run: node setup.js   (after npm install)

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const TV   = path.join(__dirname, 'node_modules', '@mediapipe', 'tasks-vision');
const DEST = path.join(__dirname, 'vendor');
const WASM = path.join(DEST, 'wasm');

if (!fs.existsSync(TV)) {
  console.error('ERROR: node_modules/@mediapipe/tasks-vision not found.');
  console.error('Run  npm install  first.');
  process.exit(1);
}

fs.mkdirSync(WASM, { recursive: true });

// 1. Copy the ES module bundle (used by offscreen.js and debug.js)
fs.copyFileSync(path.join(TV, 'vision_bundle.mjs'), path.join(DEST, 'vision_bundle.mjs'));
console.log('  ✓  vision_bundle.mjs');

// 2. Copy all WASM files
for (const f of fs.readdirSync(path.join(TV, 'wasm'))) {
  fs.copyFileSync(path.join(TV, 'wasm', f), path.join(WASM, f));
  console.log(`  ✓  wasm/${f}`);
}

// 3. Download face_landmarker.task model (~4 MB) if not already present
const MODEL_DEST = path.join(DEST, 'face_landmarker.task');
const MODEL_URL  =
  'https://storage.googleapis.com/mediapipe-models/' +
  'face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

if (fs.existsSync(MODEL_DEST)) {
  console.log('  ✓  face_landmarker.task (already present)');
  done();
} else {
  console.log('  ↓  Downloading face_landmarker.task (~4 MB)…');
  const file = fs.createWriteStream(MODEL_DEST);
  https.get(MODEL_URL, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      https.get(res.headers.location, (r) => r.pipe(file));
    } else {
      res.pipe(file);
    }
    file.on('finish', () => { file.close(); console.log('  ✓  face_landmarker.task'); done(); });
  }).on('error', (e) => {
    fs.unlinkSync(MODEL_DEST);
    console.error('Download failed:', e.message);
    process.exit(1);
  });
}

function done() {
  console.log('\nVendor files ready. Reload the extension in Chrome.');
}
