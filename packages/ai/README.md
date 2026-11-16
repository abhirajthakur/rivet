# AI provider abstraction

`AIProvider` keeps agent code independent of a model vendor. It supports text generation, schema-validated structured output, and provider-independent function-calling turns. The available adapters are:

- `OllamaProvider` for a self-hosted Ollama server.
- `GroqProvider` for Groq's chat-completions API.
- `GeminiProvider` for Google's Gemini `generateContent` API.
- `OpenRouterProvider` for OpenRouter's chat-completions API. It accepts only `openrouter/free` or a model ID ending in `:free` and disables provider fallbacks.

All adapters use Node's built-in `fetch`; this package adds no provider SDK dependency. Hosted provider adapters call only the explicitly selected endpoint and have no automatic cross-provider or paid-model fallback. Groq and Gemini usage can be billed if the account is upgraded to a paid tier, so keep those accounts on their free tiers. OpenRouter free model access is rate limited, and its free endpoint/model policy can change.

The provider tool-turn contract only returns proposed function calls. The application remains responsible for validating and executing each call, and for sending the tool result back in the next conversation turn.

```ts
const provider = new OpenRouterProvider({
  apiKey: env.OPENROUTER_API_KEY,
  model: env.OPENROUTER_MODEL, // openrouter/free or a :free model ID
});

const response = await provider.generateText({
  systemPrompt: 'You are a careful software engineering assistant.',
  userPrompt: 'Summarize the package layout.',
  signal,
});
```

Structured calls send the supplied JSON Schema to Ollama and then run the parsed response through the caller's `parse` function. Provider errors omit generated content and carry a stable error code.
