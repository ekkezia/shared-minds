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
const TOKEN_KEY = 'replicateApiToken';
const REPLICATE_PROXY =
  'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
const SEEDREAM_MODEL = 'bytedance/seedream-4';

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

function maskToken(token) {
  if (!token) return '(none)';
  if (token.length <= 8) return '*'.repeat(token.length);
  return token.slice(0, 4) + '...' + token.slice(-4);
}

function renderTokenStatus() {
  const token = localStorage.getItem(TOKEN_KEY);
  const el = $('tokenStatus');
  if (el)
    el.textContent = token ? `Saved: ${maskToken(token)}` : 'No token saved';
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

// Convert image URL to base64 (for external URLs from Replicate)
async function urlToDataURL(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting URL to data URL:', error);
    return url;
  }
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
      const imageRef = ref(database, `images/${img.id}`);
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

// ✅ NEW: Process with Seedream after bbox is defined
async function processSeedreamWithPlacement() {
  if (!pendingImageFile || !currentPlacement || !pendingOriginalDataURL) {
    console.error('Missing required data for processing');
    return;
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showStatus('Please save your Replicate API token first', 'error');
    return;
  }

  try {
    showLoading();
    showStatus('Processing with Seedream-4...', 'success');

    const lastImage = currentImages[currentImages.length - 1];

    // Process with Seedream
    const generatedUrl = await processWithSeedream(
      token,
      pendingOriginalDataURL,
      lastImage.dataURL,
    );

    console.log('Converting generated image to base64...');
    const finalDataURL = await urlToDataURL(generatedUrl);

    console.log('🌙 [SEEDREAM] Generated image converted to base64!');

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
    console.error('Seedream processing error:', error);
    hideLoading();
    showStatus('Processing failed: ' + error.message, 'error');

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
      bbox.style.display = 'block';

      const file = e.target.files[0];
      if (!file) return;

      // Convert file to data URL
      const newImageDataURL = await fileToDataURL(file);

      // const imgEl = $('mainImage');
      const imgEl = $('add-image');
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

      // Store pending file + data URL for Seedream processing
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

// Call Replicate model
async function callReplicateModel(token, modelVersion, inputObj) {
  const response = await fetch(REPLICATE_PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      version: modelVersion,
      input: inputObj,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model call failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

// Process image with Seedream-4
async function processWithSeedream(token, newImageDataURL, lastImageDataURL) {
  console.log('Image URLs for Seedream:', {
    newImageDataURL,
    lastImageDataURL,
  });

  const input = {
    size: '2K',
    width: 2048,
    height: 2048,
    prompt: `Insert first image into second image at ${currentPlacement.x.toFixed(
      2,
    )}%, ${currentPlacement.y.toFixed(
      2,
    )}%, size ${currentPlacement.width.toFixed(
      2,
    )}% × ${currentPlacement.height.toFixed(
      2,
    )}%. No modifications to either image.`,

    max_images: 2,
    image_input: [lastImageDataURL, newImageDataURL],
    aspect_ratio: '4:3',
    sequential_image_generation: 'auto',
  };

  const result = await callReplicateModel(token, SEEDREAM_MODEL, input);

  if (
    result.output &&
    Array.isArray(result.output) &&
    result.output.length > 0
  ) {
    return result.output[0];
  }

  throw new Error('No output generated from Seedream-4 model');
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

    img.style.transform = `scale(${1 + virtualScroll * 0.001})`;
    img.style.transformOrigin =
      currentImages[currentImgIdx].placement.centerX +
      '% ' +
      currentImages[currentImgIdx].placement.centerY +
      '%';

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

  const saveTokenBtn = $('saveToken');
  if (saveTokenBtn) {
    saveTokenBtn.addEventListener('click', () => {
      const tokenInput = $('replicateToken');
      if (!tokenInput) return;

      const token = tokenInput.value.trim();
      if (!token) {
        showStatus('Please enter a token', 'error');
        return;
      }

      localStorage.setItem(TOKEN_KEY, token);
      renderTokenStatus();
      showStatus('Token saved successfully!');
    });
  }

  const clearTokenBtn = $('clearToken');
  if (clearTokenBtn) {
    clearTokenBtn.addEventListener('click', () => {
      localStorage.removeItem(TOKEN_KEY);
      const tokenInput = $('replicateToken');
      if (tokenInput) tokenInput.value = '';
      renderTokenStatus();
      showStatus('Token cleared');
    });
  }

  renderTokenStatus();
});

// 'ENTER' key to process with Seedream after defining bbox placement
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    bbox.style.display = 'none';
    console.log(
      'ENTER pressed, processing with Seedream...',
      bbox.style.display,
    );

    if (currentPlacement && pendingImageFile) {
      showStatus('🚀 Uploading and processing with Seedream...', 'success');
      processSeedreamWithPlacement();
    } else if (!pendingImageFile) {
      showStatus('⚠️ Please upload an image first.', 'error');
    } else if (!currentPlacement) {
      showStatus(
        '⚠️ Please click on the image to define placement first.',
        'error',
      );
    }
  }
});

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

  // Trigger Seedream when clicked
  processBtn.addEventListener('click', async () => {
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    await processSeedreamWithPlacement();
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
