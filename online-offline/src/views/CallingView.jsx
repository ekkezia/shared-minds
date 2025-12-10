// src/views/CallingView.jsx
import { useEffect, useState, useRef } from 'preact/hooks';
import { normalizePhoneNumber } from '../services/audioService.js';

// Recording duration constant (must match audioService.js)
const RECORDING_DURATION_SECONDS = 20;
const BAR_COUNT = 20; // More bars for wider visualizer

// Format duration as MM:SS
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function ProgressVisualizer({
  audioStream = null,
  progressPercent = 0,
  isUploaded = false,
  isUploading = false,
  uploadFailed = false,
}) {
  const [heights, setHeights] = useState(Array(BAR_COUNT).fill(28));
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const dataArrayRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    // If we have an audio stream, use Web Audio API for real visualization
    if (audioStream) {
      try {
        // @ts-ignore - webkitAudioContext exists in some browsers
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        dataArrayRef.current = dataArray;

        const updateVisualization = () => {
          if (!mounted) return;

          analyser.getByteFrequencyData(dataArray);

          const samplesPerBar = Math.floor(bufferLength / BAR_COUNT);
          const newHeights = [];

          for (let i = 0; i < BAR_COUNT; i++) {
            let sum = 0;
            const start = i * samplesPerBar;
            const end = start + samplesPerBar;

            for (let j = start; j < end && j < bufferLength; j++) {
              sum += dataArray[j];
            }

            const average = sum / samplesPerBar;
            const height = Math.max(12, (average / 255) * 70);
            newHeights.push(height);
          }

          setHeights(newHeights);
          animationFrameRef.current =
            requestAnimationFrame(updateVisualization);
        };

        updateVisualization();
      } catch (err) {
        console.warn(
          '[ProgressVisualizer] Failed to setup audio analysis, using fallback',
          err,
        );
        // Fallback to random animation
        const interval = setInterval(() => {
          if (!mounted) return;
          setHeights((h) => h.map(() => 12 + Math.round(Math.random() * 58)));
        }, 80);
        return () => {
          mounted = false;
          clearInterval(interval);
        };
      }
    } else {
      // Fallback random animation when no stream
      const interval = setInterval(() => {
        if (!mounted) return;
        setHeights((h) => h.map(() => 12 + Math.round(Math.random() * 58)));
      }, 80);
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
  }, [audioStream]);

  // Calculate which bars should be filled based on progress
  const filledBars = Math.floor((progressPercent / 100) * BAR_COUNT);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        width: '95%',
        maxWidth: '360px',
        height: '80px',
        margin: '20px auto',
      }}
    >
      {heights.map((height, idx) => {
        const isFilled = idx < filledBars;
        const isCurrentBar = idx === filledBars && progressPercent < 100;

        // Determine bar color/style
        let backgroundColor;
        let borderColor = 'transparent';
        let borderWidth = '0px';

        if (isUploaded) {
          // After upload: white stroke outline, transparent fill
          backgroundColor = 'rgba(255, 255, 255, 0.15)';
          borderColor = 'white';
          borderWidth = '1px';
        } else if (uploadFailed) {
          // Upload failed: red bars
          backgroundColor = isFilled ? '#ff3b30' : 'rgba(255, 59, 48, 0.2)';
        } else if (isUploading) {
          // Uploading: yellow/amber bars
          backgroundColor = isFilled ? '#ffcc00' : 'rgba(255, 204, 0, 0.2)';
        } else {
          // Recording: red progress
          backgroundColor = isFilled ? '#ff3b30' : 'rgba(255, 255, 255, 0.15)';
        }

        return (
          <div
            key={idx}
            style={{
              width: '12px',
              height: `${height}px`,
              backgroundColor,
              borderRadius: '3px',
              transition: 'height 0.08s ease-out, background-color 0.2s',
              border: `${borderWidth} solid ${borderColor}`,
              boxSizing: 'border-box',
            }}
          />
        );
      })}
    </div>
  );
}

