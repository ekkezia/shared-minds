// src/views/CallingView.jsx
import { useEffect, useState, useRef } from 'preact/hooks';

function Visualizer({ mode = 'recording', audioStream = null }) {
  const [heights, setHeights] = useState(Array(12).fill(28));
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const dataArrayRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    // If we have an audio stream and we're in recording mode, use Web Audio API
    if (mode === 'recording' && audioStream) {
      try {
        // Create AudioContext and AnalyserNode
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256; // Higher resolution for smoother visualization
        analyser.smoothingTimeConstant = 0.8; // Smooth the visualization

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Connect the audio stream to the analyser
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        dataArrayRef.current = dataArray;

        // Animation loop to update visualization
        const updateVisualization = () => {
          if (!mounted) return;

          analyser.getByteFrequencyData(dataArray);

          // Map frequency data to 12 bars
          // We'll use different frequency ranges for each bar
          const barCount = 12;
          const samplesPerBar = Math.floor(bufferLength / barCount);
          const newHeights = [];

          for (let i = 0; i < barCount; i++) {
            let sum = 0;
            const start = i * samplesPerBar;
            const end = start + samplesPerBar;

            // Average the frequency data for this bar's range
            for (let j = start; j < end && j < bufferLength; j++) {
              sum += dataArray[j];
            }

            const average = sum / samplesPerBar;
            // Normalize to 0-60px height range, with minimum of 8px
            const height = Math.max(8, (average / 255) * 60);
            newHeights.push(height);
          }

          setHeights(newHeights);
          animationFrameRef.current = requestAnimationFrame(updateVisualization);
        };

        updateVisualization();
      } catch (err) {
        console.warn('[Visualizer] Failed to setup audio analysis, using fallback', err);
        // Fallback to random animation if Web Audio API fails
        const interval = setInterval(
          () => {
            if (!mounted) return;
            setHeights((h) =>
              h.map(() => 10 + Math.round(Math.random() * 50)),
            );
          },
          80,
        );
        return () => {
          mounted = false;
          clearInterval(interval);
        };
      }
    } else {
      // Fallback for playback mode or when no stream is available
      const interval = setInterval(
        () => {
          if (!mounted) return;
          setHeights((h) =>
            h.map(() =>
              mode === 'recording'
                ? 10 + Math.round(Math.random() * 50)
                : 20 + Math.round(Math.random() * 20),
            ),
          );
        },
        mode === 'recording' ? 80 : 240,
      );
      return () => {
        mounted = false;
        clearInterval(interval);
      };
    }

    return () => {
      mounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [mode, audioStream]);

  return (
    <div
      class={`audio-visualizer ${
        mode === 'recording' ? 'recording-mode' : 'playback-mode'
      }`}
    >
      {heights.map((height, idx) => (
        <div
          class={`bar ${mode === 'recording' ? 'recording' : 'playback'}`}
          key={idx}
          style={{ height: `${height}px` }}
        />
      ))}
    </div>
  );
}

export default function CallingView({ call, isOnline, onEnd, audioStream, uploadedChunksCount = 0 }) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    // Calculate elapsed time from call start
    const startTime = call.created_at
      ? new Date(call.created_at).getTime()
      : Date.now();

    const updateTimer = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000); // elapsed seconds
      setElapsedTime(elapsed);
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [call.created_at]);

  // Format time as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div class='screen dialer-screen'>
      <div class='caller-info'>
        <div class='caller-name'>
          {call.to_username || call.from_username || 'Subway Call'}
        </div>
        <div class='caller-number'>{call.other_number}</div>
        <div class='call-status'>
          {isOnline ? 'Recording your voice...' : 'Playing their voice...'}
        </div>
        {isOnline && (
          <>
            <div
              style={{
                marginTop: '8px',
                fontSize: '18px',
                fontWeight: '600',
                color: '#34c759',
                letterSpacing: '1px',
              }}
            >
              {formatTime(elapsedTime)}
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '14px',
                fontWeight: '500',
                color: uploadedChunksCount > 0 ? '#34c759' : '#ffcc00',
                letterSpacing: '0.5px',
              }}
            >
              {uploadedChunksCount > 0
                ? `✅ ${uploadedChunksCount} chunk${uploadedChunksCount !== 1 ? 's' : ''} uploaded`
                : '⏳ Waiting for first upload...'}
            </div>
          </>
        )}
      </div>

      <Visualizer
        mode={isOnline ? 'recording' : 'playback'}
        audioStream={isOnline ? audioStream : null}
      />

      <div class='call-controls'>
        <button
          class='call-action-btn end-btn'
          onClick={() => isOnline && onEnd && onEnd()}
          disabled={!isOnline}
          aria-label='End call'
          title={isOnline ? 'End' : 'End call (offline)'}
          style={{
            opacity: isOnline ? 1 : 0.5,
            cursor: isOnline ? 'pointer' : 'not-allowed',
          }}
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
