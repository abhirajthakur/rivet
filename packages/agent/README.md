# Agent tool loop

`runAgentToolLoop` implements local function calling. The selected model receives the repository and sandbox tools, returns a tool call, and the worker validates and runs it before sending the result back. All tool calls execute sequentially in the task worker; command calls still run in Docker.

The loop defaults to 8 model turns, 24 tool calls, 3 minutes, 4,096 output tokens per turn, 1 MiB of serialized conversation context, and 64 KiB per tool result. Hard ceilings prevent callers from raising the limits beyond 12 turns, 40 tool calls, 10 minutes, 8,192 output tokens, 4 MiB of context, and 256 KiB per result.

`AgentTaskTools.runToolLoop` binds the selected provider and task tool set, and persists a start record before each tool executes followed by the result. Both records include the task ID and attempt number. If audit persistence fails, the loop stops before executing the tool. Implementations of `TaskStateStore` must persist both records so task activity can be inspected later.

Operations can use the loop with task-specific prompts:

```ts
const result = await tools.runToolLoop({
  systemPrompt: 'Inspect the repository and prepare a concise plan.',
  userPrompt: task.description,
  signal,
});
```

Each provider adapter translates the shared conversation and tool contract to its native function-calling format. Provider or model errors are returned to the caller; the loop does not switch providers automatically.
