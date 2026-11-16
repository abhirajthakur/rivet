import type { ErrorRequestHandler } from 'express';

const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'invalid_json',
        message: 'Request body must contain valid JSON.',
      },
    });
    return;
  }

  console.error('Unhandled API error.', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'An unexpected server error occurred.',
    },
  });
};

export default errorHandler;
