// A disposable, localhost-only history fixture; it never opens the real world.
const fs = require('fs');
const path = require('path');
const { StateManager } = require('../server/persistence/stateManager');
const { SimulationEngine } = require('../server/simulation/engine');
const config = require('../config/default.json');
const [mode, file] = process.argv.slice(2);
if (!['create','serve'].includes(mode) || !file || !path.isAbsolute(file)) {
  console.error('Usage: node scripts/history-timeline-demo.js create|serve /absolute/path/to/fixture.json');
  process.exit(1);
}
if (mode === 'create' && (fs.existsSync(file) || fs.existsSync(file + '.bak'))) {
  console.error('Fixture already exists; refusing to overwrite it'); process.exit(1);
}
if (mode === 'serve' && !fs.existsSync(file)) { console.error('Fixture does not exist'); process.exit(1); }
process.env.LLM_BASE_URL=''; process.env.LLM_DAILY_LIMIT='0'; delete process.env.LLM_API_KEY_FILE;
const engine = new SimulationEngine(config, null, () => performance.now(), new StateManager(file));
if (mode === 'create') {
  const [a,b] = engine.world.characters;
  for (let i=0;i<80;i++) {
    engine.world.time={day:1+Math.floor(i/10),hour:8,minute:i%10};
    engine.history.record({id:`timeline-demo:${i}`,type:i%2?'conflict':'relationship_changed',
      description:i%2?'A conflict storyline began':'An established friendship formed',
      entities:[{kind:'character',id:a.id},{kind:'character',id:i%5 ? b.id : 'former_resident'}],
      metadata:{milestone:i%2?'conflict_started':'friendship_established',fixture:i}});
  }
  engine.save();
  console.log('Created an isolated fixture with 80 events.');
} else {
  const express = require('express'); const http = require('http');
  const {setupWebSocket} = require('../server/api/websocket');
  const app=express(); const server=http.createServer(app);
  const wss=setupWebSocket(server); engine.wss=wss;
  app.use(express.json()); app.use(express.static(path.join(__dirname,'../public')));
  app.set('engine',engine); app.use('/api',require('../server/api/routes'));
  wss.on('connection',ws=>ws.send(JSON.stringify({type:'snapshot',...engine.getState()})));
  engine.start();
  server.listen(3017,'127.0.0.1',()=>console.log('Fixture running at http://127.0.0.1:3017'));
  function shutdown() { engine.stop(); engine.save(); wss.clients.forEach(ws=>ws.terminate()); wss.close(); server.close(); }
  process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
}
