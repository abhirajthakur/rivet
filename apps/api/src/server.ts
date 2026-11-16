import { createServer } from 'node:http';
import type { ApiEnv } from '@rivet/config';
import { createApiApp } from './app.js';

export function startApi(env: ApiEnv) {
  const server = createServer(createApiApp());

  server.on('error', (error: Error) => {
    console.error('API server failed.', error);
    process.exitCode = 1;
  });

  server.listen(env.PORT);

  const shutdown = (): void => {
    server.close((error) => {
      if (error) {
        console.error('API server did not close cleanly.', error);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
}
