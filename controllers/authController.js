const jwt = require('jsonwebtoken');
const catchAsync = require('./../lib/utils/catchAsync');
const { promisify } = require('util');

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

// Logout
exports.logout = (req, res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ status: 'success' });
};

// Protect
exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check of it's there
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }

  // 2) Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3) Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(new AppError('The user belonging to this token does no longer exist.', 401));
  }

  // 4) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(new AppError('User recently changed password! Please log in again.', 401));
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

// Restrict to who...
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin', 'lead-guide']. role='user'
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }

    next();
  };
};
