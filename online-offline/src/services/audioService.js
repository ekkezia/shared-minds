// src/services/audioService.js
// Lightweight port of the demo logic: MediaRecorder that emits 5s chunks,
// uploads to Supabase Storage, inserts a row into audio_chunks table,
// caches fetched chunks in IndexedDB and resolves playable blob: URLs.
// Also exposes listeners for incoming calls and audio via Supabase Realtime.

import { supabase } from '../supabaseClient.js';

// --- IndexedDB helpers (small, self-contained) ---
const DB_NAME = 'subway-audio-db';
const STORE = 'chunks';
const METADATA_STORE = 'chunk-metadata'; // Store chunk metadata for offline queries

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2); // Increment version for new store
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metadataStore = db.createObjectStore(METADATA_STORE, {
          keyPath: 'id',
        });
        metadataStore.createIndex('call_id', 'call_id', { unique: false });
        metadataStore.createIndex('from_number', 'from_number', {
          unique: false,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, blob) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(blob, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const r = store.get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// Store chunk metadata in IndexedDB for offline queries
async function idbPutMetadata(chunkMetadata) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(METADATA_STORE, 'readwrite');
    const store = tx.objectStore(METADATA_STORE);
    store.put(chunkMetadata);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

// Get all chunk metadata for a call from IndexedDB
async function idbGetChunksForCall(callId, oppositeNumber) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(METADATA_STORE, 'readonly');
    const store = tx.objectStore(METADATA_STORE);
    const callIndex = store.index('call_id');
    const request = callIndex.getAll(callId);

    request.onsuccess = () => {
      const allChunks = request.result || [];
      // Filter by opposite party's number
      const oppositeChunks = allChunks.filter(
        (chunk) =>
          normalizePhoneNumber(chunk.from_number || '') ===
          normalizePhoneNumber(oppositeNumber || ''),
      );
      // Sort by created_at
      oppositeChunks.sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return aTime - bTime;
      });
      res(oppositeChunks);
    };
    request.onerror = () => rej(request.error);
  });
}

// --- Storage helpers ---
async function uploadToStorage(bucket, path, blob) {
  // Supabase Storage putObject
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  // Get public URL (depending on your bucket policy)
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { publicUrl: data?.publicUrl || null, path };
}

// --- API helpers for DB rows ---
async function insertAudioChunkRow({ call_id, from_number, url, file_path }) {
  const { error } = await supabase
    .from('audio_chunks')
    .insert([{ call_id, from_number, url, file_path }]);
  if (error) throw error;
  return true;
}

async function createCallRecord({
  id,
  from_number,
  to_number,
  status = 'ringing',
  meta = {},
}) {
  const { error } = await supabase
    .from('calls')
    .insert([{ id, from_number, to_number, status, metadata: meta }]);
  if (error) throw error;
  return true;
}

async function updateCallStatus(callId, status) {
  const { error } = await supabase
    .from('calls')
    .update({ status })
    .eq('id', callId);
  if (error) console.warn('updateCallStatus error', error);
}

// --- Caching network URL into IDB and returning blob: URL ---
export async function cacheAudioUrl(networkUrl, chunkMetadata = null) {
  try {
    // if already cached, skip
    const existing = await idbGet(networkUrl);
    if (existing) {
      // Still store metadata if provided (in case it wasn't stored before)
      if (chunkMetadata) {
        idbPutMetadata(chunkMetadata).catch(() => {});
      }
      return true;
    }
    const res = await fetch(networkUrl);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    await idbPut(networkUrl, blob);

    // Store metadata for offline queries
    if (chunkMetadata) {
      await idbPutMetadata(chunkMetadata);
    }

    return true;
  } catch (err) {
    console.warn('cacheAudioUrl error', err);
    return false;
  }
}

export async function resolvePlayableUrl(url) {
  // If already a blob: URL, return as-is
  if (!url) {
    console.warn('[resolvePlayableUrl] No URL provided');
    return null;
  }
  if (url.startsWith('blob:')) {
    console.log('[resolvePlayableUrl] Already a blob URL', { url });
    return url;
  }
  try {
    const cached = await idbGet(url);
    if (cached) {
      const blobUrl = URL.createObjectURL(cached);
      console.log('[resolvePlayableUrl] ✅ Resolved from cache', {
        originalUrl: url,
        blobUrl,
        blobSize: cached.size,
      });
      return blobUrl;
    }
    // If not cached, try to fetch and cache it
    console.log('[resolvePlayableUrl] Not in cache, fetching from network', {
      url,
    });
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error('[resolvePlayableUrl] ❌ Fetch failed', {
          url,
          status: response.status,
          statusText: response.statusText,
        });
        return null;
      }
      const blob = await response.blob();
      if (blob.size === 0) {
        console.error('[resolvePlayableUrl] ❌ Empty blob', { url });
        return null;
      }
      // Cache it for future use
      await idbPut(url, blob);
      const blobUrl = URL.createObjectURL(blob);
      console.log('[resolvePlayableUrl] ✅ Fetched and cached', {
        originalUrl: url,
        blobUrl,
        blobSize: blob.size,
      });
      return blobUrl;
    } catch (fetchErr) {
      console.error('[resolvePlayableUrl] ❌ Fetch error', {
        url,
        error: fetchErr,
      });
      // Fallback to network URL (might work if CORS allows)
      return url;
    }
  } catch (err) {
    console.error('[resolvePlayableUrl] ❌ Error', { url, error: err });
    // Fallback to network URL
    return url;
  }
}

// --- MediaRecorder wrapper ---
let mediaRecorder = null;
let currentAudioStream = null; // Store the audio stream for visualization
let chunkIndex = 0;
let currentCallId = null;
let onUploadProgress = null;
let chunkIntervalId = null; // Interval ID for restarting MediaRecorder
let isStoppingForChunk = false; // Flag to prevent multiple stops
let currentRecorderId = 0; // Track MediaRecorder instances to filter stale events
let isRestarting = false; // Flag to prevent multiple simultaneous restarts
let restartTimeoutId = null; // Timeout ID for scheduled restart
let isProcessingChunk = false; // Flag to prevent processing multiple chunks simultaneously
let lastChunkProcessedTime = 0; // Timestamp of last chunk processing to enforce 5s interval
let processedChunkIds = new Set(); // Track processed chunk IDs to prevent duplicate callbacks
// Lower threshold for mobile devices - they may produce smaller chunks initially
const MIN_CHUNK_SIZE = 256; // Minimum 256 bytes (reduced from 1KB to support mobile)
const MOBILE_MIN_CHUNK_SIZE = 0; // No minimum for mobile - accept ANY chunk with data
const MIN_CHUNK_INTERVAL_MS = 4500; // Minimum 4.5 seconds between chunk processing (slightly less than 5s to account for timing)

export function setUploadProgressCallback(fn) {
  onUploadProgress = fn;
}

