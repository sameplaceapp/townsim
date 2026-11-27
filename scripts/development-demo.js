// Isolated, localhost-only lifecycle fixture. Each signal advances to the next stage.
const fs=require('fs'),path=require('path');
const {StateManager}=require('../server/persistence/stateManager');
const {SimulationEngine}=require('../server/simulation/engine');
const {Character}=require('../server/simulation/character');
const base=require('../config/default.json');
const config={...base,reproduction:{...base.reproduction,dailyChance:0}};
const [mode,file]=process.argv.slice(2);
if(!['create','serve'].includes(mode)||!file||!path.isAbsolute(file)){console.error('Usage: node scripts/development-demo.js create|serve /absolute/path/to/fixture.json');process.exit(1);}
if(mode==='create'&&(fs.existsSync(file)||fs.existsSync(file+'.bak'))){console.error('Fixture exists; refusing to overwrite');process.exit(1);}
if(mode==='serve'&&!fs.existsSync(file)){console.error('Fixture does not exist');process.exit(1);}
process.env.LLM_DAILY_LIMIT='0';delete process.env.LLM_API_KEY_FILE;
const engine=new SimulationEngine(config,null,()=>performance.now(),new StateManager(file));
if(mode==='create'){
 const parent=engine.world.characters[0],home=engine.world.buildings[parent.home],date=engine.calendar.current();
 const child=new Character({id:'child:lifecycle-demo',name:'Robin',job:'dependent',personality:['quiet'],home:parent.home,birthDate:{year:date.year,dayOfYear:date.dayOfYear}}, {x:home.door[0],y:home.door[1]});
 child.parentIds=[parent.id];child.lifecycle='infant';child.workplace=null;child.schedule={};child.activity='sleep';child.location=parent.home;child.inside=true;
 engine.world.characters.push(child);const household=engine.households.byMember.get(parent.id);household.members.push(child.id);engine.households.byMember.set(child.id,household);
 engine.history.record({id:'birth:child:lifecycle-demo',type:'birth',description:'Robin was born',entities:[{kind:'character',id:child.id},{kind:'character',id:parent.id}]});
 engine.save();console.log(`Created Robin, age 0, in ${parent.name}'s household.`);
}else{
 const express=require('express'),http=require('http'),{setupWebSocket}=require('../server/api/websocket');
 const app=express(),server=http.createServer(app),wss=setupWebSocket(server);engine.wss=wss;
 app.use(express.json());app.use(express.static(path.join(__dirname,'../public')));app.set('engine',engine);app.use('/api',require('../server/api/routes'));
 wss.on('connection',ws=>ws.send(JSON.stringify({type:'snapshot',...engine.getState()})));
 engine.start();engine.setSpeed(0);server.listen(3017,'127.0.0.1',()=>console.log('Fixture running at http://127.0.0.1:3017 (paused).'));
 process.on('SIGUSR1',()=>{
  const child=engine.world.characters.find(c=>c.id==='child:lifecycle-demo'),b=engine.development.boundaries;
  const next={infant:b.childAge,child:b.teenAge,teen:b.adultAge}[child.lifecycle];
  if(next===undefined){console.log('Robin is already an adult.');return;}
  const start=engine.world.time.day;
  while(child.toSummary(engine.calendar).age<next){const completed=engine.world.time.day;engine.townStatistics.observe(completed,engine.world.characters.length);engine.world.time={day:completed+1,hour:0,minute:0};engine.calendar.dayStarted(engine.world.time.day);}
  engine.save();engine.broadcastState();console.log(`Advanced from day ${start} to ${engine.world.time.day}: Robin is ${child.lifecycle}, age ${child.toSummary(engine.calendar).age}.`);
 });
 const shutdown=()=>{engine.stop();engine.save();wss.clients.forEach(ws=>ws.terminate());wss.close();server.close();};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
