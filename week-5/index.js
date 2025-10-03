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
let lightbox = null;
let currentImages = [];

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
  const status = $('status');
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
    return url; // Return original URL if conversion fails
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

    // Enable upload button
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
    initPhotoSwipe();
  } catch (error) {
    console.error('Error loading timeline:', error);
    showStatus('Error loading timeline: ' + error.message, 'error');
  }
}

// Render timeline UI
function renderTimeline() {
  const timeline = $('timeline');
  console.log('Timeline element:', timeline); // Debug log

  if (currentImages.length === 0) {
    console.log('No images, showing upload interface'); // Debug log
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

    // Add upload interface after all images
    const uploadInterface = `
      <div class="upload-next" id="uploadTrigger">
        <input type="file" id="imageInput" accept="image/*" style="display: none;">
        <button class="upload-plus">+</button>
      </div>
    `;

    // Use innerHTML to set all content at once (images + upload interface)
    timeline.innerHTML = timelineImgs + uploadInterface;
  }

  // Re-attach event listeners after DOM update
  attachUploadListeners();
}

// Function to attach upload listeners (since DOM elements are recreated)
function attachUploadListeners() {
  const uploadTrigger = document.getElementById('uploadTrigger');
  const fileInput = document.getElementById('imageInput');

  if (uploadTrigger && fileInput) {
    // Click + button triggers file input
    uploadTrigger.addEventListener('click', (e) => {
      if (!database) {
        showStatus('Firebase not initialized', 'error');
        return;
      }

      fileInput.click();
    });

    // When file is selected, automatically upload
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        // show the image inside the uploadTrigger div with opacity
        const file = e.target.files[0];
        const imgPreview = document.createElement('img');
        imgPreview.src = URL.createObjectURL(file);
        imgPreview.style.width = '100%';
        imgPreview.style.height = '100%';
        imgPreview.style.objectFit = 'contain';
        imgPreview.style.opacity = 0.5;
        imgPreview.style.position = 'absolute';
        imgPreview.style.top = 0;
        imgPreview.style.left = 0;
        imgPreview.style.zIndex = 10;
        uploadTrigger.appendChild(imgPreview);

        // upload to replicate, then firebase
        handleImageUpload();
      }
    });
  } else {
    console.error('Failed to find upload elements:', {
      uploadTrigger,
      fileInput,
    });
  }
}

// Initialize PhotoSwipe for image zoom/navigation
function initPhotoSwipe() {
  if (lightbox) {
    lightbox.destroy();
  }

  if (currentImages.length === 0) return;

  const items = currentImages.map((img) => ({
    src: img.dataURL,
    width: img.width || 2048,
    height: img.height || 2048,
    alt: `Image ${currentImages.indexOf(img) + 1}`,
  }));

  lightbox = new PhotoSwipeLightbox({
    gallery: '#timeline',
    children: '.image-item',
    pswpModule: PhotoSwipe,
    dataSource: items,
  });

  // Navigate to next image when zoomed close
  lightbox.on('afterInit', () => {
    lightbox.pswp.on('zoomPanUpdate', (e) => {
      if (
        lightbox.pswp.currSlide.zoomLevels.initial <
        lightbox.pswp.currSlide.currZoomLevel * 2
      ) {
        // Very zoomed in, advance to next image after short delay
        setTimeout(() => {
          if (lightbox.pswp.currIndex < currentImages.length - 1) {
            lightbox.pswp.next();
          }
        }, 1000);
      }
    });
  });

  lightbox.init();
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
    prompt:
      "insert seamlessly the second image within or inside the first image. you're free to put it anywhere and as part of any object that makes most sense with the environment of the first image.",
    max_images: 4,
    image_input: [lastImageDataURL, newImageDataURL],
    aspect_ratio: '4:3',
    sequential_image_generation: 'auto',
  };

  const result = await callReplicateModel(token, SEEDREAM_MODEL, input);

  // Extract the first generated image URL from the result
  if (
    result.output &&
    Array.isArray(result.output) &&
    result.output.length > 0
  ) {
    return result.output[0];
  }

  throw new Error('No output generated from Seedream-4 model');
}

