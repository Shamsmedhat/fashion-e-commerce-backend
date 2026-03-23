/* eslint-disable no-console */
const fs = require('fs');
const mongoose = require('mongoose');
const Product = require('./models/productModel');
const Category = require('./models/categoryModel');

// config.env
const dotenv = require('dotenv');
dotenv.config({ path: './config.env' });

// Get the moc data from the files(JSON)
const categoryData = JSON.parse(fs.readFileSync(`${__dirname}/data/categories.json`, 'utf-8'));
const productData = JSON.parse(fs.readFileSync(`${__dirname}/data/products.json`, 'utf-8'));

// Connect to DB
const DB = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
mongoose.connect(DB).then(() => console.log('DB connection successful!'));

// Add the data
const importData = async () => {
  try {
    await Category.create(categoryData);
    await Product.create(productData);
    console.log('Data added successfully!');
  } catch (error) {
    console.log(`Something went wrong! /n ${error}`);
  }
  process.exit();
};

// Delete the Data
const deleteData = async () => {
  try {
    await Category.deleteMany();
    await Product.deleteMany();
    console.log('Data deleted successfully!');
  } catch (error) {
    console.log(`Something went wrong! /n ${error}`);
  }
  process.exit();
};

// Trigger the action
if (process.argv[2] === '--import') {
  importData();
} else if (process.argv[2] === '--delete') {
  deleteData();
}
