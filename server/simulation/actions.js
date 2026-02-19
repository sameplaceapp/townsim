const ACTIONS = {
  goto: 'goto',
  wander: 'wander',
  chat: 'chat',
  greet: 'greet',
  flirt: 'flirt',
  argue: 'argue',
  gift: 'gift',
  work: 'work',
  eat: 'eat',
  sleep: 'sleep',
  drink: 'drink',
  pray: 'pray',
  relax: 'relax',
  shop: 'shop',
  play: 'play',
  idle: 'idle',
  think: 'think',
  // New dramatic actions
  confess: 'confess',
  comfort: 'comfort',
  confront: 'confront',
  apologize: 'apologize',
  forgive: 'forgive',
  gossip: 'gossip',
  cry: 'cry',
  laugh: 'laugh',
  dance: 'dance',
  sing: 'sing',
  celebrate: 'celebrate',
  stormOff: 'stormOff',
  // New lifestyle actions
  craft: 'craft',
  fish: 'fish',
  garden: 'garden',
  explore: 'explore',
  stargaze: 'stargaze',
  perform: 'perform'
};

const ACTION_DURATIONS = {
  eat: 3,
  sleep: 48,     // ~8 hours in ticks (48 * 10min)
  work: 6,       // refreshed by schedule
  drink: 4,
  pray: 3,
  relax: 4,
  shop: 3,
  play: 4,
  chat: 3,
  greet: 1,
  flirt: 2,
  argue: 2,
  gift: 1,
  think: 1,
  idle: 2,
  wander: 3,
  // New dramatic actions
  confess: 3,
  comfort: 3,
  confront: 2,
  apologize: 2,
  forgive: 2,
  gossip: 3,
  cry: 2,
  laugh: 1,
  dance: 4,
  sing: 3,
  celebrate: 4,
  stormOff: 2,
  // New lifestyle actions
  craft: 5,
  fish: 6,
  garden: 5,
  explore: 4,
  stargaze: 3,
  perform: 4
};

class ActionManager {
  constructor(world, pathFinder) {
    this.world = world;
    this.pathFinder = pathFinder;
  }

  leaveBuilding(char) {
    if (char.inside) {
      // BUG-04/07: Move character to building door so they're on a walkable tile
      const building = this.world.buildings[char.location];
      if (building && building.door) {
        char.pos = { x: building.door[0], y: building.door[1] };
      }
      char.inside = false;
      char.location = null;
    }
  }

  assignAction(char, action) {
    char.activity = action.type;
    char.activityData = {
      target: action.target || null,
      then: action.then || null,
      ticksRemaining: ACTION_DURATIONS[action.type] || 2,
      startTick: this.world.tick
    };

    if (action.type === 'goto' && action.target) {
      // Leave current building if heading somewhere different
      if (char.inside && char.location !== action.target) {
        this.leaveBuilding(char);
      }

      const building = this.world.buildings[action.target];
      if (building && building.door) {
        // Already at the door? Enter immediately
        if (char.pos.x === building.door[0] && char.pos.y === building.door[1]) {
          char.location = action.target;
          char.inside = true;
          char.path = [];
          char.walking = false;
          if (action.then) {
            this.assignAction(char, { type: action.then });
          } else {
            char.activity = 'idle';
            char.activityData = { ticksRemaining: 1 };
          }
          return;
        }
        const path = this.pathFinder.findPath(
          char.pos.x, char.pos.y,
          building.door[0], building.door[1]
        );
        char.path = path;
        char.walking = path.length > 0;
        char.activityData.destination = action.target;
      }
    } else if (action.type === 'wander') {
      // Leaving building to wander
      this.leaveBuilding(char);
      // Pick a random nearby walkable tile
      const angle = Math.random() * Math.PI * 2;
      const dist = 3 + Math.floor(Math.random() * 5);
      const tx = Math.round(char.pos.x + Math.cos(angle) * dist);
      const ty = Math.round(char.pos.y + Math.sin(angle) * dist);
      const clampX = Math.max(0, Math.min(this.world.gridWidth - 1, tx));
      const clampY = Math.max(0, Math.min(this.world.gridHeight - 1, ty));
      const path = this.pathFinder.findPath(char.pos.x, char.pos.y, clampX, clampY);
      char.path = path;
      char.walking = path.length > 0;
    }
  }

