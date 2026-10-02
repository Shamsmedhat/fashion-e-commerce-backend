/* eslint-disable no-console */
const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');
const jwt = require('jsonwebtoken');

const h = require('../test-support/harness');

before(h.start);
after(h.stop);
beforeEach(h.reset);

test('a garbage bearer token is rejected with 401, not 500', async () => {
  const res = await h.api().get('/api/v1/bags/me').set('Authorization', 'Bearer null');

  assert.equal(res.status, 401);
  assert.equal(res.body.status, 'fail');
});

test('an expired token is rejected with 401', async () => {
  const { user } = await h.createUser();
  const expired = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: -10 });

  const res = await h.api().get('/api/v1/users/me').set('Authorization', `Bearer ${expired}`);

  assert.equal(res.status, 401);
  assert.match(res.body.message, /expired/i);
});

test('a request without a token is rejected with 401', async () => {
  const res = await h.api().get('/api/v1/users/me');

  assert.equal(res.status, 401);
});

test('a malformed JSON body is a 400', async () => {
  const res = await h
    .api()
    .post('/api/v1/users/login')
    .set('Content-Type', 'application/json')
    .send('{"email": ');

  assert.equal(res.status, 400);
});

test('an invalid document id is a 400', async () => {
  const res = await h.api().get('/api/v1/products/not-an-id');

  assert.equal(res.status, 400);
});

test('an unknown route is a 404 with the JSON error shape', async () => {
  const res = await h.api().get('/api/v1/nope');

  assert.equal(res.status, 404);
  assert.equal(res.body.status, 'fail');
});

test('errors still get a response when NODE_ENV is not set', async () => {
  const original = process.env.NODE_ENV;
  const originalLog = console.log;
  delete process.env.NODE_ENV;
  console.log = () => {};

  try {
    const res = await h.api().get('/api/v1/products/not-an-id');
    assert.equal(res.status, 400);
  } finally {
    process.env.NODE_ENV = original;
    console.log = originalLog;
  }
});

test('a non-admin cannot write to the catalogue', async () => {
  const { auth } = await h.createUser();
  const { menShoes } = await h.createCategoryTree();

  const res = await h.api().post('/api/v1/products').set(auth).send(h.productPayload(menShoes));

  assert.equal(res.status, 403);
});
