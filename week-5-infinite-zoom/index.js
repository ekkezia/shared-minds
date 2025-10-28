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

// Constants
// Hardcoded Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyB3NIp4zg94-XxVOUkdnl-w1oYZ_Qo32Lw',
  authDomain: 'pipipip-c1210.firebaseapp.com',
  databaseURL: 'https://pipipip-c1210-default-rtdb.firebaseio.com/',
  projectId: 'pipipip-c1210',
  messagingSenderId: '431347949307',
  appId: '1:431347949307:web:a83ba36b06e6db73041a5e',
  measurementId: 'G-4HP4GMTH2W',
};

// Global state
let firebaseApp = null;
let database = null;
let imageCache = new Map();
let currentImages = [];
let currentImgIdx = -1;
let currentPlacement = null;
let pendingImageFile = null; // Store the file before processing
let pendingOriginalDataURL = null; // Store the original image data URL
let fileInput = null;

// Utility functions
const $ = (id) => document.getElementById(id);
const cursorEl = document.createElement('div');
cursorEl.style.position = 'fixed';
cursorEl.style.width = '1px';
cursorEl.style.height = '100dvh';
cursorEl.style.backgroundColor = 'blue';
cursorEl.style.opacity = '0.5';
cursorEl.style.pointerEvents = 'none';
document.body.appendChild(cursorEl);

function showLoading() {
  $('loading').style.display = 'flex';
  document.body.style.cursor = 'wait';
}

function hideLoading() {
  $('loading').style.display = 'none';
  document.body.style.cursor = 'default';
}

function showStatus(message, type = 'success') {
  const status = $('upload-status');
  status.textContent = message;
  status.className = `status ${type}`;
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3000);
}

// Convert file to base64 data URL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Initialize Firebase
function initializeFirebase() {
  try {
    console.log('Initializing Firebase with hardcoded config...');
    firebaseApp = initializeApp(firebaseConfig);
    database = getDatabase(firebaseApp);

    showStatus('Firebase initialized successfully!');
    loadTimeline();

    const uploadBtn = $('uploadImage');
    if (uploadBtn) {
      uploadBtn.disabled = false;
    }

    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    showStatus('Firebase initialization failed: ' + error.message, 'error');
    return false;
  }
}

// Load existing timeline from Firebase
async function loadTimeline() {
  try {
    const imagesRef = ref(database, 'images');
    const snapshot = await get(imagesRef);
    const images = snapshot.val() || {};

    currentImages = Object.keys(images)
      .map((key) => ({
        id: key,
        ...images[key],
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    renderTimeline();
  } catch (error) {
    console.error('Error loading timeline:', error);
    showStatus('Error loading timeline: ' + error.message, 'error');
  }
}

// Render timeline UI
function renderTimeline() {
  const timeline = $('timeline');
  if (!timeline) return;

  if (currentImages.length === 0) {
    timeline.innerHTML = `
      <div class="upload-next">
        <input type="file" id="imageInput" accept="image/*" style="display: none;">
        <button id="uploadTrigger" class="upload-plus">+</button>
      </div>
    `;
  } else {
    const timelineImgs = currentImages
      .map(
        (img, index) =>
          `
      <div class="image-item" data-index="${index}">
        <img src="${img.dataURL}" alt="Image ${index + 1}" loading="lazy">
        <div class="image-info">
          ${Math.floor(new Date(img.timestamp).getTime() / 1000).toString()}
        </div>
      </div>
    `,
      )
      .join('');

    const uploadInterface = `
      <div class="upload-next" id="uploadTrigger">
        <input type="file" id="imageInput" accept="image/*" style="display: none;">
        <button class="upload-plus">+</button>
      </div>
    `;

    timeline.innerHTML = timelineImgs + uploadInterface;
  }

  attachUploadListeners();

  const imageItems = document.querySelectorAll('.image-item');
  imageItems.forEach((item) => {
    item.addEventListener('click', () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        currentImgIdx = Number(index);
        renderImageInViewer(imgData, index);
      }
    });

    item.addEventListener('mouseover', async () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        currentImgIdx = Number(index);
        renderImageInViewer(imgData, index);
      }
    });
  });

  requestAnimationFrame(() => {
    timeline.scrollLeft = timeline.scrollWidth;
  });
}

