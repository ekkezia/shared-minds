import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup, // Note: You should use the destructured version below.
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

let app;

// ---------- Firebase setup ----------
function initFirebase() {
  const firebaseConfig = {
    apiKey: 'AIzaSyB7_77ud3zCl2H8JHs8e6MgmirSCccJiQE',
    authDomain: 'bye-bye-user.firebaseapp.com',
    databaseURL: 'https://bye-bye-user-default-rtdb.firebaseio.com',
    projectId: 'bye-bye-user',
    storageBucket: 'bye-bye-user.firebasestorage.app',
    messagingSenderId: '60912834119',
    appId: '1:60912834119:web:6f2ab9ca78309492c20362',
  };
  app = initializeApp(firebaseConfig, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  });
  //make a folder in your firebase for this example
}
// Initialize app (The extra options are for environment recovery, keep them.)
initFirebase();

const auth = getAuth(app); // Pass the app instance
const db = getFirestore(app); // Pass the app instance

// Get references to the 'users' collection
const usersCollectionRef = collection(db, 'users');
console.log('usersCollectionRef', usersCollectionRef);

// // ---------- Canvas setup (Rest of this section is fine) ----------
const canvas =
  document.getElementById('canvas') ||
  (() => {
    const c = document.createElement('canvas');
    c.id = 'canvas';
    document.body.appendChild(c);
    return c;
  })();
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// ensure timeline bar exists (create fallback)
let timelineBar = document.getElementById('timeline-bar');
if (!timelineBar) {
  const wrapper = document.createElement('div');
  wrapper.id = 'timeline-wrapper';
  Object.assign(wrapper.style, {
    position: 'fixed',
    bottom: '8px',
    left: '8px',
    right: '8px',
    height: '8px',
    background: 'rgba(0,0,0,0.15)',
  });
  const bar = document.createElement('div');
  bar.id = 'timeline-bar';
  Object.assign(bar.style, {
    height: '100%',
    width: '0%',
    background: '#4caf50',
  });
  wrapper.appendChild(bar);
  document.body.appendChild(wrapper);
  timelineBar = bar;
}

// ensure info panel exists (create fallback)
let info = document.getElementById('info');
if (!info) {
  info = document.createElement('div');
  info.id = 'info';
  Object.assign(info.style, {
    position: 'fixed',
    right: '12px',
    top: '12px',
    padding: '8px 12px',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    fontSize: '12px',
    borderRadius: '6px',
    zIndex: 9999,
  });
  document.body.appendChild(info);
}

// If your script runs before DOM is ready, ensure layout sizes update after load
window.addEventListener('DOMContentLoaded', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// ---------- App state ----------
let users = []; // local cache of users from Firestore
let globalStartTime = null;
let globalTimer = 10; // starts at 10s for first user

let lastClickPos = null; // { x, y }
let clickMarker = null; // { x, y, w, h }

// ---------- Camera init (new) ----------
let videoStream = null;
let previewVideo = null;

// initialize camera early so permission is requested on load and captureFace is ready
async function initCamera() {
  try {
    // ask permission and start stream
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    previewVideo = document.createElement('video');
    previewVideo.autoplay = true;
    previewVideo.playsInline = true;
    previewVideo.muted = true;
    previewVideo.srcObject = videoStream;
    // wait until video has metadata (dimensions) and is playing
    await new Promise((resolve) => {
      previewVideo.onloadedmetadata = () => {
        // try to start playback (some browsers require explicit play)
        previewVideo.play().catch(() => {});
        resolve();
      };
    });
    console.log('Camera initialized and ready');
  } catch (err) {
    console.warn('Camera initialization failed or permission denied:', err);
    videoStream = null;
    previewVideo = null;
  }
}

// stop camera when page unloads
function cleanupCamera() {
  try {
    if (videoStream && videoStream.getTracks) {
      videoStream.getTracks().forEach((t) => t.stop());
    }
  } catch (err) {
    console.warn('Error cleaning up camera', err);
  }
}
window.addEventListener('beforeunload', cleanupCamera);

// Call initCamera early (after firebase init is fine)
initCamera();

// ---------- Helper: capture face (updated to reuse previewVideo) ----------
async function captureFace() {
  try {
    // If camera not started yet, try to init now
    if (!previewVideo) {
      await initCamera();
    }
    if (!previewVideo) {
      throw new Error('Camera not available');
    }

    const tempCanvas = document.createElement('canvas');
    const w = 128;
    const h = 128;
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');

    // draw current frame from the shared preview video
    tempCtx.drawImage(previewVideo, 0, 0, w, h);

    const img = new Image();
    img.src = tempCanvas.toDataURL('image/png');
    await new Promise((r) => (img.onload = r));
    lastClickPos = {
      ...lastClickPos,
      imgData: img.src,
    };
    return img;
  } catch (err) {
    console.error('captureFace failed:', err);
    throw err;
  }
}

// ---------- Click to submit (FIXED) ----------
canvas.addEventListener('click', async (e) => {
  // compute coordinates relative to the canvas
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);

  // save to local var and set a visual marker
  lastClickPos = { x, y };
  // marker: centered on the click, 100x100 px by default
  clickMarker = { x, y, w: 100, h: 100 };

  // capture webcam snapshot immediately for preview and save to lastClickPos
  try {
    // captureFace will set lastClickPos.imgData and return an Image
    const capturedImg = await captureFace();
    console.log('last click pos after capture:', lastClickPos);

    // cache image object for drawing in animate()
    if (lastClickPos && lastClickPos.imgData) {
      const previewImg = new Image();
      await new Promise((resolve, reject) => {
        previewImg.onload = resolve;
        previewImg.onerror = reject;
        previewImg.src = lastClickPos.imgData;
      });
      lastClickPos.imgObj = previewImg;
      lastClickPos.imgReady = true;
      // request a frame so animate() will draw the cached image
      requestAnimationFrame(() => {});
    }
  } catch (capErr) {
    console.error('Failed to capture preview image:', capErr);
    lastClickPos.imgData = null;
    lastClickPos.imgReady = false;
  }

  // Trigger Firebase Google Auth and save user with click position + captured image
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const authTime = Date.now();

    // Ensure we have an image to save; fallback to captureFace() if needed
    if (!lastClickPos?.imgData) {
      try {
        const fallbackImg = await captureFace();
        lastClickPos = {
          ...lastClickPos,
          imgData: fallbackImg.src,
          imgObj: fallbackImg,
          imgReady: true,
        };
      } catch (fallbackErr) {
        console.warn('No preview image available to save:', fallbackErr);
      }
    }

    // Save to Firestore
    await setDoc(doc(db, 'users', user.uid), {
      email: user.email || null,
      x: lastClickPos ? lastClickPos.x : x,
      y: lastClickPos ? lastClickPos.y : y,
      authTime,
      imgData: lastClickPos?.imgData || null,
    });

    // Update global start time if first user
    if (!globalStartTime) globalStartTime = authTime;

    console.log('User saved to Firestore:', user.uid);
  } catch (authErr) {
    console.error('Authentication or save failed:', authErr);
  }

  // ensure the UI updates immediately
  requestAnimationFrame(() => {});
});

