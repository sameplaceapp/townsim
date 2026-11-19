#!/usr/bin/env node
// Run deterministic, rule-based worlds without reading or writing saved state.
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const days = Number(process.argv[3] || 14);
const seeds = Number(process.argv[4] || 10);
const scenario = process.argv[5] || 'normal';
if (!Number.isInteger(days) || days < 1 || !Number.isInteger(seeds) || seeds < 1) throw Error('Days and seeds must be positive integers');
if (!['normal', 'social'].includes(scenario)) throw Error('Scenario must be normal or social');
const config = require(path.join(root, 'config/default.json'));
const { SimulationEngine } = require(path.join(root, 'server/simulation/engine'));
const { StateManager } = require(path.join(root, 'server/persistence/stateManager'));
StateManager.prototype.load = () => null;
delete process.env.LLM_BASE_URL;
const originalRandom = Math.random;
const originalError = console.error;
const totals = { scenario, seeds, daysPerSeed: days, significantInteractions:0, romance:0, conflict:0,
  storylines:0, romanticStories:0, conflictStories:0, climaxes:0, quietDays:0, simulationErrors:0 };
console.error = (...args) => {
  if (args[0] === 'LLM batch error:') totals.simulationErrors++;
  originalError(...args);
};
try {
  for (let seed = 1; seed <= seeds; seed++) {
    let state = seed;
    Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    let now = 0;
    const engine = new SimulationEngine(config, null, () => now);
    engine.stateManager.saveRaw = () => {};
    const startMinute = (engine.world.time.day - 1) * 1440 + engine.world.time.hour * 60 + engine.world.time.minute;
    if (scenario === 'social') {
      // An established social situation with reciprocal attraction and existing
      // friction, used to exercise events that are uncommon in a fresh town.
      const [bob, dave, emma, ivy] = ['bob', 'dave', 'emma', 'ivy'].map(id => engine.world.characters.find(c => c.id === id));
      const spot = {x:28, y:23};
      if (!engine.world.isWalkable(spot.x, spot.y)) throw Error('Scenario location is not walkable');
      for (const c of [bob, dave, emma, ivy]) {
        c.pos = { ...spot }; c.inside = false; c.location = null; c.path = [];
        c.activity = 'idle'; c.activityData = {ticksRemaining:0}; c.needs.social = 9;
      }
      for (const [a, b, affection, trust, attraction] of [[emma,bob,7,6,6],[ivy,bob,7,6,6],[dave,emma,2,2,1]]) {
        for (const [from,to] of [[a,b],[b,a]]) {
          engine.interactions.ensureRelationship(from,to);
          Object.assign(from.relationships[to.id], {affection,trust,attraction,interactionCount:8});
        }
      }
    }
    const daysWithEvents = new Set();
    const noteEventDay = () => {
      const time = engine.world.time;
      const elapsed = (time.day - 1) * 1440 + time.hour * 60 + time.minute - startMinute;
      const day = Math.max(0, Math.ceil(elapsed / 1440) - 1);
      if (day < days) daysWithEvents.add(day);
    };
    const interaction = engine.interactions.updateRelationship.bind(engine.interactions);
    engine.interactions.updateRelationship = (a, b, action) => {
      if (['flirt','confess','argue','confront'].includes(action)) {
        totals.significantInteractions++;
        totals[['flirt','confess'].includes(action) ? 'romance' : 'conflict']++;
        noteEventDay();
      }
      return interaction(a, b, action);
    };
    const create = engine.dramaEngine.createStoryline.bind(engine.dramaEngine);
    engine.dramaEngine.createStoryline = (...args) => {
      const story = create(...args);
      if (story) {
        totals.storylines++;
        if (['love_triangle','forbidden_friendship'].includes(story.type)) totals.romanticStories++;
        if (['rivalry','grudge_match'].includes(story.type)) totals.conflictStories++;
        noteEventDay();
      }
      return story;
    };
    const updatePhase = engine.dramaEngine.updateStorylinePhase.bind(engine.dramaEngine);
    engine.dramaEngine.updateStorylinePhase = (story, tick) => {
      const oldPhase = story.phase;
      updatePhase(story, tick);
      if (oldPhase !== 'climax' && story.phase === 'climax') { totals.climaxes++; noteEventDay(); }
    };
    engine.start();
    now = days * 24 * 60 * config.simulation.minuteInterval;
    engine.sync();
    engine.stop();
    totals.quietDays += days - daysWithEvents.size;
  }
} finally { Math.random = originalRandom; console.error = originalError; }
const worldDays = days * seeds;
console.log(JSON.stringify({ ...totals, worldDays, significantPerDay:totals.significantInteractions/worldDays, storylinesPerDay:totals.storylines/worldDays, quietDayPercent:100*totals.quietDays/worldDays }, null, 2));
