// WebXR Passthrough Camera with Hand Tracking and Frame Capture
// References:
// https://github.com/mrdoob/three.js/blob/master/examples/webxr_ar_cones.html
// https://github.com/mrdoob/three.js/blob/master/examples/webxr_vr_handinput_profiles.html

import * as THREE from 'three';
import { XRHandModelFactory } from 'https://cdn.jsdelivr.net/npm/three@0.145.0/examples/jsm/webxr/XRHandModelFactory.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  orderByKey,
  query,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js';

// Firebase Constants
const firebaseConfig = {
  apiKey: 'AIzaSyCC00ceFN729Q78X9qsvKSjttkN8tyJB5Y',
  authDomain: 'fotofoto-27fa3.firebaseapp.com',
  databaseURL: 'https://fotofoto-27fa3-default-rtdb.firebaseio.com',
  projectId: 'fotofoto-27fa3',
  storageBucket: 'fotofoto-27fa3.appspot.com',
  messagingSenderId: '123456789', // Placeholder
  appId: '1:123456789:web:abc123', // Placeholder
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

let camera, scene, renderer;
let currentSession;

// Hand tracking
let leftHand, rightHand;
let leftHandModel, rightHandModel;
let handModelFactory;
let lastCaptureTime = 0;
const CAPTURE_DEBOUNCE = 1000; // 1 second between captures

// Track which hand object (getHand(0) or getHand(1)) corresponds to which handedness
let hand0Handedness = null; // Will be 'left' or 'right'
let hand1Handedness = null; // Will be 'left' or 'right'

// Frame visualization
let frameCornerLeft, frameCornerRight;
let frameLine;
let capturedPlanes = [];

// Black sphere to block passthrough except in frame area
let blackSphere;
let passthroughWindow = null;

// 3D Debug panel
let debugPanel;
let debugCanvas;
let debugTexture;

// Camera access for capturing passthrough
let xrGLBinding = null;
let cameraTexture = null;

// getUserMedia camera access (more compatible)
let cameraVideo = null;
let cameraStream = null;

// Room management
let currentRoomId = null;

// Constants
const PINCH_THRESHOLD = 0.03; // Distance in meters to consider as pinch
const HAND_JOINT_COUNT = 25;

// Get zoom factor from URL parameter (e.g., ?zoom=1.5)
const urlParams = new URLSearchParams(window.location.search);
const CAMERA_ZOOM_FACTOR = parseFloat(urlParams.get('zoom')) || 1.4;

// Get max planes from URL parameter (e.g., ?maxplanes=20)
const MAX_CAPTURED_PLANES = parseInt(urlParams.get('maxplanes')) || 10;

// Debug logging
let debugLines = [];
const MAX_DEBUG_LINES = 10;
let lastHandDebugTime = 0;
let lastDetailedDebugTime = 0; // For throttling detailed logs

function debugLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  debugLines.push(`[${timestamp}] ${message}`);
  if (debugLines.length > MAX_DEBUG_LINES) {
    debugLines.shift();
  }
  updateDebugDisplay();
}

function updateDebugDisplay() {
  // Update HTML debug div (for 2D view)
  const debugDiv = document.getElementById('debug');
  if (debugDiv) {
    debugDiv.innerHTML = debugLines.join('<br>');
  }

  // Update 3D debug panel (for VR view)
  if (debugCanvas) {
    const ctx = debugCanvas.getContext('2d');

    // Clear canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, debugCanvas.width, debugCanvas.height);

    // Draw debug text
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'left';

    const lineHeight = 30;
    const startY = 30;

    debugLines.forEach((line, i) => {
      ctx.fillText(line, 10, startY + i * lineHeight);
    });

    // Update texture
    if (debugTexture) {
      debugTexture.needsUpdate = true;
    }
  }
}

// Hand joint indices
const JOINTS = {
  WRIST: 0,
  // Thumb (1..4)
  THUMB_METACARPAL: 1,
  THUMB_PROXIMAL: 2,
  THUMB_DISTAL: 3,
  THUMB_TIP: 4,
  // Index (5..8, tip sometimes at 8 or 9 depending on rig)
  INDEX_METACARPAL: 5,
  INDEX_PROXIMAL: 6,
  INDEX_INTERMEDIATE: 7,
  INDEX_TIP: 8,
  // Middle (9..12)
  MIDDLE_METACARPAL: 9,
  MIDDLE_PROXIMAL: 10,
  MIDDLE_INTERMEDIATE: 11,
  MIDDLE_TIP: 12,
  // Ring (13..16)
  RING_METACARPAL: 13,
  RING_PROXIMAL: 14,
  RING_INTERMEDIATE: 15,
  RING_TIP: 16,
  // Pinky (17..20)
  PINKY_METACARPAL: 17,
  PINKY_PROXIMAL: 18,
  PINKY_INTERMEDIATE: 19,
  PINKY_TIP: 20,
};

// Hand bone connections for skeleton visualization
const HAND_CONNECTIONS = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Index finger
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle finger
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring finger
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // Palm
  [5, 9],
  [9, 13],
  [13, 17],
];

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Generate random 4-character room ID
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous characters
  let roomId = '';
  for (let i = 0; i < 4; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return roomId;
}

// Setup camera access using getUserMedia (works on more devices!)
// IMPORTANT LIMITATION: getUserMedia gives ONE fixed camera feed that does NOT
// track with head movement. When you look left/right, the video stays locked
// to its initial orientation. This is a WebXR limitation - getUserMedia and
// WebXR don't communicate about head tracking.
//
// WORKAROUND: Always face forward (same direction as when you started AR)
// when capturing frames. Or use Unity with AR Foundation for proper tracking.
async function setupCameraAccess() {
  try {
    debugLog('📷 Requesting camera via getUserMedia...');

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment', // Back/passthrough camera
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });

    // Create video element to receive stream
    cameraVideo = document.createElement('video');
    cameraVideo.setAttribute('playsinline', ''); // Important for mobile
    cameraVideo.autoplay = true;
    cameraVideo.srcObject = stream;
    cameraStream = stream;

    // Wait for video to be ready
    await new Promise((resolve) => {
      cameraVideo.onloadedmetadata = () => {
        cameraVideo.play();
        resolve();
      };
    });

    debugLog('✅ Camera access granted!');
    debugLog('⚠️ Keep facing forward for best results');
    console.log(
      'Camera video ready:',
      cameraVideo.videoWidth,
      'x',
      cameraVideo.videoHeight,
    );

    // Add video to DOM for debugging (hidden by default)
    cameraVideo.style.position = 'fixed';
    cameraVideo.style.bottom = '10px';
    cameraVideo.style.left = '10px';
    cameraVideo.style.width = '160px';
    cameraVideo.style.height = '90px';
    cameraVideo.style.border = '2px solid yellow';
    cameraVideo.style.zIndex = '9999';
    cameraVideo.style.display = urlParams.get('showvideo') ? 'block' : 'none';
    document.body.appendChild(cameraVideo);

    if (urlParams.get('showvideo')) {
      debugLog('📺 Video preview enabled (bottom-left)');
    }

    return true;
  } catch (err) {
    console.error('getUserMedia failed:', err);
    debugLog(`❌ Camera denied: ${err.message}`);
    return false;
  }
}

