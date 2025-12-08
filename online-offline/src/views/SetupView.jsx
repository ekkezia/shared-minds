// src/views/SetupView.jsx
import { useState, useEffect } from 'preact/hooks';

function generatePhoneNumber() {
  // produce a 10-digit number (not starting with 0)
  const first = Math.floor(1 + Math.random() * 8); // 1..9
  const rest = Array.from({ length: 9 }, () =>
    Math.floor(Math.random() * 10),
  ).join('');
  return `${first}${rest}`;
}

export default function SetupView({ onDone }) {
  const storedName = sessionStorage.getItem('myUsername') || '';
  const storedPhone = sessionStorage.getItem('myPhoneNumber') || '';
  const [name, setName] = useState(storedName);
  // if phone already stored, keep it; otherwise generate one (only client-side)
  const [phone] = useState(storedPhone || generatePhoneNumber());
  const [micPermission, setMicPermission] = useState('prompting'); // 'prompting' | 'granted' | 'denied'

  // Request microphone permission when component mounts
  useEffect(() => {
    const requestMicrophone = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMicPermission('denied');
        console.warn('[SetupView] getUserMedia not available');
        return;
      }

      try {
        // Request microphone permission
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicPermission('granted');
        // Stop the stream immediately - we just needed permission
        stream.getTracks().forEach((track) => track.stop());
        console.log('[SetupView] ✅ Microphone permission granted');
      } catch (err) {
        setMicPermission('denied');
        console.warn('[SetupView] ❌ Microphone permission denied or error:', err);
      }
    };

    requestMicrophone();
  }, []);

  const save = () => {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      alert('Please enter a display name.');
      return;
    }
    onDone && onDone({ username: trimmed, phoneNumber: phone });
  };

  return (
    <div class='screen dialer-screen'>
      <div style={{ paddingTop: '60px', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>Welcome</h2>
        <div style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 18 }}>
          Your phone number has been generated. Please pick a display name.
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '80%',
              textAlign: 'left',
              color: 'rgba(255,255,255,0.75)',
            }}
          >
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              Assigned phone number
            </div>
            <input
              value={phone}
              disabled
              style={{
                padding: '10px 12px',
                fontSize: 18,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.02)',
                color: '#fff',
                outline: 'none',
                width: '100%',
                textAlign: 'center',
              }}
            />
          </div>

          <input
            value={name}
            // @ts-ignore
            onInput={(e) => setName(e.target.value)}
            placeholder='Your display name'
            style={{
              padding: '10px 12px',
              fontSize: 18,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.04)',
              color: '#fff',
              outline: 'none',
              width: '80%',
            }}
          />

          {/* Microphone permission status */}
          <div
            style={{
              width: '80%',
              marginTop: 8,
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 12,
              textAlign: 'center',
              background:
                micPermission === 'granted'
                  ? 'rgba(52, 199, 89, 0.15)'
                  : micPermission === 'denied'
                  ? 'rgba(255, 59, 48, 0.15)'
                  : 'rgba(255, 204, 0, 0.15)',
              color:
                micPermission === 'granted'
                  ? '#34c759'
                  : micPermission === 'denied'
                  ? '#ff3b30'
                  : '#ffcc00',
            }}
          >
            {micPermission === 'granted' && '✓ Microphone permission granted'}
            {micPermission === 'denied' && '⚠ Microphone permission needed for calls'}
            {micPermission === 'prompting' && 'Requesting microphone permission...'}
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              class='call-action-btn call-btn'
              onClick={save}
              aria-label='Continue'
              title='Continue'
            >
              {/* simple right-arrow icon */}
              <svg
                class='icon'
                viewBox='0 0 24 24'
                style={{ width: 20, height: 20 }}
              >
                <path fill='white' d='M10 17l5-5-5-5v10z' />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
