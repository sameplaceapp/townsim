class Camera {
  constructor(worldWidth, worldHeight, tileSize, scale) {
    this.worldWidth = worldWidth * tileSize * scale;
    this.worldHeight = worldHeight * tileSize * scale;
    this.tileSize = tileSize;
    this.scale = scale;
    this.x = 0;
    this.y = 0;
    this.viewWidth = 0;
    this.viewHeight = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.lerp = 0.15;
    this.dirty = true;
  }

  setViewSize(width, height) {
    this.viewWidth = width;
    this.viewHeight = height;
    // Center on town initially
    this.x = (this.worldWidth - width) / 2;
    this.y = (this.worldHeight - height) / 2;
    this.targetX = this.x;
    this.targetY = this.y;
    this.clamp();
    this.dirty = true;
  }

  move(dx, dy) {
    this.targetX += dx;
    this.targetY += dy;
    this.clampTarget();
  }

  centerOn(worldX, worldY) {
    const px = worldX * this.tileSize * this.scale;
    const py = worldY * this.tileSize * this.scale;
    this.targetX = px - this.viewWidth / 2;
    this.targetY = py - this.viewHeight / 2;
    this.clampTarget();
  }

  update() {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.x += dx * this.lerp;
      this.y += dy * this.lerp;
      this.clamp();
      this.dirty = true;
    } else if (this.x !== this.targetX || this.y !== this.targetY) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.dirty = true;
    }
  }

  clamp() {
    this.x = Math.max(0, Math.min(this.worldWidth - this.viewWidth, this.x));
    this.y = Math.max(0, Math.min(this.worldHeight - this.viewHeight, this.y));
  }

  clampTarget() {
    this.targetX = Math.max(0, Math.min(this.worldWidth - this.viewWidth, this.targetX));
    this.targetY = Math.max(0, Math.min(this.worldHeight - this.viewHeight, this.targetY));
  }

  screenToWorld(screenX, screenY) {
    const wx = (screenX + this.x) / (this.tileSize * this.scale);
    const wy = (screenY + this.y) / (this.tileSize * this.scale);
    return { x: Math.floor(wx), y: Math.floor(wy) };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.tileSize * this.scale - this.x,
      y: worldY * this.tileSize * this.scale - this.y
    };
  }

  isVisible(worldX, worldY) {
    const screen = this.worldToScreen(worldX, worldY);
    const ts = this.tileSize * this.scale;
    return screen.x > -ts && screen.x < this.viewWidth + ts &&
           screen.y > -ts && screen.y < this.viewHeight + ts;
  }
}
