# API server

The API is an Express 5 HTTP service. It validates `NODE_ENV`, `PORT`, and `DATABASE_URL` before opening the listening port.

The server keeps HTTP setup in `src/app.ts`, routes in `src/routes`, shared request handling in `src/middlewares`, and process startup in `src/index.ts`. Add controller, service, and repository layers when task endpoints and persistence are introduced.

Build and run it from `apps/api`:

```sh
pnpm build
pnpm start
```

The `GET /health` endpoint reports that the HTTP process is running. It does not check the database yet; database readiness will be added when persistence is connected. Unknown routes and malformed JSON receive a small JSON error response. Internal errors are logged but not sent to clients.
