// src/components/PhoneContainer.jsx
export default function PhoneContainer({ isOnline, view, children }) {
  const mode = isOnline ? 'recording-mode' : 'playback-mode';

  let viewClass = '';
  if (view === 'connected') viewClass = 'call-connected';
  if (view === 'calling') viewClass = 'calling-active';

  return (
    <div class={`phone-container ${mode} ${viewClass}`}>
      <div class='notch'></div>
      {children}
    </div>
  );
}
