// src/views/CallConnectedView.jsx
import { useMemo, useState, useRef } from 'preact/hooks';

export default function CallConnectedView({
  call,
  onEnd,
  chunks = [],
  currentPlayingChunkId = null,
  currentChunkProgress = 0,
  isPlaying = false,
  playbackController = null,
}) {
  const timelineRef = useRef(null);
  // Calculate total duration (each chunk is ~5 seconds)
  const totalDuration = chunks.length * 5;
  const chunkWidthPercent = chunks.length > 0 ? 100 / chunks.length : 0;

  // Calculate scrubber position (in pixels, not percentage)
  const scrubberPosition = useMemo(() => {
    if (!currentPlayingChunkId || chunks.length === 0) return 0;

    const currentIndex = chunks.findIndex((c) => c.id === currentPlayingChunkId);
    if (currentIndex === -1) return 0;

    // Position = (chunk index * 80px) + (progress within chunk * 80px)
    const basePosition = currentIndex * 80;
    const progressOffset = currentChunkProgress * 80;
    return basePosition + progressOffset;
  }, [currentPlayingChunkId, currentChunkProgress, chunks]);

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

      {/* Visual Timeline */}
      {chunks.length > 0 && (
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
            style={{
              position: 'relative',
              width: '100%',
              height: '60px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              overflowX: 'auto',
              overflowY: 'hidden',
              minWidth: `${Math.max(100, chunks.length * 80)}px`, // Minimum width based on chunk count
              cursor: 'pointer',
            }}
            onClick={(e) => {
              if (!playbackController || !timelineRef.current) return;
              const rect = timelineRef.current.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const scrollX = timelineRef.current.scrollLeft;
              const totalX = clickX + scrollX;
              
              // Calculate which chunk was clicked
              const chunkIndex = Math.floor(totalX / 80);
              const progressInChunk = Math.max(0, Math.min(1, (totalX % 80) / 80));
              
              if (chunkIndex >= 0 && chunkIndex < chunks.length) {
                console.log('[CallConnectedView] Seeking to chunk', {
                  chunkIndex,
                  progressInChunk,
                  chunkId: chunks[chunkIndex].id,
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
                width: `${chunks.length * 80}px`, // Fixed width per chunk (80px each)
                height: '100%',
                minWidth: '100%',
              }}
            >
              {chunks.map((chunk, index) => {
                const isPlaying = chunk.id === currentPlayingChunkId;
                const currentIndex = currentPlayingChunkId
                  ? chunks.findIndex((c) => c.id === currentPlayingChunkId)
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
                    title={`Chunk ${index + 1}/${chunks.length}${isPlaying ? ' (Playing)' : ''} - ${chunk.id || 'no-id'}`}
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
            {currentPlayingChunkId && (
              (() => {
                const currentIndex = chunks.findIndex(
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
              })()
            )}
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
                  chunks.findIndex((c) => c.id === currentPlayingChunkId) + 1
                } of ${chunks.length} (${Math.round(
                  currentChunkProgress * 100,
                )}%)`
              : chunks.length > 0
              ? `Ready to play ${chunks.length} chunks`
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
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                stroke='white'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <polygon points='5 3 19 12 5 21 5 3' />
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
          <svg width='22' height='22' viewBox='0 0 24 24' aria-hidden='true'>
            <circle cx='12' cy='12' r='12' fill='#FF3B30' />
            <path
              d='M17.2 12.7c-.6-.2-1.2-.3-1.8-.3-.5 0-1 .2-1.4.4-.2.1-.5.1-.7 0l-2-1.1c-1.6-.9-3.4-2.4-4.7-4.1 1.3-1.7 3.1-3.2 4.7-4.1l2-1.1c.2-.1.5-.1.7 0 .4.2.9.4 1.4.4.6 0 1.2-.1 1.8-.3.3-.1.6 0 .8.2l2.2 2.2c.2.2.3.5.2.8-1 3.1-3.1 5.6-5.6 7.1-.2.1-.5.1-.7 0z'
              fill='white'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
