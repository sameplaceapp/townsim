const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const {ageOnDate}=require('../server/simulation/aging');
const base=require('../config/default.json');
const config={...base,calendar:{daysPerYear:4}};
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-aging-'));return {dir,file:path.join(dir,'world.json')};}
function fakeRun(engine){engine.tick=()=>{engine.world.tick++;};engine.moveCharacters=()=>{};engine.start();}

test('founding residents have deterministic, varied adult ages and birthdays; prior age and birthday migrate safely',()=>{
  const {dir,file}=fixture();
  try {
    const initial=new SimulationEngine(config,null,()=>0,new StateManager(file));
    const initialAges=initial.world.characters.map(c=>c.toSummary(initial.calendar).age);
    assert.ok(initialAges.every(age=>age>=23&&age<=60));assert.ok(new Set(initialAges).size>1);
    assert.ok(new Set(initial.world.characters.map(c=>c.birthDate.dayOfYear)).size>1);
    initial.world.characters[0].recentMemory=['remembered'];
    initial.history.record({id:'existing-event',type:'conflict',description:'Previously recorded',entities:[]});
    initial.save();const legacy=new StateManager(file).load();
    const relationships=JSON.stringify(legacy.characters[0].relationships);
    for(const c of legacy.characters)delete c.birthDate;
    legacy.characters[0].age=42;legacy.characters[0].birthday=3;
    legacy.characters[1].age=0;
    legacy.characters[2].birthDate={year:-24,dayOfYear:2};
    new StateManager(file).saveRaw(legacy);
    const first=new SimulationEngine(config,null,()=>0,new StateManager(file));
    const second=new SimulationEngine(config,null,()=>0,new StateManager(file));
    assert.deepEqual(first.world.characters.map(c=>c.birthDate),second.world.characters.map(c=>c.birthDate));
    assert.equal(first.world.characters[0].toSummary(first.calendar).age,42);
    assert.equal(first.world.characters[0].toSummary(first.calendar).birthday,3);
    assert.equal(first.world.characters[1].toSummary(first.calendar).age,0);
    assert.deepEqual(first.world.characters[2].birthDate,{year:-24,dayOfYear:2});
    assert.deepEqual(first.world.characters[0].recentMemory,['remembered']);
    assert.equal(JSON.stringify(first.world.characters[0].relationships),relationships);
    assert.equal(first.history.query().events[0].id,'existing-event');
    first.save();const saved=new StateManager(file).load();
    assert.equal(saved.characters[0].age,undefined);assert.equal(saved.characters[0].birthday,undefined);
    assert.deepEqual(saved.characters[0].birthDate,first.world.characters[0].birthDate);
    const restored=new SimulationEngine(config,null,()=>0,new StateManager(file));
    assert.equal(restored.world.characters[0].toSummary(restored.calendar).age,42);
    assert.deepEqual(restored.world.characters.map(c=>c.birthDate),first.world.characters.map(c=>c.birthDate));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('one-day years assign valid birthdays and derive an age on every new day',()=>{
  const {dir,file}=fixture();
  try {
    const engine=new SimulationEngine({...base,calendar:{daysPerYear:1}},null,()=>0,new StateManager(file));
    const resident=engine.world.characters[0];
    assert.equal(resident.birthDate.dayOfYear,1);
    const before=resident.toSummary(engine.calendar).age;
    engine.world.time.day=2;
    assert.equal(resident.toSummary(engine.calendar).age,before+1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('birthdays occur on their own calendar days at all speeds and decade milestones survive restarts',()=>{
  for(const speed of [1,2,5]) {
    const {dir,file}=fixture();let now=0;
    try {
      let engine=new SimulationEngine(config,null,()=>now,new StateManager(file));
      engine.world.characters=engine.world.characters.slice(0,2);
      const [a,b]=engine.world.characters;
      a.birthDate={year:-29,dayOfYear:2}; b.birthDate={year:-27,dayOfYear:3};
      assert.equal(a.toSummary(engine.calendar).age,29);assert.equal(b.toSummary(engine.calendar).age,27);
      engine.world.time={day:1,hour:23,minute:59};fakeRun(engine);engine.setSpeed(speed);
      now+=config.simulation.minuteInterval/speed;engine.sync();
      assert.equal(a.toSummary(engine.calendar).age,30);assert.equal(b.toSummary(engine.calendar).age,27);
      let events=engine.history.query({type:'birthday_milestone'}).events;
      assert.equal(events.length,1);assert.equal(events[0].metadata.age,30);assert.equal(events[0].time.day,2);
      assert.deepEqual(events[0].entities,[{kind:'character',id:a.id}]);
      engine.sync();engine.calendar.dayStarted(2);
      assert.equal(engine.history.query({type:'birthday_milestone'}).events.length,1);
      engine.setSpeed(0);now+=8*1440*config.simulation.minuteInterval;engine.sync();
      assert.equal(a.toSummary(engine.calendar).age,30);
      assert.equal(engine.history.query({type:'birthday_milestone'}).events.length,1);
      engine.stop();engine.save();engine.save();
      const backup=JSON.parse(fs.readFileSync(file+'.bak','utf8'));
      assert.equal(backup.history.events[0].id,events[0].id);
      engine=new SimulationEngine(config,null,()=>now,new StateManager(file));
      assert.equal(engine.world.characters[0].toSummary(engine.calendar).age,30);
      fakeRun(engine);engine.setSpeed(speed);
      now+=1440*config.simulation.minuteInterval/speed;engine.sync();
      assert.equal(engine.world.characters[1].toSummary(engine.calendar).age,28);
      assert.equal(engine.history.query({type:'birthday_milestone'}).events.length,1);
      now+=8*1440*config.simulation.minuteInterval/speed;engine.sync();
      assert.equal(engine.world.characters[0].toSummary(engine.calendar).age,32);
      assert.equal(engine.world.characters[1].toSummary(engine.calendar).age,30);
      events=engine.history.query({type:'birthday_milestone'}).events;
      assert.equal(events.length,2);assert.equal(events[1].time.day,11);
      engine.stop();engine.save();
      const restarted=new SimulationEngine(config,null,()=>now,new StateManager(file));
      assert.equal(restarted.world.characters[0].toSummary(restarted.calendar).age,32);
      assert.equal(restarted.history.query({type:'birthday_milestone'}).events.length,2);
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test('conflicting existing ages fail without modifying the saved world',()=>{
  const {dir,file}=fixture();
  try {
    const engine=new SimulationEngine(config,null,()=>0,new StateManager(file));engine.save();
    const store=new StateManager(file),saved=store.load();
    saved.characters[0].age=999;store.saveRaw(saved);
    const before=fs.readFileSync(file,'utf8');
    assert.throws(()=>new SimulationEngine(config,null,()=>0,new StateManager(file)),/Conflicting existing age/);
    assert.equal(fs.readFileSync(file,'utf8'),before);
    assert.throws(()=>ageOnDate({year:2,dayOfYear:2},{year:1,dayOfYear:1,daysPerYear:4}),/future/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
