// Disposable, localhost-only fixture; signals advance the existing simulation calendar.
const fs=require('fs'),path=require('path');
const {StateManager}=require('../server/persistence/stateManager');
const {SimulationEngine}=require('../server/simulation/engine');
const base=require('../config/default.json');
const config={...base,reproduction:{...base.reproduction,dailyChance:1,minPartnershipDays:1,gestationDays:3,birthCooldownDays:20}};
const [mode,file]=process.argv.slice(2);
if(!['create','serve'].includes(mode)||!file||!path.isAbsolute(file)){console.error('Usage: node scripts/reproduction-demo.js create|serve /absolute/path/to/fixture.json');process.exit(1);}
if(mode==='create'&&(fs.existsSync(file)||fs.existsSync(file+'.bak'))){console.error('Fixture exists; refusing to overwrite');process.exit(1);}
if(mode==='serve'&&!fs.existsSync(file)){console.error('Fixture does not exist');process.exit(1);}
process.env.LLM_DAILY_LIMIT='0';delete process.env.LLM_API_KEY_FILE;
const engine=new SimulationEngine(config,null,()=>performance.now(),new StateManager(file));
if(mode==='create'){
 const [a,b]=engine.world.characters;a.reproductiveRole='gestational';b.reproductiveRole='other';
 a.birthDate={year:-26,dayOfYear:1};b.birthDate={year:-28,dayOfYear:1};
 const rel=()=>({affection:7,trust:7,attraction:6,interactionCount:12,tag:'friend',level:7});a.relationships[b.id]=rel();b.relationships[a.id]=rel();
 const ha=engine.households.byMember.get(a.id),hb=engine.households.byMember.get(b.id);
 hb.status='merged';hb.endedAt={...engine.world.time};hb.mergedInto=ha.id;ha.members.push(b.id);engine.households.byMember.set(b.id,ha);b.home=ha.residenceId;
 const p={id:'fixture-pair',partners:[a.id,b.id],startedDay:1};engine.partnerships.active.set(p.id,p);for(const id of p.partners)engine.partnerships.byCharacter.set(id,p);
 engine.save();console.log(`Created isolated eligible pair ${a.name} and ${b.name}.`);
}else{
 const express=require('express'),http=require('http'),{setupWebSocket}=require('../server/api/websocket');
 const app=express(),server=http.createServer(app),wss=setupWebSocket(server);engine.wss=wss;
 app.use(express.json());app.use(express.static(path.join(__dirname,'../public')));app.set('engine',engine);app.use('/api',require('../server/api/routes'));
 wss.on('connection',ws=>ws.send(JSON.stringify({type:'snapshot',...engine.getState()})));
 engine.start();engine.setSpeed(0);
 server.listen(3017,'127.0.0.1',()=>console.log('Fixture running at http://127.0.0.1:3017 (paused).'));
 process.on('SIGUSR1',()=>{
  const completed=engine.world.time.day;engine.townStatistics.observe(completed,engine.world.characters.length);
  engine.world.time={day:completed+1,hour:0,minute:0};engine.calendar.dayStarted(engine.world.time.day);
  engine.save();engine.broadcastState();console.log(`Day ${engine.world.time.day}: ${engine.reproduction.pending.length} pending; ${engine.world.characters.length} residents.`);
 });
 const shutdown=()=>{engine.stop();engine.save();wss.clients.forEach(ws=>ws.terminate());wss.close();server.close();};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
