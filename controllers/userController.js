const catchAsync = require('./../lib/utils/catchAsync');

// Return the currently authenticated user (populated by authController.protect)
exports.getMe = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: 'success',
    data: {
      user: req.user,
    },
  });
});