export async function startRecording(callId, myPhoneNumber) {
  // Check for secure context (HTTPS required for MediaRecorder, but localhost is also secure)
  const isSecureContext =
    window.isSecureContext !== false ||
    (window.location && window.location.protocol === 'https:') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]';

  if (!isSecureContext) {
    const errorMsg =
      'MediaRecorder requires HTTPS. Please access this app over HTTPS (not HTTP).';
    console.error('[startRecording] ❌ Secure context required', {
      protocol: window.location?.protocol,
      hostname: window.location?.hostname,
      isSecureContext,
    });
    throw new Error(errorMsg);
  }

  if (!navigator.mediaDevices) {
    const errorMsg =
      'navigator.mediaDevices is not available. This browser may not support audio recording.';
    console.error('[startRecording] ❌ mediaDevices not available', {
      userAgent: navigator.userAgent,
    });
    throw new Error(errorMsg);
  }

  if (!window.MediaRecorder) {
    const errorMsg =
      'MediaRecorder API is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.';
    console.error('[startRecording] ❌ MediaRecorder not available', {
      userAgent: navigator.userAgent,
      isSecureContext,
    });
    throw new Error(errorMsg);
  }

  // Check if MediaRecorder is supported for the mime type we need
  const mimeType = MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : MediaRecorder.isTypeSupported('audio/mp4')
    ? 'audio/mp4'
    : null;

  if (!mimeType) {
    console.warn(
      '[startRecording] ⚠️ No supported audio format found, using default',
    );
  }
  // Check if this is a restart for the same call (preserve chunkIndex) or a new call (reset chunkIndex)
  const isRestartForSameCall = currentCallId === callId;

  // If already recording for this call, don't restart
  if (
    isRestartForSameCall &&
    mediaRecorder &&
    mediaRecorder.state === 'recording'
  ) {
    console.log('[startRecording] Already recording for this call, skipping', {
      callId,
      currentState: mediaRecorder.state,
      currentChunkIndex: chunkIndex,
    });
    return;
  }

  // Stop any existing recording first (but preserve chunkIndex if same call)
  // Only stop if MediaRecorder exists and is in a state that needs stopping
  if (mediaRecorder) {
    const needsStopping =
      mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused';
    if (needsStopping) {
      console.log(
        '[startRecording] Stopping existing recording before starting new one',
        {
          callId,
          currentState: mediaRecorder.state,
          isRestartForSameCall,
          currentChunkIndex: chunkIndex,
        },
      );
      try {
        // Pass a flag to stopRecording to preserve chunkIndex if restarting for same call
        stopRecording(!isRestartForSameCall); // true = reset chunkIndex, false = preserve it
      } catch (e) {
        console.warn('[startRecording] Error stopping existing recording', e);
      }
    } else {
      console.log(
        '[startRecording] MediaRecorder exists but in inactive state, cleaning up',
        {
          callId,
          currentState: mediaRecorder.state,
          isRestartForSameCall,
          currentChunkIndex: chunkIndex,
        },
      );
      // Clean up inactive MediaRecorder but preserve chunkIndex if same call
      mediaRecorder = null;
      if (currentAudioStream) {
        currentAudioStream.getTracks().forEach((track) => track.stop());
        currentAudioStream = null;
      }
      // Don't reset chunkIndex or currentCallId if restarting for same call
      if (!isRestartForSameCall) {
        currentCallId = null;
        chunkIndex = 0;
      }
    }
  }

  // Clear any pending restart
  if (restartTimeoutId) {
    clearTimeout(restartTimeoutId);
    restartTimeoutId = null;
  }
  isRestarting = false;

  currentCallId = callId;

  // Only reset chunkIndex if this is a NEW call, not a restart for the same call
  if (!isRestartForSameCall) {
    chunkIndex = 0;
    console.log('[startRecording] New call - resetting chunkIndex to 0', {
      callId,
    });
  } else {
    console.log(
      '[startRecording] Restarting for same call - preserving chunkIndex',
      {
        callId,
        preservedChunkIndex: chunkIndex,
      },
    );
  }

  isProcessingChunk = false; // Reset processing flag
  lastChunkProcessedTime = 0; // Reset timestamp
  processedChunkIds.clear(); // Clear processed chunk IDs for new recording session

  console.log('[startRecording] Starting audio recording', {
    callId,
    myPhoneNumber,
    chunkInterval: '5000ms (5 seconds)',
  });

  // Get audio stream with better error handling for mobile
  let stream;
  try {
    console.log('[startRecording] Requesting microphone access...', {
      callId,
      userAgent: navigator.userAgent,
    });
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[startRecording] ✅ Microphone access granted', {
      callId,
      streamActive: stream.active,
      tracks: stream.getAudioTracks().length,
      trackEnabled: stream.getAudioTracks()[0]?.enabled,
    });
  } catch (err) {
    console.error('[startRecording] ❌ Failed to get microphone access', {
      callId,
      error: err,
      errorName: err.name,
      errorMessage: err.message,
      userAgent: navigator.userAgent,
    });
    throw new Error(
      `Microphone access denied: ${err.message}. Please grant microphone permissions.`,
    );
  }

  currentAudioStream = stream; // Store stream for visualization

  // Create MediaRecorder with supported mime type if available
  const options = mimeType ? { mimeType } : {};
  try {
    mediaRecorder = new MediaRecorder(stream, options);
    console.log('[startRecording] ✅ MediaRecorder created successfully', {
      callId,
      mimeType: mediaRecorder.mimeType || 'default',
      state: mediaRecorder.state,
      userAgent: navigator.userAgent,
    });
  } catch (err) {
    console.error('[startRecording] ❌ Failed to create MediaRecorder', {
      callId,
      error: err,
      errorMessage: err.message,
      options,
      userAgent: navigator.userAgent,
    });
    // Stop the stream if MediaRecorder creation failed
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      `Failed to create MediaRecorder: ${err.message}. Your browser may not support audio recording.`,
    );
  }

  const CHUNK_MS = 5000;
  // Reset flags
  isStoppingForChunk = false;
  if (chunkIntervalId) {
    clearInterval(chunkIntervalId);
    chunkIntervalId = null;
  }

  // Define the data handler function with recorder ID tracking
  const createDataHandler = (recorderId) => {
    return async (evt) => {
      // CRITICAL: Prevent processing multiple chunks simultaneously
      if (isProcessingChunk) {
        console.warn(
          '[startRecording] ⚠️ Already processing a chunk, ignoring this event',
          {
            callId,
            recorderId,
            dataSize: evt.data?.size || 0,
          },
        );
        return; // Ignore if we're already processing a chunk
      }

      // CRITICAL: Enforce minimum interval between chunk processing (5 seconds)
      const now = Date.now();
      const timeSinceLastChunk = now - lastChunkProcessedTime;
      if (
        lastChunkProcessedTime > 0 &&
        timeSinceLastChunk < MIN_CHUNK_INTERVAL_MS
      ) {
        console.warn(
          '[startRecording] ⚠️ Chunk received too soon, ignoring (rate limiting)',
          {
            callId,
            recorderId,
            timeSinceLastChunk: `${timeSinceLastChunk}ms`,
            minInterval: `${MIN_CHUNK_INTERVAL_MS}ms`,
            dataSize: evt.data?.size || 0,
          },
        );
        return; // Ignore chunks that arrive too quickly
      }

      // CRITICAL: Only process data from the current active MediaRecorder
      // This prevents processing stale events from previous MediaRecorder instances
      const isMobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent,
        );

      // On mobile, completely disable recorder ID check - accept ALL chunks with data
      // This is necessary because mobile devices have timing issues with MediaRecorder
      if (!isMobile && recorderId !== currentRecorderId) {
        console.warn(
          '[startRecording] ⚠️ Ignoring data from stale MediaRecorder',
          {
            callId,
            eventRecorderId: recorderId,
            currentRecorderId,
            dataSize: evt.data?.size || 0,
          },
        );
        return; // Ignore data from old MediaRecorder instances (desktop only)
      }

      // Mark that we're processing a chunk
      isProcessingChunk = true;
      lastChunkProcessedTime = now;

      // On mobile, log but accept the chunk regardless of recorder ID
      if (isMobile && recorderId !== currentRecorderId) {
        console.log(
          '[startRecording] 📱 Mobile: Accepting chunk (ID check disabled)',
          {
            callId,
            eventRecorderId: recorderId,
            currentRecorderId,
            dataSize: evt.data?.size || 0,
          },
        );
      }

      // Debug logging for mobile
      if (isMobile) {
        console.log('[startRecording] 📱 Mobile device - processing chunk', {
          callId,
          recorderId,
          currentRecorderId,
          dataSize: evt.data?.size || 0,
          hasData: !!evt.data,
        });
      }

      // Log every dataavailable event for debugging
      console.log('[startRecording] 📦 ondataavailable event', {
        callId,
        chunkIndex,
        recorderId,
        hasData: !!evt.data,
        dataSize: evt.data?.size || 0,
        mediaRecorderState: mediaRecorder?.state,
        userAgent: navigator.userAgent,
      });

      // STRICT VALIDATION: Filter out empty or invalid chunks BEFORE upload
      if (!evt.data) {
        console.warn('[startRecording] ⚠️ No data in event, skipping', {
          callId,
          chunkIndex,
          recorderId,
        });
        isProcessingChunk = false; // Clear flag on early return
        return;
      }

      if (evt.data.size === 0) {
        console.warn(
          '[startRecording] ⚠️ Empty chunk (0 bytes), skipping upload',
          {
            callId,
            chunkIndex,
            recorderId,
            mediaRecorderState: mediaRecorder?.state,
          },
        );
        isProcessingChunk = false; // Clear flag on early return
        return; // Skip empty chunks completely
      }

      // MINIMUM SIZE VALIDATION: Chunks must be at least MIN_CHUNK_SIZE bytes
      // This filters out incomplete or corrupted chunks
      // Note: For mobile, we use NO minimum (0 bytes) to accommodate any valid data
      const minSizeForDevice = isMobile
        ? MOBILE_MIN_CHUNK_SIZE
        : MIN_CHUNK_SIZE;

      if (evt.data.size < minSizeForDevice) {
        console.warn(
          '[startRecording] ⚠️ Chunk too small, likely incomplete or corrupted',
          {
            callId,
            chunkIndex,
            recorderId,
            dataSize: evt.data.size,
            minSize: minSizeForDevice,
            mediaRecorderState: mediaRecorder?.state,
            isMobile,
            userAgent: navigator.userAgent,
          },
        );
        // On mobile, accept ANY chunk with data (even very small ones)
        // Desktop requires minimum size to filter out incomplete chunks
        if (isMobile && evt.data.size > 0) {
          console.log(
            '[startRecording] 📱 Allowing small chunk on mobile (has data)',
            {
              callId,
              chunkIndex,
              dataSize: evt.data.size,
            },
          );
          // Continue processing - don't return
        } else {
          isProcessingChunk = false; // Clear flag on early return
          return; // Skip chunks that are too small (desktop only)
        }
      }

      const blob = evt.data;
      const timestamp = Date.now();
      // Organize audio by participant: call-{callId}/{phoneNumber}/{timestamp}-{chunkIndex}.webm
      const chunkNum = chunkIndex; // Use current index before incrementing
      const path = `call-${callId}/${myPhoneNumber}/${timestamp}-${chunkNum}.webm`;
      // Create a unique chunk ID to prevent duplicate callbacks
      const chunkUploadId = `${callId}-${chunkNum}-${timestamp}`;

      // Check if we've already processed this chunk (prevent duplicate callbacks)
      if (processedChunkIds.has(chunkUploadId)) {
        console.warn(
          '[startRecording] ⚠️ Duplicate chunk upload ID detected, skipping callback',
          {
            callId,
            chunkNum,
            chunkUploadId,
          },
        );
        isProcessingChunk = false; // Clear flag
        return; // Don't process duplicate chunks
      }

      // Mark this chunk as processed
      processedChunkIds.add(chunkUploadId);

      // Increment chunkIndex AFTER we've captured the current value
      chunkIndex += 1;

      console.log('[startRecording] 🎤 Valid audio chunk created', {
        callId,
        chunkNumber: chunkNum,
        recorderId,
        chunkSize: `${(blob.size / 1024).toFixed(2)} KB`,
        chunkSizeBytes: blob.size,
        blobType: blob.type,
        timestamp,
        path,
        mediaRecorderState: mediaRecorder?.state,
        userAgent: navigator.userAgent,
      });

      // Additional validation: Check if blob type is valid
      if (
        !blob.type ||
        (!blob.type.includes('webm') && !blob.type.includes('mp4'))
      ) {
        console.warn('[startRecording] ⚠️ Unexpected blob type', {
          callId,
          chunkNumber: chunkNum,
          recorderId,
          blobType: blob.type,
          blobSize: blob.size,
        });
        // Continue anyway - some browsers might not set type correctly
      }

      try {
        const isMobile =
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent,
          );
        console.log('[startRecording] Uploading chunk to storage...', {
          callId,
          chunkNumber: chunkNum,
          path,
          blobSize: blob.size,
          isMobile,
        });

        const { publicUrl, path: filePath } = await uploadToStorage(
          'call-audio',
          path,
          blob,
        );

        console.log('[startRecording] Chunk uploaded to storage', {
          callId,
          chunkNumber: chunkNum,
          publicUrl,
          filePath,
          blobSize: blob.size,
          isMobile,
        });

        console.log('[startRecording] Inserting chunk into database...', {
          callId,
          chunkNumber: chunkNum,
          from_number: myPhoneNumber,
          isMobile,
        });

        const insertResult = await insertAudioChunkRow({
          call_id: callId,
          from_number: myPhoneNumber,
          url: publicUrl,
          file_path: filePath,
        });

        console.log(
          '[startRecording] ✅ Chunk successfully uploaded and saved',
          {
            callId,
            chunkNumber: chunkNum,
            publicUrl,
            filePath,
            blobSize: blob.size,
            timestamp: new Date().toISOString(),
            isMobile,
            insertResult,
          },
        );

        // attempt caching
        cacheAudioUrl(publicUrl).catch((cacheErr) => {
          console.warn('[startRecording] Cache failed (non-critical)', {
            callId,
            chunkNumber: chunkNum,
            error: cacheErr,
          });
        });

        // Call upload progress callback - CRITICAL for UI feedback
        // Only call once per chunk (prevent duplicates)
        if (onUploadProgress) {
          try {
            console.log(
              '[startRecording] 📞 Calling upload progress callback',
              {
                callId,
                chunkNumber: chunkNum,
                chunkUploadId,
                isMobile,
                timestamp: new Date().toISOString(),
              },
            );
            onUploadProgress({ callId, path, publicUrl });
            console.log(
              '[startRecording] ✅ Upload progress callback called successfully',
              {
                callId,
                chunkNumber: chunkNum,
                chunkUploadId,
                isMobile,
              },
            );
          } catch (callbackErr) {
            console.error(
              '[startRecording] ❌ Upload progress callback error',
              {
                callId,
                chunkNumber: chunkNum,
                chunkUploadId,
                error: callbackErr,
              },
            );
          }
        } else {
          console.warn('[startRecording] ⚠️ No upload progress callback set', {
            callId,
            chunkNumber: chunkNum,
            chunkUploadId,
          });
        }

        // After successfully uploading a chunk, restart the recorder for the next chunk
        // This ensures continuous recording without relying on setInterval
        // Use a small delay to ensure the current chunk is fully processed
        // Only restart if we're still recording for this call and not already restarting
        if (restartTimeoutId) {
          clearTimeout(restartTimeoutId);
        }
        restartTimeoutId = setTimeout(() => {
          restartTimeoutId = null;
          // Clear processing flag before restarting
          isProcessingChunk = false;
          if (
            currentCallId === callId &&
            mediaRecorder?.state === 'recording' &&
            !isStoppingForChunk &&
            !isRestarting
          ) {
            console.log(
              '[startRecording] Triggering restart after chunk upload',
              {
                callId,
                chunkNumber: chunkNum,
                currentState: mediaRecorder.state,
              },
            );
            restartRecording().catch((err) => {
              console.error(
                '[startRecording] Error restarting after chunk upload',
                {
                  callId,
                  chunkNumber: chunkNum,
                  error: err,
                },
              );
              // Clear processing flag on error
              isProcessingChunk = false;
            });
          } else {
            console.log(
              '[startRecording] Skipping restart - conditions not met',
              {
                callId,
                currentCallId,
                recorderState: mediaRecorder?.state,
                isStoppingForChunk,
                isRestarting,
              },
            );
            // Clear processing flag if we're not restarting
            isProcessingChunk = false;
          }
        }, 200); // Small delay to ensure upload completes
      } catch (err) {
        // Clear processing flag on error
        isProcessingChunk = false;
        // CRITICAL: Log upload errors with full details for debugging
        const isMobile =
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent,
          );
        console.error('[startRecording] ❌ Error uploading audio chunk', {
          callId,
          chunkNumber: chunkNum,
          recorderId,
          blobSize: blob.size,
          error: err,
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack,
          isMobile,
          userAgent: navigator.userAgent,
        });

        // Still try to call the callback with error info (for debugging)
        if (onUploadProgress) {
          try {
            onUploadProgress({
              callId,
              path: null,
              publicUrl: null,
              error: err.message,
              failed: true,
            });
          } catch (callbackErr) {
            // Ignore callback errors
          }
        }
        // Don't re-throw - allow other chunks to continue uploading
      }
    };
  };

  // Create handler for the initial MediaRecorder
  currentRecorderId = 0;
  const handleDataAvailable = createDataHandler(currentRecorderId);

  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  console.log('[startRecording] Initial MediaRecorder setup', {
    callId,
    recorderId: currentRecorderId,
    mimeType: mediaRecorder.mimeType,
    state: mediaRecorder.state,
    isMobile,
    userAgent: navigator.userAgent,
  });

  // Attach the handler to MediaRecorder
  mediaRecorder.ondataavailable = handleDataAvailable;

  mediaRecorder.onstart = () => {
    console.log('[startRecording] ✅ MediaRecorder started', {
      callId,
      state: mediaRecorder.state,
      chunkInterval: `${CHUNK_MS}ms`,
      mimeType: mediaRecorder.mimeType,
    });
  };

  mediaRecorder.onerror = (event) => {
    console.error('[startRecording] ❌ MediaRecorder error', {
      callId,
      error: event.error,
      errorMessage: event.error?.message,
      state: mediaRecorder?.state,
    });
  };

  mediaRecorder.onstop = () => {
    console.log('[startRecording] ⏹️ MediaRecorder stopped', {
      callId,
      state: mediaRecorder?.state,
    });
  };

  mediaRecorder.onpause = () => {
    console.log('[startRecording] ⏸️ MediaRecorder paused', {
      callId,
      state: mediaRecorder?.state,
    });
  };

  mediaRecorder.onresume = () => {
    console.log('[startRecording] ▶️ MediaRecorder resumed', {
      callId,
      state: mediaRecorder?.state,
    });
  };

  // CRITICAL FIX: Stop and create a NEW MediaRecorder every CHUNK_MS to create complete, playable webm files
  // When reusing the same MediaRecorder, there can be timing issues with ondataavailable events.
  // By creating a new MediaRecorder for each chunk, we ensure clean state and complete files.

  let stopPromiseResolver = null;
  let stopPromise = null;

  // Set up onstop handler to resolve the promise when recording stops
  const originalOnStop = mediaRecorder.onstop;
  mediaRecorder.onstop = (event) => {
    console.log('[startRecording] ⏹️ MediaRecorder stopped', {
      callId,
      state: mediaRecorder?.state,
    });
    if (originalOnStop) {
      try {
        originalOnStop.call(mediaRecorder, event);
      } catch (e) {
        // Ignore errors from original handler
      }
    }
    if (stopPromiseResolver) {
      stopPromiseResolver(undefined);
      stopPromiseResolver = null;
    }
  };

  // Store mimeType for recovery scenarios
  const savedMimeType = mediaRecorder.mimeType;

  const restartRecording = async () => {
    if (isStoppingForChunk || isRestarting) {
      console.log(
        '[startRecording] Already stopping/restarting, skipping restart',
        {
          isStoppingForChunk,
          isRestarting,
        },
      );
      return;
    }

    isStoppingForChunk = true;
    isRestarting = true;

    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      console.log(
        '[startRecording] Stopping MediaRecorder to create complete chunk',
        {
          callId,
          chunkIndex,
          isMobile,
        },
      );

      try {
        // Create a promise that resolves when MediaRecorder stops
        stopPromise = new Promise((resolve) => {
          stopPromiseResolver = resolve;
        });

        // Request final data before stopping
        mediaRecorder.requestData();
        mediaRecorder.stop();

        // Wait for stop event to ensure all data is available
        await stopPromise;

        // Small delay to ensure cleanup
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Create a NEW MediaRecorder for the next chunk (ensures clean state)
        let streamToUse = currentAudioStream;
        if (!streamToUse || !streamToUse.active) {
          console.warn(
            '[startRecording] Stream inactive, getting new stream...',
          );
          try {
            streamToUse = await navigator.mediaDevices.getUserMedia({
              audio: true,
            });
            currentAudioStream = streamToUse;
          } catch (err) {
            console.error('[startRecording] Failed to get new stream', err);
            isStoppingForChunk = false;
            isRestarting = false;
            return;
          }
        }

        // On mobile, try to reuse the same MediaRecorder instead of creating a new one
        // This avoids timing issues and ID mismatches
        // BUT: MediaRecorder can't be restarted after stop() - we MUST create a new one
        // So we'll always create a new MediaRecorder, but we'll be more lenient with ID checks

        // Create new MediaRecorder with same options (desktop or mobile fallback)
        const options = mediaRecorder.mimeType
          ? { mimeType: mediaRecorder.mimeType }
          : {};
        const oldMimeType = mediaRecorder.mimeType;

        // Increment recorder ID to track new instance
        currentRecorderId += 1;
        console.log('[startRecording] Creating new MediaRecorder instance', {
          callId,
          newRecorderId: currentRecorderId,
          mimeType: oldMimeType,
          isMobile,
          userAgent: navigator.userAgent,
        });

        try {
          mediaRecorder = new MediaRecorder(streamToUse, options);
          console.log('[startRecording] ✅ New MediaRecorder created', {
            callId,
            recorderId: currentRecorderId,
            mimeType: mediaRecorder.mimeType,
            state: mediaRecorder.state,
            userAgent: navigator.userAgent,
          });
        } catch (err) {
          console.error(
            '[startRecording] ❌ Failed to create new MediaRecorder',
            {
              callId,
              recorderId: currentRecorderId,
              error: err,
              errorMessage: err.message,
              userAgent: navigator.userAgent,
            },
          );
          throw err; // Re-throw to trigger recovery
        }

        // Create new handler for this MediaRecorder instance
        const newHandleDataAvailable = createDataHandler(currentRecorderId);

        // Re-attach all handlers
        mediaRecorder.ondataavailable = newHandleDataAvailable;
        mediaRecorder.onstart = () => {
          console.log(
            '[startRecording] ✅ MediaRecorder started (new instance)',
            {
              callId,
              state: mediaRecorder.state,
              mimeType: mediaRecorder.mimeType,
            },
          );
        };
        mediaRecorder.onerror = (event) => {
          console.error('[startRecording] ❌ MediaRecorder error', {
            callId,
            error: event.error,
            errorMessage: event.error?.message,
            state: mediaRecorder?.state,
          });
        };
        mediaRecorder.onstop = () => {
          console.log('[startRecording] ⏹️ MediaRecorder stopped', {
            callId,
            state: mediaRecorder?.state,
          });
          if (stopPromiseResolver) {
            stopPromiseResolver(undefined);
            stopPromiseResolver = null;
          }
        };
        mediaRecorder.onpause = () => {
          console.log('[startRecording] ⏸️ MediaRecorder paused', {
            callId,
            state: mediaRecorder?.state,
          });
        };
        mediaRecorder.onresume = () => {
          console.log('[startRecording] ▶️ MediaRecorder resumed', {
            callId,
            state: mediaRecorder?.state,
          });
        };

        // Start the new recorder with timeslice to get chunks every CHUNK_MS
        // This is critical for mobile - without timeslice, ondataavailable may not fire
        mediaRecorder.start(CHUNK_MS);
        isStoppingForChunk = false;
        isRestarting = false;
        console.log(
          '[startRecording] MediaRecorder restarted (new instance) for next chunk',
          {
            callId,
            chunkIndex,
            state: mediaRecorder.state,
            mimeType: mediaRecorder.mimeType,
            timeslice: CHUNK_MS,
            isMobile,
          },
        );
      } catch (err) {
        console.error('[startRecording] Error during restart cycle', {
          error: err,
          errorMessage: err.message,
          stack: err.stack,
        });
        // Try to recover by getting a new stream
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          currentAudioStream = stream;
          const options = savedMimeType ? { mimeType: savedMimeType } : {};
          mediaRecorder = new MediaRecorder(stream, options);
          mediaRecorder.ondataavailable = handleDataAvailable;
          mediaRecorder.onstart = () => {
            console.log('[startRecording] ✅ MediaRecorder recovered', {
              callId,
              state: mediaRecorder.state,
            });
          };
          mediaRecorder.onerror = (event) => {
            console.error('[startRecording] ❌ MediaRecorder error', {
              callId,
              error: event.error,
            });
          };
          mediaRecorder.onstop = () => {
            console.log('[startRecording] ⏹️ MediaRecorder stopped', {
              callId,
              state: mediaRecorder?.state,
            });
            if (stopPromiseResolver) {
              stopPromiseResolver(undefined);
              stopPromiseResolver = null;
            }
          };
          // Start with timeslice for reliable chunking
          mediaRecorder.start(CHUNK_MS);
          isStoppingForChunk = false;
          isRestarting = false;
          console.log('[startRecording] ✅ MediaRecorder recovered', {
            callId,
            state: mediaRecorder.state,
          });
        } catch (recoveryErr) {
          console.error(
            '[startRecording] Failed to recover MediaRecorder',
            recoveryErr,
          );
          isStoppingForChunk = false;
          isRestarting = false;
        }
      }
    }

    // Fallback: ensure flags are reset even if something went wrong
    isStoppingForChunk = false;
    isRestarting = false;
  };

  // Start first chunk with timeslice to get chunks every CHUNK_MS
  // This is critical for mobile - without timeslice, ondataavailable may not fire
  mediaRecorder.start(CHUNK_MS);
  console.log('[startRecording] MediaRecorder.start() called (first chunk)', {
    callId,
    mimeType: mediaRecorder.mimeType,
    state: mediaRecorder.state,
    timeslice: CHUNK_MS,
    isMobile:
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      ),
  });

  // NOTE: We no longer use setInterval to restart the recorder
  // Instead, restartRecording() is called automatically after each chunk is uploaded
  // This is triggered from the ondataavailable handler after successful upload
  // This avoids race conditions between timeslice events and interval timers

  return mediaRecorder;
}