  executeAction(char) {
    // Movement
    if (char.path.length > 0) {
      char.moveStep();

      // Check if arrived at building door
      const buildingId = this.world.getBuildingAt(char.pos.x, char.pos.y);
      if (buildingId && char.activityData.destination === buildingId) {
        char.location = buildingId;
        char.inside = true;
        char.path = [];
        char.walking = false;

        // Transition to 'then' action
        if (char.activityData.then) {
          this.assignAction(char, { type: char.activityData.then });
        } else {
          char.activity = 'idle';
          char.activityData = { ticksRemaining: 1 };
        }
        return 'arrived';
      }
      return 'moving';
    }

    // Stuck detection: goto with empty path but not at destination
    if (char.activity === 'goto' && char.path.length === 0) {
      const dest = char.activityData.destination;
      const atDest = dest && this.world.getBuildingAt(char.pos.x, char.pos.y) === dest;
      if (!atDest) {
        char.activity = 'idle';
        char.activityData = { ticksRemaining: 0 };
        char.walking = false;
        return 'stuck_reset';
      }
    }

    // Stuck counter: same activity at same position for too long
    if (!char._stuckCheck) {
      char._stuckCheck = { x: char.pos.x, y: char.pos.y, activity: char.activity, count: 0 };
    }
    if (char._stuckCheck.x === char.pos.x && char._stuckCheck.y === char.pos.y && char._stuckCheck.activity === char.activity) {
      char._stuckCheck.count++;
    } else {
      char._stuckCheck = { x: char.pos.x, y: char.pos.y, activity: char.activity, count: 0 };
    }
    // BUG-05: Use the action's actual duration + 2 as threshold to avoid resetting long actions
    const stuckThreshold = Math.max(7, (ACTION_DURATIONS[char.activity] || 2) + 2);
    const stuckExempt = ['sleep', 'work', 'fish', 'craft', 'garden'];
    if (char._stuckCheck.count >= stuckThreshold && !stuckExempt.includes(char.activity)) {
      char.activity = 'idle';
      char.activityData = { ticksRemaining: 0 };
      char.path = [];
      char.walking = false;
      char._stuckCheck.count = 0;
      return 'stuck_reset';
    }

    // Timed actions
    if (char.activityData.ticksRemaining > 0) {
      char.activityData.ticksRemaining--;
      if (char.activityData.ticksRemaining <= 0) {
        // Action complete
        if (char.activity === 'sleep' && char.needs.energy > 1) {
          // Keep sleeping until rested
          char.activityData.ticksRemaining = 6;
          return 'continuing';
        }
        const completed = char.activity;
        char.activity = 'idle';
        char.activityData = { ticksRemaining: 0 };

        // Leave building if done with inside activity (except sleep)
        if (char.inside && !['sleep'].includes(completed)) {
          this.leaveBuilding(char);
        }

        return 'completed';
      }
      return 'busy';
    }

    return 'idle';
  }

  handleSchedule(char, hour) {
    const action = char.getScheduledAction(hour);
    if (!action) return null;

    // Don't interrupt important activities
    if (['sleep', 'eat'].includes(char.activity) && char.activityData.ticksRemaining > 0) {
      return null;
    }

    switch (action) {
      case 'wake_up':
        if (char.activity === 'sleep') {
          char.activity = 'idle';
          char.activityData = { ticksRemaining: 0 };
          this.leaveBuilding(char); // BUG-04: teleport to door
          return { type: 'idle' };
        }
        break;
      case 'go_to_work':
        if (char.location !== char.workplace) {
          return { type: 'goto', target: char.workplace, then: 'work' };
        }
        return { type: 'work' };
      case 'lunch_break':
        return { type: 'goto', target: 'tavern', then: 'eat' };
      case 'leave_work':
        this.leaveBuilding(char); // BUG-07: teleport to door
        return { type: 'wander' };
      case 'go_home':
        return { type: 'goto', target: char.home, then: 'relax' };
      case 'sleep':
        if (char.location === char.home) {
          return { type: 'sleep' };
        }
        return { type: 'goto', target: char.home, then: 'sleep' };
    }
    return null;
  }
}

module.exports = { ActionManager, ACTIONS, ACTION_DURATIONS };
