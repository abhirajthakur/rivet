import { loadApiEnv } from '@rivet/config';
import { startApi } from './server.js';

const env = loadApiEnv();
const server = startApi(env);

export { env, server };
