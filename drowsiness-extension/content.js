'use strict';

if (!window.__drowsyOverlayLoaded) {
  window.__drowsyOverlayLoaded = true;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_OVERLAY') showOverlay(msg.bgDataURL, msg.userDataURL);
  });
}

function showOverlay(bgDataURL, userDataURL) {
  document.getElementById('__drowsy-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__drowsy-overlay';
  Object.assign(overlay.style, {
    position:       'fixed',
    inset:          '0',
    zIndex:         '2147483647',
    background:     '#000',
    opacity:        '1',
    transition:     'opacity 0.5s ease',
    pointerEvents:  'none',
  });

  const makeImg = (src) => {
    const img = document.createElement('img');
    img.src = src;
    Object.assign(img.style, {
      position:   'absolute',
      inset:      '0',
      width:      '100%',
      height:     '100%',
      objectFit:  'cover',
    });
    return img;
  };

  overlay.appendChild(makeImg(bgDataURL));   // room without user
  overlay.appendChild(makeImg(userDataURL)); // user without room
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 500);
  }, 3000);
}
