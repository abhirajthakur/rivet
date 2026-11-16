import express from 'express';
import errorHandler from './middlewares/error-handler.js';
import routeNotFound from './middlewares/route-not-found.js';
import healthRouter from './routes/health.router.js';

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/health', healthRouter);
app.use(routeNotFound);
app.use(errorHandler);

export default app;
