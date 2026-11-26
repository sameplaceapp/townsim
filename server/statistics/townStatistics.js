class TownStatistics {
  #population = [];
  constructor(saved) {
    if (saved === undefined) return;
    if (!saved || saved.version !== 1 || !Array.isArray(saved.population)) throw new Error('Invalid town statistics');
    let lastDay = 0;
    for (const row of saved.population) {
      if (!row || !Number.isSafeInteger(row.day) || row.day <= lastDay ||
          !Number.isSafeInteger(row.population) || row.population < 0) throw new Error('Invalid population observation');
      this.#population.push(Object.freeze({day:row.day, population:row.population}));
      lastDay = row.day;
    }
  }
  observe(day, population) {
    if (!Number.isSafeInteger(day) || day < 1 || !Number.isSafeInteger(population) || population < 0) throw new TypeError('Invalid population observation');
    if (day <= (this.#population.at(-1)?.day || 0)) return false;
    this.#population.push(Object.freeze({day, population}));
    return true;
  }
  page({beforeDay, limit = 50} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        (beforeDay !== undefined && (!Number.isSafeInteger(beforeDay) || beforeDay < 1))) throw new TypeError('Invalid statistics query');
    let lo=0, hi=this.#population.length;
    const before=beforeDay ?? Infinity;
    while (lo < hi) { const middle=(lo+hi) >>> 1; if (this.#population[middle].day < before) lo=middle+1; else hi=middle; }
    const start=Math.max(0,lo-limit);
    return {observations:this.#population.slice(start,lo), nextBeforeDay:start ? this.#population[start].day : null};
  }
  toJSON() { return {version:1,population:this.#population.slice()}; }
}
module.exports = {TownStatistics};
