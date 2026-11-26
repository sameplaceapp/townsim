const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const {willing}=require('../server/simulation/partnerships');
const {willingToShare}=require('../server/simulation/households');
const base=require('../config/default.json');
const config={...base,drama:{eventChance:1,conflictFrequency:1,romanceFrequency:1,cooldownHours:18}};
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-households-')),file=path.join(dir,'world.json');
 const engine=new SimulationEngine(config,null,()=>0,new StateManager(file));let a,b;
 for(const x of engine.world.characters)for(const y of engine.world.characters){
  const p={...x,personality:[]},q={...y,personality:[]};
  if(x!==y&&!a&&willing(p,q)&&willingToShare(p,q)){a=x;b=y;}
 }
 assert.ok(a&&b);a.personality=[];b.personality=[];setPair(a,b);instrument(engine);return{dir,file,engine,a,b};
}
function setPair(a,b){const rel=()=>({affection:6.2,trust:6,attraction:5,respect:6,level:6,tag:'friend',interactionCount:8});a.relationships[b.id]=rel();b.relationships[a.id]=rel();}
function instrument(engine){engine.needsManager.decayAll=()=>{};engine.needsManager.checkCritical=()=>null;engine.actionManager.handleSchedule=()=>null;engine.actionManager.executeAction=()=>null;}
function apply(engine,a,b,action,day){
 engine.world.time={day,hour:12,minute:0};a.pos={x:1,y:1};b.pos={x:1,y:1};a.inside=false;b.inside=false;b.activity='idle';
 engine.scheduler.evaluate=()=>[{character:a,reason:'encounter'}];engine.llmBatcher.decide=()=>[{character:a,action:{type:action,target:b.id}}];engine.tick();
}
function partner(engine,a,b){apply(engine,a,b,'flirt',1);apply(engine,b,a,'flirt',2);apply(engine,a,b,'flirt',3);assert.equal(engine.partnerships.partnerOf(a.id),b.id);}

