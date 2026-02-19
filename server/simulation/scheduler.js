class Scheduler {
  constructor(config) {
    this.decisionCooldown = config.simulation.decisionCooldown;
    this.reflectionChance = config.simulation.reflectionChance;
  }

  evaluate(characters, world) {
    const needsDecision = [];

    for (const char of characters) {
      if (char.pendingDecision) continue;

      const ticksSinceDecision = world.tick - char.lastDecisionTick;
      const withinCooldown = ticksSinceDecision < this.decisionCooldown;

      let reason = null;

      // Action completed and no scheduled action
      if (char.activity === 'idle' && char.activityData.ticksRemaining <= 0) {
        reason = 'idle';
      }

      // Character has been idle for 3+ ticks near others - always trigger
      if (!reason && char.activity === 'idle' && ticksSinceDecision >= 3) {
        const nearby = world.getCharactersNear(char.pos.x, char.pos.y, 3);
        const others = nearby.filter(c => c.id !== char.id && !['sleep'].includes(c.activity));
        if (others.length > 0) {
          reason = 'idle_near_others';
        }
      }

      // Encountered another character nearby (not while busy working/sleeping)
      // Allow encounter-based decisions even within cooldown
      if (!reason && !['work', 'sleep', 'eat'].includes(char.activity)) {
        const nearby = world.getCharactersNear(char.pos.x, char.pos.y, 2);
        const others = nearby.filter(c => c.id !== char.id && !['sleep'].includes(c.activity));
        if (others.length > 0) {
          const recentInteractions = char.recentMemory
            .filter(m => m.includes('chat') || m.includes('greet'))
            .slice(-3);
          const alreadyInteracted = others.some(o =>
            recentInteractions.some(m => m.includes(o.id))
          );
          if (!alreadyInteracted) {
            reason = 'encounter';
          }
        }
      }

      // For non-encounter reasons, still respect cooldown
      if (reason && reason !== 'encounter' && reason !== 'idle_near_others' && reason !== 'idle' && withinCooldown) {
        continue;
      }

      // Just completed an action - trigger "what next?" decision
      if (!reason && char.activity === 'idle' && ticksSinceDecision >= 1) {
        reason = 'action_completed';
      }

      // Random reflection
      if (!reason && char.activity === 'idle') {
        if (Math.random() < this.reflectionChance) {
          reason = 'reflect';
        }
      }

      if (reason) {
        needsDecision.push({ character: char, reason });
      }
    }

    return needsDecision;
  }
}

module.exports = { Scheduler };
