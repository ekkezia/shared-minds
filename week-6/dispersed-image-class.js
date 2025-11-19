export class DispersedImage {
  constructor(
    imgData,
    pixelSize = 10,
    location = { x: 0, y: 0 },
    email,
    authTime,
    sessionTime = 5 * 60 * 1000,
  ) {
    this.location = location;
    this.pixelSize = pixelSize;
    this.email = email;
    this.authTime = authTime;
    this.sessionTime = sessionTime;
    this.endTime = authTime + sessionTime;

    this.progress = 0;
    this.maxDisperse = 10;
    this.disperse = 0;

    this.img = null;
    this.imgData = null;
    this.centerX = 0;
    this.centerY = 0;

    this.ready = new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        this.img = img;

        // Create offscreen canvas to read pixel data
        const offCanvas = document.createElement('canvas');
        offCanvas.width = img.width;
        offCanvas.height = img.height;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0);

        this.imgData = offCtx.getImageData(0, 0, img.width, img.height);
        this.centerX = img.width / 2;
        this.centerY = img.height / 2;

        resolve(this);
      };

      img.onerror = reject;

      if (imgData instanceof Blob) {
        img.src = URL.createObjectURL(imgData);
      } else if (typeof imgData === 'string') {
        img.src = imgData;
      } else {
        reject(new Error('imgData must be a Blob or a base64/data URL string'));
      }
    });
  }

  updateLive() {
    const currentTime = Date.now();
    const remaining = this.endTime - currentTime;
    this.progress = Math.min(1 - remaining / this.sessionTime, 1);
    this.disperse = this.progress * this.maxDisperse;
  }

  updateForTime(targetTime) {
    const elapsed = targetTime - this.authTime;
    this.progress = Math.max(0, Math.min(elapsed / this.sessionTime, 1));
    this.disperse = this.progress * this.maxDisperse;
  }

  getRemainingTime() {
    return Math.max(this.endTime - Date.now(), 0);
  }

  updateSessionTime(newSessionTime) {
    this.sessionTime = newSessionTime;
    this.endTime = Date.now() + this.sessionTime;
    this.updateLive();

    console.log(
      `📊 ${this.email}: session=${this.sessionTime}ms, end=${new Date(
        this.endTime,
      ).toLocaleTimeString()}`,
    );
  }

  display(ctx) {
    if (!this.img || !this.imgData) return;

    ctx.save();

    const baseX = this.location.x - this.centerX;
    const baseY = this.location.y - this.centerY;

    for (let y = 0; y < this.img.height; y += this.pixelSize) {
      for (let x = 0; x < this.img.width; x += this.pixelSize) {
        const i = (x + y * this.img.width) * 4;
        const r = this.imgData.data[i];
        const g = this.imgData.data[i + 1];
        const b = this.imgData.data[i + 2];
        const a = this.imgData.data[i + 3];

        if (a < 10) continue; // Skip transparent pixels

        ctx.fillStyle = `rgb(${r},${g},${b})`;

        const xOffset = (x - this.centerX) * this.disperse;
        const yOffset = (y - this.centerY) * this.disperse;

        ctx.fillRect(
          baseX + x + xOffset,
          baseY + y + yOffset,
          this.pixelSize,
          this.pixelSize,
        );
      }
    }

    ctx.restore();
  }

  drawLabel(ctx) {
    if (!this.img) return;

    const x = this.location.x + this.img.width / 2 + 10;
    const y = this.location.y - this.img.height / 2;

    const padding = 6;
    const elapsed = Math.floor((Date.now() - this.authTime) / 1000);
    const remaining = Math.floor((this.endTime - Date.now()) / 1000);

    const textLines = [
      `${this.email || 'unknown'}`,
      `+${elapsed}s`,
      `-${remaining}s`,
    ];

    ctx.font = '12px sans-serif';
    const width =
      Math.max(...textLines.map((t) => ctx.measureText(t).width)) + padding * 2;
    const height = textLines.length * 14 + padding * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#fff';
    textLines.forEach((line, i) => {
      ctx.fillText(line, x + padding, y + padding + i * 14);
    });
  }
}
