const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SimulationEngine } = require('../server/simulation/engine');
const { StateManager } = require('../server/persistence/stateManager');
const config = require('../config/default.json');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-integration-'));
  const file = path.join(dir, 'state.json');
  const settings = {...config, drama:{eventChance:1, conflictFrequency:1, romanceFrequency:1, cooldownHours:0}};
  const make = () => new SimulationEngine(settings, null, () => 0, new StateManager(file));
  return { dir, file, make, engine:make() };
}
function rel(score, count = 4) {
  return {affection:score, trust:score, respect:score, attraction:score, level:score, tag:'friend',interactionCount:count};
}
function setPair(a,b,score) { a.relationships[b.id]=rel(score); b.relationships[a.id]=rel(score); }
function quietEngine(engine, a, b) {
  engine.needsManager.decayAll=()=>{}; engine.needsManager.checkCritical=()=>null;
  engine.actionManager.handleSchedule=()=>null;
  engine.actionManager.executeAction=()=>null;
  engine.scheduler.evaluate=()=>[{character:a,reason:'encounter'}];
  a.pos={x:1,y:1}; b.pos={x:1,y:1}; a.inside=false; b.inside=false; b.activity='idle';
  engine.world.getCharactersNear=()=>[a,b];
  engine.stateManager.saveRaw=()=>{};
}

