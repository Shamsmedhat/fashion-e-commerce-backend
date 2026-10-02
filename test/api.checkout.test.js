const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');
const Stripe = require('stripe');

const h = require('../test-support/harness');

const { Bag, Orders, Product } = h.models;

before(h.start);
after(h.stop);
beforeEach(h.reset);

const ADDRESS = {
  addresses: [{ label: 'Home', city: 'Cairo', street: '12 Nile St', isDefault: true }],
};

// A shopper with an address, plus one product with `stock` units of a single variant.
const setup = async ({ stock = 5 } = {}) => {
  const shopper = await h.createUser(ADDRESS);
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes, {
    variants: [{ size: 'M', color: 'black', price: 500, stock }],
  });

  return { shopper, product, sku: product.variants[0].sku, category: menShoes };
};

const addToBag = (auth, product, sku, quantity = 1) =>
  h
    .api()
    .post('/api/v1/users/bag/add')
    .set(auth)
    .send({ productId: String(product._id), variantSku: sku, quantity });

const stockOf = async (product) => {
  const [variant] = (await Product.findById(product._id)).variants;
  return { stock: variant.stock, soldCount: variant.soldCount };
};

// ---------- Bag ----------

test('bag quantities must be whole numbers from 1 up', async () => {
  const { shopper, product, sku } = await setup();

  for (const quantity of ['2', 1.5, 0, -1]) {
    const res = await addToBag(shopper.auth, product, sku, quantity);
    assert.equal(res.status, 400, `quantity ${JSON.stringify(quantity)} must be rejected`);
  }

  const ok = await addToBag(shopper.auth, product, sku, 2);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.bag.items[0].quantity, 2);
});

test('adding the same variant twice adds the quantities, never concatenates them', async () => {
  const { shopper, product, sku } = await setup();

  await addToBag(shopper.auth, product, sku, 1);
  const res = await addToBag(shopper.auth, product, sku, 2);

  assert.equal(res.body.data.bag.items.length, 1);
  assert.equal(res.body.data.bag.items[0].quantity, 3);
});

test('a bag cannot hold more than the stock', async () => {
  const { shopper, product, sku } = await setup({ stock: 2 });

  const res = await addToBag(shopper.auth, product, sku, 3);

  assert.equal(res.status, 400);
});

test('updating a bag item rejects an invalid quantity', async () => {
  const { shopper, product, sku } = await setup();
  const added = await addToBag(shopper.auth, product, sku, 1);
  const itemId = added.body.data.bag.items[0]._id;

  const res = await h
    .api()
    .patch(`/api/v1/bags/me/items/${itemId}`)
    .set(shopper.auth)
    .send({ quantity: '3' });

  assert.equal(res.status, 400);
});

// ---------- Cash checkout ----------

test('a cash order takes the items out of stock, counts them as sold and empties the bag', async () => {
  const { shopper, product, sku } = await setup({ stock: 5 });
  await addToBag(shopper.auth, product, sku, 2);

  const res = await h.api().post('/api/v1/checkout/cash').set(shopper.auth).send({});

  assert.equal(res.status, 201);
  assert.equal(res.body.data.order.totalAmount, 1000);
  assert.deepEqual(await stockOf(product), { stock: 3, soldCount: 2 });
  assert.equal((await Bag.findOne({ userId: shopper.user._id })).items.length, 0);
});

test('two shoppers racing for the last unit: exactly one order is created', async () => {
  const { shopper, product, sku } = await setup({ stock: 1 });
  const rival = await h.createUser(ADDRESS);
  await addToBag(shopper.auth, product, sku, 1);
  await addToBag(rival.auth, product, sku, 1);

  const results = await Promise.all([
    h.api().post('/api/v1/checkout/cash').set(shopper.auth).send({}),
    h.api().post('/api/v1/checkout/cash').set(rival.auth).send({}),
  ]);

  const statuses = results.map((res) => res.status).sort();
  assert.equal(statuses[0], 201);
  assert.notEqual(statuses[1], 201);
  assert.equal(await Orders.countDocuments(), 1);
  assert.deepEqual(await stockOf(product), { stock: 0, soldCount: 1 });
});

test('when one item has sold out, no stock is taken for the others and the bag is kept', async () => {
  const { shopper, product, sku, category } = await setup({ stock: 5 });
  const scarce = await h.createProduct(category, {
    variants: [{ size: 'M', color: 'red', price: 800, stock: 1 }],
  });
  await addToBag(shopper.auth, product, sku, 2);
  await addToBag(shopper.auth, scarce, scarce.variants[0].sku, 1);

  // Someone else buys the scarce item after it was added to the bag.
  await Product.updateOne({ _id: scarce._id }, { $set: { 'variants.0.stock': 0 } });

  const res = await h.api().post('/api/v1/checkout/cash').set(shopper.auth).send({});

  assert.notEqual(res.status, 201);
  assert.equal(await Orders.countDocuments(), 0);
  assert.deepEqual(await stockOf(product), { stock: 5, soldCount: 0 });
  assert.equal((await Bag.findOne({ userId: shopper.user._id })).items.length, 2);
});

