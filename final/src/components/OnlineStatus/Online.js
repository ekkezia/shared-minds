import React from 'react';

export default function Online() {
  return (
    <div style={{
      position: 'fixed',
      top: 12,
      right: 12,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.6)',
      color: '#b6ffb6',
      padding: '6px 10px',
      borderRadius: 8,
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#8cff8c" aria-hidden>
        <circle cx="12" cy="12" r="10" />
      </svg>
      <span>Online</span>
    </div>
  );
}