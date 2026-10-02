const Product = require('./../models/productModel');
const Category = require('./../models/categoryModel');
const ALLOWED_VARIANTS_FIELDS = require('./../lib/constants/allowedVariantsFields');
const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');
const APIFeatures = require('./../lib/utils/apiFeatures');
const {
  createUploadSignature,
  destroyPublicIds,
  getPublicIds,
} = require('./../lib/utils/cloudinaryImages');

const getProductImageUrls = (product) => {
  if (!product) return [];

  return [
    product.coverImage,
    ...(product.images || []),
    ...(product.variants || []).flatMap((variant) => variant.images || []),
  ].filter(Boolean);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The same Cloudinary asset can be referenced by more than one product, and a stored URL may use
// either the legacy or the current transformation prefix, so assets are matched by public id.
const findPublicIdsReferencedElsewhere = async (publicIds, excludeProductId) => {
  const patterns = publicIds.map(
    (publicId) => new RegExp(`/${escapeRegExp(publicId)}\\.[A-Za-z0-9]+$`),
  );

  const filter = {
    $or: [
      { coverImage: { $in: patterns } },
      { images: { $in: patterns } },
      { 'variants.images': { $in: patterns } },
    ],
  };
  if (excludeProductId) filter._id = { $ne: excludeProductId };

  const others = await Product.find(filter).select('coverImage images variants.images').lean();
  return new Set(getPublicIds(others.flatMap(getProductImageUrls)));
};

// Deletes only assets that no product still points at. If the reference check itself fails we keep
// the asset: leaking a file costs quota, but deleting a shared one breaks the live storefront.
const destroyUnreferencedImages = async (candidateUrls, retainingProduct, excludeProductId) => {
  const retainedPublicIds = new Set(getPublicIds(getProductImageUrls(retainingProduct)));
  const candidatePublicIds = getPublicIds(candidateUrls).filter(
    (publicId) => !retainedPublicIds.has(publicId),
  );

  if (!candidatePublicIds.length) return;

  try {
    const referencedElsewhere = await findPublicIdsReferencedElsewhere(
      candidatePublicIds,
      excludeProductId,
    );

    await destroyPublicIds(
      candidatePublicIds.filter((publicId) => !referencedElsewhere.has(publicId)),
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Skipped Cloudinary cleanup, reference check failed: ${error.message}`);
  }
};

exports.getUploadSignature = (req, res, next) => {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return next(new AppError('Cloudinary uploads are not configured.', 500));
  }

  res.status(200).json({
    status: 'success',
    data: createUploadSignature(),
  });
};

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

// Variant fields a client may filter the catalogue by, with how their values are stored.
const VARIANT_FILTERS = {
  color: (value) => value.toLowerCase(),
  size: (value) => value.toUpperCase(),
  price: Number,
  stock: Number,
  priceDiscount: Number,
};

const FILTERABLE_FIELDS = [
  'name',
  'categoryId',
  'ratingsAverage',
  'reviewCount',
  'createdAt',
  'variants.price',
  'variants.stock',
];

const SORTABLE_FIELDS = [
  'name',
  'createdAt',
  'ratingsAverage',
  'reviewCount',
  'variants.price',
  'variants.stock',
  'variants.soldCount',
];

// Keep only the variant fields a client is allowed to write.
const pickVariantFields = (source) => {
  const variant = {};

  ALLOWED_VARIANTS_FIELDS.forEach((field) => {
    if (source[field] !== undefined) variant[field] = source[field];
  });

  return variant;
};

// Reads the variants.<field> filters. Repeated keys (variants.color=white&variants.color=black)
// and comma-separated values both mean "any of these", so the raw query string is parsed here:
// Express collapses repeated keys differently depending on how many there are.
const parseVariantFilters = (req) => {
  const [, queryString = ''] = (req.originalUrl || req.url || '').split('?');
  const params = new URLSearchParams(queryString);
  const filters = {};

  Object.entries(VARIANT_FILTERS).forEach(([field, normalize]) => {
    const values = params
      .getAll(`variants.${field}`)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)
      .map(normalize);

    if (!values.length) return;

    if (values.some((value) => Number.isNaN(value))) {
      throw new AppError(`Filter "variants.${field}" must be a number.`, 400);
    }

    filters[field] = values.length === 1 ? values[0] : { $in: values };
  });

  return filters;
};

const variantMatchesFilters = (variant, filters) =>
  Object.entries(filters).every(([field, expected]) =>
    expected.$in ? expected.$in.includes(variant[field]) : expected === variant[field],
  );

// Create Product
exports.createProduct = catchAsync(async (req, res, next) => {
  if (!Array.isArray(req.body.variants) || req.body.variants.length === 0) {
    return next(new AppError('Variants must be a non-empty array!', 400));
  }

  // Build product data
  const productData = {
    name: req.body.name,
    description: req.body.description,
    categoryId: req.body.categoryId,
    coverImage: req.body.coverImage,
    images: req.body.images || [],
    variants: req.body.variants.map((variant) => pickVariantFields(variant || {})),
  };

  const product = await Product.create(productData);

  // Response
  res.status(201).json({
    status: 'success',
    data: {
      product,
    },
  });
});

// Get All Products
exports.getAllProducts = catchAsync(async (req, res, next) => {
  const filter = {};

  // Handle mainCategory filter: the category itself plus its direct subcategories
  if (req.query.mainCategory !== undefined) {
    if (typeof req.query.mainCategory !== 'string') {
      return next(new AppError('Invalid filter for "mainCategory".', 400));
    }

    const categories = await Category.find({
      $or: [{ _id: req.query.mainCategory }, { parentId: req.query.mainCategory }],
    }).select('_id');

    filter.categoryId = { $in: categories.map((cat) => cat._id) };
  }

  // Use $elemMatch to find products where at least one variant matches ALL the variant filters
  const variantFilters = parseVariantFilters(req);
  const hasVariantFilters = Object.keys(variantFilters).length > 0;

  if (hasVariantFilters) filter.variants = { $elemMatch: variantFilters };

  // 1) Build the query
  const features = new APIFeatures(Product.find(filter), req.query, {
    filterableFields: FILTERABLE_FIELDS,
    sortableFields: SORTABLE_FIELDS,
  })
    .filter()
    .sort()
    .limitFields();

  // Total counts every product matching the filters, not just the current page
  const numOfProducts = await Product.countDocuments(features.query.getFilter());

  // 2) Excute the query
  // Excute the query after finishing the build
  const products = await features.paginate().query;

  // 3) Filter variants in each product to only include matching variants
  if (hasVariantFilters) {
    products.forEach((product) => {
      product.variants = product.variants.filter((variant) =>
        variantMatchesFilters(variant, variantFilters),
      );
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

  const existingProduct = await Product.findById(req.params.id);
  if (!existingProduct) {
    return next(new AppError('No product found with this ID', 404));
  }

  if (
    updateData.categoryId !== undefined &&
    !(await Category.exists({ _id: updateData.categoryId }))
  ) {
    return next(new AppError('No category found with this ID!', 400));
  }

  const replacedImageUrls = [];
  if (updateData.coverImage !== undefined) replacedImageUrls.push(existingProduct.coverImage);
  if (updateData.images !== undefined) replacedImageUrls.push(...existingProduct.images);

  // Update
  const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
    returnDocument: 'after',
    runValidators: true,
  });

  await destroyUnreferencedImages(replacedImageUrls, product, product._id);

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

  await destroyUnreferencedImages(getProductImageUrls(product), null, product._id);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

//? Variants
// Variants are edited through the loaded document (not an update operator) so the schema
// validators run with the real variant: a discount is always checked against its price,
// and the SKU hook only fills in SKUs that are missing.

// Create Product Variant
exports.createProductVariant = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  // If there is no product found
  if (!product) {
    return next(new AppError('No product found with this ID', 404));
  }

  product.variants.push(pickVariantFields(req.body));
  await product.save({ validateModifiedOnly: true });

  // Res
  res.status(201).json({
    status: 'success',
    data: { product },
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
  const newVariant = pickVariantFields(req.body);

  // If empty updated data
  if (!Object.keys(newVariant).length) {
    return next(new AppError('No valid product fields provided to update', 400));
  }

  const product = await Product.findById(req.params.id);
  const variant = product?.variants.id(req.params.varId);

  // If there is no product found
  if (!variant) {
    return next(new AppError('No product found with this ID', 404));
  }

  const replacedImageUrls = newVariant.images !== undefined ? [...variant.images] : [];

  // null clears an optional field (e.g. removing a discount)
  Object.entries(newVariant).forEach(([field, value]) => {
    variant[field] = value === null ? undefined : value;
  });

  await product.save({ validateModifiedOnly: true });

  await destroyUnreferencedImages(replacedImageUrls, product, product._id);

  // Res
  res.status(200).json({
    status: 'success',
    data: { product },
  });
});

// Delete Product Variant
exports.deleteProductVariant = catchAsync(async (req, res, next) => {
  const existingProduct = await Product.findById(req.params.id);
  const removedVariant = existingProduct?.variants.id(req.params.varId);

  // If there is no product found
  if (!removedVariant) {
    return next(new AppError('No product variant found with this ID', 404));
  }

  // A product without variants has no price or stock, so it could never be sold.
  if (existingProduct.variants.length === 1) {
    return next(new AppError('A product must keep at least one variant!', 400));
  }

  const removedImageUrls = [...removedVariant.images];

  // Update (Delete variant)
  // The filter repeats the "more than one variant" check so two concurrent deletes cannot empty it.
  const product = await Product.findOneAndUpdate(
    {
      _id: req.params.id,
      'variants._id': req.params.varId,
      'variants.1': { $exists: true },
    },
    {
      $pull: { variants: { _id: req.params.varId } },
    },
    { returnDocument: 'after' },
  );

  if (!product) {
    return next(new AppError('No product variant found with this ID', 404));
  }

  await destroyUnreferencedImages(removedImageUrls, product, product._id);

  // Res
  res.status(204).json({
    status: 'success',
    data: null,
  });
});
