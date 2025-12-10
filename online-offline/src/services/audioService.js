// src/services/audioService.js
import { supabase } from '../supabaseClient.js';

// --- IndexedDB for audio caching ---
const DB_NAME = 'subway-phone-audio-cache';
const STORE_NAME = 'audio-blobs';
const METADATA_STORE = 'audio-metadata';
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[IndexedDB] Failed to open database', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      // @ts-ignore - IndexedDB event target has result property
      const db = event.target.result;

      // Create audio blobs store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }

      // Create metadata store if it doesn't exist
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metaStore = db.createObjectStore(METADATA_STORE, {
          keyPath: 'id',
        });
        metaStore.createIndex('call_id', 'call_id', { unique: false });
      }
    };
  });

  return dbPromise;
}

// Store audio blob in IndexedDB
export async function cacheAudioUrl(url, metadata = null) {
  try {
    // Don't cache blob URLs - they're already local
    if (url.startsWith('blob:')) {
      console.log('[cacheAudioUrl] Skipping blob URL (already local)', {
        url: url.substring(0, 50),
      });
      return;
    }

    const db = await openDB();

    // Fetch the audio and store as blob
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status}`);
    }
    const blob = await response.blob();

    // Store in IndexedDB
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const request = store.put({ url, blob, cachedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Also store metadata if provided
    if (metadata) {
      const metaTx = db.transaction(METADATA_STORE, 'readwrite');
      const metaStore = metaTx.objectStore(METADATA_STORE);
      await new Promise((resolve, reject) => {
        const request = metaStore.put({
          ...metadata,
          url,
          cachedAt: Date.now(),
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    console.log('[cacheAudioUrl] ✅ Cached audio', {
      url: url.substring(0, 50) + '...',
      blobSize: blob.size,
      hasMetadata: !!metadata,
    });
  } catch (err) {
    console.warn('[cacheAudioUrl] Failed to cache audio', {
      url: url.substring(0, 50),
      error: err,
    });
  }
}

// Get cached audio blob URL
export async function getCachedAudioUrl(url) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const result = await new Promise((resolve, reject) => {
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (result && result.blob) {
      const blobUrl = URL.createObjectURL(result.blob);
      console.log('[getCachedAudioUrl] ✅ Retrieved from cache', {
        originalUrl: url.substring(0, 50),
        blobSize: result.blob.size,
      });
      return blobUrl;
    }

    return null;
  } catch (err) {
    console.warn('[getCachedAudioUrl] Failed to get cached audio', err);
    return null;
  }
}

// Get all cached chunks for a call
export async function idbGetChunksForCall(callId) {
  try {
    const db = await openDB();
    const tx = db.transaction(METADATA_STORE, 'readonly');
    const store = tx.objectStore(METADATA_STORE);
    const index = store.index('call_id');

    const results = await new Promise((resolve, reject) => {
      const request = index.getAll(callId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    return results;
  } catch (err) {
    console.warn('[idbGetChunksForCall] Failed', err);
    return [];
  }
}

// Resolve a URL to a playable blob URL (from cache or network)
export async function resolvePlayableUrl(url) {
  if (!url) return null;

  // Already a blob URL - return as is
  if (url.startsWith('blob:')) {
    return url;
  }

  // Try cache first
  const cached = await getCachedAudioUrl(url);
  if (cached) {
    return cached;
  }

  // If online, try to fetch and cache
  if (navigator.onLine) {
    try {
      await cacheAudioUrl(url);
      return await getCachedAudioUrl(url);
    } catch (err) {
      console.warn('[resolvePlayableUrl] Failed to fetch and cache', err);
    }
  }

  // Fallback to original URL (may not work offline)
  return url;
}

// --- Phone number normalization ---
export function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  return String(phoneNumber).replace(/\D/g, '');
}

// --- MediaRecorder wrapper ---
// SIMPLIFIED: Record for 20 seconds, then upload ONE chunk per online period
// Index is based on online session count, not chunk count
let mediaRecorder = null;
let currentAudioStream = null;
let onlineSessionIndex = 0; // Tracks which online session we're in (0, 1, 2, ...)
let currentCallId = null;
let onUploadProgress = null;
let recordingTimeoutId = null;
let hasUploadedThisSession = false; // Prevents multiple uploads per online period
let isCurrentlyRecording = false; // Explicit flag to track recording state

// Recording duration: 20 seconds per online period
const RECORDING_DURATION_MS = 20000;

export function setUploadProgressCallback(fn) {
  onUploadProgress = fn;
}

export function hasUploadedForSession() {
  return hasUploadedThisSession;
}

export function resetUploadSession() {
  hasUploadedThisSession = false;
  console.log('[audioService] Reset upload session flag');
}

// Get current audio stream for visualization
export function getCurrentAudioStream() {
  return currentAudioStream;
}

// Reset for new call
export function resetForNewCall() {
  onlineSessionIndex = 0;
  hasUploadedThisSession = false;
  currentCallId = null;
  isCurrentlyRecording = false;
  console.log('[audioService] Reset for new call');
}

// Called when user goes offline - increment session for next online period
export function markOfflineTransition() {
  if (hasUploadedThisSession) {
    // Successfully uploaded this session, increment for next
    onlineSessionIndex += 1;
    console.log(
      '[audioService] Offline transition - incremented session index',
      {
        newIndex: onlineSessionIndex,
      },
    );
  } else {
    console.log(
      '[audioService] Offline transition - no upload this session, keeping index',
      {
        currentIndex: onlineSessionIndex,
      },
    );
  }
  hasUploadedThisSession = false;
  isCurrentlyRecording = false;
}

/**
 * Start recording for this online session
 * - Records for 20 seconds
 * - Uploads once per online period
 * - Index is based on online session number
 */
export async function startRecording(callId, myPhoneNumber) {
  // Check for secure context
  const isSecureContext =
    window.isSecureContext !== false ||
    (window.location && window.location.protocol === 'https:') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]';

  if (!isSecureContext) {
    throw new Error('MediaRecorder requires HTTPS.');
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    throw new Error('Audio recording not supported in this browser.');
  }

  // CRITICAL: Check if already uploaded this session
  if (hasUploadedThisSession) {
    console.log('[startRecording] ⏭️ Already uploaded this session, skipping', {
      callId,
      onlineSessionIndex,
    });
    return;
  }

  // CRITICAL: Check if already recording
  if (isCurrentlyRecording) {
    console.log('[startRecording] ⏭️ Already recording, skipping', {
      callId,
      onlineSessionIndex,
    });
    return;
  }

  // Check if MediaRecorder is already active
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log(
      '[startRecording] ⏭️ MediaRecorder already recording, skipping',
    );
    return;
  }

  const isNewCall = currentCallId !== callId;
  if (isNewCall) {
    onlineSessionIndex = 0;
    hasUploadedThisSession = false;
    console.log('[startRecording] New call - reset session index to 0');
  }
  currentCallId = callId;

  console.log('[startRecording] 🎤 Starting recording', {
    callId,
    myPhoneNumber,
    onlineSessionIndex,
    hasUploadedThisSession,
  });

  // Clean up existing recorder
  if (mediaRecorder) {
    try {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    } catch (e) {}
    mediaRecorder = null;
  }

  if (currentAudioStream) {
    currentAudioStream.getTracks().forEach((track) => track.stop());
    currentAudioStream = null;
  }

  if (recordingTimeoutId) {
    clearTimeout(recordingTimeoutId);
    recordingTimeoutId = null;
  }

  // Mark as recording
  isCurrentlyRecording = true;

  // Get audio stream
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    isCurrentlyRecording = false;
    throw new Error(`Microphone access denied: ${err.message}`);
  }

  currentAudioStream = stream;

  // Determine mime type
  const mimeType = MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : MediaRecorder.isTypeSupported('audio/mp4')
    ? 'audio/mp4'
    : undefined;

  try {
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    isCurrentlyRecording = false;
    throw new Error(`Failed to create MediaRecorder: ${err.message}`);
  }

  const audioChunks = [];
  const capturedCallId = callId;
  const capturedPhoneNumber = myPhoneNumber;
  const capturedSessionIndex = onlineSessionIndex;

  mediaRecorder.ondataavailable = (evt) => {
    if (evt.data && evt.data.size > 0) {
      audioChunks.push(evt.data);
    }
  };

  mediaRecorder.onstop = async () => {
    isCurrentlyRecording = false;

    // Verify still same call
    if (currentCallId !== capturedCallId) {
      console.warn('[startRecording] Call changed, skipping upload');
      return;
    }

    // Check if already uploaded
    if (hasUploadedThisSession) {
      console.log('[startRecording] Already uploaded this session, skipping');
      return;
    }

    if (audioChunks.length === 0) {
      console.warn('[startRecording] No audio data');
      if (onUploadProgress) {
        onUploadProgress({
          callId: capturedCallId,
          sessionIndex: capturedSessionIndex,
          failed: true,
          error: 'No audio data recorded',
        });
      }
      return;
    }

    const blob = new Blob(audioChunks, {
      type: mediaRecorder?.mimeType || 'audio/webm',
    });

    // File path uses session index (padded)
    const paddedIndex = String(capturedSessionIndex).padStart(3, '0');
    const path = `call-${capturedCallId}/${capturedPhoneNumber}/${paddedIndex}.webm`;

    // Notify upload starting
    if (onUploadProgress) {
      onUploadProgress({
        callId: capturedCallId,
        sessionIndex: capturedSessionIndex,
        uploading: true,
        failed: false,
      });
    }

    try {
      const UPLOAD_TIMEOUT_MS = 15000;

      const uploadPromise = (async () => {
        const { publicUrl, path: filePath } = await uploadToStorage(
          'call-audio',
          path,
          blob,
        );

        await insertAudioChunkRow({
          call_id: capturedCallId,
          from_number: capturedPhoneNumber,
          url: publicUrl,
          file_path: filePath,
          session_index: capturedSessionIndex,
        });

        return { publicUrl, filePath };
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Upload timed out')),
          UPLOAD_TIMEOUT_MS,
        ),
      );

      const { publicUrl } = await Promise.race([uploadPromise, timeoutPromise]);

      // Mark as uploaded ONLY after success
      hasUploadedThisSession = true;

      console.log('[startRecording] ✅ Upload complete', {
        callId: capturedCallId,
        sessionIndex: capturedSessionIndex,
        publicUrl,
      });

      // Cache for offline playback
      cacheAudioUrl(publicUrl).catch(() => {});

      if (onUploadProgress) {
        onUploadProgress({
          callId: capturedCallId,
          sessionIndex: capturedSessionIndex,
          path,
          publicUrl,
          failed: false,
          uploading: false,
        });
      }
    } catch (err) {
      console.error('[startRecording] ❌ Upload failed', {
        callId: capturedCallId,
        sessionIndex: capturedSessionIndex,
        error: err?.message,
      });

      if (onUploadProgress) {
        onUploadProgress({
          callId: capturedCallId,
          sessionIndex: capturedSessionIndex,
          path,
          failed: true,
          uploading: false,
          error: err?.message || 'Upload failed',
        });
      }
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error('[startRecording] MediaRecorder error', event.error);
    isCurrentlyRecording = false;
  };

  // Start recording
  mediaRecorder.start();
  console.log('[startRecording] ▶️ Recording started');

  // Stop after 20 seconds
  recordingTimeoutId = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      console.log('[startRecording] ⏰ 20 seconds elapsed, stopping');
      mediaRecorder.stop();
    }
  }, RECORDING_DURATION_MS);

  return mediaRecorder;
}

export function stopRecording(resetSession = true) {
  if (recordingTimeoutId) {
    clearTimeout(recordingTimeoutId);
    recordingTimeoutId = null;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }

  if (currentAudioStream) {
    currentAudioStream.getTracks().forEach((track) => track.stop());
    currentAudioStream = null;
  }

  mediaRecorder = null;
  isCurrentlyRecording = false;

  if (resetSession) {
    currentCallId = null;
    onlineSessionIndex = 0;
    hasUploadedThisSession = false;
  }

  console.log('[stopRecording] Stopped', { resetSession });
}

// --- Supabase Storage ---
async function uploadToStorage(bucket, path, blob) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { upsert: true });

  if (error) {
    console.error('[uploadToStorage] Error', error);
    throw error;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);

  return { publicUrl, path: data.path };
}

// --- Database operations ---
async function insertAudioChunkRow({
  call_id,
  from_number,
  url,
  file_path,
  session_index = 0,
}) {
  const { data, error } = await supabase.from('audio_chunks').insert({
    call_id,
    from_number,
    url,
    file_path,
    session_index,
  });

  if (error) {
    console.error('[insertAudioChunkRow] Error', error);
    throw error;
  }

  return data;
}

// Fetch audio chunks from opposite party
export async function fetchAudioChunksFromOppositeParty(
  callId,
  myPhoneNumber,
  call,
  useCache = false,
) {
  const normalize = normalizePhoneNumber;
  const myNorm = normalize(myPhoneNumber);

  if (useCache) {
    // Fetch from IndexedDB cache
    const cachedChunks = await idbGetChunksForCall(callId);
    return cachedChunks.filter((c) => normalize(c.from_number) !== myNorm);
  }

  // Fetch from database - get ALL chunks for this call
  const { data, error } = await supabase
    .from('audio_chunks')
    .select('*')
    .eq('call_id', callId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[fetchAudioChunksFromOppositeParty] Error', error);
    return [];
  }

  // Filter to only other party's chunks and validate
  const validChunks = (data || []).filter((chunk) => {
    const chunkFromNorm = normalize(chunk.from_number || '');
    const isOtherParty = chunkFromNorm !== myNorm;
    const hasUrl = !!chunk.url;
    return isOtherParty && hasUrl && chunk.id;
  });

  console.log('[fetchAudioChunksFromOppositeParty] Fetched chunks', {
    callId,
    total: data?.length || 0,
    otherParty: validChunks.length,
  });

  return validChunks;
}

// --- User State Tracking (for DualTimeline) ---
// This logs when users go online/offline for visualization

export async function logUserStateChange(callId, phoneNumber, state, isOnline) {
  try {
    const { error } = await supabase.from('call_state_log').insert({
      call_id: callId,
      phone_number: phoneNumber,
      state, // 'recording' or 'playback'
      is_online: isOnline,
    });

    if (error) {
      // Table might not exist yet - that's okay
      console.warn(
        '[logUserStateChange] Error (table may not exist)',
        error.message,
      );
    } else {
      console.log('[logUserStateChange] Logged state change', {
        callId,
        phoneNumber,
        state,
        isOnline,
      });
    }
  } catch (err) {
    console.warn('[logUserStateChange] Failed', err);
  }
}

export async function fetchStateLogForCall(callId) {
  try {
    const { data, error } = await supabase
      .from('call_state_log')
      .select('*')
      .eq('call_id', callId)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[fetchStateLogForCall] Error', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('[fetchStateLogForCall] Failed', err);
    return [];
  }
}

// Subscribe to state log changes for real-time updates
export function subscribeToStateLog(callId, callback) {
  const channel = supabase
    .channel(`state-log-${callId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'call_state_log',
        filter: `call_id=eq.${callId}`,
      },
      (payload) => {
        console.log('[subscribeToStateLog] New state log entry', payload.new);
        callback(payload.new);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// --- Call management ---
export async function createCall({ from_number, to_number }) {
  const { data, error } = await supabase
    .from('calls')
    .insert({
      from_number,
      to_number,
      status: 'ringing',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function acceptCall(callId) {
  const { error } = await supabase
    .from('calls')
    .update({
      status: 'active',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', callId);

  if (error) throw error;
}

export async function endCall(callId) {
  const { error } = await supabase
    .from('calls')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    })
    .eq('id', callId);

  if (error) throw error;
}

export async function rejectCall(callId) {
  const { error } = await supabase
    .from('calls')
    .update({ status: 'rejected' })
    .eq('id', callId);

  if (error) throw error;
}

export async function fetchCallById(callId) {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('id', callId)
    .single();

  if (error) {
    console.warn('[fetchCallById] Error', error);
    return null;
  }
  return data;
}

export async function fetchPendingRingingCallForNumber(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('to_number', normalized)
    .eq('status', 'ringing')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.warn('[fetchPendingRingingCallForNumber] Error', error);
  }
  return data || null;
}

export async function fetchActiveCallId(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const { data, error } = await supabase
    .from('calls')
    .select('id')
    .eq('status', 'active')
    .or(`from_number.eq.${normalized},to_number.eq.${normalized}`)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.warn('[fetchActiveCallId] Error', error);
  }
  return data?.id || null;
}

// --- User presence ---
export async function registerUser(phoneNumber, username) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        phone_number: normalized,
        username,
        online: true,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'phone_number' },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchUserByPhone(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', normalized)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.warn('[fetchUserByPhone] Error', error);
  }
  return data || null;
}

export async function isUserOnline(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const { data } = await supabase
    .from('users')
    .select('online')
    .eq('phone_number', normalized)
    .single();

  return data?.online === true;
}

// Register user and start listening for calls
export async function ensureRegisteredAndListen(phoneNumber, username) {
  await registerUser(phoneNumber, username);
  startPresenceHeartbeat(phoneNumber, username);
}

// Subscribe to users list changes
let usersSubscription = null;

export function subscribeToUsers(callback) {
  // Initial fetch
  supabase
    .from('users')
    .select('*')
    .then(({ data }) => {
      if (data) callback(data);
    });

  // Subscribe to changes
  usersSubscription = supabase
    .channel('users-sub')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'users',
      },
      async () => {
        const { data } = await supabase.from('users').select('*');
        if (data) callback(data);
      },
    )
    .subscribe();

  return usersSubscription;
}

