const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide the product name!'],
    trim: true,
    minLength: [3, 'Product name must have more than or equal 3 characters!'],
    maxLength: [45, 'Product name must have less than or equal 45 characters!'],
  },
  description: {
    type: String,
    required: [true, 'Please provide the product description!'],
    trim: true,
    minLength: [12, 'Product description must have more than or equal 12 characters!'],
    maxLength: [255, 'Product description must have less than or equal 255 characters!'],
  },
  categoryId: { type: mongoose.Schema.ObjectId, ref: 'Category' },
  coverImage: { type: String, required: [true, 'Product must have a cover image'] },
  images: [String],
  variants: [
    {
      sku: String,
      size: { type: String, enum: ['S', 'M', 'L', 'XL', 'XXL'], default: 'M' },
      color: String,
      price: {
        type: Number,
        required: [true, 'Product must have a price!'],
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
      stock: {
        type: Number,
        required: [true, 'Product must have a stock, noting the default is one!'],
        default: 1,
      },
    },
  ],

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

  isActive: Boolean,
  createdAt: {
    type: Date,
    default: Date.now(),
  },
});

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
