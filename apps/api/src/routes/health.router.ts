import { Router } from 'express';

const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  // This checks that the HTTP process is running; database readiness comes with persistence.
  res.status(200).json({ status: 'ok' });
});

export default healthRouter;