test('only significant applied relationship transitions are recorded with hysteresis', () => {
  const {engine,dir}=fixture();
  try {
    const [a,b]=engine.world.characters;
    setPair(a,b,5);
    for(let i=0;i<8;i++) engine.interactions.updateRelationship(a,b,'chat');
    assert.equal(engine.history.query().events.length,0);
    setPair(a,b,6.96);
    engine.interactions.updateRelationship(a,b,'chat');
    let events=engine.history.query().events;
    assert.equal(events.length,1);
    assert.equal(events[0].metadata.milestone,'friendship_established');
    assert.deepEqual(events[0].entities.map(e=>e.id),[a.id,b.id].sort());
    setPair(a,b,6.96);
    engine.interactions.updateRelationship(a,b,'chat');
    assert.equal(engine.history.query().events.length,1);
    setPair(a,b,3.04);
    engine.interactions.updateRelationship(a,b,'argue');
    events=engine.history.query({type:'relationship_changed'}).events;
    assert.equal(events.filter(e=>e.metadata.milestone==='relationship_deteriorated').length,1);
    setPair(a,b,4.48);
    engine.interactions.updateRelationship(a,b,'forgive');
    assert.equal(engine.history.query().events.filter(e=>e.metadata.milestone==='reconciliation').length,1);
    engine.interactions.updateRelationship(a,b,'forgive');
    assert.equal(engine.history.query().events.filter(e=>e.metadata.milestone==='reconciliation').length,1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('actual conflict story start, climax and conclusion are recorded once and persist', () => {
  const {engine,dir,make}=fixture();
  const originalRandom=Math.random;
  try {
    Math.random=()=>0;
    const [a,b]=engine.world.characters;
    const story=engine.dramaEngine.createStoryline('rivalry',{participants:[a.id,b.id],roles:{}},1);
    assert.ok(story);
    story.phase='tension_building'; story.tension=0.9;
    engine.dramaEngine.updateStorylinePhase(story,100);
    assert.equal(story.phase,'climax');
    story.phase='aftermath'; story.lastEventTick=1;
    engine.dramaEngine.update(200);
    engine.dramaEngine.update(201);
    const events=engine.history.query({type:'conflict'}).events;
    assert.deepEqual(events.map(e=>e.metadata.stage),['started','climax','concluded']);
    assert.ok(events.every(e=>e.entities.map(x=>x.id).join(',')===[a.id,b.id].join(',')));
    engine.historyIntegration.storyline(story,'concluded');
    assert.equal(engine.history.query({type:'conflict'}).events.length,3);
    engine.save(); engine.save();
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json.bak'),'utf8')).history.events.length,3);
    const restored=make();
    assert.deepEqual(restored.history.query({type:'conflict'}).events, events);
    restored.dramaEngine.update(202);
    assert.equal(restored.history.query({type:'conflict'}).events.length,3);
  } finally { Math.random=originalRandom; fs.rmSync(dir,{recursive:true,force:true}); }
});

test('hysteresis survives restart and never backfills pre-existing strong relationships', () => {
  const {engine,dir,make}=fixture();
  try {
    const [a,b]=engine.world.characters;
    setPair(a,b,6.96); engine.interactions.updateRelationship(a,b,'chat');
    engine.save();
    const restored=make();
    const [ra,rb]=restored.world.characters;
    setPair(ra,rb,6.96); restored.interactions.updateRelationship(ra,rb,'chat');
    assert.equal(restored.history.query().events.length,1);
    const [c,d]=restored.world.characters.slice(2,4);
    setPair(c,d,8); restored.interactions.updateRelationship(c,d,'chat');
    assert.equal(restored.history.query().events.length,1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('rule-based and cached mocked AI actions record only applied state changes', async () => {
  const oldRandom=Math.random;
  const {engine,dir}=fixture();
  try {
    Math.random=()=>0.9;
    const [a,b]=engine.world.characters;
    setPair(a,b,6.96);
    quietEngine(engine,a,b);
    a.needs.social=9; a.personality=[];
    engine.llmBatcher.enabled=false;
    engine.tick();
    assert.equal(engine.history.query().events[0].metadata.action,'chat');
    const [c,d]=engine.world.characters.slice(2,4);
    setPair(c,d,6.96);
    quietEngine(engine,c,d);
    const decision={character:c,reason:'encounter'};
    engine.llmBatcher.client.complete=async()=>({content:`[A1]ACT:chat,${d.id}|SAY:We are friends`,tokensIn:0,tokensOut:0});
    await engine.llmBatcher.processSingleBatch([decision]);
    engine.tick();
    assert.equal(engine.history.query().events.filter(e=>e.metadata.milestone==='friendship_established').length,2);
    const [e,f]=engine.world.characters.slice(4,6);
    setPair(e,f,5); quietEngine(engine,e,f);
    e.relationships[f.id].attraction=1;
    engine.llmBatcher.decide=()=>[{character:e,action:{type:'confess',target:f.id},say:'invented milestone'}];
    engine.tick();
    assert.equal(engine.history.query().events.length,2);
    assert.notEqual(e.say,'invented milestone');
  } finally { Math.random=oldRandom; fs.rmSync(dir,{recursive:true,force:true}); }
});

test('manual test scenario records a real interaction without overwriting existing data', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-integration-demo-'));
  try {
    const file=path.join(dir,'fixture.json');
    const script=path.join(__dirname,'../scripts/history-integration-demo.js');
    const output=JSON.parse(execFileSync(process.execPath,[script,file],{encoding:'utf8'}));
    assert.equal(output.events[0].metadata.milestone,'friendship_established');
    const inspected=execFileSync(process.execPath,[path.join(__dirname,'../scripts/history-demo.js'),'inspect',file],{encoding:'utf8'});
    assert.deepEqual(JSON.parse(inspected.slice(inspected.indexOf('{'))).events[0],output.events[0]);
    const saved=fs.readFileSync(file,'utf8');
    assert.throws(()=>execFileSync(process.execPath,[script,file],{stdio:'ignore'}));
    assert.equal(fs.readFileSync(file,'utf8'),saved);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('history observation leaves relationship calculations unchanged and provider outages do not block recording', async () => {
  const {engine,dir}=fixture();
  try {
    const [a,b,c,d]=engine.world.characters;
    setPair(a,b,6.96); setPair(c,d,6.96);
    engine.llmBatcher.enabled=true;
    let calls=0;
    engine.llmBatcher.client.complete=async()=>{ calls++; return null; };
    await engine.llmBatcher.processSingleBatch([{character:a,reason:'encounter'}]);
    const {InteractionManager}=require('../server/simulation/interactions');
    const independent=new InteractionManager();
    independent.updateRelationship(c,d,'chat');
    engine.interactions.updateRelationship(a,b,'chat');
    assert.equal(calls,1);
    assert.deepEqual(a.relationships[b.id],c.relationships[d.id]);
    assert.deepEqual(b.relationships[a.id],d.relationships[c.id]);
    assert.equal(engine.history.query().events.length,1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('simulated timestamps of recorded milestones do not depend on simulation speed', () => {
  const results=[];
  for (const speed of [1,2,5]) {
    const {engine,dir}=fixture();
    try {
      const [a,b]=engine.world.characters;
      setPair(a,b,6.96);
      let now=0;
      engine.now=()=>now;
      engine.tick=()=>{engine.world.tick++};
      engine.moveCharacters=()=>{};
      engine.start();
      engine.setSpeed(speed);
      now += 15 * config.simulation.minuteInterval / speed;
      engine.sync();
      engine.interactions.updateRelationship(a,b,'chat');
      results.push(engine.history.query().events[0].time);
      engine.stop();
    } finally { engine.stop(); fs.rmSync(dir,{recursive:true,force:true}); }
  }
  assert.deepEqual(results,[{day:1,hour:6,minute:15},{day:1,hour:6,minute:15},{day:1,hour:6,minute:15}]);
});
