// Isolated fixture only: never writes the application's configured world.
const fs = require('fs');
const path = require('path');
const { StateManager } = require('../server/persistence/stateManager');
const { SimulationEngine } = require('../server/simulation/engine');
const config = require('../config/default.json');
const [mode, file, portArg = '3017'] = process.argv.slice(2);
if (!['create', 'inspect', 'serve'].includes(mode) || !file || !path.isAbsolute(file) ||
    !/^\d+$/.test(portArg) || Number(portArg) > 65535) {
  console.error('Usage: node scripts/history-demo.js create|inspect|serve /absolute/path/to/fixture.json [port]');
  process.exit(1);
}
if (mode === 'create' && (fs.existsSync(file) || fs.existsSync(file + '.bak'))) {
  console.error('Fixture already exists; refusing to overwrite it');
  process.exit(1);
}
if (mode !== 'create' && !fs.existsSync(file)) {
  console.error('Fixture does not exist');
  process.exit(1);
}
process.env.LLM_BASE_URL = '';
process.env.LLM_DAILY_LIMIT = '0';
delete process.env.LLM_API_KEY_FILE;
const engine = new SimulationEngine(config, null, () => performance.now(), new StateManager(file));
if (mode === 'create') {
  engine.history.record({ id: 'demo:community:1', type: 'community_event',
    description: 'A sample community event for testing.',
    entities: [{ kind: 'character', id: engine.world.characters[0].id }] });
  engine.save();
}
if (mode === 'serve') {
  const express = require('express');
  const app = express();
  app.set('engine', engine);
  app.use('/api', require('../server/api/routes'));
  engine.start();
  const server = app.listen(Number(portArg), '127.0.0.1', () => {
    console.log(`History fixture listening on http://127.0.0.1:${server.address().port}`);
  });
  const shutdown = () => { engine.stop(); engine.save(); server.close(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} else {
  console.log(JSON.stringify(engine.history.query({ limit: 10 }), null, 2));
}