// #viewer div render function
function renderImageInViewer(imgData, index) {
  const imgEl = $('mainImage');
  const bboxEl = $('bbox');
  if (!imgEl) {
    console.error('mainImage element not found');
    return;
  }

  imgEl.style.display = 'block';
  imgEl.src = imgData.dataURL;

  currentImgIdx =
    typeof index !== 'undefined' ? Number(index) : imgData.idx || 0;

  if (bboxEl && imgData.placement) {
    const p = imgData.placement;
    bboxEl.style.display = 'block';
    bboxEl.style.left = p.x + '%';
    bboxEl.style.top = p.y + '%';
    bboxEl.style.width = p.width + '%';
    bboxEl.style.height = p.height + '%';
  } else if (bboxEl) {
    bboxEl.style.display = 'none';
  }

  imgEl.style.transform = 'scale(1)';
}

// ✅ NEW: Process with Canvas after bbox is defined
async function processCanvasWithPlacement() {
  if (!pendingImageFile || !currentPlacement || !pendingOriginalDataURL) {
    console.error('Missing required data for processing');
    return;
  }

  try {
    showLoading();
    showStatus('Compositing images...', 'success');

    const lastImage = currentImages[currentImages.length - 1];

    // Composite images using canvas
    console.log('🎨 Compositing with canvas...');
    const finalDataURL = await compositeImages(
      pendingOriginalDataURL,
      lastImage.dataURL,
      currentPlacement,
    );

    console.log('✅ Image composited successfully!');

    // Create image data with the placement we already defined
    const timestamp = new Date().toISOString();
    const imageData = {
      idx: currentImages.length,
      dataURL: finalDataURL,
      originalDataURL: pendingOriginalDataURL,
      placement: currentPlacement,
      timestamp: timestamp,
      isGenerated: true,
      width: 2048,
      height: 2048,
      filename: pendingImageFile.name,
      fileSize: pendingImageFile.size,
    };

    console.log('Saving to database...');
    showStatus('Saving to database...', 'success');

    await saveImageToDatabase(imageData);

    const newImage = {
      id: Date.now().toString(),
      ...imageData,
    };
    currentImages.push(newImage);
    imageCache.set(finalDataURL, finalDataURL);

    // Display the newly generated image with bbox
    renderImageInViewer(newImage, currentImages.length - 1);

    // Re-render timeline
    renderTimeline();

    // Reset state
    pendingImageFile = null;
    pendingOriginalDataURL = null;
    currentPlacement = null;

    hideLoading();
    showStatus('Upload completed successfully!', 'success');
  } catch (error) {
    console.error('Canvas compositing error:', error);
    hideLoading();
    showStatus('Compositing failed: ' + error.message, 'error');

    // Reset state on error
    pendingImageFile = null;
    pendingOriginalDataURL = null;
    currentPlacement = null;
  }
}

// Function to attach upload listeners
function attachUploadListeners() {
  const uploadTrigger = document.getElementById('uploadTrigger');
  fileInput = document.getElementById('imageInput');

  if (uploadTrigger && fileInput) {
    uploadTrigger.addEventListener('click', (e) => {
      if (!database) {
        showStatus('Firebase not initialized', 'error');
        return;
      }
      fileInput.click();
    });

    // Show preview in viewer
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Convert file to data URL
      const newImageDataURL = await fileToDataURL(file);

      // const imgEl = $('mainImage');
      const imgEl = $('add-image');
      bbox.style.display = 'block';
      if (!imgEl) return;

      // Display new image in viewer
      imgEl.src = newImageDataURL;
      imgEl.style.display = 'block';
      imgEl.style.cursor = 'crosshair';
      imgEl.style.opacity = 1; // optional
      imgEl.style.height = '100%';
      imgEl.style.position = 'absolute';
      imgEl.style.top = 0;
      imgEl.style.left = 0;

      // imgEl.style.left = '50%';
      // imgEl.style.transform = 'translateX(-50%)';

      // Store pending file + data URL for Canvas processing
      pendingImageFile = file;
      pendingOriginalDataURL = newImageDataURL;

      if (currentImages.length > 0) {
        showStatus('Click on the image to place the new image', 'success');
        bbox.style.display = 'none';
        currentPlacement = null; // reset
      } else {
        // First image: upload directly
        handleFirstImageUpload(file, newImageDataURL);
      }

      fileInput.value = '';
    });
  }
}

// Handle first image upload (no bbox needed)
async function handleFirstImageUpload(file, dataURL) {
  try {
    showLoading();
    showStatus('Saving first image...', 'success');

    const timestamp = new Date().toISOString();
    const imageData = {
      idx: 0,
      dataURL: dataURL,
      originalDataURL: dataURL,
      placement: null,
      timestamp: timestamp,
      isGenerated: false,
      width: 2048,
      height: 2048,
      filename: file.name,
      fileSize: file.size,
    };

    await saveImageToDatabase(imageData);

    const newImage = {
      id: Date.now().toString(),
      ...imageData,
    };
    currentImages.push(newImage);
    imageCache.set(dataURL, dataURL);

    renderImageInViewer(newImage, 0);
    renderTimeline();

    hideLoading();
    showStatus('First image uploaded!', 'success');
  } catch (error) {
    console.error('Upload error:', error);
    hideLoading();
    showStatus('Upload failed: ' + error.message, 'error');
  }
}

