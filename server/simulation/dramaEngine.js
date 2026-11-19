/**
 * Drama Engine - generates storylines, manages tension, and injects
 * dramatic context into LLM prompts for richer character behavior.
 */

const DRAMA_RULES = {
  maxActiveStorylines: 3,
  minTimeBetweenClimax: 72,     // 12 game-hours between climactic events
  cooldownAfterResolution: 144,  // 1 game-day cooldown
  tensionDecayRate: 0.005,
  tensionBoostOnEvent: 0.15,
  climaxThreshold: 0.85,
  boredThreshold: 0.3,
  maxTensionPerCharacter: 2,
  seedCheckInterval: 36          // Check for new drama seeds every 6 game-hours
};

const STORYLINE_TYPES = {
  love_triangle: {
    minParticipants: 3,
    roles: ['pursuer', 'target', 'rival'],
    tensionEvents: ['flirt', 'confess', 'jealous_outburst', 'confrontation'],
    climaxActions: ['confess', 'confront', 'stormOff']
  },
  rivalry: {
    minParticipants: 2,
    roles: ['rival_a', 'rival_b'],
    tensionEvents: ['argue', 'confront', 'gossip', 'one_up'],
    climaxActions: ['confront', 'argue', 'stormOff']
  },
  secret_keeper: {
    minParticipants: 2,
    roles: ['keeper', 'subject'],
    tensionEvents: ['gossip', 'witness', 'almost_exposed'],
    climaxActions: ['confess', 'confront', 'gossip']
  },
  grudge_match: {
    minParticipants: 2,
    roles: ['aggrieved', 'offender'],
    tensionEvents: ['argue', 'avoid', 'gossip', 'confrontation'],
    climaxActions: ['confront', 'forgive', 'stormOff']
  },
  forbidden_friendship: {
    minParticipants: 2,
    roles: ['friend_a', 'friend_b'],
    tensionEvents: ['secret_meeting', 'gossip', 'loyalty_test'],
    climaxActions: ['confront', 'confess', 'apologize']
  }
};