// Setup room selection
function setupRoomSelection() {
  const modal = document.getElementById('room-modal');
  const createBtn = document.getElementById('create-room-btn');
  const joinBtn = document.getElementById('join-room-btn');
  const roomInput = document.getElementById('room-id-input');
  const currentRoomDiv = document.getElementById('current-room');
  const roomIdDisplay = document.getElementById('room-id-display');
  const roomInfo = document.getElementById('room-info');

  // Create new room
  createBtn.addEventListener('click', () => {
    currentRoomId = generateRoomId();
    roomIdDisplay.textContent = currentRoomId;
    currentRoomDiv.style.display = 'block';
    roomInfo.textContent = `Room: ${currentRoomId}`;

    debugLog(`🏠 Created room: ${currentRoomId}`);

    // Hide modal after 2 seconds
    setTimeout(() => {
      modal.classList.add('hidden');
    }, 2000);
  });

  // Join existing room
  joinBtn.addEventListener('click', () => {
    const roomId = roomInput.value.toUpperCase().trim();
    if (roomId.length === 4) {
      currentRoomId = roomId;
      roomInfo.textContent = `Room: ${currentRoomId}`;
      modal.classList.add('hidden');
      debugLog(`🚪 Joined room: ${currentRoomId}`);
    } else {
      alert('Please enter a valid 4-character room code');
    }
  });

  // Allow Enter key to join
  roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      joinBtn.click();
    }
  });

  // Auto-uppercase input
  roomInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
}

function init() {
  console.log('Initializing Three.js and WebXR...');
  console.log('Document body:', document.body);
  console.log('Available elements:', {
    info: document.getElementById('info'),
    arButton: document.getElementById('ar-button'),
    instructions: document.getElementById('instructions'),
  });

  // Setup room selection modal
  setupRoomSelection();

  // Show config in debug
  debugLog(`🔍 Camera zoom: ${CAMERA_ZOOM_FACTOR}x`);
  debugLog(`📦 Max captures: ${MAX_CAPTURED_PLANES}`);
  if (urlParams.get('zoom') || urlParams.get('maxplanes')) {
    debugLog(`(Set via URL parameters)`);
  }

  const container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();
  // Transparent background for passthrough AR

  camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.01,
    50,
  );
  camera.position.set(0, 1.6, 3);

  // Lighting
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1));
  const light = new THREE.DirectionalLight(0xffffff, 0.5);
  light.position.set(0, 4, 2);
  scene.add(light);

  // Renderer with alpha for passthrough
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // Enable canvas capture
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  // Create black sphere enclosure
  createBlackSphere();

  // Create frame visualization
  createFrameVisualization();

  // Create 3D debug panel
  create3DDebugPanel();

  // Initialize hand model factory
  handModelFactory = new XRHandModelFactory();

  // XR hands with proper Three.js hand models
  leftHand = renderer.xr.getHand(0);
  leftHandModel = handModelFactory.createHandModel(leftHand, 'mesh');
  leftHand.add(leftHandModel);
  scene.add(leftHand);

  // Listen for hand connected events
  leftHand.addEventListener('connected', (event) => {
    console.log('Hand[0] connected!', event);
    const inputSource = event.data;
    const previousHandedness = hand0Handedness;
    hand0Handedness = inputSource.handedness; // Store the actual handedness!

    debugLog(`🤚 Hand[0] -> ${hand0Handedness.toUpperCase()}`);

    // Alert if handedness changed (this would indicate instability)
    if (previousHandedness && previousHandedness !== hand0Handedness) {
      debugLog(
        `⚠️⚠️⚠️ Hand[0] CHANGED: ${previousHandedness} -> ${hand0Handedness}`,
      );
    }
  });

  leftHand.addEventListener('disconnected', () => {
    debugLog(`❌ Hand[0] (${hand0Handedness}) disconnected`);
    hand0Handedness = null;
  });

  rightHand = renderer.xr.getHand(1);
  rightHandModel = handModelFactory.createHandModel(rightHand, 'mesh');
  rightHand.add(rightHandModel);
  scene.add(rightHand);

  // Listen for hand connected events
  rightHand.addEventListener('connected', (event) => {
    console.log('Hand[1] connected!', event);
    const inputSource = event.data;
    const previousHandedness = hand1Handedness;
    hand1Handedness = inputSource.handedness; // Store the actual handedness!

    debugLog(`🤚 Hand[1] -> ${hand1Handedness.toUpperCase()}`);

    // Alert if handedness changed (this would indicate instability)
    if (previousHandedness && previousHandedness !== hand1Handedness) {
      debugLog(
        `⚠️⚠️⚠️ Hand[1] CHANGED: ${previousHandedness} -> ${hand1Handedness}`,
      );
    }
  });

  rightHand.addEventListener('disconnected', () => {
    debugLog(`❌ Hand[1] (${hand1Handedness}) disconnected`);
    hand1Handedness = null;
  });

  // Event listeners
  window.addEventListener('resize', onWindowResize);

  const arButton = document.getElementById('ar-button');
  console.log('AR Button element:', arButton);

  if (!arButton) {
    console.error('❌ AR button not found! Check if HTML loaded correctly.');
    return;
  }

  arButton.addEventListener('click', async () => {
    console.log('🖱️ AR button clicked!');

    // First, request camera access
    await setupCameraAccess();

    // Then start AR
    startAR();
  });

  console.log('✅ Event listener attached to AR button');

  // Check WebXR support on load
  checkWebXRSupport();

  // Start animation loop
  animate();
}

async function checkWebXRSupport() {
  const infoDiv = document.getElementById('info');
  const arButton = document.getElementById('ar-button');

  if (!navigator.xr) {
    if (infoDiv) {
      infoDiv.innerHTML = `
        <h1>❌ WebXR Not Supported</h1>
        <p>Your browser doesn't support WebXR.</p>
        <p>Try using Meta Quest Browser or Chrome on an AR device.</p>
      `;
    }
    if (arButton) arButton.disabled = true;
    return;
  }

  try {
    const isARSupported = await navigator.xr.isSessionSupported('immersive-ar');

    if (!isARSupported) {
      if (infoDiv) {
        infoDiv.innerHTML = `
          <h1>❌ AR Not Supported</h1>
          <p>WebXR is available but immersive-ar is not supported on this device.</p>
          <p>Try using a Meta Quest or AR-capable device.</p>
        `;
      }
      if (arButton) arButton.disabled = true;
      return;
    }

    console.log('✅ WebXR AR is supported!');
  } catch (err) {
    console.error('Error checking WebXR support:', err);
    if (infoDiv) {
      infoDiv.innerHTML = `
        <h1>⚠️ Error Checking Support</h1>
        <p>${err.message}</p>
      `;
    }
    if (arButton) arButton.disabled = true;
  }
}

function createBlackSphere() {
  // Create a large black sphere that encapsulates the user
  const sphereGeometry = new THREE.SphereGeometry(50, 64, 64); // Increased from 10 to 50
  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide, // Render inside of sphere
    depthTest: true,
  });
  blackSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  blackSphere.position.copy(camera.position);
  blackSphere.renderOrder = 1; // Render after window
  scene.add(blackSphere);

  debugLog('⚫ Black sphere created');
}

