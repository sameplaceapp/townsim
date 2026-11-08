const test = require('node:test');
const assert = require('node:assert/strict');
const { SimulationEngine } = require('../server/simulation/engine');
const { StateManager } = require('../server/persistence/stateManager');
const config = require('../config/default.json');

function makeEngine() {
  let now = 0;
  const original = StateManager.prototype.load;
  StateManager.prototype.load = () => null;
  let engine;
  try { engine = new SimulationEngine(config, null, () => now); }
  finally { StateManager.prototype.load = original; }
  engine.stateManager.saveRaw = () => {};
  engine.start();
  return { engine, advance(ms) { now += ms; engine.sync(); } };
}

test('clock and routines advance at 1x, 2x and 5x without timer drift', () => {
  const {engine, advance} = makeEngine();
  try {
    advance(4999); assert.equal(engine.world.time.minute, 0);
    advance(1); assert.equal(engine.world.time.minute, 1);
    advance(295000); assert.deepEqual(engine.world.time, {day:1,hour:7,minute:0});
    assert.equal(engine.world.tick, 6);
    assert.equal(engine.lastScheduleHour, 7);
    engine.setSpeed(2); advance(150000);
    assert.deepEqual(engine.world.time, {day:1,hour:8,minute:0});
    engine.setSpeed(5); advance(60000);
    assert.deepEqual(engine.world.time, {day:1,hour:9,minute:0});
    assert.equal(engine.world.tick, 18);
  } finally { engine.stop(); }
});

test('pause, speed changes, and saved fractional progress preserve elapsed time', () => {
  const {engine, advance} = makeEngine();
  try {
    advance(2500); engine.setSpeed(0);
    const before = JSON.stringify(engine.world.toJSON());
    advance(120000); assert.equal(JSON.stringify(engine.world.toJSON()), before);
    engine.setSpeed(2); advance(1250);
    assert.equal(engine.world.time.minute, 1);
    advance(1000);
    let saved;
    engine.stateManager.saveRaw = state => { saved = JSON.parse(JSON.stringify(state)); };
    engine.save();
    const other = makeEngine();
    try {
      other.engine.restoreState(saved);
      other.advance(3000);
      assert.equal(other.engine.world.time.minute, 2);
    } finally { other.engine.stop(); }
  } finally { engine.stop(); }
});

test('movement follows each path tile at 1.5 times the previous speed', () => {
  const {engine, advance} = makeEngine();
  try {
    const char = engine.world.characters[0];
    engine.world.grid = engine.world.grid.map(row => row.map(() => 0));
    char.pos = {x:1,y:1}; char.location = null; char.inside = false;
    engine.world.buildings.test_destination = { id:'test_destination', name:'Destination', door:[4,1] };
    engine.actionManager.assignAction(char, {type:'goto', target:'test_destination', then:'work'});
    assert.equal(char.path.length, 3);
    advance(6666); assert.deepEqual(char.pos, {x:1,y:1});
    advance(1); assert.deepEqual(char.pos, {x:2,y:1});
    engine.setSpeed(2); advance(6667);
    assert.deepEqual(char.pos, {x:4,y:1});
    assert.equal(char.location, 'test_destination');
    assert.equal(char.activity, 'work');
    assert.equal(char.path.length, 0);
  } finally { engine.stop(); }
});
