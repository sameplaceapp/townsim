class Camera {
  constructor(tilesW, tilesH, tileSize, zoom = 2.5) {
    this.tilesW = tilesW;
    this.tilesH = tilesH;
    this.tileSize = tileSize;
    this.zoom = zoom;
    this.minZoom = 1.4;
    this.maxZoom = 6;
    this.x = 0;
    this.y = 0;
    this.viewWidth = 0;
    this.viewHeight = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.lerp = 0.15;
  }

  get ts() {
    return this.tileSize * this.zoom;
  }

  get worldWidth() {
    return this.tilesW * this.ts;
  }

  get worldHeight() {
    return this.tilesH * this.ts;
  }

  setWorldSize(tilesW, tilesH) {
    this.tilesW = tilesW;
    this.tilesH = tilesH;
  }

  setViewSize(width, height) {
    this.viewWidth = width;
    this.viewHeight = height;
    this.x = (this.worldWidth - width) / 2;
    this.y = (this.worldHeight - height) / 2;
    this.targetX = this.x;
    this.targetY = this.y;
    this.clamp();
    this.targetX = this.x;
    this.targetY = this.y;
  }

  move(dx, dy) {
    this.targetX += dx;
    this.targetY += dy;
    this.clampTarget();
  }

  centerOn(worldX, worldY) {
    this.targetX = worldX * this.ts - this.viewWidth / 2;
    this.targetY = worldY * this.ts - this.viewHeight / 2;
    this.clampTarget();
  }

  // Zoom by a factor, keeping the world point under (anchorX, anchorY) fixed
  zoomAt(factor, anchorX, anchorY) {
    const oldTs = this.ts;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (newZoom === this.zoom) return;
    const wx = (this.x + anchorX) / oldTs;
    const wy = (this.y + anchorY) / oldTs;
    this.zoom = newZoom;
    this.x = wx * this.ts - anchorX;
    this.y = wy * this.ts - anchorY;
    this.clamp();
    this.targetX = this.x;
    this.targetY = this.y;
  }

  update() {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.x += dx * this.lerp;
      this.y += dy * this.lerp;
      this.clamp();
    } else {
      this.x = this.targetX;
      this.y = this.targetY;
    }
  }

  // Clamp to world bounds; center the world when it is smaller than the view
  clampAxis(v, world, view) {
    if (world <= view) return (world - view) / 2;
    return Math.max(0, Math.min(world - view, v));
  }

  clamp() {
    this.x = this.clampAxis(this.x, this.worldWidth, this.viewWidth);
    this.y = this.clampAxis(this.y, this.worldHeight, this.viewHeight);
  }

  clampTarget() {
    this.targetX = this.clampAxis(this.targetX, this.worldWidth, this.viewWidth);
    this.targetY = this.clampAxis(this.targetY, this.worldHeight, this.viewHeight);
  }

  screenToWorld(screenX, screenY) {
    return {
      x: Math.floor((screenX + this.x) / this.ts),
      y: Math.floor((screenY + this.y) / this.ts)
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.ts - this.x,
      y: worldY * this.ts - this.y
    };
  }

  isVisible(worldX, worldY) {
    const screen = this.worldToScreen(worldX, worldY);
    return screen.x > -this.ts && screen.x < this.viewWidth + this.ts &&
           screen.y > -this.ts && screen.y < this.viewHeight + this.ts;
  }
}
