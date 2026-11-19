const { LLMClient } = require('./client');
const { PromptBuilder } = require('./promptBuilder');
const { ResponseParser } = require('./responseParser');
const { DecisionCache } = require('./cache');
const { RequestBudget } = require('./budget');

class LLMBatcher {
  constructor(config, world, stats) {
    this.config = config;
    this.world = world;
    this.stats = stats;
    this.maxBatchSize = config.simulation.maxBatchSize;
    this.budget = new RequestBudget();
    this.client = new LLMClient(config, this.budget);
    this.inFlight = false;
    this.cooldownUntil = 0;
    this.promptBuilder = new PromptBuilder();
    this.parser = new ResponseParser();
    this.cache = new DecisionCache();
    this.enabled = !!(process.env.LLM_BASE_URL);
  }

  decide(decisions) {
    // Decisions always complete locally. A single background request can populate
    // the existing short-lived cache for a later matching situation.
    const results = decisions.map(d => ({ character: d.character,
      ...(this.cache.get(d.character, this.world) || this.generateFallback(d.character)) }));
    const meaningful = decisions.filter(d => d.reason === 'encounter' && !this.cache.get(d.character, this.world));
    if (this.enabled && meaningful.length && !this.inFlight && Date.now() >= this.cooldownUntil && this.budget.available()) {
      this.inFlight = true;
      this.processSingleBatch(meaningful.slice(0, this.maxBatchSize))
        .catch(err => console.warn('Background AI decision failed:', err.message))
        .finally(() => { this.inFlight = false; });
    }
    return results;
  }

  status() {
    const budget = this.budget.status();
    let reason = null;
    if (!this.enabled) reason = 'No AI provider configured';
    else if (budget.error) reason = 'AI budget unavailable';
    else if (!budget.limit) reason = 'AI disabled by daily limit';
    else if (!this.budget.available()) reason = 'Daily AI limit reached';
    else if (Date.now() < this.cooldownUntil) reason = 'AI provider cooling down';
    return { ...budget, enabled: this.enabled, cooldownUntil: this.cooldownUntil, fallbackReason: reason };
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
    const requestTick = this.world.tick;
    const keys = decisions.map(d => this.cache.getKey(d.character, this.world));
    const prompt = this.promptBuilder.buildBatch(decisions, this.world);
    const response = await this.client.complete(prompt.system, prompt.user);

    if (!response) {
      this.cooldownUntil = Date.now() + 60000;
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

    if (this.world.tick - requestTick > this.cache.maxAge) return [];

    const parsed = this.parser.parse(response.content, decisions.length);
    const results = [];

    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      const p = parsed.find(r => r.index === i);

      if (p) {
        const result = { action: p.action, say: p.say, think: p.think, emotion: p.emotion };
        this.cache.setKey(keys[i], requestTick, result);
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
        // A flirtatious resident may develop interest after a warm acquaintance;
        // established attraction also creates an opportunity for anyone.
        const warmAcquaintance = char.personality.includes('flirtatious') &&
          rel.affection >= 6 && (rel.interactionCount || 0) >= 3;
        if ((rel.attraction >= 3 || warmAcquaintance) && Math.random() < 0.3) {
          return {
            action: { type: 'flirt', target: target.id },
            say: null,
            think: `Can't stop thinking about ${target.name}...`,
            emotion: 'infatuated'
          };
        }
        // Existing tension or distrust can lead to an argument.
        if ((rel.trust <= 3.5 || rel.affection <= 3.5) && Math.random() < 0.2) {
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
