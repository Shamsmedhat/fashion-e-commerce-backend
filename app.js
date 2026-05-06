const express = require('express');

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const bodyParser = require('body-parser');

const globalErrorHandler = require('./controllers/errorController');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoute');
const userRoutes = require('./routes/userRoute');
const bagRoutes = require('./routes/bagRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const checkoutController = require('./controllers/checkoutController');

const AppError = require('./lib/utils/appError');

const app = express();

// 1) GLOBAL MIDDLEWARES

// Trust proxy - IMPORTANT for deployment on Vercel, Heroku, etc.
// This allows Express to trust the X-Forwarded-* headers
app.set('trust proxy', 1);

// Serving static files
app.use(express.static(path.join(__dirname, 'public')));

// Set security HTTP headers
app.use(helmet());

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// General browsing - Products & Categories
const browseLimiter = rateLimit({
  max: 200,
  windowMs: 5 * 60 * 1000, // 5 minutes
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Bag operations (add, update, remove)
const bagLimiter = rateLimit({
  max: 30,
  windowMs: 60 * 1000, // 1 minute
  message: 'Too many bag operations, please slow down.',
});

// Stripe webhook must use raw body parser before express.json()
app.post(
  '/api/v1/checkout/webhook',
  bodyParser.raw({ type: 'application/json' }),
  checkoutController.handleStripeWebhook,
);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// TODO: 2) Security

// Test middleware
app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();

  // console.log(req.cookies);
  next();
});

// 3) ROUTES
app.use('/api/v1/products', browseLimiter, productRoutes);
app.use('/api/v1/categories', browseLimiter, categoryRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/bags', bagLimiter, bagRoutes);
app.use('/api/v1/checkout', checkoutRoutes);

//  4) ERROR Handling
// Catch unhandled routes
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} in this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
