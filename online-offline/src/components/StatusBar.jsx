// src/components/StatusBar.jsx
import { useState, useEffect } from 'preact/hooks';

export default function StatusBar({ isOnline }) {
  const [time, setTime] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div class='status-bar' style={{ cursor: 'none' }}>
      <div id='statusTime'>{time}</div>

      <div
        class={`connection-status ${isOnline ? 'online' : 'offline'}`}
        role='status'
        aria-live='polite'
        title={isOnline ? 'Online' : 'Offline'}
      >
        <span class='visually-hidden'>{isOnline ? 'Offline' : 'Online'}</span>

        <svg
          class='network-icon'
          viewBox='0 0 24 24'
          width='18'
          height='18'
          xmlns='http://www.w3.org/2000/svg'
          aria-hidden='true'
          focusable='false'
        >
          <path d='M13 8H15V20H13V8Z' fill='currentColor' />
          <path d='M5 16H7V20H5V16Z' fill='currentColor' />
          <path d='M9 12H11V20H9V12Z' fill='currentColor' />
        </svg>
      </div>
    </div>
  );
}
