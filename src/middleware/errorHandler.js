const errorHandler = (error, req, res, _next) => {
  // Log error details for debugging
  console.error('Error occurred:', {
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    ip: req.ip
  });

  // Default error response
  let statusCode = 500;
  let message = 'Internal server error';
  let details = {};

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error';
    details = { validation: error.message };
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (error.code === 'ENOENT') {
    statusCode = 404;
    message = 'Resource not found';
  } else if (error.code === 'ECONNREFUSED') {
    statusCode = 503;
    message = 'Service unavailable';
    details = { service: 'Database connection failed' };
  } else if (error.message.includes('not found')) {
    statusCode = 404;
    message = error.message;
  } else if (error.message.includes('already exists')) {
    statusCode = 409;
    message = error.message;
  } else if (error.message.includes('unauthorized') || error.message.includes('forbidden')) {
    statusCode = 401;
    message = error.message;
  } else if (error.message.includes('validation failed') || error.message.includes('invalid')) {
    statusCode = 400;
    message = error.message;
  }

  // Construct error response
  const errorResponse = {
    error: message,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method
  };

  // Add details in development mode
  if (process.env.NODE_ENV === 'development') {
    errorResponse.details = details;
    if (error.stack) {
      errorResponse.stack = error.stack;
    }
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

// Handle async errors - wrapper function for async route handlers
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 Not Found handler
const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
    message: `Cannot ${req.method} ${req.path}`
  });
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler
};