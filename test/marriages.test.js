const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const {willing}=require('../server/simulation/partnerships');
const {willingToMarry}=require('../server/simulation/marriages');
const base=require('../config/default.json');
const config={...base,drama:{eventChance:1,conflictFrequency:1,romanceFrequency:1,cooldownHours:18}};
const rel=()=>({affection:7.3,trust:6.5,attraction:6,respect:6,level:7,tag:'friend',interactionCount:12});
function pair(a,b){a.relationships[b.id]=rel();b.relationships[a.id]=rel();}
function instrument(engine){engine.needsManager.decayAll=()=>{};engine.needsManager.checkCritical=()=>null;engine.actionManager.handleSchedule=()=>null;engine.actionManager.executeAction=()=>null;}
function apply(engine,a,b,action,day){
  engine.world.time={day,hour:12,minute:0};a.pos={x:1,y:1};b.pos={x:1,y:1};a.inside=false;b.inside=false;b.activity='idle';
  engine.scheduler.evaluate=()=>[{character:a,reason:'encounter'}];engine.llmBatcher.decide=()=>[{character:a,action:{type:action,target:b.id}}];engine.tick();
}
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-marriage-')),file=path.join(dir,'world.json');
  const engine=new SimulationEngine(config,null,()=>0,new StateManager(file));let a,b;
  for(const x of engine.world.characters)for(const y of engine.world.characters){
    const p={...x,personality:[]},q={...y,personality:[]};
    if(x!==y&&!a&&willing(p,q)&&willingToMarry(p,q,0)&&willingToMarry(p,q,2)){a=x;b=y;}
  }
  assert.ok(a&&b);a.personality=[];b.personality=[];pair(a,b);instrument(engine);
  return {engine,dir,file,a,b};
}
function partner(engine,a,b,start=1){apply(engine,a,b,'flirt',start);apply(engine,b,a,'flirt',start+1);apply(engine,a,b,'flirt',start+2);assert.equal(engine.partnerships.partnerOf(a.id),b.id);}
function marry(engine,a,b,start){apply(engine,a,b,'comfort',start);apply(engine,b,a,'comfort',start+1);apply(engine,a,b,'comfort',start+2);}

