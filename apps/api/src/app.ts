import express, { type ErrorRequestHandler } from 'express';

export function createApiApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    // This is a liveness check. Database readiness belongs here once persistence is connected.
    response.status(200).json({ status: 'ok' });
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'not_found',
        message: 'Route not found.',
      },
    });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({
        error: {
          code: 'invalid_json',
          message: 'Request body must contain valid JSON.',
        },
      });
      return;
    }

    console.error('Unhandled API error.', error);
    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected server error occurred.',
      },
    });
  };

  app.use(handleError);

  return app;
}
