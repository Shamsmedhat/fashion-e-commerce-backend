const express = require('express');
const categoryController = require('./../controllers/categoryController');

const router = express.Router();

// GET Categories
router.route('/').get(categoryController.getAllCategories);
router
  .route('/main')
  .get(categoryController.aliasMainCategories, categoryController.getAllCategories);

module.exports = router;