test('checkout needs items in the bag and a delivery address', async () => {
  const { shopper, product, sku } = await setup();
  const noAddress = await h.createUser();

  const emptyBag = await h.api().post('/api/v1/checkout/cash').set(shopper.auth).send({});

  await addToBag(noAddress.auth, product, sku, 1);
  const missingAddress = await h.api().post('/api/v1/checkout/cash').set(noAddress.auth).send({});

  assert.equal(emptyBag.status, 400);
  assert.equal(missingAddress.status, 400);
  assert.match(missingAddress.body.message, /address/i);
});

// ---------- Card checkout (Stripe webhook) ----------

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const sendWebhook = (type, orderId) => {
  const payload = JSON.stringify({
    id: 'evt_test',
    object: 'event',
    type,
    data: { object: { id: 'cs_test_1', object: 'checkout.session', metadata: { orderId } } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  return h
    .api()
    .post('/api/v1/checkout/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);
};

const createPendingCardOrder = async (shopper, product, sku, quantity) => {
  await addToBag(shopper.auth, product, sku, quantity);

  return Orders.create({
    userId: shopper.user._id,
    items: [
      {
        productId: product._id,
        variantSku: sku,
        productName: product.name,
        priceAtPurchase: 500,
        quantity,
      },
    ],
    totalAmount: 500 * quantity,
    paymentMethod: 'card',
  });
};

test('a completed card payment marks the order paid, takes the stock and empties the bag', async () => {
  const { shopper, product, sku } = await setup({ stock: 5 });
  const order = await createPendingCardOrder(shopper, product, sku, 2);

  const res = await sendWebhook('checkout.session.completed', String(order._id));

  const paid = await Orders.findById(order._id);
  assert.equal(res.status, 200);
  assert.equal(paid.paymentStatus, 'paid');
  assert.equal(paid.needsReview, false);
  assert.deepEqual(await stockOf(product), { stock: 3, soldCount: 2 });
  assert.equal((await Bag.findOne({ userId: shopper.user._id })).items.length, 0);
});

test('a webhook delivered twice only takes the stock once', async () => {
  const { shopper, product, sku } = await setup({ stock: 5 });
  const order = await createPendingCardOrder(shopper, product, sku, 2);

  await sendWebhook('checkout.session.completed', String(order._id));
  const second = await sendWebhook('checkout.session.completed', String(order._id));

  assert.equal(second.status, 200);
  assert.deepEqual(await stockOf(product), { stock: 3, soldCount: 2 });
});

test('a paid order whose stock ran out is flagged for review instead of going negative', async () => {
  const { shopper, product, sku } = await setup({ stock: 2 });
  const order = await createPendingCardOrder(shopper, product, sku, 2);
  await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 1 } });

  await sendWebhook('checkout.session.completed', String(order._id));

  const paid = await Orders.findById(order._id);
  assert.equal(paid.paymentStatus, 'paid');
  assert.equal(paid.needsReview, true);
  assert.deepEqual(await stockOf(product), { stock: 1, soldCount: 0 });
});

test('an expired session fails a pending order but never a paid one', async () => {
  const { shopper, product, sku } = await setup();
  const pending = await createPendingCardOrder(shopper, product, sku, 1);
  const paid = await Orders.create({
    ...pending.toObject(),
    _id: undefined,
    paymentStatus: 'paid',
  });

  await sendWebhook('checkout.session.expired', String(pending._id));
  await sendWebhook('checkout.session.expired', String(paid._id));

  assert.equal((await Orders.findById(pending._id)).paymentStatus, 'failed');
  assert.equal((await Orders.findById(paid._id)).paymentStatus, 'paid');
});

test('an event that is not about one of our orders is acknowledged and ignored', async () => {
  const noOrderId = await sendWebhook('checkout.session.completed', undefined);
  const unknownOrder = await sendWebhook('checkout.session.completed', '64f0000000000000000000ff');
  const malformedId = await sendWebhook('checkout.session.expired', 'not-an-id');

  for (const res of [noOrderId, unknownOrder, malformedId]) {
    assert.equal(res.status, 200);
  }
  assert.equal(noOrderId.body.ignored, true);
  assert.equal(await Orders.countDocuments(), 0);
});

test('a webhook with a bad signature is rejected', async () => {
  const res = await h
    .api()
    .post('/api/v1/checkout/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 't=1,v1=bad')
    .send('{}');

  assert.equal(res.status, 400);
});
