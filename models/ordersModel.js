const mongoose = require('mongoose');

const ordersSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },

  items: [
    {
      productId: mongoose.Schema.ObjectId,
      variantSku: String,
      productName: {
        type: String,
        required: [true, 'Please provide the product name!'],
        trim: true,
        minLength: [3, 'Product name must have more than or equal 3 characters!'],
        maxLength: [45, 'Product name must have less than or equal 45 characters!'],
      },
      priceAtPurchase: {
        type: Number,
        required: true,
      },
      quantity: {
        type: Number,
        required: true,
      },
    },
  ],

  addressSnapshot: {
    label: {
      type: String,
      minLength: [3, 'Address label must be more than or equal 3 characters!'],
    },
    city: String,
    street: String,
  },

  totalAmount: Number,
  paymentMethod: {
    type: String,
    enum: ['card', 'cash'],
    required: [true, 'Order must have a payment method!'],
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
  },
  stripeSessionId: String,
  paidAt: Date,
  // Set when a card payment was confirmed but the stock had already run out.
  needsReview: {
    type: Boolean,
    default: false,
  },
  orderStatus: {
    type: String,
    enum: ['processing', 'shipped', 'delivered', 'cancelled'],
    default: 'processing',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Orders = mongoose.model('Orders', ordersSchema);
module.exports = Orders;
