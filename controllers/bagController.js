const catchAsync = require('./../lib/utils/catchAsync');
const AppError = require('./../lib/utils/appError');
const Product = require('./../models/productModel');
const Bag = require('./../models/bagModel');

// JSON can carry "2", 1.5 or -1; only whole numbers from 1 up are a valid quantity.
const isValidQuantity = (value) => Number.isInteger(value) && value >= 1;

// Get user's bag
exports.getMyBag = catchAsync(async (req, res, next) => {
  let bag = await Bag.findOne({ userId: req.user._id });

  // If bag doesn't exist, create an empty one
  if (!bag) {
    bag = await Bag.create({ userId: req.user._id, items: [] });
  }

  res.status(200).json({
    status: 'success',
    data: {
      bag,
    },
  });
});

// Get user's bag items with full product details
exports.getMyBagItems = catchAsync(async (req, res, next) => {
  let bag = await Bag.findOne({ userId: req.user._id });

  // If bag doesn't exist, create an empty one
  if (!bag) {
    bag = await Bag.create({ userId: req.user._id, items: [] });
  }

  // Collect all unique product IDs
  const productIds = [...new Set(bag.items.map((item) => item.productId.toString()))];

  // Fetch all products with their variants in one query
  let products = await Product.find({ _id: { $in: productIds } }).populate({
    path: 'categoryId',
    select: 'name slug',
  });

  // Create a map for quick product lookup
  const productMap = new Map();
  products.forEach((product) => {
    productMap.set(product._id.toString(), product);
  });

  // Enrich items with variant details
  const enrichedItems = bag.items.map((item) => {
    const product = productMap.get(item.productId.toString());

    if (!product) {
      return {
        ...item.toObject(),
        product: null,
        variant: null,
        isAvailable: false,
        currentPrice: item.priceAtPurchase,
        hasPriceChanged: false,
        error: 'Product not found',
      };
    }

    // Find the variant by SKU
    const variant = product.variants.find((v) => v.sku === item.variantSku);

    if (!variant) {
      return {
        ...item.toObject(),
        product: {
          _id: product._id,
          name: product.name,
          description: product.description,
          coverImage: product.coverImage,
          images: product.images,
          categoryId: product.categoryId,
          ratingsAverage: product.ratingsAverage,
          reviewCount: product.reviewCount,
        },
        variant: null,
        isAvailable: false,
        currentPrice: item.priceAtPurchase,
        hasPriceChanged: false,
        error: 'Variant not found',
      };
    }

    // Check availability
    const isAvailable = variant.stock >= item.quantity;
    const currentPrice = variant.priceDiscount || variant.price;
    const hasPriceChanged = currentPrice !== item.priceAtPurchase;

    return {
      ...item.toObject(),
      product: {
        _id: product._id,
        name: product.name,
        description: product.description,
        coverImage: product.coverImage,
        images: product.images,
        categoryId: product.categoryId,
        ratingsAverage: product.ratingsAverage,
        reviewCount: product.reviewCount,
      },
      variant: {
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        price: variant.price,
        priceDiscount: variant.priceDiscount,
        stock: variant.stock,
        images: variant.images,
      },
      isAvailable,
      hasPriceChanged,
      currentPrice,
    };
  });

  // Calculate total amount (use current price if available, otherwise use purchase price)
  const totalAmount = enrichedItems.reduce((sum, item) => {
    const price = item.currentPrice || item.priceAtPurchase;
    return sum + price * item.quantity;
  }, 0);

  res.status(200).json({
    status: 'success',
    data: {
      items: enrichedItems,
      totalItems: enrichedItems.length,
      totalAmount: totalAmount.toFixed(2),
      bagId: bag._id,
      updatedAt: bag.updatedAt,
    },
  });
});

// Add item to bag
exports.addToBag = catchAsync(async (req, res, next) => {
  const { productId, variantSku, quantity = 1 } = req.body;

  // Validation
  if (
    typeof productId !== 'string' ||
    typeof variantSku !== 'string' ||
    !productId ||
    !variantSku
  ) {
    return next(new AppError('Please provide productId and variantSku!', 400));
  }

  if (!isValidQuantity(quantity)) {
    return next(new AppError('Quantity must be a whole number of at least 1!', 400));
  }

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) {
    return next(new AppError('No product found with this ID!', 404));
  }

  // Find the variant
  const variant = product.variants.find((v) => v.sku === variantSku);
  if (!variant) {
    return next(new AppError('No variant found with this SKU!', 404));
  }

  // Check stock availability
  if (variant.stock < quantity) {
    return next(
      new AppError(`Insufficient stock! Available: ${variant.stock}, Requested: ${quantity}`, 400),
    );
  }

  // Get or create bag
  let bag = await Bag.findOne({ userId: req.user._id });
  if (!bag) {
    bag = await Bag.create({ userId: req.user._id, items: [] });
  }

  // Check if item already exists in bag
  const existingItemIndex = bag.items.findIndex(
    (item) => item.productId.toString() === productId && item.variantSku === variantSku,
  );

  const currentPrice = variant.priceDiscount || variant.price;

  if (existingItemIndex !== -1) {
    // Update existing item quantity
    const newQuantity = bag.items[existingItemIndex].quantity + quantity;

    // Check stock for new total quantity
    if (variant.stock < newQuantity) {
      return next(
        new AppError(
          `Insufficient stock! Available: ${variant.stock}, Current in bag: ${bag.items[existingItemIndex].quantity}, Adding: ${quantity}`,
          400,
        ),
      );
    }

    bag.items[existingItemIndex].quantity = newQuantity;
    bag.items[existingItemIndex].priceAtPurchase = currentPrice; // Update price to current
    bag.items[existingItemIndex].addedAt = Date.now(); // Update added time
  } else {
    // Add new item
    bag.items.push({
      productId,
      variantSku,
      productName: product.name,
      priceAtPurchase: currentPrice,
      quantity,
      addedAt: Date.now(),
    });
  }

  await bag.save();

  res.status(200).json({
    status: 'success',
    message: 'Item added to bag successfully!',
    data: {
      bag,
    },
  });
});

