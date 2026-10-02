const express = require('express');
const authController = require('./../controllers/authController');
const bagController = require('./../controllers/bagController');
const userController = require('./../controllers/userController');
const { authLimiter, bagLimiter, userLimiter } = require('./../lib/utils/rateLimiters');

const router = express.Router();

// Auth routes with strict limiting
router.route('/signup').post(authLimiter, authController.signup);
router.route('/login').post(authLimiter, authController.login);
router.route('/logout').get(userLimiter, authController.logout);

// Current authenticated user (used by the storefront to verify admin before revalidating)
router.route('/me').get(authController.protect, userLimiter, userController.getMe);

// Delivery addresses of the authenticated user
router
  .route('/me/addresses')
  .post(authController.protect, userLimiter, userController.addMyAddress);

// Add to bag (requires authentication)
// Authenticated routes run `protect` first so their limits are counted per account
router.route('/bag/add').post(authController.protect, bagLimiter, bagController.addToBag);

module.exports = router;
