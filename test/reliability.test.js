const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateManager } = require('../server/persistence/stateManager');
const { RequestBudget } = require('../server/llm/budget');
const { SimulationEngine } = require('../server/simulation/engine');
const config = require('../config/default.json');

test('world snapshots preserve dynamic residents and terrain; backup recovers corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'townsim-'));
  try {
    const store = new StateManager(path.join(dir, 'state.json'));
    const originalLoad = StateManager.prototype.load;
    StateManager.prototype.load = () => null;
    let engine;
    try { engine = new SimulationEngine(config, null); } finally { StateManager.prototype.load = originalLoad; }
    engine.stateManager = store;
    engine.world.grid[0][0] = 9;
    const resident = engine.world.characters[0];
    const { Character } = require('../server/simulation/character');
    const newcomer = new Character({id:'new', name:'New', job:'baker', personality:['kind'], home:resident.home, workplace:resident.workplace}, {x:1,y:1});
    newcomer.relationships.alice = { affection: 8 };
    engine.world.characters.push(newcomer);
    engine.world.tick = 17;
    engine.save();
    engine.world.tick = 18;
    engine.save();
    fs.writeFileSync(store.file, '{broken');
    const recovered = store.load();
    assert.equal(recovered.tick, 17);
    StateManager.prototype.load = () => null;
    let restored;
    try { restored = new SimulationEngine(config, null); } finally { StateManager.prototype.load = originalLoad; }
    restored.restoreState(recovered);
    assert.equal(restored.world.grid[0][0], 9);
    assert.equal(restored.world.characters.length, 13);
    assert.equal(restored.world.characters[12].relationships.alice.affection, 8);
    store.saveRaw(recovered);
    assert.equal(new StateManager(store.file).load().tick, 17);
    fs.writeFileSync(store.file, 'broken');
    fs.writeFileSync(store.file + '.bak', 'broken');
    assert.throws(() => store.load(), /No valid world snapshot/);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('AI budget counts attempts and persists across instances', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'townsim-budget-'));
  const previous = process.env.LLM_DAILY_LIMIT;
  try {
    process.env.LLM_DAILY_LIMIT = '2';
    const file = path.join(dir, 'budget.json');
    assert.equal(new RequestBudget(file).reserve(), true);
    const b = new RequestBudget(file);
    assert.equal(b.reserve(), true);
    assert.equal(b.reserve(), false);
    assert.equal(new RequestBudget(file).status().used, 2);
    fs.writeFileSync(file, 'broken');
    assert.equal(new RequestBudget(file).reserve(), false);
  } finally { if (previous === undefined) delete process.env.LLM_DAILY_LIMIT; else process.env.LLM_DAILY_LIMIT = previous; fs.rmSync(dir, { recursive:true, force:true }); }
});

test('AI attempts are bounded including retries, and disabled budget makes no request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'townsim-client-'));
  const oldLimit = process.env.LLM_DAILY_LIMIT;
  const oldFetch = global.fetch;
  try {
    process.env.LLM_DAILY_LIMIT = '2';
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('offline'); };
    const { LLMClient } = require('../server/llm/client');
    const budget = new RequestBudget(path.join(dir, 'budget.json'));
    const client = new LLMClient({ llm: { maxTokens: 1, temperature: 0, timeout: 100, maxRetries: 3 } }, budget);
    await client.complete('system', 'test');
    assert.equal(calls, 2);
    assert.equal(budget.status().used, 2);
    process.env.LLM_DAILY_LIMIT = '0';
    const disabled = new LLMClient({ llm: { maxTokens: 1, temperature: 0, timeout: 100, maxRetries: 1 } }, new RequestBudget(path.join(dir, 'off.json')));
    await disabled.complete('system', 'test');
    assert.equal(calls, 2);
  } finally { global.fetch = oldFetch; if (oldLimit === undefined) delete process.env.LLM_DAILY_LIMIT; else process.env.LLM_DAILY_LIMIT = oldLimit; fs.rmSync(dir, { recursive:true, force:true }); }
});

