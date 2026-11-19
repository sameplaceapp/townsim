const test = require('node:test');
const assert = require('node:assert/strict');
const { DramaEngine } = require('../server/simulation/dramaEngine');
const { SimulationEngine } = require('../server/simulation/engine');
const { StateManager } = require('../server/persistence/stateManager');
const baseConfig = require('../config/default.json');

function fixture(options = {}) {
  const rel = (affection, trust, attraction, interactionCount = 5) => ({affection, trust, attraction, interactionCount, respect:5, level:5, tag:'friend'});
  const person = (id, personality = []) => ({id,name:id,personality,relationships:{},pos:{x:1,y:1},activity:'idle',inside:false,mood:null});
  const a=person('a',['flirtatious']), b=person('b'), c=person('c');
  a.relationships.b=rel(7,6,6); b.relationships.a=rel(7,6,6); c.relationships.b=rel(7,6,6);
  const world = {config:{drama:{eventChance:1,conflictFrequency:1,romanceFrequency:1,cooldownHours:18,...options}}, time:{day:1,hour:6,minute:0},tick:1,characters:[a,b,c],getCharactersNear:()=>[a,b,c],addLog:()=>{}};
  return { world, drama:new DramaEngine(world), a, b, c };
}
function withRandom(value, fn) { const old=Math.random; Math.random=()=>value; try { return fn(); } finally { Math.random=old; } }

test('major actions require plausible context, while everyday actions remain available', () => withRandom(0, () => {
  const {drama,a,b}=fixture();
  assert.equal(drama.allowAction(a,b,'chat'),true);
  assert.equal(drama.allowAction(a,b,'argue'),false);
  a.relationships.b.affection=3;
  assert.equal(drama.allowAction(a,b,'argue'),true);
  const other=fixture();
  other.a.relationships.b.attraction=1;
  other.a.relationships.b.affection=4;
  assert.equal(other.drama.allowAction(other.a,other.b,'flirt'),false);
  other.a.relationships.b.attraction=6;
  other.a.relationships.b.affection=7;
  other.b.pos={x:50,y:50};
  assert.equal(other.drama.allowAction(other.a,other.b,'confess'),false);
}));

test('cooldown applies across partners and survives save/load, using simulated minutes', () => withRandom(0, () => {
  const {world,drama,a,b,c}=fixture();
  assert.equal(drama.allowAction(a,b,'flirt'),true);
  a.relationships.c={affection:7,trust:6,attraction:6,interactionCount:5};
  assert.equal(drama.allowAction(a,c,'flirt'),false);
  const restored=new DramaEngine(world);
  restored.fromJSON(JSON.parse(JSON.stringify(drama.toJSON())));
  world.time={day:1,hour:23,minute:59};
  assert.equal(restored.allowAction(a,b,'flirt'),false);
  world.time={day:2,hour:0,minute:0};
  assert.equal(restored.allowAction(a,b,'flirt'),true);
  const oldSave=new DramaEngine(world); oldSave.fromJSON({});
  assert.equal(oldSave.allowAction(a,b,'flirt'),true);
}));

test('configured categories and personalities affect event eligibility', () => withRandom(0.8, () => {
  const cautious=fixture({eventChance:1,romanceFrequency:1});
  cautious.a.personality=['cautious'];
  assert.equal(cautious.drama.allowAction(cautious.a,cautious.b,'flirt'),false);
  const bold=fixture({eventChance:1,romanceFrequency:1});
  assert.equal(bold.drama.allowAction(bold.a,bold.b,'flirt'),true);
  const disabled=fixture({eventChance:1,romanceFrequency:0});
  assert.equal(disabled.drama.allowAction(disabled.a,disabled.b,'flirt'),false);
}));

test('a grounded romance can start one storyline; a third resident on cooldown is protected', () => withRandom(0, () => {
  const {drama,world,a,b,c}=fixture();
  assert.equal(drama.allowAction(a,b,'flirt'),true);
  drama.onInteraction(a,b,'flirt');
  assert.equal(drama.activeStorylines.length,1);
  assert.equal(drama.activeStorylines[0].type,'love_triangle');
  assert.equal(drama.isReady([c.id],drama.simulationMinute()),false);
  const other=fixture();
  assert.equal(other.drama.allowAction(other.a,other.b,'flirt'),true);
  other.drama.lastMajorByCharacter.c=other.drama.simulationMinute();
  other.drama.onInteraction(other.a,other.b,'flirt');
  assert.equal(other.drama.activeStorylines.length,0);
}));

test('peace is allowed and inactive storylines can resolve without a climax', () => withRandom(0, () => {
  const {drama,world,a,b,c}=fixture({eventChance:0});
  assert.equal(drama.createStoryline('love_triangle',{participants:[a.id,b.id,c.id],roles:{}},1),null);
  for(let tick=1;tick<=600;tick++) { world.tick=tick; world.time.day=1+Math.floor(tick/144); drama.update(tick); }
  assert.equal(drama.activeStorylines.length,0);
  const next=fixture();
  const story=next.drama.createStoryline('love_triangle',{participants:['a','b','c'],roles:{}},1);
  story.phase='tension_building'; story.tension=0;
  next.world.time={day:2,hour:6,minute:0};
  next.drama.updateStorylinePhase(story,146);
  assert.equal(story.phase,'resolution');
  const legacy={phase:'tension_building',tension:0,startTick:1,lastEventTick:1,participants:['a','b'],type:'rivalry'};
  next.drama.updateStorylinePhase(legacy,146);
  assert.equal(legacy.phase,'resolution');
}));

