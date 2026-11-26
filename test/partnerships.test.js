const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const {Partnerships,willing}=require('../server/simulation/partnerships');
const base=require('../config/default.json');
const config={...base,drama:{eventChance:1,conflictFrequency:1,romanceFrequency:1,cooldownHours:18}};
function setup() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-partners-')),file=path.join(dir,'state.json');
  const engine=new SimulationEngine(config,null,()=>0,new StateManager(file));
  const chars=engine.world.characters; let a,b;
  for(const x of chars) for(const y of chars) if(x!==y&&!a&&willing({...x,personality:[]},{...y,personality:[]})){a=x;b=y;}
  a.personality=[];b.personality=[];
  engine.needsManager.decayAll=()=>{};engine.needsManager.checkCritical=()=>null;
  engine.actionManager.handleSchedule=()=>null;engine.actionManager.executeAction=()=>null;
  for(const c of [a,b]){c.pos={x:1,y:1};c.inside=false;c.activity='idle';}
  return {dir,file,engine,a,b};
}
function relationship(value=6.2) {return {affection:value,trust:6,attraction:5,respect:6,level:6,tag:'friend',interactionCount:8};}
function setPair(a,b){a.relationships[b.id]=relationship();b.relationships[a.id]=relationship();}
function interact(engine,a,b,action,day) {
  engine.world.time={day,hour:12,minute:0};
  engine.scheduler.evaluate=()=>[{character:a,reason:'encounter'}];
  engine.llmBatcher.decide=()=>[{character:a,action:{type:action,target:b.id}}];
  engine.tick();
}
function milestones(engine,kind){return engine.history.query({type:'relationship_changed'}).events.filter(e=>e.metadata.milestone===kind);}