export function stopRecording(resetChunkIndex = true) {
  // Clear any pending restart
  if (restartTimeoutId) {
    clearTimeout(restartTimeoutId);
    restartTimeoutId = null;
  }
  isRestarting = false;

  // Clear the interval that restarts MediaRecorder
  if (chunkIntervalId) {
    clearInterval(chunkIntervalId);
    chunkIntervalId = null;
    console.log('[stopRecording] Cleared chunk interval');
  }

  if (mediaRecorder) {
    const wasRecording = mediaRecorder.state === 'recording';
    const callId = currentCallId;

    if (wasRecording) {
      console.log('[stopRecording] Stopping audio recording', {
        callId,
        state: mediaRecorder.state,
        totalChunks: chunkIndex,
        resetChunkIndex,
      });
      // Request final chunk before stopping
      try {
        mediaRecorder.requestData();
      } catch (e) {
        console.warn('[stopRecording] Error requesting final data', e);
      }
      mediaRecorder.stop();
    } else {
      console.log('[stopRecording] MediaRecorder not recording, cleaning up', {
        callId,
        state: mediaRecorder.state,
        resetChunkIndex,
      });
    }
  }

  // Stop all tracks in the stream
  if (currentAudioStream) {
    currentAudioStream.getTracks().forEach((track) => track.stop());
    currentAudioStream = null;
  }

  mediaRecorder = null;

  // Only reset chunkIndex and currentCallId if explicitly requested (new call or call ended)
  // If resetChunkIndex is false, we're just pausing (going offline) and will resume later
  if (resetChunkIndex) {
    const preservedCallId = currentCallId;
    currentCallId = null;
    chunkIndex = 0;
    console.log('[stopRecording] Resetting chunkIndex and clearing callId', {
      resetChunkIndex,
      previousCallId: preservedCallId,
    });
  } else {
    // Preserve both chunkIndex and currentCallId for restart
    console.log(
      '[stopRecording] Preserving chunkIndex and callId for restart',
      {
        preservedChunkIndex: chunkIndex,
        preservedCallId: currentCallId,
      },
    );
  }

  isProcessingChunk = false; // Reset processing flag
  lastChunkProcessedTime = 0; // Reset timestamp
  processedChunkIds.clear(); // Clear processed chunk IDs

  console.log('[stopRecording] ✅ Recording stopped and cleaned up', {
    resetChunkIndex,
    chunkIndex,
  });
}