// Canvas API
async function compositeImages(baseDataURL, overlayDataURL, placement) {
  return new Promise((resolve, reject) => {
    const baseImg = new Image();
    const overlayImg = new Image();

    let baseLoaded = false;
    let overlayLoaded = false;

    const checkBothLoaded = () => {
      if (baseLoaded && overlayLoaded) {
        try {
          // Create canvas with base image dimensions
          const canvas = document.createElement('canvas');
          canvas.width = baseImg.width;
          canvas.height = baseImg.height;
          const ctx = canvas.getContext('2d');

          // Draw base image (backgroundx) at full size
          ctx.drawImage(baseImg, 0, 0, baseImg.width, baseImg.height);

          // Calculate overlay position and size based on base image dimensions
          const x = (placement.x / 100) * baseImg.width;
          const y = (placement.y / 100) * baseImg.height;
          const w = (placement.width / 100) * baseImg.width;
          const h = (placement.height / 100) * baseImg.height;

          // Draw overlay image at specified position
          ctx.drawImage(overlayImg, x, y, w, h);

          // Convert to data URL
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      }
    };

    baseImg.onload = () => {
      baseLoaded = true;
      checkBothLoaded();
    };

    overlayImg.onload = () => {
      overlayLoaded = true;
      checkBothLoaded();
    };

    baseImg.onerror = () => reject(new Error('Failed to load base image'));
    overlayImg.onerror = () =>
      reject(new Error('Failed to load overlay image'));

    baseImg.src = baseDataURL;
    overlayImg.src = overlayDataURL;
  });
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

// Save image data to Firebase
async function saveImageToDatabase(imageData) {
  const imagesRef = ref(database, 'images');
  const newImageRef = push(imagesRef);
  await set(newImageRef, imageData);
  return newImageRef.key;
}

// Zoom handling
const img = $('mainImage');
let virtualScroll = 0;
let zoomLocked = false;
const timeline = $('timeline');

window.addEventListener(
  'wheel',
  (e) => {
    if (timeline && timeline.contains(e.target)) {
      return;
    }

    if (zoomLocked) return;
    if (currentImgIdx < 0 || currentImgIdx >= currentImages.length) return;

    virtualScroll += e.deltaY;
    virtualScroll = Math.max(0, virtualScroll);

    if (!currentImages[currentImgIdx].placement) return;

    const p = currentImages[currentImgIdx].placement;

    // Calculate center of the bbox
    const centerX = p.x + p.width / 2;
    const centerY = p.y + p.height / 2;

    img.style.transform = `scale(${1 + virtualScroll * 0.001})`;
    img.style.transformOrigin = `${centerX}% ${centerY}%`;

    if (Math.abs(e.deltaY) > 100) {
      if (currentImgIdx > 0) currentImgIdx -= 1;

      virtualScroll = 0;
      renderImageInViewer(currentImages[currentImgIdx], currentImgIdx);
      img.style.transform = 'scale(1)';

      zoomLocked = true;
      setTimeout(() => {
        zoomLocked = false;
      }, 500);
    }
  },
  { passive: false },
);

// Timeline cursor effect
document.addEventListener('mousemove', (e) => {
  const body = document.body;
  const x = e.clientX / window.innerWidth;
  const y = e.clientY / window.innerHeight;
  body.style.setProperty('--cursor-x', x);
  body.style.setProperty('--cursor-y', y);

  cursorEl.style.left = `${e.clientX}px`;
  cursorEl.style.top = '0';
  cursorEl.style.opacity = '0.5';

  clearTimeout(cursorEl.fadeTimeout);
  cursorEl.fadeTimeout = setTimeout(() => {
    cursorEl.style.opacity = '0.2';
  }, 500);
});

// BBox drawing listener
const bbox = document.getElementById('add-bbox');
const mainImage = document.getElementById('add-image');

mainImage.addEventListener('click', (e) => {
  if (!currentImages[currentImages.length - 1]) {
    showStatus('⚠️ No previous image to overlay.', 'error');
    return;
  }

  const previousImgURL = currentImages[currentImages.length - 1].dataURL;
  const rect = mainImage.getBoundingClientRect();

  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  const tempImg = new Image();
  tempImg.src = previousImgURL;
  tempImg.onload = () => {
    const imgWidth = tempImg.width;
    const imgHeight = tempImg.height;
    const ASPECT_RATIO = imgWidth / imgHeight;

    // Define bbox height relative to main image
    const bboxHeightPx = rect.height * 0.2;
    const bboxWidthPx = bboxHeightPx * ASPECT_RATIO;
    console.log(
      'img width',
      imgWidth,
      imgHeight,
      ASPECT_RATIO,
      bboxHeightPx,
      bboxWidthPx,
    );

    // Convert to percentages relative to main image
    const leftPct = ((clickX - bboxWidthPx / 2) / rect.width) * 100;
    const topPct = ((clickY - bboxHeightPx / 2) / rect.height) * 100;
    const widthPct = (bboxWidthPx / rect.width) * 100;
    const heightPct = (bboxHeightPx / rect.height) * 100;

    // Apply bbox style in percentages
    bbox.style.left = `${(leftPct / 100) * rect.width}px`;
    bbox.style.top = `${(topPct / 100) * rect.height}px`;
    bbox.style.width = `${(widthPct / 100) * rect.width}px`;
    bbox.style.height = `${(heightPct / 100) * rect.height}px`;
    bbox.style.display = 'block';
    bbox.style.position = 'absolute';
    bbox.style.backgroundImage = `url(${previousImgURL})`;
    bbox.style.backgroundSize = 'contain';
    bbox.style.backgroundPosition = 'center';
    bbox.style.backgroundRepeat = 'no-repeat';
    bbox.style.border = '2px dashed #00bcd4';
    bbox.style.zIndex = 9999;
    bbox.style.boxSizing = 'border-box';

    currentPlacement = {
      x: leftPct, //
      y: topPct,
      width: widthPct,
      height: heightPct,
    };

    console.log('Placement set:', currentPlacement);

    showStatus('📦 Placement set! Hit ENTER to upload.', 'success');
  };
});

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing...');

  initializeFirebase();
});