// Update bag item (quantity and/or variant SKU to change color/size)
exports.updateBagItem = catchAsync(async (req, res, next) => {
  const { quantity, variantSku } = req.body;
  const { itemId } = req.params;

  // Validation - at least one field must be provided
  if (quantity === undefined && !variantSku) {
    return next(new AppError('Please provide quantity or variantSku to update!', 400));
  }

  if (variantSku !== undefined && typeof variantSku !== 'string') {
    return next(new AppError('variantSku must be text!', 400));
  }

  if (quantity !== undefined && !isValidQuantity(quantity)) {
    return next(new AppError('Quantity must be a whole number of at least 1!', 400));
  }

  // Find bag
  const bag = await Bag.findOne({ userId: req.user._id });
  if (!bag) {
    return next(new AppError('Bag not found!', 404));
  }

  // Find item
  const itemIndex = bag.items.findIndex((item) => item._id.toString() === itemId);
  if (itemIndex === -1) {
    return next(new AppError('Item not found in your bag!', 404));
  }

  const item = bag.items[itemIndex];

  // Verify product still exists
  const product = await Product.findById(item.productId);
  if (!product) {
    return next(new AppError('Product no longer exists!', 404));
  }

  // Determine which variant to use (new SKU if provided, otherwise current SKU)
  const targetSku = variantSku || item.variantSku;

  // Validate that the new SKU belongs to the same product
  const targetVariant = product.variants.find((v) => v.sku === targetSku);
  if (!targetVariant) {
    return next(
      new AppError(
        `No variant found with SKU "${targetSku}" for this product! Please ensure the SKU belongs to the same product.`,
        404,
      ),
    );
  }

  // If SKU is being changed, ensure it's for the same product (already validated above)
  // and check if this combination already exists in bag (to avoid duplicates)
  if (variantSku && variantSku !== item.variantSku) {
    const existingItemIndex = bag.items.findIndex(
      (bagItem) =>
        bagItem.productId.toString() === item.productId.toString() &&
        bagItem.variantSku === variantSku &&
        bagItem._id.toString() !== itemId, // Exclude current item
    );

    if (existingItemIndex !== -1) {
      return next(
        new AppError(
          'This variant is already in your bag! Please update the existing item instead.',
          400,
        ),
      );
    }
  }

  // Determine final quantity (use provided quantity or keep current)
  const finalQuantity = quantity !== undefined ? quantity : item.quantity;

  // Check stock availability for the target variant
  if (targetVariant.stock < finalQuantity) {
    return next(
      new AppError(
        `Insufficient stock! Available: ${targetVariant.stock}, Requested: ${finalQuantity}`,
        400,
      ),
    );
  }

  // Update item
  if (quantity !== undefined) {
    bag.items[itemIndex].quantity = finalQuantity;
  }

  if (variantSku) {
    bag.items[itemIndex].variantSku = variantSku;
    // Update price when variant changes
    const currentPrice = targetVariant.priceDiscount || targetVariant.price;
    bag.items[itemIndex].priceAtPurchase = currentPrice;
    bag.items[itemIndex].addedAt = Date.now(); // Update added time when variant changes
  } else if (quantity !== undefined) {
    // Update price even if only quantity changes (in case price changed)
    const currentPrice = targetVariant.priceDiscount || targetVariant.price;
    bag.items[itemIndex].priceAtPurchase = currentPrice;
  }

  await bag.save();

  res.status(200).json({
    status: 'success',
    message: 'Bag item updated successfully!',
    data: {
      item: bag.items[itemIndex],
    },
  });
});

// Delete all bag items
exports.clearBag = catchAsync(async (req, res, next) => {
  const bag = await Bag.findOne({ userId: req.user._id });

  if (!bag) {
    return next(new AppError('Bag not found!', 404));
  }

  bag.items = [];
  await bag.save();

  res.status(200).json({
    status: 'success',
    message: 'Bag cleared successfully!',
    data: {
      bag,
    },
  });
});

// Delete one item from bag
exports.removeBagItem = catchAsync(async (req, res, next) => {
  const { itemId } = req.params;

  const bag = await Bag.findOne({ userId: req.user._id });

  if (!bag) {
    return next(new AppError('Bag not found!', 404));
  }

  const itemIndex = bag.items.findIndex((item) => item._id.toString() === itemId);
  if (itemIndex === -1) {
    return next(new AppError('Item not found in your bag!', 404));
  }

  bag.items.splice(itemIndex, 1);
  await bag.save();

  res.status(200).json({
    status: 'success',
    message: 'Item removed from bag successfully!',
    data: {
      bag,
    },
  });
});
