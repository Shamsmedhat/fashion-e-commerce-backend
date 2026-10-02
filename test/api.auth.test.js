const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');

const h = require('../test-support/harness');

const { User } = h.models;

before(h.start);
after(h.stop);
beforeEach(h.reset);

const signupBody = (overrides = {}) => ({
  name: 'Mona Adel',
  email: 'mona@example.com',
  phone: '01012345678',
  password: h.PASSWORD,
  passwordConfirm: h.PASSWORD,
  ...overrides,
});

test('signup creates the user, returns a token and never returns the password', async () => {
  const res = await h.api().post('/api/v1/users/signup').send(signupBody());

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.data.user.password, undefined);
  assert.equal(res.body.data.user.role, 'user');
});

test('signup cannot grant itself the admin role', async () => {
  const res = await h
    .api()
    .post('/api/v1/users/signup')
    .send(signupBody({ role: 'admin' }));

  assert.equal(res.body.data.user.role, 'user');
});

test('signup stores the delivery address as the default one', async () => {
  const res = await h
    .api()
    .post('/api/v1/users/signup')
    .send(signupBody({ address: { city: 'Cairo', street: '12 Nile St' } }));

  assert.equal(res.body.data.user.addresses.length, 1);
  assert.equal(res.body.data.user.addresses[0].isDefault, true);
});

test('a duplicate email is a 409 and creates nothing', async () => {
  await h.api().post('/api/v1/users/signup').send(signupBody());

  const res = await h
    .api()
    .post('/api/v1/users/signup')
    .send(signupBody({ phone: '01087654321' }));

  assert.equal(res.status, 409);
  assert.equal(await User.countDocuments(), 1);
});

test('a weak password is a 400', async () => {
  const res = await h
    .api()
    .post('/api/v1/users/signup')
    .send(signupBody({ password: 'weakpass', passwordConfirm: 'weakpass' }));

  assert.equal(res.status, 400);
});

test('login works with the email or the phone number', async () => {
  const { user } = await h.createUser();

  const byEmail = await h
    .api()
    .post('/api/v1/users/login')
    .send({ email: user.email, password: h.PASSWORD });
  const byPhone = await h
    .api()
    .post('/api/v1/users/login')
    .send({ phone: user.phone, password: h.PASSWORD });

  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.body.status, 'success');
  assert.ok(byEmail.body.token);
  assert.equal(byPhone.status, 200);
});

test('a wrong password is a 401', async () => {
  const { user } = await h.createUser();

  const res = await h
    .api()
    .post('/api/v1/users/login')
    .send({ email: user.email, password: 'Wrong@123' });

  assert.equal(res.status, 401);
});

test('a query operator in place of the email is rejected before it reaches the database', async () => {
  await h.createUser();

  const res = await h
    .api()
    .post('/api/v1/users/login')
    .send({ email: { $gt: '' }, password: h.PASSWORD });

  assert.equal(res.status, 400);
});

test('login can attach a delivery address to an existing account', async () => {
  const { user } = await h.createUser();

  const res = await h
    .api()
    .post('/api/v1/users/login')
    .send({
      email: user.email,
      password: h.PASSWORD,
      address: { city: 'Giza', street: '5 Pyramid Rd' },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.addresses.length, 1);
});

// ---------- Addresses ----------

test('the first saved address becomes the default', async () => {
  const { auth } = await h.createUser();

  const res = await h
    .api()
    .post('/api/v1/users/me/addresses')
    .set(auth)
    .send({ city: 'Cairo', street: '12 Nile St' });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.addresses.length, 1);
  assert.equal(res.body.data.user.addresses[0].isDefault, true);
  assert.equal(res.body.data.user.addresses[0].label, 'Home');
});

test('a later address only replaces the default when asked to', async () => {
  const { auth } = await h.createUser();
  const add = (body) => h.api().post('/api/v1/users/me/addresses').set(auth).send(body);

  await add({ city: 'Cairo', street: '12 Nile St' });
  const second = await add({ label: 'Work', city: 'Giza', street: '5 Pyramid Rd' });
  const third = await add({ label: 'Beach', city: 'Alex', street: '9 Sea St', isDefault: true });

  assert.deepEqual(
    second.body.data.user.addresses.map((address) => address.isDefault),
    [true, false],
  );
  assert.deepEqual(
    third.body.data.user.addresses.map((address) => address.isDefault),
    [false, false, true],
  );
});

test('an address needs a city and a street, and a logged-in user', async () => {
  const { auth } = await h.createUser();

  const incomplete = await h
    .api()
    .post('/api/v1/users/me/addresses')
    .set(auth)
    .send({ city: 'Cairo' });
  const anonymous = await h
    .api()
    .post('/api/v1/users/me/addresses')
    .send({ city: 'Cairo', street: '12 Nile St' });

  assert.equal(incomplete.status, 400);
  assert.equal(anonymous.status, 401);
});
