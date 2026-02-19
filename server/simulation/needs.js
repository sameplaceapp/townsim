class NeedsManager {
  constructor(config) {
    this.decayRates = config.needs.decayRates;
    this.thresholds = config.needs.criticalThresholds;
    this.recoveryRates = config.needs.recoveryRates;
  }

  decayAll(characters) {
    for (const char of characters) {
      if (char.activity === 'sleep') {
        char.needs.energy = Math.max(0, char.needs.energy - 0.5);
        char.needs.hunger += this.decayRates.hunger * 0.5;
      } else {
        char.needs.hunger = Math.min(10, char.needs.hunger + this.decayRates.hunger);
        char.needs.energy = Math.min(10, char.needs.energy + this.decayRates.energy);
        char.needs.hygiene = Math.min(10, char.needs.hygiene + this.decayRates.hygiene);
      }

      // Social activities reduce social need
      const socialActions = ['chat', 'greet', 'flirt', 'confess', 'comfort', 'gossip', 'celebrate', 'dance'];
      if (socialActions.includes(char.activity)) {
        char.needs.social = Math.max(0, char.needs.social - 0.3);
      } else {
        char.needs.social = Math.min(10, char.needs.social + this.decayRates.social);
      }

      // Fun based on activity
      const funActions = ['drink', 'play', 'relax', 'dance', 'sing', 'celebrate', 'fish', 'explore', 'stargaze', 'perform', 'garden'];
      if (funActions.includes(char.activity)) {
        char.needs.fun = Math.max(0, char.needs.fun - 0.2);
      } else if (char.activity === 'work') {
        char.needs.fun = Math.min(10, char.needs.fun + this.decayRates.fun);
      } else if (['argue', 'confront', 'cry', 'stormOff'].includes(char.activity)) {
        // Negative emotional activities increase fun need (stress)
        char.needs.fun = Math.min(10, char.needs.fun + this.decayRates.fun * 1.5);
      } else {
        char.needs.fun = Math.min(10, char.needs.fun + this.decayRates.fun * 0.5);
      }

      // Apply activity-specific recovery
      const recovery = this.recoveryRates[char.activity];
      if (recovery) {
        for (const [need, rate] of Object.entries(recovery)) {
          char.needs[need] = Math.max(0, Math.min(10, char.needs[need] + rate));
        }
      }
    }
  }

  checkCritical(char, world) {
    // Returns an override action if a critical need is detected
    if (char.needs.hunger >= this.thresholds.hunger && char.activity !== 'eat') {
      // Allow override during goto unless already heading to food
      const foodPlaces = ['tavern', 'general_store', char.home];
      if (char.activity === 'goto' && foodPlaces.includes(char.activityData?.destination)) {
        // Already heading to food, don't override
      } else {
        const target = this.findNearest(char, foodPlaces, world);
        if (target) {
          return { type: 'goto', target, then: 'eat' };
        }
      }
    }

    if (char.needs.energy >= this.thresholds.energy && char.activity !== 'sleep') {
      // Allow override during goto unless already heading home to sleep
      if (char.activity === 'goto' && char.activityData?.destination === char.home && char.activityData?.then === 'sleep') {
        // Already heading home to sleep, don't override
      } else {
        return { type: 'goto', target: char.home, then: 'sleep' };
      }
    }

    return null;
  }

  findNearest(char, buildingIds, world) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const id of buildingIds) {
      const b = world.buildings[id];
      if (!b || !b.door) continue;
      const dist = Math.abs(char.pos.x - b.door[0]) + Math.abs(char.pos.y - b.door[1]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = id;
      }
    }
    return nearest;
  }
}

module.exports = { NeedsManager };
