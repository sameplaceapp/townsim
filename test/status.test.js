const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/js/ui.js'), 'utf8');
const UI = vm.runInNewContext(`${source}\nUI`);
const element = () => ({ textContent: '', title: '', className: '', style: {} });
function makeUI() {
  const ui = Object.create(UI.prototype);
  for (const name of ['dayDisplayEl', 'timeDisplayEl', 'phaseDisplayEl', 'phaseDotEl', 'connectionDotEl', 'connectionStatusEl', 'simulationStatusEl', 'charCountEl']) ui[name] = element();
  ui.connected = false;
  return ui;
}

test('status displays server state, zero residents, and clears stale values on disconnect', () => {
  const ui = makeUI();
  ui.setStatus('Connected');
  ui.updateTime('Day 3 12:30', 'afternoon');
  ui.updateSimulationStatus({paused:false,speed:2}, 12);
  assert.equal(ui.dayDisplayEl.textContent, 'Day 3');
  assert.equal(ui.timeDisplayEl.textContent, '12:30');
  assert.equal(ui.simulationStatusEl.textContent, 'Running 2×');
  assert.equal(ui.charCountEl.textContent, '12');
  ui.updateSimulationStatus({paused:true,speed:2}, 0);
  assert.equal(ui.simulationStatusEl.textContent, 'Paused · 2×');
  assert.equal(ui.charCountEl.textContent, '0');
  ui.setStatus('Disconnected - reconnecting...');
  ui.updateTime('Day 3 12:31', 'afternoon');
  ui.updateSimulationStatus({paused:false,speed:5}, 12);
  assert.equal(ui.connectionStatusEl.textContent, 'Disconnected');
  assert.equal(ui.timeDisplayEl.textContent, '--:--');
  assert.equal(ui.charCountEl.textContent, '—');
  assert.equal(ui.simulationStatusEl.textContent, '—');
  ui.setStatus('Connected');
  ui.updateTime('Day 3 13:00', 'afternoon');
  ui.updateSimulationStatus({paused:false,speed:5}, 11);
  assert.equal(ui.timeDisplayEl.textContent, '13:00');
  assert.equal(ui.simulationStatusEl.textContent, 'Running 5×');
  assert.equal(ui.charCountEl.textContent, '11');
});
