const fs = require('fs');
const path = require('path');
const STATE_PATH = path.join(__dirname, '..', '..', 'data', 'state.json');
class StateManager {
  constructor(file = STATE_PATH) { this.file = file; this.recovered = false; }
  load() {
    let found = false;
    for (const file of [this.file, this.file + '.bak']) {
      if (!fs.existsSync(file)) continue;
      found = true;
      try {
        const state = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (state && Number.isInteger(state.version) && state.version > 1) {
          const err = new Error(`World snapshot version ${state.version} is newer than this application`);
          err.code = 'UNSUPPORTED_WORLD_VERSION';
          throw err;
        }
        if (!state || !Array.isArray(state.characters) || !state.time || !Number.isInteger(state.tick) || state.tick < 0 ||
            state.characters.some(c => !c || typeof c.id !== 'string' || !c.pos || !c.needs) ||
            (state.grid && (!Number.isInteger(state.gridWidth) || !Number.isInteger(state.gridHeight) ||
              !Array.isArray(state.grid) || state.grid.length !== state.gridHeight ||
              state.grid.some(row => !Array.isArray(row) || row.length !== state.gridWidth)))) {
          throw new Error('Invalid world snapshot');
        }
        this.recovered = file.endsWith('.bak');
        if (this.recovered) console.warn('Recovered world from backup');
        return state;
      } catch (err) {
        if (err.code === 'UNSUPPORTED_WORLD_VERSION') throw err;
        console.error(`Cannot load ${file}: ${err.message}`);
      }
    }
    if (found) throw new Error('No valid world snapshot; refusing to overwrite saved data');
    return null;
  }
  saveRaw(state) {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = this.file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!this.recovered && fs.existsSync(this.file)) {
      const backupTmp = this.file + '.bak.tmp';
      fs.copyFileSync(this.file, backupTmp);
      fs.renameSync(backupTmp, this.file + '.bak');
    }
    fs.renameSync(tmp, this.file);
    this.recovered = false;
  }
}
module.exports = { StateManager };
