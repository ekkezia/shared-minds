// WebXR Passthrough Camera with Hand Tracking and Frame Capture
// References:
// https://github.com/mrdoob/three.js/blob/master/examples/webxr_ar_cones.html
// https://github.com/mrdoob/three.js/blob/master/examples/webxr_vr_handinput_profiles.html

import * as THREE from 'three';
import { XRHandModelFactory } from 'https://cdn.jsdelivr.net/npm/three@0.145.0/examples/jsm/webxr/XRHandModelFactory.js';

let camera, scene, renderer;
let currentSession;

// Hand tracking
let leftHand, rightHand;
let leftHandModel, rightHandModel;
let handModelFactory;
let leftPinchPos = null,
  rightPinchPos = null;
let leftPinching = false,
  rightPinching = false;
let wasBothPinching = false;
let lastCaptureTime = 0;
const CAPTURE_DEBOUNCE = 1000; // 1 second between captures

// Track which hand object (getHand(0) or getHand(1)) corresponds to which handedness
let hand0Handedness = null; // Will be 'left' or 'right'
let hand1Handedness = null; // Will be 'left' or 'right'

// Frame visualization
let frameCornerLeft, frameCornerRight;
let frameLine;
let capturedPlanes = [];

// Dark overlay planes (to block passthrough except in frame area)
let overlayTop, overlayBottom, overlayLeft, overlayRight, blackSphere;
let passthroughWindow = null;

// 3D Debug panel
let debugPanel;
let debugCanvas;
let debugTexture;

// Constants
const PINCH_THRESHOLD = 0.03; // Distance in meters to consider as pinch
const HAND_JOINT_COUNT = 25;

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

