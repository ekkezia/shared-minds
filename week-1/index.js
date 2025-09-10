// Webcam
const webcam = document.getElementById('webcam');

navigator.mediaDevices
  .getUserMedia({ video: true })
  .then((stream) => {
    webcam.srcObject = stream;
  })
  .catch((err) => {
    console.error('Error accessing webcam:', err);
  });

// overlay of eye opening/closing shadow
function updateOverlay(closed) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  const rx = w * (closed ? 0.5 : 0);
  const ry = h * (closed ? 0.4 : 0);

  // Simulate eye opening with radial shadow
  overlay.style.background = `
    radial-gradient(
      ellipse ${rx}px ${ry}px at 50% 50%,
      rgba(0,0,0,0) 0%,
      rgba(0,0,0,1) 100%
    )
  `;

  // change opacity for instruction
  instruction.style.opacity = closed ? 0 : 0.3;

  if (window.arduinoIsAvailable) {
    console.log('HEEEY');
    if (closed) sendBlinkSignal(true);
    else sendBlinkSignal(false);
  }
}

updateOverlay();
