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
// SIMPLIFIED: Record for 20 seconds, then upload ONE chunk per online period
let mediaRecorder = null;
let currentAudioStream = null; // Store the audio stream for visualization
let chunkIndex = 0;
let currentCallId = null;
let onUploadProgress = null;
let recordingTimeoutId = null; // Timeout ID for 20-second recording limit
let hasUploadedThisSession = false; // Track if we've already uploaded this online session

// Recording duration: 20 seconds per online period
const RECORDING_DURATION_MS = 20000;

export function setUploadProgressCallback(fn) {
  onUploadProgress = fn;
}

/**
 * SIMPLIFIED startRecording:
 * - Records for 20 seconds (one chunk per online period)
 * - Uploads once when recording stops
 * - Calls onUploadProgress with success/failure status
 */
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

  // Check if this is a restart for the same call
  const isRestartForSameCall =
    (currentCallId === callId && currentCallId !== null) ||
    (currentCallId === null && chunkIndex > 0);

  console.log(
    '[startRecording] 🎤 SIMPLIFIED Recording (20s per online period)',
    {
      callId,
      myPhoneNumber,
      isRestartForSameCall,
      currentChunkIndex: chunkIndex,
      hasUploadedThisSession,
      recordingDuration: `${RECORDING_DURATION_MS / 1000}s`,
    },
  );

  // If already recording, skip
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log('[startRecording] Already recording, skipping', {
      callId,
      state: mediaRecorder.state,
    });
    return;
  }

  // Clean up any existing recorder
  if (mediaRecorder) {
    try {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    } catch (e) {
      console.warn('[startRecording] Error stopping existing recorder', e);
    }
    mediaRecorder = null;
  }

  if (currentAudioStream) {
    currentAudioStream.getTracks().forEach((track) => track.stop());
    currentAudioStream = null;
  }

  // Clear any pending timeout
  if (recordingTimeoutId) {
    clearTimeout(recordingTimeoutId);
    recordingTimeoutId = null;
  }

  // Set up call tracking
  const previousCallId = currentCallId;
  currentCallId = callId;

  // Reset chunkIndex only for new calls
  if (!isRestartForSameCall) {
    chunkIndex = 0;
    console.log('[startRecording] New call - resetting chunkIndex to 0');
  } else {
    console.log(
      '[startRecording] Restart - preserving chunkIndex:',
      chunkIndex,
    );
  }

  // Reset session flag for this online period
  hasUploadedThisSession = false;

  console.log('[startRecording] Starting 20-second recording session', {
    callId,
    myPhoneNumber,
    chunkIndex,
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

  // Collect all audio data in this array
  const audioChunks = [];

  // Handle data available - just collect chunks
  mediaRecorder.ondataavailable = (evt) => {
    if (evt.data && evt.data.size > 0) {
      audioChunks.push(evt.data);
      console.log('[startRecording] 📦 Audio data collected', {
        callId,
        chunkSize: evt.data.size,
        totalChunks: audioChunks.length,
      });
    }
  };

  // Handle recording stop - upload the complete audio
  mediaRecorder.onstop = async () => {
    console.log('[startRecording] ⏹️ Recording stopped, preparing upload', {
      callId,
      totalDataChunks: audioChunks.length,
      hasUploadedThisSession,
    });

    // Don't upload if already uploaded this session or no data
    if (hasUploadedThisSession) {
      console.log('[startRecording] Already uploaded this session, skipping');
      return;
    }

    if (audioChunks.length === 0) {
      console.warn('[startRecording] No audio data to upload');
      // Notify UI of failure
      if (onUploadProgress) {
        onUploadProgress({
          callId,
          chunkIndex,
          failed: true,
          error: 'No audio data recorded',
        });
      }
      return;
    }

    // Combine all chunks into one blob
    const mimeTypeToUse = mediaRecorder?.mimeType || 'audio/webm';
    const blob = new Blob(audioChunks, { type: mimeTypeToUse });
    console.log('[startRecording] 🎤 Combined audio blob', {
      callId,
      blobSize: blob.size,
      blobType: blob.type,
      chunkIndex,
    });

    // Create file path
    const paddedChunkNum = String(chunkIndex).padStart(3, '0');
    const path = `call-${callId}/${myPhoneNumber}/${paddedChunkNum}.webm`;

    // Notify UI that upload is starting
    if (onUploadProgress) {
      onUploadProgress({
        callId,
        chunkIndex,
        uploading: true,
        failed: false,
      });
    }

    // Create upload with timeout (15 seconds max)
    const UPLOAD_TIMEOUT_MS = 15000;
    let uploadTimedOut = false;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        uploadTimedOut = true;
        reject(new Error('Upload timed out after 15 seconds'));
      }, UPLOAD_TIMEOUT_MS);
    });

    try {
      console.log('[startRecording] ⬆️ Uploading audio...', {
        callId,
        path,
        blobSize: blob.size,
        timeout: `${UPLOAD_TIMEOUT_MS / 1000}s`,
      });

      // Race between upload and timeout
      const uploadPromise = (async () => {
        const { publicUrl, path: filePath } = await uploadToStorage(
          'call-audio',
          path,
          blob,
        );

        console.log('[startRecording] ✅ Audio uploaded to storage', {
          callId,
          publicUrl,
          filePath,
        });

        // Insert into database
        await insertAudioChunkRow({
          call_id: callId,
          from_number: myPhoneNumber,
          url: publicUrl,
          file_path: filePath,
        });

        return { publicUrl, filePath };
      })();

      const { publicUrl, filePath } = await Promise.race([
        uploadPromise,
        timeoutPromise,
      ]);

      // Mark as uploaded ONLY after successful upload
      hasUploadedThisSession = true;

      console.log('[startRecording] ✅ Audio chunk saved to database', {
        callId,
        chunkIndex,
        publicUrl,
      });

      // Increment chunk index for next session
      chunkIndex += 1;

      // Cache for offline playback
      cacheAudioUrl(publicUrl).catch((err) => {
        console.warn('[startRecording] Cache failed (non-critical)', err);
      });

      // Notify UI of success
      if (onUploadProgress) {
        onUploadProgress({
          callId,
          chunkIndex: chunkIndex - 1, // The chunk we just uploaded
          path,
          publicUrl,
          failed: false,
        });
      }

      console.log('[startRecording] ✅ Upload complete!', {
        callId,
        uploadedChunkIndex: chunkIndex - 1,
      });
    } catch (err) {
      const isTimeout = err?.message?.includes('timed out');
      console.error('[startRecording] ❌ Upload failed', {
        callId,
        chunkIndex,
        error: err,
        errorMessage: err?.message,
        isTimeout,
        uploadTimedOut,
      });

      // DON'T mark as uploaded on failure - allow retry on next online period
      // hasUploadedThisSession stays false

      // Notify UI of failure - chunk will be shown in red
      if (onUploadProgress) {
        onUploadProgress({
          callId,
          chunkIndex,
          path,
          failed: true,
          error: isTimeout
            ? 'Upload timed out - network too slow'
            : err?.message || 'Upload failed',
        });
      }

      // DON'T increment chunk index on failure - retry with same index
      // This way the next online session will try to upload the same chunk number
      console.log('[startRecording] ⚠️ Keeping chunkIndex for retry', {
        callId,
        chunkIndex,
        reason: 'Upload failed, will retry on next online period',
      });
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error('[startRecording] ❌ MediaRecorder error', {
      callId,
      error: event.error,
      errorMessage: event.error?.message,
    });
  };

  // Start recording
  mediaRecorder.start();
  console.log('[startRecording] ▶️ Recording started', {
    callId,
    state: mediaRecorder.state,
    duration: `${RECORDING_DURATION_MS / 1000}s`,
  });

  // Set timeout to stop recording after 20 seconds
  recordingTimeoutId = setTimeout(() => {
    console.log('[startRecording] ⏰ 20 seconds elapsed, stopping recording', {
      callId,
      state: mediaRecorder?.state,
    });

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, RECORDING_DURATION_MS);

  return mediaRecorder;
}