function createFrameVisualization() {
  // Corner indicators (yellow spheres at hand positions)
  const cornerGeometry = new THREE.SphereGeometry(0.03, 16, 16); // Increased from 0.02 to 0.03

  const leftCornerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    emissive: 0xffff00, // Make it glow
    emissiveIntensity: 0.5,
  });
  frameCornerLeft = new THREE.Mesh(cornerGeometry, leftCornerMaterial);
  frameCornerLeft.visible = false;
  frameCornerLeft.renderOrder = 999; // Render on top
  scene.add(frameCornerLeft);

  const rightCornerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    emissive: 0xffff00, // Make it glow
    emissiveIntensity: 0.5,
  });
  frameCornerRight = new THREE.Mesh(cornerGeometry, rightCornerMaterial);
  frameCornerRight.visible = false;
  frameCornerRight.renderOrder = 999; // Render on top
  scene.add(frameCornerRight);

  // Dashed frame border (will be updated based on hand positions)
  const lineMaterial = new THREE.LineDashedMaterial({
    color: 0xffff00,
    linewidth: 2,
    dashSize: 0.05,
    gapSize: 0.025,
  });

  // Create line geometry for frame
  const lineGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(15); // 5 points for closed rectangle
  lineGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  );
  frameLine = new THREE.Line(lineGeometry, lineMaterial);
  frameLine.computeLineDistances(); // Required for dashed lines
  frameLine.visible = false;
  scene.add(frameLine);

  // Create passthrough window (plane that will reveal camera feed)
  createPassthroughWindow();
}

function createPassthroughWindow() {
  // Create a plane that will act as a "window" to the passthrough
  // This will be positioned and scaled based on the frame
  const windowGeometry = new THREE.PlaneGeometry(1, 1);
  const windowMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false, // Don't write color
    depthWrite: true, // Write to depth buffer to block black sphere
  });
  passthroughWindow = new THREE.Mesh(windowGeometry, windowMaterial);
  passthroughWindow.visible = false;
  passthroughWindow.renderOrder = 0; // Render before black sphere
  scene.add(passthroughWindow);
}

function create3DDebugPanel() {
  // Create canvas for debug text
  debugCanvas = document.createElement('canvas');
  debugCanvas.width = 1024;
  debugCanvas.height = 512;

  // Create texture from canvas
  debugTexture = new THREE.CanvasTexture(debugCanvas);
  debugTexture.minFilter = THREE.LinearFilter;
  debugTexture.magFilter = THREE.LinearFilter;

  // Create plane geometry
  const panelGeometry = new THREE.PlaneGeometry(0.5, 0.25);
  const panelMaterial = new THREE.MeshBasicMaterial({
    map: debugTexture,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });

  debugPanel = new THREE.Mesh(panelGeometry, panelMaterial);

  // Position in front and to the left of camera
  debugPanel.position.set(-0.3, 0.2, -0.6);

  // Add to camera so it moves with the view
  camera.add(debugPanel);
  scene.add(camera);

  // Initial draw
  debugLog('🎮 Debug Panel Active');
}

