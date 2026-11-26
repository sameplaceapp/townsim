class HistoryPanel {
  constructor(onCharacter) {
    this.onCharacter = onCharacter;
    this.panel = document.getElementById('history-panel');
    this.openButton = document.getElementById('history-open');
    this.list = document.getElementById('history-list');
    this.status = document.getElementById('history-status');
    this.detail = document.getElementById('history-detail');
    this.more = document.getElementById('history-more');
    this.category = document.getElementById('history-category');
    this.character = document.getElementById('history-character');
    this.from = document.getElementById('history-from');
    this.to = document.getElementById('history-to');
    this.residents = document.getElementById('history-residents');
    this.characters = [];
    this.buildings = {};
    this.generation = 0;
    this.before = null;
    this.loading = false;
    this.filters = {};
    this.openButton.addEventListener('click', () => this.open());
    document.getElementById('history-close').addEventListener('click', () => this.close());
    document.getElementById('history-apply').addEventListener('click', () => this.apply());
    document.getElementById('history-clear').addEventListener('click', () => {
      this.category.value = this.character.value = this.from.value = this.to.value = '';
      this.apply();
    });
    document.getElementById('history-refresh').addEventListener('click', () => this.apply());
    this.more.addEventListener('click', () => this.load(false));
    this.panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  setCharacters(characters) {
    this.characters = characters;
    if (this.panel.hidden) return;
    const key = JSON.stringify(characters.map(c => [c.id, c.name]));
    if (key === this.residentKey) return;
    this.residentKey = key;
    this.residents.replaceChildren(...characters.map(c => {
      const option = document.createElement('option');
      option.value = c.id;
      option.label = c.name || c.id;
      return option;
    }));
  }
  setBuildings(buildings) { this.buildings = buildings || {}; }
  open() { this.panel.hidden = false; this.openButton.setAttribute('aria-expanded', 'true'); this.setCharacters(this.characters); this.apply(); }
  close() {
    this.panel.hidden = true;
    this.openButton.setAttribute('aria-expanded', 'false');
    this.generation++;
    if (this.controller) this.controller.abort();
    this.loading = false;
    this.openButton.focus();
  }
  apply() {
    const input = this.character.value.trim();
    const match = this.characters.find(c => c.name?.toLocaleLowerCase() === input.toLocaleLowerCase());
    const entity = match ? match.id : input;
    this.filters = { type: this.category.value, entity, kind: entity ? 'character' : '',
      fromDay: this.from.value, toDay: this.to.value };
    this.load(true);
  }
  async load(reset) {
    if (!reset && (this.loading || this.before === null)) return;
    if (reset) {
      this.generation++;
      if (this.controller) this.controller.abort();
      this.list.replaceChildren();
      this.detail.hidden = true;
      this.before = null;
      this.more.hidden = true;
    }
    const generation = this.generation;
    this.controller = new AbortController();
    this.loading = true;
    this.more.disabled = true;
    this.status.textContent = 'Opening the town archive…';
    const params = new URLSearchParams({ order: 'desc', limit: '25' });
    for (const [key, value] of Object.entries(this.filters)) if (value) params.set(key, value);
    if (!reset) params.set('before', this.before);
    try {
      const response = await fetch(`/api/history?${params}`, { signal: this.controller.signal });
      if (!response.ok) throw new Error(response.status === 400 ? 'Check the filters and day range.' : 'The archive is unavailable.');
      const page = await response.json();
      if (generation !== this.generation) return;
      for (const event of page.events) this.appendEvent(event);
      this.before = page.nextBefore;
      this.more.hidden = this.before === null;
      this.status.textContent = this.list.childElementCount ? 'Newest first · Refresh to see new events' : 'No history matches these filters.';
    } catch (err) {
      if (generation !== this.generation || err.name === 'AbortError') return;
      this.status.textContent = `${err.message || 'The archive is unavailable.'} Try Refresh.`;
    } finally {
      if (generation === this.generation) { this.loading = false; this.more.disabled = false; }
    }
  }
  label(value) { return String(value).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }
  formatValue(value, depth = 0) {
    if (value === null) return '—';
    if (typeof value !== 'object') return String(value).replace(/_/g, ' ');
    if (depth >= 3) return 'More details';
    if (Array.isArray(value)) return value.map(v => this.formatValue(v, depth + 1)).join(', ');
    return Object.entries(value).map(([k, v]) => `${this.label(k)}: ${this.formatValue(v, depth + 1)}`).join('; ');
  }
  time(t) { return `Day ${t.day} · ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`; }
  entityName(entity) {
    if (entity.kind === 'character') return this.characters.find(c => c.id === entity.id)?.name || entity.id;
    if (entity.kind === 'building') return this.buildings[entity.id]?.name || entity.id;
    return entity.id;
  }
  appendEvent(event) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `history-entry ${event.type === 'conflict' ? 'history-conflict' : 'history-social'}`;
    const marker = document.createElement('span'); marker.className = 'history-marker'; marker.textContent = event.type === 'conflict' ? '✦' : '◆';
    const content = document.createElement('span'); content.className = 'history-entry-content';
    const time = document.createElement('span'); time.className = 'history-entry-time'; time.textContent = `${this.time(event.time)} · ${this.label(event.type)}`;
    const description = document.createElement('strong'); description.textContent = event.description;
    const names = document.createElement('span'); names.className = 'history-entry-names'; names.textContent = event.entities.map(e => this.entityName(e)).join(', ');
    content.append(time, description, names); button.append(marker, content);
    button.addEventListener('click', () => this.showDetail(event));
    this.list.append(button);
  }
  showDetail(event) {
    this.detail.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = this.label(event.type);
    const time = document.createElement('p'); time.className = 'history-entry-time'; time.textContent = this.time(event.time);
    const description = document.createElement('p'); description.textContent = event.description;
    this.detail.append(heading, time, description);
    if (event.entities.length) {
      const entities = document.createElement('div'); entities.className = 'history-entities';
      for (const entity of event.entities) {
        const active = entity.kind === 'character' && this.characters.some(c => c.id === entity.id);
        const item = document.createElement(active ? 'button' : 'span');
        if (active) {
          item.type = 'button'; item.addEventListener('click', () => { this.close(); this.onCharacter(entity.id); });
        }
        item.textContent = `${this.entityName(entity)}${active ? ' ↗' : entity.kind === 'character' ? ' (not currently in town)' : ''}`;
        entities.append(item);
      }
      this.detail.append(entities);
    }
    const metadata = event.metadata || {};
    for (const [key, value] of Object.entries(metadata)) {
      const line = document.createElement('p'); line.className = 'history-context';
      line.textContent = `${this.label(key)}: ${this.formatValue(value)}`;
      this.detail.append(line);
    }
    this.detail.hidden = false;
  }
}
