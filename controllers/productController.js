const url = require('url');
const Product = require('./../models/productModel');
const Category = require('./../models/categoryModel');
const ALLOWED_VARIANTS_FIELDS = require('./../lib/constants/allowedVariantsFields');
const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');
const APIFeatures = require('./../lib/utils/apiFeatures');
const multer = require('multer');
const sharp = require('sharp');
const addImageUrlsToProduct = require('../lib/utils/addImageUrlsToProducts');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'products',
        resource_type: 'image',
        transformation: [{ quality: 'auto' }, { fetch_format: 'auto' }],
        public_id: `product-${Date.now()}`,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload only images'), false);
  }
};

const upload = multer({ storage: multerStorage, fileFilter: multerFilter });

exports.uploadProductImages = upload.fields([
  { name: 'coverImage', maxCount: 1 },
  {
    name: 'images',
    maxCount: 3,
  },
]);

exports.resizeProductImage = catchAsync(async (req, res, next) => {
  if (!req.files) return next();

  // 1) Process Cover Image
  if (req.files.coverImage && req.files.coverImage[0]) {
    const resizedBuffer = await sharp(req.files.coverImage[0].buffer)
      .resize(1200, 1200)
      .toFormat('jpeg')
      .jpeg({ quality: 90 })
      .toBuffer();

    const result = await uploadToCloudinary(resizedBuffer);
    req.body.coverImage = result.secure_url; // Full URL
  }

  // 2) Process Multiple Images
  if (req.files.images && req.files.images.length > 0) {
    req.body.images = [];

    await Promise.all(
      req.files.images.map(async (file) => {
        const resizedBuffer = await sharp(file.buffer)
          .resize(1200, 1200)
          .toFormat('jpeg')
          .jpeg({ quality: 90 })
          .toBuffer();

        const result = await uploadToCloudinary(resizedBuffer);
        req.body.images.push(result.secure_url);
      }),
    );
  }

  next();
});

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
  // Parse variants if it's a JSON string (from form-data)
  if (typeof req.body.variants === 'string') {
    try {
      req.body.variants = JSON.parse(req.body.variants);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(err);
      return next(new AppError('Invalid variants format. Must be valid JSON.', 400));
    }
  }

  // New variant
  let newVariants = [];

  if (Array.isArray(req.body.variants) && req.body.variants.length > 0) {
    newVariants = req.body.variants.map((variant) => {
      const filteredVariant = {};

      // Allowed variant fields
      ALLOWED_VARIANTS_FIELDS.forEach((el) => {
        if (variant[el] !== undefined) {
          filteredVariant[el] = variant[el];
        }
      });

      return filteredVariant;
    });
  } else {
    return next(new AppError('Variants must be an array!', 400));
  }

  // Build product data
  const productData = {
    name: req.body.name,
    description: req.body.description,
    categoryId: req.body.categoryId,
    // Set by resizeProductImage middleware
    coverImage: req.body.coverImage,
    // Set by resizeProductImage middleware
    images: req.body.images || [],
    variants: newVariants,
  };

  const product = await Product.create(productData);

  // Add full URLs to the response
  const productWithUrls = addImageUrlsToProduct(req, product);

  // Response
  res.status(201).json({
    status: 'success',
    data: {
      product: productWithUrls,
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

  // After getting products, add image URLs
  const productsWithUrls = products.map((product) => addImageUrlsToProduct(req, product));

  // 4) Res
  res.status(200).json({
    status: 'success',
    total: numOfProducts,
    results: products.length,
    data: {
      products: productsWithUrls,
    },
  });
});

// Get Specific Product
exports.getProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError('No product found with this ID!', 404));
  }

  const productWithUrls = addImageUrlsToProduct(req, product);

  // Res
  res.status(200).json({
    status: 'success',
    data: {
      product: productWithUrls,
    },
  });
});

// Update Product
exports.updateProduct = catchAsync(async (req, res, next) => {
  // Define allowed fields (now includes 'images')
  const allowedFields = ['name', 'description', 'categoryId', 'coverImage', 'images'];

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

  // Add full URLs to the response
  const productWithUrls = addImageUrlsToProduct(req, product);

  // Res
  res.status(200).json({
    status: 'success',
    data: { product: productWithUrls },
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
