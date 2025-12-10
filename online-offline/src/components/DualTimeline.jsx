// src/components/DualTimeline.jsx
import { useMemo, useRef, useEffect } from 'preact/hooks';
import { normalizePhoneNumber } from '../services/audioService.js';

export default function DualTimeline({
  call,
  chunks = [],
  myPhoneNumber = '',
  callStartTime = null, // When the call started (for caller) - deprecated, use call.created_at
  myStateHistory = [], // Array of {timestamp, state: 'recording'|'playback', isOnline}
  otherStateHistory = [], // Array of {timestamp, state: 'recording'|'playback'}
}) {
  const timelineRef = useRef(null);
  const normalize = normalizePhoneNumber;
  const myNorm = normalize(myPhoneNumber);
  const fromNorm = normalize(call?.from_number || '');
  const toNorm = normalize(call?.to_number || '');

  // Determine which user is which
  const isCaller = fromNorm === myNorm;
  const otherPhoneNumber = isCaller ? toNorm : fromNorm;
  const otherUsername = isCaller
    ? call?.to_username || call?.to_number || 'Other'
    : call?.from_username || call?.from_number || 'Other';
  const myUsername = isCaller
    ? call?.from_username || call?.from_number || 'You'
    : call?.to_username || call?.to_number || 'You';

  // Universal timeline starts from when the call was created (caller's start)
  const universalStartTime = call?.created_at || callStartTime;

  // Calculate when the recipient joined (accepted the call)
  const recipientJoinTime =
    call?.accepted_at || call?.created_at || callStartTime;
  const recipientJoinOffset =
    universalStartTime && recipientJoinTime
      ? (new Date(recipientJoinTime).getTime() -
          new Date(universalStartTime).getTime()) /
        1000
      : 0;

  // Calculate timeline data from chunks and state history
  const timelineData = useMemo(() => {
    console.log('[DualTimeline] Computing timeline data', {
      universalStartTime,
      myStateHistoryLength: myStateHistory?.length || 0,
      otherStateHistoryLength: otherStateHistory?.length || 0,
      chunksLength: chunks?.length || 0,
      myStateHistory,
      otherStateHistory,
    });

    if (!universalStartTime) return { mySegments: [], otherSegments: [] };

    const universalStart = new Date(universalStartTime).getTime();

    const toUniversalTime = (timestamp) => {
      const time = new Date(timestamp).getTime();
      return (time - universalStart) / 1000;
    };

    // Build my timeline segments from state history
    const mySegments = [];
    let myCurrentState = 'recording';
    const myJoinOffset = isCaller ? 0 : recipientJoinOffset;
    let myLastTime = myJoinOffset;

    const sortedMyHistory = [...myStateHistory].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    sortedMyHistory.forEach((event) => {
      const eventTime = toUniversalTime(event.timestamp);
      if (eventTime > myLastTime) {
        mySegments.push({
          startTime: myLastTime,
          endTime: eventTime,
          state: myCurrentState,
        });
      }
      myCurrentState = event.state;
      myLastTime = eventTime;
    });

    // Add final segment
    const myChunks = chunks.filter(
      (c) => normalize(c.from_number || '') === myNorm,
    );
    const myLastChunkTime =
      myChunks.length > 0 && myChunks[myChunks.length - 1].created_at
        ? toUniversalTime(myChunks[myChunks.length - 1].created_at) + 20
        : myLastTime + 10;
    if (myLastTime < myLastChunkTime) {
      mySegments.push({
        startTime: myLastTime,
        endTime: myLastChunkTime,
        state: myCurrentState,
      });
    }

    // Build other user's timeline from state history (from database)
    // If no state history available, fall back to inferring from chunks
    const otherSegments = [];
    const otherJoinOffset = isCaller ? recipientJoinOffset : 0;
    const RECORDING_DURATION = 20; // Each recording is ~20 seconds

    console.log('[DualTimeline] Building other user timeline', {
      hasOtherStateHistory: otherStateHistory && otherStateHistory.length > 0,
      otherStateHistoryLength: otherStateHistory?.length || 0,
      otherJoinOffset,
      isCaller,
    });

    // Check if we have state history from the database
    if (otherStateHistory && otherStateHistory.length > 0) {
      // Use actual state history from database
      console.log(
        '[DualTimeline] Using state history from database for other user',
      );
      let otherCurrentState = 'recording'; // Default: start recording
      let otherLastTime = otherJoinOffset;

      const sortedOtherHistory = [...otherStateHistory].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      sortedOtherHistory.forEach((event) => {
        const eventTime = toUniversalTime(event.timestamp);
        // Add segment from last time to this event
        if (eventTime > otherLastTime) {
          otherSegments.push({
            startTime: otherLastTime,
            endTime: eventTime,
            state: otherCurrentState,
          });
        }
        otherCurrentState = event.state;
        otherLastTime = eventTime;
      });

      // Add final segment (from last event to now or last chunk time)
      const otherChunks = chunks.filter(
        (c) => normalize(c.from_number || '') !== myNorm,
      );
      const otherLastChunkTime =
        otherChunks.length > 0 && otherChunks[otherChunks.length - 1].created_at
          ? toUniversalTime(otherChunks[otherChunks.length - 1].created_at) +
            RECORDING_DURATION
          : otherLastTime + 10;
      if (otherLastTime < otherLastChunkTime) {
        otherSegments.push({
          startTime: otherLastTime,
          endTime: otherLastChunkTime,
          state: otherCurrentState,
        });
      }
    } else {
      // Fallback: Infer offline periods from gaps between chunks
      const otherChunks = chunks
        .filter((c) => normalize(c.from_number || '') !== myNorm)
        .sort((a, b) => {
          const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return timeA - timeB;
        });

      const GAP_THRESHOLD = 25; // If gap > 25s, likely was offline

      if (otherChunks.length > 0) {
        let otherLastTime = otherJoinOffset;

        otherChunks.forEach((chunk, idx) => {
          const chunkTime = chunk.created_at
            ? toUniversalTime(chunk.created_at)
            : otherLastTime;
          const chunkEndTime = chunkTime + RECORDING_DURATION;

          // Check for gap (offline period)
          if (idx > 0 && chunkTime > otherLastTime) {
            const gap = chunkTime - otherLastTime;
            if (gap > GAP_THRESHOLD) {
              // Large gap = they were offline (playback mode)
              otherSegments.push({
                startTime: otherLastTime,
                endTime: chunkTime,
                state: 'playback',
              });
            }
          }

          // Add recording segment for this chunk
          otherSegments.push({
            startTime: Math.max(chunkTime, otherLastTime),
            endTime: chunkEndTime,
            state: 'recording',
          });

          otherLastTime = chunkEndTime;
        });
      }
    }

    return { mySegments, otherSegments, myJoinOffset, otherJoinOffset };
  }, [
    chunks,
    universalStartTime,
    recipientJoinOffset,
    isCaller,
    myStateHistory,
    otherStateHistory,
    myNorm,
  ]);

  // Calculate total duration
  const totalDuration = useMemo(() => {
    if (!universalStartTime) return 60;
    const allSegments = [
      ...timelineData.mySegments,
      ...timelineData.otherSegments,
    ];
    if (allSegments.length === 0) return 60;
    const maxEnd = Math.max(...allSegments.map((s) => s.endTime));
    return Math.max(60, maxEnd + 5);
  }, [timelineData, universalStartTime]);

  const pixelsPerSecond = 10;
  const timelineWidth = totalDuration * pixelsPerSecond;

  // Auto-scroll to end
  useEffect(() => {
    if (timelineRef.current && totalDuration > 0) {
      const scrollTo = timelineWidth - timelineRef.current.clientWidth + 20;
      timelineRef.current.scrollTo({
        left: Math.max(0, scrollTo),
        behavior: 'smooth',
      });
    }
  }, [timelineWidth, totalDuration]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const timeMarkers = useMemo(() => {
    const markers = [];
    for (let i = 0; i <= totalDuration; i += 10) {
      markers.push(i);
    }
    return markers;
  }, [totalDuration]);

  return (
    <div
      style={{
        width: '95%',
        margin: '20px auto',
        padding: '16px',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        borderRadius: '8px',
        position: 'relative', // For absolute positioned legend
      }}
    >
      <div
        style={{
          fontSize: '14px',
          fontWeight: '600',
          textAlign: 'center',
          color: '#fff',
          marginBottom: '8px',
        }}
      >
        Call Timeline
      </div>

      {/* Fixed Legend - stays visible when scrolling */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          right: '16px',
          display: 'flex',
          gap: '12px',
          fontSize: '10px',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          padding: '6px 10px',
          borderRadius: '4px',
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div
            style={{
              width: '12px',
              height: '12px',
              backgroundColor: '#34c759',
              borderRadius: '2px',
            }}
          />
          <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>Recording</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div
            style={{
              width: '12px',
              height: '12px',
              backgroundColor: '#ff3b30',
              borderRadius: '2px',
            }}
          />
          <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>Playback</span>
        </div>
      </div>

      {/* Timeline Container */}
      <div
        ref={timelineRef}
        style={{
          position: 'relative',
          width: '100%',
          overflowX: 'auto',
          overflowY: 'visible',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '4px',
          padding: '30px 0 12px 0',
          minHeight: '120px',
        }}
      >
        {/* Timeline Content */}
        <div
          style={{
            position: 'relative',
            width: `${Math.max(timelineWidth, 600)}px`,
            minHeight: '140px',
          }}
        >
          {/* Time Markers */}
          {timeMarkers.map((seconds) => {
            const x = seconds * pixelsPerSecond;
            return (
              <div
                key={seconds}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: 0,
                  bottom: 0,
                  width: '1px',
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '-20px',
                    left: '-15px',
                    fontSize: '10px',
                    color: 'rgba(255, 255, 255, 0.6)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatTime(seconds)}
                </div>
              </div>
            );
          })}

          {/* My Timeline Line */}
          <div
            style={{
              position: 'absolute',
              top: '50px',
              left: 0,
              right: 0,
              height: '30px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.8)',
                marginBottom: '4px',
                fontWeight: '500',
              }}
            >
              {myUsername} (You)
            </div>
            <div
              style={{
                position: 'relative',
                height: '20px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                overflow: 'hidden',
              }}
            >
              {timelineData.myJoinOffset > 0 && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: `${timelineData.myJoinOffset * pixelsPerSecond}px`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      backgroundColor: '#FFD700',
                      zIndex: 5,
                      boxShadow: '0 0 4px rgba(255, 215, 0, 0.8)',
                    }}
                    title={`Joined at ${formatTime(timelineData.myJoinOffset)}`}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: `${
                        timelineData.myJoinOffset * pixelsPerSecond + 4
                      }px`,
                      top: '-18px',
                      fontSize: '9px',
                      color: '#FFD700',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                      zIndex: 6,
                    }}
                  >
                    Joined {formatTime(timelineData.myJoinOffset)}
                  </div>
                </>
              )}
              {timelineData.mySegments.map((segment, idx) => {
                const startX = segment.startTime * pixelsPerSecond;
                const endX = segment.endTime * pixelsPerSecond;
                const width = endX - startX;
                const isRecording = segment.state === 'recording';

                return (
                  <div
                    key={`my-${idx}`}
                    style={{
                      position: 'absolute',
                      left: `${startX}px`,
                      width: `${width}px`,
                      height: '100%',
                      backgroundColor: isRecording ? '#34c759' : '#ff3b30',
                      borderRadius:
                        idx === 0
                          ? '10px 0 0 10px'
                          : idx === timelineData.mySegments.length - 1
                          ? '0 10px 10px 0'
                          : '0',
                    }}
                    title={`${
                      isRecording ? 'Recording' : 'Playback'
                    } - ${formatTime(segment.startTime)} to ${formatTime(
                      segment.endTime,
                    )}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Other User Timeline Line */}
          <div
            style={{
              position: 'absolute',
              top: '100px',
              left: 0,
              right: 0,
              height: '30px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.8)',
                marginBottom: '4px',
                fontWeight: '500',
              }}
            >
              {otherUsername}
            </div>
            <div
              style={{
                position: 'relative',
                height: '20px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                overflow: 'hidden',
              }}
            >
              {timelineData.otherJoinOffset > 0 && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: `${
                        timelineData.otherJoinOffset * pixelsPerSecond
                      }px`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      backgroundColor: '#FFD700',
                      zIndex: 5,
                      boxShadow: '0 0 4px rgba(255, 215, 0, 0.8)',
                    }}
                    title={`${otherUsername} joined at ${formatTime(
                      timelineData.otherJoinOffset,
                    )}`}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: `${
                        timelineData.otherJoinOffset * pixelsPerSecond + 4
                      }px`,
                      top: '-18px',
                      fontSize: '9px',
                      color: '#FFD700',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                      zIndex: 6,
                    }}
                  >
                    {otherUsername} joined{' '}
                    {formatTime(timelineData.otherJoinOffset)}
                  </div>
                </>
              )}
              {timelineData.otherSegments.map((segment, idx) => {
                const startX = segment.startTime * pixelsPerSecond;
                const endX = segment.endTime * pixelsPerSecond;
                const width = endX - startX;
                const isRecording = segment.state === 'recording';

                return (
                  <div
                    key={`other-${idx}`}
                    style={{
                      position: 'absolute',
                      left: `${startX}px`,
                      width: `${width}px`,
                      height: '100%',
                      backgroundColor: isRecording ? '#34c759' : '#ff3b30',
                      borderRadius:
                        idx === 0
                          ? '10px 0 0 10px'
                          : idx === timelineData.otherSegments.length - 1
                          ? '0 10px 10px 0'
                          : '0',
                    }}
                    title={`${
                      isRecording ? 'Recording' : 'Playback'
                    } - ${formatTime(segment.startTime)} to ${formatTime(
                      segment.endTime,
                    )}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
