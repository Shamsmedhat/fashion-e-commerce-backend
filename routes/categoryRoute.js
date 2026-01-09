const express = require('express');
const categoryController = require('./../controllers/categoryController');
const authController = require('./../controllers/authController');

const router = express.Router();

// GET/Create Categories
router
  .route('/')
  .get(categoryController.getAllCategories)
  .post(
    authController.protect,
    authController.restrictTo('admin'),
    categoryController.createCategory,
  );

// GET main Categories (alias)
router
  .route('/main')
  .get(categoryController.aliasMainCategories, categoryController.getAllCategories);

// GET/Update/Delete Category
router
  .route('/:id')
  .get(categoryController.getCategory)
  .patch(
    authController.protect,
    authController.restrictTo('admin'),
    categoryController.updateCategory,
  )
  .delete(
    authController.protect,
    authController.restrictTo('admin'),
    categoryController.deleteCategory,
  );

// GET Category children (alias)
router.route('/children/:id').get(categoryController.getCategoryChildren);

module.exports = router;
