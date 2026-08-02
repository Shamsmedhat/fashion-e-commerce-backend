/* eslint-disable no-console */
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Handle 'UNCAUGHT EXCEPTIONS'

process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  process.exit(1);
});

// config.env is used for local development; deployed environments inject variables.
dotenv.config({ path: './config.env', quiet: true });
const app = require('./app');

const DB = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

mongoose.connect(DB).then(() => console.log('DB connection successful!'));
const port = process.env.PORT || 3000;

const server = app.listen(port, '0.0.0.0', () => {
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