function init() {
  console.log('Initializing Three.js and WebXR...');
  console.log('Document body:', document.body);
  console.log('Available elements:', {
    info: document.getElementById('info'),
    arButton: document.getElementById('ar-button'),
    instructions: document.getElementById('instructions'),
  });

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
    hand0Handedness = inputSource.handedness; // Store the actual handedness!
    debugLog(`🤚 Hand[0] CONNECTED as ${hand0Handedness.toUpperCase()}`);
    debugLog(
      `Hand[0]: hand=${!!inputSource.hand} profiles=${
        inputSource.profiles?.[0] || 'none'
      }`,
    );
  });

  leftHand.addEventListener('disconnected', () => {
    debugLog('❌ Hand[0] disconnected');
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
    hand1Handedness = inputSource.handedness; // Store the actual handedness!
    debugLog(`🤚 Hand[1] CONNECTED as ${hand1Handedness.toUpperCase()}`);
    debugLog(
      `Hand[1]: hand=${!!inputSource.hand} profiles=${
        inputSource.profiles?.[0] || 'none'
      }`,
    );
  });

  rightHand.addEventListener('disconnected', () => {
    debugLog('❌ Hand[1] disconnected');
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

  arButton.addEventListener('click', () => {
    console.log('🖱️ AR button clicked!');
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
    debugLog(`${expectedHandedness} only has ${joints?.length || 0} joints (need ${minJoints})`);
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
    middleExtended = isFingerExtended('MIDDLE', joints[10], joints[11], joints[12]);
    ringExtended = isFingerExtended('RING', joints[14], joints[15], joints[16]);
    pinkyExtended = isFingerExtended('PINKY', joints[18], joints[19], joints[20]);
  } else {
    // Left hand - REVERSED order AND reversed within each finger!
    // Based on user report: index is [18-22] (tip to metacarpal), thumb tip is [23], thumb distal is [24]
    // Each finger goes TIP to BASE (reversed from right hand)

    pinkyExtended = isFingerExtended('PINKY', joints[4], joints[3], joints[2]); // Reversed within finger
    ringExtended = isFingerExtended('RING', joints[8], joints[7], joints[6]); // Reversed
    middleExtended = isFingerExtended('MIDDLE', joints[12], joints[11], joints[10]); // Reversed

    // Index: [18-22] is tip to metacarpal, use [20, 19, 18] for (base, mid, tip)
    indexExtended = isFingerExtended('INDEX', joints[20], joints[19], joints[18]);

    // Thumb: [23]=tip, [24]=distal, [25]=proximal (if exists)
    // Try using [25, 24, 23] for (base, mid, tip) or [24, 23, 22] if no [25]
    if (joints[25]) {
      thumbExtended = isFingerExtended('THUMB', joints[25], joints[24], joints[23]);
    } else if (joints[22]) {
      thumbExtended = isFingerExtended('THUMB', joints[24], joints[23], joints[22]);
    } else {
      thumbExtended = false; // Not enough joints
    }
  }

  // THE KEY CONDITION for L-shape:
  // 1. Middle, ring, pinky are curled (NOT extended)
  // 2. Thumb AND index ARE extended (forming the L)
  const threeFingersCurled = !middleExtended && !ringExtended && !pinkyExtended;
  const thumbAndIndexExtended = thumbExtended && indexExtended;

  // Compact debug: show finger states
  const fingerStates = `T${thumbExtended ? '✓' : '✗'} I${
    indexExtended ? '✓' : '✗'
  } M${middleExtended ? '✓' : '✗'} R${ringExtended ? '✓' : '✗'} P${
    pinkyExtended ? '✓' : '✗'
  }`;

  // Debug: show finger states (can disable once working)
  debugLog(`🤚 ${handedness} Fingers: ${fingerStates}`);

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

function captureFrame(topLeft, bottomRight) {
  console.log('Capturing frame!', topLeft, bottomRight);

  // Calculate frame dimensions
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(topLeft.y - bottomRight.y);

  if (width < 0.01 || height < 0.01) {
    console.log('Frame too small, skipping capture');
    return;
  }

  // Create a textured plane
  const planeGeometry = new THREE.PlaneGeometry(width, height);

  // Capture the current renderer output (passthrough camera view)
  const canvas = document.createElement('canvas');
  const aspectRatio = height / width;
  canvas.width = 1024;
  canvas.height = Math.floor(1024 * aspectRatio);
  const ctx = canvas.getContext('2d');

  // Try to capture from the renderer's canvas
  try {
    // Get the renderer's canvas
    const rendererCanvas = renderer.domElement;

    // Project 3D frame positions to screen coordinates to crop properly
    const minX = Math.min(topLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, bottomRight.y);

    // Create temporary vectors for projection
    const topLeftScreen = new THREE.Vector3(minX, maxY, (topLeft.z + bottomRight.z) / 2);
    const bottomRightScreen = new THREE.Vector3(maxX, minY, (topLeft.z + bottomRight.z) / 2);

    // Project to screen space
    topLeftScreen.project(camera);
    bottomRightScreen.project(camera);

    // Convert from NDC (-1 to 1) to pixel coordinates
    const canvasWidth = rendererCanvas.width;
    const canvasHeight = rendererCanvas.height;

    const cropX = ((topLeftScreen.x + 1) / 2) * canvasWidth;
    const cropY = ((1 - topLeftScreen.y) / 2) * canvasHeight;
    const cropWidth = ((bottomRightScreen.x - topLeftScreen.x) / 2) * canvasWidth;
    const cropHeight = ((topLeftScreen.y - bottomRightScreen.y) / 2) * canvasHeight;

    // Draw the cropped portion of the renderer canvas
    ctx.drawImage(
      rendererCanvas,
      cropX, cropY, cropWidth, cropHeight,
      0, 0, canvas.width, canvas.height
    );

    // Add small timestamp in corner
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(canvas.width - 200, canvas.height - 40, 200, 40);
    ctx.fillStyle = 'white';
    ctx.font = '16px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width - 10, canvas.height - 15);

  } catch (err) {
    console.warn('Could not capture from renderer, using fallback:', err);
    // Fallback: Just capture the entire renderer output
    const rendererCanvas = renderer.domElement;
    ctx.drawImage(rendererCanvas, 0, 0, canvas.width, canvas.height);

    // Add timestamp
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(canvas.width - 200, canvas.height - 40, 200, 40);
    ctx.fillStyle = 'white';
    ctx.font = '16px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width - 10, canvas.height - 15);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const planeMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
  });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);

  // Position plane at center of frame
  plane.position.set(
    (topLeft.x + bottomRight.x) / 2,
    (topLeft.y + bottomRight.y) / 2,
    (topLeft.z + bottomRight.z) / 2,
  );

  // Make plane face the camera
  plane.lookAt(camera.position);

  scene.add(plane);
  capturedPlanes.push(plane);

  // Play sound effect
  try {
    const audio = new Audio('./assets/camera-shutter.mp3');
    audio.volume = 0.5; // Set volume to 50%
    audio.play().catch((err) => {
      console.warn('Could not play camera sound:', err);
      debugLog('📸 Captured (no sound)');
    });
    debugLog('📸 Captured!');
  } catch (err) {
    console.warn('Error creating audio:', err);
    debugLog('📸 Captured (no sound)');
  }

  // Limit number of captured planes
  if (capturedPlanes.length > 5) {
    const oldPlane = capturedPlanes.shift();
    scene.remove(oldPlane);
    oldPlane.geometry.dispose();
    oldPlane.material.map.dispose();
    oldPlane.material.dispose();
  }
}

function updateFrameVisualization() {
  // Use the stored handedness to correctly map hand objects
  let actualLeftHand = null;
  let actualRightHand = null;

  // Debug: Log the handedness values
  const debugNow = Date.now();
  if (debugNow - lastDetailedDebugTime > 500) {
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

  // Debug: Log what was mapped
  if (debugNow - lastDetailedDebugTime > 500) {
    const leftMapped = actualLeftHand
      ? actualLeftHand === leftHand
        ? 'hand[0]'
        : 'hand[1]'
      : 'NONE';
    const rightMapped = actualRightHand
      ? actualRightHand === leftHand
        ? 'hand[0]'
        : 'hand[1]'
      : 'NONE';
    debugLog(`🗺️ Mapped: LEFT=${leftMapped} RIGHT=${rightMapped}`);
  }

  // Detect gestures for both hands using the actual handedness
  const leftGesture = actualLeftHand
    ? detectHandGesture(actualLeftHand, 'LEFT')
    : null;
  const rightGesture = actualRightHand
    ? detectHandGesture(actualRightHand, 'RIGHT')
    : null;

  // Debug: Log detected gestures
  if (debugNow - lastDetailedDebugTime > 500) {
    if (actualLeftHand)
      debugLog(`👈 LEFT detection result: ${leftGesture || 'null'}`);
    if (actualRightHand)
      debugLog(`👉 RIGHT detection result: ${rightGesture || 'null'}`);
  }

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

  // Debug: Show current status
  const now = Date.now();
  if (now - lastDetailedDebugTime > 500) {
    const leftState = leftGesture || 'none';
    const rightState = rightGesture || 'none';

    // Show both hands status in one line
    const leftIcon = leftFrameGesture ? '🟡' : '⚫';
    const rightIcon = rightFrameGesture ? '🟡' : '⚫';
    debugLog(`${leftIcon} L:${leftState} | R:${rightState} ${rightIcon}`);

    // Debug what the session reports
    let sessionLeftCount = 0;
    let sessionRightCount = 0;
    if (currentSession && currentSession.inputSources) {
      currentSession.inputSources.forEach((source) => {
        if (source.hand) {
          if (source.handedness === 'left') sessionLeftCount++;
          if (source.handedness === 'right') sessionRightCount++;
        }
      });
    }
    debugLog(
      `Session: ${sessionLeftCount} left, ${sessionRightCount} right hands`,
    );

    // Debug handedness tracking
    debugLog(
      `Hand mapping: [0]=${hand0Handedness || 'none'} [1]=${
        hand1Handedness || 'none'
      }`,
    );

    // Debug model data availability
    const leftModelHasData =
      leftHandModel &&
      leftHandModel.children &&
      leftHandModel.children.length > 0;
    const rightModelHasData =
      rightHandModel &&
      rightHandModel.children &&
      rightHandModel.children.length > 0;
    debugLog(
      `Models: hand[0]=${leftModelHasData ? 'HAS DATA' : 'empty'} hand[1]=${
        rightModelHasData ? 'HAS DATA' : 'empty'
      }`,
    );

    // Debug which actual hand is being used
    const actualLeftUsed =
      actualLeftHand === leftHand
        ? '0'
        : actualLeftHand === rightHand
        ? '1'
        : 'none';
    const actualRightUsed =
      actualRightHand === leftHand
        ? '0'
        : actualRightHand === rightHand
        ? '1'
        : 'none';
    debugLog(`Using: L=hand[${actualLeftUsed}] R=hand[${actualRightUsed}]`);

    // Debug if detection is working
    if (actualLeftHand && !leftGesture) {
      debugLog(`⚠️ Left hand object exists but no gesture detected`);
    }
    if (actualRightHand && !rightGesture) {
      debugLog(`⚠️ Right hand object exists but no gesture detected`);
    }

    // Debug sphere visibility
    const leftSphereVisible = frameCornerLeft.visible;
    const rightSphereVisible = frameCornerRight.visible;
    debugLog(`Spheres - L:${leftSphereVisible} R:${rightSphereVisible}`);

    if (bothFrameGesture) {
      debugLog(`✅ BOTH HANDS - Frame visible`);
    } else if (leftFrameGesture) {
      debugLog(`⚠️ Only LEFT detected`);
    } else if (rightFrameGesture) {
      debugLog(`⚠️ Only RIGHT detected`);
    }

    if (bothPinch && bothFrameGesture) {
      debugLog(`📸 READY TO CAPTURE!`);
    }
    lastDetailedDebugTime = now;
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

    // Rotate to face camera
    passthroughWindow.lookAt(camera.position);
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

function render() {
  // Debug: Check hand status periodically
  const now = Date.now();
  if (now - lastHandDebugTime > 2000) {
    if (currentSession) {
      // Check input sources directly
      const sources = currentSession.inputSources;
      debugLog(`Input sources: ${sources.length}`);

      let hasControllers = false;
      let hasHands = false;

      sources.forEach((source) => {
        if (source.hand) {
          hasHands = true;
          debugLog(`✋ ${source.handedness} hand detected`);
        } else {
          hasControllers = true;
          debugLog(`🎮 ${source.handedness} controller`);
        }
      });

      if (hasControllers && !hasHands) {
        debugLog(`❌ PUT DOWN CONTROLLERS!`);
        debugLog(`Wave hands without holding anything`);
      }

      // Hand gesture checking is now done in updateFrameVisualization()
      // with proper handedness detection
    }
    lastHandDebugTime = now;
  }

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
      optionalFeatures: ['local-floor', 'bounded-floor', 'layers'],
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