// Returns gesture state: null, "L_SHAPE", or "PINCH"
function detectHandGesture(hand, expectedHandedness) {
  // Use the passed handedness parameter
  const handedness = expectedHandedness;

  // Get the hand model that corresponds to the actual hand object
  // NOT the expected handedness (since getHand(0) might be right hand)
  const handModel = hand === leftHand ? leftHandModel : rightHandModel;
  const handIndex = hand === leftHand ? 0 : 1;

  if (!handModel?.children?.length) {
    // Model not ready or no tracking data
    // debugLog(`${expectedHandedness} hand[${handIndex}] no model data`);
    return null;
  }

  // The hand object itself should have tracking data in the model
  // We don't need to check inputSource - if the model has children, it's tracking

  // Get joints
  let joints;
  if (handModel.children[0]?.children?.length >= 21) {
    joints = handModel.children[0].children;
  } else if (handModel.children.length >= 21) {
    joints = handModel.children;
  } else {
    return null;
  }

  // Right hand has 21 joints, left hand has more (up to 26)
  const minJoints = expectedHandedness === 'RIGHT' ? 21 : 24;
  if (!joints || joints.length < minJoints) {
    debugLog(
      `${expectedHandedness} only has ${
        joints?.length || 0
      } joints (need ${minJoints})`,
    );
    return null;
  }

  // Debug: Check joint structure (disabled now that we know the mapping)
  const debugStructure = false; // Set to true to see all joint names
  if (debugStructure) {
    debugLog(`${expectedHandedness} has ${joints.length} joints`);
    for (let i = 0; i < Math.min(joints.length, 30); i++) {
      if (joints[i]) {
        const name = joints[i].name || joints[i].type || 'unknown';
        debugLog(`  [${i}]: ${name}`);
      }
    }
  }

  const wrist = joints[JOINTS.WRIST];
  const thumbBase = joints[JOINTS.THUMB_METACARPAL];
  const thumbTip = joints[JOINTS.THUMB_TIP];
  const indexBase = joints[JOINTS.INDEX_METACARPAL];
  const indexTip = joints[JOINTS.INDEX_TIP];
  const middleBase = joints[JOINTS.MIDDLE_METACARPAL];
  const middleTip = joints[JOINTS.MIDDLE_TIP];
  const ringBase = joints[JOINTS.RING_METACARPAL];
  const ringTip = joints[JOINTS.RING_TIP];
  const pinkyBase = joints[JOINTS.PINKY_METACARPAL];
  const pinkyTip = joints[JOINTS.PINKY_TIP];

  if (!wrist || !thumbTip || !indexTip || !middleTip || !ringTip || !pinkyTip) {
    return null;
  }

  // Helper: Check if finger is extended using dot product
  // Compare base→mid vs mid→tip (adjacent segments)
  // This is more stable and local to the finger itself
  function isFingerExtended(name, baseJoint, midJoint, tipJoint) {
    const basePos = new THREE.Vector3();
    const midPos = new THREE.Vector3();
    const tipPos = new THREE.Vector3();

    baseJoint.getWorldPosition(basePos);
    midJoint.getWorldPosition(midPos);
    tipJoint.getWorldPosition(tipPos);

    // Vector from base to mid
    const baseMid = new THREE.Vector3().subVectors(midPos, basePos).normalize();
    // Vector from mid to tip
    const midTip = new THREE.Vector3().subVectors(tipPos, midPos).normalize();

    // If segments point in same direction, finger is extended (straight)
    // If segments point in different directions, finger is curled (bent)
    const dot = Math.abs(baseMid.dot(midTip));
    // Removed per-finger debug to reduce noise
    return dot > 0.7; // Extended if angle < ~45° (more forgiving for rotation)
  }

  // IMPORTANT: Left and right hands have REVERSED joint ordering!
  // Right hand: 0=wrist, 4=thumb-tip, 8=index-tip, 12=middle-tip, 16=ring-tip, 20=pinky-tip
  // Left hand: 0=wrist, 4=pinky-tip, 8=ring-tip, 12=middle-tip, 16=index-tip, 20=thumb-tip

  let thumbExtended, indexExtended, middleExtended, ringExtended, pinkyExtended;

  if (expectedHandedness === 'RIGHT') {
    // Right hand - normal order (thumb to pinky: 0-4, 5-8, 9-12, 13-16, 17-20)
    thumbExtended = isFingerExtended('THUMB', joints[2], joints[3], joints[4]);
    indexExtended = isFingerExtended('INDEX', joints[6], joints[7], joints[8]);
    middleExtended = isFingerExtended(
      'MIDDLE',
      joints[10],
      joints[11],
      joints[12],
    );
    ringExtended = isFingerExtended('RING', joints[14], joints[15], joints[16]);
    pinkyExtended = isFingerExtended(
      'PINKY',
      joints[18],
      joints[19],
      joints[20],
    );
  } else {
    // Left hand - REVERSED order AND reversed within each finger!
    // Based on user report: index is [18-22] (tip to metacarpal), thumb tip is [23], thumb distal is [24]
    // Each finger goes TIP to BASE (reversed from right hand)

    pinkyExtended = isFingerExtended('PINKY', joints[4], joints[3], joints[2]); // Reversed within finger
    ringExtended = isFingerExtended('RING', joints[8], joints[7], joints[6]); // Reversed
    middleExtended = isFingerExtended(
      'MIDDLE',
      joints[12],
      joints[11],
      joints[10],
    ); // Reversed

    // Index: [18-22] is tip to metacarpal, use [20, 19, 18] for (base, mid, tip)
    indexExtended = isFingerExtended(
      'INDEX',
      joints[20],
      joints[19],
      joints[18],
    );

    // Thumb: [23]=tip, [24]=distal, [25]=proximal (if exists)
    // Try using [25, 24, 23] for (base, mid, tip) or [24, 23, 22] if no [25]
    if (joints[25]) {
      thumbExtended = isFingerExtended(
        'THUMB',
        joints[25],
        joints[24],
        joints[23],
      );
    } else if (joints[22]) {
      thumbExtended = isFingerExtended(
        'THUMB',
        joints[24],
        joints[23],
        joints[22],
      );
    } else {
      thumbExtended = false; // Not enough joints
    }
  }

  // THE KEY CONDITION for L-shape:
  // 1. Middle, ring, pinky are curled (NOT extended)
  // 2. Thumb AND index ARE extended (forming the L)
  const threeFingersCurled = !middleExtended && !ringExtended && !pinkyExtended;
  const thumbAndIndexExtended = thumbExtended && indexExtended;

  // Compact debug: show finger states (DISABLED - too spammy)
  // const fingerStates = `T${thumbExtended ? '✓' : '✗'} I${
  //   indexExtended ? '✓' : '✗'
  // } M${middleExtended ? '✓' : '✗'} R${ringExtended ? '✓' : '✗'} P${
  //   pinkyExtended ? '✓' : '✗'
  // }`;

  // Debug: show finger states (DISABLED to prevent spam)
  // debugLog(`🤚 ${handedness} Fingers: ${fingerStates}`);

  // If the 3 main fingers aren't curled, no gesture at all
  if (!threeFingersCurled) {
    return null;
  }

  // If thumb and index are also curled (closed fist), no gesture
  if (!thumbAndIndexExtended) {
    // debugLog(`✊ ${handedness} FIST ${fingerStates}`);
    return null;
  }

  // At this point, we know middle/ring/pinky are curled
  // Now check if user is pinching (thumb and index close together)
  const thumbTipPos = new THREE.Vector3();
  const indexTipPos = new THREE.Vector3();
  const thumbBasePos = new THREE.Vector3();
  const indexBasePos = new THREE.Vector3();

  thumbTip.getWorldPosition(thumbTipPos);
  indexTip.getWorldPosition(indexTipPos);
  thumbBase.getWorldPosition(thumbBasePos);
  indexBase.getWorldPosition(indexBasePos);

  // Check if thumb and index are touching (pinch)
  const thumbIndexDist = thumbTipPos.distanceTo(indexTipPos);
  const isPinching = thumbIndexDist < 0.05; // 5cm threshold (easier to trigger)

  if (isPinching) {
    // debugLog(`🤌 ${handedness} PINCH ${fingerStates}`);
    return 'PINCH';
  }

  // Not pinching, so it's just L-shape
  // debugLog(`🤟 ${handedness} L-SHAPE ${fingerStates}`);
  return 'L_SHAPE';
}

// Wrapper for backward compatibility
function isLShapeGesture(hand, expectedHandedness) {
  return detectHandGesture(hand, expectedHandedness) === 'L_SHAPE';
}

function getLShapePosition(hand, expectedHandedness) {
  // Get the corner position of the L-shape (where thumb and index meet)
  if (!hand || !expectedHandedness) return null;

  const handedness = expectedHandedness;
  // Get the hand model that corresponds to the actual hand object
  const handModel = hand === leftHand ? leftHandModel : rightHandModel;

  if (!handModel || !handModel.children || handModel.children.length === 0) {
    return null;
  }

  // Handle different hand model structures
  let joints;
  if (
    handModel.children[0]?.children &&
    handModel.children[0].children.length >= 21
  ) {
    joints = handModel.children[0].children;
  } else if (handModel.children.length >= 21) {
    joints = handModel.children;
  } else {
    return null;
  }

  if (!joints || joints.length < 21) return null;

  // Use thumb metacarpal and index metacarpal - but reversed for left hand!
  let thumbMetacarpal, indexMetacarpal;

  if (expectedHandedness === 'RIGHT') {
    // Right hand - normal order
    thumbMetacarpal = joints[2]; // Thumb base (proximal joint)
    indexMetacarpal = joints[6]; // Index base (proximal joint)
  } else {
    // Left hand - REVERSED order
    // Index is [18-22] (tip to metacarpal), so metacarpal is [22]
    // Thumb is [23-25], so base is [25] or [24]
    thumbMetacarpal = joints[25] || joints[24]; // Thumb base at end
    indexMetacarpal = joints[22] || joints[21]; // Index metacarpal
  }

  if (!thumbMetacarpal || !indexMetacarpal) return null;

  // Get world positions
  const thumbPos = new THREE.Vector3();
  const indexPos = new THREE.Vector3();

  thumbMetacarpal.getWorldPosition(thumbPos);
  indexMetacarpal.getWorldPosition(indexPos);

  // Return the corner position (midpoint between thumb and index bases)
  // This is the natural "corner" of the L-shape
  return new THREE.Vector3(
    (thumbPos.x + indexPos.x) / 2,
    (thumbPos.y + indexPos.y) / 2,
    (thumbPos.z + indexPos.z) / 2,
  );
}

