export class MyImage {
  constructor(centerImg = null, width = 1920, height = 1080) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    this.#drawRandomBackground();

    if (centerImg) {
      this.#drawCenterImage(centerImg);
    }
  }

  #drawCenterImage(centerImg) {
    const width = this.canvas.width / 3;
    const height = this.canvas.height / 3;
    const x = width; // may want to custom this later
    const y = height;
    this.ctx.drawImage(centerImg.canvas, x, y, width, height);
  }

  #drawRandomBackground() {
    const { width, height } = this.canvas;

    const hue = Math.random() * 360;
    this.ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.fillStyle = `hsl(${Math.random() * 360}, 100%, 50%)`;
    for (let i = width / 4; i < width; i += width / 4) {
      for (let j = height / 4; j < height; j += height / 4) {
        const radius = 50;
        this.ctx.beginPath();
        this.ctx.arc(i, j, radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  addTo(parent) {
    parent.appendChild(this.canvas);
  }
  addClass(className) {
    this.canvas.classList.add(className);
  }

  draw(ctx, x, y, width, height) {
    ctx.drawImage(this.canvas, x, y, width, height);
  }
}
