const express = require('express');
const authController = require('./../controllers/authController');
const bagController = require('./../controllers/bagController');
const router = express.Router();

router.route('/signup').post(authController.signup);
router.route('/login').post(authController.login);
router.route('/logout').get(authController.logout);

// Add to bag (requires authentication)
router.route('/bag/add').post(authController.protect, bagController.addToBag);

module.exports = router;
