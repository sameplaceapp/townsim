const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SimulationEngine } = require('../server/simulation/engine');
const { StateManager } = require('../server/persistence/stateManager');
const { exportWorld, backupFilename } = require('../server/backup/export');
const config = require('../config/default.json');

function emptyEngine() {
  const load = StateManager.prototype.load;
  StateManager.prototype.load = () => null;
  try { return new SimulationEngine(config, null, () => 0); }
  finally { StateManager.prototype.load = load; }
}

test('exported snapshot restores the complete world without modifying it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-backup-'));
  try {
    const engine = emptyEngine();
    engine.world.time = {day:42,hour:17,minute:23};
    engine.world.tick = 320;
    engine.minuteProgress = 1234;
    engine.logicProgress = 4000;
    engine.world.grid[1][1] = 9;
    engine.world.characters[0].pos = {x:5,y:6};
    engine.world.characters[0].path = [{x:6,y:6}];
    engine.world.characters[0].relationships.bob = {affection:8,trust:7,attraction:2,respect:5,level:7,tag:'friend'};
    engine.world.addLog({char:'alice',text:'Testing'});
    engine.dramaEngine.townMood = 0.7;
    engine.llmBatcher.budget.state = {day:'2026-01-01',used:3};
    const before = JSON.stringify(engine.createSnapshot());
    const created = new Date('2026-01-01T12:34:56.789Z');
    const result = exportWorld(engine, created);
    assert.equal(JSON.stringify(engine.createSnapshot()), before);
    assert.equal(engine.llmBatcher.budget.state.used, 3);
    assert(!result.includes('LLM_API_KEY'));
    const backup = JSON.parse(result);
    assert.equal(backup._backup.formatVersion,1);
    assert.equal(backup._backup.applicationVersion, require('../package.json').version);
    assert.equal(backup._backup.createdAt,created.toISOString());
    assert.deepEqual(backup._backup.simulationTime,engine.world.time);
    assert.deepEqual(backup._backup.aiRequestBudget,{day:'2026-01-01',used:3});
    assert.match(backupFilename(created),/^willowbrook-backup-2026-01-01T12-34-56-789Z\.json$/);
    const file = path.join(dir,'state.json');
    fs.writeFileSync(file,result);
    const loaded = new StateManager(file).load();
    const restored = emptyEngine();
    restored.restoreState(loaded);
    restored.dramaEngine.fromJSON(loaded.drama);
    assert.deepEqual(restored.createSnapshot(), engine.createSnapshot());
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('export refuses to claim a complete backup when the request budget is unreadable', () => {
  const engine = emptyEngine();
  engine.llmBatcher.budget.error = 'invalid budget';
  assert.throws(() => exportWorld(engine), /request counter is unavailable/);
});

test('backup route accepts direct local browser requests and rejects forwarded or cross-origin access', async () => {
  const express = require('express');
  const http = require('http');
  const app = express();
  const engine = emptyEngine();
  app.set('engine', engine);
  app.use('/api', require('../server/api/routes'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {'Origin':base, 'X-Willowbrook-Backup':'1'};
    const request = (h) => fetch(base + '/api/backup', {method:'POST',headers:h});
    const before = JSON.stringify(engine.createSnapshot());
    const ok = await request(headers);
    assert.equal(ok.status,200);
    assert.match(ok.headers.get('content-disposition'), /willowbrook-backup-.*\.json/);
    assert.equal(ok.headers.get('cache-control'),'no-store');
    assert.equal((await ok.json())._backup.format,'willowbrook-world-backup');
    assert.equal(JSON.stringify(engine.createSnapshot()),before);
    assert.equal((await request({...headers,Origin:'https://example.com'})).status,403);
    assert.equal((await request({...headers,'X-Forwarded-For':'203.0.113.1'})).status,403);
    assert.equal((await request({Origin:base})).status,403);
    assert.equal((await fetch(base + '/api/backup')).status,404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Docker bridge trust selects the default gateway and private IPv4 addresses only', () => {
  const { dockerGateway, trustedDockerGateway, isPrivateIPv4 } = require('../server/backup/dockerGateway');
  const routes = 'Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 00000000 010011AC 0003 0 0 0 00000000\neth0 000011AC 00000000 0001 0 0 0 0000FFFF\n';
  assert.equal(dockerGateway(routes), '172.17.0.1');
  assert.equal(dockerGateway('Iface Destination Gateway Flags\neth0 000011AC 00000000 0001\n'), null);
  assert.equal(isPrivateIPv4('192.168.10.26'), true);
  assert.equal(isPrivateIPv4('10.2.3.4'), true);
  assert.equal(isPrivateIPv4('172.31.0.1'), true);
  assert.equal(isPrivateIPv4('172.32.0.1'), false);
  assert.equal(isPrivateIPv4('0.0.0.0'), false);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  const oldFlag = process.env.WILLOWBROOK_BACKUP_DOCKER_GATEWAY;
  const oldBind = process.env.WILLOWBROOK_BACKUP_BIND_ADDRESS;
  try {
    process.env.WILLOWBROOK_BACKUP_DOCKER_GATEWAY = '1';
    process.env.WILLOWBROOK_BACKUP_BIND_ADDRESS = '0.0.0.0';
    assert.equal(trustedDockerGateway(), null);
    process.env.WILLOWBROOK_BACKUP_BIND_ADDRESS = '8.8.8.8';
    assert.equal(trustedDockerGateway(), null);
  } finally {
    if (oldFlag === undefined) delete process.env.WILLOWBROOK_BACKUP_DOCKER_GATEWAY;
    else process.env.WILLOWBROOK_BACKUP_DOCKER_GATEWAY = oldFlag;
    if (oldBind === undefined) delete process.env.WILLOWBROOK_BACKUP_BIND_ADDRESS;
    else process.env.WILLOWBROOK_BACKUP_BIND_ADDRESS = oldBind;
  }
});
