// A localhost-only disposable fixture; never opens or overwrites a real save.
const fs=require('fs'),path=require('path');
const {StateManager}=require('../server/persistence/stateManager');
const {SimulationEngine}=require('../server/simulation/engine');
const config=require('../config/default.json');
const [mode,file]=process.argv.slice(2);
if (!['create','serve'].includes(mode) || !file || !path.isAbsolute(file)) {
  console.error('Usage: node scripts/town-statistics-demo.js create|serve /absolute/path/to/fixture.json'); process.exit(1);
}
if(mode==='create' && (fs.existsSync(file)||fs.existsSync(file+'.bak'))) { console.error('Fixture exists; refusing to overwrite'); process.exit(1); }
if(mode==='serve' && !fs.existsSync(file)) { console.error('Fixture does not exist'); process.exit(1); }
process.env.LLM_BASE_URL='';process.env.LLM_DAILY_LIMIT='0';delete process.env.LLM_API_KEY_FILE;
let now=0;
const engine=new SimulationEngine(config,null,mode==='create'?()=>now:()=>performance.now(),new StateManager(file));
if(mode==='create') {
  const residents=engine.world.characters.slice();
  engine.tick=()=>{engine.world.tick++;}; engine.moveCharacters=()=>{}; engine.start();
  for(let day=1;day<=110;day++) {
    if(day===31) continue; // A missing observation, not an estimated population.
    engine.world.characters=residents.slice(0,day<40?10:day<80?11:12);
    engine.world.time={day,hour:23,minute:59}; now+=config.simulation.minuteInterval;engine.sync();
    if(day===5 || day===60) engine.history.record({id:`demo:event:${day}`,type:day===5?'community_event':'conflict',description:'Test fixture event',entities:[]});
  }
  engine.stop();engine.save();console.log('Created isolated statistics fixture with 109 actual observations.');
} else {
  const express=require('express'),http=require('http'),{setupWebSocket}=require('../server/api/websocket');
  const app=express(),server=http.createServer(app),wss=setupWebSocket(server);
  engine.wss=wss;app.use(express.json());app.use(express.static(path.join(__dirname,'../public')));
  app.set('engine',engine);app.use('/api',require('../server/api/routes'));
  wss.on('connection',ws=>ws.send(JSON.stringify({type:'snapshot',...engine.getState()})));
  engine.start();server.listen(3017,'127.0.0.1',()=>console.log('Fixture running at http://127.0.0.1:3017'));
  const shutdown=()=>{engine.stop();engine.save();wss.clients.forEach(ws=>ws.terminate());wss.close();server.close();};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