test('simulated cooldown duration is identical at every game speed', () => withRandom(0, () => {
  for(const speed of [1,2,5]) {
    let now=0; const original=StateManager.prototype.load; StateManager.prototype.load=()=>null;
    let engine;
    try { engine=new SimulationEngine({...baseConfig,drama:{eventChance:1,conflictFrequency:1,romanceFrequency:1,cooldownHours:18}},null,()=>now); }
    finally { StateManager.prototype.load=original; }
    engine.stateManager.saveRaw=()=>{};
    engine.tick=()=>{engine.world.tick++}; engine.moveCharacters=()=>{};
    const [a,b]=engine.world.characters;
    a.pos={x:1,y:1};b.pos={x:1,y:1};a.inside=false;b.inside=false;b.activity='idle';
    a.relationships[b.id]={affection:7,trust:6,attraction:6,interactionCount:5};
    engine.start(); engine.setSpeed(speed);
    try {
      assert.equal(engine.dramaEngine.allowAction(a,b,'flirt'),true);
      now += 17*60*5000/speed;engine.sync();
      assert.equal(engine.dramaEngine.allowAction(a,b,'flirt'),false);
      now += 60*5000/speed;engine.sync();
      assert.equal(engine.dramaEngine.allowAction(a,b,'flirt'),true);
    } finally { engine.stop(); }
  }
}));

test('story climaxes respect the same character cooldown', () => withRandom(0, () => {
  const {world,drama}=fixture();
  const story=drama.createStoryline('love_triangle',{participants:['a','b','c'],roles:{}},1);
  story.phase='tension_building'; story.tension=0.9;
  drama.updateStorylinePhase(story,100);
  assert.equal(story.phase,'tension_building');
  world.time={day:2,hour:0,minute:0};
  drama.updateStorylinePhase(story,200);
  assert.equal(story.phase,'climax');
}));

test('unqualified AI suggestions fall back without broadcasting their speech or emotions', () => withRandom(0, () => {
  const original=StateManager.prototype.load; StateManager.prototype.load=()=>null;
  let engine;
  try { engine=new SimulationEngine({...baseConfig,drama:{eventChance:1,conflictFrequency:1,romanceFrequency:1,cooldownHours:18}},null); }
  finally { StateManager.prototype.load=original; }
  engine.stateManager.saveRaw=()=>{};
  const [a,b]=engine.world.characters;
  a.pos={x:1,y:1}; b.pos={x:1,y:1}; a.inside=false; b.inside=false; b.activity='idle';
  a.relationships[b.id]={affection:4,trust:5,attraction:1,interactionCount:0,respect:5,tag:'friend',level:5};
  engine.needsManager.decayAll=()=>{}; engine.needsManager.checkCritical=()=>null;
  engine.actionManager.handleSchedule=()=>null;
  engine.scheduler.evaluate=()=>[{character:a,reason:'encounter'}];
  engine.llmBatcher.decide=()=>[{character:a,action:{type:'confess',target:b.id},say:'A confession',think:'A thought',emotion:'infatuated'}];
  engine.tick();
  assert.equal(a.activity,'chat');
  assert.equal(a.say,null);
  assert.equal(a.think,null);
  assert.equal(a.mood,null);
  assert.equal(engine.dramaEngine.activeStorylines.length,0);
}));

test('rule-based characters can initiate grounded conflict and romance without an LLM', () => withRandom(0, () => {
  const { LLMBatcher } = require('../server/llm/batcher');
  const {world,drama,a,b}=fixture();
  world.config.simulation = baseConfig.simulation;
  world.config.llm = baseConfig.llm;
  a.needs={social:9,fun:0};
  const batcher=new LLMBatcher(world.config,world,{});
  world.getCharactersNear=()=>[a,b];
  a.personality=['grumpy'];
  a.relationships.b={affection:2,trust:3,attraction:1,interactionCount:5};
  const conflict=batcher.generateFallback(a);
  assert.equal(conflict.action.type,'argue');
  assert.equal(drama.allowAction(a,b,conflict.action.type),true);
  const romantic=fixture();
  romantic.world.config.simulation=baseConfig.simulation;
  romantic.world.config.llm=baseConfig.llm;
  romantic.a.needs={social:9,fun:0};
  romantic.world.getCharactersNear=()=>[romantic.a,romantic.b];
  const romanticBatcher=new LLMBatcher(romantic.world.config,romantic.world,{});
  const flirt=romanticBatcher.generateFallback(romantic.a);
  assert.equal(flirt.action.type,'flirt');
  assert.equal(romantic.drama.allowAction(romantic.a,romantic.b,flirt.action.type),true);
}));