/**
 * getCurrentAudioStream()
 * - Returns the current audio stream for visualization purposes
 */
export function getCurrentAudioStream() {
  return currentAudioStream;
}

// --- Realtime subscriptions ---
// Listen for incoming call invites (calls table) targeted to phoneNumber
// --- Realtime subscriptions ---
// Listen for incoming call invites (calls table) targeted to phoneNumber
/**
 * listenForIncomingCalls(myPhoneNumber, onIncoming)
 * - normalizes phone numbers and avoids subscribing when phone is empty
 * - forwards only rows whose normalized to_number matches the normalized myPhoneNumber
 */
// Listen for incoming call invites (calls table) targeted to phoneNumber
// in src/services/audioService.js
let incomingCallsSubscription = null;

// Shared normalization function to ensure consistency
export function normalizePhoneNumber(s) {
  if (!s) return '';
  const normalized = String(s).replace(/\D/g, '');
  return normalized;
}

export function listenForIncomingCalls(myPhoneNumber, handler) {
  if (!myPhoneNumber) {
    console.warn('listenForIncomingCalls: myPhoneNumber is required');
    return null;
  }

  const channelName = `incoming-calls-${String(myPhoneNumber)}`;
  const myNormalized = normalizePhoneNumber(myPhoneNumber);

  if (!myNormalized || myNormalized.length === 0) {
    console.error(
      'listenForIncomingCalls: Invalid phone number after normalization',
      myPhoneNumber,
    );
    return null;
  }

  console.log('[listenForIncomingCalls] Setting up subscription', {
    myPhoneNumber,
    myNormalized,
    channelName,
  });

  // Clean up any existing subscription first
  if (incomingCallsSubscription) {
    incomingCallsSubscription.unsubscribe().catch(() => {});
    incomingCallsSubscription = null;
  }

  // Try using Supabase filter first, with client-side filtering as backup
  // The filter should reduce server-side events, but we still filter client-side for safety
  incomingCallsSubscription = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        // Use filter with normalized phone number - this should reduce events from server
        filter: `to_number=eq.${myNormalized}`,
      },
      (payload) => {
        const callRow = payload.new;
        if (!callRow) {
          console.debug('[incoming call] No callRow in payload');
          return;
        }

        // CRITICAL: Double-check with client-side filtering (defensive)
        const toNumberRaw =
          callRow.to_number || callRow.to || callRow.toNumber || '';
        const toNumber = normalizePhoneNumber(toNumberRaw);

        // Strict comparison - must match exactly
        if (toNumber !== myNormalized) {
          console.error(
            '[incoming call] ERROR: FILTERED OUT - mismatch detected!',
            {
              myNormalized,
              toNumberRaw,
              toNumber,
              callId: callRow.id,
              fromNumber: callRow.from_number,
              note: 'This should not happen if Supabase filter worked correctly',
            },
          );
          return;
        }

        // Only if we get here, this call is for us
        console.log('[incoming call] MATCHED - processing call for this user', {
          myNormalized,
          toNumber,
          callId: callRow.id,
          fromNumber: callRow.from_number,
        });

        // Pass to handler only if it matches
        handler(callRow, payload);
      },
    )
    .subscribe((status) => {
      console.log('[audioService] incomingCalls subscription status', status, {
        myPhoneNumber,
        myNormalized,
        channelName,
      });
    });

  return incomingCallsSubscription;
}

