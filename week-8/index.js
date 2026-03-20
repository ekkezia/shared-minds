import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  orderByKey,
  query,
  onValue,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js';

import {
  getStorage,
  ref as storageRef,
  uploadString,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAG37DSc7Bk9tDs5IKclkVssX4B7r5hKZs',
  authDomain: 'd-capture-fbe10.firebaseapp.com',
  projectId: 'd-capture-fbe10',
  storageBucket: 'd-capture-fbe10.firebasestorage.app',
  messagingSenderId: '568641897239',
  appId: '1:568641897239:web:0d023a918f0584d785ed52',
  measurementId: 'G-LEVT61DMCK',
};

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.1/three.module.min.js';
import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.18/+esm';

// --- Firebase ---
let firebaseApp = null;
let database = null;
let storage = null;
initFirebase();

let currentPos = null;
const UPLOAD_TO_FIREBASE = true;

async function initFirebase() {
  firebaseApp = initializeApp(firebaseConfig);
  database = getDatabase(firebaseApp);
  storage = getStorage(firebaseApp);
}

// --- GUI ---
const gui = new GUI({ width: 300 });
gui.domElement.style.display = 'none';

const cameraRotation = { x: 0, y: 0, z: 0 };
const rotationFolder = gui.addFolder('Camera Rig Rotation');
rotationFolder.add(cameraRotation, 'x', -Math.PI, Math.PI, 0.01).name('Rotation X').onChange(updateCameraRotation);
rotationFolder.add(cameraRotation, 'y', -Math.PI, Math.PI, 0.01).name('Rotation Y').onChange(updateCameraRotation);
rotationFolder.add(cameraRotation, 'z', -Math.PI, Math.PI, 0.01).name('Rotation Z').onChange(updateCameraRotation);
rotationFolder.open();

function updateCameraRotation() {
  camera.rotation.x = cameraRotation.x;
  camera.rotation.y = cameraRotation.y;
  camera.rotation.z = cameraRotation.z;
  updateGyroUI();
}

// --- Device detection & gyro ---
const gyro = { alpha: null, beta: null, gamma: null, permission: 'unknown' };
let absSensor = null;
let absQuat = [null, null, null, null];
let absEuler = { x: null, y: null, z: null };
let usingAbsoluteSensor = false;

// --- Offset ---
let offsetAlpha = 0;
let offsetBeta = 0;
let offsetGamma = 0;

function quaternionToEuler(q) {
  let x = q[0], y = q[1], z = q[2], w = q[3];
  const ysqr = y * y;
  const t0 = +2.0 * (w * x + y * z);
  const t1 = +1.0 - 2.0 * (x * x + ysqr);
  const X = Math.atan2(t0, t1);
  let t2 = +2.0 * (w * y - z * x);
  t2 = t2 > 1 ? 1 : t2;
  t2 = t2 < -1 ? -1 : t2;
  const Y = Math.asin(t2);
  const t3 = +2.0 * (w * z + x * y);
  const t4 = +1.0 - 2.0 * (ysqr + z * z);
  const Z = Math.atan2(t3, t4);
  return { x: X * 180 / Math.PI, y: Y * 180 / Math.PI, z: Z * 180 / Math.PI };
}

function startSensors() {
  if ('AbsoluteOrientationSensor' in window) {
    try {
      absSensor = new AbsoluteOrientationSensor({ frequency: 60 });
      absSensor.addEventListener('reading', () => {
        absQuat = Array.from(absSensor.quaternion);
        absEuler = quaternionToEuler(absQuat);
        usingAbsoluteSensor = true;
        updateGyroUI();
      });
      absSensor.addEventListener('error', (event) => {
        console.warn('AbsoluteOrientationSensor error:', event.error);
        usingAbsoluteSensor = false;
      });
      absSensor.start();
      usingAbsoluteSensor = true;
      return;
    } catch (e) {
      console.warn('AbsoluteOrientationSensor not available:', e);
    }
  }
  // Fallback to deviceorientation
  window.addEventListener(
    'deviceorientation',
    (e) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      gyro.alpha = e.alpha;
      gyro.beta = e.beta;
      gyro.gamma = e.gamma;
      usingAbsoluteSensor = false;
      updateGyroUI();
      if (isMobile) updateCameraFromGyro();
    },
    true,
  );
}

