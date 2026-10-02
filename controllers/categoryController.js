const Category = require('./../models/categoryModel');
const Product = require('./../models/productModel');
const mongoose = require('mongoose');
const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');
const APIFeatures = require('./../lib/utils/apiFeatures');

const FILTERABLE_FIELDS = ['name', 'slug', 'path', 'parentId'];
const SORTABLE_FIELDS = ['name', 'slug', 'path', 'createdAt'];

// Only these fields may be written by a client; slug and path are always derived from them.
const pickCategoryFields = (body) => {
  const fields = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') throw new AppError('Category name must be a string!', 400);
    fields.name = body.name;
  }

  if (body.parentId !== undefined) {
    if (body.parentId !== null && typeof body.parentId !== 'string') {
      throw new AppError('parentId must be a category ID or null!', 400);
    }
    // null (or an empty value) means "main category".
    fields.parentId = body.parentId || null;
  }

  return fields;
};

// Get main categories (Alias)
exports.aliasMainCategories = (req, res, next) => {
  req.query.parentId = null;
  next();
};

// Create Category
exports.createCategory = catchAsync(async (req, res, next) => {
  const category = await Category.create(pickCategoryFields(req.body));

  res.status(201).json({
    status: 'success',
    data: {
      category,
    },
  });
});

// Get All Categories
exports.getAllCategories = catchAsync(async (req, res, next) => {
  // 1) Build the query
  const features = new APIFeatures(Category.find(), req.query, {
    filterableFields: FILTERABLE_FIELDS,
    sortableFields: SORTABLE_FIELDS,
  })
    .filter()
    .sort()
    .limitFields();

  // Total counts every category matching the filters, not just the current page
  const numOfCategories = await Category.countDocuments(features.query.getFilter());

  // 2) Excute the query
  // Excute the query after finishing the build
  const categories = await features.paginate().query;

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
  const newData = pickCategoryFields(req.body);

  // If empty updated data
  if (!Object.keys(newData).length) {
    return next(new AppError('No valid fields provided to update', 400));
  }

  // Start the transaction
  const session = await mongoose.startSession();

  try {
    let category;

    // Renaming or moving a category rewrites the path of every subcategory;
    // the transaction keeps the tree consistent if any of those writes fails.
    await session.withTransaction(async () => {
      category = await Category.findByIdAndUpdate(req.params.id, newData, {
        returnDocument: 'after',
        runValidators: true,
        session,
      });
    });

    if (!category) return next(new AppError('Category not found with this ID!', 404));

    // Res
    res.status(200).json({ status: 'success', data: { category } });
  } finally {
    await session.endSession();
  }
});

// Delete Category
exports.deleteCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return next(new AppError('No category found with this ID', 404));
  }

  // Deleting a category that is still in use would orphan its subcategories or products.
  const [hasChildren, hasProducts] = await Promise.all([
    Category.exists({ parentId: category._id }),
    Product.exists({ categoryId: category._id }),
  ]);

  if (hasChildren) {
    return next(
      new AppError('This category still has subcategories. Move or delete them first.', 409),
    );
  }

  if (hasProducts) {
    return next(new AppError('This category still has products. Move or delete them first.', 409));
  }

  await category.deleteOne();

  // Res
  res.status(204).json({
    status: 'success',
    data: null,
  });
});
