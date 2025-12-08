// src/views/DialerView.jsx
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import Dialpad from '../components/Dialpad.jsx';
import OnlineUserDropdown from '../components/OnlineUserDropdown.jsx';

export default function DialerView({
  onlineUsers = [],
  usersInCall = new Set(),
  userCallPartners = new Map(),
  onStartCall,
  myUsername,
  myPhoneNumber,
}) {
  const [number, setNumber] = useState('');
  const [selectedUsername, setSelectedUsername] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const anchorRef = useRef(null);
  const dropdownRef = useRef(null);

  // audio refs for tones
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);

  // DTMF frequency map
  const DTMF = {
    1: [697, 1209],
    2: [697, 1336],
    3: [697, 1477],
    4: [770, 1209],
    5: [770, 1336],
    6: [770, 1477],
    7: [852, 1209],
    8: [852, 1336],
    9: [852, 1477],
    '*': [941, 1209],
    0: [941, 1336],
    '#': [941, 1477],
  };

  // ensure audio context & master gain (user gesture required once)
  function ensureAudio() {
    if (!audioCtxRef.current) {
      try {
        const C = window.AudioContext;
        audioCtxRef.current = new C();
        masterGainRef.current = audioCtxRef.current.createGain();
        masterGainRef.current.gain.value = 0.12;
        masterGainRef.current.connect(audioCtxRef.current.destination);
      } catch (e) {
        console.warn('AudioContext not available', e);
      }
    }
    return audioCtxRef.current;
  }

  function playDTMFTone(digit, duration = 150) {
    const freqs = DTMF[String(digit)];
    if (!freqs) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const [f1, f2] = freqs;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sine';
    o2.type = 'sine';
    o1.frequency.value = f1;
    o2.frequency.value = f2;
    const g = ctx.createGain();
    g.gain.value = 1.0;
    o1.connect(g);
    o2.connect(g);
    g.connect(masterGainRef.current);
    const now = ctx.currentTime;
    // quick envelope
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1.0, now + 0.01);
    o1.start(now);
    o2.start(now);
    // stop
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000 - 0.02);
    o1.stop(now + duration / 1000);
    o2.stop(now + duration / 1000);
  }

  // short "connecting" sound: two rising beeps
  function playConnectingTone() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(masterGainRef.current);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1.0, now + 0.01);

    // create two oscillators for a short rising arpeggio
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(400, now);
    o.frequency.linearRampToValueAtTime(900, now + 0.35);

    o.connect(g);
    o.start(now);
    o.stop(now + 0.45);

    // small release
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  }

  const digitsOnly = (s) => (s || '').replace(/[^\d]/g, '');

  useEffect(() => {
    if (number === '' || number == null) {
      setShowDropdown(true);
    }
  }, [number]);

  const handleDigit = (d) => {
    // allow max 10 digits
    // allow max 10 digits
    const next = digitsOnly(number + d);
    if (next.length > 10) return;
    setNumber(next);
    // typing manually clears any previously selected username
    if (selectedUsername) setSelectedUsername(null);
    setShowDropdown(false); // typing a number closes the dropdown

    // user gesture present — play DTMF using WebAudio
    try {
      playDTMFTone(d);
    } catch (e) {
      // ignore audio errors
    }
  };

  const validateAndStart = () => {
    const normalized = digitsOnly(number);
    if (!normalized || normalized.length === 0) {
      alert('Please enter a number or pick an online user.');
      return;
    }
    if (normalized.length > 10) {
      alert('Phone number must be 10 digits or less.');
      return;
    }
    const found = onlineUsers.find((u) => u.phone_number === normalized);
    if (!found) {
      alert('Number not found in the directory (or user is offline).');
      return;
    }

    // Play a short connecting sound to give feedback
    try {
      playConnectingTone();
    } catch (e) {}

    onStartCall && onStartCall(normalized, found);
  };

  const pickUser = (u) => {
    setNumber(u.phone_number);
    setSelectedUsername(u.username || null);
    setShowDropdown(false);
  };

  const userList = useMemo(
    () => (onlineUsers.length > 0 ? onlineUsers : []),
    [onlineUsers],
  );

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!showDropdown) return;

    function onDown(e) {
      const el = e.target;
      if (
        anchorRef.current &&
        (anchorRef.current === el || anchorRef.current.contains(el))
      ) {
        return; // clicked inside anchor -> ignore
      }
      if (
        dropdownRef.current &&
        (dropdownRef.current === el || dropdownRef.current.contains(el))
      ) {
        return; // clicked inside dropdown -> ignore
      }
      setShowDropdown(false);
    }

    function onKey(e) {
      if (e.key === 'Escape') setShowDropdown(false);
    }

    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [showDropdown]);

  return (
    <div class='screen dialer-screen'>
      <div class='caller-info'>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div class='caller-name'>{myUsername || 'Guest'}</div>
          <div
            class='caller-number'
            style={{ fontSize: 18, color: 'rgba(255,255,255,0.8)' }}
          >
            {myPhoneNumber || 'No number assigned'}
          </div>
        </div>

        {/* Number input area (click to open dropdown) */}
        <div
          ref={anchorRef}
          role='button'
          aria-haspopup='listbox'
          aria-expanded={showDropdown}
          onClick={() => setShowDropdown((s) => !s)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            marginTop: 8,
            userSelect: 'none',
            width: '100%',
          }}
        >
          <div
            class='number-input'
            style={{ width: '70%', textAlign: 'center' }}
          >
            <div class='caller-number'>
              <div
                style={{
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.85)',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                {number && selectedUsername ? (
                  <span style={{ color: '#888' }}>
                    Calling {selectedUsername}
                  </span>
                ) : (
                  ''
                )}
              </div>

              <div style={{ height: 42, fontSize: 36 }}>
                {number && number.length > 0 ? number : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* dropdown anchored under the number input area */}
      <div style={{ position: 'relative', width: '100%', marginTop: 6 }}>
        {showDropdown && (
          <div ref={dropdownRef} style={{ margin: '6px 18px 0 18px' }}>
            <OnlineUserDropdown
              users={userList}
              usersInCall={usersInCall}
              userCallPartners={userCallPartners}
              onPick={pickUser}
            />
          </div>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <Dialpad onDigit={handleDigit} />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginTop: 18,
          gap: 12,
        }}
      >
        <button
          class='call-action-btn call-btn'
          onClick={validateAndStart}
          style={{ opacity: 0 }}
          title='Call'
        >
          {/* phone handset icon */}
          <svg
            class='icon'
            viewBox='0 0 24 24'
            style={{ width: 18, height: 18 }}
          >
            <path
              fill='white'
              d='M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z'
            />
          </svg>
        </button>

        <button
          class='call-action-btn call-btn'
          onClick={validateAndStart}
          title='Call'
        >
          {/* phone handset icon */}
          <svg
            class='icon'
            viewBox='0 0 24 24'
            style={{ width: 18, height: 18 }}
          >
            <path
              fill='white'
              d='M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z'
            />
          </svg>
        </button>

        <button
          class='cancel-btn'
          onClick={() => {
            setNumber((prev) => (prev ? prev.slice(0, -1) : ''));
            // if user edits number, clear selected username
            if (selectedUsername) setSelectedUsername(null);
            setShowDropdown(false);
          }}
          title='Backspace'
          aria-label='Backspace'
          style={{
            width: 60,
            height: 60,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width='24'
            height='24'
            viewBox='0 0 24 24'
            aria-hidden='true'
            clipRule='evenodd'
            fillRule='evenodd'
            strokeLinejoin='round'
            strokeMiterlimit='2'
          >
            <path
              d='m22 6c0-.552-.448-1-1-1h-12.628c-.437 0-.853.191-1.138.523-1.078 1.256-3.811 4.439-4.993 5.815-.16.187-.241.419-.241.651 0 .231.08.463.24.651 1.181 1.38 3.915 4.575 4.994 5.835.285.333.701.525 1.14.525h12.626c.552 0 1-.448 1-1 0-2.577 0-9.423 0-12zm-13.628.5h12.128v11h-12.126l-4.715-5.51zm5.637 4.427 1.71-1.71c.146-.146.339-.219.531-.219.404 0 .75.324.75.749 0 .193-.073.384-.219.531l-1.711 1.711 1.728 1.728c.147.147.22.339.22.53 0 .427-.349.751-.75.751-.192 0-.384-.073-.531-.219l-1.728-1.729-1.728 1.729c-.146.146-.339.219-.531.219-.401 0-.75-.324-.75-.751 0-.191.073-.383.22-.53l1.728-1.728-1.788-1.787c-.146-.148-.219-.339-.219-.532 0-.425.346-.749.751-.749.192 0 .384.073.53.219z'
              fill='white'
              fillRule='nonzero'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
