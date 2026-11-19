const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { SimulationEngine } = require('../server/simulation/engine');
const { DramaEngine } = require('../server/simulation/dramaEngine');

const source = fs.readFileSync(require.resolve('../public/js/ui.js'), 'utf8');
const UI = vm.runInNewContext(`${source}\nUI`);

function display() {
  const ui = Object.create(UI.prototype);
  ui.activeFilter = 'drama';
  ui.eventListEl = { innerHTML: '', querySelectorAll: () => [] };
  return ui;
}

test('saved and live drama snapshots render active and latest resolved stories without changing history', () => {
  const original = new DramaEngine({});
  original.activeStorylines = [
    { id: 'one', type: 'rivalry', participants: ['a', 'b'], startTick: 3 },
    { id: 'two', type: 'love_triangle', participants: ['a'], startTick: 8, description: '<unsafe>' }
  ];
  original.resolvedStorylines = Array.from({ length: 12 }, (_, i) => ({ id: `old${i}`, title: `Past ${i}`, participants: ['b'], outcome: 'Settled' }));
  const engine = Object.create(SimulationEngine.prototype);
  engine.dramaEngine = original;
  engine.sync = () => {};
  engine.world = { toJSON: () => ({ characters: [] }) };
  engine.getTiming = () => ({});
  const characters = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
  const ui = display();
  ui.updateDrama(engine.getState().drama, characters);
  let html = ui.eventListEl.innerHTML;
  assert.ok(html.indexOf('Love triangle') < html.indexOf('Rivalry'));
  assert.match(html, /Alice, Bob/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.ok(html.indexOf('Past 11') < html.indexOf('Past 10'));
  assert.ok(!html.includes('Past 1<'));
  assert.equal(original.resolvedStorylines.length, 12);

  const added = { id: 'new', title: 'New story', participants: ['a'], startTick: 10 };
  original.activeStorylines.push(added);
  ui.updateDrama(engine.getDramaDisplayState(), characters);
  assert.match(ui.eventListEl.innerHTML, /New story/);
  original.activeStorylines = original.activeStorylines.filter(s => s !== added);
  original.resolvedStorylines.push(added);
  let broadcast;
  engine.wss = { broadcast: data => { broadcast = data; } };
  Object.assign(engine.world, { tick: 20, time: {}, phase: 'morning', getTimeString: () => '', characters: [], activityLog: [] });
  engine.broadcastState();
  ui.updateDrama(broadcast.drama, characters);
  html = ui.eventListEl.innerHTML;
  assert.ok(html.indexOf('New story') > html.indexOf('Recently Resolved'));
  assert.ok(html.indexOf('New story') < html.indexOf('Past 11'));
  assert.ok(!html.includes('Past 2<'));
  assert.equal(original.resolvedStorylines.length, 13);

  const restored = new DramaEngine({});
  restored.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));
  engine.dramaEngine = restored;
  const refreshed = display();
  refreshed.updateDrama(engine.getState().drama, characters);
  assert.equal(refreshed.eventListEl.innerHTML, html);
});

test('empty sections and tracked resolution days are displayed in newest-first order', () => {
  const ui = display();
  ui.updateDrama({activeStorylines: [], resolvedStorylines: []}, []);
  assert.match(ui.eventListEl.innerHTML, /No active drama right now\./);
  assert.match(ui.eventListEl.innerHTML, /No resolved drama yet\./);
  const engine = Object.create(SimulationEngine.prototype);
  engine.dramaEngine = { activeStorylines: [], resolvedStorylines: [
    { id: 'new', title: 'Latest', resolutionDay: 20 },
    { id: 'old', title: 'Earlier', resolutionDay: 2 }
  ] };
  ui.updateDrama(engine.getDramaDisplayState(), []);
  assert.ok(ui.eventListEl.innerHTML.indexOf('Latest') < ui.eventListEl.innerHTML.indexOf('Earlier'));
  assert.match(ui.eventListEl.innerHTML, /Resolved Day 20/);
});