// allow explicit unsubscribe from outside
export async function unsubscribeIncomingCalls() {
  try {
    if (incomingCallsSubscription) {
      await incomingCallsSubscription.unsubscribe();
      incomingCallsSubscription = null;
    }
  } catch (err) {
    console.warn('unsubscribeIncomingCalls error', err);
  }
}

/**
 * fetchAudioChunksFromOppositeParty(callId, myPhoneNumber, call, useCache = false)
 * - Fetches all historical audio chunks from the opposite party
 * - If useCache is true, fetches from IndexedDB (for offline mode)
 * - Otherwise, fetches from database (for online mode)
 * - Returns chunks ordered by creation time
 */
export async function fetchAudioChunksFromOppositeParty(
  callId,
  myPhoneNumber,
  call,
  useCache = false,
) {
  if (!callId || !myPhoneNumber || !call) return [];

  try {
    // Determine the opposite party's phone number
    const normalize = normalizePhoneNumber;
    const myNorm = normalize(myPhoneNumber);
    const fromNorm = normalize(call.from_number || call.from || '');
    const toNorm = normalize(call.to_number || call.to || '');

    // Find the opposite party's number
    const oppositeNumber =
      fromNorm === myNorm ? call.to_number : call.from_number;

    if (!oppositeNumber) {
      console.warn(
        '[fetchAudioChunksFromOppositeParty] Could not determine opposite party number',
        { call, myPhoneNumber },
      );
      return [];
    }

    console.log('[fetchAudioChunksFromOppositeParty] Fetching chunks', {
      callId,
      myPhoneNumber,
      oppositeNumber,
      useCache,
    });

    // If offline, fetch from IndexedDB cache
    if (useCache) {
      try {
        const cachedChunks = await idbGetChunksForCall(callId, oppositeNumber);
        console.log(
          `[fetchAudioChunksFromOppositeParty] Found ${
            cachedChunks?.length || 0
          } chunks in IndexedDB cache`,
          { callId, oppositeNumber },
        );
        return cachedChunks || [];
      } catch (err) {
        console.warn(
          '[fetchAudioChunksFromOppositeParty] Failed to fetch from cache',
          err,
        );
        return [];
      }
    }

    // Otherwise, fetch from database (online mode)
    if (!supabase) {
      console.warn(
        '[fetchAudioChunksFromOppositeParty] Supabase not available, trying cache',
      );
      return await fetchAudioChunksFromOppositeParty(
        callId,
        myPhoneNumber,
        call,
        true,
      );
    }

    const { data, error } = await supabase
      .from('audio_chunks')
      .select('*')
      .eq('call_id', callId)
      .eq('from_number', oppositeNumber)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[fetchAudioChunksFromOppositeParty] Query error', error);
      // Fallback to cache if database query fails
      return await fetchAudioChunksFromOppositeParty(
        callId,
        myPhoneNumber,
        call,
        true,
      );
    }

    console.log(
      `[fetchAudioChunksFromOppositeParty] Found ${
        data?.length || 0
      } historical chunks from database`,
      { callId, oppositeNumber },
    );

    return data || [];
  } catch (err) {
    console.warn('[fetchAudioChunksFromOppositeParty] Failed', err);
    return [];
  }
}

