const assert = require('node:assert/strict');
const test = require('node:test');

process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test-cloud';
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test-key';
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test-secret';

const cloudinary = require('cloudinary').v2;
const Product = require('../models/productModel');
const productController = require('../controllers/productController');

const url = (publicId) =>
  `https://res.cloudinary.com/test-cloud/image/upload/w_1200,h_1200,c_fill,q_90,f_jpg/${publicId}.jpg`;

const SHARED = 'products/shared';
const ORPHAN = 'products/orphan';

// Drives deleteProduct with the database and Cloudinary calls stubbed, returning what was destroyed.
const runDeleteProduct = async ({ deletedProduct, otherProducts, referenceLookupFails }) => {
  const destroyed = [];
  const originalFindByIdAndDelete = Product.findByIdAndDelete;
  const originalFind = Product.find;
  const originalDestroy = cloudinary.uploader.destroy;

  Product.findByIdAndDelete = async () => deletedProduct;
  Product.find = () => ({
    select: () => ({
      lean: async () => {
        if (referenceLookupFails) throw new Error('database unavailable');
        return otherProducts;
      },
    }),
  });
  cloudinary.uploader.destroy = async (publicId) => {
    destroyed.push(publicId);
    return { result: 'ok' };
  };

  try {
    // catchAsync does not return its promise, so completion is observed via the response instead.
    await new Promise((resolve, reject) => {
      productController.deleteProduct(
        { params: { id: 'x' } },
        { status: () => ({ json: () => resolve() }) },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  } finally {
    Product.findByIdAndDelete = originalFindByIdAndDelete;
    Product.find = originalFind;
    cloudinary.uploader.destroy = originalDestroy;
  }

  return destroyed;
};

test('control: an image referenced by no other product is deleted', async () => {
  const destroyed = await runDeleteProduct({
    deletedProduct: { _id: 'a', coverImage: url(ORPHAN), images: [], variants: [] },
    otherProducts: [],
  });

  assert.deepEqual(destroyed, [ORPHAN]);
});

test('an image still referenced by another product is kept', async () => {
  const destroyed = await runDeleteProduct({
    deletedProduct: {
      _id: 'a',
      coverImage: url(SHARED),
      images: [url(ORPHAN)],
      variants: [],
    },
    otherProducts: [{ coverImage: url(SHARED), images: [], variants: [] }],
  });

  assert.deepEqual(destroyed, [ORPHAN], 'shared asset must not be destroyed');
});

test('a shared asset is matched even when the other product stores a legacy URL', async () => {
  const legacyUrl = `https://res.cloudinary.com/test-cloud/image/upload/v123/${SHARED}.png`;
  const destroyed = await runDeleteProduct({
    deletedProduct: { _id: 'a', coverImage: url(SHARED), images: [], variants: [] },
    otherProducts: [{ coverImage: legacyUrl, images: [], variants: [] }],
  });

  assert.deepEqual(destroyed, [], 'legacy-format reference must still protect the asset');
});

test('cleanup is skipped when the reference lookup fails', async () => {
  const destroyed = await runDeleteProduct({
    deletedProduct: { _id: 'a', coverImage: url(ORPHAN), images: [], variants: [] },
    otherProducts: [],
    referenceLookupFails: true,
  });

  assert.deepEqual(destroyed, [], 'must fail safe and keep the asset');
});
