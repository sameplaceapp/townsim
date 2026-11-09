class UI {
  constructor() {
    this.selectedCharId = null;
    this.followingCharId = null;
    this.activeFilter = 'all';

    // Elements
    this.dayDisplayEl = document.getElementById('day-display');
    this.timeDisplayEl = document.getElementById('time-display');
    this.phaseDisplayEl = document.getElementById('phase-display');
    this.phaseDotEl = document.getElementById('phase-dot');
    this.connectionDotEl = document.getElementById('connection-dot');
    this.connectionStatusEl = document.getElementById('connection-status');
    this.simulationStatusEl = document.getElementById('simulation-status');
    this.connected = false;
    this.charRosterEl = document.getElementById('char-roster');
    this.charDetailEl = document.getElementById('char-detail');
    this.charCountEl = document.getElementById('char-count');
    this.eventListEl = document.getElementById('event-list');

    this.buildings = {};
    this.onSelectCallback = null;
    this.onFollowCallback = null;
    this.notifications = new NotificationManager();
    this._lastLogEntries = null;

    this.setupPanelCollapse();
    this.setupEventFilters();
    this.setupKeyboardShortcuts();
  }

  setBuildings(buildings) {
    this.buildings = buildings || {};
  }

  // BUG-16/17/18: Escape HTML to prevent XSS from LLM output
  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- Time display ----

  updateTime(timeString, phase) {
    if (!this.connected) return;
    // Parse the timeString (e.g. "Day 3 14:30")
    const match = timeString.match(/Day\s+(\d+)\s+(\d{2}:\d{2})/);
    if (match) {
      this.dayDisplayEl.textContent = `Day ${match[1]}`;
      this.timeDisplayEl.textContent = match[2];
    } else {
      this.timeDisplayEl.textContent = timeString;
    }

    const phaseNames = {
      dawn: '🌅 Dawn',
      morning: '☀️ Morning',
      afternoon: '🌤️ Afternoon',
      evening: '🌇 Evening',
      night: '🌙 Night'
    };
    this.phaseDisplayEl.textContent = phaseNames[phase] || phase;

    const phaseColors = {
      dawn: '#e0a060',
      morning: '#d4a060',
      afternoon: '#d4a060',
      evening: '#c07040',
      night: '#8888b0'
    };
    this.phaseDotEl.style.background = phaseColors[phase] || '#d4a060';
  }

  setStatus(text) {
    this.connected = text === 'Connected';
    if (this.connected) {
      this.connectionDotEl.className = 'connection-dot connected';
      this.connectionDotEl.title = 'Connected';
      this.connectionStatusEl.textContent = 'Connected';
    } else {
      this.connectionDotEl.className = 'connection-dot disconnected';
      this.connectionDotEl.title = text;
      this.connectionStatusEl.textContent = text === 'Connecting' ? 'Connecting' : 'Disconnected';
      this.dayDisplayEl.textContent = 'Day —';
      this.timeDisplayEl.textContent = '--:--';
      this.phaseDisplayEl.textContent = '';
      this.phaseDotEl.style.background = 'transparent';
      this.simulationStatusEl.textContent = '—';
      this.charCountEl.textContent = '—';
    }
  }

  updateSimulationStatus(timing, population) {
    if (!this.connected) return;
    this.simulationStatusEl.textContent = timing.paused ? `Paused · ${timing.speed}×` : `Running ${timing.speed}×`;
    this.charCountEl.textContent = String(population);
  }

  // ---- Character selection ----

  selectCharacter(charId) {
    this.selectedCharId = charId;
    // Update roster highlight
    if (this.charRosterEl) {
      this.charRosterEl.querySelectorAll('.char-roster-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.charId === charId);
      });
    }
  }

  // ---- Activity helpers ----

  getActivityEmoji(activity) {
    const map = {
      sleep: '\uD83D\uDCA4', eat: '\uD83C\uDF7D\uFE0F', work: '\u2692\uFE0F',
      chat: '\uD83D\uDCAC', drink: '\uD83C\uDF7A', pray: '\uD83D\uDE4F',
      play: '\u26BD', shop: '\uD83D\uDED2', think: '\uD83D\uDCAD',
      greet: '\uD83D\uDC4B', flirt: '\u2764\uFE0F', argue: '\uD83D\uDCA2',
      gift: '\uD83C\uDF81', relax: '\uD83D\uDE0C', wander: '\uD83D\uDC63',
      goto: '\uD83D\uDEB6', idle: '\u23F8\uFE0F',
      confess: '\uD83D\uDC8C', comfort: '\uD83E\uDD17', confront: '\uD83D\uDE24',
      apologize: '\uD83D\uDE4F', forgive: '\uD83E\uDD1D', gossip: '\uD83E\uDD2B',
      cry: '\uD83D\uDE22', laugh: '\uD83D\uDE02', dance: '\uD83D\uDC83',
      sing: '\uD83C\uDFA4', celebrate: '\uD83C\uDF89', stormOff: '\uD83D\uDEAA',
      craft: '\uD83D\uDD28', fish: '\uD83C\uDFA3', garden: '\uD83C\uDF31',
      explore: '\uD83E\uDDED', stargaze: '\u2B50', perform: '\uD83C\uDFAD'
    };
    return map[activity] || '';
  }

  getActivityText(char, characters) {
    const activity = char.activity;
    if (!activity || activity === 'idle') return 'Idle';
    const data = char.activityData || {};

    if (activity === 'goto') {
      const dest = data.destination;
      if (dest && this.buildings[dest]) return 'Going to ' + this.buildings[dest].name;
      return 'Walking';
    }
    if (activity === 'wander') return 'Wandering';

    const simpleLabels = {
      eat: 'Eating', sleep: 'Sleeping', work: 'Working', drink: 'Drinking',
      pray: 'Praying', relax: 'Relaxing', shop: 'Shopping', play: 'Playing',
      think: 'Thinking', cry: 'Crying', laugh: 'Laughing', dance: 'Dancing',
      sing: 'Singing', celebrate: 'Celebrating', craft: 'Crafting',
      fish: 'Fishing', garden: 'Gardening', explore: 'Exploring',
      stargaze: 'Stargazing', perform: 'Performing', scheme: 'Scheming',
      stormOff: 'Storming off'
    };
    if (simpleLabels[activity]) return simpleLabels[activity];

    const socialLabels = {
      chat: 'Chatting with', greet: 'Greeting', flirt: 'Flirting with',
      argue: 'Arguing with', gift: 'Gift to', confess: 'Confessing to',
      comfort: 'Comforting', confront: 'Confronting', apologize: 'Apologizing to',
      forgive: 'Forgiving', gossip: 'Gossiping with', teach: 'Teaching',
      trade: 'Trading with', spy: 'Watching', avoid: 'Avoiding'
    };
    if (socialLabels[activity]) {
      if (data.target) {
        const t = characters ? characters.find(c => c.id === data.target) : null;
        return socialLabels[activity] + ' ' + (t ? t.name : data.target);
      }
      return socialLabels[activity].replace(' with', '').replace(' to', '');
    }

    return activity.replace(/_/g, ' ');
  }

  // ---- Character Roster (list mode) ----

  updateCharacterList(characters) {
    if (!this.charRosterEl || !characters || characters.length === 0) return;

    this.charCountEl.textContent = characters.length;

    // If detail is visible, show avatar strip instead
    if (this.selectedCharId && this.charDetailEl.style.display !== 'none') {
      this.renderAvatarStrip(characters);
      return;
    }

    // BUG-11: Only rebuild DOM when roster data actually changed
    const rosterKey = characters.map(c =>
      `${c.id}:${c.activity}:${c.inside ? 1 : 0}:${c.id === this.selectedCharId ? 1 : 0}`
    ).join('|');
    if (this._lastRosterKey === rosterKey) return;
    this._lastRosterKey = rosterKey;

    const items = characters.map(char => {
      const emoji = this.getActivityEmoji(char.activity);
      const actText = this.getActivityText(char, characters);
      const sel = char.id === this.selectedCharId ? ' selected' : '';
      const insideTag = char.inside ? '<span class="char-inside-badge">IN</span>' : '';
      const isDramatic = ['flirt', 'argue', 'confess', 'confront', 'cry', 'stormOff'].includes(char.activity);
      const dramaIndicator = isDramatic ? '<span class="char-drama-indicator">!</span>' : '';

      const safeName = this.escapeHtml(char.name);
      const safeActText = this.escapeHtml(actText);
      return `<div class="char-roster-item${sel}" data-char-id="${this.escapeHtml(char.id)}">
        <span class="char-avatar-circle" style="background:${char.color || '#aaa'}">${safeName[0]}</span>
        <span class="char-roster-name">${safeName}</span>
        ${insideTag}
        ${dramaIndicator}
        <span class="char-roster-activity">${emoji} ${safeActText}</span>
      </div>`;
    }).join('');

    this.charRosterEl.innerHTML = items;

    this.charRosterEl.querySelectorAll('.char-roster-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.charId;
        this.selectCharacter(id);
        if (this.onSelectCallback) this.onSelectCallback(id);
      });
    });
  }

  renderAvatarStrip(characters) {
    const strip = characters.map(char => {
      const sel = char.id === this.selectedCharId ? ' selected' : '';
      const safeName = this.escapeHtml(char.name);
      return `<span class="char-avatar-circle${sel}" data-char-id="${this.escapeHtml(char.id)}" style="background:${char.color || '#aaa'}" title="${safeName}">${safeName[0]}</span>`;
    }).join('');

    this.charRosterEl.innerHTML = `<div class="char-avatar-strip">${strip}</div>`;

    this.charRosterEl.querySelectorAll('.char-avatar-circle').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.charId;
        this.selectCharacter(id);
        if (this.onSelectCallback) this.onSelectCallback(id);
      });
    });
  }

  // ---- Character Detail Card ----

  updateCharacterPanel(characters, currentTick) {
    if (!this.selectedCharId) {
      this.charDetailEl.style.display = 'none';
      return;
    }

    const char = characters.find(c => c.id === this.selectedCharId);
    if (!char) {
      this.charDetailEl.style.display = 'none';
      return;
    }

    this.charDetailEl.style.display = 'block';

    const needs = char.needs || {};
    const needBars = ['hunger', 'energy', 'social', 'fun', 'hygiene'].map(need => {
      const val = needs[need] || 0;
      const pct = (val / 10) * 100;
      const cls = val > 7 ? 'critical' : val > 4 ? 'moderate' : 'good';
      return `
        <div class="need-bar">
          <span class="need-label">${need}</span>
          <div class="need-track">
            <div class="need-fill ${cls}" style="width:${pct}%"></div>
          </div>
          <span class="need-value">${val.toFixed(1)}</span>
        </div>`;
    }).join('');

    const activityEmoji = this.getActivityEmoji(char.activity);
    const activityText = this.getActivityText(char, characters);

    let destHtml = '';
    if (char.activityData && char.activityData.destination) {
      const b = this.buildings[char.activityData.destination];
      if (b) destHtml = `<div class="char-destination">Heading to: <strong>${b.name}</strong></div>`;
    }

    let locationHtml = '';
    if (char.inside && char.location) {
      const b = this.buildings[char.location];
      locationHtml = `<div class="char-location">Inside: <strong>${b ? b.name : char.location}</strong></div>`;
    }

    let traitsHtml = '';
    if (char.personality && char.personality.length > 0) {
      traitsHtml = `<div class="char-detail-traits">${char.personality.map(t =>
        `<span class="trait-pill">${t}</span>`
      ).join('')}</div>`;
    }

    let speechHtml = '';
    if (char.say && currentTick - char.sayTick < 20) {
      speechHtml = `<div class="char-speech-bubble">"${this.escapeHtml(char.say)}"</div>`;
    }

    let thoughtHtml = '';
    if (char.think && currentTick - char.thinkTick < 15) {
      thoughtHtml = `<div class="char-thought-bubble">\uD83D\uDCAD ${this.escapeHtml(char.think)}</div>`;
    }

    let relsHtml = '';
    if (char.relationships && Object.keys(char.relationships).length > 0) {
      const entries = Object.entries(char.relationships)
        .sort((a, b) => b[1].level - a[1].level)
        .slice(0, 8)
        .map(([id, rel]) => {
          const tag = rel.tag.replace(/_/g, ' ');
          const level = rel.level;
          const cls = level > 6 ? 'high' : level > 3 ? 'mid' : 'low';
          const pct = (level / 10) * 100;
          const targetChar = characters.find(c => c.id === id);
          const name = targetChar ? targetChar.name : id;
          return `<div class="rel-row">
            <span class="rel-name">${this.escapeHtml(name)}</span>
            <span class="rel-tag">${this.escapeHtml(tag)}</span>
            <span class="rel-level ${cls}">${level.toFixed(1)}</span>
            <div class="rel-bar"><div class="rel-bar-fill" style="width:${pct}%;background:${cls === 'high' ? 'var(--accent-success)' : cls === 'mid' ? 'var(--accent-warning)' : 'var(--accent-danger)'}"></div></div>
          </div>`;
        }).join('');
      relsHtml = `<div class="char-section"><div class="char-section-title">Bonds</div>${entries}</div>`;
    }

    const isFollowing = this.followingCharId === char.id;

    this.charDetailEl.innerHTML = `
      <div class="char-detail-nav">
        <button class="back-btn" id="detail-back">&larr; All</button>
        <button class="follow-btn${isFollowing ? ' active' : ''}" id="detail-follow">${isFollowing ? 'Unfollow' : 'Follow'}</button>
      </div>
      <div class="char-detail-header">
        <div class="char-detail-avatar" style="background:${char.color}">${this.escapeHtml(char.name[0])}</div>
        <div class="char-detail-info">
          <div class="char-detail-name">${this.escapeHtml(char.name)}</div>
          <div class="char-detail-job">${this.escapeHtml(char.job)}</div>
          ${traitsHtml}
        </div>
      </div>
      <div class="char-section">
        <div class="char-section-title">Needs</div>
        ${needBars}
      </div>
      <div class="char-section">
        <div class="char-section-title">Now</div>
        <div class="char-activity-display">${activityEmoji} ${activityText}</div>
        ${destHtml}
        ${locationHtml}
        ${speechHtml}
        ${thoughtHtml}
      </div>
      ${relsHtml}
    `;

    // Wire back button
    document.getElementById('detail-back').addEventListener('click', () => {
      this.selectedCharId = null;
      this.charDetailEl.style.display = 'none';
      this.updateCharacterList(characters);
      if (this.onSelectCallback) this.onSelectCallback(null);
    });

    // Wire follow button
    document.getElementById('detail-follow').addEventListener('click', () => {
      if (this.followingCharId === char.id) {
        this.followingCharId = null;
      } else {
        this.followingCharId = char.id;
      }
      if (this.onFollowCallback) this.onFollowCallback(this.followingCharId);
      this.updateCharacterPanel(characters, currentTick);
    });
  }

  // ---- Event Feed (replaces activity log) ----

  updateLog(entries) {
    if (!entries || entries.length === 0) return;
    this._lastLogEntries = entries;

    // Generate toast notifications for dramatic events
    const latestEntry = entries[entries.length - 1];
    if (latestEntry) {
      const { category, toast } = this.notifications.classifyEvent(latestEntry.text || '');
      if (toast) {
        this.notifications.showToast(latestEntry.text, category, latestEntry.time);
      }
    }

    this.renderEventFeed(entries);
  }

  renderEventFeed(entries) {
    const classified = entries.slice().reverse().map(entry => {
      const text = entry.text || '';
      const { category, icon } = this.notifications.classifyEvent(text);
      return { ...entry, category, icon };
    });

    // Render event feed with active filter
    this.eventListEl.innerHTML = classified
      .filter(entry => {
        if (this.activeFilter === 'all') return true;
        if (this.activeFilter === 'drama') return ['conflict', 'romance'].includes(entry.category);
        if (this.activeFilter === 'social') return ['social'].includes(entry.category);
        if (this.activeFilter === 'speech') return ['speech'].includes(entry.category);
        return true;
      })
      .map(entry => {
        let safeText = this.escapeHtml(entry.text || '');
        const nameMatch = safeText.match(/^(\w+)\s/);
        if (nameMatch) {
          const charName = nameMatch[1];
          safeText = `<span class="char-name-link" data-name="${this.escapeHtml(charName)}">${this.escapeHtml(charName)}</span>` + safeText.slice(charName.length);
        }

        return `
          <div class="event-card ${entry.category}" data-text="${this.escapeHtml(entry.text || '')}">
            <span class="event-time">${this.escapeHtml(entry.time || '')}</span>
            <span class="event-icon">${entry.icon}</span>
            <div class="event-body">
              <div class="event-text">${safeText}</div>
            </div>
          </div>`;
      }).join('');

    // Wire click handlers on character name links
    this.eventListEl.querySelectorAll('.char-name-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = el.dataset.name;
        if (name && this.onSelectCallback) {
          this.onSelectCallback(name.toLowerCase());
        }
      });
    });
  }

  // ---- Panel Collapse ----

  setupPanelCollapse() {
    const charHandle = document.getElementById('char-tray-handle');
    const charTray = document.getElementById('character-tray');
    if (charHandle && charTray) {
      charHandle.addEventListener('click', () => {
        charTray.classList.toggle('collapsed');
      });
    }

    const eventHandle = document.getElementById('event-feed-handle');
    const eventFeed = document.getElementById('event-feed');
    if (eventHandle && eventFeed) {
      eventHandle.addEventListener('click', () => {
        eventFeed.classList.toggle('collapsed');
      });
    }
  }

  // ---- Event Filters ----

  setupEventFilters() {
    const filterBtns = document.querySelectorAll('.event-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter;
        // Re-render immediately with stored entries
        if (this._lastLogEntries) {
          this.renderEventFeed(this._lastLogEntries);
        }
      });
    });
  }

  // ---- Keyboard Shortcuts ----

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't capture if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          document.getElementById('btn-pause').click();
          break;
        case '1':
          document.getElementById('btn-1x').click();
          break;
        case '2':
          document.getElementById('btn-2x').click();
          break;
        case '3':
          document.getElementById('btn-5x').click();
          break;
        case 'c':
        case 'C':
          document.getElementById('character-tray').classList.toggle('collapsed');
          break;
        case 'e':
        case 'E':
          document.getElementById('event-feed').classList.toggle('collapsed');
          break;
        case 'f':
        case 'F':
          if (this.selectedCharId) {
            if (this.followingCharId === this.selectedCharId) {
              this.followingCharId = null;
            } else {
              this.followingCharId = this.selectedCharId;
            }
            if (this.onFollowCallback) this.onFollowCallback(this.followingCharId);
          }
          break;
        case 'Escape':
          if (this.selectedCharId) {
            this.selectedCharId = null;
            this.charDetailEl.style.display = 'none';
            if (this.onSelectCallback) this.onSelectCallback(null);
          }
          break;
      }
    });
  }
}
