# Stripe Checkout Setup (Card Payments)

## 1) Keys and environment variables
- In Stripe Dashboard (Test mode), copy:
  - Secret key -> `STRIPE_SECRET_KEY`
  - Webhook signing secret -> `STRIPE_WEBHOOK_SECRET`
- Add them to `config.env`.

## 2) Webhook endpoint
- In Stripe Dashboard -> Developers -> Webhooks -> Add endpoint.
- Endpoint URL:
  - Local example: `http://localhost:3000/api/v1/checkout/webhook`
  - Production example: `https://your-domain.com/api/v1/checkout/webhook`
- Listen to events:
  - `checkout.session.completed`
  - `checkout.session.expired`

## 3) Frontend redirect URLs
- Your frontend sends these values to backend endpoint `POST /api/v1/checkout/card-session`:
  - `successUrl` (where user returns after successful payment)
  - `cancelUrl` (where user returns after canceling payment)

## 4) Local development tip
- If testing locally, use Stripe CLI tunnel:
  - `stripe listen --forward-to localhost:3000/api/v1/checkout/webhook`
- Then use the printed webhook secret for `STRIPE_WEBHOOK_SECRET`.

## 5) Card test data
- Stripe test card: `4242 4242 4242 4242`
- Any future expiry date, any 3-digit CVC, any postal code.
