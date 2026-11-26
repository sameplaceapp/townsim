const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), express=require('express');
const {TownStatistics}=require('../server/statistics/townStatistics');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const config=require('../config/default.json');

test('population observations are unique, ordered, bounded and preserve gaps',()=>{
  const stats=new TownStatistics();
  assert.equal(stats.observe(2,12),true); assert.equal(stats.observe(2,99),false);
  stats.observe(5,12); stats.observe(6,13); stats.observe(7,13);
  assert.deepEqual(stats.page({limit:2}),{observations:[{day:6,population:13},{day:7,population:13}],nextBeforeDay:6});
  assert.deepEqual(stats.page({limit:2,beforeDay:6}),{observations:[{day:2,population:12},{day:5,population:12}],nextBeforeDay:null});
  assert.throws(()=>stats.page({limit:101}),/Invalid/);
  assert.throws(()=>new TownStatistics({version:1,population:[{day:2,population:1},{day:2,population:2}]}),/Invalid/);
});

test('daily authoritative counts, event totals and backup survive saves and headless restarts',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-statistics-'));
  const old={url:process.env.LLM_BASE_URL,limit:process.env.LLM_DAILY_LIMIT,file:process.env.LLM_API_KEY_FILE};
  process.env.LLM_BASE_URL=''; process.env.LLM_DAILY_LIMIT='0'; delete process.env.LLM_API_KEY_FILE;
  let server;
  try {
    let now=0; const file=path.join(dir,'state.json');
    let engine=new SimulationEngine(config,null,()=>now,new StateManager(file));
    engine.tick=()=>{engine.world.tick++}; engine.moveCharacters=()=>{};
    const initial=engine.world.characters.length, buildings=Object.keys(engine.world.buildings).length;
    engine.history.record({id:'test:1',type:'conflict',description:'One',entities:[]});
    engine.history.record({id:'test:2',type:'conflict',description:'Two',entities:[]});
    engine.history.record({id:'test:3',type:'community_event',description:'Three',entities:[]});
    engine.history.record({id:'test:3',type:'community_event',description:'Three',entities:[]});
    engine.world.time={day:3,hour:23,minute:59}; engine.start();
    now+=config.simulation.minuteInterval; engine.sync();
    assert.deepEqual(engine.townStatistics.page().observations,[{day:3,population:initial}]);
    engine.world.characters.pop(); engine.world.time={day:4,hour:23,minute:59};
    now+=config.simulation.minuteInterval; engine.sync();
    assert.deepEqual(engine.townStatistics.page().observations,[{day:3,population:initial},{day:4,population:initial-1}]);
    engine.stop();engine.save();engine.save();
    const backup=JSON.parse(fs.readFileSync(file+'.bak','utf8'));
    assert.equal(backup.townStatistics.population.length,2);
    engine=new SimulationEngine(config,null,()=>now,new StateManager(file));
    assert.equal(engine.townStatistics.observe(4,999),false);
    assert.equal(engine.townStatistics.page().observations.length,2);
    assert.deepEqual(engine.history.countsByType(),{conflict:2,community_event:1});
    const app=express();app.set('engine',engine);app.use('/api',require('../server/api/routes'));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const url=`http://127.0.0.1:${server.address().port}/api/town-statistics`;
    const data=await(await fetch(url+'?limit=1')).json();
    assert.equal(data.population,initial-1);assert.equal(data.buildings,buildings);assert.equal(data.historyCount,3);
    assert.deepEqual(data.eventCounts,{conflict:2,community_event:1});
    assert.deepEqual(data.observations,[{day:4,population:initial-1}]);
    assert.equal(data.nextBeforeDay,4);
    assert.deepEqual((await(await fetch(url+'?limit=1&beforeDay=4')).json()).observations,[{day:3,population:initial}]);
    for(const query of ['?limit=101','?beforeDay=0','?beforeDay=-2','?limit=bad']) assert.equal((await fetch(url+query)).status,400);
    const oldSnapshot=new StateManager(file).load(); delete oldSnapshot.townStatistics;
    new StateManager(file).saveRaw(oldSnapshot);
    const legacy=new SimulationEngine(config,null,()=>now,new StateManager(file));
    assert.deepEqual(legacy.townStatistics.page().observations,[]);
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    for(const [key,val] of Object.entries({LLM_BASE_URL:old.url,LLM_DAILY_LIMIT:old.limit,LLM_API_KEY_FILE:old.file})) {
      if(val===undefined)delete process.env[key];else process.env[key]=val;
    }
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('day-boundary collection is identical at each simulation speed',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-statistics-speed-'));
  try {
    for(const speed of [1,2,5]) {
      let now=0;
      const engine=new SimulationEngine(config,null,()=>now,new StateManager(path.join(dir,`world-${speed}.json`)));
      engine.tick=()=>{}; engine.moveCharacters=()=>{};
      engine.world.time={day:42,hour:23,minute:59};
      engine.start();engine.setSpeed(speed);
      try {
        now+=config.simulation.minuteInterval/speed;engine.sync();
        assert.deepEqual(engine.townStatistics.page().observations,[{day:42,population:engine.world.characters.length}]);
      } finally {engine.stop();}
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
