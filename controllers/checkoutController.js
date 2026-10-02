const Stripe = require('stripe');
const mongoose = require('mongoose');

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

// Takes the ordered quantities out of stock and counts them as sold. The stock condition is part
// of the update filter, so two checkouts racing for the last unit cannot both succeed.
// Returns the order lines that could not be fulfilled.
const decrementStock = async (items, session) => {
  const unfulfilled = [];

  // Sequential on purpose: a transaction session cannot run operations in parallel.
  for (const item of items) {
    const result = await Product.updateOne(
      {
        _id: item.productId,
        variants: { $elemMatch: { sku: item.variantSku, stock: { $gte: item.quantity } } },
      },
      {
        $inc: {
          'variants.$.stock': -item.quantity,
          'variants.$.soldCount': item.quantity,
        },
      },
      { session },
    );

    if (result.modifiedCount === 0) unfulfilled.push(item);
  }

  return unfulfilled;
};

const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

exports.createCardCheckoutSession = catchAsync(async (req, res, next) => {
  if (!stripe) {
    return next(new AppError('Stripe is not configured. Please set STRIPE_SECRET_KEY.', 500));
  }

  const { successUrl, cancelUrl } = req.body;

  if (!isHttpUrl(successUrl) || !isHttpUrl(cancelUrl)) {
    return next(new AppError('Please provide a valid successUrl and cancelUrl.', 400));
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

  const session = await mongoose.startSession();

  try {
    let order;

    // Stock, order and bag change together: a failure in any step leaves all three untouched.
    await session.withTransaction(async () => {
      const unfulfilled = await decrementStock(snapshot.orderItems, session);

      if (unfulfilled.length) {
        throw new AppError(
          `"${unfulfilled[0].productName}" just went out of stock. Please review your bag.`,
          409,
        );
      }

      [order] = await Orders.create(
        [
          {
            userId: req.user._id,
            items: snapshot.orderItems,
            addressSnapshot: snapshot.addressSnapshot,
            totalAmount: snapshot.totalAmount,
            paymentMethod: 'cash',
            paymentStatus: 'pending',
          },
        ],
        { session },
      );

      snapshot.bag.items = [];
      await snapshot.bag.save({ session });
    });

    res.status(201).json({
      status: 'success',
      message: 'Cash order created successfully.',
      data: {
        order,
      },
    });
  } finally {
    await session.endSession();
  }
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
    const stripeSession = event.data.object;
    const orderId = stripeSession.metadata?.orderId;

    if (!orderId) {
      return next(new AppError('Missing orderId in Stripe session metadata.', 400));
    }

    if (!(await Orders.exists({ _id: orderId }))) {
      return next(new AppError('Order not found for webhook event.', 404));
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // Idempotency guard for duplicate webhook deliveries: only the delivery that flips the
        // order to "paid" goes on to touch the stock and the bag.
        const order = await Orders.findOneAndUpdate(
          { _id: orderId, paymentStatus: { $ne: 'paid' } },
          { paymentStatus: 'paid', paidAt: new Date(), stripeSessionId: stripeSession.id },
          { returnDocument: 'after', session },
        );

        if (!order) return;

        // The customer has already paid, so a shortfall cannot reject the order;
        // it is flagged for a manual refund or restock instead.
        const unfulfilled = await decrementStock(order.items, session);
        if (unfulfilled.length) {
          order.needsReview = true;
          await order.save({ session });
        }

        const bag = await Bag.findOne({ userId: order.userId }).session(session);
        if (bag && bag.items.length) {
          bag.items = [];
          await bag.save({ session });
        }
      });
    } finally {
      await session.endSession();
    }
  }

  if (event.type === 'checkout.session.expired') {
    const orderId = event.data.object.metadata?.orderId;
    if (orderId) {
      // Only an unpaid order can expire.
      await Orders.updateOne(
        { _id: orderId, paymentStatus: 'pending' },
        { paymentStatus: 'failed' },
      );
    }
  }

  res.status(200).json({ received: true });
});
