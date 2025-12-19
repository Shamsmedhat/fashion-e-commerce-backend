const express = require('express');
const productController = require('../controllers/productController');
const router = express.Router();

//? Alias
// Alias: Best Selling 6 products
router
  .route('/best-selling')
  .get(productController.aliasBestSelling, productController.getAllProducts);

// Alias: Top Rating 6 products
router.route('/top-rating').get(productController.aliasTopRating, productController.getAllProducts);

//? Product
// GET All Products
router.route('/').get(productController.getAllProducts).post(productController.createProduct);

// GET Product
router.route('/:id').get(productController.getProduct);

// UPDATE Product
router.route('/:id').patch(productController.updateProduct);

//? Variants
// GET Products Variants
router.route('/:id/variants').get(productController.getProductVariants);

// UPDATE Product Variant
router.route('/:id/variants/:varId').patch(productController.updateProductVariant);

module.exports = router;
