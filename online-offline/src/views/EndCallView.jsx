// src/views/EndCallView.jsx
import { useEffect, useRef } from 'preact/hooks';

export default function EndCallView({ onDone }) {
  const audioContextRef = useRef(null);

  // Play call ended sound effect
  useEffect(() => {
    // Create audio context if not exists
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('[EndCallView] AudioContext not supported', e);
        return;
      }
    }

    const audioContext = audioContextRef.current;
    
    // Resume audio context if suspended (browsers require user interaction)
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch((e) => {
        console.warn('[EndCallView] Could not resume audio context', e);
      });
    }

    try {
      const now = audioContext.currentTime;
      
      // Create a descending tone (like a "call ended" beep)
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Start at a higher frequency and descend (typical "end call" sound)
      oscillator.frequency.setValueAtTime(600, now);
      oscillator.frequency.exponentialRampToValueAtTime(300, now + 0.2);
      oscillator.type = 'sine';

      // Quick fade in and out
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.15);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.2);

      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch (e) {
      console.warn('[EndCallView] Error playing end call sound', e);
    }

    // Cleanup
    return () => {
      // Audio context cleanup is handled automatically
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      onDone && onDone();
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div class='screen dialer-screen'>
      <div style={{ paddingTop: 120, textAlign: 'center' }}>
        <h2>Call Ended</h2>
        <div style={{ color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>
          Returning to dialer…
        </div>
      </div>
    </div>
  );
}
