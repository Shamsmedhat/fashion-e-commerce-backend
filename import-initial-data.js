/* eslint-disable no-console */
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// config.env — loaded before the models so they see the Cloudinary account the images belong to.
dotenv.config({ path: './config.env' });

const { deleteCatalogue, importCatalogue } = require('./lib/seedCatalogue');

// --import adds the demo catalogue, --delete removes every product and category,
// --reset does both (use it to restore the shop after the demo data was changed).
const actions = {
  '--import': importCatalogue,
  '--delete': deleteCatalogue,
  '--reset': async () => {
    await deleteCatalogue();
    await importCatalogue();
  },
};

const run = async () => {
  const action = actions[process.argv[2]];

  if (!action) {
    console.log('Usage: node import-initial-data.js --import | --delete | --reset');
    process.exit(1);
  }

  try {
    const DB = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
    await mongoose.connect(DB);
    console.log('DB connection successful!');

    await action();
    console.log(`Done: ${process.argv[2].slice(2)}`);
  } catch (error) {
    console.log(`Something went wrong!\n${error}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
