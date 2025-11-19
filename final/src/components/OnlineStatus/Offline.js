import React from 'react';

export default function Offline() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.85)',
        color: '#ffd800',
        zIndex: 9999,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 640 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 28 }}>You are offline</h2>
        <p style={{ margin: 0, fontSize: 16, color: '#fff' }}>
          Some features (uploads, room syncing) are disabled while offline.
          Check your connection and try again. Local interactions still work.
        </p>
        <p style={{ marginTop: 16 }}>
          <small style={{ color: '#ddd' }}>
            Any captures will be queued locally and uploaded when you reconnect.
          </small>
        </p>
      </div>
    </div>
  );
}