// Unsubscribe functions
let incomingCallsSubscription = null;

export function unsubscribeIncomingCalls() {
  if (incomingCallsSubscription) {
    supabase.removeChannel(incomingCallsSubscription);
    incomingCallsSubscription = null;
  }
}

export function unsubscribeUsers() {
  if (usersSubscription) {
    supabase.removeChannel(usersSubscription);
    usersSubscription = null;
  }
}

export async function setUserOnline(phoneNumber, username) {
  const normalized = normalizePhoneNumber(phoneNumber);
  await supabase
    .from('users')
    .update({
      online: true,
      username: username || undefined,
      last_seen: new Date().toISOString(),
    })
    .eq('phone_number', normalized);
}

export async function setUserOffline(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  await supabase
    .from('users')
    .update({
      online: false,
      last_seen: new Date().toISOString(),
    })
    .eq('phone_number', normalized);
}

// Presence heartbeat
let heartbeatInterval = null;

export function startPresenceHeartbeat(phoneNumber, username) {
  if (heartbeatInterval) return;

  setUserOnline(phoneNumber, username);

  heartbeatInterval = setInterval(() => {
    setUserOnline(phoneNumber, username);
  }, 30000);
}

export function stopPresenceHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// --- Subscriptions ---
export function listenForIncomingCalls(myPhoneNumber, callback) {
  const normalized = normalizePhoneNumber(myPhoneNumber);

  const channel = supabase
    .channel('incoming-calls')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
      },
      (payload) => {
        const call = payload.new;
        const toNorm = normalizePhoneNumber(call.to_number || '');

        if (toNorm === normalized && call.status === 'ringing') {
          console.log('[listenForIncomingCalls] Incoming call', call);
          callback(call);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function listenForCallUpdates(callId, callback) {
  const channel = supabase
    .channel(`call-${callId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${callId}`,
      },
      (payload) => {
        callback(payload.new);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function listenForUsers(callback) {
  // Initial fetch
  supabase
    .from('users')
    .select('*')
    .then(({ data }) => {
      if (data) callback(data);
    });

  // Subscribe to changes
  const channel = supabase
    .channel('users-presence')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'users',
      },
      async () => {
        const { data } = await supabase.from('users').select('*');
        if (data) callback(data);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function listenForAudio(callId, myPhoneNumber, callback) {
  const myNorm = normalizePhoneNumber(myPhoneNumber);

  const channel = supabase
    .channel(`audio-${callId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'audio_chunks',
        filter: `call_id=eq.${callId}`,
      },
      (payload) => {
        const chunk = payload.new;
        const chunkFromNorm = normalizePhoneNumber(chunk.from_number || '');

        // Only notify for other party's chunks
        if (chunkFromNorm !== myNorm) {
          console.log('[listenForAudio] New chunk from other party', chunk);
          callback(chunk);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function unsubscribeAudio() {
  // This will be handled by the returned cleanup function from listenForAudio
  console.log('[unsubscribeAudio] Called');
}

// --- Helper functions ---
export async function checkIfUserIsInCall(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const { data } = await supabase
    .from('calls')
    .select('id')
    .or(`from_number.eq.${normalized},to_number.eq.${normalized}`)
    .in('status', ['ringing', 'active'])
    .limit(1);

  return data && data.length > 0;
}

export async function getUserCallPartner(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const { data } = await supabase
    .from('calls')
    .select('*')
    .or(`from_number.eq.${normalized},to_number.eq.${normalized}`)
    .in('status', ['ringing', 'active'])
    .limit(1)
    .single();

  if (!data) return null;

  const fromNorm = normalizePhoneNumber(data.from_number);
  const toNorm = normalizePhoneNumber(data.to_number);

  if (fromNorm === normalized) {
    return { phoneNumber: data.to_number, username: data.to_username };
  } else {
    return { phoneNumber: data.from_number, username: data.from_username };
  }
}

export async function refreshUsersList() {
  const { data } = await supabase.from('users').select('*');
  return data || [];
}
