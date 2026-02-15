import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  remove,
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

// Debug: show placement bbox overlay on the main viewer (toggleable)
let DEBUG_SHOW_BBOX = false;
const debugPlacementEl = document.createElement('div');
Object.assign(debugPlacementEl.style, {
  position: 'fixed',
  border: '2px dashed rgba(255,0,0,0.9)',
  pointerEvents: 'none',
  display: 'none',
  zIndex: 10002,
  boxSizing: 'border-box',
});
document.body.appendChild(debugPlacementEl);

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
    const imagesRef = ref(database, 'images-lite');
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
      <div class="image-item" data-index="${index}" data-id="${img.id}">
        <button class="delete-btn" data-id="${img.id}" title="Delete image">×</button>
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
  attachDeleteListeners();

  const imageItems = document.querySelectorAll('.image-item');
  imageItems.forEach((item) => {
    item.addEventListener('click', () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        currentImgIdx = Number(index);
        // reset zoom when changing image
        lastScale = 1;
        virtualScroll = 0;
        console.log('Clicked', { index, imgData });
        renderImageInViewer(imgData, currentImgIdx);
      }
    });

    // use `mouseenter` so it doesn't bubble or accidentally fire after a click
    item.addEventListener('mouseenter', () => {
      const index = Number(item.getAttribute('data-index'));
      if (Number.isFinite(index) && index !== currentImgIdx) {
        const imgData = currentImages[index];
        if (imgData) {
          currentImgIdx = index;
          // reset zoom when changing image
          lastScale = 1;
          virtualScroll = 0;
          renderImageInViewer(imgData, currentImgIdx);
        }
      }
    });
  });

  requestAnimationFrame(() => {
    timeline.scrollLeft = timeline.scrollWidth;
  });
}

