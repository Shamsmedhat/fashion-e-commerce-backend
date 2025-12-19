/* eslint-disable no-console */
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: './config.env' });
const app = require('./app');

const DB = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

mongoose.connect(DB).then(() => console.log('DB connection successful!'));
const port = 3000;

app.listen(port, () => {
  console.log(`App running on port ${port}...`);
});

// shamsmedhat1_db_user
// ERsYukCBSNvxEW1G
