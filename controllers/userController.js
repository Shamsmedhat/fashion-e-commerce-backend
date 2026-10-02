const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');

const MAX_ADDRESSES = 10;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

// Return the currently authenticated user (populated by authController.protect)
exports.getMe = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: 'success',
    data: {
      user: req.user,
    },
  });
});

// Add a delivery address to the authenticated user (checkout needs at least one)
exports.addMyAddress = catchAsync(async (req, res, next) => {
  const { label, city, street, isDefault } = req.body;
  const { user } = req;

  if (!isNonEmptyString(city) || !isNonEmptyString(street)) {
    return next(new AppError('Please provide the city and street for your address!', 400));
  }

  if (label !== undefined && typeof label !== 'string') {
    return next(new AppError('Address label must be text!', 400));
  }

  if (user.addresses.length >= MAX_ADDRESSES) {
    return next(new AppError(`You can save up to ${MAX_ADDRESSES} addresses.`, 400));
  }

  // The first address is always the default; later ones only when asked.
  const makeDefault = user.addresses.length === 0 || isDefault === true;

  if (makeDefault) {
    user.addresses.forEach((address) => {
      address.isDefault = false;
    });
  }

  user.addresses.push({
    label: isNonEmptyString(label) ? label : 'Home',
    city,
    street,
    isDefault: makeDefault,
  });

  await user.save({ validateModifiedOnly: true });

  res.status(201).json({
    status: 'success',
    data: {
      user,
    },
  });
});
