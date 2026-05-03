# Paddle Setup

Quilpen takes payments through [Paddle Billing](https://www.paddle.com/billing) as our Merchant of Record. Paddle handles VAT, sales tax, invoicing, and PCI scope; we receive webhooks and update local subscription state.

## What you need before going live

- A verified Paddle vendor account (production). Sandbox is enough for local development.
- One Product per plan (Starter, Pro) with two Prices each (Monthly, Annual) → **4 Price IDs**.
- A Notification destination pointed at `/api/webhooks/paddle` with these events subscribed: `subscription.created`, `subscription.updated`, `subscription.canceled`, `transaction.completed`.
- The four `PADDLE_*` and the four `NEXT_PUBLIC_PADDLE_PRICE_*` env vars set in Railway.

## Step-by-step

### 1. Sandbox sign-up
1. Sign up at <https://sandbox-vendors.paddle.com>.
2. Complete the Account setup form (legal entity, address, business questions). Sandbox approval is usually instant.
3. **Settings → Authentication → Generate API key** → copy as `PADDLE_API_KEY`.
4. **Settings → Developer tools → Client-side tokens → Generate** → copy as `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`.

### 2. Create the products + prices
For each tier (Starter, Pro):
1. **Catalog → Products → Create product**.
   - Name: `Quilpen Starter` (or `Quilpen Pro`).
   - Type: Standard.
2. On the product page, **Add a price** twice:
   - Monthly: USD, billed every 1 month, no trial. Price = $9 (Starter) / $19 (Pro).
   - Annual: USD, billed every 1 year, no trial. Price = $84 (Starter, $7 effective monthly) / $180 (Pro, $15 effective monthly).
3. Copy each `pri_xxx` ID into the matching env vars:
   - `PADDLE_PRICE_STARTER_MONTH`, `PADDLE_PRICE_STARTER_YEAR`
   - `PADDLE_PRICE_PRO_MONTH`, `PADDLE_PRICE_PRO_YEAR`
   - And the matching `NEXT_PUBLIC_*` mirrors (the browser needs them to open the Checkout overlay).

### 3. Webhook destination
1. **Notifications → Add destination**.
2. URL: `https://quilpen.com/api/webhooks/paddle` (use the sandbox URL during development — e.g. ngrok tunnel pointing at `localhost:3000`).
3. Subscribe to:
   - `subscription.created`
   - `subscription.updated`
   - `subscription.canceled`
   - `transaction.completed`
4. Copy the destination's secret as `PADDLE_WEBHOOK_SECRET`.
5. Click **Send a test event** for `subscription.created`. Tail logs (`railway logs --json | grep paddle/webhook`) and confirm it returns 200. A `signature verification failed` line means the secret is wrong.

### 4. Local testing
- Tunnel localhost to Paddle: `ngrok http 3000` then update the destination URL to the ngrok host.
- Open `http://localhost:3000/pricing`, click `Get Pro`. The overlay should load with Paddle's test card UI.
- Use the Paddle [test card](https://developer.paddle.com/concepts/payment-methods/credit-debit-card) `4000 0566 5566 5556` with any future expiry and any CVC.
- After payment completes, watch the webhook fire and `/account` should update to show the new tier.

### 5. Production cut-over
1. Get the production account approved (usually 1–3 business days after submitting Account setup).
2. Recreate the same Products + Prices on the production dashboard (sandbox IDs do **not** carry over).
3. Generate fresh production API key, client token, and webhook secret.
4. Set Railway env vars (delete the sandbox values):
   - `PADDLE_ENVIRONMENT=production`
   - `NEXT_PUBLIC_PADDLE_ENVIRONMENT=production`
   - All `PADDLE_*` and `NEXT_PUBLIC_PADDLE_PRICE_*` to the new prod values.
5. Deploy and run the test event again from the prod dashboard.

## Testing the credit gate manually

```bash
# Force a free user back to "creditsResetAt in the past" so the next call refills
psql "$DATABASE_URL" -c \
  "UPDATE \"User\" SET \"creditsResetAt\" = NOW() - interval '1 day', \"creditBalance\" = 0 WHERE id = '<user_id>';"

# Then hit any AI endpoint — checkCredits → ensureMonthlyAllowance() lazily
# resets the balance to 1500 and pushes creditsResetAt to the 1st of next month.
```

## Files involved

| Path | Purpose |
| --- | --- |
| `src/lib/billing/tiers.ts` | Tier config (credits, features, env-driven Price IDs) |
| `src/lib/billing/paddle.ts` | Webhook signature verifier + Paddle API helpers |
| `src/lib/credits.ts` | `ensureMonthlyAllowance()` — lazy free-tier refill, auto-downgrade on cancellation |
| `src/app/api/webhooks/paddle/route.ts` | Webhook receiver — maps events to User updates |
| `src/app/api/billing/portal/route.ts` | Generates Paddle customer-portal URL and redirects |
| `src/app/pricing/page.tsx` | Public pricing page (server component) |
| `src/components/billing/PricingCards.tsx` | Three-card client subtree with monthly/annual toggle |
| `src/components/billing/CheckoutButton.tsx` | Loads Paddle.js + opens the Checkout overlay |
| `src/app/account/page.tsx` | Logged-in account dashboard with usage + manage button |
