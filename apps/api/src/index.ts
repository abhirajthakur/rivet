import { loadApiEnv } from '@rivet/config';
import app from './app.js';

const env = loadApiEnv();
const server = app.listen(env.PORT);

server.on('error', (error: Error) => {
  console.error('API server failed.', error);
  process.exitCode = 1;
});

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

export { env, server };