export default function CallingView({
  call,
  isOnline,
  onEnd,
  audioStream,
  uploadedChunksCount = 0,
  uploadStatus = null, // { success: boolean, uploading?: boolean, error?: string }
  myPhoneNumber = '',
  myUsername = '',
  callDuration = 0, // Call duration in seconds (from App.jsx)
}) {
  const [recordingTime, setRecordingTime] = useState(0);

  // Debug: log callDuration changes
  useEffect(() => {
    console.log('[CallingView] ⏱️ callDuration received:', callDuration);
  }, [callDuration]);

  // Track recording time (countdown from 20 seconds)
  useEffect(() => {
    if (!isOnline) {
      setRecordingTime(0);
      return;
    }

    const startTime = Date.now();
    setRecordingTime(0);

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setRecordingTime(Math.min(elapsed, RECORDING_DURATION_SECONDS));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);

    return () => clearInterval(interval);
  }, [isOnline]);

  // Calculate progress
  const progressPercent = (recordingTime / RECORDING_DURATION_SECONDS) * 100;
  const isRecordingComplete = recordingTime >= RECORDING_DURATION_SECONDS;

  // Determine upload state
  const isUploading = uploadStatus?.uploading === true;
  const uploadSucceeded =
    (uploadStatus?.success === true || uploadedChunksCount > 0) && !isUploading;
  const uploadFailed =
    uploadStatus?.success === false &&
    uploadStatus?.failed === true &&
    uploadedChunksCount === 0;

  // Determine if current user is the caller or recipient
  const normalizeNumber = normalizePhoneNumber;
  const myNorm = normalizeNumber(myPhoneNumber);
  const fromNorm = normalizeNumber(call.from_number || '');
  const toNorm = normalizeNumber(call.to_number || '');
  const isCaller = fromNorm === myNorm;
  const isRecipient = toNorm === myNorm;

  return (
    <div class='screen dialer-screen'>
      <div class='caller-info'>
        <div class='caller-name'>{myUsername || 'You'}</div>
        {isCaller && call.to_username && (
          <div
            style={{
              marginTop: '4px',
              fontSize: '14px',
              color: 'white',
            }}
          >
            <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>calling </span>
            <span style={{ fontWeight: 'bold' }}>{call.to_username}</span>
          </div>
        )}
        {isRecipient && call.from_username && (
          <div
            style={{
              marginTop: '4px',
              fontSize: '14px',
              color: 'rgba(255, 255, 255, 0.8)',
            }}
          >
            calling{' '}
            <span style={{ fontWeight: 'bold' }}>{call.from_username}</span>
          </div>
        )}
        <div class='caller-number'>{call.other_number}</div>

        {/* Call Duration Timer - like a real phone call */}
        <div
          style={{
            marginTop: '12px',
            fontSize: '32px',
            fontWeight: '300',
            fontFamily: 'SF Mono, Monaco, Consolas, monospace',
            color: '#fff',
            letterSpacing: '2px',
          }}
        >
          {formatDuration(callDuration)}
        </div>

        {!isOnline && <div class='call-status'>Playing their voice...</div>}
      </div>

      {/* Progress Visualizer - shows recording progress via bar colors */}
      {isOnline && (
        <ProgressVisualizer
          audioStream={audioStream}
          progressPercent={isRecordingComplete ? 100 : progressPercent}
          isUploaded={uploadSucceeded}
          isUploading={isUploading}
          uploadFailed={uploadFailed}
        />
      )}

      {/* Fallback visualizer when offline */}
      {!isOnline && (
        <div
          class='audio-visualizer playback-mode'
          style={{ width: '95%', maxWidth: '360px', margin: '20px auto' }}
        >
          {Array(BAR_COUNT)
            .fill(0)
            .map((_, idx) => (
              <div
                class='bar playback'
                key={idx}
                style={{ height: `${20 + Math.random() * 30}px` }}
              />
            ))}
        </div>
      )}

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
