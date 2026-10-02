# Fashion E-Commerce API

[![CI](https://github.com/Shamsmedhat/fashion-e-commerce-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/Shamsmedhat/fashion-e-commerce-backend/actions/workflows/ci.yml)

REST API for a fashion store: catalogue, shopping bag, checkout (cash and Stripe card payments)
and JWT authentication. It serves two clients:

| Client                                                                        | What it is                       |
| ----------------------------------------------------------------------------- | -------------------------------- |
| [Storefront](https://github.com/Shamsmedhat/fashion-e-commerce-frontend)      | Next.js shop — browse, bag, pay  |
| [Admin dashboard](https://github.com/Shamsmedhat/fashion-ecommerce-dashboard) | React CMS — products, categories |

**Live:** `https://fashion-ecommerce-backend-teal.vercel.app/api/v1`

## Stack

Node.js · Express 4 · MongoDB (Mongoose 9) · JWT · Stripe · Cloudinary · deployed on Vercel

## Run it locally

The quickest way needs no database and no accounts. It starts the API on a throwaway in-memory
MongoDB, seeded with the demo catalogue and two users:

```bash
yarn install
yarn dev:memory        # http://localhost:3000/api/v1
```

| Account | Phone         | Password      |
| ------- | ------------- | ------------- |
| Admin   | `01111803604` | `Shams@123`   |
| Shopper | `01000000001` | `Shopper@123` |

To run against a real MongoDB, Cloudinary and Stripe instead:

```bash
cp config.env.example config.env    # fill in the values
yarn dev
```

## Scripts

| Command            | What it does                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| `yarn dev`         | API with reload, using `config.env`                                      |
| `yarn dev:memory`  | API on a seeded in-memory database (nothing real is touched)             |
| `yarn test`        | Unit and integration tests                                               |
| `yarn lint`        | ESLint + Prettier check                                                  |
| `yarn add:data`    | Import the demo catalogue into the configured database                   |
| `yarn reset:data`  | Delete all products and categories, then import the demo catalogue again |
| `yarn delete:data` | Delete all products and categories                                       |

The demo catalogue in `data/` is a snapshot of the live shop (same ids, SKUs and image URLs), so
`yarn reset:data` restores the shop after the demo data has been changed.

## API

All routes are under `/api/v1`. Send `Authorization: Bearer <token>` on protected routes.

| Method   | Route                           | Access | Purpose                                          |
| -------- | ------------------------------- | ------ | ------------------------------------------------ |
| `POST`   | `/users/signup`                 | public | Create an account                                |
| `POST`   | `/users/login`                  | public | Log in with email or phone                       |
| `GET`    | `/users/me`                     | user   | The logged-in user                               |
| `POST`   | `/users/me/addresses`           | user   | Save a delivery address                          |
| `GET`    | `/products`                     | public | List products (filter, sort, paginate)           |
| `GET`    | `/products/best-selling`        | public | Top 6 by units sold                              |
| `GET`    | `/products/top-rating`          | public | Top 6 by rating                                  |
| `GET`    | `/products/:id`                 | public | One product                                      |
| `POST`   | `/products`                     | admin  | Create a product                                 |
| `PATCH`  | `/products/:id`                 | admin  | Update name, description, category or images     |
| `DELETE` | `/products/:id`                 | admin  | Delete a product and its unused images           |
| `GET`    | `/products/upload-signature`    | admin  | Signature for a direct Cloudinary upload         |
| `GET`    | `/products/:id/variants`        | public | A product's variants                             |
| `POST`   | `/products/:id/variants`        | admin  | Add a variant                                    |
| `PATCH`  | `/products/:id/variants/:varId` | admin  | Edit a variant (`null` clears an optional field) |
| `DELETE` | `/products/:id/variants/:varId` | admin  | Delete a variant (not the last one)              |
| `GET`    | `/categories`                   | public | List categories                                  |
| `GET`    | `/categories/main`              | public | Main categories only                             |
| `GET`    | `/categories/children/:id`      | public | Subcategories of a category                      |
| `GET`    | `/categories/:id`               | public | One category                                     |
| `POST`   | `/categories`                   | admin  | Create a category                                |
| `PATCH`  | `/categories/:id`               | admin  | Rename or move a category                        |
| `DELETE` | `/categories/:id`               | admin  | Delete a category that is no longer used         |
| `POST`   | `/users/bag/add`                | user   | Add an item to the bag                           |
| `GET`    | `/bags/me`                      | user   | The bag                                          |
| `GET`    | `/bags/me/items`                | user   | Bag items with product details and totals        |
| `PATCH`  | `/bags/me/items/:itemId`        | user   | Change quantity or variant                       |
| `DELETE` | `/bags/me/items/:itemId`        | user   | Remove an item                                   |
| `DELETE` | `/bags/me`                      | user   | Empty the bag                                    |
| `POST`   | `/checkout/cash`                | user   | Place a cash-on-delivery order                   |
| `POST`   | `/checkout/card-session`        | user   | Start a Stripe Checkout session                  |
| `POST`   | `/checkout/webhook`             | Stripe | Payment confirmation                             |

### Lists

`GET /products` and `GET /categories` accept:

- `page` and `limit` — positive integers; `limit` is capped at 100 and defaults to 10.
- `sort` — comma-separated fields, `-` for descending, e.g. `sort=-createdAt`.
- `fields` — comma-separated fields to return.
- Filters on an allowlist of fields, as equality (`categoryId=…`), a list (`slug=a&slug=b`) or a
  range (`variants.price[gte]=500`). **Any other parameter is ignored**, so tracking parameters
  never change a result, and no query operator can be injected.
- Products only: `mainCategory=<id>` (a category and its subcategories) and variant filters
  `variants.color`, `variants.size`, `variants.price`, `variants.stock` (repeat or comma-separate
  for "any of").

`total` in the response is the number of matches, not the size of the page.

### Errors

Every error has the same shape:

```json
{ "status": "fail", "message": "Human-readable reason" }
```

`400` invalid input · `401` missing, invalid or expired token · `403` not allowed · `404` not
found · `409` conflict (duplicate value, category still in use, item out of stock) · `429` rate
limited · `500` unexpected (details are logged, never returned).

### Things worth knowing

- **Variants are referenced by SKU** from bags and orders, so a SKU never changes once assigned.
- **Stock** is taken when an order is placed (cash) or paid (card), atomically and inside a
  transaction; two shoppers cannot both buy the last unit. A card payment that finds the stock
  gone is still recorded as paid and flagged `needsReview`.
- **Categories** form a tree. Renaming or moving one rewrites the `path` and `slug` of its
  subcategories in the same transaction. A category with subcategories or products cannot be
  deleted.
- **Rate limits** are kept in memory, so on serverless hosting each instance counts separately.

## Tests

```bash
yarn test
```

- **Integration tests** (`test/api.*.test.js`) send real HTTP requests to the Express app, backed
  by an in-memory MongoDB replica set (a replica set because checkout, sign-up and category
  updates use transactions). They cover authentication, the catalogue lists, product and variant
  editing, the category tree, the bag, checkout stock handling and the Stripe webhook.
- **Unit tests** cover the Cloudinary image guard and the error handler.

The first run downloads a MongoDB binary (about 100 MB) into the local cache.

`scripts/smoke-live.sh` runs read-only checks against the three live deployments; run it after a
deploy.

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

- `200` means the raw body arrived intact and the signature verified. A test event is not about
  one of this shop's orders, so it is acknowledged and ignored (`"ignored": true` in the response).
- `500` with `Webhook raw body unavailable` means the request stream was consumed before the
  function ran. Signature verification cannot succeed in that state; the function returns an error
  on purpose so Stripe records a failed delivery and retries rather than leaving an order silently
  unconfirmed.
- `400` means the body arrived but the signature did not match, which normally means
  `STRIPE_WEBHOOK_SECRET` does not match this endpoint's signing secret.

A test event only exercises signature verification. To confirm the full path, complete one real
low-value card checkout and verify the order's `paymentStatus` becomes `paid`, the stock goes down
and the bag is emptied.