test('mutual courtship forms one persistent partnership and later sustained strain ends it once',()=>{
 const f=setup();let {engine,a,b}=f;const oldRandom=Math.random;
 try {
  Math.random=()=>0;setPair(a,b);
  interact(engine,a,b,'flirt',1);interact(engine,b,a,'flirt',1);
  assert.equal(engine.partnerships.partnerOf(a.id),null);
  interact(engine,b,a,'flirt',2);assert.equal(engine.partnerships.partnerOf(a.id),null);
  interact(engine,a,b,'flirt',3);
  assert.equal(engine.partnerships.partnerOf(a.id),b.id);assert.equal(engine.partnerships.partnerOf(b.id),a.id);
  assert.equal(milestones(engine,'partnership_formed').length,1);
  assert.deepEqual(milestones(engine,'partnership_formed')[0].entities.map(e=>e.id).sort(),[a.id,b.id].sort());
  const other=engine.world.characters.find(c=>c!==a&&c!==b);setPair(a,other);
  assert.equal(engine.partnerships.eligible(a,other),false);
  engine.save();engine.save();
  const snapshot=new StateManager(f.file).load();
  assert.equal(snapshot.partnerships.active.length,1);assert.equal(snapshot.partnerships.active[0].partners.length,2);
  const ids=[a.id,b.id];engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
  engine.needsManager.decayAll=()=>{};engine.needsManager.checkCritical=()=>null;engine.actionManager.handleSchedule=()=>null;engine.actionManager.executeAction=()=>null;
  assert.equal(engine.partnerships.partnerOf(a.id),b.id);
  for(const rel of [a.relationships[b.id],b.relationships[a.id]]){rel.affection=1.5;rel.trust=2;}
  interact(engine,a,b,'argue',8);interact(engine,b,a,'argue',9);
  assert.equal(engine.partnerships.partnerOf(a.id),b.id);
  engine.save();engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
  engine.needsManager.decayAll=()=>{};engine.needsManager.checkCritical=()=>null;engine.actionManager.handleSchedule=()=>null;engine.actionManager.executeAction=()=>null;
  interact(engine,a,b,'argue',10);
  assert.equal(engine.partnerships.partnerOf(a.id),null);assert.equal(engine.partnerships.partnerOf(b.id),null);
  assert.equal(milestones(engine,'partnership_ended').length,1);
  setPair(a,b);interact(engine,a,b,'flirt',11);interact(engine,b,a,'flirt',12);interact(engine,a,b,'flirt',13);
  assert.equal(engine.partnerships.partnerOf(a.id),null);
  engine.save();const restored=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  assert.equal(milestones(restored,'partnership_formed').length,1);assert.equal(milestones(restored,'partnership_ended').length,1);
 } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('adult mutual context, available kinship and exclusivity govern eligibility',()=>{
 const f=setup();const {engine,a,b}=f;
 try {
  setPair(a,b);assert.equal(engine.partnerships.eligible(a,b),true);
  const original=a.birthDate;a.birthDate={year:1,dayOfYear:1};assert.equal(engine.partnerships.eligible(a,b),false);a.birthDate=original;
  a.parentIds=[b.id];assert.equal(engine.partnerships.eligible(a,b),false);
  a.parentIds=['shared'];b.parentIds=['shared'];assert.equal(engine.partnerships.eligible(a,b),false);
  a.parentIds=[];b.parentIds=[];
  a.relationships[b.id].attraction=0;
  for(let day=1;day<=6;day++){engine.world.time.day=day;engine.partnerships.onInteraction(day%2?a:b,day%2?b:a,'flirt');}
  assert.equal(engine.partnerships.partnerOf(a.id),null);
 } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('single residents remain single without reciprocal interest; population-level predisposition is selective',()=>{
 const f=setup();const {engine,a,b}=f;
 try {
  setPair(a,b);
  for(let day=1;day<=30;day++){engine.world.time.day=day;engine.partnerships.onInteraction(a,b,'flirt');}
  assert.equal(engine.partnerships.partnerOf(a.id),null);
  let possible=0;
  for(let i=0;i<200;i++)if(willing({id:`a${i}`,personality:[]},{id:`b${i}`,personality:[]}))possible++;
  assert.ok(possible>50&&possible<140,`eligible pair count ${possible}`);
 } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('rule-based choices can form a partnership without external AI and courtship resumes after restart',()=>{
 const f=setup();let {engine,a,b}=f;const originalRandom=Math.random;
 try {
  Math.random=()=>0;setPair(a,b);a.needs.social=9;b.needs.social=9;
  engine.world.getCharactersNear=()=>[a,b];engine.llmBatcher.enabled=false;
  function fallback(actor,target,day){engine.world.time={day,hour:12,minute:0};engine.scheduler.evaluate=()=>[{character:actor,reason:'encounter'}];engine.tick();}
  fallback(a,b,1);fallback(b,a,2);
  assert.equal(engine.partnerships.partnerOf(a.id),null);
  const ids=[a.id,b.id];engine.save();engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
  a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
  engine.needsManager.decayAll=()=>{};engine.needsManager.checkCritical=()=>null;engine.actionManager.handleSchedule=()=>null;engine.actionManager.executeAction=()=>null;
  engine.world.getCharactersNear=()=>[a,b];engine.llmBatcher.enabled=false;
  fallback(a,b,3);
  assert.equal(engine.partnerships.partnerOf(a.id),b.id);
  assert.equal(milestones(engine,'partnership_formed').length,1);
 } finally {Math.random=originalRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('rejected AI suggestions cannot establish partnerships or record false events',()=>{
 const f=setup();const {engine,a,b}=f;const oldRandom=Math.random;
 try {
  Math.random=()=>0;setPair(a,b);a.relationships[b.id].attraction=1;
  engine.llmBatcher.decide=()=>[{character:a,action:{type:'confess',target:b.id},say:'We are partners'}];
  for(let day=1;day<=5;day++){engine.world.time={day,hour:12,minute:0};engine.scheduler.evaluate=()=>[{character:a,reason:'encounter'}];engine.tick();}
  assert.equal(engine.partnerships.partnerOf(a.id),null);assert.equal(milestones(engine,'partnership_formed').length,0);
  assert.notEqual(a.say,'We are partners');
 } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('known grandparents and recovered relationships prevent invalid progress',()=>{
 const f=setup();const {engine,a,b}=f;
 try {
  setPair(a,b);const parent=engine.world.characters.find(c=>c!==a&&c!==b);
  a.parentIds=[parent.id];parent.parentIds=[b.id];
  assert.equal(engine.partnerships.eligible(a,b),false);
  const otherParent=engine.world.characters.find(c=>c!==a&&c!==b&&c!==parent);
  parent.parentIds=['shared-grandparent'];b.parentIds=['shared-grandparent'];
  assert.equal(engine.partnerships.eligible(a,b),false);
  b.parentIds=[otherParent.id];otherParent.parentIds=['shared-grandparent'];
  assert.equal(engine.partnerships.eligible(a,b),false);
  b.parentIds=[];otherParent.parentIds=[];
  a.parentIds=[];parent.parentIds=[];
  const fake={id:'unit-partnership',partners:[a.id,b.id],startedDay:1,strain:{days:2,lastDay:8}};
  engine.world.time.day=9;engine.partnerships.considerSeparation(fake,a,b,'comfort');
  assert.equal(fake.strain,undefined);
 } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('controlled multi-day encounters allow lasting single residents and avoid instant pairing',()=>{
 const world={time:{day:1},characters:[]},calendar={current:()=>({year:50,dayOfYear:1,daysPerYear:12})},events=[];
 const manager=new Partnerships(world,calendar,{record:event=>events.push(event)});
 const pairs=[];
 for(let i=0;i<100;i++){
   const person=id=>({id,personality:[],birthDate:{year:1,dayOfYear:1},relationships:{}});
   const a=person(`person-a-${i}`),b=person(`person-b-${i}`);setPair(a,b);world.characters.push(a,b);pairs.push([a,b]);
 }
 for(let day=1;day<=30;day++){
   world.time.day=day;
   for(const [a,b] of pairs)manager.onInteraction(day%2?a:b,day%2?b:a,'flirt');
   if(day<3)assert.equal(manager.active.size,0);
 }
 assert.ok(manager.active.size>=20&&manager.active.size<=70,`formed ${manager.active.size} of 100 pairs`);
 assert.equal(events.filter(e=>e.metadata.milestone==='partnership_formed').length,manager.active.size);
 assert.equal(events.filter(e=>e.metadata.milestone==='partnership_ended').length,0);
});

test('stale courtships and completed cooldowns are pruned without changing relationships',()=>{
 const f=setup();const {engine,a,b}=f;
 try {
  setPair(a,b);engine.world.time.day=1;engine.partnerships.onInteraction(a,b,'flirt');
  assert.equal(Object.keys(engine.partnerships.courtships).length,1);
  engine.partnerships.cooldowns[a.id]=8;
  const before=JSON.stringify(a.relationships);
  engine.partnerships.prune(14);
  assert.equal(Object.keys(engine.partnerships.courtships).length,0);
  assert.equal(engine.partnerships.cooldowns[a.id],undefined);
  assert.equal(JSON.stringify(a.relationships),before);
 } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('conflicting saved partnerships fail safely rather than overwriting the world',()=>{
 const f=setup();const {engine,file,dir}=f;
 try {
  engine.save();const store=new StateManager(file),saved=store.load();
  const [a,b,c]=saved.characters.map(character=>character.id);
  saved.partnerships={version:1,active:[{id:'one',partners:[a,b],startedDay:1},{id:'two',partners:[a,c],startedDay:1}],courtships:{},cooldowns:{}};
  store.saveRaw(saved);const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>new SimulationEngine(config,null,()=>0,new StateManager(file)),/Invalid active partnership/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
