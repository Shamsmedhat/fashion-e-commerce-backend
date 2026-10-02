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
router.route('/me').get(userLimiter, authController.protect, userController.getMe);

// Delivery addresses of the authenticated user
router
  .route('/me/addresses')
  .post(userLimiter, authController.protect, userController.addMyAddress);

// Add to bag (requires authentication)
// Bag route with separate limiting
router.route('/bag/add').post(bagLimiter, authController.protect, bagController.addToBag);

module.exports = router;
