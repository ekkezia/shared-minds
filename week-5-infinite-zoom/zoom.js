import { MyImage } from './image.js';

const imgs = initializeImages(100);
// imgs.forEach((image) => {
//   image.addClass('stage');
//   image.addTo(document.body);
// });

function initializeImages(count) {
  const imgs = [];
  for (let i = 0; i < count; i++) {
    const image = new MyImage(i != 0 && imgs[i - 1]);
    imgs.push(image);
  }
  return imgs;
}

const mainCanvas = document.getElementById('mainCanvas');
const mainCtx = mainCanvas.getContext('2d');
let offset = 0;
// zoom();
// with zoom by scrolling
window.addEventListener('wheel', (e) => {
  offset += e.deltaY * 0.01;
  zoom();
});

function zoom() {
  const index = Math.floor(offset);
  const img = imgs[index];

  const percent = offset - index;
  const scaler = 1 - percent; // 0-1 within current image
  const positionedScale = scaler * 2 + 1; // 1-3 overall scale, it changes index when it reach 3

  // console.log('position', positionedScale);

  const width = mainCanvas.width * positionedScale;
  const height = mainCanvas.height * positionedScale;
  const left = (mainCanvas.width - width) / 2;
  const top = (mainCanvas.height - height) / 2;
  img.draw(mainCtx, left, top, width, height);

  if (offset < imgs.length) {
    requestAnimationFrame(zoom);
  } else {
    offset = 0;
  }
}