// Save image data to Firebase Realtime Database
async function saveImageToDatabase(imageData) {
  const imagesRef = ref(database, 'images');
  const newImageRef = push(imagesRef);
  await set(newImageRef, imageData);
  return newImageRef.key;
}

// Main upload handler
async function handleImageUpload() {
  const fileInput = $('imageInput');
  const file = fileInput.files[0];

  if (!file) {
    showStatus('Please select an image first', 'error');
    return;
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    showStatus('Please select a valid image file', 'error');
    return;
  }

  // Validate file size (max 5MB for base64 storage)
  if (file.size > 5 * 1024 * 1024) {
    showStatus('Image too large. Please select an image under 5MB.', 'error');
    return;
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showStatus('Please save your Replicate API token first', 'error');
    return;
  }

  if (!database) {
    showStatus('Firebase not initialized', 'error');
    return;
  }

  try {
    showLoading();
    showStatus('Processing image...', 'success');

    const timestamp = new Date().toISOString();

    // Convert file to base64 data URL
    console.log('Converting image to base64...');
    const originalDataURL = await fileToDataURL(file);
    console.log('Base64 conversion complete');

    let finalDataURL = originalDataURL;
    let isGenerated = false;

    // If this is not the first image, process with Seedream-4
    if (currentImages.length > 0) {
      const lastImage = currentImages[currentImages.length - 1];
      console.log('Processing with Seedream-4...');

      try {
        showStatus('Processing with Seedream-4 model...', 'success');

        // For Seedream, we might need to use the original data URL directly
        // or convert it to a temporary URL that Replicate can access
        const generatedUrl = await processWithSeedream(
          token,
          originalDataURL,
          lastImage.dataURL,
        );

        // Convert the generated URL back to base64 for storage
        console.log('Converting generated image to base64...');
        finalDataURL = await urlToDataURL(generatedUrl);
        isGenerated = true;

        console.log('Generated image converted to base64');
      } catch (error) {
        console.error('Seedream processing error:', error);
        showStatus(
          'Model processing failed, using original image: ' + error.message,
          'error',
        );
      }
    }

    // break workflow if no final data URL of converted image found and the db already have images
    if (!finalDataURL && currentImages.length !== 0) return;

    // Save to database
    const imageData = {
      dataURL: finalDataURL,
      originalDataURL: originalDataURL,
      timestamp: timestamp,
      isGenerated: isGenerated,
      width: 2048,
      height: 2048,
      filename: file.name,
      fileSize: file.size,
    };

    console.log('Saving to database...');
    showStatus('Saving to database...', 'success');

    await saveImageToDatabase(imageData);

    // Add to current images and cache
    const newImage = {
      id: Date.now().toString(),
      ...imageData,
    };
    currentImages.push(newImage);
    imageCache.set(finalDataURL, finalDataURL);

    // Re-render timeline
    renderTimeline();
    initPhotoSwipe();

    // Clear input
    fileInput.value = '';

    hideLoading();
    showStatus(
      `Image ${isGenerated ? 'processed and ' : ''}uploaded successfully!`,
    );
  } catch (error) {
    console.error('Upload error:', error);
    hideLoading();
    showStatus('Upload failed: ' + error.message, 'error');
  }
}

// Timeline cursor effect
document.addEventListener('mousemove', (e) => {
  const body = document.body;
  const x = e.clientX / window.innerWidth;
  const y = e.clientY / window.innerHeight;
  body.style.setProperty('--cursor-x', x);
  body.style.setProperty('--cursor-y', y);

  // Update cursor element position and make it visible
  cursorEl.style.left = `${e.clientX}px`; // Use actual pixel position instead of percentage
  cursorEl.style.top = '0';
  cursorEl.style.opacity = '0.5'; // Make it visible (was set to '0')

  // Optional: Add fade out effect
  clearTimeout(cursorEl.fadeTimeout);
  cursorEl.fadeTimeout = setTimeout(() => {
    cursorEl.style.opacity = '0.2';
  }, 500);
});

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing...');

  // Auto-initialize Firebase
  initializeFirebase();

  // Button handlers for token management only
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

  // Remove the old upload button and file input handlers since they're now in attachUploadListeners()

  // Initial render
  renderTokenStatus();
});
