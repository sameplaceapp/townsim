const { createHash, randomUUID } = require('node:crypto');

// This tracks only milestone hysteresis; it never changes relationships or choices.
class HistoricalEventIntegration {
  constructor(history, saved) {
    if (saved !== undefined && (!saved || saved.version !== 1 ||
        !saved.pairs || typeof saved.pairs !== 'object' || Array.isArray(saved.pairs))) {
      throw new Error('Invalid historical milestone state');
    }
    this.history = history;
    this.pairs = Object.assign(Object.create(null), saved?.pairs || {});
  }

  record(event) {
    try { this.history.record(event); }
    catch (err) { console.error('Unable to record historical event:', err.message); }
  }

  relationshipChanged(a, b, action, before, after) {
    if (a.id === b.id) return;
    const ids = [a.id, b.id].sort();
    const key = createHash('sha256').update(JSON.stringify(ids)).digest('hex');
    let state = this.pairs[key];
    const strong = values => values.every(v => v >= 7);
    const strained = values => values.every(v => v <= 3);
    if (!state) {
      state = this.pairs[key] = { friendship: strong(before), strained: strained(before),
        hadStrain: strained(before), reconciled: false };
    }
    const events = [];
    if (!state.friendship && strong(after) &&
        (a.relationships[b.id].interactionCount || 0) >= 3 && (b.relationships[a.id].interactionCount || 0) >= 3) {
      state.friendship = true;
      events.push(['friendship_established', 'Established friendship']);
    } else if (state.friendship && after.some(v => v < 6.5)) state.friendship = false;
    if (!state.strained && strained(after)) {
      state.strained = true;
      state.hadStrain = true;
      state.reconciled = false;
      events.push(['relationship_deteriorated', 'Relationship significantly deteriorated']);
    } else if (state.strained && after.some(v => v > 3.5)) state.strained = false;
    if (state.hadStrain && !state.reconciled && after.every(v => v >= 4.5)) {
      state.reconciled = true;
      events.push(['reconciliation', 'Relationship recovered after significant strain']);
    }
    for (const [milestone, description] of events) {
      this.record({ id: `relationship:${randomUUID()}`, type: 'relationship_changed', description,
        entities: ids.map(id => ({kind:'character', id})),
        metadata: { milestone, action, before, after, scoresFor: [a.id, b.id] } });
    }
  }

  storyline(story, stage) {
    if (!['rivalry', 'grudge_match'].includes(story.type)) return;
    const labels = { started: 'Conflict storyline began', climax: 'Conflict storyline reached its climax',
      concluded: 'Conflict storyline concluded' };
    this.record({ id: `drama:${story.id}:${stage}`, type: 'conflict', description: labels[stage],
      entities: story.participants.map(id => ({kind:'character', id})),
      metadata: { storylineId: story.id, storylineType: story.type, stage } });
  }

  toJSON() { return { version: 1, pairs: this.pairs }; }
}

module.exports = { HistoricalEventIntegration };
