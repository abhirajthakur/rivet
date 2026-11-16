# AI provider abstraction

`AIProvider` keeps agent code independent of a model vendor. It supports text and schema-validated structured output. `OllamaProvider` is the first adapter and calls the configured Ollama server with Node's built-in `fetch`; this package adds no provider SDK, paid inference dependency, or automatic provider fallback. Configure it to point to your self-hosted Ollama server and an installed model.

```ts
const provider = new OllamaProvider({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_MODEL,
});

const response = await provider.generateText({
  systemPrompt: 'You are a careful software engineering assistant.',
  userPrompt: 'Summarize the package layout.',
  signal,
});
```

Structured calls send the supplied JSON Schema to Ollama and then run the parsed response through the caller's `parse` function. Provider errors omit generated content and carry a stable error code.
