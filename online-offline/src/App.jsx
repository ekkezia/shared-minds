// src/App.jsx
import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import PhoneContainer from './components/PhoneContainer.jsx';
import StatusBar from './components/StatusBar.jsx';
import SetupView from './views/SetupView.jsx';
import DialerView from './views/DialerView.jsx';
import IncomingCallView from './views/IncomingCallView.jsx';
import CallingView from './views/CallingView.jsx';
import CallConnectedView from './views/CallConnectedView.jsx';
import DualTimeline from './components/DualTimeline.jsx';
import EndCallView from './views/EndCallView.jsx';

import {
  ensureRegisteredAndListen,
  listenForIncomingCalls,
  listenForAudio,
  startRecording,
  stopRecording,
  createCall,
  acceptCall,
  endCall,
  isUserOnline,
  cacheAudioUrl,
  resolvePlayableUrl,
  subscribeToUsers,
  unsubscribeIncomingCalls,
  unsubscribeAudio,
  unsubscribeUsers,
  fetchPendingRingingCallForNumber,
  stopPresenceHeartbeat,
  setUserOffline,
  startPresenceHeartbeat,
  fetchCallById,
  fetchUserByPhone,
  normalizePhoneNumber,
  checkIfUserIsInCall,
  getCurrentAudioStream,
  getUserCallPartner,
  refreshUsersList,
  fetchActiveCallId,
  fetchAudioChunksFromOppositeParty,
  setUploadProgressCallback,
} from './services/audioService.js';
import useOnlineStatus from './hooks/useOnlineStatus.js';

