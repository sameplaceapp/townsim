const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const {Character}=require('../server/simulation/character');
const base=require('../config/default.json');
function fixture(config=base){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-development-')),file=path.join(dir,'world.json');
 const engine=new SimulationEngine(config,null,()=>0,new StateManager(file));const parent=engine.world.characters[0],home=engine.world.buildings[parent.home];
 const baby=new Character({id:'child:fixture',name:'Robin',job:'dependent',personality:['quiet'],home:parent.home,birthDate:{year:1,dayOfYear:1}}, {x:home.door[0],y:home.door[1]});
 baby.parentIds=[parent.id];baby.lifecycle='infant';baby.workplace=null;baby.schedule={};baby.activity='sleep';baby.location=parent.home;baby.inside=true;
 engine.world.characters.push(baby);const household=engine.households.byMember.get(parent.id);household.members.push(baby.id);engine.households.byMember.set(baby.id,household);
 engine.history.record({id:'birth:fixture',type:'birth',description:'Robin was born',entities:[{kind:'character',id:baby.id},{kind:'character',id:parent.id}]});
 return {dir,file,engine,baby,parent};
}
function advance(engine,until){while(engine.world.time.day<until){engine.world.time={day:engine.world.time.day+1,hour:0,minute:0};engine.calendar.dayStarted(engine.world.time.day);}}
test('calendar grows a newborn through all stages once with stable identity, family and history',()=>{
 const f=fixture();let {engine,baby,parent}=f;
 try{
  const home=engine.households.info(baby.id).id;baby.addMemory('kept memory');
  advance(engine,36);assert.equal(baby.lifecycle,'infant');advance(engine,37);assert.equal(baby.lifecycle,'child');assert.equal(baby.toSummary(engine.calendar).age,3);
  assert.ok(baby.interest);assert.ok(baby.personality.length>1);const firstTrait=[...baby.personality];
  parent.pos={...baby.pos};parent.inside=true;parent.location=baby.home;parent.activity='idle';baby.activity='idle';
  engine.development.schedule(baby,8,engine.actionManager,engine.interactions,engine.dramaEngine);
  assert.ok(baby.relationships[parent.id].interactionCount>0);const relationship=baby.relationships[parent.id];
  engine.save();engine=new SimulationEngine(base,null,()=>0,new StateManager(f.file));baby=engine.world.characters.find(c=>c.id==='child:fixture');
  assert.equal(baby.lifecycle,'child');assert.deepEqual(baby.personality,firstTrait);assert.equal(baby.relationships[parent.id].interactionCount,relationship.interactionCount);
  advance(engine,156);assert.equal(baby.lifecycle,'child');advance(engine,157);assert.equal(baby.lifecycle,'teen');assert.ok(baby.aspiration);assert.ok(baby.personality.length>2);
  engine.save();engine=new SimulationEngine(base,null,()=>0,new StateManager(f.file));baby=engine.world.characters.find(c=>c.id==='child:fixture');
  advance(engine,216);assert.equal(baby.lifecycle,'teen');advance(engine,217);assert.equal(baby.lifecycle,'adult');assert.equal(baby.toSummary(engine.calendar).age,18);
  assert.equal(baby.job,'unassigned');assert.equal(baby.workplace,null);assert.ok(!Object.values(baby.schedule).includes('go_to_work'));
  assert.equal(engine.households.info(baby.id).id,home);assert.deepEqual(baby.parentIds,[parent.id]);assert.ok(baby.recentMemory.includes('kept memory'));
  assert.equal(baby.relationships[parent.id].interactionCount,relationship.interactionCount);
  const events=engine.history.query({type:'life_stage'}).events;assert.deepEqual(events.map(e=>[e.metadata.stage,e.metadata.age,e.time.day]),[['child',3,37],['adult',18,217]]);
  engine.calendar.dayStarted(217);engine.save();engine.save();engine=new SimulationEngine(base,null,()=>0,new StateManager(f.file));
  assert.equal(engine.world.characters.find(c=>c.id===baby.id).lifecycle,'adult');assert.equal(engine.history.query({type:'life_stage'}).events.length,2);
  assert.equal(engine.history.since(null).events.some(e=>e.type==='life_stage'),true);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('minors can interact safely but cannot be drawn into adult choices, romance, work or AI decisions',()=>{
 const f=fixture();const {engine,baby,parent}=f;
 try{
  advance(engine,37);assert.equal(baby.lifecycle,'child');
  parent.pos={...baby.pos};parent.inside=true;parent.location=baby.home;parent.activity='idle';baby.activity='idle';
  engine.interactions.updateRelationship(parent,baby,'chat');const before=JSON.stringify(parent.relationships[baby.id]);
  engine.interactions.updateRelationship(parent,baby,'flirt');engine.interactions.updateRelationship(parent,baby,'confess');assert.equal(JSON.stringify(parent.relationships[baby.id]),before);
  assert.equal(engine.partnerships.eligible(parent,baby),false);
  engine.lastScheduleHour=-1;engine.world.time.hour=10;
  let requested=[];engine.scheduler.evaluate=chars=>{requested=chars;return [{character:parent,reason:'encounter'}];};
  engine.llmBatcher.decide=()=>[{character:parent,action:{type:'flirt',target:baby.id}}];engine.tick();
  assert.ok(!requested.includes(baby));assert.equal(parent.activity,'idle');assert.notEqual(baby.activity,'work');assert.equal(JSON.stringify(parent.relationships[baby.id]),before);
  advance(engine,157);assert.equal(baby.lifecycle,'teen');engine.development.schedule(baby,10,engine.actionManager,engine.interactions,engine.dramaEngine);
  assert.notEqual(baby.activity,'work');assert.equal(engine.partnerships.eligible(parent,baby),false);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('legacy dependents migrate by age, while boundaries remain fixed with the saved world',()=>{
 const config={...base,lifecycle:{childAge:4,teenAge:14,adultAge:20}},f=fixture(config);let {engine,baby}=f;
 try{
  advance(engine,49);assert.equal(baby.lifecycle,'child');engine.save();
  const state=new StateManager(f.file).load();state.characters.find(c=>c.id===baby.id).lifecycle='dependent';delete state.development;
  new StateManager(f.file).saveRaw(state);engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  baby=engine.world.characters.find(c=>c.id===baby.id);assert.equal(baby.lifecycle,'child');assert.equal(engine.history.query({type:'life_stage'}).events.length,1);
  engine.save();engine=new SimulationEngine(base,null,()=>0,new StateManager(f.file));assert.equal(engine.development.boundaries.adultAge,20);
  advance(engine,217);baby=engine.world.characters.find(c=>c.id===baby.id);assert.equal(baby.lifecycle,'teen');assert.equal(engine.partnerships.eligible(engine.world.characters[0],baby),false);
  advance(engine,241);assert.equal(baby.lifecycle,'adult');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('accelerated clock speeds and pause preserve the same birthday transitions',()=>{
 const fast={...base,simulation:{...base.simulation,minuteInterval:1,tickInterval:1000000000,movementInterval:1000000000}};
 for(const speed of [1,2,5]){
  const f=fixture(fast),{engine,baby,dir}=f;let now=0;
  try{
   engine.world.time={day:1,hour:0,minute:0};engine.now=()=>now;engine.start();engine.setSpeed(speed);
   now+=36*1440/speed;engine.sync();assert.equal(baby.lifecycle,'child');
   engine.setSpeed(0);now+=10*1440;engine.sync();assert.equal(baby.lifecycle,'child');
   engine.setSpeed(speed);now+=180*1440/speed;engine.sync();engine.stop();
   assert.equal(engine.world.time.day,217);assert.equal(baby.lifecycle,'adult');assert.deepEqual(engine.history.query({type:'life_stage'}).events.map(e=>e.time.day),[37,217]);
  }finally{engine.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});
