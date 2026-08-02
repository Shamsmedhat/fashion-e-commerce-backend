const mongoose = require('mongoose');

const app = require('../app');

const globalCache = global;

if (!globalCache.mongooseConnection) {
  globalCache.mongooseConnection = {
    connection: null,
    promise: null,
  };
}

const connectDatabase = async () => {
  const cache = globalCache.mongooseConnection;

  if (cache.connection) return cache.connection;

  if (!cache.promise) {
    mongoose.set('bufferCommands', false);

    const databaseUri = process.env.DATABASE.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

    cache.promise = mongoose
      .connect(databaseUri, { serverSelectionTimeoutMS: 8000 })
      .then((connection) => connection)
      .catch((error) => {
        cache.promise = null;
        throw error;
      });
  }

  cache.connection = await cache.promise;
  return cache.connection;
};

const handler = async (req, res) => {
  await connectDatabase();
  return app(req, res);
};

handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;
