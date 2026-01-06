const jwt = require('jsonwebtoken');
const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');
const User = require('./../models/userModel');
const mongoose = require('mongoose');

const siginToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// Signup
//! During development, I had a typo in .env.JWT_EXPIRES_IN, so,
//! I noticed that the user was still being created even though there was a programming error.
//! So I added a transaction to ensure the user is not created if there’s an issue generating the token.
exports.signup = catchAsync(async (req, res, next) => {
  // Start the transaction session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create the user
    const newUser = await User.create(
      [
        {
          name: req.body.name,
          email: req.body.email,
          phone: req.body.phone,
          password: req.body.password,
          passwordConfirm: req.body.passwordConfirm,
        },
      ],
      { session },
    );

    // If JWT fails here, transaction rolls back the user creation (user not created)
    const token = siginToken(newUser[0]._id);

    await session.commitTransaction();
    session.endSession();

    // Remove password from the res
    newUser[0].password = undefined;

    // Res
    res.status(201).json({
      status: 'success',
      token,
      data: { user: newUser[0] },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  } finally {
    session.endSession();
  }
});

// Login
exports.login = catchAsync(async (req, res, next) => {
  const { email, password, phone } = req.body;
  // 1. Check for email/phone or password
  const hasLoginIdentifier = email || phone;

  if (!hasLoginIdentifier || !password) {
    return next(new AppError('Login requires email or phone number and a password.', 400));
  }

  if (email && phone) {
    return next(new AppError('Login requires only email or phone number with a password.', 400));
  }

  const identifier = email ? { email } : { phone };

  // 2. Check for vaild email/phone and password
  const user = await User.findOne(identifier).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email/phone or password!', 400));
  }

  // 3. Create the token
  const token = siginToken(user._id);

  // Remove password from the res
  user.password = undefined;

  // 4. Send the res
  res.status(200).json({
    status: 200,
    token,
    data: {
      user,
    },
  });
});
