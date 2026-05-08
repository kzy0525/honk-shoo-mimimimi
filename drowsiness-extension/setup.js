// Copies @mediapipe/face_mesh files from node_modules into vendor/
// Run: node setup.js   (after npm install)

const fs   = require('fs');
const path = require('path');

const src  = path.join(__dirname, 'node_modules', '@mediapipe', 'face_mesh');
const dest = path.join(__dirname, 'vendor');

if (!fs.existsSync(src)) {
  console.error('ERROR: node_modules/@mediapipe/face_mesh not found.');
  console.error('Run  npm install  first.');
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });

let copied = 0;
for (const file of fs.readdirSync(src)) {
  const ext = path.extname(file);
  // Copy JS, WASM, binary data, and model files only
  if (['.js', '.wasm', '.data', '.binarypb', '.tflite'].includes(ext)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
    console.log(`  ✓  ${file}`);
    copied++;
  }
}

console.log(`\nCopied ${copied} files to vendor/`);
console.log('You can now load the extension in Chrome.');
