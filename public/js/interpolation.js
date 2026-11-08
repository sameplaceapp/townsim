class Interpolator {
  constructor() {
    this.positions = new Map();
    this.speed = 1;
    this.paused = false;
    this.duration = 6666.666666666667;
    this.lastUpdate = performance.now();
  }

  advance(now = performance.now()) {
    const elapsed = this.paused ? 0 : Math.max(0, now - this.lastUpdate) * this.speed;
    this.lastUpdate = now;
    for (const entry of this.positions.values()) {
      entry.progress = Math.min(this.duration, entry.progress + elapsed);
    }
  }

  onTick(characters, timing = {}) {
    this.advance();
    this.speed = timing.speed || 1;
    this.paused = !!timing.paused;
    this.duration = timing.movementInterval || this.duration;
    for (const char of characters) {
      const entry = this.positions.get(char.id);
      if (!entry) {
        this.positions.set(char.id, { from: { ...char.pos }, to: { ...char.pos }, progress: this.duration });
      } else if (entry.to.x !== char.pos.x || entry.to.y !== char.pos.y) {
        const t = Math.min(entry.progress / this.duration, 1);
        entry.from = { x: entry.from.x + (entry.to.x - entry.from.x) * t,
          y: entry.from.y + (entry.to.y - entry.from.y) * t };
        entry.to = { ...char.pos };
        entry.progress = 0;
      }
    }
  }

  getPosition(charId) {
    this.advance();
    const entry = this.positions.get(charId);
    if (!entry) return null;
    const t = Math.min(entry.progress / this.duration, 1);
    return { x: entry.from.x + (entry.to.x - entry.from.x) * t,
      y: entry.from.y + (entry.to.y - entry.from.y) * t };
  }

  isMoving(charId) {
    this.advance();
    const entry = this.positions.get(charId);
    return !!entry && entry.progress < this.duration &&
      (entry.from.x !== entry.to.x || entry.from.y !== entry.to.y);
  }
}
