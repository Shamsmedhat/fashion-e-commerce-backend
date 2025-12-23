const express = require('express');
const categoryController = require('./../controllers/categoryController');

const router = express.Router();

// GET/Create Categories
router.route('/').get(categoryController.getAllCategories).post(categoryController.createCategory);

// GET main Categories (alias)
router
  .route('/main')
  .get(categoryController.aliasMainCategories, categoryController.getAllCategories);

// GET Category
router
  .route('/:id')
  .get(categoryController.getCategory)
  .patch(categoryController.updateCategory)
  .delete(categoryController.deleteCategory);

// GET Category children (alias)
router.route('/children/:id').get(categoryController.getCategoryChildren);

module.exports = router;