// 'ENTER' key to process with Canvas after defining bbox placement
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (currentPlacement && pendingImageFile) {
      const bboxImage = document.getElementById('add-image');
      bboxImage.style.display = 'none';
      bbox.style.display = 'none';

      showStatus('🚀 Uploading and processing with Canvas...', 'success');
      processCanvasWithPlacement();
    } else if (!pendingImageFile) {
      showStatus('⚠️ Please upload an image first.', 'error');
    } else if (!currentPlacement) {
      showStatus(
        '⚠️ Please click on the image to define placement first.',
        'error',
      );
    }
  }

  // save current image with 'S' key
  if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    saveCurrentImage();
  }
});

// Function to save current image
function saveCurrentImage() {
  if (currentImgIdx < 0 || currentImgIdx >= currentImages.length) {
    showStatus('⚠️ No image to save.', 'error');
    return;
  }

  const currentImage = currentImages[currentImgIdx];
  const link = document.createElement('a');
  link.href = currentImage.dataURL;
  link.download = `image_${currentImgIdx}_${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showStatus('💾 Image saved to downloads!', 'success');
}

// Create or show floating "Process" button
let processBtn = document.getElementById('processBtn');
if (!processBtn) {
  processBtn = document.createElement('button');
  processBtn.id = 'processBtn';
  processBtn.textContent = 'Process';
  processBtn.style.position = 'absolute';
  processBtn.style.transform = 'translate(-50%, -120%)';
  processBtn.style.padding = '6px 12px';
  processBtn.style.background = 'rgba(0,0,0,0.7)';
  processBtn.style.color = 'white';
  processBtn.style.border = 'none';
  processBtn.style.borderRadius = '8px';
  processBtn.style.cursor = 'pointer';
  processBtn.style.zIndex = 10000;
  bbox.appendChild(processBtn);

  // Trigger Canvas when clicked
  processBtn.addEventListener('click', async () => {
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    await processCanvasWithPlacement();
    processBtn.textContent = 'Done';
  });
} else {
  processBtn.style.display = 'block';
  processBtn.disabled = false;
  processBtn.textContent = 'Process';
}

// Helper
function map(value, inMin, inMax, outMin, outMax) {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

const hoverLabel = document.getElementById('hoverLabel');

// optional
mainImage.addEventListener('mousemove', (e) => {
  const rect = mainImage.getBoundingClientRect();

  // coordinates relative to image
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // percentages relative to displayed image size
  const xPct = (x / rect.width) * 100;
  const yPct = (y / rect.height) * 100;

  hoverLabel.style.left = `${x + 10}px`; // slight offset from cursor
  hoverLabel.style.top = `${y + 10}px`;
  hoverLabel.textContent = `x: ${xPct.toFixed(1)}%, y: ${yPct.toFixed(1)}%`;
  hoverLabel.style.display = 'block';
});

mainImage.addEventListener('mouseleave', () => {
  hoverLabel.style.display = 'none';
});
