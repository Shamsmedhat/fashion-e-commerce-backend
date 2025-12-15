const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },
  productId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Product',
  },
  rating: {
    type: Number,
    required: true,
    min: [1, 'Rating must be above or equal 1'],
    max: [5, 'Rating must be below or equal 5'],
  },
  comment: {
    type: String,
    required: true,
    minLength: [3, 'Review comment must have more than or equal 3 characters!'],
    maxLength: [255, 'Review comment must have less than or equal 255 characters!'],
  },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
});

reviewSchema.index({ userId: 1, productId: 1 }, { unique: true });

const Review = mongoose.model('Review', reviewSchema);
module.exports = Review;
