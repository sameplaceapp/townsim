class InteractionManager {
  constructor() {
    this.dramaEngine = null; // Set externally by engine.js
  }

  updateRelationship(charA, charB, action) {
    this.ensureRelationship(charA, charB);
    this.ensureRelationship(charB, charA);

    const relA = charA.relationships[charB.id];
    const relB = charB.relationships[charA.id];

    // Update interaction counts
    relA.interactionCount = (relA.interactionCount || 0) + 1;
    relB.interactionCount = (relB.interactionCount || 0) + 1;

    switch (action) {
      case 'chat':
      case 'greet':
        relA.affection = Math.min(10, relA.affection + 0.15);
        relB.affection = Math.min(10, relB.affection + 0.1);
        relA.trust = Math.min(10, relA.trust + 0.05);
        relB.trust = Math.min(10, relB.trust + 0.05);
        break;
      case 'flirt':
        relA.attraction = Math.min(10, relA.attraction + 0.4);
        relA.affection = Math.min(10, relA.affection + 0.2);
        relB.attraction = Math.min(10, relB.attraction + 0.15);
        break;
      case 'argue':
        relA.affection = Math.max(0, relA.affection - 0.4);
        relB.affection = Math.max(0, relB.affection - 0.3);
        relA.trust = Math.max(0, relA.trust - 0.3);
        relB.trust = Math.max(0, relB.trust - 0.2);
        break;
      case 'gift':
        relA.affection = Math.min(10, relA.affection + 0.1);
        relB.affection = Math.min(10, relB.affection + 0.4);
        relB.trust = Math.min(10, relB.trust + 0.15);
        break;
      case 'confess':
        relA.attraction = Math.min(10, relA.attraction + 0.5);
        relA.trust = Math.min(10, relA.trust + 0.3);
        // Target's response depends on their attraction
        if (relB.attraction > 4) {
          relB.attraction = Math.min(10, relB.attraction + 0.3);
          relB.affection = Math.min(10, relB.affection + 0.3);
        } else {
          relB.affection = Math.max(0, relB.affection - 0.2);
        }
        break;
      case 'comfort':
        relA.affection = Math.min(10, relA.affection + 0.2);
        relB.affection = Math.min(10, relB.affection + 0.3);
        relB.trust = Math.min(10, relB.trust + 0.3);
        break;
      case 'confront':
        relA.respect = Math.min(10, relA.respect + 0.2);
        relA.trust = Math.max(0, relA.trust - 0.4);
        relB.affection = Math.max(0, relB.affection - 0.3);
        relB.trust = Math.max(0, relB.trust - 0.3);
        break;
      case 'apologize':
        relA.trust = Math.min(10, relA.trust + 0.2);
        relB.trust = Math.min(10, relB.trust + 0.15);
        relB.affection = Math.min(10, relB.affection + 0.2);
        relA.respect = Math.min(10, relA.respect + 0.1);
        break;
      case 'forgive':
        relA.trust = Math.min(10, relA.trust + 0.3);
        relB.trust = Math.min(10, relB.trust + 0.2);
        relA.affection = Math.min(10, relA.affection + 0.2);
        relB.affection = Math.min(10, relB.affection + 0.3);
        break;
      case 'gossip':
        relA.affection = Math.min(10, relA.affection + 0.1);
        relB.affection = Math.min(10, relB.affection + 0.1);
        relA.trust = Math.max(0, relA.trust - 0.1);
        // Gossip may spread info through drama engine
        if (this.dramaEngine) {
          this.dramaEngine.handleGossip(charA, charB);
        }
        break;
    }

    // Update derived tags
    relA.tag = this.getTag(relA);
    relB.tag = this.getTag(relB);

    // Backwards compat: compute level from multi-dimensional scores
    relA.level = this.computeLevel(relA);
    relB.level = this.computeLevel(relB);

    // Notify drama engine of significant interactions
    if (this.dramaEngine) {
      this.dramaEngine.onInteraction(charA, charB, action);
    }
  }

  ensureRelationship(charA, charB) {
    if (!charA.relationships[charB.id]) {
      charA.relationships[charB.id] = {
        affection: 5,
        trust: 5,
        attraction: 1,
        respect: 5,
        tag: 'acquaintance',
        level: 5,
        interactionCount: 0
      };
    }
    // Migrate old format relationships
    const rel = charA.relationships[charB.id];
    if (rel.affection === undefined) {
      const oldLevel = rel.level || 5;
      rel.affection = oldLevel;
      rel.trust = Math.max(3, oldLevel - 1);
      rel.attraction = 1;
      rel.respect = 5;
      rel.interactionCount = rel.interactionCount || 0;
    }
  }

  computeLevel(rel) {
    // Weighted average for backwards compatibility
    return (rel.affection * 0.4 + rel.trust * 0.3 + rel.respect * 0.2 + rel.attraction * 0.1);
  }

  getTag(rel) {
    const level = this.computeLevel(rel);
    const attraction = rel.attraction || 0;

    // Romantic tags take priority when attraction is high
    if (attraction >= 7 && rel.affection >= 7) return 'lover';
    if (attraction >= 5 && rel.affection >= 5) return 'crush';
    if (attraction >= 4 && level >= 6) return 'flirtatious';

    // Friendship tags
    if (level >= 9) return 'best_friend';
    if (level >= 7) return 'close_friend';
    if (level >= 5) return 'friend';
    if (level >= 3) return 'acquaintance';
    if (level >= 1) return 'tense';
    return 'hostile';
  }
}

module.exports = { InteractionManager };