let audioSubscription = null;
/**
 * listenForAudio(callId, onChunk, options)
 * - Subscribes to new audio chunks for a call
 * - Calls onChunk for each new chunk inserted
 * - options.fetchHistorical: if true, also fetches and calls onChunk for existing chunks
 * - options.oppositePartyNumber: if provided, only processes chunks from this number
 * - options.myPhoneNumber: used to filter out own chunks if oppositePartyNumber not provided
 */
export function listenForAudio(callId, onChunk, options = {}) {
  try {
    if (audioSubscription) {
      audioSubscription.unsubscribe().catch?.(() => {});
      audioSubscription = null;
    }
  } catch (e) {}

  // Fetch historical chunks if requested
  if (options.fetchHistorical && options.call && options.myPhoneNumber) {
    (async () => {
      try {
        const historicalChunks = await fetchAudioChunksFromOppositeParty(
          callId,
          options.myPhoneNumber,
          options.call,
        );

        // Process historical chunks in order
        console.log(
          `[listenForAudio] 📥 Processing ${historicalChunks.length} historical chunks`,
          { callId },
        );
        for (const chunk of historicalChunks) {
          if (!chunk || !chunk.url) {
            console.warn(
              '[listenForAudio] ⚠️ Skipping invalid historical chunk',
              {
                callId,
                chunk,
              },
            );
            continue;
          }
          console.log('[listenForAudio] 📥 Processing historical chunk', {
            callId,
            chunkId: chunk.id,
            from_number: chunk.from_number,
            url: chunk.url,
          });

          // Cache the chunk URL for offline playback (with metadata)
          if (chunk.url && !chunk.url.startsWith('blob:')) {
            cacheAudioUrl(chunk.url, {
              id: chunk.id,
              call_id: chunk.call_id || callId,
              from_number: chunk.from_number,
              url: chunk.url,
              file_path: chunk.file_path,
              created_at: chunk.created_at,
            }).catch((err) => {
              console.warn(
                '[listenForAudio] Failed to cache historical chunk',
                {
                  chunkId: chunk.id,
                  url: chunk.url,
                  error: err,
                },
              );
            });
          }

          const playable = await resolvePlayableUrl(chunk.url);
          if (playable && onChunk) {
            console.log(
              '[listenForAudio] ✅ Calling onChunk for historical chunk',
              {
                callId,
                chunkId: chunk.id,
                playable,
              },
            );
            onChunk({ playable, meta: chunk, isHistorical: true });
          } else {
            console.warn(
              '[listenForAudio] ⚠️ No playable URL for historical chunk',
              {
                callId,
                chunkId: chunk.id,
                url: chunk.url,
                playable,
              },
            );
          }
        }
      } catch (err) {
        console.warn('[listenForAudio] Failed to fetch historical chunks', err);
      }
    })();
  }

  // Subscribe to new chunks
  audioSubscription = supabase
    .channel(`audio-${callId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'audio_chunks',
        filter: `call_id=eq.${callId}`,
      },
      async (payload) => {
        console.log(
          '[listenForAudio] 📨 New audio chunk received via subscription',
          {
            callId,
            chunkId: payload.new?.id,
            from_number: payload.new?.from_number,
            url: payload.new?.url,
          },
        );

        const chunk = payload.new;
        if (!chunk || !chunk.url) {
          console.warn('[listenForAudio] ⚠️ Invalid chunk received', {
            callId,
            chunk,
            hasUrl: !!chunk?.url,
          });
          return;
        }

        // Filter by opposite party if specified
        if (options.oppositePartyNumber) {
          const normalize = normalizePhoneNumber;
          if (
            normalize(chunk.from_number || '') !==
            normalize(options.oppositePartyNumber)
          ) {
            console.log(
              '[listenForAudio] ⏭️ Skipping chunk - not from opposite party',
              {
                callId,
                chunkFrom: chunk.from_number,
                expectedOpposite: options.oppositePartyNumber,
              },
            );
            return; // Skip chunks not from the opposite party
          }
        } else if (options.myPhoneNumber) {
          // Skip our own chunks
          const normalize = normalizePhoneNumber;
          if (
            normalize(chunk.from_number || '') ===
            normalize(options.myPhoneNumber)
          ) {
            console.log(
              '[listenForAudio] ⏭️ Skipping chunk - from own number',
              {
                callId,
                chunkFrom: chunk.from_number,
                myPhoneNumber: options.myPhoneNumber,
              },
            );
            return; // Skip our own chunks
          }
        }

        console.log(
          '[listenForAudio] ✅ Processing chunk from opposite party',
          {
            callId,
            chunkId: chunk.id,
            from_number: chunk.from_number,
            url: chunk.url,
          },
        );

        // Cache the chunk URL for offline playback (with metadata)
        if (chunk.url && !chunk.url.startsWith('blob:')) {
          cacheAudioUrl(chunk.url, {
            id: chunk.id,
            call_id: chunk.call_id || callId,
            from_number: chunk.from_number,
            url: chunk.url,
            file_path: chunk.file_path,
            created_at: chunk.created_at,
          }).catch((err) => {
            console.warn('[listenForAudio] Failed to cache new chunk', {
              chunkId: chunk.id,
              url: chunk.url,
              error: err,
            });
          });
        }

        // try to resolve playable URL (cache-first)
        const playable = await resolvePlayableUrl(chunk.url);
        console.log('[listenForAudio] Resolved playable URL', {
          callId,
          chunkId: chunk.id,
          originalUrl: chunk.url,
          playableUrl: playable,
        });

        if (playable && onChunk) {
          console.log('[listenForAudio] ✅ Calling onChunk for new chunk', {
            callId,
            chunkId: chunk.id,
            playable,
          });
          onChunk({ playable, meta: chunk, isHistorical: false });
        } else {
          console.warn(
            '[listenForAudio] ⚠️ No playable URL or onChunk callback',
            {
              callId,
              chunkId: chunk.id,
              playable,
              hasOnChunk: !!onChunk,
            },
          );
        }
      },
    )
    .subscribe();
  return audioSubscription;
}

export async function unsubscribeAudio() {
  try {
    if (audioSubscription) {
      await audioSubscription.unsubscribe();
      audioSubscription = null;
    }
  } catch (err) {
    console.warn('unsubscribeAudio error', err);
  }
}

// --- Presence upsert ---
// --- Presence upsert & heartbeat helpers ---
let presenceHeartbeatTimer = null;

/**
 * ensureRegisteredAndListen(myPhoneNumber, myUsername)
 * - initial upsert to the users table with online=true and last_seen
 */
export async function ensureRegisteredAndListen(myPhoneNumber, myUsername) {
  if (!myPhoneNumber || !myUsername)
    throw new Error('phone and username required');

  const payload = {
    phone_number: myPhoneNumber,
    username: myUsername,
    online: true,
    last_seen: new Date().toISOString(),
  };

  const { error } = await supabase.from('users').upsert(payload);
  if (error) console.warn('ensureRegisteredAndListen upsert error', error);
  return true;
}

/**
 * startPresenceHeartbeat(myPhoneNumber, myUsername, intervalMs = 30000)
 * - starts a periodic upsert to keep `last_seen` fresh and `online: true`
 */
export function startPresenceHeartbeat(
  myPhoneNumber,
  myUsername,
  intervalMs = 30000,
) {
  if (!myPhoneNumber || !myUsername) return;
  // run immediately once
  (async () => {
    try {
      await supabase.from('users').upsert({
        phone_number: myPhoneNumber,
        username: myUsername,
        online: true,
        last_seen: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('presence heartbeat immediate upsert failed', err);
    }
  })();

  // clear existing timer
  if (presenceHeartbeatTimer) clearInterval(presenceHeartbeatTimer);
  presenceHeartbeatTimer = setInterval(async () => {
    try {
      await supabase.from('users').upsert({
        phone_number: myPhoneNumber,
        username: myUsername,
        online: true,
        last_seen: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('presence heartbeat upsert failed', err);
    }
  }, intervalMs);
}

/**
 * stopPresenceHeartbeat()
 * - clears the client's heartbeat timer (does not change DB state)
 */
export function stopPresenceHeartbeat() {
  if (presenceHeartbeatTimer) {
    clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = null;
  }
}

/**
 * setUserOffline(phoneNumber)
 * - mark the given user row as offline immediately (use on tab hide/unload)
 */
export async function setUserOffline(phoneNumber) {
  if (!phoneNumber) return;
  try {
    const { error } = await supabase
      .from('users')
      .update({ online: false, last_seen: new Date().toISOString() })
      .eq('phone_number', phoneNumber);
    if (error) console.warn('setUserOffline error', error);
  } catch (err) {
    console.warn('setUserOffline failed', err);
  }
}
// helper: check that a phone number exists and is currently marked online
export async function isUserOnline(phoneNumber) {
  if (!supabase || !phoneNumber) return false;
  try {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('phone_number, online')
      .eq('phone_number', phoneNumber)
      .maybeSingle();
    if (error) {
      console.warn('isUserOnline lookup error', error);
      return false;
    }
    return !!(userRow && userRow.phone_number && userRow.online);
  } catch (err) {
    console.warn('isUserOnline failed', err);
    return false;
  }
}

/**
 * createCall({ from_number, to_number })
 * - Inserts a call row and returns the inserted row (with DB-generated id)
 */
export async function createCall({ from_number, to_number }) {
  if (!supabase) throw new Error('supabase not initialized');
  try {
    const payload = {
      from_number,
      to_number,
      status: 'ringing',
      created_at: new Date().toISOString(),
    };

    console.log('[createCall] Inserting call into database', {
      from_number,
      to_number,
      from_normalized: normalizePhoneNumber(from_number),
      to_normalized: normalizePhoneNumber(to_number),
      payload,
    });

    // Insert and return the created row (so the DB-generated id is available)
    const { data, error } = await supabase
      .from('calls')
      .insert([payload])
      .select()
      .single();
    if (error) throw error;

    console.log('[createCall] Call inserted successfully', {
      callId: data?.id,
      insertedData: data,
      from_number: data?.from_number,
      to_number: data?.to_number,
    });

    return data; // the inserted row, contains `id`
  } catch (err) {
    console.error('createCall error', err);
    throw err;
  }
}

// accept a call: mark active and set accepted_at timestamp
export async function acceptCall(callId) {
  try {
    const { error } = await supabase
      .from('calls')
      .update({
        status: 'active', // match demo expected enum
        accepted_at: new Date().toISOString(),
      })
      .eq('id', callId);

    if (error) console.warn('acceptCall update error', error);
  } catch (err) {
    console.warn('acceptCall failed', err);
  }
}

// end a call: mark ended and set ended_at timestamp
export async function endCall(callId) {
  try {
    const { error } = await supabase
      .from('calls')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
      })
      .eq('id', callId);

    if (error) console.warn('endCall update error', error);
  } catch (err) {
    console.warn('endCall failed', err);
  }
}

// --- Users subscription (presence/list) helpers ---
let usersSubscription = null;

/**
 * subscribeToUsers(onUsers)
 * - Fetches the current users list and then subscribes to realtime changes
 * - Calls `onUsers(arrayOfUserRows)` on initial fetch and for every change
 * - Returns the subscription object (from supabase) so caller may inspect if needed
 */
export async function subscribeToUsers(onUsers) {
  if (!supabase) return null;

  // initial fetch
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('username', { ascending: true });
    if (!error && Array.isArray(data)) {
      onUsers && onUsers(data);
    } else if (error) {
      console.warn('subscribeToUsers initial fetch error', error);
    }
  } catch (err) {
    console.warn('subscribeToUsers initial fetch failed', err);
  }

  // cleanup old sub if present
  try {
    if (usersSubscription) {
      await usersSubscription.unsubscribe();
    }
  } catch (e) {}

  // subscribe to all changes on the users table, and refetch on each change
  usersSubscription = supabase
    .channel('public:users')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      // @ts-ignore
      async (payload) => {
        try {
          // refetch full list when a change occurs (simple and robust)
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .order('username', { ascending: true });
          if (!error && Array.isArray(data)) {
            onUsers && onUsers(data);
          }
        } catch (err) {
          console.warn('subscribeToUsers realtime handler failed', err);
        }
      },
    )
    // @ts-ignore
    .subscribe((status) => {
      // optional: status contains listen / confirm messages
      // console.debug('users subscription status', status);
    });

  return usersSubscription;
}

/**
 * unsubscribeUsers()
 * - Unsubscribes the users realtime channel
 */
export async function unsubscribeUsers() {
  try {
    if (usersSubscription) {
      await usersSubscription.unsubscribe();
      usersSubscription = null;
    }
  } catch (err) {
    console.warn('unsubscribeUsers error', err);
  }
}

/**
 * refreshUsersList(onUsers)
 * - Manually fetches the current users list and calls the callback
 * - Useful for refreshing the list when entering a view
 */
export async function refreshUsersList(onUsers) {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('username', { ascending: true });
    if (!error && Array.isArray(data)) {
      onUsers && onUsers(data);
      console.log('[refreshUsersList] Users list refreshed', {
        count: data.length,
      });
    } else if (error) {
      console.warn('refreshUsersList error', error);
    }
  } catch (err) {
    console.warn('refreshUsersList failed', err);
  }
}

/**
 * fetchPendingRingingCallForNumber(phoneNumber)
 * - Returns the latest 'ringing' call row targeted to the given phone number, or null.
 */
export async function fetchPendingRingingCallForNumber(phoneNumber) {
  if (!supabase || !phoneNumber) return null;
  try {
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .eq('to_number', phoneNumber)
      .eq('status', 'ringing')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.warn('fetchPendingRingingCallForNumber error', error);
      return null;
    }
    if (Array.isArray(data) && data.length > 0) return data[0];
    return null;
  } catch (err) {
    console.warn('fetchPendingRingingCallForNumber failed', err);
    return null;
  }
}

/**
 * fetchCallById(callId)
 * - Returns the call row for the given id, or null
 */
export async function fetchCallById(callId) {
  if (!supabase || !callId) return null;
  try {
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .eq('id', callId)
      .maybeSingle();
    if (error) {
      console.warn('fetchCallById error', error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('fetchCallById failed', err);
    return null;
  }
}

/**
 * fetchUserByPhone(phoneNumber)
 * - Returns the user row for the given phone number, or null
 */
export async function fetchUserByPhone(phoneNumber) {
  if (!supabase || !phoneNumber) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone_number', phoneNumber)
      .maybeSingle();
    if (error) {
      console.warn('fetchUserByPhone error', error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('fetchUserByPhone failed', err);
    return null;
  }
}

/**
 * checkIfUserIsInCall(phoneNumber)
 * - Returns true if the user has an active or ringing call, false otherwise
 */
export async function checkIfUserIsInCall(phoneNumber) {
  if (!supabase || !phoneNumber) return false;
  try {
    const { data, error } = await supabase
      .from('calls')
      .select('id, status')
      .or(`from_number.eq.${phoneNumber},to_number.eq.${phoneNumber}`)
      .in('status', ['ringing', 'active'])
      .limit(1);
    if (error) {
      console.warn('checkIfUserIsInCall error', error);
      return false;
    }
    return !!(data && data.length > 0);
  } catch (err) {
    console.warn('checkIfUserIsInCall failed', err);
    return false;
  }
}

/**
 * fetchActiveCallId(phoneNumber)
 * - Returns the ID of an active call for the given phone number, or null if none exists
 */
export async function fetchActiveCallId(phoneNumber) {
  if (!supabase || !phoneNumber) return null;
  try {
    const { data, error } = await supabase
      .from('calls')
      .select('id')
      .or(`from_number.eq.${phoneNumber},to_number.eq.${phoneNumber}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('fetchActiveCallId error', error);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.warn('fetchActiveCallId failed', err);
    return null;
  }
}

