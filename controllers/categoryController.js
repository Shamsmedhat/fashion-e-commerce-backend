const Category = require('./../models/categoryModel');
const APIFeatures = require('../utils/APIFeatures');

exports.aliasMainCategories = (req, res, next) => {
  req.filter = { parentId: null };
  next();
};

// Get All Categories
exports.getAllCategories = async (req, res, next) => {
  try {
    // Get The total number of documents (categories)
    const numOfCategories = await Category.countDocuments();

    // 1) Build the query
    const features = new APIFeatures(Category.find(), req.query)
      .filter()
      .sort()
      .limitFields()
      .paginate();

    // 2) Excute the query
    // Excute the query after finishing the build
    const categories = await features.query;

    // No categories
    if (!categories) {
      res.status(404).json({
        status: 'fail',
        message: 'No categories found',
      });
    }

    // 3) Res
    res.status(200).json({
      status: 'success',
      total: numOfCategories,
      results: categories.length,
      data: {
        categories,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// // Get Specific Product
// exports.getProduct = async (req, res, next) => {
//   try {
//     const product = await Product.findById(req.params.id);

//     if (!product) {
//       res.status(404).json({
//         status: 'fail',
//         message: 'Product not found',
//       });
//     }

//     res.status(200).json({
//       status: 'success',
//       data: {
//         product,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       status: 'fail',
//       message: error.message,
//     });
//   }
// };

// // Update Product
// exports.updateProduct = async (req, res, next) => {
//   try {
//     // Define allowed fields
//     // TODO: Add images array to update it
//     const allowedFields = ['name', 'description', 'categoryId', 'coverImage'];

//     // Store new Data
//     const updateData = {};

//     // Assign new data for only the allowed fields
//     allowedFields.forEach((field) => {
//       if (req.body[field] !== undefined) {
//         updateData[field] = req.body[field];
//       }
//     });

//     // If empty updated data
//     if (!Object.keys(updateData).length) {
//       return res.status(400).json({
//         status: 'fail',
//         message: 'No valid product fields provided to update',
//       });
//     }

//     // Update
//     const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
//       new: true,
//       runValidators: true,
//     });

//     // If there is no product found
//     if (!product) {
//       return res.status(404).json({
//         status: 'fail',
//         message: 'Product not found',
//       });
//     }

//     // Res
//     res.status(200).json({
//       status: 'success',
//       data: { product },
//     });
//   } catch (error) {
//     res.status(500).json({
//       status: 'error',
//       message: error.message,
//     });
//   }
// };

// // Create Product
// exports.createProduct = async (req, res, next) => {
//   try {
//     const product = await Product.create(req.body);

//     res.status(201).json({
//       status: 'success',
//       data: {
//         product,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       status: 'fail',
//       message: error.message,
//     });
//   }
// };

// // Delete Product
// exports.deleteProduct = async (req, res, next) => {
//   try {
//     const product = await Product.findByIdAndDelete(req.params.id);

//     if (!product) {
//       res.status(404).json({
//         status: 'fail',
//         message: 'No product found with this ID',
//       });
//     }

//     res.status(204).json({
//       status: 'success',
//       data: null,
//     });
//   } catch (error) {
//     res.status(500).json({
//       status: 'fail',
//       message: error.message,
//     });
//   }
// };
