// Creates a disposable world and applies one existing interaction; never open a real save.
const fs = require('fs');
const path = require('path');
const { StateManager } = require('../server/persistence/stateManager');
const { SimulationEngine } = require('../server/simulation/engine');
const config = require('../config/default.json');
const file = process.argv[2];
if (!file || !path.isAbsolute(file) || fs.existsSync(file) || fs.existsSync(file + '.bak')) {
  console.error('Supply an unused absolute fixture path; existing files are never overwritten');
  process.exit(1);
}
process.env.LLM_BASE_URL = '';
process.env.LLM_DAILY_LIMIT = '0';
delete process.env.LLM_API_KEY_FILE;
const engine = new SimulationEngine(config, null, () => performance.now(), new StateManager(file));
const [a,b] = engine.world.characters;
const relationship = () => ({ affection:6.96, trust:6.96, respect:6.96, attraction:6.96,
  level:6.96, tag:'friend', interactionCount:3 });
a.relationships[b.id] = relationship();
b.relationships[a.id] = relationship();
engine.interactions.updateRelationship(a, b, 'chat');
engine.save();
console.log(JSON.stringify(engine.history.query({limit:10}), null, 2));