if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
  window.addEventListener('click', () => startSensors(), { once: true });
  window.addEventListener('touchend', () => startSensors(), { once: true });
} else {
  startSensors();
}

const isMobile = (() => {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const ua = navigator.userAgent;
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isSmall = Math.min(window.innerWidth, window.innerHeight) < 768;
  return hasTouch && (mobileUA || isSmall);
})();

// --- Gyro UI ---
const gyroDiv =
  document.getElementById('gyro') ||
  (() => {
    const el = document.createElement('div');
    el.id = 'gyro';
    el.style.position = 'fixed';
    el.style.top = '10px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.zIndex = '4';
    el.style.background = 'rgba(0,0,0,0.7)';
    el.style.color = '#fff';
    el.style.padding = '8px 12px';
    el.style.borderRadius = '8px';
    el.style.fontFamily = 'monospace';
    el.style.fontSize = '12px';
    el.style.whiteSpace = 'pre';
    el.style.display = 'block';
    el.style.width = '100vw';
    el.style.boxSizing = 'border-box';
    document.body.appendChild(el);
    return el;
  })();

// --- Three.js setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

const originMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.1, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
);
originMarker.position.set(0, 0, -5);
scene.add(originMarker);

scene.add(new THREE.AxesHelper(2));

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('three-canvas'),
  alpha: true,
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;

// --- OrbitControls (desktop) ---
let controls = null;
async function setupControls() {
  if (isMobile) return;
  try {
    const { OrbitControls } = await import(
      'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls?deps=three@0.160.1'
    );
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.enabled = true;
    controls.update();
  } catch (err) {
    console.warn('OrbitControls not available:', err);
  }
}

// --- Gyro -> Camera ---
let lastQuat = null;

function deviceOrientationToQuat(alpha, beta, gamma) {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(beta - offsetBeta),
    THREE.MathUtils.degToRad(alpha - offsetAlpha),
    THREE.MathUtils.degToRad(-(gamma - offsetGamma)),
    'YXZ'
  );
  return new THREE.Quaternion().setFromEuler(euler);
}

function updateCameraFromGyro() {
  if (usingAbsoluteSensor && absQuat?.length === 4 && absQuat.every(q => q !== null)) {
    camera.quaternion.set(absQuat[0], absQuat[1], absQuat[2], absQuat[3]);
    camera.rotation.order = 'YXZ';
    return;
  }

  if (gyro.alpha == null || gyro.beta == null || gyro.gamma == null) return;

  const currentQuat = deviceOrientationToQuat(gyro.alpha, gyro.beta, gyro.gamma);

  if (lastQuat === null) {
    lastQuat = currentQuat.clone();
    return;
  }

  // Delta quaternion: dQ = currentQuat * inverse(lastQuat)
  const deltaQuat = currentQuat.clone().multiply(lastQuat.clone().invert());

  // Skip glitch frames — w near 1 means small rotation
  if (Math.abs(deltaQuat.w) < 0.97) {
    lastQuat = currentQuat.clone();
    return;
  }

  // Apply in local space
  camera.quaternion.multiply(deltaQuat);
  lastQuat = currentQuat.clone();
}

// --- Webcam ---
let videoStream = null;
const videoElement = document.getElementById('webcam');

async function initWebcam() {
  if (!isMobile) return;
  videoElement.removeAttribute('controls');
  videoElement.controls = false;
  videoElement.setAttribute('playsinline', '');
  videoElement.setAttribute('webkit-playsinline', '');
  videoElement.setAttribute('muted', '');
  videoElement.setAttribute('disablepictureinpicture', '');
  videoElement.setAttribute('controlsList', 'nodownload noplaybackrate nofullscreen');

  try {
    const constraints = {
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    };
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = videoStream;
    await videoElement.play();
    console.log('Webcam initialized');
  } catch (err) {
    console.error('Failed to access webcam:', err);
  }
}

// --- Movement ---
let moveState = { forward: 0 };
let touchStartY = 0;

