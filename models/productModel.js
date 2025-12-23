const mongoose = require('mongoose');
const Category = require('./categoryModel');

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, unique: true },
    size: { type: String, enum: ['S', 'M', 'L', 'XL', 'XXL'], default: 'M' },
    color: String,
    price: {
      type: Number,
      required: [true, 'Product must have a price!'],
      min: [100, 'Minmum product price must be more than or equal 100 EGP!'],
    },
    priceDiscount: {
      type: Number,
      validate: {
        validator: function (val) {
          // this only points to current doc on NEW document creation
          return val < this.price;
        },
        message: 'Discount price ({VALUE}) should ve below regular price!',
      },
    },
    soldCount: {
      type: Number,
      default: 0,
    },
    stock: {
      type: Number,
      required: [true, 'Product must have a stock, noting the default is one!'],
      default: 1,
    },
  },
  {
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide the product name!'],
      trim: true,
      minLength: [3, 'Product name must have more than or equal 3 characters!'],
      maxLength: [45, 'Product name must have less than or equal 45 characters!'],
      set: function (val) {
        if (!val) return val;
        return val.chartAt(0).toUpperCase() + val.slice(1);
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
    coverImage: { type: String, required: [true, 'Product must have a cover image'] },
    images: [String],
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

    isActive: { type: Boolean, select: false, default: true },
    createdAt: {
      type: Date,
      default: Date.now(),
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    id: false,
  },
);

productSchema.index({ 'variants.price': 1 });

// Middlewares

// Add variantsNum as virtual
productSchema.virtual('variantsNum').get(function () {
  return this.variants.length;
});

// Create the SKU when i add a new product
productSchema.pre('save', async function () {
  // Make sure data is exist
  if (!this.isModified('variants') && !this.isModified('categoryId')) return;
  if (!this.categoryId) return;

  // Get category with parent data
  const category = await Category.findById(this.categoryId).populate('parentId');

  // Check for data
  if (!category || !category.parentId) {
    throw new Error('Category or parent category not found');
  }

  // Define the SKU units
  const categoryName = category.name.slice(0, 3).toUpperCase();
  const parentCategoryName = category.parentId.name.slice(0, 3).toUpperCase();

  // Create SKU
  this.variants.forEach((variant, i) => {
    const color = variant.color.slice(0, 3).toUpperCase();
    const number = String(i + 1).padStart(3, '0');
    //!Warning: Possible error if we get the same data and same last 4 id chars
    const uniqueNum = Date.now().toString().slice(-4);

    variant.sku = `${parentCategoryName}-${categoryName}-${color}-${variant.size}-${number}-${uniqueNum}`;
  });
});

// Create the SKU when i add a new variant
productSchema.pre('findOneAndUpdate', async function () {
  // New Data , Query
  const update = this.getUpdate();
  const query = this.getQuery();

  // 'variants._id' exists when i want to delete the variant so Skip delete variant
  //! Skip delete variant
  if (query['variants._id'] !== undefined) return;
  if (!update.$push?.variants) return;

  // Get category with parent data
  const product = await this.model.findById(query._id).populate('categoryId');

  // Check for data
  if (!product || !product.categoryId) {
    throw new Error('Product not found');
  }
  // Define the SKU units
  const categoryName = product.categoryId.name.slice(0, 3).toUpperCase();
  const parentCategoryName = product.categoryId.slug.split('-')[0].slice(0, 3).toUpperCase();

  // Create SKU
  const newVariant = update.$push.variants;
  const color = newVariant.color ? newVariant.color.slice(0, 3).toUpperCase() : 'NON';
  const number = String(product.variants.length + 1).padStart(3, '0');
  const uniqueNum = Date.now().toString().slice(-4);

  newVariant.sku = `${parentCategoryName}-${categoryName}-${color}-${newVariant.size}-${number}-${uniqueNum}`;
});

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
