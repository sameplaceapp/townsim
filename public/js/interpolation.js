class Interpolator {
  constructor(tickInterval) {
    this.tickInterval = tickInterval;
    this.lastTickTime = Date.now();
    this.positions = new Map(); // charId -> { prev, current, interpolated }
  }

  onTick(characters) {
    this.lastTickTime = Date.now();
    for (const char of characters) {
      const entry = this.positions.get(char.id);
      if (entry) {
        entry.prev = { ...entry.current };
        entry.current = { ...char.pos };
      } else {
        this.positions.set(char.id, {
          prev: { ...char.pos },
          current: { ...char.pos },
          interpolated: { ...char.pos }
        });
      }
    }
  }

  getPosition(charId) {
    const entry = this.positions.get(charId);
    if (!entry) return null;

    const elapsed = Date.now() - this.lastTickTime;
    const t = Math.min(elapsed / this.tickInterval, 1);

    return {
      x: entry.prev.x + (entry.current.x - entry.prev.x) * t,
      y: entry.prev.y + (entry.current.y - entry.prev.y) * t
    };
  }
}