window.addEventListener('touchstart', (e) => (touchStartY = e.touches[0].clientY), { passive: true });
window.addEventListener('touchmove', (e) => {
  if (!isMobile) return;
  moveState.forward = -(e.touches[0].clientY - touchStartY) * 0.001;
}, { passive: true });
window.addEventListener('touchend', () => (moveState.forward = 0), { passive: true });

function updateCameraPosition() {
  if (Math.abs(moveState.forward) < 0.01) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  camera.position.addScaledVector(direction, moveState.forward * 0.1);
}

// --- Capture ---
function captureCroppedWebcamImage() {
  if (!videoElement?.srcObject) return null;
  const videoWidth = videoElement.videoWidth || 640;
  const videoHeight = videoElement.videoHeight || 480;
  const cropWidth = videoWidth * 0.5;
  const cropHeight = videoHeight * 0.5;
  const cropX = (videoWidth - cropWidth) / 2;
  const cropY = (videoHeight - cropHeight) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvas.toDataURL('image/png');
}

function captureWebcamImage() {
  if (!isMobile || !videoElement?.srcObject) return null;
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth || 640;
  canvas.height = videoElement.videoHeight || 480;
  canvas.getContext('2d').drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

// --- Add plane ---
const planes = [];
let calibrated = false;

async function addPlaneWithTexture(imageData, cropPercent = 0.5) {
  if (!imageData) return;

  const img = new Image();
  img.src = imageData;
  img.onload = async () => {
    const minDim = Math.min(img.width, img.height);
    const cropSize = minDim * cropPercent;
    const cropX = (img.width - cropSize) / 2;
    const cropY = (img.height - cropSize) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = cropSize;
    canvas.height = cropSize;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, cropSize, cropSize);

    const { latitude, longitude } = await getDeviceLocation();
    if (latitude != null && longitude != null) {
      ctx.fillStyle = 'white';
      ctx.font = `${Math.floor(cropSize / 12)}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${latitude}, ${longitude}`, cropSize - 5, cropSize - 5);
    }

    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      opacity: calibrated ? 1.0 : 0.4,
      transparent: true,
      needsUpdate: true,
    })
    const plane = new THREE.Mesh(geometry, material);

    const cameraWorldPos = new THREE.Vector3();
    camera.getWorldPosition(cameraWorldPos);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const planeWorldPos = cameraWorldPos.clone().addScaledVector(direction, 10);
    plane.position.copy(planeWorldPos);
    plane.lookAt(cameraWorldPos);

    scene.add(plane);
    planes.push(plane);
    currentPos = planeWorldPos.clone();

    if (UPLOAD_TO_FIREBASE) {
      try {
        const dbRef = push(ref(database, 'captures'));
        await set(dbRef, {
          imageData: canvas.toDataURL('image/png'),
          timestamp: Date.now(),
          gyro,
          position: planeWorldPos.toArray(),
          location: { latitude, longitude },
        });
        console.log('✅ Plane + image saved to Firebase');
      } catch (err) {
        console.error('❌ Error saving to Firebase:', err);
      }
    }
  };
}

// --- Buttons (mobile) ---
if (isMobile) {
  // Capture button
  const captureBtn = document.createElement('button');
  captureBtn.innerHTML = '⬤';
  captureBtn.style.cssText = `
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    z-index: 5; width: 70px; height: 70px; border-radius: 50%;
    border: 4px solid white; background: rgba(255,255,255,0.3);
    backdrop-filter: blur(10px); font-size: 40px; color: white;
    cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; transition: all 0.1s ease;
  `;
  document.body.appendChild(captureBtn);
  captureBtn.addEventListener('touchend', () => {
    const imageData = captureCroppedWebcamImage();
    if (!imageData) return;
    addPlaneWithTexture(imageData);
    navigator.vibrate?.(100);
  });

  // Calibrate button
  const calibrateBtn = document.createElement('button');
  calibrateBtn.innerHTML = '⊕';
  calibrateBtn.style.cssText = `
    position: fixed; bottom: 30px; left: calc(50% + 90px);
    z-index: 5; width: 60px; height: 60px; border-radius: 50%;
    border: 3px solid #ff4444; background: rgba(255,50,50,0.35);
    backdrop-filter: blur(10px); font-size: 28px; color: white;
    cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
  `;
  document.body.appendChild(calibrateBtn);
  calibrateBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (gyro.alpha == null) return;
    offsetAlpha = gyro.alpha;
    offsetBeta  = gyro.beta;
    offsetGamma = gyro.gamma;
    camera.quaternion.identity();
    lastQuat = null;
    navigator.vibrate?.(200);
    calibrated = true;

    // Update all existing palanes
    for (const plane of planes) {
        plane.material.transparent = true; // ensure it's set
        plane.material.opacity = 1.0;
        plane.material.needsUpdate = true; // tell Three.js material changed
    }
  });
}

