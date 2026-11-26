class WelcomeBack {
  constructor(openHistory) {
    this.openHistory = openHistory;
    this.key = 'willowbrook:last-visit:v1';
    this.ready = false;
    this.generation = 0;
    this.lastStored = null;
    this.characters = [];
    this.panel = document.getElementById('welcome-back');
    document.getElementById('welcome-close').addEventListener('click', () => this.dismiss());
    document.getElementById('welcome-history').addEventListener('click', () => { this.dismiss(); this.openHistory(); });
    document.getElementById('welcome-retry').addEventListener('click', () => this.prepare());
  }
  setCharacters(characters) { this.characters = characters; }
  readMarker() {
    try {
      const marker = JSON.parse(localStorage.getItem(this.key) || 'null');
      const t = marker?.time;
      if (!marker || typeof marker.worldId !== 'string' || !marker.worldId ||
          !(marker.lastEventId === null || typeof marker.lastEventId === 'string') || !t ||
          !Number.isSafeInteger(t.day) || t.day < 1 || !Number.isInteger(t.hour) || t.hour < 0 || t.hour > 23 ||
          !Number.isInteger(t.minute) || t.minute < 0 || t.minute > 59) return null;
      return marker;
    }
    catch { return null; }
  }
  store(marker, reset = false) {
    if (!marker || !marker.worldId || !marker.time) return;
    if (!reset && this.lastMarker?.worldId === marker.worldId &&
        Number.isSafeInteger(marker.eventCount) && Number.isSafeInteger(this.lastMarker.eventCount) &&
        marker.eventCount < this.lastMarker.eventCount) return;
    const value = JSON.stringify(marker);
    if (value === this.lastStored) return;
    try { localStorage.setItem(this.key, value); this.lastStored = value; this.lastMarker = marker; }
    catch { /* The simulation continues when browser storage is unavailable. */ }
  }
  suspend() { this.ready = false; this.generation++; }
  async prepare(reconnect = false) {
    const generation = ++this.generation;
    const previous = this.readMarker();
    try {
      const response = await fetch('/api/welcome-back', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ previous }) });
      if (!response.ok) throw new Error('Report unavailable');
      const result = await response.json();
      if (generation !== this.generation) return;
      if (!result.marker?.worldId || !result.marker.time) throw new Error('Invalid report');
      if (this.showingError) { this.panel.hidden = true; this.showingError = false; }
      document.getElementById('welcome-retry').hidden = true;
      const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
      if (result.mode === 'return' && (result.count > 0 || (result.elapsedMinutes > 0 && !isReload && !reconnect))) this.render(result);
      // Commit only after the response is valid and its report is prepared.
      this.store(result.marker, true);
      this.ready = true;
    } catch {
      if (generation !== this.generation || !previous) return;
      document.getElementById('welcome-time').textContent = 'Unable to load your update. Your previous visit is still saved.';
      document.getElementById('welcome-quiet').hidden = true;
      document.getElementById('welcome-events').replaceChildren();
      document.getElementById('welcome-more').textContent = '';
      document.getElementById('welcome-retry').hidden = false;
      this.showingError = true;
      this.panel.hidden = false;
    }
  }
  observe(marker) { if (this.ready) this.store(marker); }
  dismiss() { this.panel.hidden = true; }
  render(result) {
    const minutes = result.elapsedMinutes;
    const parts = [];
    const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
    if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (rest || !parts.length) parts.push(`${rest} minute${rest === 1 ? '' : 's'}`);
    document.getElementById('welcome-time').textContent = `Day ${result.marker.time.day} · ${parts.join(', ')} of simulation time since your last visit`;
    const list = document.getElementById('welcome-events');
    list.replaceChildren();
    for (const event of result.events) {
      const item = document.createElement('li');
      const title = document.createElement('strong'); title.textContent = event.description;
      const context = document.createElement('span');
      const people = event.entities.filter(e => e.kind === 'character').map(e => this.characters.find(c => c.id === e.id)?.name || e.id);
      context.textContent = `Day ${event.time.day}${people.length ? ' · ' + people.join(', ') : ''}`;
      item.append(title,context); list.append(item);
    }
    const quiet = document.getElementById('welcome-quiet');
    quiet.hidden = result.count !== 0;
    quiet.textContent = 'No significant events were recorded while you were away.';
    const additional = Math.max(0, result.count - result.events.length);
    document.getElementById('welcome-more').textContent = additional ? `${additional} more recorded event${additional === 1 ? '' : 's'} in the town history.` : '';
    this.panel.hidden = false;
  }
}
