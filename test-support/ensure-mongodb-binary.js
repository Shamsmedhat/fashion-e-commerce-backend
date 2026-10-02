/* eslint-disable no-console */
// Downloads the in-memory MongoDB binary once, before the test files run. Each test file is its
// own process, and on a cold cache they would otherwise all try to download it at the same time.
const { MongoBinary } = require('mongodb-memory-server-core');

MongoBinary.getPath().catch((error) => {
  console.error('Could not prepare the MongoDB test binary:', error.message);
  process.exit(1);
});
