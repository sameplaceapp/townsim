const { LLMClient } = require('./client');
const { PromptBuilder } = require('./promptBuilder');
const { ResponseParser } = require('./responseParser');
const { DecisionCache } = require('./cache');

class LLMBatcher {
  constructor(config, world, stats) {
    this.config = config;
    this.world = world;
    this.stats = stats;
    this.maxBatchSize = config.simulation.maxBatchSize;
    this.client = new LLMClient(config);
    this.promptBuilder = new PromptBuilder();
    this.parser = new ResponseParser();
    this.cache = new DecisionCache();
    this.enabled = !!(process.env.LLM_BASE_URL);
  }

  async processBatch(decisions) {
    const results = [];

    // Check cache first
    const uncached = [];
    for (const d of decisions) {
      const cached = this.cache.get(d.character, this.world);
      if (cached) {
        results.push({ character: d.character, ...cached });
      } else {
        uncached.push(d);
      }
    }

    if (uncached.length === 0 || !this.enabled) {
      // No LLM available or all cached - use fallback
      for (const d of uncached) {
        const fallback = this.generateFallback(d.character);
        results.push({ character: d.character, ...fallback });
      }
      return results;
    }

    // Split into batches of maxBatchSize
    for (let i = 0; i < uncached.length; i += this.maxBatchSize) {
      const batch = uncached.slice(i, i + this.maxBatchSize);
      const batchResults = await this.processSingleBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  async processSingleBatch(decisions) {
    const prompt = this.promptBuilder.buildBatch(decisions, this.world);
    const response = await this.client.complete(prompt.system, prompt.user);

    if (!response) {
      // LLM failed - use fallbacks
      return decisions.map(d => ({
        character: d.character,
        ...this.generateFallback(d.character)
      }));
    }

    // Track stats
    this.stats.llmCalls++;
    this.stats.llmTokensIn += response.tokensIn;
    this.stats.llmTokensOut += response.tokensOut;

    const parsed = this.parser.parse(response.content, decisions.length);
    const results = [];

    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      const p = parsed.find(r => r.index === i);

      if (p) {
        const result = { action: p.action, say: p.say, think: p.think, emotion: p.emotion };
        this.cache.set(d.character, this.world, result);
        results.push({ character: d.character, ...result });
      } else {
        results.push({
          character: d.character,
          ...this.generateFallback(d.character)
        });
      }
    }

    return results;
  }

  generateFallback(char) {
    // Enhanced rule-based fallback with dramatic flair
    const hour = this.world.time.hour;
    const nearby = this.world.getCharactersNear(char.pos.x, char.pos.y, 2)
      .filter(c => c.id !== char.id && c.activity !== 'sleep');

    // Social interaction if someone nearby
    if (nearby.length > 0 && char.needs.social > 5) {
      const target = nearby[Math.floor(Math.random() * nearby.length)];
      const rel = char.relationships[target.id];

      // Dramatic interactions based on relationship
      if (rel) {
        // High attraction: flirt
        if (rel.attraction > 5 && Math.random() < 0.3) {
          return {
            action: { type: 'flirt', target: target.id },
            say: null,
            think: `Can't stop thinking about ${target.name}...`,
            emotion: 'infatuated'
          };
        }
        // Low trust: argue
        if (rel.trust < 3 && Math.random() < 0.2) {
          return {
            action: { type: 'argue', target: target.id },
            say: null,
            think: `I don't trust ${target.name}`,
            emotion: 'angry'
          };
        }
        // Target is sad: comfort
        if (target.mood === 'sad' && rel.affection > 5 && Math.random() < 0.4) {
          return {
            action: { type: 'comfort', target: target.id },
            say: `Are you okay, ${target.name}?`,
            think: null,
            emotion: 'content'
          };
        }
      }

      // Default: greet or chat
      const socialAction = Math.random() < 0.5 ? 'greet' : 'chat';
      return {
        action: { type: socialAction, target: target.id },
        say: socialAction === 'greet' ? `Hello, ${target.name}!` : null,
        think: null,
        emotion: null
      };
    }

    // Need-based
    if (char.needs.fun > 6) {
      const funActivities = [
        { action: { type: 'goto', target: 'tavern', then: 'drink' } },
        { action: { type: 'goto', target: 'park', then: 'play' } },
        { action: { type: 'wander' }, emotion: 'content' }
      ];
      if (hour >= 19) {
        funActivities.push({ action: { type: 'stargaze' }, emotion: 'content' });
      }
      const choice = funActivities[Math.floor(Math.random() * funActivities.length)];
      return { say: null, think: null, emotion: null, ...choice };
    }

    if (char.needs.social > 7) {
      return { action: { type: 'goto', target: 'tavern', then: 'drink' }, say: null, think: null, emotion: 'lonely' };
    }

    // Daytime activities
    if (hour >= 7 && hour <= 20) {
      const dayActivities = [
        { action: { type: 'wander' } },
        { action: { type: 'explore' } },
        { action: { type: 'goto', target: 'park', then: 'relax' } }
      ];
      const choice = dayActivities[Math.floor(Math.random() * dayActivities.length)];
      return { say: null, think: null, emotion: null, ...choice };
    }

    // Go home at night
    return { action: { type: 'goto', target: char.home, then: 'relax' }, say: null, think: null, emotion: null };
  }
}

module.exports = { LLMBatcher };
