/* eslint-disable no-console */
const assert = require('node:assert/strict');
const test = require('node:test');

const AppError = require('../lib/utils/appError');
const errorController = require('../controllers/errorController');

const invokeErrorController = (error) => {
  let statusCode;
  let body;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  errorController(error, {}, response, () => {});
  return { body, statusCode };
};

test('production hides non-operational error details and stack traces', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  process.env.NODE_ENV = 'production';
  console.log = () => {};
  console.error = () => {};

  try {
    const error = new Error('MongoServerError: private database detail');
    error.stack = 'private stack trace';

    const response = invokeErrorController(error);

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      status: 'error',
      message: 'Something went very wrong!',
    });
    assert.equal(response.body.stack, undefined);
    assert.equal(response.body.error, undefined);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
});

test('production returns only the safe message for operational errors', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalConsoleLog = console.log;

  process.env.NODE_ENV = 'production';
  console.log = () => {};

  try {
    const response = invokeErrorController(new AppError('Invalid request.', 400));

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      status: 'fail',
      message: 'Invalid request.',
    });
    assert.equal(response.body.stack, undefined);
    assert.equal(response.body.error, undefined);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    console.log = originalConsoleLog;
  }
});
