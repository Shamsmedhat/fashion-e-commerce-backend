const rateLimit = require('express-rate-limit');

// Counters live in memory, so each serverless instance enforces its own limit.
// TODO(serverless): Use a shared store such as Upstash Redis for meaningful cross-instance limits.
const createLimiter = ({ message, ...options }) =>
  rateLimit({
    ...options,
    // Same JSON shape as every other API error, so clients can always read `message`.
    message: { status: 'fail', message },
    skip: () => process.env.NODE_ENV === 'test',
  });

// General browsing - Products & Categories
exports.browseLimiter = createLimiter({
  max: 200,
  windowMs: 5 * 60 * 1000, // 5 minutes
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Bag operations (add, update, remove)
exports.bagLimiter = createLimiter({
  max: 30,
  windowMs: 60 * 1000, // 1 minute
  message: 'Too many bag operations, please slow down.',
});

// Signup/login - only failed attempts count
exports.authLimiter = createLimiter({
  max: 5,
  windowMs: 15 * 60 * 1000,
  message: 'Too many authentication attempts, please try again in 15 minutes.',
  skipSuccessfulRequests: true,
});

// General user operations
exports.userLimiter = createLimiter({
  max: 50,
  windowMs: 15 * 60 * 1000,
  message: 'Too many requests, please try again later.',
});
