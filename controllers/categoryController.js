const Category = require('./../models/categoryModel');
const APIFeatures = require('../lib/utils/APIFeatures');
const { default: mongoose } = require('mongoose');

// Get main categories (Alias)
exports.aliasMainCategories = (req, res, next) => {
  req.query.parentId = null;
  next();
};

// Create Category
exports.createCategory = async (req, res, next) => {
  try {
    const category = await Category.create(req.body);

    res.status(201).json({
      status: 'success',
      data: {
        category,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Get All Categories
exports.getAllCategories = async (req, res, next) => {
  try {
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

    // No categories
    if (!categories) {
      res.status(404).json({
        status: 'fail',
        message: 'No categories found',
      });
    }

    // 3) Res
    res.status(200).json({
      status: 'success',
      total: numOfCategories,
      results: categories.length,
      data: {
        categories,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Get Specific Category
exports.getCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      res.status(40).json({
        status: 'fail',
        message: 'Category not found',
      });
    }

    // Res
    res.status(200).json({
      status: 'success',
      data: {
        category,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Get category children
exports.getCategoryChildren = async (req, res, next) => {
  try {
    const categories = await Category.find({ parentId: req.params.id });

    if (!categories) {
      res.status(40).json({
        status: 'fail',
        message: 'Categories not found!',
      });
    }

    // Res
    res.status(200).json({
      status: 'success',
      data: {
        categories,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Update Category
//? With AI help to get the idea of making a transaction
//? When we facing sort of bulk data updated
//? Besniess logic is in the Model
exports.updateCategory = async (req, res, next) => {
  // Start the transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  let newData = {};

  // Allowed variant fields
  ['name', 'parentId'].forEach((field) => {
    if (req.body[field] !== undefined) {
      newData[field] = req.body[field];
    }
  });

  // If empty updated data
  if (!Object.keys(newData).length) {
    return res.status(400).json({
      status: 'fail',
      message: 'No valid product fields provided to update',
    });
  }

  try {
    const category = await Category.findByIdAndUpdate(req.params.id, newData, {
      new: true,
      runValidators: true,
      session,
    });

    if (!category) throw new Error('Category not found');

    await session.commitTransaction();

    // Res
    res.status(200).json({ status: 'success', data: { category } });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({
      status: 'fail',
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};

// Delete Category
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, { isActive: false });

    if (!category) {
      res.status(404).json({
        status: 'fail',
        message: 'No category found with this ID',
      });
    }

    // Res
    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};
