const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const base=require('../config/default.json');
const config={...base,reproduction:{...base.reproduction,dailyChance:1,minPartnershipDays:1,gestationDays:3,birthCooldownDays:20}};
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-birth-')),file=path.join(dir,'world.json');
 const engine=new SimulationEngine(config,null,()=>0,new StateManager(file));
 const [a,b]=engine.world.characters;a.reproductiveRole='gestational';b.reproductiveRole='other';
 a.birthDate={year:-26,dayOfYear:1};b.birthDate={year:-28,dayOfYear:1};
 const rel=()=>({affection:7,trust:7,attraction:6,interactionCount:12,tag:'friend',level:7});a.relationships[b.id]=rel();b.relationships[a.id]=rel();
 const ha=engine.households.byMember.get(a.id),hb=engine.households.byMember.get(b.id);
 hb.status='merged';hb.endedAt={...engine.world.time};hb.mergedInto=ha.id;ha.members.push(b.id);engine.households.byMember.set(b.id,ha);b.home=ha.residenceId;
 const partnership={id:'testpair',partners:[a.id,b.id],startedDay:1};engine.partnerships.active.set(partnership.id,partnership);engine.partnerships.byCharacter.set(a.id,partnership);engine.partnerships.byCharacter.set(b.id,partnership);
 return{dir,file,engine,a,b,partnership};
}
function day(engine,n){engine.world.time={day:n,hour:0,minute:0};engine.reproduction.dayStarted(n);}
test('pregnancy survives restart and gives one dependent child with parents, home and historical birth',()=>{
 const f=setup();let {engine,a,b}=f;
 try{
  day(engine,2);assert.equal(engine.reproduction.pending.length,1);const pregnancy=engine.reproduction.pending[0];
  engine.save();engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  assert.equal(engine.reproduction.pending[0].id,pregnancy.id);day(engine,4);assert.equal(engine.world.characters.length,12);
  day(engine,5);assert.equal(engine.world.characters.length,13);const child=engine.world.characters.at(-1);
  assert.deepEqual(child.parentIds,[a.id,b.id]);assert.equal(child.toSummary(engine.calendar).age,0);assert.equal(child.lifecycle,'infant');
  assert.equal(child.job,'dependent');assert.deepEqual(child.schedule,{});assert.equal(engine.households.info(child.id).id,engine.households.info(a.id).id);
  assert.equal(engine.history.query({type:'birth'}).events.length,1);assert.equal(engine.history.since(null).events.some(e=>e.type==='birth'),true);
  assert.equal(engine.townStatistics.observe(5,engine.world.characters.length),true);assert.equal(engine.townStatistics.page().observations.at(-1).population,13);
  engine.save();engine.save();const backup=JSON.parse(fs.readFileSync(f.file+'.bak'));assert.equal(backup.characters.some(c=>c.id===child.id),true);assert.ok(backup.reproduction);assert.ok(backup.households);
  engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));day(engine,6);day(engine,6);
  assert.equal(engine.world.characters.filter(c=>c.id===child.id).length,1);assert.equal(engine.history.query({type:'birth'}).events.length,1);
  const restored=engine.world.characters.find(c=>c.id===child.id);assert.deepEqual(restored.parentIds,[a.id,b.id]);
  const before={...restored.needs};engine.tick();assert.deepEqual(restored.needs,before);assert.equal(restored.activity,'sleep');
  assert.ok(!engine.world.getCharactersNear(restored.pos.x,restored.pos.y,2).includes(restored));
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('eligibility rejects incompatible roles, close relatives, instability, crowding and limits',()=>{
 const f=setup(),{engine,a,b,partnership:p}=f;
 try{
  engine.world.time.day=2;const r=engine.reproduction;
  b.reproductiveRole='gestational';assert.equal(r.reason(p),'incompatible reproductive roles');b.reproductiveRole='other';
  a.parentIds=['shared'];b.parentIds=['shared'];assert.equal(r.reason(p),'close biological relatives');delete a.parentIds;delete b.parentIds;
  p.startedDay=2;assert.equal(r.reason(p),'partnership not stable or established');p.startedDay=1;
  engine.world.buildings[a.home].capacity=2;assert.equal(r.reason(p),'housing capacity');engine.world.buildings[a.home].capacity=4;
  r.config.maxPopulation=12;assert.equal(r.reason(p),'population limit');r.config.maxPopulation=40;
  r.config.maxBirthsPerYear=0;assert.equal(r.reason(p),'birth rate limit');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('pending birth waits safely for housing and resumes after restart',()=>{
 const f=setup();let {engine,a}=f;
 try{
  day(engine,2);assert.equal(engine.reproduction.pending.length,1);engine.world.buildings[a.home].capacity=2;
  day(engine,5);assert.equal(engine.world.characters.length,12);assert.equal(engine.reproduction.pending.length,1);
  assert.equal(Object.values(engine.reproduction.deferred).includes('housing capacity'),true);engine.save();
  engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));engine.world.buildings[a.home].capacity=4;day(engine,6);
  assert.equal(engine.world.characters.length,13);assert.equal(engine.reproduction.pending.length,0);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('simulation speeds advance the same gestation in simulated days and pausing prevents progression',()=>{
 for(const speed of [1,2,5]){
  const f=setup();const {engine,dir}=f;let now=0;
  try{
   engine.now=()=>now;engine.world.time={day:1,hour:0,minute:0};engine.tick=()=>{};engine.moveCharacters=()=>{};
   engine.start();engine.setSpeed(speed);now+=1440*config.simulation.minuteInterval/speed;engine.sync();
   assert.equal(engine.world.time.day,2);assert.equal(engine.reproduction.pending.length,1);
   engine.setSpeed(0);now+=10*1440*config.simulation.minuteInterval;engine.sync();assert.equal(engine.world.time.day,2);
   engine.setSpeed(speed);now+=3*1440*config.simulation.minuteInterval/speed;engine.sync();engine.stop();
   assert.equal(engine.world.time.day,5);assert.equal(engine.world.characters.filter(c=>c.lifecycle==='infant').length,1);
  }finally{engine.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('malformed pending pregnancy is rejected without overwriting the saved world',()=>{
 const f=setup();const {engine,file,dir}=f;
 try{
  day(engine,2);engine.save();const store=new StateManager(file),saved=store.load();
  saved.reproduction.pending[0].dueDay=1;store.saveRaw(saved);const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>new SimulationEngine(config,null,()=>0,new StateManager(file)),/Invalid pending pregnancy/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('birth records preserve inherited traits independently of later development and restart',()=>{
 const f=setup();let {engine,a,b}=f;
 try{
  const beforeA=[...a.personality],beforeB=[...b.personality];day(engine,2);day(engine,5);
  const child=engine.world.characters.at(-1),birth=engine.history.query({type:'birth'}).events[0],inherited=birth.metadata.personalityInheritance;
  assert.deepEqual(child.personality,inherited.traits);assert.deepEqual(inherited.parents.map(p=>p.id),[a.id,b.id]);
  assert.deepEqual(a.personality,beforeA);assert.deepEqual(b.personality,beforeB);
  const snapshot=structuredClone(inherited);engine.development.developTrait(child,'child');
  assert.deepEqual(engine.history.get(birth.id).metadata.personalityInheritance,snapshot);
  engine.save();engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  assert.deepEqual(engine.history.get(birth.id).metadata.personalityInheritance,snapshot);
  assert.deepEqual(engine.world.characters.find(c=>c.id===child.id).personality,child.personality);
  assert.equal(engine.world.characters.find(c=>c.id===child.id).personalityAbbr,child.personalityAbbr);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('a missing biological parent does not prevent birth or erase their historical ID',()=>{
 const f=setup();const {engine,a,b}=f;
 try{
  day(engine,2);engine.world.characters=engine.world.characters.filter(c=>c.id!==b.id);
  day(engine,5);const child=engine.world.characters.at(-1),birth=engine.history.query({type:'birth'}).events[0];
  assert.deepEqual(child.parentIds,[a.id,b.id]);assert.deepEqual(birth.metadata.personalityInheritance.parents.map(p=>p.id),[a.id]);
  assert.ok(child.personality.some(t=>a.personality.includes(t)));
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('loading an older child leaves their existing personality untouched',()=>{
 const f=setup();let {engine}=f;
 try{
  day(engine,2);day(engine,5);const child=engine.world.characters.at(-1);child.personality=['quiet','practical'];child.personalityAbbr='qut.prc';engine.save();
  const store=new StateManager(f.file),state=store.load(),birth=state.history.events.find(e=>e.type==='birth');delete birth.metadata.personalityInheritance;store.saveRaw(state);
  engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));const restored=engine.world.characters.find(c=>c.id===child.id);
  assert.deepEqual(restored.personality,['quiet','practical']);assert.equal(restored.personalityAbbr,'qut.prc');assert.equal(engine.history.get(birth.id).metadata.personalityInheritance,undefined);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
