const { ACTIONS } = require('../simulation/actions');

const VALID_ACTIONS = new Set(Object.values(ACTIONS));

const VALID_EMOTIONS = new Set([
  'happy', 'sad', 'angry', 'anxious', 'hopeful', 'jealous', 'guilty',
  'proud', 'lonely', 'infatuated', 'grateful', 'bitter', 'excited',
  'content', 'fearful'
]);

class ResponseParser {
  parse(responseText, characterCount) {
    const results = [];
    const lines = responseText.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const match = line.match(/\[A(\d+)\](.*)/);
      if (!match) continue;

      const index = parseInt(match[1]) - 1;
      const content = match[2].trim();

      if (index < 0 || index >= characterCount) continue;

      const parsed = this.parseLine(content);
      results.push({ index, ...parsed });
    }

    return results;
  }

  parseLine(content) {
    const result = {
      action: { type: 'idle' },
      say: null,
      think: null,
      emotion: null
    };

    const segments = content.split('|');
    for (const seg of segments) {
      const colonIdx = seg.indexOf(':');
      if (colonIdx === -1) continue;

      const key = seg.slice(0, colonIdx).trim().toUpperCase();
      const value = seg.slice(colonIdx + 1).trim();

      switch (key) {
        case 'ACT': {
          const [actionType, ...targetParts] = value.split(',');
          const type = actionType.trim().toLowerCase();
          const target = targetParts.join(',').trim().toLowerCase() || null;

          if (VALID_ACTIONS.has(type)) {
            result.action = { type, target };
            // BUG-14: Infer 'then' action for goto based on destination
            if (type === 'goto' && target) {
              result.action.then = this.inferThenAction(target);
            }
          }
          break;
        }
        case 'SAY':
          result.say = value.slice(0, 100); // Cap length
          break;
        case 'THINK':
          result.think = value.slice(0, 60);
          break;
        case 'EMO': {
          const emo = value.trim().toLowerCase();
          if (VALID_EMOTIONS.has(emo)) {
            result.emotion = emo;
          }
          break;
        }
      }
    }

    return result;
  }

  // BUG-14: Infer what to do upon arrival at a building
  inferThenAction(target) {
    const inferMap = {
      tavern: 'drink',
      bakery: 'eat',
      general_store: 'shop',
      church: 'pray',
      park: 'relax',
      farm: 'work',
      smithy: 'work',
      carpentry: 'work',
      clinic: 'relax',
      library: 'think',
      school: 'work',
      docks: 'fish',
      herb_shop: 'shop',
      workshop: 'craft',
      guardpost: 'work'
    };
    // If the target matches a known building, infer activity
    if (inferMap[target]) return inferMap[target];
    // If it looks like a home (e.g. "alice_home"), infer relax
    if (target.includes('home') || target.includes('house')) return 'relax';
    return 'idle';
  }
}

module.exports = { ResponseParser };
