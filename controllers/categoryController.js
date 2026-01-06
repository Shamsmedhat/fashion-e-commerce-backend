const Category = require('./../models/categoryModel');
const APIFeatures = require('./../lib/utils/APIFeatures');
const mongoose = require('mongoose');
const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');

// Get main categories (Alias)
exports.aliasMainCategories = (req, res, next) => {
  req.query.parentId = null;
  next();
};

// Create Category
exports.createCategory = catchAsync(async (req, res, next) => {
  const category = await Category.create(req.body);

  res.status(201).json({
    status: 'success',
    data: {
      category,
    },
  });
});

// Get All Categories
exports.getAllCategories = catchAsync(async (req, res, next) => {
  // Get The total number of documents (categories)
  const numOfCategories = await Category.countDocuments();

  // 1) Build the query
  const features = new APIFeatures(Category.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  // 2) Excute the query
  // Excute the query after finishing the build
  const categories = await features.query;

  // 3) Res
  res.status(200).json({
    status: 'success',
    total: numOfCategories,
    results: categories.length,
    data: {
      categories,
    },
  });
});

// Get Specific Category
exports.getCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return next(new AppError('No category found with this ID', 404));
  }

  // Res
  res.status(200).json({
    status: 'success',
    data: {
      category,
    },
  });
});

// Get category children
exports.getCategoryChildren = catchAsync(async (req, res, next) => {
  const categories = await Category.find({ parentId: req.params.id });

  // Res
  res.status(200).json({
    status: 'success',
    data: {
      categories,
    },
  });
});

// Update Category
//? With AI help to get the idea of making a transaction
//? When we facing sort of bulk data updated
//? Besniess logic is in the Model
exports.updateCategory = catchAsync(async (req, res, next) => {
  // Start the transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let newData = {};

    // Allowed variant fields
    ['name', 'parentId'].forEach((field) => {
      if (req.body[field] !== undefined) {
        newData[field] = req.body[field];
      }
    });

    // If empty updated data
    if (!Object.keys(newData).length) {
      throw new AppError('No valid fields provided to update', 400);
    }

    const category = await Category.findByIdAndUpdate(req.params.id, newData, {
      new: true,
      runValidators: true,
      session,
    });

    if (!category) throw new AppError('Category not found with this ID!', 404);

    await session.commitTransaction();

    // Res
    res.status(200).json({ status: 'success', data: { category } });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});

// Delete Category
exports.deleteCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findByIdAndUpdate(req.params.id, { isActive: false });

  if (!category) {
    throw new AppError('No category found with this ID', 404);
  }

  // Res
  res.status(204).json({
    status: 'success',
    data: null,
  });
});
