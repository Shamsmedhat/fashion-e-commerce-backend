/* eslint-disable no-console */
const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');

const h = require('../test-support/harness');
const { keyGenerators } = require('../lib/utils/rateLimiters');

// The limiters are switched off under NODE_ENV=test, so this file runs the app as production.
// (Counters are kept per process, and every test file is its own process.)
const originalLog = console.log;
const originalError = console.error;

before(async () => {
  await h.start();
  process.env.NODE_ENV = 'production';
  console.log = () => {};
  console.error = () => {};
});

after(async () => {
  console.log = originalLog;
  console.error = originalError;
  await h.stop();
});

beforeEach(h.reset);

const login = (identifier, password) =>
  h
    .api()
    .post('/api/v1/users/login')
    .send({ ...identifier, password });

// The storefront signs every shopper in from its own servers, so they all share an IP address.
test('failed logins lock out only the account they were for', async () => {
  const victim = await h.createUser();
  const bystander = await h.createUser();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await login({ email: victim.user.email }, 'Wrong@123');
    assert.equal(res.status, 401, `attempt ${attempt}`);
  }

  const locked = await login({ email: victim.user.email }, 'Wrong@123');
  const other = await login({ email: bystander.user.email }, h.PASSWORD);

  assert.equal(locked.status, 429);
  assert.equal(locked.body.status, 'fail');
  assert.match(locked.body.message, /too many/i);
  assert.equal(other.status, 200, 'another shopper on the same IP must still get in');
});

test('the lock applies however the identifier is typed', async () => {
  const { user } = await h.createUser();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await login({ email: user.email }, 'Wrong@123');
  }

  const upperCased = await login({ email: `  ${user.email.toUpperCase()} ` }, 'Wrong@123');

  assert.equal(upperCased.status, 429);
});

test('successful logins never count towards the limit', async () => {
  const { user } = await h.createUser();

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const res = await login({ phone: user.phone }, h.PASSWORD);
    assert.equal(res.status, 200, `attempt ${attempt}`);
  }
});

test('bag requests are counted per shopper, not per IP', async () => {
  const busy = await h.createUser();
  const other = await h.createUser();
  const bag = (auth) => h.api().get('/api/v1/bags/me').set(auth);

  for (let request = 1; request <= 30; request += 1) {
    const res = await bag(busy.auth);
    assert.equal(res.status, 200, `request ${request}`);
  }

  assert.equal((await bag(busy.auth)).status, 429);
  assert.equal((await bag(other.auth)).status, 200);
});

test('an unauthenticated request is rejected before it is counted against anyone', async () => {
  const res = await h.api().get('/api/v1/bags/me');

  assert.equal(res.status, 401);
});

test('limiter keys: an account, or the credential being tried from an IP', () => {
  const { byAccount, byCredential } = keyGenerators;

  assert.equal(byAccount({ user: { id: 'u1' }, ip: '1.2.3.4' }), 'user:u1');
  assert.equal(byAccount({ ip: '1.2.3.4' }), '1.2.3.4');

  assert.equal(byCredential({ ip: '1.2.3.4', body: { email: ' A@B.com ' } }), '1.2.3.4:a@b.com');
  assert.equal(byCredential({ ip: '1.2.3.4', body: { phone: '0101' } }), '1.2.3.4:0101');
  // Non-text identifiers (an injection attempt) all fall into the IP's shared bucket.
  assert.equal(byCredential({ ip: '1.2.3.4', body: { email: { $gt: '' } } }), '1.2.3.4:');
  assert.equal(byCredential({ ip: '1.2.3.4' }), '1.2.3.4:');
});
