import { loadWorkerEnv } from '@rivet/config';
import { OllamaProvider } from '@rivet/ai';

const env = loadWorkerEnv();
const aiProvider = new OllamaProvider({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_MODEL,
});

export { aiProvider, env };