// uid helper
const uid = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  // Use shared normalization function for consistency
  const normalizeNumber = normalizePhoneNumber;

  // Detect and log page reloads (for debugging mobile connectivity issues)
  useEffect(() => {
    // Check if this is a page reload (not initial load)
    const navEntry = performance.getEntriesByType('navigation')[0];
    // @ts-ignore - PerformanceNavigationTiming has 'type' property
    const navType = navEntry && 'type' in navEntry ? navEntry.type : null;
    const isReload =
      (performance.navigation && performance.navigation.type === 1) || // TYPE_RELOAD (legacy API)
      navType === 'reload';

    if (isReload) {
      console.warn(
        '[App] ⚠️ Page was reloaded - this may be due to mobile browser behavior on connectivity change',
      );
      console.log('[App] Navigation type:', {
        performanceNavType: performance.navigation?.type,
        navigationEntryType: navType,
        timestamp: new Date().toISOString(),
      });
    }
  }, []);

  // Restore view from sessionStorage on mount (for mobile page reloads)
  const restoreView = () => {
    try {
      const saved = sessionStorage.getItem('savedView');
      const savedCall = sessionStorage.getItem('currentCall');
      if (saved && savedCall) {
        const parsedCall = JSON.parse(savedCall);
        const status = String(parsedCall.status || '').toLowerCase();
        // Only restore view if call is still active or ringing
        if (status === 'active' || status === 'ringing') {
          console.log('[App] 🔄 Restoring view from sessionStorage', {
            view: saved,
            callId: parsedCall.id,
            status: parsedCall.status,
          });
          return saved;
        } else {
          sessionStorage.removeItem('savedView');
        }
      }
    } catch (e) {
      console.warn('[App] Failed to restore view from sessionStorage', e);
      sessionStorage.removeItem('savedView');
    }
    return 'setup';
  };

  const [view, setViewState] = useState(restoreView); // setup|dialer|incoming|calling|connected|end
  const viewRef = useRef(view); // Keep a ref to current view for callbacks

  // Wrapper to update both state and ref, and persist to sessionStorage
  const setView = (newView) => {
    console.log('[setView] Changing view', {
      from: viewRef.current,
      to: newView,
    });
    viewRef.current = newView;
    setViewState(newView);

    // Persist view to sessionStorage if we have an active call
    // Do this synchronously to ensure it's saved before any potential reload
    if (currentCall && currentCall.id) {
      const status = String(currentCall.status || '').toLowerCase();
      if (status === 'active' || status === 'ringing') {
        try {
          sessionStorage.setItem('savedView', newView);
          // Also ensure currentCall is saved (in case it wasn't saved yet)
          sessionStorage.setItem('currentCall', JSON.stringify(currentCall));
        } catch (e) {
          console.warn('[App] Failed to save view to sessionStorage', e);
        }
      }
    } else if (newView === 'setup' || newView === 'dialer') {
      // Clear saved view when going to setup/dialer without a call
      sessionStorage.removeItem('savedView');
    }
  };

  const [myUsername, setMyUsername] = useState(
    sessionStorage.getItem('myUsername') || '',
  );
  const [myPhoneNumber, setMyPhoneNumber] = useState(
    sessionStorage.getItem('myPhoneNumber') || '',
  );
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [usersInCall, setUsersInCall] = useState(new Set()); // Track phone numbers of users in active calls
  const [userCallPartners, setUserCallPartners] = useState(new Map()); // Map of phone number -> call partner info

  // Restore currentCall from sessionStorage on mount (for mobile page reloads)
  const restoreCurrentCall = () => {
    try {
      const saved = sessionStorage.getItem('currentCall');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Only restore if call is still active or ringing (not ended/rejected)
        const status = String(parsed.status || '').toLowerCase();
        if (status === 'active' || status === 'ringing') {
          console.log('[App] 🔄 Restoring call state from sessionStorage', {
            callId: parsed.id,
            status: parsed.status,
          });
          return parsed;
        } else {
          // Clear stale ended/rejected calls
          sessionStorage.removeItem('currentCall');
          sessionStorage.removeItem('savedView');
        }
      }
    } catch (e) {
      console.warn('[App] Failed to restore call from sessionStorage', e);
      sessionStorage.removeItem('currentCall');
      sessionStorage.removeItem('savedView');
    }
    return null;
  };

  const [currentCall, setCurrentCallState] = useState(restoreCurrentCall);

  // Wrapper to persist currentCall to sessionStorage
  const setCurrentCall = (call) => {
    setCurrentCallState(call);
    if (call && call.id) {
      // Only persist active or ringing calls
      const status = String(call.status || '').toLowerCase();
      if (status === 'active' || status === 'ringing') {
        try {
          sessionStorage.setItem('currentCall', JSON.stringify(call));
          console.log('[App] 💾 Saved call state to sessionStorage', {
            callId: call.id,
            status: call.status,
          });
        } catch (e) {
          console.warn('[App] Failed to save call to sessionStorage', e);
        }
      } else {
        // Clear ended/rejected calls
        sessionStorage.removeItem('currentCall');
        sessionStorage.removeItem('savedView');
      }
    } else {
      // Clear when call is null
      sessionStorage.removeItem('currentCall');
      sessionStorage.removeItem('savedView');
    }
  };
  const [uploadedChunksCount, setUploadedChunksCount] = useState(0); // Track number of chunks uploaded
  const [uploadStatus, setUploadStatus] = useState(null); // { success: boolean, error?: string }
  const [incomingCallPayload, setIncomingCallPayload] = useState(null);
  const audioPlayerRef = useRef(null);
  const playedChunkIdsRef = useRef(new Set());
  const playbackQueueRef = useRef([]);
  const lastCreatedCallIdRef = useRef(null);
  const callEndedByPresenceRef = useRef(null);

  // State for visual timeline
  const [playbackChunks, setPlaybackChunks] = useState([]); // Array of chunks to display
  const [currentPlayingChunkId, setCurrentPlayingChunkId] = useState(null); // ID of chunk currently playing
  const [currentChunkProgress, setCurrentChunkProgress] = useState(0); // 0-1 progress within current chunk
  const [isPlaying, setIsPlaying] = useState(false); // Play/pause state
  const [playbackController, setPlaybackController] = useState(null); // Controller to pause/resume/seek
  const currentAudioRef = useRef(null); // Reference to current audio element
  const playbackAbortRef = useRef(false); // Flag to abort playback
  const isPlayingRef = useRef(false); // Ref to track playing state for closures
  const lastOfflineTimestampRef = useRef(null); // Track when we last went offline (to find first chunk of current online session)
  const firstChunkOfCurrentSessionRef = useRef(null); // Track the first chunk ID of the current online session

  // Track state history for dual timeline visualization
  const myStateHistoryRef = useRef([]); // Array of {timestamp, state: 'recording'|'playback', isOnline}
  const otherStateHistoryRef = useRef([]); // Array of {timestamp, state: 'recording'|'playback'}

  const isOnline = useOnlineStatus();

  // Helper function to process users list (extracted for reuse)
  // Using useCallback to memoize and ensure it has access to current myPhoneNumber
  const processUsersList = useCallback(
    async (users) => {
      const online = (users || []).filter((u) => u?.online);
      const filtered = online.filter((u) => u.phone_number !== myPhoneNumber);
      setOnlineUsers(filtered);

      // Check which users are currently in calls (ringing or active) and who they're calling
      if (filtered.length > 0) {
        const inCallSet = new Set();
        const partnersMap = new Map();

        await Promise.all(
          filtered.map(async (user) => {
            const callPartner = await getUserCallPartner(user.phone_number);
            if (callPartner) {
              inCallSet.add(user.phone_number);
              partnersMap.set(user.phone_number, callPartner);
            }
          }),
        );

        setUsersInCall(inCallSet);
        setUserCallPartners(partnersMap);
      } else {
        setUsersInCall(new Set());
        setUserCallPartners(new Map());
      }

      // If there's a current call that is still ringing, ensure the remote party is still online.
      // If the remote party went offline before anyone accepted, end the call for everyone.
      try {
        if (
          currentCall &&
          String(currentCall.status || '').toLowerCase() === 'ringing' &&
          currentCall.id &&
          !callEndedByPresenceRef.current // only once per call
        ) {
          const normalize = (s) => String(s || '').replace(/\D/g, '');
          const myNorm = normalize(myPhoneNumber);
          const fromNorm = normalize(
            currentCall.from_number || currentCall.from || '',
          );
          const toNorm = normalize(
            currentCall.to_number || currentCall.to || '',
          );

          // find the remote number (the other participant)
          const remoteNorm =
            fromNorm && fromNorm !== myNorm
              ? fromNorm
              : toNorm && toNorm !== myNorm
              ? toNorm
              : null;

          if (remoteNorm) {
            // locate the user row for remote participant (if present in the latest users list)
            const remoteRow = (users || []).find(
              (u) => normalize(u?.phone_number) === remoteNorm,
            );
            const remoteOnline = !!(remoteRow && remoteRow.online);

            // If remote is not online anymore, end the call in DB and locally.
            if (!remoteOnline) {
              console.debug(
                'Remote participant offline while ringing — ending call',
                {
                  callId: currentCall.id,
                  remote: remoteNorm,
                },
              );
              // update DB (best-effort; other clients will see the row update)
              endCall(currentCall.id).catch((e) => {
                console.warn('endCall (presence auto-end) failed', e);
              });
              // record that we ended it so we don't attempt again repeatedly
              callEndedByPresenceRef.current = currentCall.id;
              // local state -> ended
              setCurrentCall((prev) => ({
                ...(prev || {}),
                status: 'ended',
              }));
              setView('end');
            }
          }
        }
      } catch (err) {
        console.warn('presence-driven auto-end check failed', err);
      }
    },
    [myPhoneNumber],
  );

  // Save state immediately when connectivity changes (before mobile reload)
  useEffect(() => {
    // Save current call state synchronously when connectivity changes
    // This must happen BEFORE the mobile browser potentially reloads
    if (currentCall && currentCall.id) {
      const status = String(currentCall.status || '').toLowerCase();
      if (status === 'active' || status === 'ringing') {
        try {
          sessionStorage.setItem('currentCall', JSON.stringify(currentCall));
          sessionStorage.setItem('savedView', viewRef.current || view);
          console.log(
            '[App] 💾 Emergency save: Saved call state on connectivity change',
            {
              callId: currentCall.id,
              status: currentCall.status,
              view: viewRef.current || view,
              isOnline,
            },
          );
        } catch (e) {
          console.warn('[App] Failed emergency save on connectivity change', e);
        }
      }
    }
  }, [isOnline, currentCall?.id]); // Save whenever connectivity OR call changes

  // Handle pageshow event (fires when page is restored from bfcache or after reload)
  useEffect(() => {
    const handlePageShow = (e) => {
      console.log('[App] 📄 pageshow event fired', {
        persisted: e.persisted, // true if restored from bfcache
        timestamp: new Date().toISOString(),
      });

      // If page was restored from cache, state should still be in memory
      // If page was reloaded, we need to restore from sessionStorage
      if (!e.persisted && myPhoneNumber) {
        // Page was reloaded, restore state
        const restoreCallState = async () => {
          try {
            const savedCallStr = sessionStorage.getItem('currentCall');
            const savedViewStr = sessionStorage.getItem('savedView');

            if (savedCallStr && savedViewStr) {
              const savedCall = JSON.parse(savedCallStr);
              const status = String(savedCall.status || '').toLowerCase();

              if (status === 'active' || status === 'ringing') {
                console.log(
                  '[App] 🔄 Restoring call state after pageshow reload',
                  {
                    callId: savedCall.id,
                    status: savedCall.status,
                    savedView: savedViewStr,
                  },
                );

                // Immediately set the call state (don't wait for DB fetch)
                setCurrentCall(savedCall);
                setView(savedViewStr);

                // Then fetch fresh data in background
                try {
                  const freshCall = await fetchCallById(savedCall.id);
                  if (freshCall) {
                    const freshStatus = String(
                      freshCall.status || '',
                    ).toLowerCase();
                    if (freshStatus === 'active' || freshStatus === 'ringing') {
                      setCurrentCall(freshCall);
                      // Update view based on fresh status
                      if (freshStatus === 'ringing') {
                        const myNorm = normalizeNumber(myPhoneNumber);
                        const toNorm = normalizeNumber(
                          freshCall.to_number || '',
                        );
                        const fromNorm = normalizeNumber(
                          freshCall.from_number || '',
                        );
                        if (toNorm === myNorm) {
                          setView('incoming');
                        } else if (fromNorm === myNorm) {
                          setView('calling');
                        }
                      } else if (freshStatus === 'active') {
                        const targetView = isOnline ? 'calling' : 'connected';
                        setView(targetView);
                      }
                    } else {
                      // Call ended, clear state
                      sessionStorage.removeItem('currentCall');
                      sessionStorage.removeItem('savedView');
                      setCurrentCall(null);
                      setView('dialer');
                    }
                  }
                } catch (err) {
                  console.warn(
                    '[App] Failed to fetch fresh call after pageshow',
                    err,
                  );
                  // Keep the restored state even if fetch fails
                }
              }
            }
          } catch (e) {
            console.warn(
              '[App] Failed to restore call state after pageshow',
              e,
            );
          }
        };

        restoreCallState();
      }
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [myPhoneNumber, isOnline]);

  // Restore call state on mount if page was reloaded (mobile connectivity issue)
  useEffect(() => {
    if (!myPhoneNumber) return; // Wait for phone number to be set

    const restoreCallState = async () => {
      try {
        const savedCallStr = sessionStorage.getItem('currentCall');
        const savedViewStr = sessionStorage.getItem('savedView');

        if (savedCallStr && savedViewStr) {
          const savedCall = JSON.parse(savedCallStr);
          const status = String(savedCall.status || '').toLowerCase();

          // Only restore if call is still active or ringing
          if (status === 'active' || status === 'ringing') {
            console.log('[App] 🔄 Restoring call state after page reload', {
              callId: savedCall.id,
              status: savedCall.status,
              savedView: savedViewStr,
            });

            // Fetch fresh call data from database
            try {
              const freshCall = await fetchCallById(savedCall.id);
              if (freshCall) {
                const freshStatus = String(
                  freshCall.status || '',
                ).toLowerCase();

                if (freshStatus === 'active' || freshStatus === 'ringing') {
                  // Call is still active, restore it
                  setCurrentCall(freshCall);

                  // Determine the correct view based on call status and connectivity
                  if (freshStatus === 'ringing') {
                    const myNorm = normalizeNumber(myPhoneNumber);
                    const toNorm = normalizeNumber(freshCall.to_number || '');
                    const fromNorm = normalizeNumber(
                      freshCall.from_number || '',
                    );

                    if (toNorm === myNorm) {
                      // We're the recipient
                      setView('incoming');
                    } else if (fromNorm === myNorm) {
                      // We're the caller
                      setView('calling');
                    } else {
                      // Not for us, clear it
                      sessionStorage.removeItem('currentCall');
                      sessionStorage.removeItem('savedView');
                    }
                  } else if (freshStatus === 'active') {
                    // Active call - show calling view if online, connected if offline
                    const targetView = isOnline ? 'calling' : 'connected';
                    setView(targetView);
                  }
                } else {
                  // Call has ended, clear saved state
                  console.log('[App] Call has ended, clearing saved state', {
                    callId: freshCall.id,
                    status: freshStatus,
                  });
                  sessionStorage.removeItem('currentCall');
                  sessionStorage.removeItem('savedView');
                }
              } else {
                // Call not found, clear saved state
                console.log(
                  '[App] Call not found in database, clearing saved state',
                );
                sessionStorage.removeItem('currentCall');
                sessionStorage.removeItem('savedView');
              }
            } catch (err) {
              console.warn('[App] Failed to fetch call during restore', err);
              // On error, still try to restore from saved state
              setCurrentCall(savedCall);
              setView(savedViewStr);
            }
          } else {
            // Call has ended, clear saved state
            sessionStorage.removeItem('currentCall');
            sessionStorage.removeItem('savedView');
          }
        }
      } catch (e) {
        console.warn('[App] Failed to restore call state', e);
        sessionStorage.removeItem('currentCall');
        sessionStorage.removeItem('savedView');
      }
    };

    restoreCallState();
  }, [myPhoneNumber, isOnline]); // Run when phone number is set and connectivity changes

  useEffect(() => {
    // keep refs to subscriptions so we can cleanup precisely
    let incomingSub = null;
    let usersSub = null;
    let mounted = true;
    let listenersAttached = false;
    const normalizeNumber = (s) => String(s || '').replace(/\D/g, '');

    // handler functions declared in outer scope so cleanup can remove them
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setUserOffline(myPhoneNumber).catch(() => {});
        stopPresenceHeartbeat();
      } else {
        startPresenceHeartbeat(myPhoneNumber, myUsername);
      }
    };

    const handleBeforeUnload = () => {
      // best-effort async; may not complete reliably in all browsers
      setUserOffline(myPhoneNumber).catch(() => {});
      stopPresenceHeartbeat();
    };

    // Only proceed if we have credentials
    if (myUsername && myPhoneNumber) {
      (async () => {
        let proceedWithRegistration = false;

        try {
          // ensure you have fetchUserByPhone imported from audioService.js
          const userRow = await fetchUserByPhone(myPhoneNumber);
          console.log('fetched userRow for', myPhoneNumber, userRow);

          // If a row exists, require username to match (defensive).
          // If no row exists, allow registration (we will upsert/create the row).
          if (userRow && userRow.phone_number) {
            setView('dialer');

            if (
              String((userRow.username || '').toLowerCase()) ===
              String((myUsername || '').toLowerCase())
            ) {
              proceedWithRegistration = true;
            } else {
              console.debug(
                'Stored username does not match DB user for this phone',
                {
                  stored: { myUsername, myPhoneNumber },
                  userRow,
                },
              );
              proceedWithRegistration = false;
            }
          } else {
            // No user found in DB for this phone -> allow registration (upsert)
            proceedWithRegistration = true;
          }
        } catch (err) {
          console.warn('fetchUserByPhone check failed', err);
          // fallback: allow registration to continue on transient DB errors
          proceedWithRegistration = true;
        }

        if (!mounted) return;
        if (!proceedWithRegistration) return;

        // attach visibility/unload listeners AFTER validation succeeds
        window.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('beforeunload', handleBeforeUnload);
        listenersAttached = true;

        // Register presence and heartbeat
        try {
          await ensureRegisteredAndListen(myPhoneNumber, myUsername);
          // After successful registration, set view to dialer
          if (mounted) {
            setView('dialer');
          }
        } catch (e) {
          console.warn('ensureRegisteredAndListen failed', e);
          // Even if registration fails, try to proceed to dialer
          if (mounted) {
            setView('dialer');
          }
        }
        startPresenceHeartbeat(myPhoneNumber, myUsername);

        // Listen for incoming calls and status updates
        incomingSub = listenForIncomingCalls(
          myPhoneNumber,
          (callRow, payload) => {
            if (!mounted || !callRow) return;

            const myNorm = normalizeNumber(myPhoneNumber);
            const target = normalizeNumber(
              callRow.to_number || callRow.to || callRow.toNumber || '',
            );
            const from = normalizeNumber(
              callRow.from_number || callRow.from || callRow.fromNumber || '',
            );

            console.log('[incoming call handler] Received call event', {
              myPhoneNumber: myPhoneNumber,
              myNormalized: myNorm,
              targetRaw: callRow.to_number || callRow.to || callRow.toNumber,
              targetNormalized: target,
              fromRaw:
                callRow.from_number || callRow.from || callRow.fromNumber,
              fromNormalized: from,
              callId: callRow.id,
              callStatus: callRow.status,
              lastCreatedCallId: lastCreatedCallIdRef.current,
              isMyCreatedCall:
                String(callRow.id) === String(lastCreatedCallIdRef.current),
            });

            // CRITICAL: First check if this call is even targeted to us
            // This should never happen if audioService filtering works, but defensive check
            if (target !== myNorm) {
              console.log(
                '[incoming call handler] REJECTED - not targeted to this user',
                {
                  target,
                  myNorm,
                  targetRaw: callRow.to_number,
                  myPhoneNumber,
                },
              );
              return;
            }

            console.log(
              '[incoming call handler] Call IS targeted to us - checking further',
              {
                myNorm,
                target,
                from,
                callId: callRow.id,
                status: callRow.status,
              },
            );

            // ignore events for a call we just created locally (CHECK THIS FIRST)
            if (
              lastCreatedCallIdRef.current &&
              String(callRow.id) === String(lastCreatedCallIdRef.current)
            ) {
              console.log(
                '[incoming call handler] IGNORED - this is a call we created locally',
                {
                  callId: callRow.id,
                  lastCreatedCallId: lastCreatedCallIdRef.current,
                },
              );
              return;
            }

            // ignore self-originated (defensive)
            if (from === myNorm) {
              console.log(
                '[incoming call handler] IGNORED - self-originated call',
                {
                  from,
                  myNorm,
                },
              );
              return;
            }

            console.log('[incoming call handler] Processing as incoming call', {
              myNorm,
              target,
              from,
              callId: callRow.id,
              status: callRow.status,
            });

            // Final safety check: ensure target still matches (should never fail at this point)
            const finalTargetCheck = normalizeNumber(
              callRow.to_number || callRow.to || callRow.toNumber || '',
            );
            if (finalTargetCheck !== myNorm) {
              console.error(
                '[incoming call handler] CRITICAL: Target mismatch detected after all checks!',
                {
                  finalTargetCheck,
                  myNorm,
                  callRow,
                },
              );
              return;
            }

            const status = String(callRow.status || '').toLowerCase();

            // update local current call (only after all validation passes)
            setCurrentCall(callRow);

            if (status === 'ringing') {
              setIncomingCallPayload(callRow);
              setView('incoming');
              return;
            }

            if (status === 'active') {
              const targetView = navigator.onLine ? 'calling' : 'connected';
              setView(targetView);

              // Stop recording if we're going to connected view (offline playback)
              if (targetView === 'connected') {
                console.log(
                  '[incoming call handler] Stopping recording - entering connected view',
                );
                stopRecording();
                // Clear upload progress callback
                setUploadProgressCallback(null);
                // Reset chunk counter
                setUploadedChunksCount(0);
                // Reset chunk counter
                setUploadedChunksCount(0);
              }

              try {
                // Listen for audio chunks from the opposite party
                // Fetches historical chunks and subscribes to new ones
                console.log(
                  '[incoming call handler] Setting up audio listener',
                  {
                    callId: callRow.id,
                    view: targetView,
                    isOnline: navigator.onLine,
                  },
                );
                listenForAudio(
                  callRow.id,
                  ({ playable, meta, isHistorical }) => {
                    console.log(
                      '[incoming call handler] Audio chunk callback triggered',
                      {
                        callId: callRow.id,
                        hasPlayable: !!playable,
                        chunkId: meta?.id,
                        from_number: meta?.from_number,
                        isHistorical,
                        currentView: view,
                      },
                    );
                    if (!playable) {
                      console.warn(
                        '[incoming call handler] No playable URL in chunk',
                        {
                          meta,
                        },
                      );
                      return;
                    }
                    // Additional safety check: skip chunks recorded by us
                    if (
                      normalizeNumber(meta.from_number || '') ===
                      normalizeNumber(myPhoneNumber)
                    ) {
                      console.log(
                        '[incoming call handler] Skipping own chunk',
                        {
                          chunkFrom: meta.from_number,
                          myPhoneNumber,
                        },
                      );
                      return;
                    }
                    if (playedChunkIdsRef.current.has(meta.id)) {
                      console.log(
                        '[incoming call handler] Chunk already played',
                        {
                          chunkId: meta.id,
                        },
                      );
                      return;
                    }
                    // Don't mark as played yet - let playAudio do it when audio actually plays
                    console.log('[incoming call handler] Calling playAudio', {
                      playable,
                      chunkId: meta.id,
                      currentView: view,
                    });
                    playAudio(playable, meta.id); // Pass chunk ID so playAudio can mark it when actually playing
                  },
                  {
                    fetchHistorical: true,
                    call: callRow,
                    myPhoneNumber,
                  },
                );
              } catch (e) {
                console.warn('listenForAudio (incoming active) failed', e);
              }
              return;
            }

            if (status === 'ended' || status === 'rejected') {
              try {
                stopRecording();
                // Clear upload progress callback
                setUploadProgressCallback(null);
                // Reset chunk counter
                setUploadedChunksCount(0);
                // Reset chunk counter
                setUploadedChunksCount(0);
              } catch (e) {}
              try {
                unsubscribeAudio().catch(() => {});
              } catch (e) {}
              // Keep the call object (with ended status) so connectivity effect knows we're handling an ended call
              // Only clear it when user clicks "Done" on end view
              setCurrentCall(callRow);
              setView('end');
              return;
            }
          },
        );

        // Subscribe to users list + presence changes (refetch on changes)
        try {
          usersSub = await subscribeToUsers(processUsersList);
        } catch (e) {
          console.warn('subscribeToUsers failed', e);
        }
      })();
    }

    // cleanup for this effect block
    return () => {
      mounted = false;
      try {
        unsubscribeIncomingCalls().catch(() => {});
        unsubscribeAudio().catch(() => {});
        unsubscribeUsers().catch(() => {});
        if (typeof incomingSub?.unsubscribe === 'function')
          incomingSub.unsubscribe().catch(() => {});
        if (typeof usersSub?.unsubscribe === 'function')
          usersSub.unsubscribe().catch(() => {});
      } catch (e) {}

      if (listenersAttached) {
        window.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
      stopPresenceHeartbeat();
      setUserOffline(myPhoneNumber).catch(() => {});
    };
  }, [myUsername, myPhoneNumber]);

  // Refresh users list when entering dialer view
  // Also force-end any active calls (edge case handling)
  // IMPORTANT: Don't clear calls if we're transitioning from connected/calling view
  useEffect(() => {
    if (view === 'dialer' && myPhoneNumber) {
      // Check if we have a currentCall - if so, don't force-end it
      // This prevents clearing calls during connectivity transitions
      const hasActiveCall =
        currentCall &&
        String(currentCall.status || '').toLowerCase() === 'active';
      const previousView = viewRef.current;

      // If we're coming from connected/calling view, preserve the call
      if (
        hasActiveCall &&
        (previousView === 'connected' || previousView === 'calling')
      ) {
        console.log(
          '[App] ⚠️ Entered dialer view but have active call from connected/calling - preserving call',
          {
            callId: currentCall.id,
            previousView: previousView,
            currentView: view,
          },
        );
        // Switch back to calling view instead of clearing
        setView('calling');
        return; // Exit early - don't clear the call
      }

      console.log('[App] Refreshing users list - entered dialer view');
      refreshUsersList(processUsersList);

      // Edge case: If user enters dialer view but has an active call, force end it
      // Only do this if we're not transitioning from a call view
      (async () => {
        try {
          const activeCallId = await fetchActiveCallId(myPhoneNumber);
          if (activeCallId) {
            // Double-check: if we have currentCall, don't clear it if we're transitioning
            if (currentCall && currentCall.id === activeCallId) {
              const prevView = viewRef.current;
              if (prevView === 'connected' || prevView === 'calling') {
                console.log(
                  '[App] ⚠️ Active call found but preserving due to transition from call view',
                  {
                    callId: activeCallId,
                    previousView: prevView,
                  },
                );
                setView('calling');
                return; // Don't end the call
              }
            }

            console.warn(
              '[App] Edge case detected: Active call found when entering dialer view. Force ending call:',
              activeCallId,
            );
            await endCall(activeCallId);
            // Clear local state
            setCurrentCall(null);
          }
        } catch (err) {
          console.warn(
            '[App] Failed to check/end active call on dialer entry:',
            err,
          );
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, myPhoneNumber]);

  // Stop audio playback when leaving 'connected' view
  useEffect(() => {
    if (view !== 'connected' && audioPlayerRef.current) {
      console.log('[App] Stopping audio playback - leaving connected view');
      try {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      } catch (e) {
        console.warn('Error stopping audio on view change', e);
      }
    }
  }, [view]);

  // Set up audio listener when entering 'calling' view (online) to fetch and cache chunks
  useEffect(() => {
    if (view === 'calling' && currentCall && currentCall.id && myPhoneNumber) {
      console.log(
        '[App] Entering calling view - setting up audio listener to fetch and cache chunks',
        {
          callId: currentCall.id,
          callStatus: currentCall.status,
        },
      );

      // Clear any existing audio subscription
      try {
        unsubscribeAudio().catch(() => {});
      } catch (e) {
        console.warn('[App] Error unsubscribing audio before setup', e);
      }

      // Set up listener to fetch historical chunks and cache them (but don't play in calling view)
      try {
        listenForAudio(
          currentCall.id,
          ({ playable, meta, isHistorical }) => {
            console.log(
              '[App] Audio chunk received in calling view (caching for offline)',
              {
                callId: currentCall.id,
                hasPlayable: !!playable,
                chunkId: meta?.id,
                from_number: meta?.from_number,
                isHistorical,
              },
            );
            if (!playable) {
              console.warn('[App] No playable URL in chunk', { meta });
              return;
            }
            // Additional safety check: skip chunks recorded by us
            if (
              normalizeNumber(meta.from_number || '') ===
              normalizeNumber(myPhoneNumber)
            ) {
              console.log('[App] Skipping own chunk', {
                chunkFrom: meta.from_number,
                myPhoneNumber,
              });
              return;
            }
            // In calling view, we just cache chunks but don't play them
            // They will be played when user goes offline to connected view
            console.log('[App] Chunk cached for offline playback', {
              chunkId: meta.id,
              isHistorical,
            });
          },
          {
            fetchHistorical: true, // Fetch and cache all historical chunks
            call: currentCall,
            myPhoneNumber,
          },
        );
        console.log(
          '[App] ✅ Audio listener set up for calling view (caching mode)',
        );
      } catch (e) {
        console.error(
          '[App] ❌ Failed to set up audio listener in calling view',
          e,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentCall?.id, myPhoneNumber]);

  // Play cached audio when entering 'connected' view (offline)
  useEffect(() => {
    // This log should ALWAYS appear when the effect runs
    console.log('[App] 🔍 useEffect triggered for connected view check', {
      view,
      viewRef: viewRef.current,
      hasCurrentCall: !!currentCall,
      currentCallId: currentCall?.id,
      currentCallStatus: currentCall?.status,
      currentCallFull: currentCall,
      myPhoneNumber,
      allConditionsMet:
        view === 'connected' && currentCall && currentCall.id && myPhoneNumber,
    });

    // Only proceed if we're in connected view
    if (view !== 'connected') {
      return;
    }

    // If we don't have currentCall yet, wait a bit and try again
    if (!currentCall || !currentCall.id || !myPhoneNumber) {
      console.log('[App] ⏳ Waiting for currentCall to be available', {
        hasCurrentCall: !!currentCall,
        currentCallId: currentCall?.id,
        hasMyPhoneNumber: !!myPhoneNumber,
      });
      // Try again after a short delay
      const timeoutId = setTimeout(() => {
        if (currentCall && currentCall.id && myPhoneNumber) {
          console.log('[App] ✅ Retrying after delay - conditions now met');
          // Trigger the effect again by checking conditions
        }
      }, 500);
      return () => clearTimeout(timeoutId);
    }

    console.log(
      '[App] ✅ Entering connected view - playing cached audio chunks',
      {
        callId: currentCall.id,
        callStatus: currentCall.status,
        from_number: currentCall.from_number,
        to_number: currentCall.to_number,
      },
    );

    // Clear played chunks when entering connected view so we can replay them
    playedChunkIdsRef.current.clear();
    console.log('[App] Cleared played chunks set - ready to replay');

    // Reset playback state
    setCurrentPlayingChunkId(null);
    setCurrentChunkProgress(0);

    // Fetch all chunks from IndexedDB cache (offline mode)
    (async () => {
      try {
        console.log('[App] Fetching chunks...', {
          callId: currentCall.id,
          isOnline: navigator.onLine,
        });

        // Try to fetch from database first (if online), then fallback to cache
        // This ensures we get all chunks even if some weren't cached
        let historicalChunks = [];
        if (navigator.onLine) {
          try {
            console.log('[App] Attempting to fetch from database (online)...');
            historicalChunks = await fetchAudioChunksFromOppositeParty(
              currentCall.id,
              myPhoneNumber,
              currentCall,
              false, // useCache = false to fetch from database
            );
            console.log(
              `[App] Fetched ${historicalChunks.length} chunks from database`,
            );

            // Also cache them for offline use
            for (const chunk of historicalChunks) {
              if (chunk.url && !chunk.url.startsWith('blob:')) {
                cacheAudioUrl(chunk.url, {
                  id: chunk.id,
                  call_id: chunk.call_id || currentCall.id,
                  from_number: chunk.from_number,
                  url: chunk.url,
                  file_path: chunk.file_path,
                  created_at: chunk.created_at,
                }).catch((err) => {
                  console.warn('[App] Failed to cache chunk', {
                    chunkId: chunk.id,
                    error: err,
                  });
                });
              }
            }
          } catch (err) {
            console.warn(
              '[App] Failed to fetch from database, trying cache',
              err,
            );
          }
        }

        // If no chunks from database, try cache
        if (historicalChunks.length === 0) {
          console.log('[App] Fetching chunks from IndexedDB cache...');
          historicalChunks = await fetchAudioChunksFromOppositeParty(
            currentCall.id,
            myPhoneNumber,
            currentCall,
            true, // useCache = true for offline mode
          );
          console.log(
            `[App] Fetched ${historicalChunks.length} chunks from cache`,
          );
        }

        console.log(
          `[App] Found ${historicalChunks.length} chunks to play from cache`,
          { callId: currentCall.id, chunks: historicalChunks },
        );

        // Filter out our own chunks for display
        const otherPartyChunks = historicalChunks.filter((chunk) => {
          return (
            normalizeNumber(chunk.from_number || '') !==
            normalizeNumber(myPhoneNumber)
          );
        });

        // Find the first chunk of the current online session
        // This is the first chunk created after we last went offline
        let firstChunkOfCurrentSessionIndex = 0;
        if (lastOfflineTimestampRef.current && otherPartyChunks.length > 0) {
          const offlineTimestamp = new Date(lastOfflineTimestampRef.current);
          console.log('[App] Finding first chunk of current online session', {
            offlineTimestamp: lastOfflineTimestampRef.current,
            totalChunks: otherPartyChunks.length,
          });

          // Find the first chunk created after we went offline
          for (let i = 0; i < otherPartyChunks.length; i++) {
            const chunk = otherPartyChunks[i];
            if (chunk.created_at) {
              const chunkDate = new Date(chunk.created_at);
              if (chunkDate > offlineTimestamp) {
                firstChunkOfCurrentSessionIndex = i;
                firstChunkOfCurrentSessionRef.current = chunk.id;
                console.log('[App] Found first chunk of current session', {
                  chunkIndex: i,
                  chunkId: chunk.id,
                  chunkCreatedAt: chunk.created_at,
                  offlineTimestamp: lastOfflineTimestampRef.current,
                });
                break;
              }
            }
          }
        } else if (otherPartyChunks.length > 0) {
          // If no offline timestamp, use the first chunk
          firstChunkOfCurrentSessionIndex = 0;
          firstChunkOfCurrentSessionRef.current = otherPartyChunks[0].id;
          console.log('[App] No offline timestamp - using first chunk', {
            chunkId: otherPartyChunks[0].id,
          });
        }

        // Set chunks for visual timeline
        // For DualTimeline, we need ALL chunks (both parties) to show both timelines
        // For the chunk scrubber, we'll filter to show only other party chunks
        // The playback controller will use otherPartyChunks for actual playback
        console.log('[App] Setting playback chunks', {
          totalChunks: historicalChunks.length,
          otherPartyChunks: otherPartyChunks.length,
          myChunks: historicalChunks.length - otherPartyChunks.length,
        });

        // Set ALL chunks for DualTimeline visualization (needs both parties)
        // The view will filter to other party chunks for the scrubber display
        setPlaybackChunks(historicalChunks);
        setIsPlaying(false); // Will be set to true when play() is called
        playbackAbortRef.current = false;

        if (otherPartyChunks.length === 0) {
          console.warn(
            '[App] ⚠️ No chunks found from other party - nothing to play',
            {
              totalChunks: historicalChunks.length,
              myChunks: historicalChunks.length,
            },
          );
          // Still show the timeline even if no other party chunks (will show empty timeline)
          // Don't return early - let the controller be created even with 0 chunks
        }

        // Clear played chunks so we can start fresh from the first chunk of current session
        playedChunkIdsRef.current.clear();
        console.log(
          '[App] Cleared played chunks - will start from first chunk of current session',
          {
            firstChunkIndex: firstChunkOfCurrentSessionIndex,
            firstChunkId: firstChunkOfCurrentSessionRef.current,
            totalChunks: otherPartyChunks.length,
          },
        );

        // Create playback controller
        // Capture the first chunk index in closure
        const firstChunkIndex = firstChunkOfCurrentSessionIndex;
        const controller = {
          play: async () => {
            if (isPlayingRef.current) {
              console.log('[App] Already playing, ignoring play() call');
              return;
            }
            console.log('[App] Starting playback');
            setIsPlaying(true);
            isPlayingRef.current = true;
            playbackAbortRef.current = false;

            // Ensure any previous audio is cleaned up
            if (currentAudioRef.current) {
              try {
                currentAudioRef.current.pause();
                currentAudioRef.current = null;
              } catch (e) {
                console.warn('[App] Error cleaning up before play', e);
              }
            }

            // Find the first unplayed chunk or continue from current
            // Start from the first chunk of the current online session
            let startIndex = firstChunkIndex;
            if (currentPlayingChunkId) {
              const currentIndex = otherPartyChunks.findIndex(
                (c) => c.id === currentPlayingChunkId,
              );
              if (currentIndex !== -1 && currentIndex >= firstChunkIndex) {
                startIndex = currentIndex;
              }
            }
            console.log('[App] Starting playback from chunk index', {
              startIndex,
              firstChunkIndex,
              currentPlayingChunkId,
              totalChunks: otherPartyChunks.length,
            });

            // Play chunks in order starting from startIndex
            for (let i = startIndex; i < otherPartyChunks.length; i++) {
              if (playbackAbortRef.current) {
                console.log('[App] Playback aborted');
                break;
              }

              const chunk = otherPartyChunks[i];
              if (!chunk || !chunk.url) {
                console.warn('[App] Skipping invalid chunk', { chunk });
                continue;
              }

              // Skip if already played (unless we're resuming)
              if (i < startIndex && playedChunkIdsRef.current.has(chunk.id)) {
                console.log('[App] Chunk already played', {
                  chunkId: chunk.id,
                });
                continue;
              }

              // Resolve from cache
              console.log('[App] Resolving playable URL for chunk', {
                chunkId: chunk.id,
                url: chunk.url,
              });
              const playable = await resolvePlayableUrl(chunk.url);
              if (!playable) {
                console.warn(
                  '[App] ⚠️ Could not resolve playable URL for chunk',
                  {
                    chunkId: chunk.id,
                    url: chunk.url,
                  },
                );
                continue;
              }

              // Wait for play to be resumed if paused
              while (!isPlayingRef.current && !playbackAbortRef.current) {
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              if (playbackAbortRef.current) break;

              // Update UI to show this chunk is playing
              setCurrentPlayingChunkId(chunk.id);
              setCurrentChunkProgress(0);

              // Wait for this chunk to finish playing before moving to the next
              try {
                await new Promise(async (resolve) => {
                  // Clean up any previous audio first
                  if (currentAudioRef.current) {
                    try {
                      currentAudioRef.current.pause();
                      currentAudioRef.current = null;
                    } catch (e) {
                      console.warn('[App] Error cleaning up previous audio', e);
                    }
                  }

                  const audio = new Audio(playable);
                  currentAudioRef.current = audio;
                  audio.volume = 1.0;
                  audio.preload = 'auto';

                  // Wait for audio to be ready before playing (fixes jittering)
                  const waitForReady = new Promise((readyResolve) => {
                    const checkReady = () => {
                      if (audio.readyState >= 3) {
                        // HAVE_FUTURE_DATA or higher
                        readyResolve();
                      } else {
                        audio.addEventListener('canplay', checkReady, {
                          once: true,
                        });
                        audio.addEventListener('canplaythrough', checkReady, {
                          once: true,
                        });
                      }
                    };
                    checkReady();
                  });

                  // Track progress within the chunk
                  const updateProgress = () => {
                    if (
                      audio.duration &&
                      audio.duration > 0 &&
                      !isNaN(audio.duration)
                    ) {
                      const progress = audio.currentTime / audio.duration;
                      setCurrentChunkProgress(
                        Math.min(1, Math.max(0, progress)),
                      );
                    }
                  };

                  // Update progress periodically
                  const progressInterval = setInterval(updateProgress, 100);

                  // Timeout fallback - if chunk doesn't end within 7 seconds, move on (increased from 6s)
                  const timeoutId = setTimeout(() => {
                    console.warn('[App] ⚠️ Chunk playback timeout', {
                      chunkId: chunk.id,
                    });
                    clearInterval(progressInterval);
                    audio.pause();
                    setCurrentChunkProgress(1);
                    setCurrentPlayingChunkId(null);
                    currentAudioRef.current = null;
                    resolve();
                  }, 7000);

                  audio.onloadedmetadata = () => {
                    console.log('[App] ✅ Chunk metadata loaded', {
                      chunkId: chunk.id,
                      duration: audio.duration,
                    });
                  };

                  audio.oncanplay = () => {
                    console.log('[App] ✅ Chunk can play', {
                      chunkId: chunk.id,
                      readyState: audio.readyState,
                    });
                  };

                  audio.oncanplaythrough = () => {
                    console.log('[App] ✅ Chunk can play through', {
                      chunkId: chunk.id,
                      readyState: audio.readyState,
                    });
                  };

                  audio.onended = () => {
                    console.log('[App] ✅ Chunk finished playing', {
                      chunkId: chunk.id,
                    });
                    clearTimeout(timeoutId);
                    clearInterval(progressInterval);
                    setCurrentChunkProgress(1);
                    setCurrentPlayingChunkId(null);
                    currentAudioRef.current = null;
                    resolve();
                  };

                  audio.onerror = (e) => {
                    console.error('[App] ❌ Chunk playback error', {
                      chunkId: chunk.id,
                      error: e,
                      errorCode: audio.error?.code,
                      errorMessage: audio.error?.message,
                      errorName: audio.error ? String(audio.error) : 'Unknown',
                    });
                    clearTimeout(timeoutId);
                    clearInterval(progressInterval);
                    setCurrentPlayingChunkId(null);
                    setCurrentChunkProgress(0);
                    currentAudioRef.current = null;
                    resolve(); // Continue to next chunk
                  };

                  // Wait for audio to be ready, then start playing
                  try {
                    await waitForReady;
                    console.log('[App] ✅ Audio ready, starting playback', {
                      chunkId: chunk.id,
                      readyState: audio.readyState,
                    });

                    // Start playing
                    const playPromise = audio.play();
                    if (playPromise !== undefined) {
                      await playPromise;
                      console.log('[App] ✅ Chunk started playing', {
                        chunkId: chunk.id,
                        duration: audio.duration,
                      });
                      if (chunk.id) {
                        playedChunkIdsRef.current.add(chunk.id);
                      }
                    } else {
                      if (chunk.id) {
                        playedChunkIdsRef.current.add(chunk.id);
                      }
                    }
                  } catch (err) {
                    console.error('[App] ❌ Failed to start chunk playback', {
                      chunkId: chunk.id,
                      error: err,
                      errorName: err.name,
                      errorMessage: err.message,
                      userAgent: navigator.userAgent,
                    });

                    // On mobile, autoplay might be blocked - show user-friendly prompt
                    if (
                      err.name === 'NotAllowedError' ||
                      err.name === 'NotSupportedError'
                    ) {
                      console.warn(
                        '[App] ⚠️ Autoplay blocked - showing user prompt',
                      );

                      // Show alert to user
                      const isMobile =
                        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                          navigator.userAgent,
                        );

                      if (isMobile && i === 0) {
                        // Only show alert for first chunk to avoid spam
                        alert(
                          'Audio playback requires your permission.\n\nPlease tap the play button to start listening to the call recording.',
                        );
                      }

                      // Try to play on user interaction
                      const tryPlayOnInteraction = () => {
                        audio
                          .play()
                          .then(() => {
                            console.log(
                              '[App] ✅ Chunk started playing after user interaction',
                            );
                            if (chunk.id) {
                              playedChunkIdsRef.current.add(chunk.id);
                            }
                            document.removeEventListener(
                              'touchstart',
                              tryPlayOnInteraction,
                            );
                            document.removeEventListener(
                              'click',
                              tryPlayOnInteraction,
                            );
                          })
                          .catch((retryErr) => {
                            console.error(
                              '[App] ❌ Retry play also failed',
                              retryErr,
                            );
                            document.removeEventListener(
                              'touchstart',
                              tryPlayOnInteraction,
                            );
                            document.removeEventListener(
                              'click',
                              tryPlayOnInteraction,
                            );
                          });
                      };
                      document.addEventListener(
                        'touchstart',
                        tryPlayOnInteraction,
                        { once: true },
                      );
                      document.addEventListener('click', tryPlayOnInteraction, {
                        once: true,
                      });
                    }

                    clearTimeout(timeoutId);
                    clearInterval(progressInterval);
                    setCurrentPlayingChunkId(null);
                    setCurrentChunkProgress(0);
                    currentAudioRef.current = null;
                    resolve();
                    return; // Exit early on error
                  }
                });
              } catch (err) {
                console.error('[App] ❌ Exception during chunk playback', {
                  chunkId: chunk.id,
                  error: err,
                });
              }

              // Small buffer between chunks
              await new Promise((resolve) => setTimeout(resolve, 100));
            }

            // All chunks played
            setIsPlaying(false);
            isPlayingRef.current = false;
            setCurrentPlayingChunkId(null);
            setCurrentChunkProgress(0);
          },
          pause: () => {
            setIsPlaying(false);
            isPlayingRef.current = false;
            if (currentAudioRef.current) {
              currentAudioRef.current.pause();
            }
          },
          seek: async (chunkIndex, progress = 0) => {
            console.log('[App] Seeking to chunk', { chunkIndex, progress });

            // Stop current playback completely
            playbackAbortRef.current = true;
            const wasPlaying = isPlayingRef.current;

            // Pause and clean up current audio
            if (currentAudioRef.current) {
              try {
                currentAudioRef.current.pause();
                currentAudioRef.current.currentTime = 0;
                // Remove all event listeners by creating a new audio element
                currentAudioRef.current = null;
              } catch (e) {
                console.warn('[App] Error cleaning up audio during seek', e);
              }
            }

            // Wait a bit to ensure audio is fully stopped
            await new Promise((resolve) => setTimeout(resolve, 100));

            setIsPlaying(false);
            isPlayingRef.current = false;

            // Clear played chunks from this point forward
            const targetChunk = otherPartyChunks[chunkIndex];
            if (!targetChunk) {
              console.warn('[App] Invalid chunk index for seek', {
                chunkIndex,
                totalChunks: otherPartyChunks.length,
              });
              return;
            }

            // Mark chunks before target as played
            for (let i = 0; i < chunkIndex; i++) {
              if (otherPartyChunks[i]?.id) {
                playedChunkIdsRef.current.add(otherPartyChunks[i].id);
              }
            }

            // Clear chunks from target forward (so they can be replayed)
            for (let i = chunkIndex; i < otherPartyChunks.length; i++) {
              if (otherPartyChunks[i]?.id) {
                playedChunkIdsRef.current.delete(otherPartyChunks[i].id);
              }
            }

            // Reset abort flag for new playback
            playbackAbortRef.current = false;

            // Set current position
            setCurrentPlayingChunkId(targetChunk.id);
            setCurrentChunkProgress(progress);

            // If was playing, resume from this position after a short delay
            if (wasPlaying) {
              setTimeout(() => {
                if (playbackController) {
                  playbackController.play().catch((err) => {
                    console.warn(
                      '[App] Failed to resume playback after seek',
                      err,
                    );
                  });
                }
              }, 200); // Give time for cleanup
            }
          },
        };

        setPlaybackController(controller);

        // Auto-play immediately (will work on desktop, may need interaction on mobile)
        // Try multiple times with increasing delays to catch different timing scenarios
        const tryAutoPlay = (attempt = 1) => {
          if (attempt > 3) {
            console.log(
              '[App] Auto-play attempts exhausted, user can click play button',
            );

            // Show user-friendly prompt on mobile if autoplay failed
            const isMobile =
              /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                navigator.userAgent,
              );
            if (isMobile) {
              setTimeout(() => {
                alert(
                  'Audio playback requires your permission.\n\nPlease tap the play button (▶️) to start listening to the call recording.',
                );
              }, 500);
            }
            return;
          }

          setTimeout(() => {
            console.log(`[App] Attempting auto-play (attempt ${attempt})...`);
            if (controller) {
              controller.play().catch((err) => {
                console.warn(`[App] Auto-play attempt ${attempt} failed`, err);

                // If autoplay is blocked, show prompt immediately
                if (
                  err.name === 'NotAllowedError' ||
                  err.name === 'NotSupportedError'
                ) {
                  const isMobile =
                    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                      navigator.userAgent,
                    );
                  if (isMobile && attempt === 1) {
                    // Show alert on first attempt failure
                    setTimeout(() => {
                      alert(
                        'Audio playback requires your permission.\n\nPlease tap the play button (▶️) to start listening to the call recording.',
                      );
                    }, 500);
                  }
                  return; // Don't retry if autoplay is blocked
                }

                // Try again with longer delay for other errors
                if (attempt < 3) {
                  tryAutoPlay(attempt + 1);
                }
              });
            } else {
              console.warn(
                `[App] Controller not ready on attempt ${attempt}, retrying...`,
              );
              tryAutoPlay(attempt + 1);
            }
          }, attempt * 500); // 500ms, 1000ms, 1500ms
        };

        tryAutoPlay(1);
      } catch (e) {
        console.error(
          '[App] ❌ Failed to setup playback controller in connected view',
          e,
        );
      }
    })();
  }, [view, currentCall, myPhoneNumber]); // Don't include isPlaying to avoid re-running

  useEffect(() => {
    // If there is an active call and its status is 'active', switch view on connectivity change.
    if (
      currentCall &&
      String(currentCall.status || '').toLowerCase() === 'active'
    ) {
      if (!isOnline) {
        // go to playback/connected view when we lose connectivity
        console.log(
          '[connectivity effect] Going offline - stopping recording and switching to connected view',
        );
        // Record the timestamp when we go offline (to find first chunk of next online session)
        lastOfflineTimestampRef.current = new Date().toISOString();
        console.log('[connectivity effect] Recorded offline timestamp', {
          timestamp: lastOfflineTimestampRef.current,
        });
        // Track state change: going to playback mode
        myStateHistoryRef.current.push({
          timestamp: lastOfflineTimestampRef.current,
          state: 'playback',
          isOnline: false,
        });
        // Don't reset chunkIndex when going offline - we'll resume from where we left off
        stopRecording(false); // false = preserve chunkIndex
        // Clear upload progress callback
        setUploadProgressCallback(null);
        // Reset chunk counter
        setUploadedChunksCount(0);
        setView('connected');
      } else {
        // when we regain connectivity, show live calling UI and RESTART RECORDING
        console.log(
          '[connectivity effect] Coming back online - restarting recording',
          {
            callId: currentCall.id,
            lastOfflineTimestamp: lastOfflineTimestampRef.current,
          },
        );
        // Track state change: going to recording mode
        myStateHistoryRef.current.push({
          timestamp: new Date().toISOString(),
          state: 'recording',
          isOnline: true,
        });
        setView('calling');
        // Restart recording when coming back online
        // Use a small delay to ensure stopRecording has fully completed
        if (currentCall && currentCall.id && myPhoneNumber) {
          // Reset the first chunk of current session - we'll track it when first chunk arrives
          firstChunkOfCurrentSessionRef.current = null;

          // CRITICAL FIX: Re-set the upload progress callback BEFORE restarting recording
          // This was missing, causing "Waiting for first upload..." on 2nd+ online sessions
          const callIdForCallback = currentCall.id;
          setUploadProgressCallback(
            ({ callId: uploadedCallId, path, publicUrl, error, failed }) => {
              if (uploadedCallId === callIdForCallback) {
                if (failed) {
                  console.warn('[connectivity effect] ⚠️ Chunk upload failed', {
                    callId: uploadedCallId,
                    error,
                  });
                  setUploadStatus({
                    success: false,
                    error: error || 'Upload failed',
                  });
                } else {
                  setUploadedChunksCount((prev) => prev + 1);
                  setUploadStatus({ success: true });
                  console.log(
                    '[connectivity effect] ✅ Chunk uploaded (restart)',
                    {
                      callId: uploadedCallId,
                      path,
                      publicUrl,
                    },
                  );
                }
              }
            },
          );

          // Reset upload status for new recording session
          setUploadStatus(null);

          // Wait a bit to ensure any previous stopRecording has completed
          setTimeout(() => {
            console.log(
              '[connectivity effect] Restarting recording with preserved chunkIndex',
              {
                callId: currentCall.id,
                myPhoneNumber,
                // Note: chunkIndex is preserved in audioService.js when isRestartForSameCall is true
              },
            );
            startRecording(currentCall.id, myPhoneNumber)
              .then(() => {
                console.log(
                  '[connectivity effect] ✅ Recording restarted after coming back online',
                  {
                    callId: currentCall.id,
                    // chunkIndex should continue from where it left off
                  },
                );
              })
              .catch((err) => {
                console.error(
                  '[connectivity effect] ❌ Failed to restart recording',
                  err,
                );
              });
          }, 300); // Small delay to ensure cleanup completes
        }
      }
    }
  }, [isOnline, currentCall]);

  // when connectivity changes, check for pending calls and toggle connected/calling views
  useEffect(() => {
    let mounted = true;

    (async () => {
      // only proceed if we have a phone number
      if (!myPhoneNumber) return;

      // CRITICAL FIX FOR MOBILE: If we have an active call and we're in connected/calling view,
      // preserve it when coming back online - this MUST run FIRST before any other logic
      // This prevents the call from being cleared during connectivity transitions
      const earlyViewCheck = viewRef.current;
      if (
        isOnline &&
        currentCall &&
        currentCall.id &&
        String(currentCall.status || '').toLowerCase() === 'active' &&
        (earlyViewCheck === 'connected' ||
          earlyViewCheck === 'calling' ||
          view === 'connected' ||
          view === 'calling')
      ) {
        console.log(
          '[connectivity effect] 🛡️ EARLY GUARD: Preserving active call when coming back online',
          {
            callId: currentCall.id,
            earlyViewCheck: earlyViewCheck,
            viewState: view,
            viewRef: viewRef.current,
            isOnline,
          },
        );
        // Immediately switch to calling view and preserve the call
        setView('calling');
        // Refresh call state but don't clear it
        try {
          const fresh = await fetchCallById(currentCall.id);
          if (!mounted) return;
          if (fresh) {
            const s = String(fresh.status || '').toLowerCase();
            if (s === 'ended' || s === 'rejected') {
              // Only clear if call is actually ended
              try {
                stopRecording();
                setUploadProgressCallback(null);
                setUploadedChunksCount(0);
              } catch (e) {}
              try {
                await unsubscribeAudio();
              } catch (e) {}
              setCurrentCall(fresh);
              setView('end');
              return;
            }
            // Update with fresh data but keep it active
            setCurrentCall(fresh);
          }
        } catch (err) {
          console.warn(
            'fetchCallById (early guard - preserving active call) failed',
            err,
          );
          // Don't clear on error - preserve the call
        }
        return; // Exit early - we've handled the transition, don't run any other logic
      }

      // Don't interfere if we have an ended call - let the user dismiss it first via handleEndDone
      if (
        currentCall &&
        (String(currentCall.status || '').toLowerCase() === 'ended' ||
          String(currentCall.status || '').toLowerCase() === 'rejected')
      ) {
        return;
      }

      if (isOnline) {
        // IMPORTANT: If we're coming back online from 'connected' view with an active call,
        // preserve the call and switch to 'calling' view - don't clear it
        // Use viewRef.current to get the current view state (avoids stale closure on mobile)
        const currentView = viewRef.current;
        if (
          (currentView === 'connected' || view === 'connected') &&
          currentCall &&
          currentCall.id
        ) {
          const callStatus = String(currentCall.status || '').toLowerCase();
          if (callStatus === 'active') {
            console.log(
              '[connectivity effect] Coming back online from connected view - preserving call and switching to calling view',
              {
                callId: currentCall.id,
                currentView: currentView,
                viewState: view,
                viewRef: viewRef.current,
              },
            );
            setView('calling');
            // Still refresh the call state, but don't clear it
            try {
              const fresh = await fetchCallById(currentCall.id);
              if (!mounted) return;
              if (fresh) {
                const s = String(fresh.status || '').toLowerCase();
                // Only update if call is ended/rejected - otherwise preserve active call
                if (s === 'ended' || s === 'rejected') {
                  try {
                    stopRecording();
                    setUploadProgressCallback(null);
                    setUploadedChunksCount(0);
                  } catch (e) {}
                  try {
                    await unsubscribeAudio();
                  } catch (e) {}
                  setCurrentCall(fresh);
                  setView('end');
                  return;
                }
                // Update call with fresh data but keep it active
                setCurrentCall(fresh);
              }
            } catch (err) {
              console.warn('fetchCallById (coming back online) failed', err);
              // Don't clear the call on error - preserve it
            }
            return; // Exit early - we've handled the transition
          }
        }

        // If we already have a current call, refresh its server-side state
        if (currentCall && currentCall.id) {
          try {
            const fresh = await fetchCallById(currentCall.id);
            if (!mounted) return;
            if (fresh) {
              const s = String(fresh.status || '').toLowerCase();
              // if the other side ended/rejected while we were offline, clean up and show end view
              if (s === 'ended' || s === 'rejected') {
                try {
                  stopRecording();
                  // Clear upload progress callback
                  setUploadProgressCallback(null);
                  // Reset chunk counter
                  setUploadedChunksCount(0);
                  // Reset chunk counter
                  setUploadedChunksCount(0);
                } catch (e) {}
                try {
                  await unsubscribeAudio();
                } catch (e) {}
                setCurrentCall(fresh);
                setView('end');
                return;
              }
              // if the call became active while we were offline, show live calling UI (only if call is for us or we're the caller)
              if (s === 'active') {
                const freshToNumber = normalizeNumber(
                  fresh.to_number || fresh.to || fresh.toNumber || '',
                );
                const freshFromNumber = normalizeNumber(
                  fresh.from_number || fresh.from || fresh.fromNumber || '',
                );
                const myNorm = normalizeNumber(myPhoneNumber);

                // Show calling view if we're the recipient (to_number) or the caller (from_number)
                if (freshToNumber === myNorm || freshFromNumber === myNorm) {
                  console.log(
                    '[connectivity effect] Showing calling view for active call',
                    {
                      callId: fresh.id,
                      freshToNumber,
                      freshFromNumber,
                      myNorm,
                    },
                  );
                  setCurrentCall(fresh);
                  setView('calling');
                } else {
                  console.log(
                    '[connectivity effect] Ignoring active call - not for us',
                    {
                      callId: fresh.id,
                      freshToNumber,
                      freshFromNumber,
                      myNorm,
                    },
                  );
                  // Only clear if we're not in an active call view (preserve if in connected/calling)
                  if (view !== 'connected' && view !== 'calling') {
                    setCurrentCall(null);
                    setView('dialer');
                  }
                }
                return;
              }
              // if still ringing, check if call is for us (recipient) or from us (caller)
              if (s === 'ringing') {
                const freshToNumber = normalizeNumber(
                  fresh.to_number || fresh.to || fresh.toNumber || '',
                );
                const freshFromNumber = normalizeNumber(
                  fresh.from_number || fresh.from || fresh.fromNumber || '',
                );
                const myNorm = normalizeNumber(myPhoneNumber);

                // If we're the recipient, show incoming view
                if (freshToNumber === myNorm) {
                  console.log(
                    '[connectivity effect] Showing incoming view for call',
                    {
                      callId: fresh.id,
                      toNumber: freshToNumber,
                      myNorm,
                    },
                  );
                  console.log('fresh', {
                    callId: fresh.id,
                    toNumber: freshToNumber,
                    myNorm,
                  });
                  setIncomingCallPayload(fresh);
                  setCurrentCall(fresh);
                  setView('incoming');
                } else if (freshFromNumber === myNorm) {
                  // If we're the caller, show calling view
                  console.log(
                    '[connectivity effect] Showing calling view - we are the caller',
                    {
                      callId: fresh.id,
                      fromNumber: freshFromNumber,
                      toNumber: freshToNumber,
                      myNorm,
                    },
                  );
                  setCurrentCall(fresh);
                  setView('calling');
                } else {
                  // Not for us at all - clear and return to dialer
                  console.log(
                    '[connectivity effect] Ignoring ringing call - not for us',
                    {
                      callId: fresh.id,
                      freshToNumber,
                      freshFromNumber,
                      myNorm,
                    },
                  );
                  // Clear the call if it's not for us
                  setCurrentCall(null);
                  setView('dialer');
                }
                return;
              }
            }
          } catch (err) {
            console.warn('fetchCallById (connectivity effect) failed', err);
          }
        }

        // If we already have a current call that is active, show live calling UI
        // IMPORTANT: If we're coming back online from 'connected' view, preserve the call
        // and go back to 'calling' view - don't clear it unless it's actually ended
        if (
          currentCall &&
          String(currentCall.status || '').toLowerCase() === 'active'
        ) {
          const callToNumber = normalizeNumber(
            currentCall.to_number ||
              currentCall.to ||
              currentCall.toNumber ||
              '',
          );
          const callFromNumber = normalizeNumber(
            currentCall.from_number ||
              currentCall.from ||
              currentCall.fromNumber ||
              '',
          );
          const myNorm = normalizeNumber(myPhoneNumber);
          const currentView = viewRef.current; // Use ref to avoid stale closure

          // Show calling view if we're the recipient (to_number) or the caller (from_number)
          // OR if we're in connected/calling view (preserve the call)
          if (
            callToNumber === myNorm ||
            callFromNumber === myNorm ||
            currentView === 'connected' ||
            currentView === 'calling' ||
            view === 'connected' ||
            view === 'calling'
          ) {
            console.log(
              '[connectivity effect] Returning to calling view for active call',
              {
                callId: currentCall.id,
                callToNumber,
                callFromNumber,
                myNorm,
                currentView: currentView,
                viewState: view,
                viewRef: viewRef.current,
                isPartOfCall:
                  callToNumber === myNorm || callFromNumber === myNorm,
                isInCallView:
                  currentView === 'connected' || currentView === 'calling',
              },
            );
            // Always preserve the call and go to calling view if we have an active call
            setView('calling');
          } else {
            // Only clear if we're definitely not part of the call AND not in a call view
            // This should rarely happen, but if it does, log it for debugging
            console.warn(
              '[connectivity effect] ⚠️ Active call found but user not part of it and not in call view',
              {
                callId: currentCall.id,
                callToNumber,
                callFromNumber,
                myNorm,
                currentView: currentView,
                viewState: view,
              },
            );
            // Still preserve if we're transitioning - don't clear during transitions
            if (
              currentView === 'connected' ||
              currentView === 'calling' ||
              view === 'connected' ||
              view === 'calling'
            ) {
              setView('calling');
            } else {
              setCurrentCall(null);
              setView('dialer');
            }
          }
          return;
        }

        // If currentCall is ringing, check if call is for us (recipient) or from us (caller)
        if (
          currentCall &&
          String(currentCall.status || '').toLowerCase() === 'ringing'
        ) {
          const callToNumber = normalizeNumber(
            currentCall.to_number ||
              currentCall.to ||
              currentCall.toNumber ||
              '',
          );
          const callFromNumber = normalizeNumber(
            currentCall.from_number ||
              currentCall.from ||
              currentCall.fromNumber ||
              '',
          );
          const myNorm = normalizeNumber(myPhoneNumber);

          // If we're the recipient, show incoming view
          if (callToNumber === myNorm) {
            console.log(
              '[connectivity effect] Showing incoming view for currentCall',
              {
                callId: currentCall.id,
                callToNumber,
                myNorm,
              },
            );
            setView('incoming');
          } else if (callFromNumber === myNorm) {
            // If we're the caller, show calling view
            console.log(
              '[connectivity effect] Showing calling view for currentCall - we are the caller',
              {
                callId: currentCall.id,
                callFromNumber,
                callToNumber,
                myNorm,
              },
            );
            setView('calling');
          } else {
            console.log(
              '[connectivity effect] Ignoring currentCall - not for us',
              {
                callId: currentCall.id,
                callToNumber,
                callFromNumber,
                myNorm,
              },
            );
            // Clear the call if it's not for us and return to dialer
            setCurrentCall(null);
            setView('dialer');
          }
          return;
        }

        // Otherwise query the DB for any pending 'ringing' calls targeting me
        try {
          const pending = await fetchPendingRingingCallForNumber(myPhoneNumber);
          if (!mounted) return;
          if (pending) {
            setIncomingCallPayload(pending);
            setCurrentCall(pending);
            setView('incoming');
          }
        } catch (err) {
          console.warn('fetchPendingRingingCallForNumber failed', err);
        }
      } else {
        // going offline: if we're in an active call, switch to connected/playback view
        if (
          currentCall &&
          String(currentCall.status || '').toLowerCase() === 'active'
        ) {
          console.log(
            '[connectivity effect] Going offline - stopping recording and switching to connected view',
          );
          // Record the timestamp when we go offline (to find first chunk of next online session)
          lastOfflineTimestampRef.current = new Date().toISOString();
          console.log('[connectivity effect] Recorded offline timestamp', {
            timestamp: lastOfflineTimestampRef.current,
          });
          // Track state change: going to playback mode
          myStateHistoryRef.current.push({
            timestamp: lastOfflineTimestampRef.current,
            state: 'playback',
            isOnline: false,
          });
          // Don't reset chunkIndex when going offline - we'll resume from where we left off
          stopRecording(false); // false = preserve chunkIndex
          // Clear upload progress callback
          setUploadProgressCallback(null);
          // Reset chunk counter
          setUploadedChunksCount(0);
          setView('connected');
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isOnline, myPhoneNumber, currentCall]);

  // Setup done handler
  const handleSetupDone = ({ username, phoneNumber }) => {
    const normalized = normalizeNumber(phoneNumber);
    setMyUsername(username);
    setMyPhoneNumber(normalized);
    sessionStorage.setItem('myUsername', username);
    sessionStorage.setItem('myPhoneNumber', normalized);

    // move to dialer view
  };

  // Start outgoing call
  const handleStartCall = async (number, userObj) => {
    const myNorm = normalizeNumber(myPhoneNumber);
    number = normalizeNumber(number);

    console.log('[handleStartCall] Starting outgoing call', {
      myPhoneNumber: myPhoneNumber,
      myNormalized: myNorm,
      targetNumber: number,
      targetNormalized: normalizeNumber(number),
    });

    // Validate target exists and is online (copying the logic from the single-file demo)
    try {
      const targetOnline = await isUserOnline(number);
      if (!targetOnline) {
        alert('Wrong number or user is not online.');
        return;
      }
    } catch (err) {
      console.warn('User lookup error:', err);
      alert('Unable to verify destination number right now. Try again.');
      return;
    }

    // Clear any previous call ID reference before creating new call
    lastCreatedCallIdRef.current = null;

    // Create the call in the DB (do not supply an id — let DB generate UUID)
    let createdCall;
    try {
      console.log('[handleStartCall] Creating call in DB', {
        from_number: myPhoneNumber,
        to_number: number,
      });

      createdCall = await createCall({
        from_number: myPhoneNumber,
        to_number: number,
      });

      console.log('[handleStartCall] Call created successfully', {
        callId: createdCall?.id,
        createdCall,
      });

      // Set the ref IMMEDIATELY after creation to prevent race condition
      lastCreatedCallIdRef.current = createdCall?.id || null;

      console.log('[handleStartCall] Set lastCreatedCallIdRef', {
        callId: lastCreatedCallIdRef.current,
      });
    } catch (err) {
      console.warn('createCall error', err);
      alert('Failed to create call. Check console for details.');
      return;
    }

    // Use the DB-created id
    const callId = createdCall?.id;
    const call = {
      id: callId,
      from_number: myPhoneNumber,
      from_username: myUsername,
      to_number: number,
      to_username: userObj && userObj.username,
      other_number: number,
      direction: 'outgoing',
      created_at: createdCall?.created_at || Date.now(),
    };
    setCurrentCall(call);
    setView('calling');

    // Update usersInCall - add both participants
    setUsersInCall((prev) => {
      const next = new Set(prev);
      next.add(normalizeNumber(myPhoneNumber));
      next.add(normalizeNumber(number));
      return next;
    });

    // Start recording locally and uploading chunks (callId is DB-generated UUID)
    console.log('[handleStartCall] Starting recording for outgoing call', {
      callId,
      myPhoneNumber,
      view: 'calling',
    });

    // Set up upload progress callback BEFORE starting recording
    // This ensures the callback is ready when the first chunk is uploaded
    setUploadProgressCallback(
      ({ callId: uploadedCallId, path, publicUrl, error, failed }) => {
        console.log('[handleStartCall] Upload progress callback received', {
          uploadedCallId,
          expectedCallId: callId,
          path,
          publicUrl,
          error,
          failed,
          currentCount: uploadedChunksCount,
        });

        if (uploadedCallId === callId) {
          if (failed) {
            console.error('[handleStartCall] ❌ Chunk upload failed', {
              callId: uploadedCallId,
              error,
            });
            setUploadStatus({
              success: false,
              error: error || 'Upload failed',
            });
          } else {
            setUploadedChunksCount((prev) => {
              const newCount = prev + 1;
              console.log('[handleStartCall] ✅ Chunk uploaded', {
                callId: uploadedCallId,
                path,
                publicUrl,
                totalChunks: newCount,
              });
              return newCount;
            });
            setUploadStatus({ success: true });
          }
        } else {
          console.warn('[handleStartCall] ⚠️ Callback for different call ID', {
            uploadedCallId,
            expectedCallId: callId,
          });
        }
      },
    );

    // Reset chunk counter and upload status
    setUploadedChunksCount(0);
    setUploadStatus(null);

    // Track state: starting recording
    myStateHistoryRef.current.push({
      timestamp: new Date().toISOString(),
      state: 'recording',
      isOnline: isOnline,
    });

    try {
      await startRecording(callId, myPhoneNumber);
      console.log('[handleStartCall] ✅ Recording started successfully');
    } catch (err) {
      console.error('[handleStartCall] ❌ startRecording failed', err);
      alert(
        `Recording failed: ${err.message}\n\nPlease ensure:\n- You're using HTTPS (not HTTP)\n- Your browser supports MediaRecorder\n- Microphone permissions are granted`,
      );
    }

    // Listen for audio chunks from other side
    // Fetches historical chunks and subscribes to new ones from the opposite party
    console.log('[handleStartCall] Setting up audio listener', {
      callId,
      view: 'calling',
    });
    listenForAudio(
      callId,
      ({ playable, meta, isHistorical }) => {
        console.log('[handleStartCall] Audio chunk callback triggered', {
          callId,
          hasPlayable: !!playable,
          chunkId: meta?.id,
          from_number: meta?.from_number,
          isHistorical,
          currentView: view,
        });
        if (!playable) {
          console.warn('[handleStartCall] No playable URL in chunk', { meta });
          return;
        }
        // Additional safety check: skip chunks recorded by us
        if (
          normalizeNumber(meta.from_number || '') ===
          normalizeNumber(myPhoneNumber)
        ) {
          console.log('[handleStartCall] Skipping own chunk', {
            chunkFrom: meta.from_number,
            myPhoneNumber,
          });
          return;
        }
        if (playedChunkIdsRef.current.has(meta.id)) {
          console.log('[handleStartCall] Chunk already played', {
            chunkId: meta.id,
          });
          return;
        }
        // Don't mark as played yet - let playAudio do it when audio actually plays
        console.log('[handleStartCall] Calling playAudio', {
          playable,
          chunkId: meta.id,
          currentView: view,
        });
        playAudio(playable, meta.id); // Pass chunk ID so playAudio can mark it when actually playing
      },
      {
        fetchHistorical: true,
        call,
        myPhoneNumber,
      },
    );
  };

  const playAudio = (url, chunkId = null) => {
    // Use ref to get current view (avoids stale closure issues)
    const currentView = viewRef.current;
    console.log('[playAudio] 🎵 Attempting to play audio', {
      url,
      chunkId,
      currentView,
      viewState: view, // Also log state for comparison
      urlType: url?.startsWith('blob:')
        ? 'blob'
        : url?.startsWith('http')
        ? 'http'
        : 'unknown',
    });

    // Only play audio in 'connected' view (offline playback mode)
    if (currentView !== 'connected') {
      console.warn('[playAudio] ⚠️ Skipping playback - not in connected view', {
        currentView,
        viewState: view,
        requiredView: 'connected',
        chunkId,
      });
      // Don't mark as played if we're not in the right view
      return;
    }

    if (!url) {
      console.error('[playAudio] ❌ No URL provided');
      return;
    }

    try {
      // Stop previous audio if playing
      if (audioPlayerRef.current) {
        console.log('[playAudio] Stopping previous audio');
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }

      console.log('[playAudio] Creating Audio element', { url, chunkId });
      const audio = new Audio(url);

      // Mobile browsers often require explicit user interaction or audio context
      // Set volume and ensure audio is ready
      audio.volume = 1.0;
      audio.preload = 'auto';

      audioPlayerRef.current = audio;

      // Add event listeners for debugging
      audio.onloadstart = () => {
        console.log('[playAudio] ✅ Audio load started', { url });
      };
      audio.oncanplay = () => {
        console.log('[playAudio] ✅ Audio can play', {
          url,
          readyState: audio.readyState,
        });
      };
      audio.oncanplaythrough = () => {
        console.log('[playAudio] ✅ Audio can play through', { url });
      };
      audio.onerror = (e) => {
        console.error('[playAudio] ❌ Audio error', {
          url,
          error: e,
          errorCode: audio.error?.code,
          errorMessage: audio.error?.message,
        });
      };
      audio.onended = () => {
        console.log('[playAudio] ✅ Audio playback ended', { url });
        audioPlayerRef.current = null;
      };
      audio.onpause = () => {
        console.log('[playAudio] ⏸️ Audio paused', { url });
      };
      audio.onplay = () => {
        console.log('[playAudio] ▶️ Audio playing', { url, chunkId });
        // Mark chunk as played only when audio actually starts playing
        if (chunkId) {
          playedChunkIdsRef.current.add(chunkId);
          console.log('[playAudio] ✅ Marked chunk as played', { chunkId });
        }
      };

      console.log('[playAudio] Attempting to play audio...', { url, chunkId });

      // For mobile browsers, we may need to load the audio first
      audio.load();

      // Try to play with a small delay to ensure audio is ready
      const playPromise = audio.play();

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('[playAudio] ✅ Audio play() succeeded', {
              url,
              chunkId,
              duration: audio.duration,
              currentTime: audio.currentTime,
              volume: audio.volume,
            });
            // Also mark as played here as a backup (in case onplay doesn't fire)
            if (chunkId) {
              playedChunkIdsRef.current.add(chunkId);
            }
          })
          .catch((e) => {
            console.error('[playAudio] ❌ Audio play() failed', {
              url,
              chunkId,
              error: e,
              errorMessage: e.message,
              errorName: e.name,
              userAgent: navigator.userAgent,
            });

            // On mobile, autoplay might be blocked - try to play on next user interaction
            if (
              e.name === 'NotAllowedError' ||
              e.name === 'NotSupportedError'
            ) {
              console.warn(
                '[playAudio] ⚠️ Autoplay blocked - may need user interaction on mobile',
              );
              // Try to play when audio can play through
              audio.oncanplaythrough = () => {
                audio.play().catch((err) => {
                  console.error('[playAudio] ❌ Retry play also failed', err);
                });
              };
            }
            // Don't mark as played if playback failed
          });
      }
    } catch (err) {
      console.error('[playAudio] ❌ Exception creating/playing audio', {
        url,
        error: err,
        errorMessage: err.message,
        errorStack: err.stack,
      });
    }
  };

  // Accept an incoming call
  const handleAccept = async (callRow) => {
    if (!callRow) callRow = currentCall;
    if (!callRow) return;

    // Update DB status to active + accepted_at (audioService.acceptCall handles the DB update)
    try {
      await acceptCall(callRow.id);
    } catch (err) {
      console.warn('acceptCall error', err);
    }

    // Update local currentCall to reflect acceptance
    setCurrentCall((prev) => ({ ...(prev || {}), status: 'active' }));

    // Update usersInCall - ensure both participants are marked as in call
    if (callRow) {
      setUsersInCall((prev) => {
        const next = new Set(prev);
        const fromNumber = normalizeNumber(
          callRow.from_number || callRow.from || '',
        );
        const toNumber = normalizeNumber(callRow.to_number || callRow.to || '');
        next.add(fromNumber);
        next.add(toNumber);
        return next;
      });
    }

    // Choose view: if offline -> connected (playback), else calling (live)
    if (!isOnline) {
      setView('connected');
    } else {
      setView('calling');
    }

    // Only start recording if we're online (in 'calling' view, not 'connected' view)
    if (isOnline) {
      console.log('[handleAccept] Starting recording for accepted call', {
        callId: callRow.id,
        myPhoneNumber,
        isOnline,
        view: 'calling',
      });
      // Set up upload progress callback (handles both success and failure)
      setUploadProgressCallback(
        ({ callId: uploadedCallId, path, publicUrl, failed, error }) => {
          if (uploadedCallId === callRow.id) {
            if (failed) {
              console.log('[handleAccept] ❌ Chunk upload failed', {
                callId: uploadedCallId,
                path,
                error,
              });
              setUploadStatus({
                success: false,
                error: error || 'Upload failed',
              });
            } else {
              setUploadedChunksCount((prev) => prev + 1);
              setUploadStatus({ success: true });
              console.log('[handleAccept] ✅ Chunk uploaded', {
                callId: uploadedCallId,
                path,
                publicUrl,
                totalChunks: uploadedChunksCount + 1,
              });
            }
          }
        },
      );

      // Reset chunk counter and upload status
      setUploadedChunksCount(0);
      setUploadStatus(null);

      // Track state: starting recording (accepting call)
      myStateHistoryRef.current.push({
        timestamp: new Date().toISOString(),
        state: 'recording',
        isOnline: isOnline,
      });

      try {
        await startRecording(callRow.id, myPhoneNumber);
        console.log('[handleAccept] ✅ Recording started successfully');
      } catch (err) {
        console.error('[handleAccept] ❌ startRecording (accept) failed', err);
        alert(
          `Recording failed: ${err.message}\n\nPlease ensure:\n- You're using HTTPS (not HTTP)\n- Your browser supports MediaRecorder\n- Microphone permissions are granted`,
        );
      }
    } else {
      console.log(
        '[handleAccept] Skipping recording - user is offline (connected view)',
      );
    }

    // Start listening for other's audio chunks
    // Fetches historical chunks and subscribes to new ones from the opposite party
    console.log('[handleAccept] Setting up audio listener', {
      callId: callRow.id,
      view: isOnline ? 'calling' : 'connected',
      isOnline,
    });
    try {
      listenForAudio(
        callRow.id,
        ({ playable, meta, isHistorical }) => {
          console.log('[handleAccept] Audio chunk callback triggered', {
            callId: callRow.id,
            hasPlayable: !!playable,
            chunkId: meta?.id,
            from_number: meta?.from_number,
            isHistorical,
            currentView: view,
          });
          if (!playable) {
            console.warn('[handleAccept] No playable URL in chunk', { meta });
            return;
          }
          // Additional safety check: skip chunks recorded by us
          if (
            normalizeNumber(meta.from_number || '') ===
            normalizeNumber(myPhoneNumber)
          ) {
            console.log('[handleAccept] Skipping own chunk', {
              chunkFrom: meta.from_number,
              myPhoneNumber,
            });
            return;
          }
          if (playedChunkIdsRef.current.has(meta.id)) {
            console.log('[handleAccept] Chunk already played', {
              chunkId: meta.id,
            });
            return;
          }
          // Don't mark as played yet - let playAudio do it when audio actually plays
          console.log('[handleAccept] Calling playAudio', {
            playable,
            chunkId: meta.id,
            currentView: view,
          });
          playAudio(playable, meta.id); // Pass chunk ID so playAudio can mark it when actually playing
        },
        {
          fetchHistorical: true,
          call: callRow,
          myPhoneNumber,
        },
      );
    } catch (e) {
      console.warn('listenForAudio (accept) failed', e);
    }

    // Also subscribe to call updates so we get ended events even if we didn't get them via main incoming subscription
    // (optional — our incoming/subscription logic should already handle 'ended')
  };

  const handleReject = async (reason) => {
    // update call status to rejected and show end screen
    if (currentCall?.id) {
      await endCall(currentCall.id);
    }
    lastCreatedCallIdRef.current = null;
    setCurrentCall(null);
    setView('end');
  };

  const handleEnd = async () => {
    if (currentCall?.id) {
      await endCall(currentCall.id);
      // Update usersInCall - remove both participants
      setUsersInCall((prev) => {
        const next = new Set(prev);
        const fromNumber = normalizeNumber(
          currentCall.from_number || currentCall.from || '',
        );
        const toNumber = normalizeNumber(
          currentCall.to_number || currentCall.to || '',
        );
        next.delete(fromNumber);
        next.delete(toNumber);
        return next;
      });
    }
    try {
      stopRecording();
      // Clear upload progress callback
      setUploadProgressCallback(null);
      // Reset chunk counter
      setUploadedChunksCount(0);
    } catch (e) {}
    lastCreatedCallIdRef.current = null;
    setCurrentCall(null);
    setView('end');
  };

  const handleEndDone = () => {
    // Clear the call when user dismisses the end view
    setCurrentCall(null);
    setView('dialer');
  };

  // debug helper to simulate incoming call (also useful for manual testing)
  // useEffect(() => {
  //   window.__simulateIncoming = async (
  //     from = '5550001111',
  //     from_username = 'sim',
  //   ) => {
  //     // direct create in DB to simulate
  //     const id = uid();
  //     try {
  //       await createCall({
  //         callId: id,
  //         from_number: from,
  //         to_number: myPhoneNumber,
  //       });
  //     } catch (e) {
  //       console.warn('simulate incoming createCall failed', e);
  //     }
  //   };
  //   return () => delete window.__simulateIncoming;
  // }, [myPhoneNumber]);

  return (
    <PhoneContainer view={view} isOnline={view === 'calling' ? true : isOnline}>
      {' '}
      <StatusBar isOnline={isOnline} />
      {view === 'setup' && <SetupView onDone={handleSetupDone} />}
      {view === 'dialer' && (
        <DialerView
          onlineUsers={onlineUsers}
          usersInCall={usersInCall}
          userCallPartners={userCallPartners}
          onStartCall={handleStartCall}
          myUsername={myUsername}
          myPhoneNumber={myPhoneNumber}
        />
      )}
      {view === 'incoming' && currentCall && (
        <IncomingCallView
          call={currentCall}
          onAccept={handleAccept}
          onReject={handleReject}
        />
      )}
      {view === 'calling' && currentCall && (
        <CallingView
          call={currentCall}
          isOnline={isOnline}
          onEnd={handleEnd}
          audioStream={getCurrentAudioStream()}
          uploadedChunksCount={uploadedChunksCount}
          uploadStatus={uploadStatus}
          myPhoneNumber={myPhoneNumber}
          myUsername={myUsername}
        />
      )}
      {view === 'connected' && currentCall && (
        <CallConnectedView
          call={currentCall}
          onEnd={handleEnd}
          chunks={playbackChunks}
          currentPlayingChunkId={currentPlayingChunkId}
          currentChunkProgress={currentChunkProgress}
          isPlaying={isPlaying}
          playbackController={playbackController}
          myPhoneNumber={myPhoneNumber}
          callStartTime={currentCall.created_at}
          myStateHistory={myStateHistoryRef.current}
          otherStateHistory={otherStateHistoryRef.current}
        />
      )}
      {view === 'end' && <EndCallView onDone={handleEndDone} />}
    </PhoneContainer>
  );
}
