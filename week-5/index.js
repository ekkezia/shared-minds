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
let currentImages = [];
let currentImgIdx = -1;

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
  } catch (error) {
    console.error('Error loading timeline:', error);
    showStatus('Error loading timeline: ' + error.message, 'error');
  }
}

// Render timeline UI
function renderTimeline() {
  const timeline = $('timeline');
  console.log('Timeline element:', timeline); // Debug log

  if (!timeline) return;

  // ✅ Scroll to end after render
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

  // Logic to click the image and open in #viewer
  const imageItems = document.querySelectorAll('.image-item');
  imageItems.forEach((item) => {
    item.addEventListener('click', () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        // use the timeline index
        currentImgIdx = Number(index);
        console.log('🔔 Clicked image index:', currentImgIdx);

        renderImageInViewer(imgData, index);
      }
    });

    // Hover
    item.addEventListener('mouseover', async () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        currentImgIdx = Number(index);
        renderImageInViewer(imgData, index);
      }
    });
  });

  // scroll to the end of timeline div
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

  // display
  imgEl.style.display = 'block';

  // load image
  imgEl.src = imgData.dataURL;

  // update current image index (use timeline index)
  currentImgIdx =
    typeof index !== 'undefined' ? Number(index) : imgData.idx || 0;

  // if placement exists, draw bbox
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

  // reset zoom
  imgEl.style.transform = 'scale(1)';
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
      'Insert seamlessly the first image in the array behind the second image in the array by placing it in a way that is seamless to the environment. The first image in the array should be like a background behind the first image, the second image should be larger and more prominent than the first image. However, the main object or character in the first image should not be obstructed too much by the second image. Try to not leave any room, fill out the whole space! ',
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

// STEP 2: Save image data to Firebase Realtime Database
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

  let finalDataURL;
  let isGenerated;
  let originalDataURL;
  let placement;

  try {
    showLoading();
    showStatus('Processing image...', 'success');

    const timestamp = new Date().toISOString();

    // Convert file to base64 data URL
    console.log('Converting image to base64...');
    originalDataURL = await fileToDataURL(file);
    console.log('Base64 conversion complete');

    finalDataURL = originalDataURL;
    isGenerated = false;

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

        console.log('🌙 [SEEDREAM] Generated image converted to base64!');

        // STEP 3: analyze image difference to find the new object estimated location / bbox
        placement = await analyzeImagePlacement(
          token,
          lastImage.originalDataURL,
          finalDataURL,
        );
        console.log('🎆 Image placement analysis:', placement);

        // STEP 4: put the image on the viewer with bbox
        // if (placement) {
        //   drawBBox(finalDataURL, placement);
        // } else {
        //   console.warn('No placement data received, skipping bbox drawing');
        // }

        // break workflow if no final data URL of converted image found and the db already have images
        if (!finalDataURL && currentImages.length !== 0) return;
      } catch (error) {
        console.error('Seedream processing error:', error);
        showStatus(
          'Model processing failed, using original image: ' + error.message,
          'error',
        );
      }
    }

    // STEP 5: Save to database
    const imageData = {
      idx: currentImages.length === 0 ? 0 : currentImages.length,
      dataURL: finalDataURL,
      originalDataURL: originalDataURL,
      placement: placement || null,
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

    // Clear input
    fileInput.value = '';

    hideLoading();
  } catch (error) {
    console.error('Upload error:', error);
    hideLoading();
    showStatus('Upload failed: ' + error.message, 'error');
  }
}