// ---------- Listen for changes in Firestore (FIXED) ----------
onSnapshot(usersCollectionRef, (snapshot) => {
  // Use imported function and collection ref
  users = [];
  snapshot.forEach((doc) => {
    users.push(doc.data());
  });
  globalTimer = 10 * users.length; // update global timer
});

// --- Timeline scrubber UI (video-like) ---
const timelineBarEl = timelineBar; // existing element
const timelineContainer = timelineBarEl ? timelineBarEl.parentElement : null;

// create scrubber elements if container exists
let scrubberKnob = null;
let expiryLabel = null;
let scrubPreviewLabel = null;
let isScrubbing = false;
let scrubPercent = null; // null = no manual scrub, otherwise 0..1

if (timelineContainer) {
  // ensure container has relative positioning
  timelineContainer.style.position =
    timelineContainer.style.position || 'relative';
  timelineContainer.style.userSelect = 'none';

  // knob
  scrubberKnob = document.createElement('div');
  scrubberKnob.id = 'scrubber-knob';
  Object.assign(scrubberKnob.style, {
    position: 'absolute',
    top: '-6px',
    width: '12px',
    height: '24px',
    background: '#fff',
    borderRadius: '2px',
    boxShadow: '0 0 6px rgba(0,0,0,0.4)',
    transform: 'translateX(-50%)',
    cursor: 'pointer',
    zIndex: 20,
  });
  timelineContainer.appendChild(scrubberKnob);

  // expiry label (right end)
  expiryLabel = document.createElement('div');
  expiryLabel.id = 'timeline-expiry';
  Object.assign(expiryLabel.style, {
    position: 'absolute',
    right: '0',
    top: '-28px',
    color: '#fff',
    fontSize: '12px',
    background: 'rgba(0,0,0,0.5)',
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: 20,
    whiteSpace: 'nowrap',
  });
  timelineContainer.appendChild(expiryLabel);

  // scrub preview label (follows knob when scrubbing)
  scrubPreviewLabel = document.createElement('div');
  scrubPreviewLabel.id = 'scrub-preview';
  Object.assign(scrubPreviewLabel.style, {
    position: 'absolute',
    top: '-52px',
    color: '#fff',
    fontSize: '12px',
    background: 'rgba(0,0,0,0.6)',
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: 25,
    whiteSpace: 'nowrap',
    display: 'none',
    transform: 'translateX(-50%)',
  });
  timelineContainer.appendChild(scrubPreviewLabel);

  // pointer handling (supports mouse/touch)
  function percentFromClientX(clientX) {
    const rect = timelineContainer.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return rect.width > 0 ? x / rect.width : 0;
  }

  function updateScrubberPosition(percent) {
    const rect = timelineContainer.getBoundingClientRect();
    const px = percent * rect.width;
    scrubberKnob.style.left = px + 'px';
    // update preview label position & text
    if (scrubPreviewLabel.style.display !== 'none') {
      scrubPreviewLabel.style.left = px + 'px';
    }
  }

  // pointer down on knob or container to begin scrubbing
  scrubberKnob.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    isScrubbing = true;
    scrubberKnob.setPointerCapture(ev.pointerId);
    scrubPreviewLabel.style.display = 'block';
    const p = percentFromClientX(ev.clientX);
    scrubPercent = p;
    updateScrubberPosition(p);
  });

  timelineContainer.addEventListener('pointerdown', (ev) => {
    // clicking the bar seeks (shows preview but does not change app state)
    if (ev.target === scrubberKnob) return;
    isScrubbing = true;
    scrubPreviewLabel.style.display = 'block';
    const p = percentFromClientX(ev.clientX);
    scrubPercent = p;
    updateScrubberPosition(p);
  });

  window.addEventListener('pointermove', (ev) => {
    if (!isScrubbing) return;
    const p = percentFromClientX(ev.clientX);
    scrubPercent = p;
    updateScrubberPosition(p);
  });

  window.addEventListener('pointerup', (ev) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    scrubPreviewLabel.style.display = 'none';
    // leave scrubPercent set (so animate shows preview) for short time, then clear
    setTimeout(() => {
      scrubPercent = null;
    }, 1500);
  });
}

