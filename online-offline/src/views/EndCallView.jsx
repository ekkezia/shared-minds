// src/views/EndCallView.jsx
import { useEffect } from 'preact/hooks';

export default function EndCallView({ onDone }) {
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
