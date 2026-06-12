class InputHandler {
  constructor(canvasContainer, camera, onCharacterClick) {
    this.container = canvasContainer;
    this.camera = camera;
    this.onCharacterClick = onCharacterClick;
    this.dragging = false;
    this.lastMouse = { x: 0, y: 0 };
    this.keys = new Set();
    this.onManualPan = null; // Called when user manually pans (to break follow mode)

    this.container.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.container.addEventListener('mouseup', () => this.onMouseUp());
    this.container.addEventListener('mouseleave', () => this.onMouseUp());
    this.container.addEventListener('click', (e) => this.onClick(e));
    this.container.addEventListener('wheel', (e) => this.onWheel(e));

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Touch support
    this.container.addEventListener('touchstart', (e) => this.onTouchStart(e));
    this.container.addEventListener('touchmove', (e) => this.onTouchMove(e));
    this.container.addEventListener('touchend', () => this.onMouseUp());
  }

  onMouseDown(e) {
    this.dragging = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    this.dragDistance = 0;
  }

  onMouseMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.dragDistance += Math.abs(dx) + Math.abs(dy);
    this.camera.move(-dx, -dy);
    this.lastMouse = { x: e.clientX, y: e.clientY };
    // Break follow mode on manual drag
    if (this.dragDistance > 10 && this.onManualPan) {
      this.onManualPan();
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  onClick(e) {
    if (this.dragDistance > 5) return; // Was a drag, not a click

    const rect = this.container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = this.camera.screenToWorld(sx, sy);
    this.onCharacterClick(worldPos.x, worldPos.y);
  }

  onWheel(e) {
    e.preventDefault();
    // Wheel / pinch zooms toward the cursor; drag to pan
    const rect = this.container.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    this.camera.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  onTouchStart(e) {
    if (e.touches.length === 1) {
      this.dragging = true;
      this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      this.dragDistance = 0;
    }
  }

  onTouchMove(e) {
    if (!this.dragging || e.touches.length !== 1) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - this.lastMouse.x;
    const dy = e.touches[0].clientY - this.lastMouse.y;
    this.dragDistance += Math.abs(dx) + Math.abs(dy);
    this.camera.move(-dx, -dy);
    this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    // Break follow mode on manual drag
    if (this.dragDistance > 10 && this.onManualPan) {
      this.onManualPan();
    }
  }

  onKeyDown(e) {
    this.keys.add(e.key.toLowerCase());
  }

  onKeyUp(e) {
    this.keys.delete(e.key.toLowerCase());
  }

  update() {
    const speed = 8;
    let moved = false;
    if (this.keys.has('w') || this.keys.has('arrowup')) { this.camera.move(0, -speed); moved = true; }
    if (this.keys.has('s') || this.keys.has('arrowdown')) { this.camera.move(0, speed); moved = true; }
    if (this.keys.has('a') || this.keys.has('arrowleft')) { this.camera.move(-speed, 0); moved = true; }
    if (this.keys.has('d') || this.keys.has('arrowright')) { this.camera.move(speed, 0); moved = true; }
    if (this.keys.has('=') || this.keys.has('+')) {
      this.camera.zoomAt(1.04, this.camera.viewWidth / 2, this.camera.viewHeight / 2);
    }
    if (this.keys.has('-') || this.keys.has('_')) {
      this.camera.zoomAt(1 / 1.04, this.camera.viewWidth / 2, this.camera.viewHeight / 2);
    }
    // Break follow mode on WASD/arrow pan
    if (moved && this.onManualPan) {
      this.onManualPan();
    }
  }
}
