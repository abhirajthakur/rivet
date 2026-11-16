# API server

The API is an Express 5 HTTP service. It validates `NODE_ENV`, `PORT`, and `DATABASE_URL` before opening the listening port.

Build and run it from the repository root:

```sh
pnpm --filter @rivet/api build
node --env-file=.env apps/api/dist/index.js
```

The `GET /health` endpoint reports that the HTTP process is running. It does not check the database yet; database readiness will be added when persistence is connected. Unknown routes and malformed JSON receive a small JSON error response. Internal errors are not sent to clients.
