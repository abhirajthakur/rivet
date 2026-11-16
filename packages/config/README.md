# Server configuration

`@rivet/config` owns the API and worker environment schemas. Import `loadApiEnv` or `loadWorkerEnv` at the start of each server entry point, before creating listeners or workers. Parsing fails immediately with a list of invalid variable names and validation messages; values are not included in the error output.

Required strings are trimmed and reject empty values. `PORT` is validated as an integer from 1 to 65535. Each service requires `NODE_ENV`; the API requires `PORT`, `DATABASE_URL`, and `REDIS_URL`, and the worker requires `DATABASE_URL`, `REDIS_URL`, and `OLLAMA_BASE_URL`.

Node.js can populate `process.env` from a local file with `node --env-file=.env <entrypoint>`. Rivet does not load `.env` files itself and does not depend on `dotenv`.
