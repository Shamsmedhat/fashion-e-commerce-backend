const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');

const h = require('../test-support/harness');

const { Product } = h.models;

before(h.start);
after(h.stop);
beforeEach(h.reset);

const list = (query = '') => h.api().get(`/api/v1/products${query}`);

const seedCatalogue = async () => {
  const tree = await h.createCategoryTree();

  await h.createProduct(tree.menShoes, {
    name: 'Black sneakers',
    variants: [
      { size: 'M', color: 'Black', price: 900, stock: 4 },
      { size: 'L', color: 'White', price: 950, stock: 2 },
    ],
  });
  await h.createProduct(tree.menAccessories, {
    name: 'Leather belt',
    variants: [{ size: 'S', color: 'Brown', price: 300, stock: 9 }],
  });
  await h.createProduct(tree.womenShoes, {
    name: 'Red heels',
    variants: [{ size: 'M', color: 'Red', price: 1500, stock: 1 }],
  });

  return tree;
};

// ---------- Listing ----------

test('unknown query parameters are ignored instead of emptying the list', async () => {
  await seedCatalogue();

  const res = await list('?utm_source=newsletter&fbclid=abc');

  assert.equal(res.status, 200);
  assert.equal(res.body.results, 3);
});

test('query operators outside the allowlist never reach the database', async () => {
  await seedCatalogue();

  const res = await list('?name[$ne]=x');

  assert.equal(res.status, 400);
});

test('total counts the filtered products, not the whole collection', async () => {
  await seedCatalogue();

  const res = await list('?variants.color=black');

  assert.equal(res.body.total, 1);
  assert.equal(res.body.results, 1);
});

test('the size filter matches the stored upper-case sizes', async () => {
  await seedCatalogue();

  const res = await list('?variants.size=m');

  assert.equal(res.body.results, 2);
});

test('a variant filter returns only the matching variants of each product', async () => {
  await seedCatalogue();

  const res = await list('?variants.color=white');

  assert.equal(res.body.results, 1);
  assert.deepEqual(
    res.body.data.products[0].variants.map((variant) => variant.color),
    ['white'],
  );
});

test('repeated and comma-separated variant values mean "any of these"', async () => {
  await seedCatalogue();

  const repeated = await list('?variants.color=black&variants.color=red');
  const commaSeparated = await list('?variants.color=black,red');

  assert.equal(repeated.body.results, 2);
  assert.equal(commaSeparated.body.results, 2);
});

test('mainCategory covers the category and its subcategories; categoryId narrows it', async () => {
  const tree = await seedCatalogue();

  const men = await list(`?mainCategory=${tree.men._id}`);
  const shoes = await list(`?mainCategory=${tree.men._id}&categoryId=${tree.menShoes._id}`);

  assert.equal(men.body.total, 2);
  assert.equal(shoes.body.total, 1);
  assert.equal(shoes.body.data.products[0].name, 'Black sneakers');
});

test('a range filter on an allowlisted field works', async () => {
  await seedCatalogue();

  const res = await list('?variants.price[gte]=1000');

  assert.equal(res.body.results, 1);
  assert.equal(res.body.data.products[0].name, 'Red heels');
});

test('invalid pagination values are a 400 and limit is capped', async () => {
  await seedCatalogue();

  assert.equal((await list('?page=-1')).status, 400);
  assert.equal((await list('?page=abc')).status, 400);
  assert.equal((await list('?limit=0')).status, 400);

  const capped = await list('?limit=99999');
  assert.equal(capped.status, 200);
  assert.equal(capped.body.results, 3);
});

test('pages do not overlap even when every product shares the sort value', async () => {
  const { menShoes } = await h.createCategoryTree();
  const createdAt = new Date('2026-01-01T00:00:00Z');
  for (let i = 0; i < 5; i += 1) {
    await h.createProduct(menShoes, { createdAt });
  }

  const first = await list('?limit=2&page=1');
  const second = await list('?limit=2&page=2');
  const third = await list('?limit=2&page=3');

  const ids = [first, second, third].flatMap((res) => res.body.data.products.map((p) => p._id));
  assert.equal(new Set(ids).size, 5);
  assert.equal(first.body.total, 5);
});

test('an unknown sort field falls back to the default instead of failing', async () => {
  await seedCatalogue();

  const res = await list('?sort=price-low-to-high');

  assert.equal(res.status, 200);
  assert.equal(res.body.results, 3);
});

test('the best-selling alias sorts by units sold', async () => {
  const { menShoes } = await h.createCategoryTree();
  await h.createProduct(menShoes, { name: 'Slow seller' });
  const hit = await h.createProduct(menShoes, { name: 'Best seller' });
  await Product.updateOne({ _id: hit._id }, { $set: { 'variants.0.soldCount': 40 } });

  const res = await h.api().get('/api/v1/products/best-selling');

  assert.equal(res.body.data.products[0].name, 'Best seller');
});

test('products expose the variantsNum virtual and their own creation time', async () => {
  const { menShoes } = await h.createCategoryTree();
  const first = await h.createProduct(menShoes);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await h.createProduct(menShoes);

  const res = await h.api().get(`/api/v1/products/${first._id}`);

  assert.equal(res.body.data.product.variantsNum, 1);
  assert.notEqual(first.createdAt.getTime(), second.createdAt.getTime());
});

// ---------- Create / update ----------

test('an admin creates a product from a JSON body with image URLs', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();

  const res = await h.api().post('/api/v1/products').set(auth).send(h.productPayload(menShoes));

  assert.equal(res.status, 201);
  const [variant] = res.body.data.product.variants;
  assert.match(variant.sku, /^MEN-SHO-BLA-M-001-\d{4}$/);
});

