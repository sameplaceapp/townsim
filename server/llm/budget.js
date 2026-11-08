const fs = require('fs');
const path = require('path');
class RequestBudget {
  constructor(file = path.join(__dirname, '../../data/ai-budget.json')) {
    this.file = file;
    const value = process.env.LLM_DAILY_LIMIT || '0';
    this.limit = /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;
    this.error = null;
    try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') this.error = 'budget unavailable'; this.state = null; }
    if (this.state && (!/^\d{4}-\d{2}-\d{2}$/.test(this.state.day) || !Number.isSafeInteger(this.state.used) || this.state.used < 0)) this.error = 'invalid budget';
  }
  available() { const day = new Date().toISOString().slice(0, 10); return !this.error && this.limit > 0 && (!this.state || this.state.day < day || (this.state.day === day && this.state.used < this.limit)); }
  reserve() {
    if (!this.available()) return false;
    const day = new Date().toISOString().slice(0, 10);
    const next = { day, used: this.state && this.state.day === day ? this.state.used + 1 : 1 };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, this.file);
      this.state = next;
      return true;
    } catch (err) { this.error = 'budget unavailable'; console.error('AI budget save failed:', err.message); return false; }
  }
  status() { const day = new Date().toISOString().slice(0, 10); const used = this.state && this.state.day === day ? this.state.used : 0; return { day, limit: this.limit, used, remaining: Math.max(0, this.limit - used), error: this.error }; }
}
module.exports = { RequestBudget };