test('existing homes migrate without moves, preserve shared non-married households and survive restart',()=>{
 const f=setup();const {engine,dir,file}=f;
 try {
  const before=engine.world.characters.map(c=>({id:c.id,home:c.home,schedule:JSON.stringify(c.schedule)}));
  assert.equal(engine.households.byMember.size,engine.world.characters.length);
  assert.ok(engine.world.characters.every(c=>engine.households.info(c.id).residenceId===c.home));
  assert.equal(engine.households.records.size,engine.world.characters.length);
  engine.save();const legacy=new StateManager(file).load();delete legacy.households;
  legacy.characters[1].home=legacy.characters[0].home;new StateManager(file).saveRaw(legacy);
  const migrated=new SimulationEngine(config,null,()=>0,new StateManager(file));
  const first=migrated.world.characters[0],second=migrated.world.characters[1];
  assert.equal(migrated.households.info(first.id).id,migrated.households.info(second.id).id);
  assert.equal(migrated.households.info(first.id).members.length,2);
  assert.equal(JSON.stringify(first.schedule),before[0].schedule);
  assert.equal(migrated.history.query({type:'household_formed'}).events.length,0);
  const ids=migrated.world.characters.map(c=>migrated.households.info(c.id).id);
  const again=new SimulationEngine(config,null,()=>0,new StateManager(file));
  assert.deepEqual(again.world.characters.map(c=>again.households.info(c.id).id),ids);
  migrated.save();const restored=new SimulationEngine(config,null,()=>0,new StateManager(file));
  assert.deepEqual(restored.world.characters.map(c=>restored.households.info(c.id).id),ids);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('unmarried partners share a home only after sustained mutual decisions, then split if housing becomes available',()=>{
 const f=setup();let {engine,a,b}=f;const oldRandom=Math.random;
 try {
  Math.random=()=>0;const oldHomes=[a.home,b.home],originalSchedules=[JSON.stringify(a.schedule),JSON.stringify(b.schedule)];
  partner(engine,a,b);apply(engine,a,b,'comfort',15);apply(engine,b,a,'comfort',16);
  assert.notEqual(engine.households.info(a.id).id,engine.households.info(b.id).id);
  engine.save();const ids=[a.id,b.id];engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));instrument(engine);
  a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
  apply(engine,a,b,'comfort',17);
  const household=engine.households.info(a.id);
  assert.equal(household.id,engine.households.info(b.id).id);assert.equal(household.members.length,2);
  assert.equal(a.home,b.home);assert.ok(oldHomes.includes(a.home));
  assert.deepEqual([JSON.stringify(a.schedule),JSON.stringify(b.schedule)],originalSchedules);
  assert.equal(engine.marriages.info(a.id).maritalStatus,'never_married');
  const formed=engine.history.query({type:'household_formed'}).events;
  assert.equal(formed.length,1);assert.equal(formed[0].time.day,17);
  assert.ok(formed[0].entities.some(e=>e.kind==='building'&&e.id===a.home));
  const previous=engine.households.byMember.get(a.id).cohabitation.previousResidenceId;
  engine.world.buildings[previous].capacity=0;
  for(const r of [a.relationships[b.id],b.relationships[a.id]]){r.affection=1.5;r.trust=2;}
  apply(engine,a,b,'argue',23);apply(engine,b,a,'argue',24);apply(engine,a,b,'argue',25);
  assert.equal(engine.partnerships.partnerOf(a.id),null);
  assert.equal(engine.households.info(a.id).id,engine.households.info(b.id).id);
  assert.equal(engine.history.query({type:'household_relocated'}).events.length,0);
  engine.save();engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
  engine.world.buildings[previous].capacity=4;engine.world.time={day:26,hour:0,minute:0};engine.households.dayStarted(26);
  assert.notEqual(engine.households.info(a.id).id,engine.households.info(b.id).id);
  assert.ok([a.home,b.home].includes(previous));
  assert.equal(engine.history.query({type:'household_relocated'}).events.length,1);
  engine.save();engine.save();const restored=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  assert.notEqual(restored.households.info(a.id).id,restored.households.info(b.id).id);
  assert.equal(restored.history.query({type:'household_formed'}).events.length,1);
  assert.equal(restored.history.query({type:'household_relocated'}).events.length,1);
  assert.ok(JSON.parse(fs.readFileSync(f.file+'.bak','utf8')).households);
 }finally{Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('capacity prevents cohabitation and unassigned residents wait for a valid available home',()=>{
 const f=setup(),{engine,a,b,dir}=f,oldRandom=Math.random;
 try {
  Math.random=()=>0;engine.world.buildings[a.home].capacity=1;engine.world.buildings[b.home].capacity=1;
  partner(engine,a,b);apply(engine,a,b,'comfort',15);apply(engine,b,a,'comfort',16);apply(engine,a,b,'comfort',17);
  assert.notEqual(engine.households.info(a.id).id,engine.households.info(b.id).id);
  assert.equal(engine.history.query({type:'household_formed'}).events.length,0);
  const row=engine.households.byMember.get(a.id),prior=a.home;
  row.residenceId=null;a.home='unknown_old_home';engine.world.time={day:24,hour:0,minute:0};
  engine.world.buildings[prior].capacity=0;engine.households.dayStarted(24);
  assert.equal(engine.households.info(a.id).residenceId,null);
  engine.world.buildings[prior].capacity=1;engine.world.time.day=25;engine.households.dayStarted(25);
  assert.equal(engine.households.info(a.id).residenceId,prior);assert.equal(a.home,prior);
  assert.equal(engine.history.query({type:'household_relocated'}).events.length,1);
 }finally{Math.random=oldRandom;fs.rmSync(dir,{recursive:true,force:true});}
});

test('duplicate household membership is rejected without overwriting saved data',()=>{
 const f=setup();const {engine,dir,file}=f;
 try {
  engine.save();const store=new StateManager(file),saved=store.load();
  saved.households.records[1].members.push(saved.households.records[0].members[0]);store.saveRaw(saved);
  const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>new SimulationEngine(config,null,()=>0,new StateManager(file)),/Inconsistent household membership/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('population changes preserve active membership and retain closed household records',()=>{
 const f=setup();const {engine,dir,file}=f;
 try {
  const departed=engine.world.characters.pop();const oldHousehold=engine.households.info(departed.id).id;
  engine.save();const restored=new SimulationEngine(config,null,()=>0,new StateManager(file));
  assert.equal(restored.households.info(departed.id),null);
  assert.equal(restored.households.records.get(oldHousehold).status,'inactive');
  assert.ok(restored.households.records.get(oldHousehold).members.includes(departed.id));
  assert.equal(restored.households.byMember.size,restored.world.characters.length);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
