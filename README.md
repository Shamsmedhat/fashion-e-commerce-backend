# fashion-e-commerce

## Product image uploads

Product images upload directly from the authenticated admin browser to Cloudinary. Image bytes must
not be sent to this API.

1. Request `GET /api/v1/products/upload-signature` with the same admin authentication used to
   create products. The response contains `timestamp`, `folder`, `signature`, `cloudName`, and
   `apiKey`.
2. Send each image as multipart form data directly to
   `https://api.cloudinary.com/v1_1/<cloudName>/image/upload`, including the returned `timestamp`,
   `folder`, `signature`, and `api_key`.
3. Send the Cloudinary `secure_url` values to this API as JSON in `coverImage`, `images`, and any
   variant `images`. The API accepts only URLs from its configured Cloudinary account and returns
   the same product JSON fields as before.

Stored delivery URLs apply `w_1200,h_1200,c_fill,q_90,f_jpg`. Replacing an image or deleting its
product/variant also deletes the no-longer-referenced Cloudinary asset.

## Vercel production configuration

Set these environment variables for the Vercel Production environment:

- `NODE_ENV=production`
- `DATABASE` — MongoDB Atlas URI; it may contain the `<PASSWORD>` placeholder
- `DATABASE_PASSWORD`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CORS_ORIGINS` — comma-separated production storefront and admin origins

Do not define `PORT` in Vercel. Local `yarn dev` continues to load `config.env`, which is gitignored.
Preview deployment origins are not automatically trusted; add a specific preview origin to
`CORS_ORIGINS` only when that preview needs API access.

The Atlas M0 network access list must allow `0.0.0.0/0` because Vercel function egress addresses are
not stable. Use a strong database user password and least-privilege database permissions to offset
the broad network rule.

After the first production deployment, create or update the Stripe webhook endpoint to:

`https://<production-api-domain>/api/v1/checkout/webhook`

Subscribe it to `checkout.session.completed` and `checkout.session.expired`, copy that endpoint's
signing secret into `STRIPE_WEBHOOK_SECRET`, and send a test event before moving production traffic.

### Verifying the webhook after deploying

The webhook is served by `api/stripe-webhook.js`, a dedicated function that reads the request stream
itself so Stripe signature verification always sees the exact bytes Stripe signed. Whether the
platform leaves that stream intact can only be confirmed against a real deployment, so run this
check after the first deploy and after any change to `vercel.json` or the API routing:

1. In the Stripe Dashboard, open Developers, then Webhooks, and select the endpoint pointing at
   `https://<production-api-domain>/api/v1/checkout/webhook`.
2. Click "Send test webhook", choose `checkout.session.completed`, and send it.
3. In that endpoint's delivery list, confirm the attempt shows HTTP `200`.

Interpreting the result:

- `200` means the raw body arrived intact and the signature verified.
- `500` with `Webhook raw body unavailable` means the request stream was consumed before the
  function ran. Signature verification cannot succeed in that state; the function returns an error
  on purpose so Stripe records a failed delivery and retries rather than leaving an order silently
  unconfirmed.
- `400` means the body arrived but the signature did not match, which normally means
  `STRIPE_WEBHOOK_SECRET` does not match this endpoint's signing secret.

A test event only exercises signature verification, because its `metadata.orderId` does not match a
real order. To confirm the full path, complete one real low-value card checkout and verify the
order's `paymentStatus` becomes `paid` and the bag is emptied.
