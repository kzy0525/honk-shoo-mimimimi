// Copies @mediapipe/tasks-vision files into vendor/ and downloads models.
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

// 3. Download models
const MODELS = [
  {
    dest: 'face_landmarker.task',
    url:  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
    size: '~4 MB',
  },
  {
    dest: 'selfie_segmenter.tflite',
    url:  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    size: '~1.6 MB',
  },
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { try { fs.unlinkSync(destPath); } catch (_) {} reject(e); });
    get(url);
  });
}

async function main() {
  for (const { dest, url, size } of MODELS) {
    const destPath = path.join(DEST, dest);
    if (fs.existsSync(destPath)) {
      console.log(`  ✓  ${dest} (already present)`);
    } else {
      console.log(`  ↓  Downloading ${dest} (${size})…`);
      await downloadFile(url, destPath);
      console.log(`  ✓  ${dest}`);
    }
  }
  console.log('\nVendor files ready. Reload the extension in Chrome.');
}

main().catch(e => { console.error('Download failed:', e.message); process.exit(1); });