function getPinchPosition(hand) {
  if (!hand || !hand.joints) return null;

  let joints;
  try {
    joints = hand.joints.values
      ? Array.from(hand.joints.values())
      : Array.from(hand.joints);
  } catch (e) {
    return null;
  }

  if (joints.length < JOINTS.INDEX_TIP + 1) return null;

  const thumbTip = joints[JOINTS.THUMB_TIP];
  const indexTip = joints[JOINTS.INDEX_TIP];

  if (!thumbTip || !indexTip || !thumbTip.visible || !indexTip.visible)
    return null;

  // Calculate midpoint between thumb and index finger tips
  return new THREE.Vector3(
    (thumbTip.position.x + indexTip.position.x) / 2,
    (thumbTip.position.y + indexTip.position.y) / 2,
    (thumbTip.position.z + indexTip.position.z) / 2,
  );
}

function isPinching(hand) {
  if (!hand || !hand.joints) return false;

  let joints;
  try {
    joints = hand.joints.values
      ? Array.from(hand.joints.values())
      : Array.from(hand.joints);
  } catch (e) {
    return false;
  }

  if (joints.length < JOINTS.INDEX_TIP + 1) return false;

  const thumbTip = joints[JOINTS.THUMB_TIP];
  const indexTip = joints[JOINTS.INDEX_TIP];

  if (!thumbTip || !indexTip || !thumbTip.visible || !indexTip.visible)
    return false;

  const distance = thumbTip.position.distanceTo(indexTip.position);
  return distance < PINCH_THRESHOLD;
}