test('slow AI does not block rule-based decisions', () => {
  const { LLMBatcher } = require('../server/llm/batcher');
  const oldLimit = process.env.LLM_DAILY_LIMIT;
  const oldUrl = process.env.LLM_BASE_URL;
  try {
    process.env.LLM_DAILY_LIMIT = '2';
    process.env.LLM_BASE_URL = 'http://unused.invalid';
    const world = { tick: 1, time: { hour: 12 }, phase: 'morning', getCharactersNear: () => [] };
    const batch = new LLMBatcher(config, world, {});
    batch.budget.available = () => true;
    batch.processSingleBatch = () => new Promise(() => {});
    const char = { id: 'one', pos: {x:0,y:0}, needs: {hunger:1, energy:1, social:1, fun:1}, activity:'idle', home:'home' };
    const result = batch.decide([{ character:char, reason:'encounter' }]);
    assert.equal(result.length, 1);
    assert.ok(result[0].action);
    assert.equal(batch.inFlight, true);
  } finally { if (oldLimit === undefined) delete process.env.LLM_DAILY_LIMIT; else process.env.LLM_DAILY_LIMIT = oldLimit; if (oldUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = oldUrl; }
});

test('background AI answer is reused only for the original matching situation', async () => {
  const { LLMBatcher } = require('../server/llm/batcher');
  const oldLimit = process.env.LLM_DAILY_LIMIT;
  const oldUrl = process.env.LLM_BASE_URL;
  try {
    process.env.LLM_DAILY_LIMIT = '2'; process.env.LLM_BASE_URL = 'http://example.invalid';
    const world = { tick: 10, time: {hour:12}, phase:'morning', getCharactersNear: () => [] };
    const batch = new LLMBatcher(config, world, {llmCalls:0,llmTokensIn:0,llmTokensOut:0});
    const char = { id:'one', name:'One', job:'baker', personalityAbbr:'kind', recentMemory:[], schedule:{}, relationships:{}, pos:{x:0,y:0}, needs:{hunger:1,energy:1,social:1,fun:1}, activity:'idle', home:'home', getNeedsCompressed: () => 'h1e1s1f1' };
    let resolve;
    batch.budget.available = () => true;
    batch.client.complete = () => new Promise(r => { resolve = r; });
    batch.decide([{character:char,reason:'encounter'}]);
    char.activity = 'wander';
    world.tick++;
    resolve({content:'[A1]ACT:sing|SAY:Hello!',tokensIn:1,tokensOut:1});
    await new Promise(r => setImmediate(r));
    assert.equal(batch.cache.get(char, world), null);
    char.activity = 'idle';
    assert.equal(batch.cache.get(char, world).action.type, 'sing');
    world.tick += 4;
    assert.equal(batch.cache.get(char, world), null);
  } finally { if (oldLimit === undefined) delete process.env.LLM_DAILY_LIMIT; else process.env.LLM_DAILY_LIMIT = oldLimit; if (oldUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = oldUrl; }
});

test('newer save versions are never replaced with an older backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'townsim-version-'));
  try {
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, JSON.stringify({version:99}));
    fs.writeFileSync(file + '.bak', JSON.stringify({tick:0,time:{day:1},characters:[]}));
    assert.throws(() => new StateManager(file).load(), /newer than this application/);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('failed AI requests trigger cooldown while fallback remains available', async () => {
  const { LLMBatcher } = require('../server/llm/batcher');
  const oldUrl = process.env.LLM_BASE_URL;
  try {
    process.env.LLM_BASE_URL = 'http://example.invalid';
    const world = { tick: 1, time: {hour:12}, phase:'morning', getCharactersNear: () => [] };
    const batch = new LLMBatcher(config, world, {llmCalls:0,llmTokensIn:0,llmTokensOut:0});
    batch.budget.limit = 2;
    batch.client.complete = async () => null;
    const char = {id:'one',name:'One',job:'baker',personalityAbbr:'kind',recentMemory:[],schedule:{},relationships:{},pos:{x:0,y:0},needs:{hunger:1,energy:1,social:1,fun:1},activity:'idle',home:'home',getNeedsCompressed:()=> 'h1e1s1f1'};
    await batch.processSingleBatch([{character:char,reason:'encounter'}]);
    assert.equal(batch.status().fallbackReason, 'AI provider cooling down');
    assert.ok(batch.decide([{character:char,reason:'encounter'}])[0].action);
    assert.equal(batch.inFlight, false);
  } finally { if (oldUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = oldUrl; }
});
