const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulationEngine}=require('../server/simulation/engine');
const {StateManager}=require('../server/persistence/stateManager');
const {Calendar}=require('../server/simulation/calendar');
const base=require('../config/default.json');

function temp(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'willow-calendar-'));return {dir,file:path.join(dir,'state.json')};}
function env(fn){const previous=process.env.CALENDAR_DAYS_PER_YEAR;delete process.env.CALENDAR_DAYS_PER_YEAR;try{return fn();}finally{if(previous===undefined)delete process.env.CALENDAR_DAYS_PER_YEAR;else process.env.CALENDAR_DAYS_PER_YEAR=previous;}}

test('calendar derives dates, validates configuration, and detects anniversaries',()=>env(()=>{
  const world={time:{day:1}};
  const calendar=new Calendar(world,{daysPerYear:12});
  assert.deepEqual(calendar.current(),{year:1,dayOfYear:1,daysPerYear:12});
  assert.deepEqual(calendar.dateForDay(12),{year:1,dayOfYear:12,daysPerYear:12});
  assert.deepEqual(calendar.dateForDay(13),{year:2,dayOfYear:1,daysPerYear:12});
  assert.equal(calendar.isAnniversary(25,1),true);
  assert.equal(calendar.isAnniversary(24,1),false);
  assert.throws(()=>calendar.isAnniversary(1,13),/Invalid/);
  process.env.CALENDAR_DAYS_PER_YEAR='bad';
  assert.throws(()=>new Calendar(world,{daysPerYear:12}),/positive integer/);
  assert.equal(new Calendar(world,{daysPerYear:12},{version:1,daysPerYear:7}).daysPerYear,7);
  assert.throws(()=>new Calendar(world,{}, {version:1,daysPerYear:0}),/positive/);
}));

test('accelerated and paused headless clocks emit each day, year and anniversary only at actual boundaries',()=>env(()=>{
  for(const speed of [1,2,5]) {
    const {dir,file}=temp();let now=0;
    const engine=new SimulationEngine(base,null,()=>now,new StateManager(file));
    engine.tick=()=>{engine.world.tick++;};engine.moveCharacters=()=>{};
    const days=[],years=[],anniversaries=[];
    engine.calendar.on('day',date=>days.push(date.absoluteDay));
    engine.calendar.on('year',date=>years.push(date.absoluteDay));
    const unsubscribe=engine.calendar.onAnniversary(1,date=>anniversaries.push(date.absoluteDay));
    engine.start();engine.setSpeed(speed);
    try {
      now+=26*1440*base.simulation.minuteInterval/speed;engine.sync();
      assert.equal(engine.world.time.day,27);
      assert.deepEqual(engine.calendar.current(),{year:3,dayOfYear:3,daysPerYear:12});
      assert.equal(days.length,26);assert.deepEqual(years,[13,25]);assert.deepEqual(anniversaries,[13,25]);
      engine.calendar.dayStarted(engine.world.time.day);assert.equal(days.length,26);
      engine.setSpeed(0);now+=2*1440*base.simulation.minuteInterval;engine.sync();
      assert.equal(engine.world.time.day,27);assert.equal(days.length,26);
      unsubscribe();engine.setSpeed(speed);now+=10*1440*base.simulation.minuteInterval/speed;engine.sync();
      assert.deepEqual(years,[13,25,37]);assert.deepEqual(anniversaries,[13,25]);
    } finally {engine.stop();fs.rmSync(dir,{recursive:true,force:true});}
  }
}));

test('new-world configuration and migrated saves persist without rewriting history or re-emitting a day',()=>env(()=>{
  const {dir,file}=temp();
  try {
    process.env.CALENDAR_DAYS_PER_YEAR='7';
    let engine=new SimulationEngine(base,null,()=>0,new StateManager(file));
    assert.equal(engine.calendar.daysPerYear,7);
    engine.world.time={day:22,hour:10,minute:5};
    engine.history.record({id:'existing:1',type:'conflict',description:'Existing record',entities:[]});
    engine.save();engine.save();
    const saved=new StateManager(file).load();
    const backup=JSON.parse(fs.readFileSync(file+'.bak','utf8'));
    assert.deepEqual(saved.calendar,{version:1,daysPerYear:7});assert.deepEqual(backup.calendar,saved.calendar);
    process.env.CALENDAR_DAYS_PER_YEAR='99';
    engine=new SimulationEngine({...base,calendar:{daysPerYear:3}},null,()=>0,new StateManager(file));
    assert.deepEqual(engine.calendar.current(),{year:4,dayOfYear:1,daysPerYear:7});
    assert.deepEqual(engine.history.toJSON(),saved.history);
    let calls=0;engine.calendar.on('day',()=>calls++);engine.calendar.dayStarted(22);assert.equal(calls,0);
    delete saved.calendar;new StateManager(file).saveRaw(saved);
    process.env.CALENDAR_DAYS_PER_YEAR='';
    const migrated=new SimulationEngine({...base,calendar:{daysPerYear:12}},null,()=>0,new StateManager(file));
    assert.deepEqual(migrated.calendar.current(),{year:2,dayOfYear:10,daysPerYear:12});
    assert.deepEqual(migrated.history.toJSON(),saved.history);
    migrated.save();process.env.CALENDAR_DAYS_PER_YEAR='20';
    const after=new SimulationEngine(base,null,()=>0,new StateManager(file));
    assert.equal(after.calendar.daysPerYear,12);
    assert.equal(after.world.time.day,22);
    let now=0;
    after.now=()=>now;after.tick=()=>{};after.moveCharacters=()=>{};
    const future=[];after.calendar.on('year',date=>future.push(date.absoluteDay));
    const anniversaries=[];after.calendar.onAnniversary(1,date=>anniversaries.push(date.absoluteDay));
    after.start();
    try {
      now+=3*1440*base.simulation.minuteInterval;after.sync();
      assert.deepEqual(future,[25]);assert.deepEqual(anniversaries,[25]);
      after.calendar.dayStarted(after.world.time.day);assert.deepEqual(future,[25]);
    } finally {after.stop();}
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}));