async function captureFrame(topLeft, bottomRight) {
  console.log('Capturing frame!', topLeft, bottomRight);
  debugLog('📸 Capturing with camera access...');

  // Calculate frame dimensions
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(topLeft.y - bottomRight.y);

  // if (width < 0.01 || height < 0.01) {
  //   console.log('Frame too small, skipping capture');
  //   return;
  // }

  // Create a textured plane
  const planeGeometry = new THREE.PlaneGeometry(width, height);

  // Capture the current renderer output (passthrough camera view)
  const canvas = document.createElement('canvas');
  const aspectRatio = height / width;
  canvas.width = 1024;
  canvas.height = Math.floor(1024 * aspectRatio);
  const ctx = canvas.getContext('2d');

  // Project 3D frame positions to 2D screen space for accurate cropping
  const topLeftScreen = new THREE.Vector3(topLeft.x, topLeft.y, topLeft.z);
  const bottomRightScreen = new THREE.Vector3(
    bottomRight.x,
    bottomRight.y,
    bottomRight.z,
  );

  topLeftScreen.project(camera);
  bottomRightScreen.project(camera);

  console.log('3D positions:', { topLeft, bottomRight });
  console.log('Projected 2D:', { topLeftScreen, bottomRightScreen });

  // Try to capture from the camera texture (if available)
  try {
    console.log(
      'Capture attempt - cameraVideo:',
      !!cameraVideo,
      'cameraTexture:',
      cameraTexture,
      'xrGLBinding:',
      !!xrGLBinding,
    );
    debugLog(
      `Capture: video=${!!cameraVideo} tex=${!!cameraTexture} binding=${!!xrGLBinding}`,
    );

    // METHOD 1: Use getUserMedia video (BEST compatibility)
    if (
      cameraVideo &&
      cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA
    ) {
      console.log('Using getUserMedia video feed');
      debugLog('📹 Using getUserMedia video');

      // Check if video is actually playing (not frozen)
      const currentTime = cameraVideo.currentTime;
      console.log(
        'Video currentTime:',
        currentTime,
        'paused:',
        cameraVideo.paused,
      );

      if (cameraVideo.paused) {
        console.warn('⚠️ Video is paused! Attempting to resume...');
        cameraVideo.play().catch((e) => console.error('Play failed:', e));
      }

      // Get video dimensions
      const videoWidth = cameraVideo.videoWidth;
      const videoHeight = cameraVideo.videoHeight;

      // Convert normalized device coordinates (-1 to 1) to video coordinates (0 to videoWidth/Height)
      // topLeftScreen and bottomRightScreen are in NDC after .project()

      // Calculate crop region in video space
      // NDC: -1 (left/bottom) to +1 (right/top)
      // We need to map this to video coordinates

      // Horizontal mapping: -1 = 0, +1 = videoWidth
      const cropLeft = ((topLeftScreen.x + 1) / 2) * videoWidth;
      const cropRight = ((bottomRightScreen.x + 1) / 2) * videoWidth;

      // Vertical mapping: +1 = 0 (top), -1 = videoHeight (bottom) - Y is inverted!
      const cropTop = ((1 - topLeftScreen.y) / 2) * videoHeight;
      const cropBottom = ((1 - bottomRightScreen.y) / 2) * videoHeight;

      // Calculate crop dimensions
      const cropX = Math.min(cropLeft, cropRight);
      const cropY = Math.min(cropTop, cropBottom);
      const cropWidth = Math.abs(cropRight - cropLeft);
      const cropHeight = Math.abs(cropBottom - cropTop);

      // ZOOM FACTOR: To match passthrough perspective
      // getUserMedia shows wider FOV than XR passthrough
      // Typical Quest FOV is ~90°, getUserMedia is ~60-70°
      // So we need to zoom in by ~1.3-1.5x
      // You can adjust this via URL: ?zoom=1.5
      const ZOOM_FACTOR = CAMERA_ZOOM_FACTOR;

      // Calculate zoomed crop (crop from center)
      const zoomCropWidth = cropWidth / ZOOM_FACTOR;
      const zoomCropHeight = cropHeight / ZOOM_FACTOR;
      const zoomCropX = cropX + (cropWidth - zoomCropWidth) / 2;
      const zoomCropY = cropY + (cropHeight - zoomCropHeight) / 2;

      // CLAMP crop coordinates to video bounds (prevents black bars)
      const clampedX = Math.max(
        0,
        Math.min(zoomCropX, videoWidth - zoomCropWidth),
      );
      const clampedY = Math.max(
        0,
        Math.min(zoomCropY, videoHeight - zoomCropHeight),
      );
      const clampedWidth = Math.min(zoomCropWidth, videoWidth - clampedX);
      const clampedHeight = Math.min(zoomCropHeight, videoHeight - clampedY);

      console.log('Video dimensions:', videoWidth, 'x', videoHeight);
      console.log('Original crop:', { cropX, cropY, cropWidth, cropHeight });
      console.log('Zoomed crop:', {
        x: zoomCropX,
        y: zoomCropY,
        w: zoomCropWidth,
        h: zoomCropHeight,
      });
      console.log('Clamped crop:', {
        x: clampedX,
        y: clampedY,
        w: clampedWidth,
        h: clampedHeight,
      });

      // Check if crop is valid
      if (clampedWidth < 10 || clampedHeight < 10) {
        console.warn('Crop too small or out of bounds!');
        debugLog('⚠️ Frame outside camera view');

        // Fill with warning instead of black
        const gradient = ctx.createLinearGradient(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        gradient.addColorStop(0, '#ff9900');
        gradient.addColorStop(1, '#ff6600');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('FRAME OUTSIDE', canvas.width / 2, canvas.height / 2 - 20);
        ctx.fillText('CAMERA VIEW', canvas.width / 2, canvas.height / 2 + 20);
      } else {
        // Draw the cropped and zoomed portion of video to canvas
        ctx.drawImage(
          cameraVideo,
          clampedX,
          clampedY,
          clampedWidth,
          clampedHeight, // Source crop (from video)
          0,
          0,
          canvas.width,
          canvas.height, // Destination (full canvas)
        );
      }

      debugLog('✅ Captured from video feed!');
      debugLog(
        `Crop: ${Math.round(cropWidth)}x${Math.round(
          cropHeight,
        )} @ zoom ${ZOOM_FACTOR}x`,
      );
    } else if (cameraTexture && xrGLBinding) {
      // METHOD 2: Use XR Raw Camera Access (if available)
      // We have camera access! Draw the camera texture
      console.log('Attempting to read camera texture...');
      const gl = renderer.getContext();

      // Create a framebuffer to read the camera texture
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        cameraTexture,
        0,
      );

      // Check framebuffer status
      const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      console.log(
        'Framebuffer status:',
        fbStatus,
        'Complete:',
        gl.FRAMEBUFFER_COMPLETE,
      );

      if (fbStatus === gl.FRAMEBUFFER_COMPLETE) {
        // Read pixels from the camera texture
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );

        // Check if we got actual data
        const hasData = pixels.some((p) => p !== 0);
        console.log('Pixels read, has non-zero data:', hasData);

        // Create ImageData and put on canvas
        const imageData = new ImageData(
          new Uint8ClampedArray(pixels),
          canvas.width,
          canvas.height,
        );
        ctx.putImageData(imageData, 0, 0);

        // Cleanup
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);

        debugLog(`📷 Camera texture: ${hasData ? 'SUCCESS' : 'EMPTY'}`);
      } else {
        console.warn('Framebuffer incomplete, status:', fbStatus);
        debugLog('⚠️ Framebuffer incomplete');
        throw new Error('Framebuffer incomplete');
      }
    } else {
      // No camera texture, try capturing renderer canvas
      console.log('No camera texture, using renderer canvas');
      debugLog('⚠️ Using renderer canvas (no camera)');
      const rendererCanvas = renderer.domElement;

      // Project 3D frame positions to screen coordinates to crop properly
      const minX = Math.min(topLeft.x, bottomRight.x);
      const maxX = Math.max(topLeft.x, bottomRight.x);
      const minY = Math.min(topLeft.y, bottomRight.y);
      const maxY = Math.max(topLeft.y, bottomRight.y);

      const topLeftScreen = new THREE.Vector3(
        minX,
        maxY,
        (topLeft.z + bottomRight.z) / 2,
      );
      const bottomRightScreen = new THREE.Vector3(
        maxX,
        minY,
        (topLeft.z + bottomRight.z) / 2,
      );

      topLeftScreen.project(camera);
      bottomRightScreen.project(camera);

      const canvasWidth = rendererCanvas.width;
      const canvasHeight = rendererCanvas.height;

      const cropX = ((topLeftScreen.x + 1) / 2) * canvasWidth;
      const cropY = ((1 - topLeftScreen.y) / 2) * canvasHeight;
      const cropWidth =
        ((bottomRightScreen.x - topLeftScreen.x) / 2) * canvasWidth;
      const cropHeight =
        ((topLeftScreen.y - bottomRightScreen.y) / 2) * canvasHeight;

      // Draw the cropped portion
      ctx.drawImage(
        rendererCanvas,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      debugLog('⚠️ No camera texture, using renderer canvas');
    }

    // Add small timestamp in corner
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(canvas.width - 200, canvas.height - 40, 200, 40);
    ctx.fillStyle = 'white';
    ctx.font = '16px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(
      new Date().toLocaleTimeString(),
      canvas.width - 10,
      canvas.height - 15,
    );
  } catch (err) {
    console.warn('Could not capture camera:', err);
    debugLog(`❌ Capture error: ${err.message}`);

    // Final fallback: gradient
    const gradient = ctx.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    gradient.addColorStop(0, '#ff006e');
    gradient.addColorStop(0.5, '#8338ec');
    gradient.addColorStop(1, '#3a86ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(
      'CAMERA ACCESS UNAVAILABLE',
      canvas.width / 2,
      canvas.height / 2,
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  const planeMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
  });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);

  // Add yellow border around the captured plane
  const borderGeometry = new THREE.EdgesGeometry(planeGeometry);
  const borderMaterial = new THREE.LineBasicMaterial({
    color: 0xffff00,
    linewidth: 3,
  });
  const border = new THREE.LineSegments(borderGeometry, borderMaterial);
  plane.add(border);

  // Position plane at center of frame
  plane.position.set(
    (topLeft.x + bottomRight.x) / 2,
    (topLeft.y + bottomRight.y) / 2,
    (topLeft.z + bottomRight.z) / 2,
  );

  // Match camera rotation
  plane.quaternion.copy(camera.quaternion);

  scene.add(plane);
  capturedPlanes.push(plane);

  // Convert canvas to data URL and save to Firebase
  const imageDataURL = canvas.toDataURL('image/png');
  const captureData = {
    timestamp: Date.now(),
    imageData: imageDataURL,
    dimensions: {
      width: width,
      height: height,
    },
    position: {
      x: (topLeft.x + bottomRight.x) / 2,
      y: (topLeft.y + bottomRight.y) / 2,
      z: (topLeft.z + bottomRight.z) / 2,
    },
  };

  // Save to Firebase (in room-specific folder)
  try {
    if (!currentRoomId) {
      debugLog('⚠️ No room selected');
      return;
    }
    const capturesRef = ref(database, `rooms/${currentRoomId}/captures`);
    const newCaptureRef = push(capturesRef);
    await set(newCaptureRef, captureData);
    debugLog(`💾 Saved to room: ${currentRoomId}`);
  } catch (err) {
    console.warn('Could not save to Firebase:', err);
    debugLog('⚠️ Firebase save failed');
  }

  // Play sound effect
  try {
    const audio = new Audio('./assets/camera-shutter.mp3');
    audio.volume = 0.5; // Set volume to 50%
    audio.play().catch((err) => {
      console.warn('Could not play camera sound:', err);
    });
    debugLog('📸 Captured!');
  } catch (err) {
    console.warn('Error creating audio:', err);
  }

  // Limit number of captured planes
  if (capturedPlanes.length > MAX_CAPTURED_PLANES) {
    const oldPlane = capturedPlanes.shift();
    scene.remove(oldPlane);
    oldPlane.geometry.dispose();
    oldPlane.material.map.dispose();
    oldPlane.material.dispose();
    debugLog(`🗑️ Removed oldest capture (limit: ${MAX_CAPTURED_PLANES})`);
  }
}

