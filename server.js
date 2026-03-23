/* eslint-disable no-console */
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Handle 'UNCAUGHT EXCEPTIONS'

process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  process.exit(1);
});

dotenv.config({ path: './config.env' });
const app = require('./app');

const DB = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

mongoose.connect(DB).then(() => console.log('DB connection successful!'));
const port = 3000;

const server = app.listen(port, () => {
  console.log(`App running on port ${port}...`);
});

// Handle 'UNHANDELED PROMISE REJECTIONS'
process.on('unhandledRejection', (err) => {
  console.log(err.name, err.message);
  console.log('UNHANDLED REJECTION! 💥 Shutting down...');
  server.close(() => {
    process.exit(1);
  });
});
