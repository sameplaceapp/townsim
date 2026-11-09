const { World } = require('./world');
const { Character } = require('./character');
const { NeedsManager } = require('./needs');
const { PathFinder } = require('./pathfinding');
const { ActionManager } = require('./actions');
const { Scheduler } = require('./scheduler');
const { InteractionManager } = require('./interactions');
const { DramaEngine } = require('./dramaEngine');
const { LLMBatcher } = require('../llm/batcher');
const { StateManager } = require('../persistence/stateManager');

class SimulationEngine {
  constructor(config, wss, now = () => performance.now()) {
    this.now = now;
    this.config = config;
    this.wss = wss;
    this.paused = false;
    this.speed = 1;
    this.tickTimeout = null;
    this.lastScheduleHour = -1;
    this.running = false;
    this.lastUpdate = null;
    this.minuteProgress = 0;
    this.logicProgress = 0;
    this.movementProgress = 0;

    // Stats
    this.stats = {
      totalTicks: 0,
      llmCalls: 0,
      llmTokensIn: 0,
      llmTokensOut: 0,
      startTime: Date.now()
    };

    // Initialize world
    this.stateManager = new StateManager();
    const savedState = this.stateManager.load();
    this.world = new World(config);

    if (savedState) {
      this.restoreState(savedState);
      console.log(`Restored state at tick ${this.world.tick}`);
    }

    // Initialize subsystems
    this.pathFinder = new PathFinder(this.world);
    this.needsManager = new NeedsManager(config);
    this.actionManager = new ActionManager(this.world, this.pathFinder);
    this.scheduler = new Scheduler(config);
    this.interactions = new InteractionManager();
    this.dramaEngine = new DramaEngine(this.world);
    this.llmBatcher = new LLMBatcher(config, this.world, this.stats);

    // Wire drama engine into subsystems
    this.interactions.dramaEngine = this.dramaEngine;
    this.llmBatcher.promptBuilder.dramaEngine = this.dramaEngine;

    // Restore drama state if saved
    if (savedState && savedState.drama) {
      this.dramaEngine.fromJSON(savedState.drama);
    }

    // Social action types that update relationships
    this.socialActions = new Set([
      'chat', 'greet', 'flirt', 'argue', 'gift',
      'confess', 'comfort', 'confront', 'apologize', 'forgive', 'gossip'
    ]);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastUpdate = this.now();
    this.scheduleTick();
  }

  // All elapsed values are measured at 1x speed. Monotonic time and retained
  // fractional progress keep pauses, speed changes and delayed timers accurate.
  sync(now = this.now()) {
    if (!this.running || this.paused) return;
    let remaining = Math.max(0, now - this.lastUpdate) * this.speed;
    this.lastUpdate = now;
    const { tickInterval, movementInterval, minuteInterval } = this.config.simulation;
    while (remaining > 0.000001) {
      const step = Math.min(remaining, tickInterval - this.logicProgress,
        movementInterval - this.movementProgress, minuteInterval - this.minuteProgress);
      this.logicProgress += step;
      this.movementProgress += step;
      this.minuteProgress += step;
      remaining -= step;
      if (this.minuteProgress >= minuteInterval - 0.000001) {
        this.minuteProgress = 0;
        this.world.advanceClock(1);
      }
      if (this.movementProgress >= movementInterval - 0.000001) {
        this.movementProgress = 0;
        this.moveCharacters();
      }
      if (this.logicProgress >= tickInterval - 0.000001) {
        this.logicProgress = 0;
        this.tick();
      }
    }
  }

  scheduleTick() {
    if (!this.running || this.paused) return;
    const { tickInterval, movementInterval } = this.config.simulation;
    const delay = Math.min(tickInterval - this.logicProgress, movementInterval - this.movementProgress) / this.speed;
    this.tickTimeout = setTimeout(() => {
      this.tickTimeout = null;
      this.sync();
      this.broadcastState();
      this.scheduleTick();
    }, Math.max(1, delay));
  }

  stop() {
    this.sync();
    this.running = false;
    if (this.tickTimeout) clearTimeout(this.tickTimeout);
    this.tickTimeout = null;
  }

  setSpeed(speed) {
    this.sync();
    if (this.tickTimeout) clearTimeout(this.tickTimeout);
    this.tickTimeout = null;
    this.paused = speed === 0;
    if (speed !== 0) this.speed = speed;
    this.lastUpdate = this.now();
    this.scheduleTick();
    this.broadcastState();
  }

  togglePause() {
    this.setSpeed(this.paused ? this.speed : 0);
  }

  moveCharacters() {
    for (const char of this.world.characters) {
      if (!char.path.length) continue;
      const result = this.actionManager.executeAction(char);
      if (result === 'arrived') {
        const building = this.world.buildings[char.location];
        this.world.addLog({ char: char.id, text: `${char.name} arrives at ${building?.name || char.location}` });
      }
    }
  }