class DramaEngine {
  constructor(world) {
    this.world = world;
    this.activeStorylines = [];
    this.resolvedStorylines = [];
    this.characterDrama = {};   // Per-character drama state
    this.gossipNetwork = {};    // Who knows what
    this.townMood = 0.5;        // 0=dramatic, 1=peaceful
    this.lastSeedCheck = 0;
    this.lastClimaxTick = 0;
    this.storylineCounter = 0;
    const settings = world.config?.drama || {};
    const bounded = (value, fallback, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
    this.pacing = {
      eventChance: bounded(settings.eventChance, 0.12, 1),
      conflictFrequency: bounded(settings.conflictFrequency, 0.4, 1),
      romanceFrequency: bounded(settings.romanceFrequency, 0.5, 1),
      cooldownHours: bounded(settings.cooldownHours, 18, 720)
    };
    // Absolute simulated minutes, not wall-clock time or speed-dependent timers.
    this.lastMajorByCharacter = Object.create(null);
  }

  simulationMinute() {
    const { day, hour, minute } = this.world.time;
    return (day - 1) * 1440 + hour * 60 + minute;
  }

  canInteract(a, b) {
    if (!a || !b || a.id === b.id || b.activity === 'sleep') return false;
    if (a.inside || b.inside) return a.inside && b.inside && a.location === b.location;
    return Math.abs(a.pos.x - b.pos.x) <= 2 && Math.abs(a.pos.y - b.pos.y) <= 2;
  }

  isReady(ids, now, continuation = []) {
    return ids.every(id => {
      const last = this.lastMajorByCharacter[id];
      return last === undefined || (continuation.includes(id) && last === now) || now - last >= this.pacing.cooldownHours * 60;
    });
  }

  chance(category, character) {
    const traits = character?.personality || [];
    let factor = 1;
    if (category === 'romance' && traits.includes('flirtatious')) factor *= 1.5;
    if (category === 'conflict' && traits.includes('grumpy')) factor *= 1.5;
    if (traits.includes('cautious')) factor *= 0.6;
    const categoryFrequency = category === 'romance' ? this.pacing.romanceFrequency : this.pacing.conflictFrequency;
    return Math.random() < Math.min(1, this.pacing.eventChance * categoryFrequency * factor);
  }

  allowAction(actor, target, action) {
    const category = ['flirt', 'confess'].includes(action) ? 'romance' :
      ['argue', 'confront', 'stormOff'].includes(action) ? 'conflict' : null;
    if (!category) return true;
    const now = this.simulationMinute();
    const participants = target ? [actor.id, target.id] : [actor.id];
    if (!this.isReady(participants, now)) return false;
    const rel = target && actor.relationships[target.id];
    if (action === 'stormOff') {
      if (!['angry', 'bitter', 'sad'].includes(actor.mood)) return false;
    } else {
      if (!this.canInteract(actor, target) || !rel) return false;
      if (category === 'conflict' && !(rel.affection < 4.5 || rel.trust < 3.5)) return false;
      if (action === 'flirt' && !(rel.attraction >= 3 ||
          ((actor.personality || []).includes('flirtatious') && rel.affection >= 5))) return false;
      if (action === 'confess' && !(rel.attraction >= 5 && rel.affection >= 5 && (rel.interactionCount || 0) >= 3)) return false;
    }
    if (!this.chance(category, actor)) return false;
    for (const id of participants) this.lastMajorByCharacter[id] = now;
    return true;
  }

  // Called every tick from engine.js
  update(tick) {
    // Decay tension on storylines without recent events
    for (const story of this.activeStorylines) {
      const ticksSinceEvent = tick - story.lastEventTick;
      if (ticksSinceEvent > 12) {
        story.tension = Math.max(0, story.tension - DRAMA_RULES.tensionDecayRate);
      }

      // Phase progression
      this.updateStorylinePhase(story, tick);
    }

    // Clean up resolved storylines
    this.activeStorylines = this.activeStorylines.filter(s => {
      if (s.phase === 'aftermath' && tick - s.lastEventTick > DRAMA_RULES.cooldownAfterResolution) {
        this.resolvedStorylines.push(s);
        return false;
      }
      return true;
    });

    // Update town mood based on active storyline tensions
    this.updateTownMood();

    // Decay character emotions
    this.decayEmotions(tick);

    // Seed new drama if town is too peaceful
    if (tick - this.lastSeedCheck >= DRAMA_RULES.seedCheckInterval) {
      this.lastSeedCheck = tick;
      if (this.townMood > 0.7 && this.activeStorylines.length < DRAMA_RULES.maxActiveStorylines) {
        this.seedDrama(tick);
      }
    }
  }

  updateStorylinePhase(story, tick) {
    const tension = story.tension;
    const age = tick - story.startTick;
    // Older saves have no startMinute; reconstruct elapsed simulated time
    // from the original tick cadence without changing their saved format.
    const sim = this.world.config?.simulation;
    const minutesPerTick = sim?.tickInterval && sim?.minuteInterval ? sim.tickInterval / sim.minuteInterval : 10;
    const ageMinutes = Number.isFinite(story.startMinute)
      ? this.simulationMinute() - story.startMinute : age * minutesPerTick;

    switch (story.phase) {
      case 'setup':
        if (age > 36 || tension > 0.3) { // After 6 hours or some tension
          story.phase = 'tension_building';
        }
        break;
      case 'tension_building':
        if (tension >= DRAMA_RULES.climaxThreshold &&
            tick - this.lastClimaxTick >= DRAMA_RULES.minTimeBetweenClimax &&
            this.isReady(story.participants, this.simulationMinute()) &&
            this.chance(story.type === 'love_triangle' || story.type === 'forbidden_friendship' ? 'romance' : 'conflict',
              this.world.characters.find(c => c.id === story.participants[0]))) {
          story.phase = 'climax';
          this.lastClimaxTick = tick;
          for (const id of story.participants) this.lastMajorByCharacter[id] = this.simulationMinute();
        } else if (ageMinutes >= 1440 && tension < 0.1) {
          // A story that fizzles out can resolve quietly instead of lasting forever.
          story.phase = 'resolution';
          story.lastEventTick = tick;
        }
        break;
      case 'climax':
        if (tick - story.lastEventTick > 18) { // Climax lasts ~3 hours without events
          story.phase = 'resolution';
        }
        break;
      case 'resolution':
        if (tick - story.lastEventTick > 36) { // Resolution takes ~6 hours
          story.phase = 'aftermath';
        }
        break;
    }
  }

  updateTownMood() {
    if (this.activeStorylines.length === 0) {
      this.townMood = Math.min(1, this.townMood + 0.01);
    } else {
      const maxTension = Math.max(...this.activeStorylines.map(s => s.tension));
      // Town mood inversely related to max storyline tension
      this.townMood = Math.max(0, 1 - maxTension);
    }
  }

  decayEmotions(tick) {
    for (const [charId, drama] of Object.entries(this.characterDrama)) {
      if (!drama.emotions) continue;
      drama.emotions = drama.emotions.filter(emo => {
        emo.intensity -= emo.decay || 0.01;
        return emo.intensity > 0.05;
      });
    }
  }

  // Called from InteractionManager when any social interaction happens
  onInteraction(charA, charB, action) {
    const tick = this.world.tick;

    // Update existing storylines with this event
    for (const story of this.activeStorylines) {
      if (story.participants.includes(charA.id) || story.participants.includes(charB.id)) {
        const isRelevant = this.isRelevantToStoryline(story, charA, charB, action);
        if (isRelevant) {
          story.tension = Math.min(1, story.tension + DRAMA_RULES.tensionBoostOnEvent);
          story.lastEventTick = tick;
          story.events.push({
            tick,
            type: action,
            actor: charA.id,
            target: charB.id
          });
        }
      }
    }

    // Track emotions based on interactions
    this.updateEmotions(charA, charB, action, tick);

    // Check for new storyline seeds from this interaction
    this.checkForNewStorylines(charA, charB, action, tick);

    // Generate dramatic log entries
    this.generateDramaticLog(charA, charB, action, tick);
  }

  isRelevantToStoryline(story, charA, charB, action) {
    const type = STORYLINE_TYPES[story.type];
    if (!type) return false;
    return type.tensionEvents.includes(action) ||
           type.climaxActions.includes(action);
  }

  updateEmotions(charA, charB, action, tick) {
    const dramaA = this.ensureCharacterDrama(charA.id);
    const dramaB = this.ensureCharacterDrama(charB.id);

    switch (action) {
      case 'flirt':
        this.addEmotion(dramaA, { type: 'infatuated', target: charB.id, intensity: 0.3, decay: 0.01 });
        // Check if anyone nearby is jealous
        this.checkJealousy(charA, charB, 'flirt', tick);
        break;
      case 'confess':
        this.addEmotion(dramaA, { type: 'hopeful', target: charB.id, intensity: 0.6, decay: 0.02 });
        this.addEmotion(dramaB, { type: 'anxious', target: charA.id, intensity: 0.3, decay: 0.02 });
        break;
      case 'argue':
        this.addEmotion(dramaA, { type: 'angry', target: charB.id, intensity: 0.5, decay: 0.015 });
        this.addEmotion(dramaB, { type: 'angry', target: charA.id, intensity: 0.4, decay: 0.015 });
        break;
      case 'comfort':
        this.addEmotion(dramaA, { type: 'grateful', target: charB.id, intensity: 0.3, decay: 0.01 });
        this.addEmotion(dramaB, { type: 'content', target: charA.id, intensity: 0.2, decay: 0.01 });
        break;
      case 'confront':
        this.addEmotion(dramaA, { type: 'angry', target: charB.id, intensity: 0.6, decay: 0.02 });
        this.addEmotion(dramaB, { type: 'fearful', target: charA.id, intensity: 0.4, decay: 0.02 });
        break;
      case 'forgive':
        this.addEmotion(dramaA, { type: 'content', target: charB.id, intensity: 0.4, decay: 0.01 });
        this.addEmotion(dramaB, { type: 'grateful', target: charA.id, intensity: 0.5, decay: 0.01 });
        break;
      case 'gossip':
        this.addEmotion(dramaA, { type: 'guilty', target: null, intensity: 0.1, decay: 0.02 });
        break;
    }
  }

  addEmotion(dramaState, emotion) {
    if (!dramaState.emotions) dramaState.emotions = [];
    // Replace existing emotion of same type+target
    const existing = dramaState.emotions.findIndex(e =>
      e.type === emotion.type && e.target === emotion.target
    );
    if (existing >= 0) {
      dramaState.emotions[existing].intensity = Math.min(1,
        dramaState.emotions[existing].intensity + emotion.intensity
      );
    } else {
      dramaState.emotions.push({ ...emotion });
    }
    // Cap at 5 emotions per character
    if (dramaState.emotions.length > 5) {
      dramaState.emotions.sort((a, b) => b.intensity - a.intensity);
      dramaState.emotions = dramaState.emotions.slice(0, 5);
    }
  }

  checkJealousy(charA, charB, action, tick) {
    // Check if any nearby character has high attraction to charB
    const nearby = this.world.getCharactersNear(charA.pos.x, charA.pos.y, 4)
      .filter(c => c.id !== charA.id && c.id !== charB.id);

    for (const witness of nearby) {
      const rel = witness.relationships[charB.id];
      if (rel && (rel.attraction > 3 || rel.tag === 'crush' || rel.tag === 'lover')) {
        const drama = this.ensureCharacterDrama(witness.id);
        this.addEmotion(drama, {
          type: 'jealous',
          target: charA.id,
          intensity: 0.4 + (rel.attraction || 0) * 0.05,
          decay: 0.008
        });

        // Add to gossip network
        this.addGossip(witness.id, `${charA.id}_${action}_${charB.id}`, tick);
      }
    }
  }

  checkForNewStorylines(charA, charB, action, tick) {
    if (this.activeStorylines.length >= DRAMA_RULES.maxActiveStorylines) return;

    // Love triangle detection
    if (action === 'flirt' || action === 'confess') {
      const relAB = charA.relationships[charB.id];
      if (relAB && (relAB.attraction > 3 || action === 'confess')) {
        // Find potential rival - someone with high attraction to charB
        for (const other of this.world.characters) {
          if (other.id === charA.id || other.id === charB.id) continue;
          const relOther = other.relationships[charB.id];
          if (relOther && relOther.attraction > 3) {
            // Check not already in a love triangle storyline
            const alreadyInTriangle = this.activeStorylines.some(s =>
              s.type === 'love_triangle' &&
              s.participants.includes(charA.id) &&
              s.participants.includes(charB.id)
            );
            if (!alreadyInTriangle) {
              const created = this.createStoryline('love_triangle', {
                participants: [charA.id, charB.id, other.id],
                roles: { pursuer: charA.id, target: charB.id, rival: other.id }
              }, tick, [charA.id, charB.id]);
              if (created) return;
            }
          }
        }
      }
    }

    // Rivalry detection
    if (action === 'argue' || action === 'confront') {
      const relAB = charA.relationships[charB.id];
      if (relAB && relAB.affection < 4) {
        const alreadyRivals = this.activeStorylines.some(s =>
          s.type === 'rivalry' &&
          s.participants.includes(charA.id) &&
          s.participants.includes(charB.id)
        );
        if (!alreadyRivals) {
          const created = this.createStoryline('rivalry', {
            participants: [charA.id, charB.id],
            roles: { rival_a: charA.id, rival_b: charB.id }
          }, tick, [charA.id, charB.id]);
          if (created) return;
        }
      }
    }

    // Grudge match detection
    if (action === 'argue') {
      const relAB = charA.relationships[charB.id];
      if (relAB && relAB.trust < 3) {
        const alreadyGrudge = this.activeStorylines.some(s =>
          s.type === 'grudge_match' &&
          s.participants.includes(charA.id) &&
          s.participants.includes(charB.id)
        );
        if (!alreadyGrudge) {
          this.createStoryline('grudge_match', {
            participants: [charA.id, charB.id],
            roles: { aggrieved: charB.id, offender: charA.id }
          }, tick, [charA.id, charB.id]);
        }
      }
    }
  }

  createStoryline(type, config, tick, continuation = []) {
    if (this.activeStorylines.length >= DRAMA_RULES.maxActiveStorylines) return null;
    const now = this.simulationMinute();
    if (!this.isReady(config.participants, now, continuation)) return null;
    const category = type === 'love_triangle' || type === 'forbidden_friendship' ? 'romance' : 'conflict';
    const actor = this.world.characters.find(c => c.id === config.participants[0]);
    if (!continuation.length && !this.chance(category, actor)) return null;
    for (const id of config.participants) this.lastMajorByCharacter[id] = now;
    const storyline = {
      id: `story_${++this.storylineCounter}`,
      type,
      participants: config.participants,
      roles: config.roles,
      phase: 'setup',
      tension: 0.2,
      startTick: tick,
      startMinute: now,
      lastEventTick: tick,
      events: [{ tick, type: 'storyline_started', details: type }],
      resolved: false
    };
    this.activeStorylines.push(storyline);

    // Add initial emotions to participants
    for (const charId of config.participants) {
      this.ensureCharacterDrama(charId);
    }

    return storyline;
  }

  // Seed new drama when town is too peaceful
  seedDrama(tick) {
    const seed = this.findBestSeed(tick);
    if (seed) {
      if (!this.createStoryline(seed.type, seed, tick)) return;

      // Inject initial emotions
      for (const [charId, emotions] of Object.entries(seed.initialEmotions || {})) {
        const drama = this.ensureCharacterDrama(charId);
        for (const emo of emotions) {
          this.addEmotion(drama, emo);
        }
      }
    }
  }

  findBestSeed(tick) {
    const chars = this.world.characters;

    // 1. Look for natural love triangle opportunities
    for (const charA of chars) {
      for (const charB of chars) {
        if (charA.id === charB.id) continue;
        const relAB = charA.relationships[charB.id];
        if (!relAB) continue;

        // Only seed a triangle when a real attraction and shared history exist.
        if (relAB.interactionCount > 5 && relAB.affection > 5 && relAB.attraction >= 3) {
          // Check if charB has a close relationship with someone else
          for (const charC of chars) {
            if (charC.id === charA.id || charC.id === charB.id) continue;
            const relBC = charB.relationships[charC.id];
            if (relBC && relBC.affection > 6) {
              const alreadyActive = this.activeStorylines.some(s =>
                s.participants.includes(charA.id) && s.participants.includes(charB.id)
              );
              if (!alreadyActive) {
                // Seed a crush that could become a love triangle
                return {
                  type: 'love_triangle',
                  participants: [charA.id, charB.id, charC.id],
                  roles: { pursuer: charA.id, target: charB.id, rival: charC.id },
                  initialEmotions: {
                    [charA.id]: [{ type: 'infatuated', target: charB.id, intensity: 0.4, decay: 0.008 }]
                  }
                };
              }
            }
          }
        }
      }
    }

    // 2. Look for workplace rivalry potential
    const workplaces = {};
    for (const char of chars) {
      if (char.workplace) {
        if (!workplaces[char.workplace]) workplaces[char.workplace] = [];
        workplaces[char.workplace].push(char);
      }
    }
    for (const [, coworkers] of Object.entries(workplaces)) {
      if (coworkers.length >= 2) {
        const [a, b] = coworkers;
        const alreadyActive = this.activeStorylines.some(s =>
          s.type === 'rivalry' && s.participants.includes(a.id) && s.participants.includes(b.id)
        );
        if (!alreadyActive) {
          // Check if personalities clash
          const hasConflict = a.personality.some(t =>
            ['ambitious', 'proud', 'competitive'].includes(t)
          );
          const rel = a.relationships[b.id];
          if (hasConflict && rel && (rel.affection < 4.5 || rel.trust < 3.5)) {
            return {
              type: 'rivalry',
              participants: [a.id, b.id],
              roles: { rival_a: a.id, rival_b: b.id },
              initialEmotions: {
                [a.id]: [{ type: 'proud', target: null, intensity: 0.3, decay: 0.01 }]
              }
            };
          }
        }
      }
    }

    return null;
  }

  // Handle gossip spreading between characters
  handleGossip(charA, charB) {
    const gossipA = this.gossipNetwork[charA.id] || [];
    const gossipB = this.gossipNetwork[charB.id] || [];

    // During gossip, A shares something they know with B
    if (gossipA.length > 0) {
      // Pick random gossip to share
      const randomGossip = gossipA[Math.floor(Math.random() * gossipA.length)];
      if (!gossipB.includes(randomGossip.info)) {
        this.addGossip(charB.id, randomGossip.info, this.world.tick);
      }
    }
  }

  addGossip(charId, info, tick) {
    if (!this.gossipNetwork[charId]) this.gossipNetwork[charId] = [];
    const existing = this.gossipNetwork[charId].find(g => g.info === info);
    if (!existing) {
      this.gossipNetwork[charId].push({ info, learnedTick: tick });
      // Cap gossip per character
      if (this.gossipNetwork[charId].length > 10) {
        this.gossipNetwork[charId].shift();
      }
    }
  }

  // Generate dramatic log entries for the activity feed
  generateDramaticLog(charA, charB, action, tick) {
    const templates = {
      confess: [
        `${charA.name} confesses feelings to ${charB.name}`,
        `${charA.name} opens their heart to ${charB.name}`
      ],
      confront: [
        `${charA.name} confronts ${charB.name}`,
        `${charA.name} demands answers from ${charB.name}`
      ],
      comfort: [
        `${charA.name} comforts ${charB.name}`,
        `${charA.name} puts a reassuring hand on ${charB.name}'s shoulder`
      ],
      apologize: [
        `${charA.name} apologizes to ${charB.name}`,
        `${charA.name} asks ${charB.name} for forgiveness`
      ],
      forgive: [
        `${charA.name} forgives ${charB.name}`,
        `${charA.name} and ${charB.name} make peace`
      ],
      gossip: [
        `${charA.name} and ${charB.name} whisper about someone`,
        `${charA.name} shares a rumor with ${charB.name}`
      ],
      stormOff: [
        `${charA.name} storms away`,
        `${charA.name} leaves in anger`
      ]
    };

    const t = templates[action];
    if (t) {
      const text = t[Math.floor(Math.random() * t.length)];
      this.world.addLog({ char: charA.id, text, dramatic: true });
    }
  }

  // Get drama context string for LLM prompts
  getDramaContext(char) {
    const drama = this.characterDrama[char.id];
    if (!drama) return null;

    const parts = [];

    // Active emotions
    if (drama.emotions && drama.emotions.length > 0) {
      const emoStr = drama.emotions
        .filter(e => e.intensity > 0.2)
        .map(e => {
          const targetChar = e.target ? this.world.characters.find(c => c.id === e.target) : null;
          const targetName = targetChar ? targetChar.name.toLowerCase() : '';
          return targetName ? `${e.type}(${targetName},${e.intensity.toFixed(1)})` : `${e.type}(${e.intensity.toFixed(1)})`;
        })
        .join(',');
      if (emoStr) parts.push(`emo:${emoStr}`);
    }

    // Active storylines involving this character
    const storylines = this.activeStorylines.filter(s => s.participants.includes(char.id));
    if (storylines.length > 0) {
      const storyStr = storylines.map(s => {
        const role = Object.entries(s.roles).find(([, id]) => id === char.id);
        const roleName = role ? role[0] : 'participant';
        return `${s.type}(${s.phase},${roleName})`;
      }).join(',');
      parts.push(`story:${storyStr}`);
    }

    // Gossip this character knows
    const gossip = this.gossipNetwork[char.id];
    if (gossip && gossip.length > 0) {
      const recent = gossip.slice(-2).map(g => g.info).join(',');
      parts.push(`knows:${recent}`);
    }

    return parts.length > 0 ? parts.join('|') : null;
  }

  ensureCharacterDrama(charId) {
    if (!this.characterDrama[charId]) {
      this.characterDrama[charId] = {
        emotions: [],
        secrets: [],
        desires: [],
        fears: []
      };
    }
    return this.characterDrama[charId];
  }

  // Serialization for state save/load
  toJSON() {
    return {
      activeStorylines: this.activeStorylines,
      resolvedStorylines: this.resolvedStorylines.slice(-10),
      characterDrama: this.characterDrama,
      gossipNetwork: this.gossipNetwork,
      townMood: this.townMood,
      lastSeedCheck: this.lastSeedCheck,
      lastClimaxTick: this.lastClimaxTick,
      storylineCounter: this.storylineCounter,
      lastMajorByCharacter: this.lastMajorByCharacter
    };
  }

  fromJSON(data) {
    if (!data) return;
    this.activeStorylines = data.activeStorylines || [];
    this.resolvedStorylines = data.resolvedStorylines || [];
    this.characterDrama = data.characterDrama || {};
    this.gossipNetwork = data.gossipNetwork || {};
    this.townMood = data.townMood || 0.5;
    this.lastSeedCheck = data.lastSeedCheck || 0;
    this.lastClimaxTick = data.lastClimaxTick || 0;
    this.storylineCounter = data.storylineCounter || 0;
    this.lastMajorByCharacter = Object.assign(Object.create(null), data.lastMajorByCharacter || {});
  }
}

module.exports = { DramaEngine };
