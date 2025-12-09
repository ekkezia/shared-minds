// src/views/CallConnectedView.jsx
import { useMemo, useState, useRef, useEffect } from 'preact/hooks';
import DualTimeline from '../components/DualTimeline.jsx';

export default function CallConnectedView({
  call,
  onEnd,
  chunks = [],
  currentPlayingChunkId = null,
  currentChunkProgress = 0,
  isPlaying = false,
  playbackController = null,
  myPhoneNumber = '',
  callStartTime = null,
  myStateHistory = [],
  otherStateHistory = [],
}) {
  const timelineRef = useRef(null);

  // Filter chunks to only show other party's chunks for the scrubber
  // (DualTimeline needs all chunks, but scrubber should only show playable chunks)
  const normalize = (s) => String(s || '').replace(/\D/g, '');
  const myNorm = normalize(myPhoneNumber);
  const playbackChunks = useMemo(() => {
    return chunks.filter((chunk) => {
      return normalize(chunk.from_number || '') !== myNorm;
    });
  }, [chunks, myPhoneNumber, myNorm]);

  // Auto-scroll to keep the currently playing chunk visible
  // Only scroll when the chunk ID changes, not on every progress update
  useEffect(() => {
    if (
      !timelineRef.current ||
      !currentPlayingChunkId ||
      playbackChunks.length === 0
    ) {
      return;
    }

    const timeline = timelineRef.current;
    const currentIndex = playbackChunks.findIndex(
      (c) => c.id === currentPlayingChunkId,
    );

    if (currentIndex === -1) return;

    // Calculate the position of the current chunk
    const chunkLeft = currentIndex * 80; // Each chunk is 80px wide
    const chunkRight = chunkLeft + 80;
    const scrollLeft = timeline.scrollLeft;
    const scrollRight = scrollLeft + timeline.clientWidth;

    // Only scroll if the chunk is significantly outside the visible area
    // Add a buffer zone (20px) to prevent constant micro-adjustments
    const buffer = 20;
    const needsScroll =
      chunkLeft < scrollLeft - buffer || chunkRight > scrollRight + buffer;

    if (needsScroll) {
      // Calculate the ideal scroll position to center the chunk (with some padding)
      const idealScroll = chunkLeft - timeline.clientWidth / 2 + 40; // Center the chunk
      const maxScroll = timeline.scrollWidth - timeline.clientWidth;
      const targetScroll = Math.max(0, Math.min(idealScroll, maxScroll));

      // Smooth scroll to the target position
      timeline.scrollTo({
        left: targetScroll,
        behavior: 'smooth',
      });
    }
  }, [currentPlayingChunkId, playbackChunks]); // Use playbackChunks instead of chunks
  // Calculate total duration (each chunk is ~5 seconds)
  const totalDuration = playbackChunks.length * 5;
  const chunkWidthPercent =
    playbackChunks.length > 0 ? 100 / playbackChunks.length : 0;

  // Calculate scrubber position (in pixels, not percentage)
  const scrubberPosition = useMemo(() => {
    if (!currentPlayingChunkId || playbackChunks.length === 0) return 0;

    const currentIndex = playbackChunks.findIndex(
      (c) => c.id === currentPlayingChunkId,
    );
    if (currentIndex === -1) return 0;

    // Position = (chunk index * 80px) + (progress within chunk * 80px)
    const basePosition = currentIndex * 80;
    const progressOffset = currentChunkProgress * 80;
    return basePosition + progressOffset;
  }, [currentPlayingChunkId, currentChunkProgress, playbackChunks]);

  return (
    <div class='screen dialer-screen'>
      <div class='caller-info'>
        <div class='caller-name'>Call Connected (Offline Playback)</div>
        <div class='caller-number'>{call.other_number}</div>
        <div class='call-status'>
          {chunks.length > 0
            ? `Playing ${chunks.length} audio chunks...`
            : 'Loading audio chunks...'}
        </div>
      </div>

      {/* Dual Timeline Visualization */}
      {callStartTime && chunks.length > 0 && (
        <DualTimeline
          call={call}
          chunks={chunks}
          myPhoneNumber={myPhoneNumber}
          callStartTime={callStartTime}
          myStateHistory={myStateHistory}
          otherStateHistory={otherStateHistory}
        />
      )}

      {/* Visual Timeline - Only show if we have chunks to play back */}
      {playbackChunks.length > 0 && (
        <div
          style={{
            width: '90%',
            margin: '20px auto',
            padding: '12px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '8px',
            position: 'relative',
          }}
        >
          {/* Timeline Container */}
          <div
            ref={timelineRef}
            class='chunk-timeline-scrollable'
            style={{
              position: 'relative',
              width: '100%',
              height: '60px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollBehavior: 'smooth',
              cursor: 'pointer',
              // Custom scrollbar styling
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255, 255, 255, 0.3) rgba(0, 0, 0, 0.1)',
              // Ensure scrolling works on mobile
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-x',
            }}
            onClick={(e) => {
              if (!playbackController || !timelineRef.current) return;
              const rect = timelineRef.current.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const scrollX = timelineRef.current.scrollLeft;
              const totalX = clickX + scrollX;

              // Calculate which chunk was clicked
              const chunkIndex = Math.floor(totalX / 80);
              const progressInChunk = Math.max(
                0,
                Math.min(1, (totalX % 80) / 80),
              );

              if (chunkIndex >= 0 && chunkIndex < playbackChunks.length) {
                console.log('[CallConnectedView] Seeking to chunk', {
                  chunkIndex,
                  progressInChunk,
                  chunkId: playbackChunks[chunkIndex].id,
                  wasPlaying: isPlaying,
                });
                const wasPlaying = isPlaying;
                playbackController.seek(chunkIndex, progressInChunk);
                // Resume playback if it was playing
                if (wasPlaying) {
                  setTimeout(() => {
                    playbackController.play();
                  }, 100);
                }
              }
            }}
          >
            {/* Chunk Blocks */}
            <div
              style={{
                position: 'relative',
                width: `${Math.max(playbackChunks.length * 80, 100)}px`, // Fixed width per chunk (80px each), minimum 100px
                height: '100%',
                minWidth: '100%',
                // Ensure content is wider than container when there are many chunks
                display: 'inline-block',
              }}
            >
              {playbackChunks.map((chunk, index) => {
                const isPlaying = chunk.id === currentPlayingChunkId;
                const currentIndex = currentPlayingChunkId
                  ? playbackChunks.findIndex(
                      (c) => c.id === currentPlayingChunkId,
                    )
                  : -1;
                const isPlayed = currentIndex > index;

                return (
                  <div
                    key={chunk.id || index}
                    style={{
                      position: 'absolute',
                      left: `${index * 80}px`, // Fixed 80px per chunk
                      width: '75px', // Fixed width
                      height: '100%',
                      backgroundColor: isPlaying
                        ? '#34c759'
                        : isPlayed
                        ? '#007AFF'
                        : 'rgba(255, 255, 255, 0.2)',
                      border: isPlaying
                        ? '2px solid #fff'
                        : '1px solid rgba(255, 255, 255, 0.3)',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      color: '#fff',
                      fontWeight: isPlaying ? 'bold' : 'normal',
                      transition: 'background-color 0.2s',
                      boxSizing: 'border-box',
                      marginRight: '5px',
                    }}
                    title={`Chunk ${index + 1}/${playbackChunks.length}${
                      isPlaying ? ' (Playing)' : ''
                    } - ${chunk.id || 'no-id'}`}
                  >
                    {index + 1}
                  </div>
                );
              })}
            </div>

            {/* Scrubber Line */}
            <div
              style={{
                position: 'absolute',
                left: `${scrubberPosition}px`,
                top: 0,
                bottom: 0,
                width: '2px',
                backgroundColor: '#fff',
                boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            />

            {/* Progress indicator for current chunk */}
            {currentPlayingChunkId &&
              (() => {
                const currentIndex = playbackChunks.findIndex(
                  (c) => c.id === currentPlayingChunkId,
                );
                if (currentIndex === -1) return null;
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${currentIndex * 80}px`,
                      width: `${80 * currentChunkProgress}px`,
                      height: '100%',
                      backgroundColor: 'rgba(255, 255, 255, 0.4)',
                      zIndex: 5,
                      pointerEvents: 'none',
                    }}
                  />
                );
              })()}
          </div>

          {/* Info Text */}
          <div
            style={{
              marginTop: '8px',
              fontSize: '12px',
              color: 'rgba(255, 255, 255, 0.7)',
              textAlign: 'center',
            }}
          >
            {currentPlayingChunkId
              ? `Playing chunk ${
                  playbackChunks.findIndex(
                    (c) => c.id === currentPlayingChunkId,
                  ) + 1
                } of ${playbackChunks.length} (${Math.round(
                  currentChunkProgress * 100,
                )}%)`
              : playbackChunks.length > 0
              ? `Ready to play ${playbackChunks.length} chunks`
              : 'No chunks available'}
          </div>
        </div>
      )}

      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '20px',
          marginTop: 18,
        }}
      >
        {/* Play/Pause Button */}
        {playbackController && (
          <button
            class='call-action-btn'
            onClick={() => {
              if (isPlaying) {
                playbackController.pause();
              } else {
                playbackController.play();
              }
            }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: isPlaying ? '#FF9500' : '#34c759',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {isPlaying ? (
              // Pause icon
              <svg
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                stroke='white'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <rect x='6' y='4' width='4' height='16' />
                <rect x='14' y='4' width='4' height='16' />
              </svg>
            ) : (
              // Play icon
              <svg
                version='1.1'
                xmlns='http://www.w3.org/2000/svg'
                xmlnsXlink='http://www.w3.org/1999/xlink'
                x='0px'
                y='0px'
                width='24'
                height='24'
                viewBox='0 0 330 330'
                style={{ enableBackground: 'new 0 0 330 330' }}
                xmlSpace='preserve'
              >
                <path
                  d='M37.728,328.12c2.266,1.256,4.77,1.88,7.272,1.88c2.763,0,5.522-0.763,7.95-2.28l240-149.999
	c4.386-2.741,7.05-7.548,7.05-12.72c0-5.172-2.664-9.979-7.05-12.72L52.95,2.28c-4.625-2.891-10.453-3.043-15.222-0.4
	C32.959,4.524,30,9.547,30,15v300C30,320.453,32.959,325.476,37.728,328.12z'
                  fill='white'
                />
              </svg>
            )}
          </button>
        )}

        {/* End Call Button */}
        <button
          class='call-action-btn end-btn'
          onClick={onEnd}
          aria-label='End playback'
        >
          <svg
            width='24px'
            height='24px'
            viewBox='0 0 24 24'
            id='end_call'
            data-name='end call'
            xmlns='http://www.w3.org/2000/svg'
            aria-hidden='true'
          >
            <rect id='placer' width='24' height='24' fill='none' />
            <g id='Group' transform='translate(2 8)'>
              <path
                id='Shape'
                d='M7.02,15.976,5.746,13.381a.7.7,0,0,0-.579-.407l-1.032-.056a.662.662,0,0,1-.579-.437,9.327,9.327,0,0,1,0-6.5.662.662,0,0,1,.579-.437l1.032-.109a.7.7,0,0,0,.589-.394L7.03,2.446l.331-.662a.708.708,0,0,0,.07-.308.692.692,0,0,0-.179-.467A3,3,0,0,0,4.693.017l-.235.03L4.336.063A1.556,1.556,0,0,0,4.17.089l-.162.04C1.857.679.165,4.207,0,8.585V9.83c.165,4.372,1.857,7.9,4,8.483l.162.04a1.556,1.556,0,0,0,.165.026l.122.017.235.03a3,3,0,0,0,2.558-.993.692.692,0,0,0,.179-.467.708.708,0,0,0-.07-.308Z'
                transform='translate(18.936 0.506) rotate(90)'
                fill='white'
                stroke='white'
                strokeMiterlimit='10'
                strokeWidth='1.5'
              />
            </g>
          </svg>
        </button>
      </div>
    </div>
  );
}
