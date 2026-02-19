class LLMClient {
  constructor(config) {
    this.baseUrl = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
    this.model = process.env.LLM_MODEL || 'llama3';
    this.apiKey = process.env.LLM_API_KEY || '';
    this.maxTokens = config.llm.maxTokens;
    this.temperature = config.llm.temperature;
    this.timeout = config.llm.timeout;
    this.maxRetries = config.llm.maxRetries;
  }

  async complete(systemPrompt, userPrompt) {
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: this.maxTokens,
      temperature: this.temperature
    };

    const headers = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://townsim.local',
      'X-Title': 'TownSim'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`LLM API error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || {};

        return {
          content,
          tokensIn: usage.prompt_tokens || 0,
          tokensOut: usage.completion_tokens || 0
        };
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn(`LLM timeout (attempt ${attempt + 1}/${this.maxRetries})`);
        } else {
          console.warn(`LLM error (attempt ${attempt + 1}/${this.maxRetries}):`, err.message);
        }
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    return null;
  }
}

module.exports = { LLMClient };
