/* eslint-disable no-console */

const AppError = require('./../lib/utils/appError');

// Handle Invalid IDs
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

// Handle Duplicated fields
const handleDuplicatedFieldDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];

  const fieldMessages = {
    email: `The email "${value}" is already registered. Please use another email or log in.`,
    phone: `The phone number "${value}" is already in use. Please use a different number.`,
  };

  const message =
    fieldMessages[field] ?? `The ${field} "${value}" is already in use. Please use another value.`;

  return new AppError(message, 409);
};

// Handle Invalid Fields (validation erros)
const handleValidationDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input: ${errors.join('. ')}`;

  return new AppError(message, 400);
};

// Error formate in Development
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

// Error formate in Production
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });

    // Programming or other unkown error: don't leak error details
  } else {
    // 1. Log the error
    console.error('Error 💥', err);

    // 2. Send a generic message
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!',
    });
  }
};

// Handle invalid / expired JWTs (the client must log in again)
const handleJWTError = () => new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

// Handle malformed requests rejected before they reach a controller
const handleBodyParseError = () => new AppError('Request body is not valid JSON.', 400);

const handleBodyTooLargeError = () => new AppError('Request body is too large.', 413);

const handleMalformedUrl = () => new AppError('Request URL is malformed.', 400);

//? Globle ERROR controller that will be sent to Error middleware
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Send errors in dev mode
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);

    // Every other environment gets the safe production format, so a missing NODE_ENV can never
    // leave a request without a response.
  } else {
    // Translate the known library errors into Operational errors;
    // we use AppError class to mark them as Operational
    // to send them formated to client

    // Logging the error for better debugging
    if (process.env.NODE_ENV !== 'test') console.log('ERROR LOG:', err);

    let error = { ...err, message: err.message };
    if (err.name === 'CastError') error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicatedFieldDB(err);
    if (err.name === 'ValidationError') error = handleValidationDB(err);
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (err.type === 'entity.parse.failed') error = handleBodyParseError();
    if (err.type === 'entity.too.large') error = handleBodyTooLargeError();
    if (err instanceof URIError) error = handleMalformedUrl();

    sendErrorProd(error, res);
  }
};
