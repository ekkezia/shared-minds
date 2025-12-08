// src/views/IncomingCallView.jsx
import { useEffect } from 'preact/hooks';

export default function IncomingCallView({ call, onAccept, onReject }) {
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
