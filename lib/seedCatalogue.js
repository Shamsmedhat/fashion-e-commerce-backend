const fs = require('fs');
const path = require('path');

const Product = require('../models/productModel');
const Category = require('../models/categoryModel');

const readData = (file) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf-8'));

// The demo catalogue: a snapshot of the live shop (same ids, SKUs and image URLs), so restoring
// it brings back exactly the products the storefront links to.
const importCatalogue = async () => {
  // ordered: true — a child category's pre('save') looks up its parent, so parents go first.
  await Category.create(readData('categories.json'), { ordered: true });
  await Product.create(readData('products.json'));
};

const deleteCatalogue = async () => {
  await Product.deleteMany();
  await Category.deleteMany();
};

module.exports = { deleteCatalogue, importCatalogue };
