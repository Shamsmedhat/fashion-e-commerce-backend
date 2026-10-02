// Integration-test harness: boots the real Express app against an in-memory MongoDB replica set
// (a replica set, not a standalone server, because signup/checkout/category updates use transactions).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_integration';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration';

const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const supertest = require('supertest');
const cloudinary = require('cloudinary').v2;

const app = require('../app');
const User = require('../models/userModel');
const Category = require('../models/categoryModel');
const Product = require('../models/productModel');
const Bag = require('../models/bagModel');
const Orders = require('../models/ordersModel');

let replSet;

// Image cleanup must never reach the real Cloudinary API from a test run.
const destroyedImages = [];
cloudinary.uploader.destroy = async (publicId) => {
  destroyedImages.push(publicId);
  return { result: 'ok' };
};

const start = async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Unique indexes (email, phone, category path, variant SKU) must exist before the first write.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
};

const stop = async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
};

const reset = async () => {
  destroyedImages.length = 0;
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
};

const api = () => supertest(app);

const imageUrl = (name) =>
  `https://res.cloudinary.com/test-cloud/image/upload/v1/products/${name}.jpg`;

let sequence = 0;
const next = () => {
  sequence += 1;
  return sequence;
};

const PASSWORD = 'Secret@123';

const createUser = async (overrides = {}) => {
  const n = next();
  const user = await User.create({
    name: `User ${n}`,
    email: `user${n}@example.com`,
    phone: `010${String(n).padStart(8, '0')}`,
    password: PASSWORD,
    passwordConfirm: PASSWORD,
    ...overrides,
  });

  // role is not settable through signup, so it is promoted the way an operator would do it.
  if (overrides.role) await User.updateOne({ _id: user._id }, { role: overrides.role });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
};

const createAdmin = () => createUser({ role: 'admin' });

const createCategory = (name, parent) =>
  Category.create({ name, ...(parent && { parentId: parent._id }) });

// men, men/shoes, men/accessories, women, women/shoes
const createCategoryTree = async () => {
  const men = await createCategory('Men');
  const menShoes = await createCategory('Shoes', men);
  const menAccessories = await createCategory('Accessories', men);
  const women = await createCategory('Women');
  const womenShoes = await createCategory('Shoes', women);

  return { men, menShoes, menAccessories, women, womenShoes };
};

const productPayload = (category, overrides = {}) => {
  const n = next();
  return {
    name: `Product ${n}`,
    description: 'A product used by the integration tests',
    categoryId: String(category._id),
    coverImage: imageUrl(`cover-${n}`),
    images: [imageUrl(`gallery-${n}`)],
    variants: [{ size: 'M', color: 'black', price: 500, stock: 5 }],
    ...overrides,
  };
};

const createProduct = (category, overrides = {}) =>
  Product.create(productPayload(category, overrides));

module.exports = {
  PASSWORD,
  api,
  createAdmin,
  createCategory,
  createCategoryTree,
  createProduct,
  createUser,
  destroyedImages,
  imageUrl,
  models: { Bag, Category, Orders, Product, User },
  productPayload,
  reset,
  start,
  stop,
};
