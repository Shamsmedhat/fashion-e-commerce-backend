const express = require('express');
const authController = require('./../controllers/authController');
const bagController = require('./../controllers/bagController');
const userController = require('./../controllers/userController');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Auth limiter for signup/login
const authLimiter = rateLimit({
  max: 5,
  windowMs: 15 * 60 * 1000,
  message: 'Too many authentication attempts, please try again in 15 minutes.',
  skipSuccessfulRequests: true,
});

// Bag limiter for add to bag
const bagLimiter = rateLimit({
  max: 30,
  windowMs: 60 * 1000,
  message: 'Too many bag operations, please slow down.',
});

// General user operations limiter
const userLimiter = rateLimit({
  max: 50,
  windowMs: 15 * 60 * 1000,
  message: 'Too many requests, please try again later.',
});

// Auth routes with strict limiting
router.route('/signup').post(authLimiter, authController.signup);
router.route('/login').post(authLimiter, authController.login);
router.route('/logout').get(userLimiter, authController.logout);

// Current authenticated user (used by the storefront to verify admin before revalidating)
router.route('/me').get(userLimiter, authController.protect, userController.getMe);

// Add to bag (requires authentication)
// Bag route with separate limiting
router.route('/bag/add').post(bagLimiter, authController.protect, bagController.addToBag);

module.exports = router;