// Old complex data handler code removed - using simplified 20-second recording

export function stopRecording(resetChunkIndex = true) {
  // Clear any pending recording timeout
  if (recordingTimeoutId) {
    clearTimeout(recordingTimeoutId);
    recordingTimeoutId = null;
  }

  console.log('[stopRecording] Stopping recording', {
    callId: currentCallId,
    chunkIndex,
    resetChunkIndex,
    hasMediaRecorder: !!mediaRecorder,
    mediaRecorderState: mediaRecorder?.state,
  });

  if (mediaRecorder) {
    const wasRecording = mediaRecorder.state === 'recording';
    const callId = currentCallId;

    if (wasRecording) {
      console.log('[stopRecording] MediaRecorder was recording, stopping...', {
        callId,
        state: mediaRecorder.state,
      });
      // Stop will trigger onstop which handles the upload
      mediaRecorder.stop();
    } else {
      console.log('[stopRecording] MediaRecorder not recording, cleaning up', {
        callId,
        state: mediaRecorder.state,
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
    hasUploadedThisSession = false;
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

    // Fetch ALL chunks for this call, then filter client-side
    // This is more reliable than server-side filtering and ensures we don't miss any chunks
    const oppositeNorm = normalize(oppositeNumber);

    const { data: allChunks, error } = await supabase
      .from('audio_chunks')
      .select('*')
      .eq('call_id', callId)
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

    // Filter by opposite party's phone number (client-side for reliability)
    const filtered = (allChunks || []).filter((chunk) => {
      const chunkFromNorm = normalize(chunk.from_number || '');
      return chunkFromNorm === oppositeNorm;
    });

    console.log(
      `[fetchAudioChunksFromOppositeParty] Found ${
        filtered.length
      } chunks from opposite party (out of ${
        allChunks?.length || 0
      } total chunks for call)`,
      {
        callId,
        oppositeNumber,
        oppositeNorm,
        allChunksCount: allChunks?.length || 0,
        filteredCount: filtered.length,
        allChunkFromNumbers: allChunks?.map((c) => c.from_number) || [],
        filteredChunkIds: filtered.map((c) => c.id) || [],
      },
    );

    const data = filtered;

    // Log detailed information about fetched chunks
    console.log(
      `[fetchAudioChunksFromOppositeParty] Found ${
        data?.length || 0
      } historical chunks from database`,
      {
        callId,
        oppositeNumber,
        oppositeNorm,
        chunkIds: data?.map((c) => c.id) || [],
        chunkFromNumbers: data?.map((c) => c.from_number) || [],
        chunkCreatedAts: data?.map((c) => c.created_at) || [],
        chunkUrls: data?.map((c) => c.url) || [],
      },
    );

    // Verify all chunks have required fields
    const validChunks = (data || []).filter((chunk) => {
      const isValid = chunk && chunk.id && chunk.url && chunk.from_number;
      if (!isValid) {
        console.warn(
          '[fetchAudioChunksFromOppositeParty] ⚠️ Invalid chunk found, filtering out',
          {
            chunk,
            hasId: !!chunk?.id,
            hasUrl: !!chunk?.url,
            hasFromNumber: !!chunk?.from_number,
          },
        );
      }
      return isValid;
    });

    if (validChunks.length !== (data?.length || 0)) {
      console.warn(
        `[fetchAudioChunksFromOppositeParty] Filtered out ${
          (data?.length || 0) - validChunks.length
        } invalid chunks`,
        {
          callId,
          originalCount: data?.length || 0,
          validCount: validChunks.length,
        },
      );
    }

    return validChunks;
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
