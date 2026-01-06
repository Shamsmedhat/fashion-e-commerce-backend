const express = require('express');
const productController = require('./../controllers/productController');
const router = express.Router();

//? Alias
// Alias: Best Selling 6 products
router
  .route('/best-selling')
  .get(productController.aliasBestSelling, productController.getAllProducts);

// Alias: Top Rating 6 products
router.route('/top-rating').get(productController.aliasTopRating, productController.getAllProducts);

//? Product
// GET/Create Products
router.route('/').get(productController.getAllProducts).post(productController.createProduct);

// GET/Delete Product
router.route('/:id').get(productController.getProduct).delete(productController.deleteProduct);

// UPDATE Product
router.route('/:id').patch(productController.updateProduct);

//? Variants
// GET/Create Products Variants
router
  .route('/:id/variants')
  .get(productController.getProductVariants)
  .post(productController.createProductVariant);

// UPDATE Product Variant
router
  .route('/:id/variants/:varId')
  .patch(productController.updateProductVariant)
  .delete(productController.deleteProductVariant);

module.exports = router;
