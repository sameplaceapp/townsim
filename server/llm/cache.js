class DecisionCache {
  constructor() {
    this.cache = new Map();
    this.maxAge = 50; // ticks
    this.maxSize = 200;
  }

  getKey(char, world) {
    const nearbyIds = world.getCharactersNear(char.pos.x, char.pos.y, 2)
      .filter(c => c.id !== char.id)
      .map(c => c.id)
      .sort()
      .join(',');

    // Round needs to nearest 2 for cache matching
    const h = Math.round(char.needs.hunger / 2) * 2;
    const e = Math.round(char.needs.energy / 2) * 2;
    const s = Math.round(char.needs.social / 2) * 2;

    const mood = char.mood || 'none';
    const activity = char.activity || 'idle'; // BUG-15: include activity in cache key
    return `${char.id}|${char.location || 'out'}|${activity}|${nearbyIds}|${h}${e}${s}|${world.phase}|${mood}`;
  }

  get(char, world) {
    const key = this.getKey(char, world);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (world.tick - entry.tick > this.maxAge) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  set(char, world, result) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entries
      const entries = [...this.cache.entries()];
      entries.sort((a, b) => a[1].tick - b[1].tick);
      for (let i = 0; i < 50; i++) {
        this.cache.delete(entries[i][0]);
      }
    }

    const key = this.getKey(char, world);
    this.cache.set(key, { result, tick: world.tick });
  }
}

module.exports = { DecisionCache };
