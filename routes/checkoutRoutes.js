const express = require('express');

const checkoutController = require('./../controllers/checkoutController');
const authController = require('./../controllers/authController');
const { checkoutLimiter } = require('./../lib/utils/rateLimiters');

const router = express.Router();

router.use(authController.protect, checkoutLimiter);

router.route('/card-session').post(checkoutController.createCardCheckoutSession);
router.route('/cash').post(checkoutController.createCashOrder);

module.exports = router;
