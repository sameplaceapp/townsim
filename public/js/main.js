(function () {
  const TILE_SIZE = 16;
  const INITIAL_ZOOM = 2.5;

  // State
  let worldState = null;
  let characters = [];
  let currentTick = 0;
  let phase = 'morning';
  let clock = { day: 1, hour: 6, minute: 0 };
  let followTargetId = null;
  let previousActivities = {};

  // ?hour=21.5 overrides the visual time of day (for previewing lighting)
  const debugHourParam = new URLSearchParams(location.search).get('hour');
  const debugHour = debugHourParam !== null ? parseFloat(debugHourParam) : null;

  // Components
  const bgCanvas = document.getElementById('bg-canvas');
  const fgCanvas = document.getElementById('fg-canvas');
  const container = document.getElementById('canvas-container');

  const camera = new Camera(60, 40, TILE_SIZE, INITIAL_ZOOM);
  const renderer = new Renderer(bgCanvas, fgCanvas, camera, TILE_SIZE);
  const interpolator = new Interpolator(10000);
  const ui = new UI();

  function parseClock(timeString) {
    const m = /Day\s+(\d+)\s+(\d+):(\d+)/.exec(timeString || '');
    if (m) {
      clock = { day: +m[1], hour: +m[2], minute: +m[3] };
    }
  }

  // Selection handler (shared between canvas click and list click)
  function selectCharById(charId) {
    for (const char of characters) char._selected = false;
    if (charId) {
      const char = characters.find(c => c.id === charId);
      if (char) char._selected = true;
    }
    ui.selectCharacter(charId);
    ui.updateCharacterPanel(characters, currentTick);
  }

  // Wire up list click callback
  ui.onSelectCallback = selectCharById;

  // Wire up follow callback
  ui.onFollowCallback = function (charId) {
    followTargetId = charId;
    if (charId) {
      const char = characters.find(c => c.id === charId);
      if (char && char.pos) {
        camera.centerOn(char.pos.x, char.pos.y);
      }
    }
  };

  // Input
  const input = new InputHandler(container, camera, (wx, wy) => {
    // Find character near click
    let closest = null;
    let closestDist = 3;
    for (const char of characters) {
      if (char.inside) continue;
      const dx = Math.abs(char.pos.x - wx);
      const dy = Math.abs(char.pos.y - wy);
      const dist = dx + dy;
      if (dist < closestDist) {
        closestDist = dist;
        closest = char;
      }
    }

    selectCharById(closest ? closest.id : null);
  });

  // Break follow mode when user manually pans
  input.onManualPan = function () {
    if (followTargetId) {
      followTargetId = null;
      ui.followingCharId = null;
      // Re-render detail panel to update follow button state
      ui.updateCharacterPanel(characters, currentTick);
    }
  };

  // Speed buttons
  document.getElementById('btn-pause').addEventListener('click', () => {
    fetch('/api/pause', { method: 'POST' });
    setActiveButton('btn-pause');
  });
  document.getElementById('btn-1x').addEventListener('click', () => {
    fetch('/api/speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 1 })
    });
    setActiveButton('btn-1x');
  });
  document.getElementById('btn-2x').addEventListener('click', () => {
    fetch('/api/speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 2 })
    });
    setActiveButton('btn-2x');
  });
  document.getElementById('btn-5x').addEventListener('click', () => {
    fetch('/api/speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 5 })
    });
    setActiveButton('btn-5x');
  });

  function setActiveButton(id) {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  // Resize handler (high-DPI aware)
  function handleResize() {
    const rect = container.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  }
  window.addEventListener('resize', handleResize);

  // WebSocket connection
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      ui.setStatus('Connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'tick') {
        currentTick = data.tick;
        phase = data.phase;
        parseClock(data.timeString);

        // Update character positions
        if (data.characters) {
          const selectedId = ui.selectedCharId;
          for (const update of data.characters) {
            const existing = characters.find(c => c.id === update.id);
            if (existing) {
              // Track activity changes for particle spawning
              const prevActivity = previousActivities[update.id];
              if (prevActivity !== update.activity && update.activity && update.pos) {
                renderer.spawnParticles(update.activity, update.pos.x + 0.5, update.pos.y - 0.5);
              }
              previousActivities[update.id] = update.activity;

              Object.assign(existing, update);
              if (existing.id === selectedId) existing._selected = true;
            } else {
              characters.push(update);
              previousActivities[update.id] = update.activity;
            }
          }
          interpolator.onTick(characters);
        }

        // Update UI
        ui.updateTime(data.timeString, data.phase);
        if (data.log) ui.updateLog(data.log);
        ui.updateCharacterList(characters);
        ui.updateCharacterPanel(characters, currentTick);
      }
    };

    ws.onclose = () => {
      ui.setStatus('Disconnected - reconnecting...');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      ui.setStatus('Connection error');
    };
  }

  // Load initial state
  async function init() {
    try {
      const resp = await fetch('/api/state');
      worldState = await resp.json();

      // Set world data for renderer
      camera.setWorldSize(
        worldState.gridWidth || worldState.grid[0].length,
        worldState.gridHeight || worldState.grid.length
      );
      renderer.setWorldData(worldState.grid, worldState.buildings);

      // Pass buildings to UI for name lookups
      ui.setBuildings(worldState.buildings);

      // Load characters
      characters = worldState.characters || [];
      currentTick = worldState.tick || 0;
      phase = worldState.phase || 'morning';
      if (worldState.time) clock = { ...worldState.time };
      interpolator.onTick(characters);

      // Initialize activity tracking
      for (const char of characters) {
        previousActivities[char.id] = char.activity;
      }

      // Update UI
      ui.updateTime(
        worldState.tick
          ? `Day ${worldState.time.day} ${String(worldState.time.hour).padStart(2,'0')}:${String(worldState.time.minute).padStart(2,'0')}`
          : 'Day 1 06:00',
        phase
      );
      if (worldState.activityLog) ui.updateLog(worldState.activityLog);
      ui.updateCharacterList(characters);

      handleResize();
      connectWebSocket();
      requestAnimationFrame(gameLoop);

      ui.setStatus('Running');
    } catch (err) {
      ui.setStatus('Failed to load: ' + err.message);
      console.error(err);
    }
  }

  // Game loop
  function gameLoop() {
    // Process keyboard input
    input.update();

    // Camera follow mode: track followed character
    if (followTargetId) {
      const char = characters.find(c => c.id === followTargetId);
      if (char) {
        const pos = interpolator.getPosition(char.id) || char.pos;
        if (pos) {
          camera.centerOn(pos.x + 0.5, pos.y + 0.5);
        }
      }
    }

    // Update camera
    camera.update();

    // Render passes: world, characters, atmosphere (day/night + lights),
    // then labels and bubbles above the tint so they stay readable at night
    const now = Date.now();
    const timeOfDay = debugHour !== null ? debugHour : clock.hour + clock.minute / 60;
    renderer.renderWorld(now);
    renderer.renderCharacters(characters, interpolator, currentTick);
    renderer.renderAtmosphere(timeOfDay, now);
    renderer.renderLabels(characters, interpolator, currentTick);

    requestAnimationFrame(gameLoop);
  }

  // Start
  init();
})();