// --- Gyro UI ---
function updateGyroUI() {
  const radToDeg = THREE.MathUtils.radToDeg;
  const camX = radToDeg(camera.rotation.x).toFixed(1);
  const camY = radToDeg(camera.rotation.y).toFixed(1);
  const camZ = radToDeg(camera.rotation.z).toFixed(1);

  let sensorStatus = '';
  if (usingAbsoluteSensor) {
    sensorStatus =
      `sensor: AbsoluteOrientationSensor\n` +
      `sensor x: ${absEuler.x !== null ? absEuler.x.toFixed(1) : '—'}\n` +
      `sensor y: ${absEuler.y !== null ? absEuler.y.toFixed(1) : '—'}\n` +
      `sensor z: ${absEuler.z !== null ? absEuler.z.toFixed(1) : '—'}\n` +
      `absQuat: ${absQuat.map(q => q !== null ? q.toFixed(3) : '—').join(', ')}\n`;
  } else {
    sensorStatus =
      `sensor: deviceorientation\n` +
      `alpha: ${gyro.alpha?.toFixed(1) ?? '—'}\n` +
      `beta:  ${gyro.beta?.toFixed(1)  ?? '—'}\n` +
      `gamma: ${gyro.gamma?.toFixed(1) ?? '—'}\n` +
      `offset α: ${offsetAlpha.toFixed(1)}  β: ${offsetBeta.toFixed(1)}  γ: ${offsetGamma.toFixed(1)}\n`;
    if ('AbsoluteOrientationSensor' in window) {
      sensorStatus += `\n[!] AbsoluteOrientationSensor available but not working.\n`;
    } else {
      sensorStatus += `\n[!] AbsoluteOrientationSensor not supported on this device/browser.\n`;
    }
  }

  gyroDiv.textContent =
    `mobile: ${isMobile}\n` +
    `permission: ${gyro.permission}\n` +
    `camera rot x: ${camX}\n` +
    `camera rot y: ${camY}\n` +
    `camera rot z: ${camZ}\n` +
    sensorStatus +
    `posObject: ${
      currentPos
        ? `${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)}, ${currentPos.z.toFixed(2)}`
        : '—'
    }\n`;
}

// --- Animate ---
function animate() {
  renderer.setAnimationLoop(animate);
  if (controls?.enabled) controls.update();
  if (isMobile) updateCameraPosition();
  updateGyroUI();
  renderer.render(scene, camera);
}

// --- Motion permission ---
async function requestMotionPermission() {
  if (DeviceOrientationEvent?.requestPermission) {
    try {
      gyro.permission =
        (await DeviceOrientationEvent.requestPermission()) === 'granted'
          ? 'granted'
          : 'denied';
    } catch {
      gyro.permission = 'denied';
    }
  } else if (window.DeviceOrientationEvent) {
    gyro.permission = 'granted';
  } else {
    gyro.permission = 'unsupported';
  }
  updateGyroUI();
}

function ensureMotionOnGesture() {
  if (gyro.permission === 'granted') return;
  const handler = async () => {
    await requestMotionPermission();
    window.removeEventListener('click', handler);
    window.removeEventListener('touchend', handler);
  };
  window.addEventListener('click', handler, { once: true });
  window.addEventListener('touchend', handler, { once: true });
}

