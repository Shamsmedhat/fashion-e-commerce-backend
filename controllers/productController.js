const Product = require('./../models/productModel');
const Category = require('./../models/categoryModel');
const ALLOWED_VARIANTS_FIELDS = require('./../lib/constants/allowedVariantsFields');
const APIFeatures = require('./../lib/utils/APIFeatures');
const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');

// Get Top 6 products Selling (Alias)
exports.aliasBestSelling = (req, res, next) => {
  req.query.sort = '-variants.soldCount';
  req.query.limit = '6';
  next();
};

// Get Top 6 products AVG (Alias)
exports.aliasTopRating = (req, res, next) => {
  req.query.sort = '-ratingsAverage';
  req.query.limit = '6';
  next();
};

// Create Product
exports.createProduct = catchAsync(async (req, res, next) => {
  // New variant
  const newVariant = {};

  if (Array.isArray(req.body.variants) && req.body.variants.length > 0) {
    const variant = req.body.variants[0];

    // Allowed variant fields
    ALLOWED_VARIANTS_FIELDS.forEach((el) => {
      if (variant[el] !== undefined) {
        newVariant[el] = variant[el];
      }
    });
  } else {
    return next(new AppError('Variants must be an array!', 400));
  }

  // Build product data
  const productData = {
    ...req.body,
    variants: Object.keys(newVariant).length ? [newVariant] : [],
  };

  const product = await Product.create(productData);

  // REs
  res.status(201).json({
    status: 'success',
    data: {
      product,
    },
  });
});

// Get All Products
exports.getAllProducts = catchAsync(async (req, res, next) => {
  // Get The total number of documents (products)
  const numOfProducts = await Product.countDocuments();

  // Handle mainCategory filter
  let filter = {};

  if (req.query.mainCategory) {
    // Get all subcategory IDs under the main category
    const categories = await Category.find({
      $or: [{ _id: req.query.mainCategory }, { parentId: req.query.mainCategory }],
    }).select('_id');

    const categoryIds = categories.map((cat) => cat._id);
    filter.categoryId = { $in: categoryIds };

    // Remove mainCategory from query string so it doesn't interfere with APIFeatures
    delete req.query.mainCategory;
  }

  // 1) Build the query
  const features = new APIFeatures(Product.find(filter), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  // 2) Excute the query
  // Excute the query after finishing the build
  const products = await features.query;

  // 3) Res
  res.status(200).json({
    status: 'success',
    total: numOfProducts,
    results: products.length,
    data: {
      products,
    },
  });
});

// Get Specific Product
exports.getProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('No product found with this ID!', 404));
  }

  // Res
  res.status(200).json({
    status: 'success',
    data: {
      product,
    },
  });
});

// Update Product
exports.updateProduct = catchAsync(async (req, res, next) => {
  // Define allowed fields
  // TODO: Add images array to update it
  // TODO: Add variants fields
  const allowedFields = ['name', 'description', 'categoryId', 'coverImage'];

  // Store new Data
  const updateData = {};

  // Assign new data for only the allowed fields
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  // If empty updated data
  if (!Object.keys(updateData).length) {
    return next(new AppError('No valid product fields provided to update', 400));
  }

  // Update
  const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  // If there is no product found
  if (!product) {
    return next(new AppError('No product found with this ID', 404));
  }

  // Res
  res.status(200).json({
    status: 'success',
    data: { product },
  });
});

// Delete Product
exports.deleteProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product) {
    return next(new AppError('No product found with this ID', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

//? Variants
// Create Product Variant
exports.createProductVariant = catchAsync(async (req, res, next) => {
  // New data
  let newVariant = {};

  // Allowed variant fields
  ALLOWED_VARIANTS_FIELDS.forEach((el) => {
    if (req.body[el] !== undefined) {
      newVariant[el] = req.body[el];
    }
  });

  // Update product with new variant
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $push: { variants: newVariant } },
    { new: true, runValidators: true },
  );

  // If there is no product found
  if (!product) {
    return next(new AppError('No product found with this ID', 404));
  }

  // Res
  res.status(201).json({
    status: 'success',
    data: product,
  });
});

// Get Product Variants
exports.getProductVariants = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  // If there is no product found
  if (!product) {
    return next(new AppError('No product found with this ID', 404));
  }

  // Res
  res.status(200).json({
    status: 'success',
    data: {
      variants: product.variants,
    },
  });
});

// Update Product Variant
exports.updateProductVariant = catchAsync(async (req, res, next) => {
  // Store new Data
  const newVariant = {};

  // Allowed variant fields
  ALLOWED_VARIANTS_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) {
      newVariant[`variants.$.${field}`] = req.body[field];
    }
  });

  // If empty updated data
  if (!Object.keys(newVariant).length) {
    return next(new AppError('No valid product fields provided to update', 400));
  }

  // Update
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, 'variants._id': req.params.varId },
    { $set: newVariant },
    {
      new: true,
      runValidators: true,
    },
  );

  // If there is no product found
  if (!product) {
    return next(new AppError('No product found with this ID', 404));
  }

  // Res
  res.status(200).json({
    status: 'success',
    data: { product },
  });
});

// Delete Product Variant
exports.deleteProductVariant = catchAsync(async (req, res, next) => {
  // Update (Delete variant)
  // TODO: Make an isActive property for the variant
  const product = await Product.findOneAndUpdate(
    {
      _id: req.params.id,
      'variants._id': req.params.varId,
    },
    {
      $pull: { variants: { _id: req.params.varId } },
    },
    { new: true, runValidators: true },
  );

  // If there is no product found
  if (!product) {
    return next(new AppError('No product variant found with this ID', 404));
  }

  // Res
  res.status(204).json({
    status: 'success',
    data: null,
  });
});
