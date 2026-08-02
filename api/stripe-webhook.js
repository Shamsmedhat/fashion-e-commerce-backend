/* eslint-disable no-console */
const app = require('../app');
const connectDatabase = require('../lib/db');

// Stripe signature verification needs the exact bytes Stripe signed, so this route is served by a
// dedicated function that opts out of platform body parsing and reads the stream itself.
const readRawBody = (req) =>
  new Promise((resolve, reject) => {
    if (req.readableEnded || req.readable === false) {
      resolve(Buffer.alloc(0));
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const handler = async (req, res) => {
  const rawBody = await readRawBody(req);

  // A consumed or pre-parsed stream means signature verification could never succeed. Failing here
  // makes Stripe record a failed delivery and retry, instead of the order silently never confirming.
  if (!rawBody.length) {
    console.error(
      'Stripe webhook received no raw body. The request stream was consumed before this function ran, so the signature cannot be verified.',
    );
    // Plain Node response API: this must work even without platform-added Express-style helpers.
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'error', message: 'Webhook raw body unavailable.' }));
    return undefined;
  }

  req.body = rawBody;
  // Tells body-parser the body is already read so it leaves our Buffer untouched.
  req._body = true;

  await connectDatabase();
  return app(req, res);
};

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
