import { loadWorkerEnv } from '@rivet/config';
import { GeminiProvider, GroqProvider, OllamaProvider, OpenRouterProvider } from '@rivet/ai';

const env = loadWorkerEnv();
const aiProvider = (() => {
  switch (env.AI_PROVIDER) {
    case 'ollama':
      return new OllamaProvider({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL });
    case 'groq':
      return new GroqProvider({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL });
    case 'gemini':
      return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
    case 'openrouter':
      return new OpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL,
      });
  }
})();

export { aiProvider, env };
