/* eslint-disable no-console */

const AppError = require('../lib/utils/appError');

// Handle Invalid IDs
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

// Handle Duplicated fields
const handleDuplicatedFieldDB = (err) => {
  const value = err.message.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value.`;

  return new AppError(message, 400);
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

//? Globle ERROR controller that will be sent to Error middleware
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Send errors in dev mode
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);

    // Send errors in prod mode
  } else if (process.env.NODE_ENV === 'production') {
    // Add 3 other formated Operational errors to client
    // we use AppError class to mark them as Operational
    // to send them formated to client
    let error = { ...err };
    if (err.name === 'CastError') error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicatedFieldDB(err);
    if (err.name === 'ValidationError') error = handleValidationDB(err);

    sendErrorProd(error, res);
  }
};
