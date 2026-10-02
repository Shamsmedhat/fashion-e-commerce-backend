const crypto = require('crypto');
const mongoose = require('mongoose');
const Category = require('./categoryModel');
const {
  InvalidProductImageError,
  isOwnedCloudinaryImageUrl,
  normalizeProductImageUrl,
  normalizeUpdateImageValues,
} = require('../lib/utils/cloudinaryImages');

const cloudinaryImageField = (requiredMessage) => {
  const field = {
    type: String,
    set: normalizeProductImageUrl,
    validate: {
      validator: isOwnedCloudinaryImageUrl,
      message: 'Product images must belong to the configured Cloudinary account.',
    },
  };

  if (requiredMessage) field.required = [true, requiredMessage];
  return field;
};

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, unique: true },
    size: { type: String, enum: ['S', 'M', 'L', 'XL', 'XXL'], default: 'M' },
    color: {
      type: String,
      default: 'white',
      set: function (val) {
        if (!val) return val;
        return val.toLowerCase();
      },
    },
    price: {
      type: Number,
      required: [true, 'Product must have a price!'],
      min: [100, 'Minmum product price must be more than or equal 100 EGP!'],
    },
    // Compared against the price in the pre('validate') hook below.
    priceDiscount: {
      type: Number,
      min: [0, 'Discount price cannot be negative!'],
    },
    soldCount: {
      type: Number,
      default: 0,
    },
    stock: {
      type: Number,
      required: [true, 'Product must have a stock, noting the default is one!'],
      min: [0, 'Stock cannot be negative!'],
      default: 1,
    },
    images: [cloudinaryImageField('Product must have at least one image!')],
  },
  {
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// A field validator only sees the value being set, so changing the price alone would never
// re-check the discount. Validating the pair here covers creating and editing a variant alike.
variantSchema.pre('validate', function () {
  if (this.priceDiscount == null || this.priceDiscount < this.price) return;

  // Reported on the field that changed: a save that validates modified paths only
  // would otherwise drop an error attached to the untouched one.
  const changedPath = this.isNew || this.isModified('priceDiscount') ? 'priceDiscount' : 'price';

  this.invalidate(
    changedPath,
    `Discount price (${this.priceDiscount}) should be below regular price (${this.price})!`,
    this[changedPath],
  );
});

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide the product name!'],
      trim: true,
      minLength: [3, 'Product name must have more than or equal 3 characters!'],
      maxLength: [45, 'Product name must have less than or equal 45 characters!'],
      unique: true,
      set: function (val) {
        if (!val) return val;
        return val.charAt(0).toUpperCase() + val.slice(1);
      },
    },
    description: {
      type: String,
      required: [true, 'Please provide the product description!'],
      trim: true,
      minLength: [12, 'Product description must have more than or equal 12 characters!'],
      maxLength: [255, 'Product description must have less than or equal 255 characters!'],
    },
    categoryId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Category',
      required: [true, 'Please provide the product category!'],
    },
    coverImage: cloudinaryImageField('Product must have a cover image'),
    images: [cloudinaryImageField()],
    variants: [variantSchema],

    // TODO: make it average calc
    ratingsAverage: {
      type: Number,
      min: [1, 'Rating must be above or equal 1'],
      max: [5, 'Rating must be below or equal 5'],
    },

    reviewCount: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    id: false,
  },
);

// Index
productSchema.index({ 'variants.price': 1 });

// Middlewares

// Add variantsNum as virtual
productSchema.virtual('variantsNum').get(function () {
  return this.variants.length;
});

// "men/shoes" -> "MEN-SHO". A main category has a single segment, so it works there too.
const skuPrefix = (category) =>
  (category.path || category.name)
    .split('/')
    .map((segment) => segment.slice(0, 3).toUpperCase())
    .join('-');

const randomSkuSuffix = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

// Create the SKU for every new variant (new product, or a variant added to an existing one).
// A variant that already has a SKU keeps it: bags and orders reference variants by SKU.
productSchema.pre('save', async function () {
  if (this.variants.every((variant) => variant.sku)) return;

  const category = await Category.findById(this.categoryId);

  if (!category) {
    const validationError = new mongoose.Error.ValidationError();
    validationError.addError(
      'categoryId',
      new mongoose.Error.ValidatorError({
        path: 'categoryId',
        message: 'No category found with this ID!',
        value: this.categoryId,
        type: 'user defined',
      }),
    );
    throw validationError;
  }

  const prefix = skuPrefix(category);
  const usedSkus = new Set(this.variants.map((variant) => variant.sku).filter(Boolean));

  this.variants.forEach((variant, i) => {
    if (variant.sku) return;

    const color = (variant.color || 'non').slice(0, 3).toUpperCase();
    const number = String(i + 1).padStart(3, '0');

    let sku;
    do {
      sku = `${prefix}-${color}-${variant.size}-${number}-${randomSkuSuffix()}`;
    } while (usedSkus.has(sku));

    usedSkus.add(sku);
    variant.sku = sku;
  });
});

// Guard image URLs on every update entry point. Mongoose update validators do not run reliably for
// positional operators, so this inspects the update document itself instead of relying on them.
const guardUpdateImages = function () {
  const update = this.getUpdate();
  if (!update) return;

  try {
    this.setUpdate(normalizeUpdateImageValues(update));
  } catch (error) {
    if (!(error instanceof InvalidProductImageError)) throw error;

    const validationError = new mongoose.Error.ValidationError();
    validationError.addError(
      'images',
      new mongoose.Error.ValidatorError({
        path: 'images',
        message: error.message,
        value: error.value,
        type: 'user defined',
      }),
    );
    throw validationError;
  }
};

productSchema.pre(
  ['findOneAndUpdate', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne'],
  { query: true, document: false },
  guardUpdateImages,
);

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
