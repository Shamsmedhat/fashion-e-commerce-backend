const jwt = require('jsonwebtoken');
const catchAsync = require('./../lib/utils/catchAsync');
const { promisify } = require('util');

const AppError = require('./../lib/utils/appError');
const User = require('./../models/userModel');
const Bag = require('./../models/bagModel');
const mongoose = require('mongoose');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const normalizeAddresses = (address, addresses = [], { treatFirstAsDefault = true } = {}) => {
  const rawAddresses = [address, ...(Array.isArray(addresses) ? addresses : [])].filter(Boolean);

  return rawAddresses
    .filter((entry) => entry.city && entry.street)
    .map((entry, index) => ({
      label: entry.label || 'Home',
      city: entry.city,
      street: entry.street,
      isDefault: treatFirstAsDefault && index === 0 ? true : Boolean(entry.isDefault),
    }));
};

// Signup
//! During development, I had a typo in .env.JWT_EXPIRES_IN, so,
//! I noticed that the user was still being created even though there was a programming error.
//! So I added a transaction to ensure the user is not created if there’s an issue generating the token.
exports.signup = catchAsync(async (req, res, next) => {
  const normalizedAddresses = normalizeAddresses(req.body.address, req.body.addresses);

  // Start the transaction session
  const session = await mongoose.startSession();

  try {
    let newUser;
    let token;

    await session.withTransaction(async () => {
      // Create the user
      [newUser] = await User.create(
        [
          {
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone,
            password: req.body.password,
            passwordConfirm: req.body.passwordConfirm,
            ...(normalizedAddresses.length > 0 && { addresses: normalizedAddresses }),
          },
        ],
        { session },
      );

      // If JWT fails here, transaction rolls back the user creation (user not created)
      token = signToken(newUser._id);
    });

    // Remove password from the res
    newUser.password = undefined;

    // Res
    res.status(201).json({
      status: 'success',
      token,
      data: { user: newUser },
    });
  } finally {
    await session.endSession();
  }
});

// Login
exports.login = catchAsync(async (req, res, next) => {
  const { email, password, phone } = req.body;

  // Credentials must be plain text: an object such as { "$gt": "" } would be run as a query operator.
  if ([email, phone, password].some((value) => value !== undefined && typeof value !== 'string')) {
    return next(new AppError('Email, phone and password must be text.', 400));
  }

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
    return next(new AppError('Incorrect email/phone or password!', 401));
  }

  // 2b. Optional guest checkout addresses: merge onto the user profile on sign-in
  const existingAddresses = Array.isArray(user.addresses) ? user.addresses : [];
  const normalizedIncoming = normalizeAddresses(req.body.address, req.body.addresses, {
    treatFirstAsDefault: existingAddresses.length === 0,
  });

  if (normalizedIncoming.length > 0) {
    if (existingAddresses.length > 0) {
      normalizedIncoming.forEach((addr) => {
        addr.isDefault = false;
      });
    }
    user.addresses = [...existingAddresses, ...normalizedIncoming];
    // Only the new addresses are validated: the stored password hash and the removed
    // passwordConfirm would fail a full-document validation.
    await user.save({ validateModifiedOnly: true });
  }

  // 3. Create the token
  const token = signToken(user._id);

  // 4. Get or create user's bag
  let bag = await Bag.findOne({ userId: user._id });
  if (!bag) {
    bag = await Bag.create({ userId: user._id, items: [] });
  }

  // Remove password from the res
  user.password = undefined;

  // 5. Send the res
  res.status(200).json({
    status: 'success',
    token,
    data: {
      user,
      bag: {
        _id: bag._id,
        items: bag.items,
        totalItems: bag.items.length,
        updatedAt: bag.updatedAt,
      },
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
