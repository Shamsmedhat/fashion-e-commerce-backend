const mongoose = require('mongoose');

const bagSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Bag must belong to a user!'],
  },

  items: [
    {
      productId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Product',
        required: [true, 'Bag item must have a product ID!'],
      },
      variantSku: {
        type: String,
        required: [true, 'Bag item must have a variant SKU!'],
      },
      productName: {
        type: String,
        required: [true, 'Please provide the product name!'],
        trim: true,
        minLength: [3, 'Product name must have more than or equal 3 characters!'],
        maxLength: [45, 'Product name must have less than or equal 45 characters!'],
      },
      priceAtPurchase: {
        type: Number,
        required: [true, 'Bag item must have a price!'],
        min: [0, 'Price must be positive!'],
      },
      quantity: {
        type: Number,
        required: [true, 'Bag item must have a quantity!'],
        min: [1, 'Quantity must be at least 1!'],
      },
      addedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field before saving
bagSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

// Index for better query performance
bagSchema.index({ userId: 1 });

const Bag = mongoose.model('Bag', bagSchema);
module.exports = Bag;
