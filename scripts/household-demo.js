// Isolated, localhost-only fixture. Signals apply existing accepted interactions.
const fs=require('fs'),path=require('path');
const {StateManager}=require('../server/persistence/stateManager');
const {SimulationEngine}=require('../server/simulation/engine');
const {willing}=require('../server/simulation/partnerships');
const {willingToShare}=require('../server/simulation/households');
const base=require('../config/default.json');
const config={...base,drama:{...base.drama,eventChance:1,romanceFrequency:1,conflictFrequency:1,cooldownHours:18}};
const [mode,file]=process.argv.slice(2);
if(!['create','serve'].includes(mode)||!file||!path.isAbsolute(file)){console.error('Usage: node scripts/household-demo.js create|serve /absolute/path/to/fixture.json');process.exit(1);}
if(mode==='create'&&(fs.existsSync(file)||fs.existsSync(file+'.bak'))){console.error('Fixture exists; refusing to overwrite');process.exit(1);}
if(mode==='serve'&&!fs.existsSync(file)){console.error('Fixture does not exist');process.exit(1);}
process.env.LLM_BASE_URL='';process.env.LLM_DAILY_LIMIT='0';delete process.env.LLM_API_KEY_FILE;
const engine=new SimulationEngine(config,null,()=>performance.now(),new StateManager(file));
function findPair(){
 const chars=engine.world.characters;for(const a of chars)for(const b of chars)
  if(a!==b&&!a.personality.includes('cautious')&&!b.personality.includes('cautious')&&willing(a,b)&&willingToShare(a,b))return[a,b];
 throw new Error('No compatible fixture pair');
}
const [a,b]=findPair();
function action(actor,target,type,day){
 engine.world.time={day,hour:12,minute:0};actor.pos={x:1,y:1};target.pos={x:1,y:1};actor.inside=false;target.inside=false;target.activity='idle';
 engine.needsManager.decayAll=()=>{};engine.needsManager.checkCritical=()=>null;engine.actionManager.handleSchedule=()=>null;engine.actionManager.executeAction=()=>null;
 engine.scheduler.evaluate=()=>[{character:actor,reason:'encounter'}];engine.llmBatcher.decide=()=>[{character:actor,action:{type,target:target.id}}];
 const previous=Math.random;try{Math.random=()=>0;engine.tick();}finally{Math.random=previous;}
}
if(mode==='create'){
 const rel=()=>({affection:6.2,trust:6,attraction:5,respect:6,level:6,tag:'friend',interactionCount:12});
 a.relationships[b.id]=rel();b.relationships[a.id]=rel();
 action(a,b,'flirt',1);action(b,a,'flirt',2);action(a,b,'flirt',3);
 if(engine.partnerships.partnerOf(a.id)!==b.id)throw new Error('Fixture partnership did not form');
 engine.save();console.log(`Created established partners in separate homes: ${a.name} and ${b.name}.`);
}else{
 const express=require('express'),http=require('http'),{setupWebSocket}=require('../server/api/websocket');
 const app=express(),server=http.createServer(app),wss=setupWebSocket(server);
 engine.wss=wss;app.use(express.json());app.use(express.static(path.join(__dirname,'../public')));
 app.set('engine',engine);app.use('/api',require('../server/api/routes'));
 wss.on('connection',ws=>ws.send(JSON.stringify({type:'snapshot',...engine.getState()})));
 engine.start();engine.setSpeed(0);
 server.listen(3017,'127.0.0.1',()=>console.log(`Fixture running at http://127.0.0.1:3017 (paused); pair: ${a.name} and ${b.name}.`));
 let calls=0;
 process.on('SIGUSR1',()=>{
  calls++;const partnership=engine.partnerships.byCharacter.get(a.id);
  if(!partnership){console.log('No active fixture partnership');return;}
  const day=Math.max(engine.world.time.day+1,partnership.startedDay+12);
  action(calls%2?a:b,calls%2?b:a,'comfort',day);engine.save();engine.broadcastState();
  console.log(`Applied accepted interaction ${calls}; shared home: ${engine.households.info(a.id).id===engine.households.info(b.id).id?'yes':'no'}.`);
 });
 const shutdown=()=>{engine.stop();engine.save();wss.clients.forEach(ws=>ws.terminate());wss.close();server.close();};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
