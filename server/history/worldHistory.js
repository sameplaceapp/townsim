const { isDeepStrictEqual } = require('node:util');

// Event types are deliberately explicit; add a new type when a simulation
// system is ready to record it, without changing the stored schema.
const EVENT_TYPES = Object.freeze([
  'relationship_changed', 'conflict', 'marriage', 'separation', 'birth', 'death',
  'occupation_changed', 'property_transferred', 'building_constructed',
  'settlement_founded', 'settlement_expanded', 'community_event'
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const KIND = /^[a-z][a-z0-9_]{0,63}$/;

function validTime(time) {
  return time && Number.isSafeInteger(time.day) && time.day >= 1 &&
    Number.isInteger(time.hour) && time.hour >= 0 && time.hour < 24 &&
    Number.isInteger(time.minute) && time.minute >= 0 && time.minute < 60;
}
function minuteNumber(t) { return (t.day * 24 + t.hour) * 60 + t.minute; }
function cloneJson(value) {
  const visit = (v, seen) => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean' ||
        (typeof v === 'number' && Number.isFinite(v))) return;
    if (typeof v !== 'object' || seen.has(v) ||
        (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) {
      throw new TypeError('metadata must contain only JSON values');
    }
    seen.add(v);
    for (const item of Object.values(v)) visit(item, seen);
    seen.delete(v);
  };
  visit(value, new Set());
  return JSON.parse(JSON.stringify(value));
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.id !== 'string' || !IDENTIFIER.test(input.id) ||
      !EVENT_TYPES.includes(input.type) || typeof input.description !== 'string' ||
      !input.description.trim() || input.description.length > 2000 ||
      !Array.isArray(input.entities) || input.entities.length > 50 ||
      input.entities.some(e => !e || typeof e.kind !== 'string' || !KIND.test(e.kind) ||
        typeof e.id !== 'string' || !IDENTIFIER.test(e.id))) {
    throw new TypeError('Invalid historical event');
  }
  const metadata = input.metadata === undefined ? {} : cloneJson(input.metadata);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('Invalid event metadata');
  if (Buffer.byteLength(JSON.stringify(metadata)) > 16384) throw new TypeError('Event metadata exceeds 16 KiB');
  return { id: input.id, type: input.type, description: input.description,
    entities: input.entities.map(e => ({ kind: e.kind, id: e.id })), metadata };
}

class WorldHistory {
  #events = [];
  #byId = new Map();

  constructor(world, saved) {
    this.world = world;
    if (saved === undefined) return;
    if (!saved || saved.version !== 1 || !Array.isArray(saved.events)) {
      throw new Error('Unsupported or invalid world history; refusing to overwrite saved history');
    }
    for (const event of saved.events) {
      const data = validateInput(event);
      if (!validTime(event.time) || this.#byId.has(data.id) ||
          (this.#events.length && minuteNumber(event.time) < minuteNumber(this.#events.at(-1).time))) {
        throw new Error('Invalid world history event order or identity');
      }
      const record = freeze({ ...data, time: { ...event.time } });
      this.#byId.set(record.id, record);
      this.#events.push(record);
    }
  }

  // The caller supplies a stable occurrence ID, e.g. storyline:42:resolved.
  // Reprocessing the same occurrence returns its original record and time.
  record(input) {
    const data = validateInput(input);
    const previous = this.#byId.get(data.id);
    if (previous) {
      const { time, ...original } = previous;
      if (!isDeepStrictEqual(original, data)) throw new Error('Historical event ID already used for a different event');
      return previous;
    }
    if (!validTime(this.world.time)) throw new Error('Invalid simulation time');
    if (this.#events.length && minuteNumber(this.world.time) < minuteNumber(this.#events.at(-1).time)) {
      throw new Error('Cannot record history before the most recent event');
    }
    const record = freeze({ ...data, time: { ...this.world.time } });
    this.#events.push(record);
    this.#byId.set(record.id, record);
    return record;
  }

  query({ type, entity, kind, limit = 50, offset = 0 } = {}) {
    if ((type !== undefined && !EVENT_TYPES.includes(type)) ||
        (entity !== undefined && (typeof entity !== 'string' || !IDENTIFIER.test(entity))) ||
        (kind !== undefined && (typeof kind !== 'string' || !KIND.test(kind) || entity === undefined)) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0) throw new TypeError('Invalid history query');
    const results = [];
    let matched = 0;
    for (const event of this.#events) {
      if (type && event.type !== type) continue;
      if (entity && !event.entities.some(e => e.id === entity && (!kind || e.kind === kind))) continue;
      if (matched++ < offset) continue;
      results.push(event);
      if (results.length === limit + 1) break;
    }
    const hasMore = results.length > limit;
    if (hasMore) results.pop();
    return { events: results, nextOffset: hasMore ? offset + limit : null };
  }

  toJSON() { return { version: 1, events: this.#events.slice() }; }
}

module.exports = { WorldHistory, EVENT_TYPES };
