import type { RequestHandler } from 'express';

const routeNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'Route not found.',
    },
  });
};

export default routeNotFound;
