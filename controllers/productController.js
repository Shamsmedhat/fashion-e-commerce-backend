const url = require('url');
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

    // Removeing mainCategory from query string so it doesn't interfere with APIFeatures
    delete req.query.mainCategory;
  }

  // Extract variant filters from query (e.g., variants.color, variants.size)
  const variantFilters = {};

  // Parse raw query string to handle duplicate keys (e.g., variants.color=white&variants.color=black)
  // Manually parse to collect all values for duplicate keys
  const parsedUrl = url.parse(req.originalUrl || req.url, false);
  const rawQueryParams = {};

  // Get the raw query string (part after ?)
  const queryStringPart = parsedUrl.query || '';

  if (queryStringPart) {
    queryStringPart.split('&').forEach((param) => {
      const equalIndex = param.indexOf('=');
      if (equalIndex !== -1) {
        const key = decodeURIComponent(param.substring(0, equalIndex));
        const value = decodeURIComponent(param.substring(equalIndex + 1));
        if (key && key.startsWith('variants.')) {
          if (!rawQueryParams[key]) {
            rawQueryParams[key] = [];
          }
          rawQueryParams[key].push(value || '');
        }
      }
    });
  }

  // Process variant filters from parsed params
  Object.keys(rawQueryParams).forEach((key) => {
    const variantField = key.replace('variants.', '');
    // Check if it's a valid variant field
    if (ALLOWED_VARIANTS_FIELDS.includes(variantField)) {
      let value = rawQueryParams[key];

      // If only one value, convert to single value (unless it's comma-separated)
      if (value.length === 1 && typeof value[0] === 'string' && !value[0].includes(',')) {
        value = value[0];
      } else if (value.length === 1 && typeof value[0] === 'string' && value[0].includes(',')) {
        // Handle comma-separated single value
        value = value[0].split(',').map((v) => v.trim());
      }
      // Otherwise, value is already an array with multiple values

      // Convert to proper type (string fields: lowercase, numeric fields: convert to number)
      if (variantField === 'color' || variantField === 'size') {
        // String fields - lowercase them
        if (Array.isArray(value)) {
          variantFilters[variantField] = { $in: value.map((v) => v.toLowerCase()) };
        } else {
          variantFilters[variantField] = value.toLowerCase();
        }
      } else {
        // Numeric fields (price, stock, priceDiscount) - convert to numbers
        if (Array.isArray(value)) {
          variantFilters[variantField] = { $in: value.map((v) => Number(v)) };
        } else {
          variantFilters[variantField] = Number(value);
        }
      }
      // Remove from query so it doesn't interfere with APIFeatures
      delete req.query[key];
    }
  });

  // Also check req.query for variant filters that might have been parsed by Express
  // (handles cases where Express might have parsed them differently)
  Object.keys(req.query)
    .filter((key) => key.startsWith('variants.') && !rawQueryParams[key])
    .forEach((key) => {
      const variantField = key.replace('variants.', '');
      if (ALLOWED_VARIANTS_FIELDS.includes(variantField)) {
        let value = req.query[key];

        // Handle multiple values: arrays or comma-separated strings
        if (!Array.isArray(value) && typeof value === 'string' && value.includes(',')) {
          value = value.split(',').map((v) => v.trim());
        } else if (!Array.isArray(value)) {
          value = [value];
        }

        // Convert to proper type
        if (variantField === 'color' || variantField === 'size') {
          if (value.length === 1) {
            variantFilters[variantField] = value[0].toLowerCase();
          } else {
            variantFilters[variantField] = { $in: value.map((v) => v.toLowerCase()) };
          }
        } else {
          if (value.length === 1) {
            variantFilters[variantField] = Number(value[0]);
          } else {
            variantFilters[variantField] = { $in: value.map((v) => Number(v)) };
          }
        }
        delete req.query[key];
      }
    });

  // Build variant filter query for MongoDB
  // Use $elemMatch to find products where at least one variant matches ALL the filters
  if (Object.keys(variantFilters).length > 0) {
    const mongoVariantFilter = {};
    Object.keys(variantFilters).forEach((field) => {
      mongoVariantFilter[field] = variantFilters[field];
    });
    filter['variants'] = { $elemMatch: mongoVariantFilter };
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

  // 3) Filter variants in each product to only include matching variants
  if (Object.keys(variantFilters).length > 0) {
    products.forEach((product) => {
      product.variants = product.variants.filter((variant) => {
        return Object.keys(variantFilters).every((field) => {
          const filterValue = variantFilters[field];
          const variantValue = variant[field];

          if (filterValue && typeof filterValue === 'object' && filterValue.$in) {
            // Handle array of values (e.g., { $in: ['white', 'black'] } or { $in: [100, 200] })
            if (field === 'color' || field === 'size') {
              // String fields - lowercase for comparison
              return filterValue.$in.includes(
                typeof variantValue === 'string' ? variantValue.toLowerCase() : variantValue,
              );
            } else {
              // Numeric fields - compare as numbers
              return filterValue.$in.includes(
                typeof variantValue === 'number' ? variantValue : Number(variantValue),
              );
            }
          } else {
            // Handle single value
            if (field === 'color' || field === 'size') {
              // String fields - lowercase for comparison
              const normalizedFilterValue =
                typeof filterValue === 'string' ? filterValue.toLowerCase() : filterValue;
              const normalizedVariantValue =
                typeof variantValue === 'string' ? variantValue.toLowerCase() : variantValue;
              return normalizedFilterValue === normalizedVariantValue;
            } else {
              // Numeric fields - compare as numbers
              const normalizedFilterValue =
                typeof filterValue === 'number' ? filterValue : Number(filterValue);
              const normalizedVariantValue =
                typeof variantValue === 'number' ? variantValue : Number(variantValue);
              return normalizedFilterValue === normalizedVariantValue;
            }
          }
        });
      });
    });
  }

  // 4) Res
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