// STEP 3: analyze image difference to find the new object estimated location / bbox
// Function to analyze image placement using GPT-4V
async function analyzeImagePlacement(
  token,
  beforeImageMainCharDataURL, // the main character of the previous image, for example i just added a cat before the current image (even tho the previous image is a combination of cat and Monalisa)
  afterImageDataURL,
) {
  console.log('🔍 Starting image placement analysis...');

  const prompt = `
      I have 3 images:
    1. The BEFORE object or the first image in the image_input array to be searched that was submitted from wikipedia result prior to the current image generation. 
    2. AFTER or the second image in the image_input array: The result after inserting the new image into the original composite image.

    Please analyze where the object to be searched (which is the third image in the image_input array) is located at within the AFTER image (which is the first image in the image_input array). Return ONLY a JSON object with the bounding box coordinates as percentages (0-100) of the image dimensions:

    {
      "placement": {
        "x": number (left edge as % from left),
        "y": number (top edge as % from top), 
        "width": number (width as % of total width),
        "height": number (height as % of total height),
        "centerX": number (center X as % from left),
        "centerY": number (center Y as % from top),
        "description": "brief description of where it was placed",
        "confidence": number (0-1, how confident you are)
      }
    }
  `;
  try {
    const response = await fetch(REPLICATE_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-5',
        input: {
          prompt: prompt,
          image_input: [beforeImageMainCharDataURL, afterImageDataURL],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI API error:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
      });
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const output = result.output.join('\n');

    // Extract the output text
    let outputText = '';
    if (result.output && Array.isArray(result.output)) {
      outputText = result.output.join('\n');
    } else if (result.output && typeof result.output === 'string') {
      outputText = result.output;
    } else {
      console.error('❌ Unexpected result structure:', result);
      return null;
    }

    console.log('🔍 Raw output text:', outputText);

    // Clean up the spaced-out text by removing extra spaces between characters
    const cleanedText = outputText
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/"\s+"/g, '""') // Fix spaced quotes
      .replace(/:\s+/g, ':') // Remove spaces after colons
      .replace(/,\s+/g, ',') // Remove spaces after commas
      .replace(/{\s+/g, '{') // Remove spaces after opening braces
      .replace(/\s+}/g, '}') // Remove spaces before closing braces
      .replace(/\[\s+/g, '[') // Remove spaces after opening brackets
      .replace(/\s+\]/g, ']') // Remove spaces before closing brackets
      .trim();

    console.log('🧹 Cleaned text:', cleanedText);

    // Try to extract JSON from the cleaned text
    let jsonText = cleanedText;

    // Look for JSON object in the text
    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    console.log('📝 Extracted JSON text:', jsonText);

    // Parse the JSON
    let placementData;
    try {
      placementData = JSON.parse(jsonText);
      console.log('✅ Successfully parsed placement data:', placementData);
    } catch (parseError) {
      console.error('❌ Error parsing JSON:', parseError);
      console.error('Text that failed to parse:', jsonText);

      // Try alternative parsing approach - remove all spaces between characters
      try {
        const alternativeText = outputText.replace(/\s/g, '');
        console.log('🔄 Trying alternative parsing:', alternativeText);
        placementData = JSON.parse(alternativeText);
        console.log('✅ Alternative parsing successful:', placementData);
      } catch (altError) {
        console.error('❌ Alternative parsing also failed:', altError);
        return null;
      }
    }

    // Validate the structure
    if (!placementData || !placementData.placement) {
      console.error('❌ Invalid placement data structure:', placementData);
      return null;
    }

    console.log('🎯 Final placement result:', placementData.placement);

    // update
    return placementData.placement;
  } catch (error) {
    console.error('Error analyzing placement with model:', error);
    return null;
  }
}

// Zoom handling
const img = $('mainImage');
let virtualScroll = 0; // your "scroll position"
let zoomLocked = false; // ✅ new flag to prevent rapid zooms
const timeline = $('timeline');
window.addEventListener(
  'wheel',
  (e) => {
    // ✅ skip zoom handling if the user is scrolling inside the .timeline
    if (timeline && timeline.contains(e.target)) {
      return;
    }

    if (zoomLocked) return; // ✅ skip if we're in cooldown
    if (currentImgIdx < 0 || currentImgIdx >= currentImages.length) return;

    // deltaY tells you the scroll direction and amount
    virtualScroll += e.deltaY;

    // optional: clamp to a min/max
    virtualScroll = Math.max(0, virtualScroll);

    // zoom on image
    if (!currentImages[currentImgIdx].placement) return;

    img.style.transform = `scale(${1 + virtualScroll * 0.001})`;
    img.style.transformOrigin =
      currentImages[currentImgIdx].placement.centerX +
      '% ' +
      currentImages[currentImgIdx].placement.centerY +
      '%';

    // let prevImg;
    // if (!prevImg || prevImg.idx < 0) return;

    if (Math.abs(e.deltaY) > 100) {
      // if user delta scroll reached a certain threshold, move the img src to the prev img
      if (currentImgIdx > 0) currentImgIdx -= 1;

      virtualScroll = 0;
      // move to prev img
      renderImageInViewer(currentImages[currentImgIdx], currentImgIdx);
      // reset scale
      img.style.transform = 'scale(1)';

      // ✅ lock zoom for 500ms
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
