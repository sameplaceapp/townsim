(function () {
  const TILE_SIZE = 16;
  const SCALE = 2;

  // State
  let worldState = null;
  let characters = [];
  let currentTick = 0;
  let phase = 'morning';
  let followTargetId = null;
  let previousActivities = {};

  // Components
  const bgCanvas = document.getElementById('bg-canvas');
  const fgCanvas = document.getElementById('fg-canvas');
  const container = document.getElementById('canvas-container');

  const camera = new Camera(60, 40, TILE_SIZE, SCALE);
  const renderer = new Renderer(bgCanvas, fgCanvas, camera, TILE_SIZE, SCALE);
  const interpolator = new Interpolator(10000);
  const ui = new UI();

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

  // Resize handler
  function handleResize() {
    const rect = container.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
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
      renderer.setWorldData(
        worldState.grid,
        worldState.buildings,
        {
          "0": { color: "#4a8c3f" }, "1": { color: "#c4a862" },
          "2": { color: "#3b7dd8" }, "3": { color: "#7c6850" },
          "4": { color: "#b89a6a" }, "5": { color: "#8b5e3c" },
          "6": { color: "#2d6b2e" }, "7": { color: "#9c7c4c" },
          "8": { color: "#a0522d" }, "9": { color: "#d4a0d4" },
          "10": { color: "#e8d5a3" }, "11": { color: "#6db33f" },
          "12": { color: "#8b7355" }
        }
      );

      // Pass buildings to UI for name lookups
      ui.setBuildings(worldState.buildings);

      // Load characters
      characters = worldState.characters || [];
      currentTick = worldState.tick || 0;
      phase = worldState.phase || 'morning';
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
  let lastCameraX = -1, lastCameraY = -1;

  function gameLoop() {
    // Process keyboard input
    input.update();

    // Camera follow mode: track followed character
    if (followTargetId) {
      const char = characters.find(c => c.id === followTargetId);
      if (char) {
        const pos = interpolator.getPosition(char.id) || char.pos;
        if (pos) {
          camera.centerOn(pos.x, pos.y);
        }
      }
    }

    // Update camera
    camera.update();

    // Redraw background if camera moved
    if (Math.abs(camera.x - lastCameraX) > 0.5 || Math.abs(camera.y - lastCameraY) > 0.5) {
      renderer.markDirty();
      lastCameraX = camera.x;
      lastCameraY = camera.y;
    }

    // Render
    renderer.renderBackground();
    renderer.renderCharacters(characters, interpolator, currentTick);
    renderer.renderDayNightOverlay(phase);

    requestAnimationFrame(gameLoop);
  }

  // Start
  init();
})();
