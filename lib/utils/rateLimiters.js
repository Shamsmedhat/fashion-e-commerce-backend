const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Counters live in memory, so each serverless instance enforces its own limit.
// TODO(serverless): Use a shared store such as Upstash Redis for meaningful cross-instance limits.
const createLimiter = ({ message, ...options }) =>
  rateLimit({
    ...options,
    // Same JSON shape as every other API error, so clients can always read `message`.
    message: { status: 'fail', message },
    skip: () => process.env.NODE_ENV === 'test',
  });

// The storefront calls this API from its own servers, so every shopper arrives from the same
// few IP addresses. Counting by IP alone would let one shopper use up everyone's allowance,
// so each limiter below counts by the narrowest thing that identifies who is calling.

// Authenticated routes (mounted after `protect`): one bucket per account.
const byAccount = (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip));

// Sign-up / login: one bucket per (IP, email or phone), so a mistyped password
// only ever locks out the account it was typed for.
const byCredential = (req) => {
  const { email, phone } = req.body || {};
  const identifier = [email, phone].find((value) => typeof value === 'string') || '';

  return `${ipKeyGenerator(req.ip)}:${identifier.trim().toLowerCase()}`;
};

// General browsing - Products & Categories (public, so counted by IP)
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
  keyGenerator: byAccount,
  message: 'Too many bag operations, please slow down.',
});

// Signup/login - only failed attempts count. Two limits apply together: a strict one per
// account, and a looser one per IP so that guessing across many accounts is still capped.
exports.authLimiter = [
  createLimiter({
    max: 100,
    windowMs: 15 * 60 * 1000,
    message: 'Too many authentication attempts, please try again in 15 minutes.',
    skipSuccessfulRequests: true,
  }),
  createLimiter({
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyGenerator: byCredential,
    message: 'Too many authentication attempts, please try again in 15 minutes.',
    skipSuccessfulRequests: true,
  }),
];

// General user operations
exports.userLimiter = createLimiter({
  max: 50,
  windowMs: 15 * 60 * 1000,
  keyGenerator: byAccount,
  message: 'Too many requests, please try again later.',
});

// Placing orders and starting card payments
exports.checkoutLimiter = createLimiter({
  max: 20,
  windowMs: 15 * 60 * 1000,
  keyGenerator: byAccount,
  message: 'Too many checkout attempts, please try again later.',
});

exports.keyGenerators = { byAccount, byCredential };
