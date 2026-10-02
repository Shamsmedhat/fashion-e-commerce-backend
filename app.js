const express = require('express');

const cors = require('cors');
const helmet = require('helmet');
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
const { browseLimiter, bagLimiter } = require('./lib/utils/rateLimiters');

const app = express();

// 1) GLOBAL MIDDLEWARES

// Trust proxy - IMPORTANT for deployment on Vercel, Heroku, etc.
// This allows Express to trust the X-Forwarded-* headers
app.set('trust proxy', 1);

// Enable CORS for the admin dashboard and storefront frontends.
// Origins are configurable via CORS_ORIGINS (comma-separated); sensible dev defaults otherwise.
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3001',
    'http://127.0.0.1:5173',
    'https://fashion-ecommerce-dashboard.vercel.app',
    'https://fashion-e-commerce-frontend-pi.vercel.app',
  ].join(',')
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser clients (no Origin header) and any allowlisted origin.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new AppError('Not allowed by CORS', 403));
  },
  credentials: true,
};

app.use(cors(corsOptions));
// Respond to preflight (OPTIONS) requests for every route.
app.options('*', cors(corsOptions));

// Set security HTTP headers
app.use(helmet());

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Stripe webhook must use raw body parser before express.json()
app.post(
  '/api/v1/checkout/webhook',
  bodyParser.raw({ type: 'application/json' }),
  checkoutController.handleStripeWebhook,
);

// Product writes contain Cloudinary URLs only; image bytes never pass through the API.
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// 2) ROUTES
app.use('/api/v1/products', browseLimiter, productRoutes);
app.use('/api/v1/categories', browseLimiter, categoryRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/bags', bagLimiter, bagRoutes);
app.use('/api/v1/checkout', checkoutRoutes);

//  3) ERROR Handling
// Catch unhandled routes
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} in this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