  tick() {
    this.stats.totalTicks++;
    this.world.tick++;

    // 2. Decay needs
    this.needsManager.decayAll(this.world.characters);

    // 3. Execute current actions
    for (const char of this.world.characters) {
      const result = char.path.length ? 'moving' : this.actionManager.executeAction(char);

      if (result === 'arrived') {
        const dest = char.location;
        const building = this.world.buildings[dest];
        const bName = building?.name || dest;
        this.world.addLog({
          char: char.id,
          text: `${char.name} arrives at ${bName}`
        });
      } else if (result === 'stuck_reset') {
        this.world.addLog({
          char: char.id,
          text: `${char.name} got lost and stops to look around`
        });
      } else if (result === 'completed') {
        const mem = `${char.activity}.t${this.world.tick}`;
        char.addMemory(mem);
      }
    }

    // 4. Check critical needs (auto-eat, auto-sleep)
    for (const char of this.world.characters) {
      const override = this.needsManager.checkCritical(char, this.world);
      if (override) {
        this.actionManager.assignAction(char, override);
        this.world.addLog({
          char: char.id,
          text: `${char.name} urgently needs to ${override.then || override.type}`
        });
      }
    }

    // 5. Handle schedule-driven actions
    const currentHour = this.world.time.hour;
    if (currentHour !== this.lastScheduleHour) {
      this.lastScheduleHour = currentHour;
      for (const char of this.world.characters) {
        const schedAction = this.actionManager.handleSchedule(char, currentHour);
        if (schedAction) {
          this.actionManager.assignAction(char, schedAction);
          if (schedAction.type === 'goto' && schedAction.target) {
            const building = this.world.buildings[schedAction.target];
            const bName = building?.name || schedAction.target;
            this.world.addLog({
              char: char.id,
              text: `${char.name} heads to ${bName}`
            });
          } else if (schedAction.type === 'work') {
            this.world.addLog({
              char: char.id,
              text: `${char.name} starts working`
            });
          }
        }
      }
    }

    // 5.5 Update drama engine
    this.dramaEngine.update(this.world.tick);

    // 6. Detect decision points
    const decisions = this.scheduler.evaluate(this.world.characters, this.world);

    // 7-8. LLM batch decisions (async, non-blocking)
    if (decisions.length > 0) {
      try {
        const results = this.llmBatcher.decide(decisions);
        for (const result of results) {
          if (result.action) {
            // BUG-19: Validate goto targets before assigning
            if (result.action.type === 'goto' && result.action.target) {
              const building = this.world.buildings[result.action.target];
              if (!building || !building.door) {
                // Invalid target -- fall back to wander
                result.action = { type: 'wander' };
              }
            }

            // Validate social action targets
            if (result.action.target && this.socialActions.has(result.action.type)) {
              const targetChar = this.world.characters.find(c => c.id === result.action.target);
              if (!targetChar) {
                // Try matching by name
                const byName = this.world.characters.find(c =>
                  c.name.toLowerCase() === result.action.target ||
                  c.id === result.action.target
                );
                if (byName) {
                  result.action.target = byName.id;
                } else {
                  result.action = { type: 'idle' };
                }
              }
            }

            this.actionManager.assignAction(result.character, result.action);

            if (result.action.type === 'goto' && result.action.target) {
              const building = this.world.buildings[result.action.target];
              const bName = building?.name || result.action.target;
              this.world.addLog({
                char: result.character.id,
                text: `${result.character.name} heads to ${bName}`
              });
            } else if (result.action.type === 'work') {
              this.world.addLog({
                char: result.character.id,
                text: `${result.character.name} starts working`
              });
            }

            // Log social actions
            if (this.socialActions.has(result.action.type) && result.action.target) {
              const targetChar = this.world.characters.find(c => c.id === result.action.target);
              const targetName = targetChar ? targetChar.name : result.action.target;
              const actionLabels = {
                chat: 'is chatting with', greet: 'greets', flirt: 'is flirting with',
                argue: 'argues with', gift: 'gives a gift to', confess: 'confesses feelings to',
                comfort: 'comforts', confront: 'confronts', apologize: 'apologizes to',
                forgive: 'forgives', gossip: 'is gossiping with', teach: 'is teaching',
                trade: 'trades with', spy: 'is watching', avoid: 'avoids'
              };
              const label = actionLabels[result.action.type] || result.action.type;
              this.world.addLog({
                char: result.character.id,
                text: `${result.character.name} ${label} ${targetName}`
              });
            }

            // Log interesting solo actions
            const soloLogActions = {
              dance: 'starts dancing', sing: 'starts singing', cry: 'is crying',
              laugh: 'is laughing', celebrate: 'is celebrating', stormOff: 'storms off angrily',
              craft: 'is crafting', fish: 'is fishing', garden: 'is gardening',
              explore: 'goes exploring', stargaze: 'is stargazing', perform: 'puts on a performance',
              pray: 'is praying', play: 'is playing', relax: 'is relaxing',
              eat: 'is eating', drink: 'is having a drink', think: 'is deep in thought'
            };
            if (soloLogActions[result.action.type] && !result.action.target) {
              const loc = result.character.location;
              const bldg = loc ? this.world.buildings[loc] : null;
              const where = bldg ? ` at ${bldg.name}` : '';
              this.world.addLog({
                char: result.character.id,
                text: `${result.character.name} ${soloLogActions[result.action.type]}${where}`
              });
            }

            if (result.say) {
              result.character.setSay(result.say, this.world.tick);
              this.world.addLog({
                char: result.character.id,
                text: `${result.character.name} says: "${result.say}"`
              });
            }
            if (result.think) {
              result.character.setThink(result.think, this.world.tick);
            }

            // Set mood from EMO field
            if (result.emotion) {
              result.character.setMood(result.emotion, this.world.tick);
            }

            result.character.lastDecisionTick = this.world.tick;
            result.character.pendingDecision = false;

            // 9. Update relationships for social actions
            if (this.socialActions.has(result.action.type) && result.action.target) {
              const targetChar = this.world.characters.find(c => c.id === result.action.target);
              if (targetChar) {
                this.interactions.updateRelationship(result.character, targetChar, result.action.type);
                result.character.addMemory(`${result.action.type}.${result.action.target}.t${this.world.tick}`);
              }
            }
          }
        }
      } catch (err) {
        console.error('LLM batch error:', err.message);
        // Fallback: assign idle to all
        for (const d of decisions) {
          d.character.activity = 'idle';
          d.character.activityData = { ticksRemaining: 2 };
        }
      }
    }

    // 10. Auto-save
    if (this.world.tick % this.config.simulation.autoSaveInterval === 0) {
      this.save();
    }


  }