function updateFrameVisualization() {
  // Use the stored handedness to correctly map hand objects
  let actualLeftHand = null;
  let actualRightHand = null;

  // Debug: Log the handedness values (reduce frequency to 5 seconds to avoid spam)
  const debugNow = Date.now();
  if (debugNow - lastDetailedDebugTime > 5000) {
    debugLog(`🔍 hand0=${hand0Handedness} hand1=${hand1Handedness}`);
  }

  // Map based on the handedness stored from connected events
  if (hand0Handedness === 'left') {
    actualLeftHand = leftHand; // getHand(0) is left hand
  } else if (hand0Handedness === 'right') {
    actualRightHand = leftHand; // getHand(0) is right hand
  }

  if (hand1Handedness === 'left') {
    actualLeftHand = rightHand; // getHand(1) is left hand
  } else if (hand1Handedness === 'right') {
    actualRightHand = rightHand; // getHand(1) is right hand
  }

  // Debug: Log what was mapped (DISABLED to reduce spam)
  // if (debugNow - lastDetailedDebugTime > 5000) {
  //   const leftMapped = actualLeftHand
  //     ? actualLeftHand === leftHand
  //       ? 'hand[0]'
  //       : 'hand[1]'
  //     : 'NONE';
  //   const rightMapped = actualRightHand
  //     ? actualRightHand === leftHand
  //       ? 'hand[0]'
  //       : 'hand[1]'
  //     : 'NONE';
  //   debugLog(`🗺️ Mapped: LEFT=${leftMapped} RIGHT=${rightMapped}`);
  // }

  // Detect gestures for both hands using the actual handedness
  const leftGesture = actualLeftHand
    ? detectHandGesture(actualLeftHand, 'LEFT')
    : null;
  const rightGesture = actualRightHand
    ? detectHandGesture(actualRightHand, 'RIGHT')
    : null;

  // Debug: Log detected gestures (DISABLED to reduce spam)
  // if (debugNow - lastDetailedDebugTime > 5000) {
  //   if (actualLeftHand)
  //     debugLog(`👈 LEFT detection result: ${leftGesture || 'null'}`);
  //   if (actualRightHand)
  //     debugLog(`👉 RIGHT detection result: ${rightGesture || 'null'}`);
  // }

  const leftLShape = leftGesture === 'L_SHAPE';
  const rightLShape = rightGesture === 'L_SHAPE';
  const leftPinch = leftGesture === 'PINCH';
  const rightPinch = rightGesture === 'PINCH';

  // Either L-shape OR pinch should show the frame (both have 3 fingers curled)
  const leftFrameGesture = leftLShape || leftPinch;
  const rightFrameGesture = rightLShape || rightPinch;

  // Update corner markers
  let leftLPos = null;
  let rightLPos = null;

  if (leftFrameGesture) {
    leftLPos = getLShapePosition(actualLeftHand, 'LEFT');
    if (leftLPos) {
      frameCornerLeft.position.copy(leftLPos);
      frameCornerLeft.visible = true;
    } else {
      frameCornerLeft.visible = false;
      debugLog(`⚠️ LEFT gesture detected but no L position`);
    }
  } else {
    frameCornerLeft.visible = false;
  }

  if (rightFrameGesture) {
    rightLPos = getLShapePosition(actualRightHand, 'RIGHT');
    if (rightLPos) {
      frameCornerRight.position.copy(rightLPos);
      frameCornerRight.visible = true;
    } else {
      frameCornerRight.visible = false;
      debugLog(`⚠️ RIGHT gesture detected but no L position`);
    }
  } else {
    frameCornerRight.visible = false;
  }

  // Show frame when both hands are in frame gesture (L-shape or pinch)
  const bothFrameGesture =
    leftFrameGesture && rightFrameGesture && leftLPos && rightLPos;

  // Check if both hands are pinching (capture trigger)
  const bothPinch = leftPinch && rightPinch;

  // Debug: Show current status (DISABLED - hands are working now, no need for spam)
  // Only show hand mapping every 10 seconds for monitoring
  const now = Date.now();
  if (now - lastDetailedDebugTime > 10000) {
    // Only show if there's an issue
    if (!hand0Handedness && !hand1Handedness) {
      debugLog(`⚠️ No hands connected`);
    }

    lastDetailedDebugTime = now;
  }

  // Only log CHANGES or important events (not every frame)
  if (bothFrameGesture) {
    // Only log once when both hands detected
    if (!frameLine.visible) {
      debugLog(`✅ BOTH HANDS - Frame visible`);
    }
  }

  if (bothPinch && bothFrameGesture) {
    // This will get logged with capture anyway
    // debugLog(`📸 READY TO CAPTURE!`);
  }

  // Trigger capture if both hands pinching while frame is active
  if (bothPinch && bothFrameGesture) {
    const now = Date.now();
    if (now - lastCaptureTime > CAPTURE_DEBOUNCE) {
      captureFrame(leftLPos, rightLPos);
      lastCaptureTime = now;
    }
  }

  if (bothFrameGesture) {
    // Calculate frame bounds (ignoring Z, using average)
    const avgZ = (leftLPos.z + rightLPos.z) / 2;

    // Determine corners based on hand positions
    const minX = Math.min(leftLPos.x, rightLPos.x);
    const maxX = Math.max(leftLPos.x, rightLPos.x);
    const minY = Math.min(leftLPos.y, rightLPos.y);
    const maxY = Math.max(leftLPos.y, rightLPos.y);

    // Update dashed frame border
    frameLine.visible = true;
    const positions = frameLine.geometry.attributes.position.array;

    // Draw rectangle (top-left, top-right, bottom-right, bottom-left, back to top-left)
    // Top-left
    positions[0] = minX;
    positions[1] = maxY;
    positions[2] = avgZ;

    // Top-right
    positions[3] = maxX;
    positions[4] = maxY;
    positions[5] = avgZ;

    // Bottom-right
    positions[6] = maxX;
    positions[7] = minY;
    positions[8] = avgZ;

    // Bottom-left
    positions[9] = minX;
    positions[10] = minY;
    positions[11] = avgZ;

    // Close the loop (back to top-left)
    positions[12] = minX;
    positions[13] = maxY;
    positions[14] = avgZ;

    frameLine.geometry.attributes.position.needsUpdate = true;
    frameLine.computeLineDistances(); // Update dashes

    // Update passthrough window (rectangular plane inside frame)
    const width = maxX - minX;
    const height = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    passthroughWindow.visible = true;
    passthroughWindow.position.set(centerX, centerY, avgZ - 0.01);
    passthroughWindow.scale.set(width, height, 1);

    // Match camera's rotation instead of just looking at it
    passthroughWindow.quaternion.copy(camera.quaternion);
  } else {
    frameLine.visible = false;
    passthroughWindow.visible = false;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

let lastCameraDebugTime = 0;
let renderCallCount = 0;
let cameraStatusReported = false;

function render(timestamp, frame) {
  // Debug: Check if render is even being called
  renderCallCount++;
  if (renderCallCount === 1) {
    debugLog('🎬 Render loop started!');
  }

  // Try to get camera image if available
  if (frame && xrGLBinding && currentSession) {
    try {
      const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
      if (pose && pose.views && pose.views.length > 0) {
        const view = pose.views[0];

        // Report camera status ONCE after a few frames (to avoid spam)
        if (!cameraStatusReported && renderCallCount > 60) {
          debugLog(`━━━ CAMERA STATUS ━━━`);
          debugLog(`getUserMedia: ${cameraVideo ? 'YES ✅' : 'NO'}`);
          debugLog(`view.camera: ${!!view.camera ? 'YES' : 'NO'}`);
          debugLog(
            `getCameraImage: ${
              typeof xrGLBinding.getCameraImage === 'function' ? 'YES' : 'NO'
            }`,
          );

          if (cameraVideo) {
            debugLog(`✅ Using getUserMedia video`);
            debugLog(
              `Video: ${cameraVideo.videoWidth}x${cameraVideo.videoHeight}`,
            );
          } else if (!view.camera) {
            debugLog(`❌ No camera access`);
            debugLog(`Captures will be black`);
          } else if (typeof xrGLBinding.getCameraImage !== 'function') {
            debugLog(`❌ getCameraImage() not supported`);
            debugLog(`Captures will be black`);
          }
          debugLog(`━━━━━━━━━━━━━━━━━━`);

          cameraStatusReported = true;
          console.log('Full camera debug:', {
            hasView: !!view,
            hasCamera: !!view.camera,
            hasCameraImage: !!view.cameraImage,
            hasGetCameraImage: typeof xrGLBinding.getCameraImage === 'function',
            xrGLBinding: xrGLBinding,
          });
        }

        // Try to get camera image from view (silently, no spam)
        if (view.camera && xrGLBinding.getCameraImage) {
          cameraTexture = xrGLBinding.getCameraImage(view.camera);
        } else if (view.cameraImage) {
          cameraTexture = view.cameraImage;
        }
      }
    } catch (err) {
      if (!cameraStatusReported) {
        console.error('Error getting camera image:', err);
        debugLog(`❌ Camera error: ${err.message}`);
        cameraStatusReported = true;
      }
    }
  }

  // Debug: Check hand status periodically (DISABLED - too spammy, hands are working now)
  // const now = Date.now();
  // if (now - lastHandDebugTime > 10000) {  // Reduced to every 10 seconds
  //   if (currentSession) {
  //     const sources = currentSession.inputSources;
  //     let hasHands = sources.some(s => s.hand);
  //     if (!hasHands) {
  //       debugLog(`⚠️ No hands detected`);
  //     }
  //   }
  //   lastHandDebugTime = now;
  // }

  // Update frame visualization and capture
  // (Hand models update automatically via XRHandModelFactory)
  updateFrameVisualization();

  renderer.render(scene, camera);
}

async function startAR() {
  console.log('🚀 Starting AR session...');

  const arButton = document.getElementById('ar-button');
  arButton.textContent = 'Starting...';
  arButton.disabled = true;

  try {
    const sessionInit = {
      requiredFeatures: ['hand-tracking'],
      optionalFeatures: [
        'local-floor',
        'bounded-floor',
        'layers',
        'camera-access',
      ],
    };

    console.log('Requesting XR session with:', sessionInit);
    const session = await navigator.xr.requestSession(
      'immersive-ar',
      sessionInit,
    );
    await onSessionStarted(session);
  } catch (err) {
    console.error('Failed to start AR session:', err);

    // Try again without hand-tracking as required
    console.log('Retrying without required hand-tracking...');
    try {
      const fallbackInit = {
        optionalFeatures: [
          'hand-tracking',
          'local-floor',
          'bounded-floor',
          'layers',
        ],
      };

      const session = await navigator.xr.requestSession(
        'immersive-ar',
        fallbackInit,
      );
      await onSessionStarted(session);

      alert(
        '⚠️ AR started but hand-tracking may not be available. Check console for details.',
      );
    } catch (fallbackErr) {
      console.error('Fallback also failed:', fallbackErr);
      alert(
        `Failed to start AR:\n\n${err.message}\n\nMake sure you're on a WebXR-compatible device and have granted necessary permissions.`,
      );

      arButton.textContent = 'Start AR Experience';
      arButton.disabled = false;
    }
  }
}

async function onSessionStarted(session) {
  console.log('Session started!', session);
  debugLog('🚀 AR Session Started');

  session.addEventListener('end', onSessionEnded);
  await renderer.xr.setSession(session);
  currentSession = session;

  // Initialize XRWebGLBinding for camera access
  debugLog('🔍 Checking camera support...');
  try {
    console.log('Checking camera access support...');
    console.log(
      'XRWebGLBinding available:',
      typeof XRWebGLBinding !== 'undefined',
    );
    console.log('Session enabled features:', session.enabledFeatures);

    // Detailed feature check
    const hasCameraAccess =
      session.enabledFeatures &&
      session.enabledFeatures.includes('camera-access');
    debugLog(
      `📷 Camera access feature: ${
        hasCameraAccess ? 'ENABLED' : 'NOT ENABLED'
      }`,
    );
    console.log('Has camera-access feature:', hasCameraAccess);

    if (typeof XRWebGLBinding !== 'undefined') {
      const gl = renderer.getContext();
      xrGLBinding = new XRWebGLBinding(session, gl);
      debugLog('📷 Camera binding created');
      console.log('XRWebGLBinding:', xrGLBinding);
      console.log(
        'getCameraImage method available:',
        typeof xrGLBinding.getCameraImage === 'function',
      );
      debugLog(
        `getCameraImage: ${
          typeof xrGLBinding.getCameraImage === 'function' ? 'YES' : 'NO'
        }`,
      );
    } else {
      debugLog('⚠️ XRWebGLBinding not supported');
      console.warn(
        'XRWebGLBinding not available - camera capture will not work',
      );
    }
  } catch (err) {
    console.error('Could not initialize camera access:', err);
    debugLog(`⚠️ Camera init failed: ${err.message}`);
  }

  // Check if hand tracking is actually available
  console.log('Input sources:', session.inputSources);
  debugLog(`Input sources: ${session.inputSources.length}`);

  // Check initial input sources
  session.inputSources.forEach((source, i) => {
    if (source.hand) {
      const jointCount = source.hand.size || source.hand.length || 'unknown';
      debugLog(`✋ Initial ${source.handedness}: ${jointCount} joints`);
    } else {
      debugLog(`🎮 Initial ${source.handedness}: controller`);
    }
  });

  if (session.inputSources.length === 0) {
    debugLog('⚠️ No input sources yet');
    debugLog('👋 Wave hands or grab controllers');
  }

  session.addEventListener('inputsourceschange', (event) => {
    console.log('Input sources changed:', event);
    debugLog('⚡ Input sources changed');

    let handCount = 0;
    event.session.inputSources.forEach((source, i) => {
      console.log(`Source ${i}:`, {
        handedness: source.handedness,
        hasHand: !!source.hand,
        profiles: source.profiles,
      });

      if (source.hand) {
        handCount++;
        const jointCount = source.hand.size || source.hand.length || 'unknown';
        debugLog(`✋ ${source.handedness}: ${jointCount} joints`);
      } else {
        debugLog(`🎮 ${source.handedness}: controller`);
      }
    });

    if (handCount === 0) {
      debugLog('⚠️ No hands detected!');
      debugLog('📱 Enable hand tracking in Quest settings');
    }
  });

  console.log(
    'AR session started! Hand tracking:',
    session.inputSources.length > 0,
  );

  // Hide UI elements when in AR
  document.getElementById('info').style.display = 'none';
  document.getElementById('instructions').style.display = 'none';
}

function onSessionEnded() {
  currentSession.removeEventListener('end', onSessionEnded);
  currentSession = null;

  // Show UI elements again
  document.getElementById('info').style.display = 'block';
  document.getElementById('instructions').style.display = 'block';

  console.log('AR session ended');
}
