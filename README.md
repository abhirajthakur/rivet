# Rivet

Rivet is a local-first AI software engineering agent. It inspects a repository, plans a bounded change, edits code in an isolated workspace, runs checks, and prepares a reviewable pull request using free or local model inference only.

## Repository layout

- `apps/api` — Express HTTP API (next implementation milestone)
- `apps/worker` — background task worker (later milestone)
- `packages/agent` — single-agent orchestration and lifecycle
- `packages/ai` — provider abstraction and self-hosted model adapters
- `packages/config` — validated server environment configuration
- `packages/contracts` — shared request, response, and task schemas
- `packages/database` — persistence and migrations
- `packages/github` — GitHub integration
- `packages/sandbox` — isolated workspaces and command execution
- `packages/tools` — validated tools exposed to the agent
- `packages/tsconfig` — shared TypeScript compiler configurations

## Requirements

- Node.js 22 or newer
- pnpm 12.21.0 (run through Corepack)

## Setup

```sh
pnpm install
```

## Commit messages

Commits follow Conventional Commits. Use a short area scope where useful:

```text
feat(agent): persist plan steps
fix(sandbox): enforce command timeouts
chore(repo): configure linting
```

The `commit-msg` hook validates each commit message.

## Environment configuration

Server environment variables are validated by `@rivet/config` with Zod before API or worker startup. Required values are trimmed and rejected when missing or empty. Copy `.env.example` to `.env` for local development. Node.js loads the file with its native `--env-file=.env` option; Rivet does not use `dotenv`.

The API requires `NODE_ENV`, `PORT`, and `DATABASE_URL`. The worker requires `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL`.

## Agent workspace tools

The task runner receives a managed `workspacePath` and an injected `AIProvider`. Its initialization operation prepares the workspace; planning, execution, testing, and review receive the provider, while planning, execution, and testing also receive task-scoped repository readers, hash-checked file editors, and `runCommand`. The worker constructs the Ollama adapter from `OLLAMA_BASE_URL` and `OLLAMA_MODEL`. Commands run through the Docker sandbox described in `packages/sandbox/README.md`. The workspace manager must provide a disposable directory for each task attempt.