// Delete image from Firebase
async function deleteImage(imageId) {
  if (!database) {
    showStatus('Database not initialized', 'error');
    return;
  }

  const imageIndex = currentImages.findIndex(img => img.id === imageId);
  if (imageIndex === -1) return;

  const subsequentCount = currentImages.length - imageIndex - 1;
  let deleteSubsequent = true;
  
  // Show custom dialog with options
  if (subsequentCount > 0) {
    const message = `⚠️  WARNING: CASCADING DELETE\n\n` +
      `This image has ${subsequentCount} image(s) after it.\n` +
      `Deleting this image will BREAK the picture-in-picture effect for subsequent images.\n\n` +
      `Choose an option:\n` +
      `1 = Delete ONLY this image (may break subsequent images)\n` +
      `2 = Delete this image AND all ${subsequentCount} subsequent image(s) [RECOMMENDED]\n\n` +
      `Enter 1 or 2:`;
    
    const choice = prompt(message, '2');
    
    if (choice === null) return; // User cancelled
    
    if (choice === '1') {
      deleteSubsequent = false;
      // Double confirm for risky option
      const confirmRisky = confirm(
        `⚠️  CONFIRM RISKY ACTION\n\n` +
        `You chose to delete ONLY this image.\n` +
        `This will likely BREAK ${subsequentCount} subsequent image(s).\n\n` +
        `Are you absolutely sure?`
      );
      if (!confirmRisky) return;
    } else if (choice === '2') {
      deleteSubsequent = true;
      // Confirm cascade delete
      const confirmCascade = confirm(
        `Confirm: Delete this image and all ${subsequentCount} subsequent image(s)?`
      );
      if (!confirmCascade) return;
    } else {
      showStatus('Invalid choice. Deletion cancelled.', 'error');
      return;
    }
  } else {
    // Last image, simple confirm
    if (!confirm('Delete this image?')) return;
  }

  try {
    showLoading();
    
    // Get images to delete
    const imagesToDelete = deleteSubsequent 
      ? currentImages.slice(imageIndex)
      : [currentImages[imageIndex]];
    
    // Delete from Firebase
    for (const img of imagesToDelete) {
      const imageRef = ref(database, `images-lite/${img.id}`);
      await remove(imageRef);
    }
    
    // Remove from local array
    currentImages = currentImages.filter(img => 
      !imagesToDelete.some(delImg => delImg.id === img.id)
    );
    
    // If deleted image was being viewed, clear viewer or show previous
    if (currentImages.length > 0) {
      currentImgIdx = Math.min(imageIndex, currentImages.length - 1);
      if (currentImgIdx >= 0) {
        renderImageInViewer(currentImages[currentImgIdx], currentImgIdx);
      }
    } else {
      const imgEl = $('mainImage');
      if (imgEl) imgEl.style.display = 'none';
      currentImgIdx = -1;
    }
    
    renderTimeline();
    const deletedCount = imagesToDelete.length;
    showStatus(`${deletedCount} image${deletedCount > 1 ? 's' : ''} deleted successfully`, 'success');
  } catch (error) {
    console.error('Error deleting image:', error);
    showStatus('Error deleting image: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

// Attach delete button listeners
function attachDeleteListeners() {
  const deleteButtons = document.querySelectorAll('.delete-btn');
  deleteButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering image view
      const imageId = btn.getAttribute('data-id');
      if (imageId) {
        deleteImage(imageId);
      }
    });
    
    // Add hover effect to show which images will be deleted
    btn.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      const imageId = btn.getAttribute('data-id');
      const imageIndex = currentImages.findIndex(img => img.id === imageId);
      
      // Dim all subsequent images
      const allItems = document.querySelectorAll('.image-item');
      allItems.forEach((item, idx) => {
        if (idx >= imageIndex) {
          item.style.opacity = '0.5';
          item.style.filter = 'grayscale(0.5)';
        }
      });
    });
    
    btn.addEventListener('mouseleave', (e) => {
      // Reset all images
      const allItems = document.querySelectorAll('.image-item');
      allItems.forEach((item) => {
        item.style.opacity = '1';
        item.style.filter = 'none';
      });
    });
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
  imgEl.style.objectFit = 'contain';
  imgEl.src = imgData.dataURL;
  

  const newIndex = typeof index !== 'undefined' ? Number(index) : imgData.idx || 0;
  // If the image index changed, reset zoom progress so zoom feels consistent per image
  if (newIndex !== currentImgIdx) {
    resetZoomProgress();
  }

  currentImgIdx = newIndex;
  // apply the current scale (may be reset above)
  imgEl.style.transform = `scale(${lastScale})`;

  if (bboxEl && imgData.placement) {
    const p = imgData.placement;
    // translate stored percentages into pixel values relative to displayed image
    const rect = imgEl.getBoundingClientRect();
    const leftPx = (p.x / 100) * rect.width;
    const topPx = (p.y / 100) * rect.height;
    const widthPx = (p.width / 100) * rect.width;
    const heightPx = (p.height / 100) * rect.height;

    bboxEl.style.display = 'block';
    bboxEl.style.left = `${leftPx}px`;
    bboxEl.style.top = `${topPx}px`;
    bboxEl.style.width = `${widthPx}px`;
    bboxEl.style.height = `${heightPx}px`;
    bboxEl.style.position = 'absolute';

    // recreate handles so they attach to the current bbox
    createResizeHandles();
  } else if (bboxEl) {
    bboxEl.style.display = 'none';
    clearResizeHandles();
  }

  // Ensure debug overlay updates whenever the viewer renders an image
  updateDebugPlacementOverlay();
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

    // reset zoom when showing newly generated image
    lastScale = 1;
    virtualScroll = 0;
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

    // reset zoom when showing first uploaded image
    lastScale = 1;
    virtualScroll = 0;
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

          // Draw overlay image at specified position using "cover" behavior
          // Compute source rect from overlay image so it fills destination while preserving aspect ratio
          const overlayAR = overlayImg.width / overlayImg.height;
          const destAR = w / h;
          let sx = 0;
          let sy = 0;
          let sw = overlayImg.width;
          let sh = overlayImg.height;

          if (overlayAR > destAR) {
            // overlay is wider; use full height, crop width
            sh = overlayImg.height;
            sw = Math.floor(sh * destAR);
            sx = Math.floor((overlayImg.width - sw) / 2);
            sy = 0;
          } else {
            // overlay is taller; use full width, crop height
            sw = overlayImg.width;
            sh = Math.floor(sw / destAR);
            sx = 0;
            sy = Math.floor((overlayImg.height - sh) / 2);
          }

          ctx.drawImage(overlayImg, sx, sy, sw, sh, x, y, w, h);

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

