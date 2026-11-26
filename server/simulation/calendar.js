const { EventEmitter } = require('node:events');

// Calendar dates are derived from the world's absolute simulation day.
class Calendar extends EventEmitter {
  constructor(world, config, saved) {
    super();
    let daysPerYear;
    if (saved !== undefined) {
      if (!saved || saved.version !== 1) throw new Error('Unsupported or invalid saved calendar');
      daysPerYear = saved.daysPerYear;
    } else {
      const configured = process.env.CALENDAR_DAYS_PER_YEAR;
      if (configured !== undefined && configured !== '') {
        if (!/^\d+$/.test(configured)) throw new Error('CALENDAR_DAYS_PER_YEAR must be a positive integer');
        daysPerYear = Number(configured);
      } else {
        daysPerYear = config?.daysPerYear ?? 12;
      }
    }
    if (!Number.isSafeInteger(daysPerYear) || daysPerYear < 1) throw new Error('Calendar days per year must be a positive safe integer');
    Object.defineProperty(this, 'daysPerYear', { value: daysPerYear, enumerable: true });
    this.world = world;
    this.lastNotifiedDay = world.time.day;
    this.anniversaries = new Map();
  }

  dateForDay(day) {
    if (!Number.isSafeInteger(day) || day < 1) throw new TypeError('Invalid simulation day');
    return { year: Math.floor((day - 1) / this.daysPerYear) + 1,
      dayOfYear: (day - 1) % this.daysPerYear + 1, daysPerYear: this.daysPerYear };
  }
  current() { return this.dateForDay(this.world.time.day); }
  isAnniversary(day, dayOfYear) {
    if (!Number.isSafeInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > this.daysPerYear) throw new TypeError('Invalid anniversary day');
    return this.dateForDay(day).dayOfYear === dayOfYear;
  }
  onAnniversary(dayOfYear, listener) {
    this.isAnniversary(this.world.time.day, dayOfYear);
    if (typeof listener !== 'function') throw new TypeError('Anniversary listener must be a function');
    let listeners = this.anniversaries.get(dayOfYear);
    if (!listeners) { listeners = new Set(); this.anniversaries.set(dayOfYear, listeners); }
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.anniversaries.delete(dayOfYear); };
  }
  // Invoked only on an actual world-clock day boundary, never on load.
  dayStarted(day) {
    if (day !== this.world.time.day) throw new Error('Calendar day must match the simulation clock');
    if (day <= this.lastNotifiedDay) return;
    this.lastNotifiedDay = day;
    const date = Object.freeze({ absoluteDay: day, ...this.dateForDay(day) });
    this.emit('day', date);
    if (date.dayOfYear === 1) this.emit('year', date);
    const listeners = this.anniversaries.get(date.dayOfYear);
    if (listeners) for (const listener of listeners) listener(date);
  }
  toJSON() { return { version: 1, daysPerYear: this.daysPerYear }; }
}
module.exports = { Calendar };
