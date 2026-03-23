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
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
  },
  orderStatus: {
    type: String,
    enum: ['processing', 'shipped', 'delivered', 'cancelled'],
    default: 'processing',
  },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
});

const Orders = mongoose.model('Orders', ordersSchema);
module.exports = Orders;
