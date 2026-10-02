const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');

const h = require('../test-support/harness');

const { Category } = h.models;

before(h.start);
after(h.stop);
beforeEach(h.reset);

const pathOf = async (category) => (await Category.findById(category._id)).path;

test('the main-categories total counts main categories only', async () => {
  await h.createCategoryTree();

  const res = await h.api().get('/api/v1/categories/main');

  assert.equal(res.body.total, 2);
  assert.equal(res.body.results, 2);
});

test('several slugs can be requested at once', async () => {
  await h.createCategoryTree();

  const res = await h.api().get('/api/v1/categories?slug=men&slug=men-shoes&slug=women');

  assert.equal(res.body.total, 3);
});

test('creating a category derives slug and path and ignores client-supplied ones', async () => {
  const { auth } = await h.createAdmin();
  const { men } = await h.createCategoryTree();

  const res = await h
    .api()
    .post('/api/v1/categories')
    .set(auth)
    .send({ name: 'Bottoms', parentId: String(men._id), slug: 'hacked', path: 'hacked' });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.category.slug, 'men-bottoms');
  assert.equal(res.body.data.category.path, 'men/bottoms');
});

test('creating a category under a parent that does not exist is a 400', async () => {
  const { auth } = await h.createAdmin();

  const res = await h
    .api()
    .post('/api/v1/categories')
    .set(auth)
    .send({ name: 'Orphan', parentId: '64f0000000000000000000ff' });

  assert.equal(res.status, 400);
});

test('a duplicate category path is a 409', async () => {
  const { auth } = await h.createAdmin();
  const { men } = await h.createCategoryTree();

  const res = await h
    .api()
    .post('/api/v1/categories')
    .set(auth)
    .send({ name: 'Shoes', parentId: String(men._id) });

  assert.equal(res.status, 409);
});

// ---------- Delete ----------

test('deleting an unused category really removes it', async () => {
  const { auth } = await h.createAdmin();
  const { men } = await h.createCategoryTree();
  const empty = await h.createCategory('Bottoms', men);

  const res = await h.api().delete(`/api/v1/categories/${empty._id}`).set(auth);
  const listed = await h.api().get('/api/v1/categories?limit=100');

  assert.equal(res.status, 204);
  assert.equal(
    listed.body.data.categories.some((category) => category._id === String(empty._id)),
    false,
  );
});

test('a category that still has subcategories cannot be deleted', async () => {
  const { auth } = await h.createAdmin();
  const { men } = await h.createCategoryTree();

  const res = await h.api().delete(`/api/v1/categories/${men._id}`).set(auth);

  assert.equal(res.status, 409);
  assert.match(res.body.message, /subcategories/i);
  assert.ok(await Category.exists({ _id: men._id }));
});

test('a category that still has products cannot be deleted', async () => {
  const { auth } = await h.createAdmin();
  const { menShoes } = await h.createCategoryTree();
  await h.createProduct(menShoes);

  const res = await h.api().delete(`/api/v1/categories/${menShoes._id}`).set(auth);

  assert.equal(res.status, 409);
  assert.match(res.body.message, /products/i);
});

// ---------- Rename / move ----------

test('renaming a main category rewrites the path and slug of its subcategories', async () => {
  const { auth } = await h.createAdmin();
  const { men, menShoes } = await h.createCategoryTree();

  const res = await h
    .api()
    .patch(`/api/v1/categories/${men._id}`)
    .set(auth)
    .send({ name: 'Gents' });

  const child = await Category.findById(menShoes._id);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.category.path, 'gents');
  assert.equal(child.path, 'gents/shoes');
  assert.equal(child.slug, 'gents-shoes');
});

test('moving a subcategory to the top level recalculates its path and slug', async () => {
  const { auth } = await h.createAdmin();
  const { menAccessories } = await h.createCategoryTree();

  const res = await h
    .api()
    .patch(`/api/v1/categories/${menAccessories._id}`)
    .set(auth)
    .send({ name: 'Accessories', parentId: null });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.category.parentId, null);
  assert.equal(res.body.data.category.path, 'accessories');
  assert.equal(res.body.data.category.slug, 'accessories');
});

test('moving a subcategory under another main category recalculates its path', async () => {
  const { auth } = await h.createAdmin();
  const { menAccessories, women } = await h.createCategoryTree();

  const res = await h
    .api()
    .patch(`/api/v1/categories/${menAccessories._id}`)
    .set(auth)
    .send({ parentId: String(women._id) });

  assert.equal(res.body.data.category.path, 'women/accessories');
});

test('a category cannot become its own parent or move under its own subcategory', async () => {
  const { auth } = await h.createAdmin();
  const { men, menShoes } = await h.createCategoryTree();

  const self = await h
    .api()
    .patch(`/api/v1/categories/${men._id}`)
    .set(auth)
    .send({ parentId: String(men._id) });
  const descendant = await h
    .api()
    .patch(`/api/v1/categories/${men._id}`)
    .set(auth)
    .send({ parentId: String(menShoes._id) });

  assert.equal(self.status, 400);
  assert.equal(descendant.status, 400);
  assert.equal(await pathOf(men), 'men');
});

test('a rename that collides with an existing path changes nothing at all', async () => {
  const { auth } = await h.createAdmin();
  const { men, menShoes } = await h.createCategoryTree();

  // "women" already exists, so renaming "men" to it must fail and leave the children untouched.
  const res = await h
    .api()
    .patch(`/api/v1/categories/${men._id}`)
    .set(auth)
    .send({ name: 'Women' });

  assert.equal(res.status, 409);
  assert.equal(await pathOf(men), 'men');
  assert.equal(await pathOf(menShoes), 'men/shoes');
});