/**
 * getUserCallPartner(phoneNumber)
 * - Returns call details including the partner's phone number and username if available
 * - Returns null if user is not in a call
 */
export async function getUserCallPartner(phoneNumber) {
  if (!supabase || !phoneNumber) return null;
  try {
    const { data, error } = await supabase
      .from('calls')
      .select('id, status, from_number, to_number')
      .or(`from_number.eq.${phoneNumber},to_number.eq.${phoneNumber}`)
      .in('status', ['ringing', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('getUserCallPartner error', error);
      return null;
    }

    if (!data || data.length === 0) return null;

    const call = data[0];
    const userNorm = normalizePhoneNumber(phoneNumber);
    const fromNorm = normalizePhoneNumber(call.from_number);
    const toNorm = normalizePhoneNumber(call.to_number);

    // Determine the partner's phone number
    const partnerNumber =
      fromNorm === userNorm ? call.to_number : call.from_number;

    // Try to get the partner's username
    let partnerUsername = null;
    try {
      const partnerUser = await fetchUserByPhone(partnerNumber);
      partnerUsername = partnerUser?.username || null;
    } catch (e) {
      // Ignore errors fetching username
    }

    return {
      phoneNumber: partnerNumber,
      username: partnerUsername,
      callStatus: call.status,
    };
  } catch (err) {
    console.warn('getUserCallPartner failed', err);
    return null;
  }
}
