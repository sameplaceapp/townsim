const charsConfig = require('../../config/characters.json');

class Character {
  constructor(def, spawnPos) {
    this.id = def.id;
    this.name = def.name;
    this.job = def.job;
    this.personality = def.personality;
    this.color = def.color || '#a0a0a0';
    this.home = def.home;
    this.workplace = def.workplace;

    // Compressed personality for LLM prompts
    this.personalityAbbr = def.personality
      .map(t => charsConfig.traitAbbreviations[t] || t.slice(0, 3))
      .join('.');

    // Needs: 0 = satisfied, 10 = critical
    this.needs = {
      hunger: 2 + Math.random() * 3,
      energy: 1 + Math.random() * 2,
      social: 3 + Math.random() * 3,
      fun: 3 + Math.random() * 3,
      hygiene: 1 + Math.random() * 2
    };

    // Position and movement
    this.pos = { ...spawnPos };
    this.target = null;
    this.path = [];
    this.direction = 'down'; // down, up, left, right
    this.walking = false;

    // State
    this.activity = 'idle';
    this.activityData = {};
    this.location = null; // building id or null (outdoors)
    this.inside = false;

    // Schedule
    this.schedule = {
      6: 'wake_up',
      7: 'go_to_work',
      12: 'lunch_break',
      13: 'go_to_work',
      17: 'leave_work',
      20: 'go_home',
      22: 'sleep'
    };

    // Relationships: { characterId: { level: 0-10, tag: string } }
    this.relationships = {};

    // LLM tracking
    this.lastDecisionTick = 0;
    this.pendingDecision = false;
    this.recentMemory = [];
    this.maxMemory = 10;

    // Mood/emotion tracking
    this.mood = null;       // Current dominant emotion (from LLM EMO field)
    this.moodTick = 0;      // When mood was last set
    this.moodHistory = [];   // Last 5 moods for pattern detection
    this.maxMoodHistory = 5;

    // Display
    this.say = null;
    this.sayTick = 0;
    this.think = null;
    this.thinkTick = 0;
  }

  addMemory(event) {
    this.recentMemory.push(event);
    if (this.recentMemory.length > this.maxMemory) {
      this.recentMemory.shift();
    }
  }

  setSay(text, tick) {
    this.say = text;
    this.sayTick = tick;
  }

  setThink(text, tick) {
    this.think = text;
    this.thinkTick = tick;
  }

  setMood(emotion, tick) {
    if (!emotion) return;
    this.mood = emotion;
    this.moodTick = tick;
    this.moodHistory.push({ emotion, tick });
    if (this.moodHistory.length > this.maxMoodHistory) {
      this.moodHistory.shift();
    }
  }

  updateDirection() {
    if (this.path.length === 0) return;
    const next = this.path[0];
    const dx = next.x - this.pos.x;
    const dy = next.y - this.pos.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.direction = dx > 0 ? 'right' : 'left';
    } else {
      this.direction = dy > 0 ? 'down' : 'up';
    }
  }

  moveStep() {
    if (this.path.length === 0) {
      this.walking = false;
      return false;
    }
    const next = this.path.shift();
    this.prevPos = { ...this.pos };
    this.pos = { x: next.x, y: next.y };
    this.walking = true;
    this.updateDirection();
    return true;
  }

  getScheduledAction(hour) {
    return this.schedule[hour] || null;
  }

  getNeedsCompressed() {
    return `h${Math.round(this.needs.hunger)}e${Math.round(this.needs.energy)}s${Math.round(this.needs.social)}f${Math.round(this.needs.fun)}`;
  }

  toSummary() {
    return {
      id: this.id,
      name: this.name,
      job: this.job,
      pos: { ...this.pos },
      activity: this.activity,
      activityData: { destination: this.activityData.destination || null, target: this.activityData.target || null },
      direction: this.direction,
      walking: this.walking,
      color: this.color,
      inside: this.inside,
      location: this.location,
      say: this.say,
      sayTick: this.sayTick,
      think: this.think,
      thinkTick: this.thinkTick,
      mood: this.mood,
      needs: { ...this.needs },
      personality: this.personality,
      relationships: this.relationships
    };
  }

  toDetail() {
    return {
      ...this.toSummary(),
      personality: this.personality,
      needs: { ...this.needs },
      relationships: { ...this.relationships },
      home: this.home,
      workplace: this.workplace,
      recentMemory: [...this.recentMemory],
      activityData: { ...this.activityData }
    };
  }
}

module.exports = { Character };
