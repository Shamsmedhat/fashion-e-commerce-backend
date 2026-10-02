/* eslint-disable no-console */
// Runs the API against a throwaway in-memory MongoDB, seeded with the demo catalogue and two
// accounts. Nothing touches the real database or Cloudinary, so it is safe for local development
// and is what the frontends' end-to-end tests run against.
//
//   yarn dev:memory            (API on http://localhost:3000/api/v1)
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const mongoose = require('mongoose');

const seed = require('../data/products.json');

// The seeded image URLs belong to this Cloudinary cloud; the key and secret are placeholders.
const [, cloudName] = seed[0].coverImage.match(/res\.cloudinary\.com\/([^/]+)\//);

Object.assign(process.env, {
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: 'local-development-secret',
  JWT_EXPIRES_IN: '7d',
  CLOUDINARY_CLOUD_NAME: cloudName,
  CLOUDINARY_API_KEY: 'local-key',
  CLOUDINARY_API_SECRET: 'local-secret',
});

const cloudinary = require('cloudinary').v2;
const app = require('../app');
const User = require('../models/userModel');
const { importCatalogue } = require('../lib/seedCatalogue');

// Deleting a product must not call the real Cloudinary API with placeholder credentials.
cloudinary.uploader.destroy = async () => ({ result: 'ok' });

const ACCOUNTS = [
  {
    name: 'Demo Admin',
    email: 'admin@example.com',
    phone: '01111803604',
    password: 'Shams@123',
    role: 'admin',
  },
  {
    name: 'Demo Shopper',
    email: 'shopper@example.com',
    phone: '01000000001',
    password: 'Shopper@123',
    role: 'user',
    addresses: [{ label: 'Home', city: 'Cairo', street: '12 Nile Street', isDefault: true }],
  },
];

const start = async () => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  await importCatalogue();

  for (const { role, ...account } of ACCOUNTS) {
    const user = await User.create({ ...account, passwordConfirm: account.password });
    await User.updateOne({ _id: user._id }, { role });
  }

  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => {
    console.log(`API with in-memory database on http://localhost:${port}/api/v1`);
    ACCOUNTS.forEach(({ role, phone, password }) =>
      console.log(`  ${role}: ${phone} / ${password}`),
    );
  });

  const stop = async () => {
    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
