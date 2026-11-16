# Rivet

Rivet is a local-first AI software engineering agent. It inspects a repository, plans a bounded change, edits code in an isolated workspace, runs checks, and prepares a reviewable pull request using free or local model inference only.

## Repository layout

- `apps/api` — Express HTTP API (next implementation milestone)
- `apps/worker` — background task worker (later milestone)
- `packages/agent` — single-agent orchestration and lifecycle
- `packages/ai` — provider abstraction and free/local model adapters
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
git init
corepack enable
corepack pnpm install
```

## Commit messages

Commits follow Conventional Commits. Use a short area scope where useful:

```text
feat(agent): persist plan steps
fix(sandbox): enforce command timeouts
chore(repo): configure linting
```

The `commit-msg` hook validates each commit message.
