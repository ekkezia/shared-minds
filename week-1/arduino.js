let port, writer;

async function initArduino() {
  try {
    port = await navigator.serial.requestPort(); // shows port chooser
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter();
    window.arduinoIsAvailable = true;
    console.log('Arduino ready!');
  } catch (err) {
    console.error('Failed to open Arduino:', err);
    window.arduinoIsAvailable = false;
  }
}

document.body.addEventListener('click', async () => {
  if (!port) await initArduino();
});

async function sendBlinkSignal(isBlinking) {
  if (!writer) {
    console.warn('Writer not ready');
    return;
  }
  const data = new TextEncoder().encode(isBlinking ? 'BLINK\n' : 'OPEN\n');
  await writer.write(data);
}
