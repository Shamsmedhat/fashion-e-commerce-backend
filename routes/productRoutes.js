const express = require('express');
const productController = require('./../controllers/productController');
const authController = require('./../controllers/authController');
const router = express.Router();

//? Alias
// Alias: Best Selling 6 products
router
  .route('/best-selling')
  .get(productController.aliasBestSelling, productController.getAllProducts);

// Alias: Top Rating 6 products
router.route('/top-rating').get(productController.aliasTopRating, productController.getAllProducts);

router.get(
  '/upload-signature',
  authController.protect,
  authController.restrictTo('admin'),
  productController.getUploadSignature,
);

//? Product
// GET/Create Products
router
  .route('/')
  .get(productController.getAllProducts)
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    productController.createProduct,
  );

// GET/Delete Product
router
  .route('/:id')
  .get(productController.getProduct)
  .delete(
    authController.protect,
    authController.restrictTo('admin'),
    productController.deleteProduct,
  );

// UPDATE Product
router
  .route('/:id')
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    productController.updateProduct,
  );

//? Variants
// GET/Create Products Variants
router
  .route('/:id/variants')
  .get(productController.getProductVariants)
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    productController.createProductVariant,
  );

// Protect
router.use(authController.protect, authController.restrictTo('admin'));

// Update/Delete Product Variant
router
  .route('/:id/variants/:varId')
  .patch(productController.updateProductVariant)
  .delete(productController.deleteProductVariant);

module.exports = router;
