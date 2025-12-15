const mongoose = require('mongoose');
const validator = require('validator');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide your name!'],
    maxLength: [20, 'Name must have less than or equal 20 characters!'],
    minLength: [3, 'Name must be at least 20 characters!'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Please provide your email!'],
    unique: true,
    validate: [validator.isEmail, 'Please provide a valid email address!'],
    trim: true,
  },
  phone: {
    type: String,
    required: [true, 'Please provide your phone number!'],
    unique: true,
    match: [/^(?:\+20|0)?1[0125][0-9]{8}$/, 'Please provide a vaild Egyption number!'],
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  password: {
    type: String,
    required: [true, 'Please provide your password!'],
    minLength: [8, 'Password must have more than or equal 8 characters!'],
    match: [
      /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,}$/,
      'Password must be at least 8 characters long and include at least one uppercase letter and one special character.!',
    ],
  },
  passwordConfirm: {
    type: String,
    required: [true, 'Please confirm your password!'],
    validate: {
      // This only work on CREATE & SAVE
      validator: function (el) {
        return el === this.password;
      },
      message: 'Passwords are not the same!',
    },
  },
  addresses: [
    {
      label: {
        type: String,
        minLength: [3, 'Address label must be more than or equal 3 characters!'],
        maxLength: [45, 'Address label must be less than or equal 45 characters!'],
      },
      city: String,
      street: String,
      isDefault: Boolean,
    },
  ],
  cart: {
    items: [
      {
        productId: mongoose.Schema.ObjectId,
        variantSku: String,
        quantity: Number,
        addedAt: Date,
      },
    ],
    updatedAt: Date,
  },
  wishlist: [{ type: mongoose.Schema.ObjectId, ref: 'Product' }],
  active: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
});

const User = mongoose.model('User', userSchema);
module.exports = User;
