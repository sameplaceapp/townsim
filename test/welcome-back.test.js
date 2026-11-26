const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const express=require('express');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const config=require('../config/default.json');

test('welcome summaries use persistent world identity, event cursors and simulated time', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-welcome-'));
  const previousEnv={url:process.env.LLM_BASE_URL, limit:process.env.LLM_DAILY_LIMIT, file:process.env.LLM_API_KEY_FILE};
  process.env.LLM_BASE_URL=''; process.env.LLM_DAILY_LIMIT='0'; delete process.env.LLM_API_KEY_FILE;
  let server;
  try {
    const file=path.join(dir,'state.json');
    let now=0;
    let engine=new SimulationEngine(config,null,()=>now,new StateManager(file));
    const app=express(); app.use(express.json()); app.set('engine',engine); app.use('/api',require('../server/api/routes'));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const url=`http://127.0.0.1:${server.address().port}/api/welcome-back`;
    const request=async previous=>{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({previous})});assert.equal(r.status,200);return r.json();};
    const originalTime={...engine.world.time};
    engine.history.record({id:'before',type:'conflict',description:'Before visit',entities:[]});
    const first=await request(null);
    assert.equal(first.mode,'first'); assert.equal(first.marker.lastEventId,'before');
    engine.start(); engine.tick=()=>{engine.world.tick++}; engine.moveCharacters=()=>{};
    now=120*config.simulation.minuteInterval; engine.sync();
    for(let i=0;i<20;i++) engine.history.record({id:`during:${i}`,type:i%2?'conflict':'community_event',
      description:`During ${i}`,entities:[{kind:'character',id:`resident${i}`}],metadata:{}});
    const back=await request(first.marker);
    assert.equal(back.mode,'return'); assert.equal(back.elapsedMinutes,120); assert.equal(back.count,20);
    assert.equal(back.events.length,5); assert.ok(back.events.every(e=>e.id!=='before'));
    assert.equal(back.marker.lastEventId,'during:19');
    const repeat=await request(back.marker);
    assert.equal(repeat.count,0); assert.equal(repeat.elapsedMinutes,0);
    now+=60*config.simulation.minuteInterval; engine.sync();
    const quiet=await request(back.marker);
    assert.equal(quiet.count,0); assert.equal(quiet.elapsedMinutes,60);
    engine.setSpeed(0); now+=300*config.simulation.minuteInterval;
    assert.equal((await request(quiet.marker)).elapsedMinutes,0);
    engine.stop(); engine.save();
    const worldId=engine.worldId;
    engine=new SimulationEngine(config,null,()=>now,new StateManager(file)); app.set('engine',engine);
    assert.equal(engine.worldId,worldId);
    assert.equal((await request(quiet.marker)).count,0);
    const different=new SimulationEngine(config,null,()=>now,new StateManager(path.join(dir,'other.json')));
    app.set('engine',different);
    assert.equal((await request(quiet.marker)).mode,'first');
    app.set('engine',engine);
    const invalid=await request({...quiet.marker,lastEventId:'not-present'});
    assert.equal(invalid.mode,'first');
    const rollback=await request({...quiet.marker,time:{day:999,hour:0,minute:0}});
    assert.equal(rollback.mode,'first');
    assert.deepEqual(originalTime,{day:1,hour:6,minute:0});
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    if(previousEnv.url===undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL=previousEnv.url;
    if(previousEnv.limit===undefined) delete process.env.LLM_DAILY_LIMIT; else process.env.LLM_DAILY_LIMIT=previousEnv.limit;
    if(previousEnv.file===undefined) delete process.env.LLM_API_KEY_FILE; else process.env.LLM_API_KEY_FILE=previousEnv.file;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('summary groups repeated storyline events and prioritizes the conclusion', () => {
  const {WorldHistory}=require('../server/history/worldHistory');
  const history=new WorldHistory({time:{day:2,hour:1,minute:0}});
  for (const stage of ['started','climax','concluded']) history.record({id:`story:${stage}`,type:'conflict',description:stage,
    entities:[{kind:'character',id:'a'},{kind:'character',id:'b'}],metadata:{storylineId:'one',stage}});
  const result=history.since(null);
  assert.equal(result.count,3); assert.equal(result.events.length,1); assert.equal(result.events[0].metadata.stage,'concluded');
});
