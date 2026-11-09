const { version: applicationVersion } = require('../../package.json');

// Called synchronously: the event loop cannot advance the simulation or the
// request budget between capturing and serializing these values.
function exportWorld(engine, createdAt = new Date()) {
  const budget = engine.llmBatcher.budget;
  if (budget.error) throw new Error('The AI request counter is unavailable; a complete backup cannot be created.');
  const state = engine.createSnapshot();
  const metadata = {
    format: 'willowbrook-world-backup',
    formatVersion: 1,
    createdAt: createdAt.toISOString(),
    simulationTime: { ...state.time },
    applicationVersion,
    aiRequestBudget: budget.state ? { day: budget.state.day, used: budget.state.used } : null
  };
  return JSON.stringify({ ...state, _backup: metadata }, null, 2);
}

function backupFilename(date) {
  return `willowbrook-backup-${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

module.exports = { exportWorld, backupFilename };
