const { World } = require('./world');
const { NeedsManager } = require('./needs');
const { PathFinder } = require('./pathfinding');
const { ActionManager } = require('./actions');
const { Scheduler } = require('./scheduler');
const { InteractionManager } = require('./interactions');
const { DramaEngine } = require('./dramaEngine');
const { LLMBatcher } = require('../llm/batcher');
const { StateManager } = require('../persistence/stateManager');

class SimulationEngine {
  constructor(config, wss) {
    this.config = config;
    this.wss = wss;
    this.paused = false;
    this.speed = 1;
    this.tickTimeout = null;
    this.tickInProgress = false;
    this.lastScheduleHour = -1;

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
    if (this.tickTimeout) return;
    console.log(`Simulation started (speed: ${this.speed}x)`);
    this.scheduleTick();
  }

  scheduleTick() {
    const interval = this.config.simulation.tickInterval / this.speed;
    this.tickTimeout = setTimeout(() => this.runTick(), interval);
  }

  async runTick() {
    this.tickTimeout = null;
    if (this.tickInProgress) return; // BUG-01: prevent overlapping ticks
    this.tickInProgress = true;
    try {
      await this.tick();
    } finally {
      this.tickInProgress = false;
      if (!this.paused) {
        this.scheduleTick();
      }
    }
  }

  stop() {
    if (this.tickTimeout) {
      clearTimeout(this.tickTimeout);
      this.tickTimeout = null;
    }
  }

  setSpeed(speed) {
    if (speed === 0) {
      this.paused = true;
      this.stop(); // BUG-20: stop the timeout on pause
      return;
    }
    this.paused = false;
    this.speed = speed;
    this.stop();
    this.start();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.stop(); // NEW-01: clear pending timeout on pause
    } else if (!this.tickInProgress && !this.tickTimeout) {
      this.start(); // Only reschedule if no tick is in-flight or pending
    }
  }

  async tick() {
    this.stats.totalTicks++;

    // 1. Advance clock
    this.world.advanceClock(this.config.simulation.timePerTick);

    // 2. Decay needs
    this.needsManager.decayAll(this.world.characters);

    // 3. Execute current actions
    for (const char of this.world.characters) {
      const result = this.actionManager.executeAction(char);

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
        const results = await this.llmBatcher.processBatch(decisions);
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

    // 11. Push state via WebSocket
    this.broadcastState();
  }

  broadcastState() {
    if (!this.wss) return;
    const state = {
      type: 'tick',
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

  getState() {
    return this.world.toJSON();
  }

  getStats() {
    return {
      ...this.stats,
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

  save() {
    // Save drama state alongside world state
    const worldData = this.world.toJSON();
    worldData.drama = this.dramaEngine.toJSON();
    this.stateManager.saveRaw(worldData);
  }

  restoreState(saved) {
    if (saved.tick) this.world.tick = saved.tick;
    if (saved.time) this.world.time = saved.time;
    if (saved.phase) this.world.phase = saved.phase;
    if (saved.characters) {
      for (const savedChar of saved.characters) {
        const char = this.world.characters.find(c => c.id === savedChar.id);
        if (char) {
          if (savedChar.pos) char.pos = savedChar.pos;
          if (savedChar.needs) char.needs = savedChar.needs;
          if (savedChar.relationships) char.relationships = savedChar.relationships;
          if (savedChar.activity) char.activity = savedChar.activity;
          if (savedChar.activityData) char.activityData = savedChar.activityData;
          if (savedChar.recentMemory) char.recentMemory = savedChar.recentMemory;
          if (savedChar.mood) char.mood = savedChar.mood;
          if (savedChar.moodHistory) char.moodHistory = savedChar.moodHistory;
          // BUG-03: restore inside/location state
          if (savedChar.inside !== undefined) char.inside = savedChar.inside;
          if (savedChar.location !== undefined) char.location = savedChar.location;
          // Clear path/walking on restore (paths can't be serialized reliably)
          char.path = [];
          char.walking = false;
        }
      }
    }
    if (saved.activityLog) this.world.activityLog = saved.activityLog;
  }
}

module.exports = { SimulationEngine };