// Estimate bytes from a data URL (base64). Returns integer bytes.
function dataURLtoBytes(dataURL) {
  try {
    const base64 = dataURL.split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  } catch (e) {
    return dataURL.length;
  }
}

// Downsize a dataURL by scaling and JPEG compression until it fits under maxBytes.
// Returns the downsized dataURL (may be JPEG). If cannot reach target, returns the smallest produced.
async function downsizeDataURL(dataURL, maxBytes) {
  const img = await loadImage(dataURL);
  const originalBytes = dataURLtoBytes(dataURL);
  if (originalBytes <= maxBytes) return dataURL;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const ow = img.width;
  const oh = img.height;

  let best = dataURL;
  let bestSize = originalBytes;

  // Try progressively smaller scales and JPEG qualities
  for (let scale = 1.0; scale >= 0.2; scale -= 0.1) {
    canvas.width = Math.max(1, Math.floor(ow * scale));
    canvas.height = Math.max(1, Math.floor(oh * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (let q = 0.92; q >= 0.4; q -= 0.12) {
      const candidate = canvas.toDataURL('image/jpeg', q);
      const size = dataURLtoBytes(candidate);
      if (size <= maxBytes) return candidate;
      if (size < bestSize) {
        best = candidate;
        bestSize = size;
      }
    }
  }

  // If we couldn't reach the target, return the smallest candidate we produced.
  return best;
}

// Save image data to Firebase
async function saveImageToDatabase(imageData) {
  // Always attempt to save to Realtime Database. If the dataURL is too large,
  // downsize the image (scale + JPEG compression) until it fits under the threshold.
  const MAX_DB_BYTES = 1_000_000; // ~1MB conservative threshold (adjustable)

  if (!database) {
    throw new Error('Database not initialized');
  }

  let dataToStore = imageData.dataURL;
  const initialBytes = dataURLtoBytes(dataToStore);
  if (initialBytes > MAX_DB_BYTES) {
    console.warn(`Image too large for DB (${initialBytes} bytes). Downsizing...`);
    showStatus('Downsizing image to fit database limits...', 'success');
    try {
      const downsized = await downsizeDataURL(dataToStore, MAX_DB_BYTES);
      const downsizedBytes = dataURLtoBytes(downsized);
      console.log(`Downsized image: ${downsizedBytes} bytes`);
      dataToStore = downsized;
      // annotate metadata so callers know we changed the encoding/size
      imageData.wasDownsized = true;
      imageData.originalSizeBytes = initialBytes;
      imageData.downsizedSizeBytes = downsizedBytes;
    } catch (err) {
      console.warn('Downsizing failed, continuing with original image:', err);
    }
  }

  // Replace dataURL with the (possibly downsized) data and write to DB
  const dbImageData = { ...imageData, dataURL: dataToStore };
  const imagesRef = ref(database, 'images-lite');
  const newImageRef = push(imagesRef);
  await set(newImageRef, dbImageData);
  return newImageRef.key;
}

// Zoom handling
const img = $('mainImage');
let virtualScroll = 0;
let zoomLocked = false;
const timeline = $('timeline');
let lastScale = 1; // remember current image scale
let virtualScrollResetTimeout = null;

function resetZoomProgress() {
  lastScale = 1;
  virtualScroll = 0;
  if (img) {
    img.style.transform = `scale(${lastScale})`;
    img.style.transformOrigin = `50% 50%`;
  }
  // update debug overlay when zoom reset
  updateDebugPlacementOverlay();
}

// Update the debug overlay to show the current image's placement bbox
function updateDebugPlacementOverlay() {
  if (!DEBUG_SHOW_BBOX) {
    debugPlacementEl.style.display = 'none';
    return;
  }

  if (!img || currentImgIdx < 0 || currentImgIdx >= currentImages.length) {
    debugPlacementEl.style.display = 'none';
    return;
  }

  const cur = currentImages[currentImgIdx];
  const p = cur && cur.placement ? cur.placement : currentPlacement;
  if (!p) {
    debugPlacementEl.style.display = 'none';
    return;
  }

  const rect = img.getBoundingClientRect();
  const left = rect.left + (p.x / 100) * rect.width;
  const top = rect.top + (p.y / 100) * rect.height;
  const width = (p.width / 100) * rect.width;
  const height = (p.height / 100) * rect.height;
  console.log(`Updating debug overlay: left=${left}, top=${top}, width=${width}, height=${height}`, p);

  Object.assign(debugPlacementEl.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    display: 'block',
  });
}

window.addEventListener(
  'wheel',
  (e) => {
    // ignore wheel events originating from the timeline UI
    if (timeline && timeline.contains(e.target)) return;

    if (zoomLocked) return;
    if (currentImgIdx < 0 || currentImgIdx >= currentImages.length) return;

    const current = currentImages[currentImgIdx];
    if (!current || !current.placement) return;

    // We will use the placement proportions to compute a target scale
    // such that the bbox (the smaller picture) fills the viewer. Scrolling
    // interpolates lastScale from 1 -> targetScale; when close to target,
    // we navigate into the nested image.
    e.preventDefault();

    const p = current.placement;
    const rect = img.getBoundingClientRect();
    const centerX = p.x + p.width / 2;
    const centerY = p.y + p.height / 2;

    const bboxWidthPx = (p.width / 100) * rect.width;
    const bboxHeightPx = (p.height / 100) * rect.height;

    // Target scale so the bbox fills the viewer in either dimension.
    const targetScaleX = rect.width / Math.max(1, bboxWidthPx);
    const targetScaleY = rect.height / Math.max(1, bboxHeightPx);
    // choose the smaller of the two (so the bbox fully fits) and clamp
    const targetScale = Math.min(Math.max(1, Math.min(targetScaleX, targetScaleY)), 8);

    // Sensitivity: how much a single wheel delta moves the scale relative to remaining distance
    const SENSITIVITY = 0.003; // tuneable
    const remaining = targetScale - 1;
    const scaleDelta = -e.deltaY * SENSITIVITY * Math.max(0.0001, remaining);

    lastScale = Math.max(1, Math.min(targetScale, lastScale + scaleDelta));
    img.style.transformOrigin = `${centerX}% ${centerY}%`;
    img.style.transform = `scale(${lastScale})`;

    // update debug overlay to match current scale/placement
    updateDebugPlacementOverlay();

    // progress [0..1] where 1 means the bbox has been zoomed to fill the viewer
    const progress = remaining > 0 ? (lastScale - 1) / remaining : 1;

    // When user has scrolled enough (progress nearly 1), navigate according
    // to the scroll direction: scrolling UP (e.deltaY < 0) should go to the
    // previous image (the nested/smaller one). Scrolling DOWN should go to
    // the next image.
    if (progress >= 0.95) {
      if (e.deltaY < 0) {
        // zooming in -> go to previous image
        if (currentImgIdx > 0) {
          currentImgIdx -= 1;
          resetZoomProgress();
          renderImageInViewer(currentImages[currentImgIdx], currentImgIdx);
          zoomLocked = true;
          setTimeout(() => {
            zoomLocked = false;
          }, 500);
        }
      } else {
        // zooming out -> go to next image (if any)
        if (currentImgIdx < currentImages.length - 1) {
          currentImgIdx += 1;
          resetZoomProgress();
          renderImageInViewer(currentImages[currentImgIdx], currentImgIdx);
          zoomLocked = true;
          setTimeout(() => {
            zoomLocked = false;
          }, 500);
        }
      }
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
let pendingOverlayAspect = null;
// bboxPreviewImg removed; using background-image on bbox for cropping

function clearResizeHandles() {
  const existing = bbox.querySelectorAll('.resize-handle');
  existing.forEach((el) => el.remove());
}

function createResizeHandles() {
  clearResizeHandles();

  // left/right handles for horizontal crop; top/bottom handles for vertical crop
  const handles = [
    { name: 'r', cursor: 'ew-resize' },
    { name: 'l', cursor: 'ew-resize' },
    { name: 't', cursor: 'ns-resize' },
    { name: 'b', cursor: 'ns-resize' },
  ];

  handles.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'resize-handle ' + h.name;
    el.dataset.handle = h.name;
    // style depending on handle position
    if (h.name === 'l' || h.name === 'r') {
      Object.assign(el.style, {
        position: 'absolute',
        background: 'rgba(0,0,0,0.4)',
        width: '8px',
        height: '100%',
        right: h.name === 'l' ? 'auto' : '0px',
        left: h.name === 'l' ? '-4px' : 'auto',
        top: '0px',
        cursor: h.cursor,
        zIndex: 10001,
        boxSizing: 'border-box',
      });
    } else if (h.name === 't' || h.name === 'b') {
      Object.assign(el.style, {
        position: 'absolute',
        background: 'rgba(0,0,0,0.35)',
        height: '8px',
        width: '100%',
        left: '0px',
        top: h.name === 't' ? '-4px' : 'auto',
        bottom: h.name === 'b' ? '-4px' : 'auto',
        cursor: h.cursor,
        zIndex: 10001,
        boxSizing: 'border-box',
      });
    }

    bbox.appendChild(el);
  });

  attachHandleListeners();
  // allow grab cursor to indicate move is available
  bbox.style.cursor = 'grab';

  // attach move handler so users can reposition the bbox by dragging
  attachBBoxMoveHandler();
}

function attachHandleListeners() {
  let dragging = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWidth = 0;
  let startHeight = 0;
  const imgRect = mainImage.getBoundingClientRect();

  const onMove = (e) => {
    if (!dragging) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    const dx = clientX - startX;
    const dy = clientY - startY;

    if (dragging === 'r') {
      // right edge: horizontal crop
      let newW = Math.max(20, startWidth + dx);
      newW = Math.min(newW, imgRect.width - startLeft);
      bbox.style.width = `${newW}px`;
    } else if (dragging === 'l') {
      // left edge: move left edge to crop horizontally
      let newLeft = startLeft + dx;
      let newW = startWidth - dx;
      // clamp horizontally
      if (newLeft < 0) {
        newLeft = 0;
        newW = startLeft + startWidth;
      }
      if (newW < 20) {
        newW = 20;
        newLeft = startLeft + (startWidth - newW);
      }
      bbox.style.left = `${newLeft}px`;
      bbox.style.width = `${newW}px`;
    } else if (dragging === 'b') {
      // bottom edge: adjust height
      let newH = Math.max(20, startHeight + dy);
      newH = Math.min(newH, imgRect.height - startTop);
      bbox.style.height = `${newH}px`;
    } else if (dragging === 't') {
      // top edge: move top and reduce/increase height
      let newTop = startTop + dy;
      let newH = startHeight - dy;
      if (newTop < 0) {
        newTop = 0;
        newH = startTop + startHeight;
      }
      if (newH < 20) {
        newH = 20;
        newTop = startTop + (startHeight - newH);
      }
      bbox.style.top = `${newTop}px`;
      bbox.style.height = `${newH}px`;
    }

    // update currentPlacement in percentages relative to mainImage rect
    const rect = mainImage.getBoundingClientRect();
    const leftPx = parseFloat(bbox.style.left) || 0;
    const topPx = parseFloat(bbox.style.top) || 0;
    const widthPx = parseFloat(bbox.style.width) || 0;
    const heightPx = parseFloat(bbox.style.height) || 0;

    currentPlacement = {
      x: (leftPx / rect.width) * 100,
      y: (topPx / rect.height) * 100,
      width: (widthPx / rect.width) * 100,
      height: (heightPx / rect.height) * 100,
    };
    // update debug overlay immediately when resizing placement
    updateDebugPlacementOverlay();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    showStatus('Placement updated', 'success');
  };

  bbox.querySelectorAll('.resize-handle').forEach((h) => {
    h.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      dragging = h.dataset.handle;
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = parseFloat(bbox.style.left) || 0;
      startTop = parseFloat(bbox.style.top) || 0;
      startWidth = parseFloat(bbox.style.width) || bbox.getBoundingClientRect().width;
      startHeight = parseFloat(bbox.style.height) || bbox.getBoundingClientRect().height;

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// Attach move handler to the bbox (drag to reposition). Resize handles stopPropagation
function attachBBoxMoveHandler() {
  let moving = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMove = (e) => {
    if (!moving) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    const dx = clientX - startX;
    const dy = clientY - startY;

    const imgRect = mainImage.getBoundingClientRect();
    const bboxRect = bbox.getBoundingClientRect();

    let newLeft = startLeft + dx;
    let newTop = startTop + dy;

    // clamp within image
    newLeft = Math.max(0, Math.min(newLeft, imgRect.width - bboxRect.width));
    newTop = Math.max(0, Math.min(newTop, imgRect.height - bboxRect.height));

    bbox.style.left = `${newLeft}px`;
    bbox.style.top = `${newTop}px`;

    // update placement percent relative to displayed image
    currentPlacement = {
      x: (newLeft / imgRect.width) * 100,
      y: (newTop / imgRect.height) * 100,
      width: (bboxRect.width / imgRect.width) * 100,
      height: (bboxRect.height / imgRect.height) * 100,
    };
    // update debug overlay while moving
    updateDebugPlacementOverlay();
  };

  const onUp = () => {
    if (!moving) return;
    moving = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    bbox.style.cursor = 'grab';
    showStatus('Placement moved', 'success');
  };

  bbox.addEventListener('mousedown', (ev) => {
    // ignore clicks originating from handles (they stopPropagation already) or process button
    if (ev.target && ev.target.classList && ev.target.classList.contains('resize-handle')) return;
    ev.stopPropagation();
    const imgRect = mainImage.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startLeft = parseFloat(bbox.style.left) || 0;
    startTop = parseFloat(bbox.style.top) || 0;
    moving = true;
    bbox.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// bbox drag (move) disabled for now

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

    pendingOverlayAspect = ASPECT_RATIO;

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
    bbox.style.overflow = 'hidden';
    // use CSS background image with cover to crop reliably
    bbox.style.backgroundImage = `url(${previousImgURL})`;
    bbox.style.backgroundSize = 'cover';
    bbox.style.backgroundPosition = 'center';
    bbox.style.backgroundRepeat = 'no-repeat';
    bbox.style.border = '2px dashed #00bcd4';
    bbox.style.zIndex = 9999;
    bbox.style.boxSizing = 'border-box';

    // add resize handles for scaling / cropping
    createResizeHandles();

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

  // Remove preview and prompt upload with Backspace or Delete
  if (e.key === 'Backspace' || e.key === 'Delete') {
    // only intercept if a preview exists or a pending image was uploaded
    const addImgEl = document.getElementById('add-image');
    if (pendingImageFile || (addImgEl && addImgEl.style.display === 'block')) {
      e.preventDefault();
      // remove preview
      if (addImgEl) {
        addImgEl.src = '';
        addImgEl.style.display = 'none';
      }
      pendingImageFile = null;
      pendingOriginalDataURL = null;
      currentPlacement = null;
      // remove bbox preview and handles
      // clear any background preview
      bbox.style.backgroundImage = 'none';
      clearResizeHandles();
      bbox.style.display = 'none';
      showStatus('Preview removed — please upload a replacement', 'success');
      // open file picker to replace
      if (fileInput) fileInput.click();
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

// Click on the main viewer image to incrementally zoom in toward the placement
if (img) {
  img.addEventListener('click', (e) => {
    if (zoomLocked) return;
    if (currentImgIdx < 0 || currentImgIdx >= currentImages.length) return;

    const current = currentImages[currentImgIdx];
    const p = current && current.placement ? current.placement : currentPlacement;
    if (!p) return;

    const rect = img.getBoundingClientRect();
    const bboxWidthPx = (p.width / 100) * rect.width;
    const bboxHeightPx = (p.height / 100) * rect.height;
    const targetScaleX = rect.width / Math.max(1, bboxWidthPx);
    const targetScaleY = rect.height / Math.max(1, bboxHeightPx);
    const targetScale = Math.min(Math.max(1, Math.min(targetScaleX, targetScaleY)), 8);

    const remaining = targetScale - 1;
    if (remaining <= 0) return;

    // step toward the target so repeated clicks accumulate
    const step = Math.max(0.15, remaining * 0.3);
    lastScale = Math.max(1, Math.min(targetScale, lastScale + step));

    const centerX = p.x + p.width / 2;
    const centerY = p.y + p.height / 2;
    img.style.transformOrigin = `${centerX}% ${centerY}%`;
    img.style.transform = `scale(${lastScale})`;

    // keep the debug overlay in sync
    updateDebugPlacementOverlay();
  });
}
