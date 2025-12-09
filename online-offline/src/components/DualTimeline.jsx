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
    ? (call?.to_username || call?.to_number || 'Other')
    : (call?.from_username || call?.from_number || 'Other');
  const myUsername = isCaller
    ? (call?.from_username || call?.from_number || 'You')
    : (call?.to_username || call?.to_number || 'You');

  // Universal timeline starts from when the call was created (caller's start)
  const universalStartTime = call?.created_at || callStartTime;
  
  // Calculate when the recipient joined (accepted the call)
  // This will be used to offset their timeline visually
  const recipientJoinTime = call?.accepted_at || call?.created_at || callStartTime;
  const recipientJoinOffset = universalStartTime && recipientJoinTime
    ? (new Date(recipientJoinTime).getTime() - new Date(universalStartTime).getTime()) / 1000
    : 0; // seconds offset from universal start

  // Calculate timeline data from chunks and state history
  // Creates continuous segments showing recording (green) vs playback (red) states
  // All times are relative to the universal start (call.created_at)
  const timelineData = useMemo(() => {
    if (!universalStartTime) return { mySegments: [], otherSegments: [] };
    
    const universalStart = new Date(universalStartTime).getTime();
    
    // Helper to convert any timestamp to universal relative time (from call creation)
    const toUniversalTime = (timestamp) => {
      const time = new Date(timestamp).getTime();
      return (time - universalStart) / 1000; // seconds from universal start
    };
    
    // Build my timeline segments from state history
    // My timeline starts at 00:00 (universal start) if I'm the caller
    // Or at my join offset if I'm the recipient
    const mySegments = [];
    let myCurrentState = 'recording'; // Default: start recording
    const myJoinOffset = isCaller ? 0 : recipientJoinOffset;
    let myLastTime = myJoinOffset; // Start at join time
    
    // Process my state history
    const sortedMyHistory = [...myStateHistory].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    sortedMyHistory.forEach((event) => {
      const eventTime = toUniversalTime(event.timestamp);
      // Add segment from last time to this event
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
    
    // Add final segment (from last event to end)
    const myChunks = chunks.filter(
      (c) => normalize(c.from_number || '') === myNorm
    );
    const myLastChunkTime = myChunks.length > 0 && myChunks[myChunks.length - 1].created_at
      ? toUniversalTime(myChunks[myChunks.length - 1].created_at) + 5 // Add 5s for chunk duration
      : myLastTime + 10;
    if (myLastTime < myLastChunkTime) {
      mySegments.push({
        startTime: myLastTime,
        endTime: myLastChunkTime,
        state: myCurrentState,
      });
    }
    
    // Build other user's timeline from their chunks
    // When they upload a chunk, they were recording (green)
    // Between chunks, infer they might be in playback (red) if we're offline
    const otherSegments = [];
    const otherChunks = chunks
      .filter((c) => normalize(c.from_number || '') !== myNorm)
      .sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeA - timeB;
      });
    
    // Other user's join offset (opposite of mine)
    const otherJoinOffset = isCaller ? recipientJoinOffset : 0;
    
    if (otherChunks.length > 0) {
      let otherLastTime = otherJoinOffset; // Start at their join time
      otherChunks.forEach((chunk, idx) => {
        const chunkTime = chunk.created_at ? toUniversalTime(chunk.created_at) : otherLastTime;
        const chunkEndTime = chunkTime + 5; // Each chunk is ~5 seconds
        
        // Add gap segment (playback) if there's a gap
        if (chunkTime > otherLastTime && idx > 0) {
          otherSegments.push({
            startTime: otherLastTime,
            endTime: chunkTime,
            state: 'playback', // Infer playback between chunks
          });
        }
        
        // Add recording segment for this chunk
        otherSegments.push({
          startTime: chunkTime,
          endTime: chunkEndTime,
          state: 'recording',
        });
        
        otherLastTime = chunkEndTime;
      });
      
      // Add final segment if needed
      const totalDuration = Math.max(
        ...otherChunks.map((c) => 
          c.created_at ? toUniversalTime(c.created_at) + 5 : 0
        )
      );
      if (otherLastTime < totalDuration) {
        otherSegments.push({
          startTime: otherLastTime,
          endTime: totalDuration,
          state: 'playback',
        });
      }
    } else if (otherJoinOffset > 0) {
      // If recipient hasn't joined yet (no chunks), show empty timeline starting at join offset
      // This will be handled by the visual rendering
    }
    
    return { mySegments, otherSegments, myJoinOffset, otherJoinOffset };
  }, [chunks, universalStartTime, recipientJoinOffset, isCaller, myStateHistory, otherStateHistory, myNorm]);

  // Calculate total duration
  // Use the maximum of both timelines to show the full duration
  const totalDuration = useMemo(() => {
    if (!universalStartTime) return 60; // Default 60 seconds
    const allSegments = [...timelineData.mySegments, ...timelineData.otherSegments];
    if (allSegments.length === 0) return 60;
    const maxEnd = Math.max(...allSegments.map((s) => s.endTime));
    return Math.max(60, maxEnd + 5); // Add 5s buffer
  }, [timelineData, universalStartTime]);

  // Time scale: 1 second = 10 pixels
  const pixelsPerSecond = 10;
  const timelineWidth = totalDuration * pixelsPerSecond;

  // Auto-scroll to keep timeline in view (scroll to end)
  useEffect(() => {
    if (timelineRef.current && totalDuration > 0) {
      // Scroll to show the latest part of the timeline
      const scrollTo = timelineWidth - timelineRef.current.clientWidth + 20; // 20px padding
      timelineRef.current.scrollTo({
        left: Math.max(0, scrollTo),
        behavior: 'smooth',
      });
    }
  }, [timelineWidth, totalDuration]);

  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Generate time markers every 10 seconds
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
      }}
    >
      <div
        style={{
          fontSize: '14px',
          fontWeight: '600',
          marginBottom: '16px',
          textAlign: 'center',
          color: '#fff',
        }}
      >
        Call Timeline - Recording vs Playback
      </div>

      {/* Timeline Container */}
      <div
        ref={timelineRef}
        style={{
          position: 'relative',
          width: '100%',
          overflowX: 'auto',
          overflowY: 'hidden',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '4px',
          padding: '12px 0',
          minHeight: '120px',
        }}
      >
        {/* Timeline Content */}
        <div
          style={{
            position: 'relative',
            width: `${Math.max(timelineWidth, 600)}px`,
            minHeight: '100px',
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
              top: '20px',
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
              {/* Show join indicator if I'm the recipient and joined after call start */}
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
                      left: `${timelineData.myJoinOffset * pixelsPerSecond + 4}px`,
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
                      borderRadius: idx === 0 ? '10px 0 0 10px' : idx === timelineData.mySegments.length - 1 ? '0 10px 10px 0' : '0',
                    }}
                    title={`${isRecording ? 'Recording' : 'Playback'} - ${formatTime(segment.startTime)} to ${formatTime(segment.endTime)}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Other User Timeline Line */}
          <div
            style={{
              position: 'absolute',
              top: '70px',
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
              {/* Show join indicator if other user is the recipient and joined after call start */}
              {timelineData.otherJoinOffset > 0 && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: `${timelineData.otherJoinOffset * pixelsPerSecond}px`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      backgroundColor: '#FFD700',
                      zIndex: 5,
                      boxShadow: '0 0 4px rgba(255, 215, 0, 0.8)',
                    }}
                    title={`${otherUsername} joined at ${formatTime(timelineData.otherJoinOffset)}`}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: `${timelineData.otherJoinOffset * pixelsPerSecond + 4}px`,
                      top: '-18px',
                      fontSize: '9px',
                      color: '#FFD700',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                      zIndex: 6,
                    }}
                  >
                    {otherUsername} joined {formatTime(timelineData.otherJoinOffset)}
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
                      borderRadius: idx === 0 ? '10px 0 0 10px' : idx === timelineData.otherSegments.length - 1 ? '0 10px 10px 0' : '0',
                    }}
                    title={`${isRecording ? 'Recording' : 'Playback'} - ${formatTime(segment.startTime)} to ${formatTime(segment.endTime)}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              right: '10px',
              display: 'flex',
              gap: '16px',
              fontSize: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  backgroundColor: '#34c759',
                  borderRadius: '2px',
                }}
              />
              <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                Recording
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  backgroundColor: '#ff3b30',
                  borderRadius: '2px',
                }}
              />
              <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                Playback
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

