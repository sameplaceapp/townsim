const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const { WorldHistory } = require('../server/history/worldHistory');
const { StateManager } = require('../server/persistence/stateManager');
const { SimulationEngine } = require('../server/simulation/engine');
const config = require('../config/default.json');

const event = (id, type = 'community_event', entities = [{ kind:'character', id:'alice' }]) =>
  ({ id, type, description:`Event ${id}`, entities, metadata:{ value:1 } });
const world = () => ({ time: {day:1, hour:6, minute:0} });

test('history validates, records stable timestamps, deduplicates, and pages chronological filters', () => {
  const w = world();
  const history = new WorldHistory(w);
  const input = event('a');
  const a = history.record(input);
  input.metadata.value = 99;
  input.entities[0].id = 'changed';
  const b = history.record(event('b', 'conflict', [{kind:'character',id:'bob'},{kind:'building',id:'park'}]));
  w.time.minute = 1;
  const c = history.record(event('c', 'conflict'));
  assert.deepEqual(a.time, {day:1,hour:6,minute:0});
  assert.equal(a.metadata.value, 1);
  assert.equal(a.entities[0].id, 'alice');
  assert.ok(Object.isFrozen(a.metadata));
  assert.equal(history.record(event('a')), a);
  const snapshot = history.toJSON();
  snapshot.events.pop();
  assert.equal(history.query().events.length, 3);
  assert.throws(() => history.record({...event('a'), description:'different'}), /already used/);
  assert.deepEqual(history.query().events.map(e => e.id), ['a','b','c']);
  assert.deepEqual(history.query({type:'conflict'}).events.map(e => e.id), ['b','c']);
  assert.deepEqual(history.query({entity:'alice',kind:'character'}).events.map(e => e.id), ['a','c']);
  assert.deepEqual(history.query({entity:'park',kind:'building'}).events.map(e => e.id), ['b']);
  assert.equal(history.query({limit:2}).nextOffset, 2);
  assert.deepEqual(history.query({limit:2,offset:2}).events.map(e => e.id), ['c']);
  assert.throws(() => history.record(event('bad','not_a_type')), /Invalid historical event/);
  assert.throws(() => history.record({...event('x'),entities:[{kind:'character',id:''}]}), /Invalid historical event/);
  assert.throws(() => history.record({...event('x'),metadata:{ n:NaN }}), /JSON values/);
  assert.throws(() => history.query({limit:101}), /Invalid history query/);
  w.time.day = 1; w.time.hour = 5;
  assert.throws(() => history.record(event('d')), /before the most recent event/);
  assert.deepEqual([a.id,b.id,c.id], ['a','b','c']);
});

test('headless world saves, restarts, preserves history and backups without duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'willow-history-'));
  const oldUrl = process.env.LLM_BASE_URL, oldLimit = process.env.LLM_DAILY_LIMIT, oldFile = process.env.LLM_API_KEY_FILE;
  try {
    process.env.LLM_BASE_URL = ''; process.env.LLM_DAILY_LIMIT = '0'; delete process.env.LLM_API_KEY_FILE;
    const file = path.join(dir,'state.json');
    let now = 0;
    const store = () => new StateManager(file);
    let engine = new SimulationEngine(config, null, () => now, store());
    assert.deepEqual(engine.history.query().events, []);
    engine.start();
    engine.history.record(event('world:one'));
    now = config.simulation.minuteInterval;
    engine.sync();
    engine.history.record(event('world:two', 'conflict'));
    assert.equal(engine.world.time.minute, 1);
    engine.stop(); engine.save(); engine.save();
    const backup = JSON.parse(fs.readFileSync(file + '.bak','utf8'));
    assert.deepEqual(backup.history.events.map(e => e.id), ['world:one','world:two']);
    engine = new SimulationEngine(config, null, () => now, store());
    assert.deepEqual(engine.history.query().events.map(e => e.time.minute), [0,1]);
    assert.equal(engine.history.record(event('world:one')).time.minute, 0);
    assert.equal(engine.history.query().events.length, 2);
    engine.save();
    engine = new SimulationEngine(config, null, () => now, store());
    assert.deepEqual(engine.history.query().events.map(e => e.id), ['world:one','world:two']);
    assert.equal(engine.getState().history, undefined);
    const older = store().load(); delete older.history; store().saveRaw(older);
    engine = new SimulationEngine(config, null, () => now, store());
    assert.deepEqual(engine.history.query().events, []);
    older.history = {version:99,events:[]}; store().saveRaw(older);
    assert.throws(() => new SimulationEngine(config, null, () => now, store()), /Unsupported or invalid world history/);
  } finally {
    if (oldUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = oldUrl;
    if (oldLimit === undefined) delete process.env.LLM_DAILY_LIMIT; else process.env.LLM_DAILY_LIMIT = oldLimit;
    if (oldFile === undefined) delete process.env.LLM_API_KEY_FILE; else process.env.LLM_API_KEY_FILE = oldFile;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('read-only history API supports bounded filters and rejects invalid queries', async () => {
  const history = new WorldHistory(world());
  history.record(event('a')); history.record(event('b','conflict'));
  const app = express(); app.set('engine', {history}); app.use('/api',require('../server/api/routes'));
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/history`;
    const response = await fetch(`${url}?type=conflict&entity=alice&kind=character&limit=1`);
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).events.map(e=>e.id),['b']);
    for (const query of ['?limit=101','?offset=-1','?type=bad','?kind=character','?entity=x&entity=y']) {
      assert.equal((await fetch(url+query)).status,400);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('fixture command restores the same event in a new process and refuses overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'willow-history-demo-'));
  try {
    const file = path.join(dir,'fixture.json');
    const script = path.join(__dirname,'../scripts/history-demo.js');
    const created = execFileSync(process.execPath,[script,'create',file],{encoding:'utf8'});
    const inspected = execFileSync(process.execPath,[script,'inspect',file],{encoding:'utf8'});
    const createdEvent = JSON.parse(created.slice(created.indexOf('{'))).events[0];
    const restoredEvent = JSON.parse(inspected.slice(inspected.indexOf('{'))).events[0];
    assert.equal(createdEvent.id, 'demo:community:1');
    assert.deepEqual(restoredEvent, createdEvent);
    const saved = fs.readFileSync(file,'utf8');
    assert.throws(() => execFileSync(process.execPath,[script,'create',file],{stdio:'ignore'}));
    assert.equal(fs.readFileSync(file,'utf8'),saved);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('isolated headless fixture serves the same event after a server restart', async () => {
  const { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'willow-history-server-'));
  const file = path.join(dir,'fixture.json');
  const script = path.join(__dirname,'../scripts/history-demo.js');
  let child;
  const start = () => new Promise((resolve, reject) => {
    child = spawn(process.execPath,[script,'serve',file,'0'],{stdio:['ignore','pipe','pipe']});
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/History fixture listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) resolve(match[1]);
    });
    child.once('error', reject);
    child.once('exit', code => { if (code) reject(new Error(`Fixture server exited: ${code}`)); });
  });
  const stop = () => new Promise((resolve, reject) => {
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Fixture server exited: ${code}`)));
    child.kill('SIGTERM');
  });
  try {
    execFileSync(process.execPath,[script,'create',file],{stdio:'ignore'});
    let address = await start();
    const before = await (await fetch(`${address}/api/history`)).json();
    await stop();
    address = await start();
    const after = await (await fetch(`${address}/api/history`)).json();
    assert.deepEqual(after, before);
    await stop();
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
