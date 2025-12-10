// src/views/IncomingCallView.jsx
import { useEffect, useRef } from 'preact/hooks';

export default function IncomingCallView({ call, onAccept, onReject }) {
  const audioContextRef = useRef(null);
  const oscillatorRef = useRef(null);
  const gainNodeRef = useRef(null);
  const ringIntervalRef = useRef(null);

  // Generate and play ringing sound
  useEffect(() => {
    // Create audio context if not exists
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('[IncomingCallView] AudioContext not supported', e);
        return;
      }
    }

    const audioContext = audioContextRef.current;
    
    // Resume audio context if suspended (browsers require user interaction)
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch((e) => {
        console.warn('[IncomingCallView] Could not resume audio context', e);
      });
    }

    let isPlaying = false;

    // Function to play a single ring tone (two alternating frequencies like a real phone)
    const playRingTone = () => {
      if (isPlaying) return;
      isPlaying = true;

      try {
        const now = audioContext.currentTime;
        const ringDuration = 0.4; // Each tone lasts 0.4 seconds
        const pauseDuration = 0.2; // Pause between tones
        const totalDuration = ringDuration * 2 + pauseDuration; // Two tones with pause

        // First tone (440Hz)
        const osc1 = audioContext.createOscillator();
        const gain1 = audioContext.createGain();
        osc1.connect(gain1);
        gain1.connect(audioContext.destination);
        osc1.frequency.setValueAtTime(440, now);
        osc1.type = 'sine';
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.25, now + 0.05);
        gain1.gain.linearRampToValueAtTime(0.25, now + ringDuration - 0.05);
        gain1.gain.linearRampToValueAtTime(0, now + ringDuration);
        osc1.start(now);
        osc1.stop(now + ringDuration);

        // Second tone (480Hz) - starts after first tone + pause
        const osc2 = audioContext.createOscillator();
        const gain2 = audioContext.createGain();
        osc2.connect(gain2);
        gain2.connect(audioContext.destination);
        osc2.frequency.setValueAtTime(480, now);
        osc2.type = 'sine';
        gain2.gain.setValueAtTime(0, now + ringDuration + pauseDuration);
        gain2.gain.linearRampToValueAtTime(0.25, now + ringDuration + pauseDuration + 0.05);
        gain2.gain.linearRampToValueAtTime(0.25, now + totalDuration - 0.05);
        gain2.gain.linearRampToValueAtTime(0, now + totalDuration);
        osc2.start(now + ringDuration + pauseDuration);
        osc2.stop(now + totalDuration);

        // Clean up when second tone ends
        osc2.onended = () => {
          isPlaying = false;
        };

        oscillatorRef.current = osc2; // Keep reference to last oscillator
        gainNodeRef.current = gain2;
      } catch (e) {
        console.warn('[IncomingCallView] Error playing ring tone', e);
        isPlaying = false;
      }
    };

    // Play ring tone immediately, then repeat every 2 seconds (typical phone ring pattern)
    playRingTone();
    ringIntervalRef.current = setInterval(() => {
      playRingTone();
    }, 2000); // Ring every 2 seconds

    // Cleanup function
    return () => {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      if (oscillatorRef.current) {
        try {
          oscillatorRef.current.stop();
        } catch (e) {
          // Ignore errors if already stopped
        }
        oscillatorRef.current = null;
      }
      if (gainNodeRef.current) {
        try {
          gainNodeRef.current.disconnect();
        } catch (e) {
          // Ignore errors
        }
        gainNodeRef.current = null;
      }
    };
  }, [call]);

  useEffect(() => {
    // auto-timeout after 30s if not accepted
    const t = setTimeout(() => {
      onReject && onReject('timeout');
    }, 30000);
    return () => clearTimeout(t);
  }, [call]);

  return (
    <div class='screen dialer-screen'>
      <div class='caller-info'>
        <div class='caller-name'>Incoming Call</div>
        <div class='caller-number'>{call.from_number}</div>
        <div class='call-status'>
          Incoming from {call.from_username || 'Unknown'}
        </div>
      </div>

      <div
        class='call-controls'
        style={{ marginTop: 18, display: 'flex', gap: 12 }}
      >
        <button
          class='call-action-btn call-btn'
          onClick={() => onAccept && onAccept(call)}
          aria-label='Accept call'
          title='Accept'
        >
          <svg width='22' height='22' viewBox='0 0 24 24' aria-hidden='true'>
            <circle cx='12' cy='12' r='12' fill='#34C759' />
            <path
              d='M20.1 15.1c-1.2.6-2.6.9-4 .9-.9 0-1.8-.1-2.7-.4-.4-.1-.8 0-1.1.3l-2 1.8c-3.2-1.6-5.7-4.1-7.3-7.3l1.8-2c.3-.3.4-.7.3-1.1-.3-.9-.4-1.8-.4-2.7 0-1.4.3-2.8.9-4 .2-.4.1-.9-.3-1.2L3.9 1.9C3.6 1.6 3.1 1.6 2.8 1.9 1.6 3.1 1 4.8 1 6.6c0 7 5.7 12.8 12.8 12.8 1.8 0 3.5-.6 4.7-1.8.3-.3.3-.8 0-1.1l-1.4-1.4c-.3-.3-.8-.3-1.1 0z'
              fill='white'
            />
          </svg>
        </button>

        <button
          class='call-action-btn end-btn'
          onClick={() => onReject && onReject('rejected')}
          aria-label='Reject call'
          title='Reject'
          style={{ marginLeft: 12 }}
        >
          <svg width='22' height='22' viewBox='0 0 24 24' aria-hidden='true'>
            <circle cx='12' cy='12' r='12' fill='#FF3B30' />
            <path
              d='M7.2 8.5L8.5 7.2 12 10.7 15.5 7.2 16.8 8.5 13.3 12 16.8 15.5 15.5 16.8 12 13.3 8.5 16.8 7.2 15.5 10.7 12 7.2 8.5z'
              fill='white'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
