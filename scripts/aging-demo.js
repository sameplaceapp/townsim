// Disposable test world with two distinct birthdays around a year boundary.
const fs=require('fs'),path=require('path');
const {StateManager}=require('../server/persistence/stateManager');
const {SimulationEngine}=require('../server/simulation/engine');
const config=require('../config/default.json');
const [mode,file]=process.argv.slice(2);
if(!['create','serve'].includes(mode)||!file||!path.isAbsolute(file)) {
  console.error('Usage: node scripts/aging-demo.js create|serve /absolute/path/to/fixture.json');process.exit(1);
}
if(mode==='create'&&(fs.existsSync(file)||fs.existsSync(file+'.bak'))) {console.error('Fixture exists; refusing to overwrite');process.exit(1);}
if(mode==='serve'&&!fs.existsSync(file)) {console.error('Fixture does not exist');process.exit(1);}
process.env.LLM_BASE_URL='';process.env.LLM_DAILY_LIMIT='0';delete process.env.LLM_API_KEY_FILE;
if(mode==='create') process.env.CALENDAR_DAYS_PER_YEAR='12';
const engine=new SimulationEngine(config,null,()=>performance.now(),new StateManager(file));
if(mode==='create') {
  engine.world.time={day:12,hour:23,minute:59};engine.world.phase=engine.world.getPhase();
  const [alice,bob]=engine.world.characters;
  alice.birthDate={year:-28,dayOfYear:1}; bob.birthDate={year:-30,dayOfYear:6};
  engine.save();console.log('Created isolated fixture: Alice is 29 and Bob is 31.');
} else {
  const express=require('express'),http=require('http'),{setupWebSocket}=require('../server/api/websocket');
  const app=express(),server=http.createServer(app),wss=setupWebSocket(server);
  engine.wss=wss;app.use(express.json());app.use(express.static(path.join(__dirname,'../public')));
  app.set('engine',engine);app.use('/api',require('../server/api/routes'));
  wss.on('connection',ws=>ws.send(JSON.stringify({type:'snapshot',...engine.getState()})));
  engine.start();engine.setSpeed(0);
  server.listen(3017,'127.0.0.1',()=>console.log('Fixture running at http://127.0.0.1:3017 (paused)'));
  const shutdown=()=>{engine.stop();engine.save();wss.clients.forEach(ws=>ws.terminate());wss.close();server.close();};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