test('marriage, separation, divorce and remarriage are mutual, durable and recorded exactly once',()=>{
  const f=setup(),oldRandom=Math.random;let {engine,a,b}=f;
  try {
    Math.random=()=>0;partner(engine,a,b);marry(engine,a,b,15);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'married');assert.equal(engine.marriages.info(b.id).spouseId,a.id);
    assert.equal(engine.marriages.info(a.id).spouseId,b.id);
    assert.equal(engine.history.query({type:'marriage'}).events.length,1);
    const ids=[a.id,b.id],first=engine.marriages.current.get(a.id),firstId=first.id;
    engine.save();engine.save();
    assert.equal(JSON.parse(fs.readFileSync(f.file+'.bak','utf8')).marriages.records.length,1);
    engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));instrument(engine);
    a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
    assert.equal(engine.marriages.info(a.id).spouseId,b.id);
    for(const r of [a.relationships[b.id],b.relationships[a.id]]){r.affection=1.5;r.trust=2;}
    apply(engine,a,b,'argue',25);apply(engine,b,a,'argue',26);apply(engine,a,b,'argue',27);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'separated');
    assert.equal(engine.partnerships.partnerOf(a.id),b.id);
    assert.equal(engine.history.query({type:'separation'}).events.length,1);
    apply(engine,a,b,'argue',33);apply(engine,b,a,'argue',34);
    engine.save();engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));instrument(engine);
    a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
    apply(engine,a,b,'argue',35);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'divorced');assert.equal(engine.marriages.info(b.id).spouseId,null);
    assert.equal(engine.partnerships.partnerOf(a.id),null);
    assert.equal(engine.marriages.info(a.id).previousSpouses[0].id,b.id);
    assert.equal(engine.history.query({type:'divorce'}).events.length,1);
    const old=engine.marriages.records.find(r=>r.id===firstId);
    assert.equal(old.status,'divorced');assert.equal(old.separations.length,1);assert.equal(old.divorcedAt.day,35);
    pair(a,b);partner(engine,a,b,41);marry(engine,a,b,55);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'married');
    assert.equal(engine.history.query({type:'marriage'}).events.length,2);
    assert.equal(engine.history.query({type:'marriage'}).events[1].metadata.milestone,'remarriage');
    engine.save();const restored=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
    assert.equal(restored.marriages.info(a.id).spouseId,b.id);
    assert.equal(restored.marriages.info(a.id).previousSpouses[0].id,b.id);
    assert.equal(restored.history.query({type:'divorce'}).events.length,1);
    assert.equal(restored.history.query({type:'marriage'}).events.length,2);
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('marriage requires established exclusive adult partners, mutual evidence and compatible relationships',()=>{
  const f=setup(),{engine,a,b}=f,oldRandom=Math.random;
  try {
    Math.random=()=>0;
    marry(engine,a,b,1);assert.equal(engine.marriages.info(a.id).maritalStatus,'never_married');
    partner(engine,a,b,4);
    marry(engine,a,b,7);assert.equal(engine.marriages.info(a.id).maritalStatus,'never_married');
    for(let d=18;d<24;d++)apply(engine,a,b,'comfort',d);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'never_married');
    a.parentIds=[b.id];apply(engine,b,a,'comfort',24);apply(engine,a,b,'comfort',25);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'never_married');
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('separated spouses can reconcile, and subsequent separations keep both history records',()=>{
  const f=setup(),{engine,a,b}=f,oldRandom=Math.random;
  try {
    Math.random=()=>0;partner(engine,a,b);marry(engine,a,b,15);
    for(const r of [a.relationships[b.id],b.relationships[a.id]]){r.affection=1.5;r.trust=2;}
    apply(engine,a,b,'argue',25);apply(engine,b,a,'argue',26);apply(engine,a,b,'argue',27);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'separated');
    pair(a,b);apply(engine,a,b,'forgive',28);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'married');
    assert.equal(engine.history.query({type:'relationship_changed'}).events.filter(e=>e.metadata.milestone==='marital_reconciliation').length,1);
    for(const r of [a.relationships[b.id],b.relationships[a.id]]){r.affection=1.5;r.trust=2;}
    apply(engine,a,b,'argue',35);apply(engine,b,a,'argue',36);apply(engine,a,b,'argue',37);
    assert.equal(engine.marriages.info(a.id).maritalStatus,'separated');
    assert.equal(engine.history.query({type:'separation'}).events.length,2);
    engine.save();const restored=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
    assert.equal(restored.marriages.info(a.id).maritalStatus,'separated');
    assert.equal(restored.marriages.current.get(a.id).separations.length,2);
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('missing marriage history is rejected without overwriting the saved world',()=>{
  const f=setup(),{engine,a,b}=f,oldRandom=Math.random;
  try {
    Math.random=()=>0;partner(engine,a,b);marry(engine,a,b,15);engine.save();
    const store=new StateManager(f.file),saved=store.load();
    saved.history.events=saved.history.events.filter(e=>e.type!=='marriage');store.saveRaw(saved);
    const original=fs.readFileSync(f.file,'utf8');
    assert.throws(()=>new SimulationEngine(config,null,()=>0,new StateManager(f.file)),/Missing or inconsistent marriage history/);
    assert.equal(fs.readFileSync(f.file,'utf8'),original);
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('rule-based residents can marry without an external AI and many compatible couples do not',()=>{
  const f=setup(),{engine,a,b}=f,oldRandom=Math.random;
  try {
    Math.random=()=>0;partner(engine,a,b);delete engine.llmBatcher.decide;engine.llmBatcher.enabled=false;
    a.needs.social=9;b.needs.social=9;engine.world.getCharactersNear=()=>[a,b];
    for(let day=15;day<=17;day++){
      const actor=day%2?a:b;
      engine.world.time={day,hour:12,minute:0};engine.scheduler.evaluate=()=>[{character:actor,reason:'encounter'}];engine.tick();
    }
    assert.equal(engine.marriages.info(a.id).maritalStatus,'married');
    let likely=0;
    for(let i=0;i<100;i++)if(willingToMarry({id:`a${i}`,personality:[]},{id:`b${i}`,personality:[]},0))likely++;
    assert.ok(likely>=20&&likely<=65,`compatible marriage choices: ${likely}`);
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('conflicting current marriages fail safely even with matching history',()=>{
  const f=setup(),{engine,a,b}=f,oldRandom=Math.random;
  try {
    Math.random=()=>0;partner(engine,a,b);marry(engine,a,b,15);engine.save();
    const store=new StateManager(f.file),saved=store.load(),original=saved.marriages.records[0];
    const duplicate=structuredClone(original);duplicate.id='duplicate';duplicate.marriageEventId='marriage:duplicate:formed';
    const event=structuredClone(saved.history.events.find(e=>e.id===original.marriageEventId));
    event.id=duplicate.marriageEventId;event.metadata.marriageId=duplicate.id;
    saved.marriages.records.push(duplicate);saved.history.events.push(event);store.saveRaw(saved);
    const before=fs.readFileSync(f.file,'utf8');
    assert.throws(()=>new SimulationEngine(config,null,()=>0,new StateManager(f.file)),/Conflicting marriages/);
    assert.equal(fs.readFileSync(f.file,'utf8'),before);
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('ending an unmarried partnership clears marriage intent before the next save',()=>{
  const f=setup(),{engine,a,b}=f,oldRandom=Math.random;
  try {
    Math.random=()=>0;partner(engine,a,b);apply(engine,a,b,'comfort',15);apply(engine,b,a,'comfort',16);
    assert.equal(Object.keys(engine.marriages.intent).length,1);
    for(const r of [a.relationships[b.id],b.relationships[a.id]]){r.affection=1.5;r.trust=2;}
    apply(engine,a,b,'argue',20);apply(engine,b,a,'argue',21);apply(engine,a,b,'argue',22);
    assert.equal(engine.partnerships.partnerOf(a.id),null);assert.equal(Object.keys(engine.marriages.intent).length,0);
    engine.save();const restored=new SimulationEngine(config,null,()=>0,new StateManager(f.file));
    assert.equal(restored.marriages.info(a.id).maritalStatus,'never_married');
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('marriage intent continues across a restart without repeating its first interaction',()=>{
  const f=setup(),oldRandom=Math.random;let {engine,a,b}=f;
  try {
    Math.random=()=>0;partner(engine,a,b);apply(engine,a,b,'comfort',15);
    const ids=[a.id,b.id];engine.save();engine=new SimulationEngine(config,null,()=>0,new StateManager(f.file));instrument(engine);
    a=engine.world.characters.find(c=>c.id===ids[0]);b=engine.world.characters.find(c=>c.id===ids[1]);
    apply(engine,b,a,'comfort',16);assert.equal(engine.marriages.info(a.id).maritalStatus,'never_married');
    apply(engine,a,b,'comfort',17);assert.equal(engine.marriages.info(a.id).maritalStatus,'married');
    assert.equal(engine.history.query({type:'marriage'}).events.length,1);
  } finally {Math.random=oldRandom;fs.rmSync(f.dir,{recursive:true,force:true});}
});
