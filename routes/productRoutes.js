const express = require('express');
const productController = require('../controllers/productController');
const router = express.Router();

// GET All Products
router.route('/').get(productController.getAllProducts);

module.exports = router;
