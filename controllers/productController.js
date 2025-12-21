const Product = require('./../models/productModel');
const APIFeatures = require('../utils/APIFeatures');

// Get Top 6 products Selling
exports.aliasBestSelling = (req, res, next) => {
  req.query.sort = '-variants.soldCount';
  req.query.limit = '6';
  next();
};

// Get Top 6 products AVG
exports.aliasTopRating = (req, res, next) => {
  req.query.sort = '-ratingsAverage';
  req.query.limit = '6';
  next();
};

// Get All Products
exports.getAllProducts = async (req, res, next) => {
  try {
    // Get The total number of documents (products)
    const numOfProducts = await Product.countDocuments();

    // 1) Build the query
    const features = new APIFeatures(Product.find(), req.query)
      .filter()
      .sort()
      .limitFields()
      .paginate();

    // 2) Excute the query
    // Excute the query after finishing the build
    const products = await features.query;

    // No Products
    if (!products) {
      res.status(404).json({
        status: 'fail',
        message: 'No Products found',
      });
    }
    // 3) Res
    res.status(200).json({
      status: 'success',
      total: numOfProducts,
      results: products.length,
      data: {
        products,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Get Specific Product
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      res.status(404).json({
        status: 'fail',
        message: 'Product not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        product,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Update Product
exports.updateProduct = async (req, res, next) => {
  try {
    // Define allowed fields
    // TODO: Add images array to update it
    const allowedFields = ['name', 'description', 'categoryId', 'coverImage'];

    // Store new Data
    const updateData = {};

    // Assign new data for only the allowed fields
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    // If empty updated data
    if (!Object.keys(updateData).length) {
      return res.status(400).json({
        status: 'fail',
        message: 'No valid product fields provided to update',
      });
    }

    // Update
    const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    // If there is no product found
    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'Product not found',
      });
    }

    // Res
    res.status(200).json({
      status: 'success',
      data: { product },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Create Product
exports.createProduct = async (req, res, next) => {
  try {
    const product = await Product.create(req.body);

    res.status(201).json({
      status: 'success',
      data: {
        product,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Delete Product
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      res.status(404).json({
        status: 'fail',
        message: 'No product found with this ID',
      });
    }

    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

//? Variants
// Get Product Variants
exports.getProductVariants = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    // If there is no product found
    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'Product not found',
      });
    }

    // If there is no varaints
    if (!product.variants || product.variants.length === 0) {
      res.status(404).json({
        status: 'fail',
        message: 'No variants found on this product',
      });
    }

    // Res
    res.status(200).json({
      status: 'success',
      data: {
        variants: product.variants,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Update Product Variant
exports.updateProductVariant = async (req, res, next) => {
  try {
    // Define allowed fields
    const allowedFields = ['size', 'color', 'price', 'stock'];

    // Store new Data
    const updateData = {};

    // Assign new data for only the allowed fields
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[`variants.$.${field}`] = req.body[field];
      }
    });

    // If empty updated data
    if (!Object.keys(updateData).length) {
      return res.status(400).json({
        status: 'fail',
        message: 'No valid product fields provided to update',
      });
    }

    // Update
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, 'variants._id': req.params.varId },
      { $set: updateData },
      {
        new: true,
        runValidators: true,
      },
    );

    // If there is no product found
    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'Product not found',
      });
    }

    // Res
    res.status(200).json({
      status: 'success',
      data: { product },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Create Product Variant
exports.createProductVariant = async (req, res, next) => {
  try {
    // Allowed fields
    const requiredFields = ['stock', 'price', 'color', 'size'];

    // New data
    let newVariant = {};

    // Assign new data for only the allowed fields
    requiredFields.forEach((el) => {
      if (req.body[el] !== undefined) {
        newVariant[el] = req.body[el];
      }
    });

    // Validate variant fields
    if (!newVariant.price || !newVariant.stock) {
      return res.status(400).json({
        status: 'fail',
        message: 'Variant must include price and stock',
      });
    }

    // Update product with new variant
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $push: { variants: newVariant } },
      { new: true, runValidators: true },
    );

    // If there is no product found
    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'No product found with this ID',
      });
    }

    // Res
    res.status(201).json({
      status: 'success',
      data: product,
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Delete Product Variant
exports.deleteProductVariant = async (req, res, next) => {
  try {
    // Update (Delete variant)
    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        'variants._id': req.params.varId,
      },
      {
        $pull: { variants: { _id: req.params.varId } },
      },
      { new: true, runValidators: true },
    );

    // If there is no product found
    if (!product) {
      res.status(404).json({
        status: 'fail',
        message: 'No product variant found with this ID',
      });
    }

    // Res
    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};
