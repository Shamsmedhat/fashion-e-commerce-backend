const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide the category name!'],
    trim: true,
    minLength: [3, 'Category name must have more than or equal 3 characters!'],
    maxLength: [45, 'Category name must have less than or equal 45 characters!'],
  },
  slug: String,
  path: String,
  parentId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    default: null,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
});

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;