  broadcastState() {
    if (!this.wss) return;
    const state = {
      type: 'tick',
      timing: this.getTiming(),
      tick: this.world.tick,
      time: { ...this.world.time },
      phase: this.world.phase,
      timeString: this.world.getTimeString(),
      characters: this.world.characters.map(c => c.toSummary()),
      log: this.world.activityLog.slice(-100),
      drama: {
        townMood: this.dramaEngine.townMood,
        activeStorylines: this.dramaEngine.activeStorylines.map(s => ({
          id: s.id,
          type: s.type,
          phase: s.phase,
          tension: s.tension,
          participants: s.participants
        }))
      }
    };
    this.wss.broadcast(state);
  }

  getTiming() {
    return { minuteProgress: this.minuteProgress, minuteInterval: this.config.simulation.minuteInterval,
      movementInterval: this.config.simulation.movementInterval, speed: this.speed, paused: this.paused || !this.running };
  }

  getState() {
    this.sync();
    return { ...this.world.toJSON(), timing: this.getTiming() };
  }

  getStats() {
    this.sync();
    return {
      ...this.stats,
      aiBudget: this.llmBatcher.status(),
      uptime: Date.now() - this.stats.startTime,
      paused: this.paused,
      speed: this.speed,
      tick: this.world.tick,
      time: this.world.getTimeString(),
      drama: {
        townMood: this.dramaEngine.townMood,
        activeStorylines: this.dramaEngine.activeStorylines.length,
        resolvedStorylines: this.dramaEngine.resolvedStorylines.length
      }
    };
  }

  createSnapshot() {
    const worldData = this.world.toJSON();
    worldData.version = 1;
    worldData.activityLog = this.world.activityLog;
    worldData.lastScheduleHour = this.lastScheduleHour;
    worldData.timingProgress = { minute: this.minuteProgress, logic: this.logicProgress, movement: this.movementProgress };
    worldData.characters = this.world.characters.map(c => ({ ...c, path: [...c.path] }));
    worldData.drama = this.dramaEngine.toJSON();
    return worldData;
  }

  save() {
    this.stateManager.saveRaw(this.createSnapshot());
  }

  restoreState(saved) {
    this.world.tick = saved.tick;
    const progress = saved.timingProgress || {};
    this.minuteProgress = Math.max(0, Math.min(Number(progress.minute) || 0, this.config.simulation.minuteInterval - 0.001));
    this.logicProgress = Math.max(0, Math.min(Number(progress.logic) || 0, this.config.simulation.tickInterval - 0.001));
    this.movementProgress = Math.max(0, Math.min(Number(progress.movement) || 0, this.config.simulation.movementInterval - 0.001));
    this.lastScheduleHour = saved.lastScheduleHour ?? -1;
    if (saved.time) this.world.time = saved.time;
    if (saved.phase) this.world.phase = saved.phase;
    if (saved.grid && saved.gridWidth && saved.gridHeight) {
      this.world.grid = saved.grid;
      this.world.gridWidth = saved.gridWidth;
      this.world.gridHeight = saved.gridHeight;
    }
    if (saved.buildings) this.world.buildings = saved.buildings;
    if (saved.characters) {
      this.world.characters = saved.characters.map(data => {
        const original = this.world.characters.find(c => c.id === data.id);
        const character = original || new Character({ ...data, personality: data.personality || [] }, data.pos || { x: 0, y: 0 });
        Object.assign(character, data);
        character.path = Array.isArray(data.path) ? data.path : [];
        character.pendingDecision = false;
        return character;
      });
    }
    if (saved.activityLog) this.world.activityLog = saved.activityLog;
  }
}

module.exports = { SimulationEngine };