// --- Load saved planes ---
function loadSavedPlanes() {
  const capturesRef = ref(database, 'captures');
  console.log('📡 Listening for captures...');

  onValue(capturesRef, (snapshot) => {
    const data = snapshot.val();
    console.log('📦 Snapshot:', data);

    if (!data) {
      console.warn('⚠️ No captures found in DB.');
      return;
    }

    for (const p of planes) scene.remove(p);
    planes.length = 0;

    Object.entries(data).forEach(([key, capture]) => {
      const { imageData, position, location } = capture;
      if (!imageData || !position) return;

      const img = new Image();
      img.src = imageData;
      img.onload = () => {
        const cropSize = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = cropSize;
        canvas.height = cropSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cropSize, cropSize);

        ctx.fillStyle = 'white';
        ctx.font = `${Math.floor(cropSize / 12)}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        if (location?.latitude && location?.longitude) {
          ctx.fillText(
            `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`,
            cropSize - 5,
            cropSize - 5,
          );
        }

        const texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;

        const geometry = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.position.fromArray(position);
        plane.lookAt(0, 0, 0);

        scene.add(plane);
        planes.push(plane);
      };
    });

    console.log(`✅ Rendered ${planes.length} planes from Firebase`);
  });
}

// --- Geolocation ---
async function getDeviceLocation(timeout = 5000) {
  if (!navigator.geolocation) return { latitude: null, longitude: null };
  try {
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => {
          console.warn('⚠️ Geolocation error:', err);
          resolve({ latitude: null, longitude: null });
        },
        { enableHighAccuracy: true, timeout },
      );
    });
  } catch (err) {
    console.warn('⚠️ Failed to get location', err);
    return { latitude: null, longitude: null };
  }
}

// --- Delete all ---
function deleteAll() {
  const deleteBtn = document.createElement('button');
  deleteBtn.innerHTML = '🗑';
  deleteBtn.style.cssText = `
    position: fixed; bottom: 10px; left: 10%; transform: translateX(-50%);
    z-index: 5; width: fit-content; height: fit-content; padding: 10px; border-radius: 10px;
    border: 2px solid red; background: rgba(255,0,0,0.3);
    font-size: 16px; color: white; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  `;
  document.body.appendChild(deleteBtn);
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete ALL captures? This cannot be undone!')) return;
    try {
      await set(ref(database, 'captures'), null);
      console.log('✅ All captures deleted from Firebase');
      alert('All captures deleted.');
      for (const p of planes) scene.remove(p);
      planes.length = 0;
    } catch (err) {
      console.error('❌ Failed to delete captures:', err);
      alert('Failed to delete captures.');
    }
  });
}

// --- MAP ---
let map, markerStart, markerEnd, mapRectangle, latLngBounds;
let mapCloseBtn;

const mapToggleBtn = document.createElement('button');
mapToggleBtn.textContent = '🗺 Map Filter';
mapToggleBtn.style.cssText = `
  position: fixed; top: 10px; right: 10px; z-index: 10;
  padding: 10px 15px; background: rgba(0,0,0,0.6); color: white;
  border: none; border-radius: 8px; cursor: pointer; font-family: sans-serif;
`;
document.body.appendChild(mapToggleBtn);

const mapContainer = document.createElement('div');
mapContainer.id = 'map';
mapContainer.style.cssText = `
  position: fixed; top: 0; left: 0; width: 100%; height: 50%;
  z-index: 9; display: none; border: 2px solid white;
`;
document.body.appendChild(mapContainer);

mapToggleBtn.onclick = () => {
  if (!map) initMap();
  const isVisible = mapContainer.style.display === 'block';
  if (isVisible) {
    mapContainer.style.display = 'none';
    if (mapCloseBtn) { mapCloseBtn.remove(); mapCloseBtn = null; }
  } else {
    mapContainer.style.display = 'block';
    addCloseButton();
  }
};

function addCloseButton() {
  if (mapCloseBtn) return;
  mapCloseBtn = document.createElement('button');
  mapCloseBtn.textContent = '✖ Close';
  mapCloseBtn.style.cssText = `
    position: fixed; top: 10px; right: 130px; z-index: 1000;
    padding: 10px 15px; background: rgba(0,0,0,0.6); color: white;
    border: none; border-radius: 8px; cursor: pointer; font-family: sans-serif;
  `;
  mapCloseBtn.onclick = () => {
    mapContainer.style.display = 'none';
    mapCloseBtn.remove();
    mapCloseBtn = null;
  };
  document.body.appendChild(mapCloseBtn);
}

function initMap() {
  map = L.map('map').setView([0, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (markerStart && markerEnd) clearSelection();
    if (!markerStart) {
      markerStart = L.marker([lat, lng], { draggable: true }).addTo(map);
      markerStart.on('drag', updateRectangle);
    } else if (!markerEnd) {
      markerEnd = L.marker([lat, lng], { draggable: true }).addTo(map);
      markerEnd.on('drag', updateRectangle);
      latLngBounds = L.latLngBounds(markerStart.getLatLng(), markerEnd.getLatLng());
      mapRectangle = L.rectangle(latLngBounds, { color: 'blue', weight: 2 }).addTo(map);
      showFilterInfobox(latLngBounds, () => { filterPlanesByLocation(latLngBounds); setResetMode(); }, clearSelection);
    }
  });
}

function updateRectangle() {
  if (markerStart && markerEnd) {
    latLngBounds = L.latLngBounds(markerStart.getLatLng(), markerEnd.getLatLng());
    if (!mapRectangle) {
      mapRectangle = L.rectangle(latLngBounds, { color: 'blue', weight: 2 }).addTo(map);
    } else {
      mapRectangle.setBounds(latLngBounds);
    }
  }
}

function showFilterInfobox(bounds, onConfirm, onCancel) {
  const existingBox = document.getElementById('filter-infobox');
  if (existingBox) existingBox.remove();
  const box = document.createElement('div');
  box.id = 'filter-infobox';
  box.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    z-index: 20; background: rgba(0,0,0,0.85); color: white;
    padding: 15px 20px; border-radius: 10px; font-family: sans-serif;
    text-align: center; max-width: 320px;
  `;
  box.innerHTML = `
    <p>
      Filter images to this range?<br>
      LAT: ${bounds.getSouth().toFixed(2)} → ${bounds.getNorth().toFixed(2)}<br>
      LON: ${bounds.getWest().toFixed(2)} → ${bounds.getEast().toFixed(2)}
    </p>
    <button id="filter-confirm" style="margin:5px;padding:5px 10px;">Yes</button>
    <button id="filter-cancel" style="margin:5px;padding:5px 10px;">No</button>
  `;
  document.body.appendChild(box);
  document.getElementById('filter-confirm').onclick = () => { box.remove(); onConfirm?.(); };
  document.getElementById('filter-cancel').onclick = () => { box.remove(); onCancel?.(); };
}

function clearSelection() {
  if (mapRectangle) { map.removeLayer(mapRectangle); mapRectangle = null; }
  if (markerStart) { map.removeLayer(markerStart); markerStart = null; }
  if (markerEnd) { map.removeLayer(markerEnd); markerEnd = null; }
  latLngBounds = null;
}

function setResetMode() {
  mapToggleBtn.textContent = 'Reset Filter';
  mapToggleBtn.onclick = () => {
    clearSelection();
    loadSavedPlanes();
    mapToggleBtn.textContent = '🗺 Map Filter';
    mapToggleBtn.onclick = () => {
      mapContainer.style.display = mapContainer.style.display === 'none' ? 'block' : 'none';
    };
  };
}

async function filterPlanesByLocation(bounds) {
  if (!bounds) return;
  for (const p of planes) scene.remove(p);
  planes.length = 0;
  const snapshot = await get(ref(database, 'captures'));
  const data = snapshot.val();
  if (!data) return;
  Object.values(data).forEach((capture) => {
    const { location, imageData } = capture;
    if (!location || !imageData) return;
    const point = L.latLng(location.latitude, location.longitude);
    if (bounds.contains(point)) addPlaneWithTexture(imageData);
  });
}

// --- Delete All button ---
const btnStyle = `
  position: fixed; bottom: 10px; left: 10px; z-index: 1000; padding: 10px;
  background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 8px;
  cursor: pointer; font-family: sans-serif;
`;
const deleteAllBtn = document.createElement('button');
deleteAllBtn.textContent = '🗑';
deleteAllBtn.style.cssText = btnStyle;
deleteAllBtn.onclick = () => { if (confirm('Delete all captures from Firebase?')) deleteAll(); };
// document.body.appendChild(deleteAllBtn);

// --- Init ---
(async () => {
  await requestMotionPermission();
  ensureMotionOnGesture();
  await setupControls();
  await initWebcam();
  loadSavedPlanes();
  initMap();
  animate();
})();
