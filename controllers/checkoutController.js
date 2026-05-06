const Stripe = require('stripe');

const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');
const Bag = require('./../models/bagModel');
const Product = require('./../models/productModel');
const Orders = require('./../models/ordersModel');
const User = require('./../models/userModel');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const getDefaultAddress = (user) => {
  if (!user.addresses || user.addresses.length === 0) return null;
  return user.addresses.find((address) => address.isDefault) || user.addresses[0];
};

const buildCheckoutSnapshot = async (userId) => {
  const bag = await Bag.findOne({ userId });

  if (!bag || bag.items.length === 0) {
    throw new AppError('Your bag is empty. Please add items before checkout.', 400);
  }

  const user = await User.findById(userId);
  const defaultAddress = getDefaultAddress(user);

  if (!defaultAddress) {
    throw new AppError('Please add a shipping address before checkout.', 400);
  }

  const productIds = [...new Set(bag.items.map((item) => item.productId.toString()))];
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));

  const orderItems = [];
  const stripeLineItems = [];
  let totalAmount = 0;

  bag.items.forEach((item) => {
    const product = productMap.get(item.productId.toString());
    if (!product) {
      throw new AppError(`Product "${item.productName}" is no longer available.`, 400);
    }

    const variant = product.variants.find((v) => v.sku === item.variantSku);
    if (!variant) {
      throw new AppError(`Variant "${item.variantSku}" is no longer available.`, 400);
    }

    if (variant.stock < item.quantity) {
      throw new AppError(
        `Insufficient stock for "${product.name}". Available: ${variant.stock}, Requested: ${item.quantity}`,
        400,
      );
    }

    const unitAmount = variant.priceDiscount || variant.price;
    const lineAmount = unitAmount * item.quantity;
    totalAmount += lineAmount;

    orderItems.push({
      productId: product._id,
      variantSku: variant.sku,
      productName: product.name,
      priceAtPurchase: unitAmount,
      quantity: item.quantity,
    });

    stripeLineItems.push({
      quantity: item.quantity,
      price_data: {
        currency: 'egp',
        unit_amount: Math.round(unitAmount * 100),
        product_data: {
          name: `${product.name} (${variant.color} - ${variant.size})`,
        },
      },
    });
  });

  return {
    bag,
    orderItems,
    stripeLineItems,
    totalAmount,
    addressSnapshot: {
      label: defaultAddress.label,
      city: defaultAddress.city,
      street: defaultAddress.street,
    },
  };
};

exports.createCardCheckoutSession = catchAsync(async (req, res, next) => {
  if (!stripe) {
    return next(new AppError('Stripe is not configured. Please set STRIPE_SECRET_KEY.', 500));
  }

  const { successUrl, cancelUrl } = req.body;

  if (!successUrl || !cancelUrl) {
    return next(new AppError('Please provide successUrl and cancelUrl.', 400));
  }

  const snapshot = await buildCheckoutSnapshot(req.user._id);

  const pendingOrder = await Orders.create({
    userId: req.user._id,
    items: snapshot.orderItems,
    addressSnapshot: snapshot.addressSnapshot,
    totalAmount: snapshot.totalAmount,
    paymentMethod: 'card',
    paymentStatus: 'pending',
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: snapshot.stripeLineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: req.user.email,
    metadata: {
      orderId: pendingOrder._id.toString(),
      userId: req.user._id.toString(),
    },
  });

  pendingOrder.stripeSessionId = session.id;
  await pendingOrder.save();

  res.status(200).json({
    status: 'success',
    data: {
      checkoutUrl: session.url,
      sessionId: session.id,
      orderId: pendingOrder._id,
    },
  });
});

exports.createCashOrder = catchAsync(async (req, res, next) => {
  const snapshot = await buildCheckoutSnapshot(req.user._id);

  const order = await Orders.create({
    userId: req.user._id,
    items: snapshot.orderItems,
    addressSnapshot: snapshot.addressSnapshot,
    totalAmount: snapshot.totalAmount,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
  });

  snapshot.bag.items = [];
  await snapshot.bag.save();

  res.status(201).json({
    status: 'success',
    message: 'Cash order created successfully.',
    data: {
      order,
    },
  });
});

exports.handleStripeWebhook = catchAsync(async (req, res, next) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return next(new AppError('Stripe webhook is not configured.', 500));
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return next(new AppError('Missing Stripe signature header.', 400));
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return next(new AppError(`Invalid Stripe webhook signature: ${err.message}`, 400));
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
      return next(new AppError('Missing orderId in Stripe session metadata.', 400));
    }

    const order = await Orders.findById(orderId);
    if (!order) {
      return next(new AppError('Order not found for webhook event.', 404));
    }

    // Idempotency guard for duplicate webhook deliveries.
    if (order.paymentStatus !== 'paid') {
      order.paymentStatus = 'paid';
      order.paidAt = Date.now();
      order.stripeSessionId = session.id;
      await order.save();

      const bag = await Bag.findOne({ userId: order.userId });
      if (bag && bag.items.length) {
        bag.items = [];
        await bag.save();
      }
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) {
      await Orders.findByIdAndUpdate(orderId, {
        paymentStatus: 'failed',
      });
    }
  }

  res.status(200).json({ received: true });
});
