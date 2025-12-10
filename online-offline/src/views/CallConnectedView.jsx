// src/views/CallConnectedView.jsx
import { useMemo, useState, useRef, useEffect } from 'preact/hooks';
import DualTimeline from '../components/DualTimeline.jsx';

// Number of bars per chunk
const BARS_PER_CHUNK = 8;

// Generate random but consistent bar heights for a chunk
function generateBarHeights(chunkId, count = BARS_PER_CHUNK) {
  // Use chunk ID as seed for consistent heights
  const seed = chunkId
    ? chunkId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    : Math.random() * 1000;

  const heights = [];
  for (let i = 0; i < count; i++) {
    // Generate pseudo-random heights between 20% and 100%
    const h = 20 + ((seed * (i + 1) * 7) % 80);
    heights.push(h);
  }
  return heights;
}

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
  const normalize = (s) => String(s || '').replace(/\D/g, '');
  const myNorm = normalize(myPhoneNumber);
  const playbackChunks = useMemo(() => {
    return chunks.filter((chunk) => {
      return normalize(chunk.from_number || '') !== myNorm;
    });
  }, [chunks, myPhoneNumber, myNorm]);

  // Generate bar heights for each chunk (memoized for consistency)
  const chunkBarHeights = useMemo(() => {
    return playbackChunks.map((chunk) =>
      generateBarHeights(chunk.id || String(Math.random())),
    );
  }, [playbackChunks]);

  // Width per chunk (bars + spacing)
  const CHUNK_WIDTH = 60; // px per chunk
  const BAR_WIDTH = 4;
  const BAR_GAP = 2;

  // Auto-scroll to keep the currently playing chunk visible
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

    const chunkLeft = currentIndex * CHUNK_WIDTH;
    const chunkRight = chunkLeft + CHUNK_WIDTH;
    const scrollLeft = timeline.scrollLeft;
    const scrollRight = scrollLeft + timeline.clientWidth;

    const buffer = 20;
    const needsScroll =
      chunkLeft < scrollLeft - buffer || chunkRight > scrollRight + buffer;

    if (needsScroll) {
      const idealScroll =
        chunkLeft - timeline.clientWidth / 2 + CHUNK_WIDTH / 2;
      const maxScroll = timeline.scrollWidth - timeline.clientWidth;
      const targetScroll = Math.max(0, Math.min(idealScroll, maxScroll));

      timeline.scrollTo({
        left: targetScroll,
        behavior: 'smooth',
      });
    }
  }, [currentPlayingChunkId, playbackChunks]);

  // Calculate scrubber position
  const scrubberPosition = useMemo(() => {
    if (!currentPlayingChunkId || playbackChunks.length === 0) return 0;

    const currentIndex = playbackChunks.findIndex(
      (c) => c.id === currentPlayingChunkId,
    );
    if (currentIndex === -1) return 0;

    const basePosition = currentIndex * CHUNK_WIDTH;
    const progressOffset = currentChunkProgress * CHUNK_WIDTH;
    return basePosition + progressOffset;
  }, [currentPlayingChunkId, currentChunkProgress, playbackChunks]);

  return (
    <div class='screen dialer-screen'>
      <div class='caller-info'>
        <div class='caller-name'>Call Connected (Offline Playback)</div>
        <div class='caller-number'>{call.other_number}</div>
        <div class='call-status'>
          {chunks.length > 0
            ? `Playing ${playbackChunks.length} audio chunks...`
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

      {/* Audio Bar Scrubber - Only show if we have chunks to play back */}
      {playbackChunks.length > 0 && (
        <div
          style={{
            width: '95%',
            margin: '20px auto',
            padding: '12px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '8px',
            position: 'relative',
          }}
        >
          {/* Scrollable Timeline Container */}
          <div
            ref={timelineRef}
            style={{
              position: 'relative',
              width: '100%',
              height: '80px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '4px',
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollBehavior: 'smooth',
              cursor: 'pointer',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255, 255, 255, 0.3) rgba(0, 0, 0, 0.1)',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-x',
            }}
            onClick={(e) => {
              if (!playbackController || !timelineRef.current) return;
              const rect = timelineRef.current.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const scrollX = timelineRef.current.scrollLeft;
              const totalX = clickX + scrollX;

              const chunkIndex = Math.floor(totalX / CHUNK_WIDTH);

              if (chunkIndex >= 0 && chunkIndex < playbackChunks.length) {
                console.log('[CallConnectedView] Clicked chunk', {
                  chunkIndex,
                  displayNumber: chunkIndex + 1,
                  chunkId: playbackChunks[chunkIndex].id,
                });

                playbackController.seek(chunkIndex, 0);
                setTimeout(() => {
                  playbackController.play();
                }, 150);
              }
            }}
          >
            {/* Chunks as Audio Bars */}
            <div
              style={{
                position: 'relative',
                width: `${Math.max(
                  playbackChunks.length * CHUNK_WIDTH,
                  100,
                )}px`,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {playbackChunks.map((chunk, chunkIndex) => {
                const isPlayingChunk = chunk.id === currentPlayingChunkId;
                const currentIdx = currentPlayingChunkId
                  ? playbackChunks.findIndex(
                      (c) => c.id === currentPlayingChunkId,
                    )
                  : -1;
                const isPlayed = currentIdx > chunkIndex;
                const isFailed =
                  chunk.failed === true || (!chunk.url && !chunk.publicUrl);

                const barHeights = chunkBarHeights[chunkIndex] || [];

                // Calculate how many bars should be "filled" based on progress
                const barsToFill = isPlayingChunk
                  ? Math.floor(currentChunkProgress * BARS_PER_CHUNK)
                  : isPlayed
                  ? BARS_PER_CHUNK
                  : 0;

                return (
                  <div
                    key={chunk.id || chunkIndex}
                    style={{
                      position: 'relative',
                      width: `${CHUNK_WIDTH}px`,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: `${BAR_GAP}px`,
                      borderLeft:
                        chunkIndex > 0
                          ? '1px solid rgba(255, 255, 255, 0.2)'
                          : 'none',
                      borderRight:
                        chunkIndex === playbackChunks.length - 1
                          ? '1px solid rgba(255, 255, 255, 0.2)'
                          : 'none',
                      boxSizing: 'border-box',
                      padding: '0 4px',
                    }}
                    title={`Chunk ${chunkIndex + 1}/${playbackChunks.length}${
                      isPlayingChunk ? ' (Playing)' : ''
                    }${isFailed ? ' (FAILED)' : ''}`}
                  >
                    {/* Audio Bars */}
                    {barHeights.map((heightPercent, barIdx) => {
                      const isFilled = barIdx < barsToFill;
                      const isCurrentBar =
                        isPlayingChunk && barIdx === barsToFill;

                      let barColor;
                      if (isFailed) {
                        barColor = '#ff3b30';
                      } else if (isPlayingChunk) {
                        barColor =
                          isFilled || isCurrentBar
                            ? '#34c759'
                            : 'rgba(52, 199, 89, 0.3)';
                      } else if (isPlayed) {
                        barColor = '#007AFF';
                      } else {
                        barColor = 'rgba(255, 255, 255, 0.25)';
                      }

                      return (
                        <div
                          key={barIdx}
                          style={{
                            width: `${BAR_WIDTH}px`,
                            height: `${heightPercent}%`,
                            backgroundColor: barColor,
                            borderRadius: '2px',
                            transition: 'background-color 0.15s, height 0.1s',
                            minHeight: '4px',
                          }}
                        />
                      );
                    })}

                    {/* Chunk number overlay (subtle) */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '2px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: '8px',
                        color: 'rgba(255, 255, 255, 0.4)',
                        fontWeight: isPlayingChunk ? '600' : '400',
                      }}
                    >
                      {chunkIndex + 1}
                    </div>
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
                boxShadow: '0 0 6px rgba(255, 255, 255, 0.9)',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            />
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
                } of ${playbackChunks.length}`
              : playbackChunks.length > 0
              ? `Tap to play ${playbackChunks.length} chunks`
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
              <svg width='24' height='24' viewBox='0 0 24 24' fill='white'>
                <rect x='6' y='4' width='4' height='16' />
                <rect x='14' y='4' width='4' height='16' />
              </svg>
            ) : (
              // Play icon
              <svg width='24' height='24' viewBox='0 0 330 330'>
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
            xmlns='http://www.w3.org/2000/svg'
          >
            <rect width='24' height='24' fill='none' />
            <g transform='translate(2 8)'>
              <path
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
