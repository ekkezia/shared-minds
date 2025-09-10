let port, writer;
window.arduinoIsAvailable = false;

async function initArduino() {
  // Must be called from user gesture (click/tap)
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });

  writer = port.writable.getWriter();

  arduinoIsAvailable = true;
}

document.body.addEventListener('click', async () => {
  if (!port) await initArduino();
});

async function sendBlinkSignal(isBlinking) {
  if (!writer) return;
  const data = new TextEncoder().encode(isBlinking ? 'BLINK\n' : 'OPEN\n');

  console.log('blinkkkk', isBlinking, data);
  await writer.write(data);
}