test('a product can be created directly in a main category', async () => {
  const { auth } = await h.createAdmin();
  const { men } = await h.createCategoryTree();

  const res = await h.api().post('/api/v1/products').set(auth).send(h.productPayload(men));

  assert.equal(res.status, 201);
  assert.match(res.body.data.product.variants[0].sku, /^MEN-BLA-M-001-\d{4}$/);
});

test('creating a product in a category that does not exist is a 400', async () => {
  const { auth } = await h.createAdmin();

  const res = await h
    .api()
    .post('/api/v1/products')
    .set(auth)
    .send(h.productPayload({ _id: '64f0000000000000000000ff' }));

  assert.equal(res.status, 400);
  assert.match(res.body.message, /category/i);
});

test('a body without a variants array is rejected (the old multipart upload)', async () => {
  const { auth } = await h.createAdmin();

  const res = await h
    .api()
    .post('/api/v1/products')
    .set(auth)
    .field('name', 'Multipart product')
    .field('variants', '[{"price":500}]');

  assert.equal(res.status, 400);
  assert.match(res.body.message, /variants/i);
});

test('images outside the configured Cloudinary account are rejected', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();

  const res = await h
    .api()
    .post('/api/v1/products')
    .set(auth)
    .send(h.productPayload(menShoes, { coverImage: 'https://evil.example.com/x.jpg' }));

  assert.equal(res.status, 400);
});

test('a discount at or above the price is rejected on create', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();

  const res = await h
    .api()
    .post('/api/v1/products')
    .set(auth)
    .send(
      h.productPayload(menShoes, {
        variants: [{ size: 'M', color: 'black', price: 500, priceDiscount: 500, stock: 1 }],
      }),
    );

  assert.equal(res.status, 400);
  assert.match(res.body.message, /discount/i);
});

test('updating text fields keeps images and variants untouched', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes);

  const res = await h
    .api()
    .patch(`/api/v1/products/${product._id}`)
    .set(auth)
    .send({ name: 'Renamed product' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.product.name, 'Renamed product');
  assert.equal(res.body.data.product.coverImage, product.coverImage);
  assert.equal(res.body.data.product.variants[0].sku, product.variants[0].sku);
});

test('replacing the cover deletes the old image from Cloudinary', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes, { coverImage: h.imageUrl('old-cover') });

  const res = await h
    .api()
    .patch(`/api/v1/products/${product._id}`)
    .set(auth)
    .send({ coverImage: h.imageUrl('new-cover') });

  assert.equal(res.status, 200);
  assert.deepEqual(h.destroyedImages, ['products/old-cover']);
});

// ---------- Variants ----------

const variantUrl = (product, variant) => `/api/v1/products/${product._id}/variants/${variant._id}`;

test('a valid discount can be set when editing a variant', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes);

  const res = await h
    .api()
    .patch(variantUrl(product, product.variants[0]))
    .set(auth)
    .send({ size: 'M', color: 'black', price: 200, stock: 3, priceDiscount: 150 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.product.variants[0].priceDiscount, 150);
});

test('editing a variant keeps its SKU, so bag items still resolve', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes);
  const [{ sku }] = product.variants;

  const res = await h
    .api()
    .patch(variantUrl(product, product.variants[0]))
    .set(auth)
    .send({ color: 'green', stock: 9 });

  assert.equal(res.body.data.product.variants[0].sku, sku);
  assert.equal(res.body.data.product.variants[0].color, 'green');
});

test('a discount at or above the price is rejected when editing', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes);

  const res = await h
    .api()
    .patch(variantUrl(product, product.variants[0]))
    .set(auth)
    .send({ priceDiscount: 500 });

  assert.equal(res.status, 400);
});

test('lowering the price below an existing discount is rejected', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes, {
    variants: [{ size: 'M', color: 'black', price: 500, priceDiscount: 400, stock: 1 }],
  });

  const res = await h
    .api()
    .patch(variantUrl(product, product.variants[0]))
    .set(auth)
    .send({ price: 300 });

  assert.equal(res.status, 400);
  assert.match(res.body.message, /discount/i);
});

test('sending null removes a discount', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes, {
    variants: [{ size: 'M', color: 'black', price: 500, priceDiscount: 400, stock: 1 }],
  });

  const res = await h
    .api()
    .patch(variantUrl(product, product.variants[0]))
    .set(auth)
    .send({ priceDiscount: null });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.product.variants[0].priceDiscount, undefined);
});

test('adding a variant gives it a SKU and leaves the existing ones alone', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes);
  const [{ sku }] = product.variants;

  const res = await h
    .api()
    .post(`/api/v1/products/${product._id}/variants`)
    .set(auth)
    .send({ color: 'White', price: 650, stock: 2 });

  assert.equal(res.status, 201);
  const { variants } = res.body.data.product;
  assert.equal(variants.length, 2);
  assert.equal(variants[0].sku, sku);
  assert.match(variants[1].sku, /^MEN-SHO-WHI-M-002-\d{4}$/);
});

test('an invalid new variant is rejected', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes);

  const res = await h
    .api()
    .post(`/api/v1/products/${product._id}/variants`)
    .set(auth)
    .send({ color: 'White', price: 50, stock: 2 });

  assert.equal(res.status, 400);
});

test('a variant can be deleted, but not the last one', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  const product = await h.createProduct(menShoes, {
    variants: [
      { size: 'M', color: 'black', price: 500, stock: 1 },
      { size: 'L', color: 'black', price: 500, stock: 1 },
    ],
  });

  const first = await h.api().delete(variantUrl(product, product.variants[0])).set(auth);
  const last = await h.api().delete(variantUrl(product, product.variants[1])).set(auth);

  assert.equal(first.status, 204);
  assert.equal(last.status, 400);
  assert.equal((await Product.findById(product._id)).variants.length, 1);
});
