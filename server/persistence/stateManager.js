const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', '..', 'data', 'state.json');

class StateManager {
  load() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        const data = fs.readFileSync(STATE_PATH, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('Failed to load state:', err.message);
    }
    return null;
  }

  save(world) {
    try {
      const dir = path.dirname(STATE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const state = {
        tick: world.tick,
        time: world.time,
        phase: world.phase,
        characters: world.characters.map(c => ({
          id: c.id,
          pos: c.pos,
          needs: c.needs,
          relationships: c.relationships,
          activity: c.activity,
          activityData: c.activityData,
          location: c.location,
          inside: c.inside,
          recentMemory: c.recentMemory,
          mood: c.mood,
          moodHistory: c.moodHistory
        })),
        activityLog: world.activityLog.slice(-100)
      };

      // Atomic write: write to temp, then rename
      const tmpPath = STATE_PATH + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
      fs.renameSync(tmpPath, STATE_PATH);
    } catch (err) {
      console.error('Failed to save state:', err.message);
    }
  }

  // Save pre-built state data (includes drama engine state)
  saveRaw(state) {
    try {
      const dir = path.dirname(STATE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmpPath = STATE_PATH + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
      fs.renameSync(tmpPath, STATE_PATH);
    } catch (err) {
      console.error('Failed to save state:', err.message);
    }
  }
}

module.exports = { StateManager };
