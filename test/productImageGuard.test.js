const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test-cloud';
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test-key';
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test-secret';

const Product = require('../models/productModel');

const FOREIGN = 'https://evil.example.com/x.jpg';
const OWNED = 'https://res.cloudinary.com/test-cloud/image/upload/v1/products/a.png';
const OWNED_NORMALIZED =
  'https://res.cloudinary.com/test-cloud/image/upload/w_1200,h_1200,c_fill,q_90,f_jpg/products/a.jpg';

const GUARD_NAME = 'guardUpdateImages';

const registeredGuards = (method) =>
  (Product.schema.s.hooks._pres.get(method) || []).filter((hook) => hook.fn.name === GUARD_NAME);

// Runs the registered image guard exactly as Mongoose would, without needing a database. Other
// registered middleware (SKU generation) is filtered out because it performs its own queries.
const applyUpdateGuard = async (update) => {
  const query = Product.findOneAndUpdate({ _id: new mongoose.Types.ObjectId() }, update, {
    runValidators: true,
  });

  await Product.schema.s.hooks.execPre('findOneAndUpdate', query, [], {
    filter: (hook) => hook.fn.name === GUARD_NAME,
  });
  return query.getUpdate();
};

const expectRejected = async (update) => {
  await assert.rejects(() => applyUpdateGuard(update), { name: 'ValidationError' });
};

test('the guard is registered on every update entry point', () => {
  for (const method of [
    'findOneAndUpdate',
    'findOneAndReplace',
    'updateOne',
    'updateMany',
    'replaceOne',
  ]) {
    assert.equal(registeredGuards(method).length, 1, `guard missing on ${method}`);
  }
});

// Controls: prove the harness actually exercises the guard, so a passing suite cannot be vacuous.
test('control: an owned image URL is allowed and normalized', async () => {
  const update = await applyUpdateGuard({ coverImage: OWNED });
  assert.equal(update.coverImage, OWNED_NORMALIZED);
});

test('control: a non-image field is untouched', async () => {
  const update = await applyUpdateGuard({ name: 'Some product' });
  assert.equal(update.name, 'Some product');
});

test('foreign URLs are rejected regardless of the update operator used', async () => {
  const shapes = {
    'implicit $set on coverImage': { coverImage: FOREIGN },
    'implicit $set on images': { images: [FOREIGN] },
    'explicit $set on images': { $set: { images: [FOREIGN] } },
    'positional variants.$.images': { $set: { 'variants.$.images': [FOREIGN] } },
    'filtered positional variants.$[el].images': {
      $set: { 'variants.$[el].images': [FOREIGN] },
    },
    'indexed images.0': { $set: { 'images.0': FOREIGN } },
    '$push a whole variant': {
      $push: { variants: { price: 500, stock: 1, images: [FOREIGN] } },
    },
    '$push with $each': { $push: { images: { $each: [FOREIGN] } } },
    $addToSet: { $addToSet: { 'variants.$.images': FOREIGN } },
    $setOnInsert: { $setOnInsert: { coverImage: FOREIGN } },
    'nested variants array replacement': {
      variants: [{ price: 100, stock: 1, images: [FOREIGN] }],
    },
  };

  for (const [label, update] of Object.entries(shapes)) {
    await assert.doesNotReject(
      () => expectRejected(update),
      `expected the guard to reject a foreign URL via ${label}`,
    );
  }
});

test('owned URLs are normalized inside nested and positional updates', async () => {
  const pushed = await applyUpdateGuard({
    $push: { variants: { price: 500, stock: 1, images: [OWNED] } },
  });
  assert.deepEqual(pushed.$push.variants.images, [OWNED_NORMALIZED]);

  const positional = await applyUpdateGuard({ $set: { 'variants.$.images': [OWNED] } });
  assert.deepEqual(positional.$set['variants.$.images'], [OWNED_NORMALIZED]);
});

test('removal operators are not treated as image writes', async () => {
  const update = await applyUpdateGuard({ $pull: { images: FOREIGN } });
  assert.deepEqual(update.$pull, { images: FOREIGN });
});

test('document creation still rejects foreign URLs on every image field', () => {
  const product = new Product({
    name: 'Temp name',
    description: 'a valid description',
    categoryId: new mongoose.Types.ObjectId(),
    coverImage: FOREIGN,
    images: [FOREIGN],
    variants: [{ price: 500, stock: 1, images: [FOREIGN] }],
  });

  const { errors } = product.validateSync();
  assert.ok(errors['coverImage']);
  assert.ok(errors['images.0']);
  assert.ok(errors['variants.0.images.0']);
});