// --- Helper: format timestamp to readable time ---
function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

// --- Update animate() to integrate scrubber logic and expiry label ---
const originalAnimate = animate;
function animate() {
  // call original drawing logic (users, preview, marker, etc.)
  // we inline the existing animate code (avoid double-definition) by copying
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const now = Date.now();

  users.forEach((user, index) => {
    const elapsed = now - user.authTime;
    const total = globalTimer * 1000;
    const progress = Math.min(elapsed / total, 1);

    const offset = progress * 200;
    const angle = (index / users.length) * Math.PI * 2;

    const drawX = user.x + Math.cos(angle) * offset;
    const drawY = user.y + Math.sin(angle) * offset;

    // draw user image if available
    if (user.imgObj && user.imgObj.complete) {
      ctx.drawImage(user.imgObj, drawX - 64, drawY - 64, 128, 128);
    } else if (user.imgData) {
      const tmpImg = new Image();
      tmpImg.src = user.imgData;
      tmpImg.onload = () => {
        user.imgObj = tmpImg;
        ctx.drawImage(tmpImg, drawX - 64, drawY - 64, 128, 128);
      };
    }
  });

  // draw preview or dispersion (existing logic)
  if (lastClickPos && lastClickPos.imgObj && lastClickPos.imgReady) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const w = 128;
    const h = 128;
    ctx.drawImage(
      lastClickPos.imgObj,
      lastClickPos.x - w / 2,
      lastClickPos.y - h / 2,
      w,
      h,
    );
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // draw the click marker if present
  if (clickMarker) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(
      clickMarker.x - clickMarker.w / 2,
      clickMarker.y - clickMarker.h / 2,
      clickMarker.w,
      clickMarker.h,
    );
    ctx.restore();
  }

  // Timeline bar and scrubber updates
  const firstAuth = users[0]?.authTime || now;
  const totalTime = Math.max(1, globalTimer) * 1000;
  const elapsedGlobal = now - firstAuth;
  const percent = Math.min(elapsedGlobal / totalTime, 1);

  // if user is scrubbing show scrubPercent else show live percent
  const displayPercent = scrubPercent !== null ? scrubPercent : percent;
  timelineBarEl.style.width =
    Math.max(0, Math.min(1, displayPercent)) * 100 + '%';

  // position knob according to displayPercent
  if (scrubberKnob && timelineContainer) {
    updateScrubberPosition(displayPercent);
  }

  // expiry time (end of timeline) shown at right
  const endTs = firstAuth + totalTime;
  if (expiryLabel) expiryLabel.textContent = formatTime(endTs);

  // scrub preview label: show estimated expiry time if scrubbing
  if (scrubPreviewLabel && scrubPercent !== null) {
    const previewEnd = firstAuth + scrubPercent * totalTime;
    scrubPreviewLabel.textContent = formatTime(previewEnd);
    scrubPreviewLabel.style.display = 'block';
  }

  // Info display (unchanged, but include estimated expiry time)
  const timeLeft = Math.max(((totalTime - elapsedGlobal) / 1000).toFixed(1), 0);
  info.innerHTML = `
    Time starts at: ${
      globalStartTime ? new Date(globalStartTime).toUTCString() : '-'
    }<br>
    1 person expires in 10s<br>
    ${users.length} people expire in ${globalTimer}s<br>
    Time left: ${timeLeft}s
  `;

  requestAnimationFrame(animate);
}

// replace previous animate call with this new one
requestAnimationFrame(animate);
