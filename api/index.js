const app = require('../app');
const connectDatabase = require('../lib/db');

const handler = async (req, res) => {
  await connectDatabase();
  return app(req, res);
};

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
