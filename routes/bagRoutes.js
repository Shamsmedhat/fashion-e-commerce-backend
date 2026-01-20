const express = require('express');
const bagController = require('./../controllers/bagController');
const authController = require('./../controllers/authController');

const router = express.Router();

// All bag routes require authentication
router.use(authController.protect);

// Get user's bag
router.route('/me').get(bagController.getMyBag);

// Get user's bag items with full details
router.route('/me/items').get(bagController.getMyBagItems);

// Clear all bag items
router.route('/me').delete(bagController.clearBag);

// Update bag item (quantity)
router.route('/me/items/:itemId').patch(bagController.updateBagItem);

// Delete one item from bag
router.route('/me/items/:itemId').delete(bagController.removeBagItem);

module.exports = router;
