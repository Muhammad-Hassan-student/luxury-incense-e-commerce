# Maison Oud

A small-batch fragrance store (incense, dhoop, candles, attars, bakhoor, gift sets) with a 3D storefront, Stripe + Razorpay + COD checkout, loyalty points, and a staff admin.

Next.js 16 (App Router) · React 19 · Prisma 7 + PostgreSQL · Auth.js v5 · Tailwind v4 · three.js / R3F · framer-motion · GSAP · Lenis

## Run it locally

```bash
npm install
cp .env.example .env                # then set AUTH_SECRET: npx auth secret
npm run db:start                    # Postgres on :54329, no Docker needed (keep this terminal open)
npx prisma migrate deploy && npx prisma db seed
npm run dev                         # http://localhost:3000
```

Prefer Docker? `docker compose up -d` starts the same database on the same port.

**Signing in locally:** with no `RESEND_API_KEY`, magic links are printed in the `npm run dev` terminal instead of emailed. Any address listed in `ADMIN_EMAILS` becomes `OWNER` the first time it signs in, and gets the **Store admin** link on `/account`.

**Paying locally:** with no Stripe/Razorpay keys, only cash on delivery is offered, so the full order flow still works end to end.

## Configuration

Every integration switches on when its keys are present in `.env` (see `.env.example`):

| Feature | Variables | Notes |
|---|---|---|
| Google sign-in | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Email magic links always work |
| Card / Apple Pay / Google Pay | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Webhook: `/api/webhooks/stripe` (`payment_intent.*`) |
| UPI / netbanking | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Webhook: `/api/webhooks/razorpay` (`payment.captured`, `payment.failed`) |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Receipts, shipping updates, magic links, reminders |
| Rate limiting across servers | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | In-memory fallback for a single server |
| Scheduled jobs | `CRON_SECRET` | See below |

Brand name, currencies, loyalty rates and the free-shipping threshold live in `src/config/brand.ts`. Tax rate, announcement bar and gift-wrap fee are edited in **Admin → Settings**.

## Scheduled jobs

`GET /api/cron/{job}` with `Authorization: Bearer $CRON_SECRET`. `vercel.json` schedules them on Vercel; elsewhere use any cron.

- `release` (every 10 min): cancels unpaid orders whose 30-minute stock hold lapsed
- `abandoned` (hourly): one reminder email per bag left for 3 hours
- `stock-alerts` (hourly): emails people waiting on a product that's back in stock

## How orders work

1. Checkout re-prices the bag on the server, creates a `PENDING` order and **reserves** stock atomically, so two shoppers can never buy the last unit.
2. Online payments confirm through the provider webhook (and the Razorpay client callback, verified by signature). Confirmation is idempotent and commits the sale, clears the bag, applies coupon usage, and moves loyalty points.
3. COD orders are confirmed immediately and marked paid on delivery.
4. Unpaid holds are released by the `release` job; a payment that lands after release re-takes stock if it's still available.
5. Staff move orders `PACKED → SHIPPED → DELIVERED`, cancel, or refund from **Admin → Orders**. Refunds go back to the provider, restock, and reverse points.

### Gift cards

- Sold at `/gifts/gift-card` (₹2,500 / ₹5,000 / ₹10,000) with a recipient, email and message. They're excluded from coupons, points, tax and shipping, must be paid online, and can't be bought with another gift card.
- Codes (`MO-XXXX-XXXX-XXXX`, valid one year) are created and emailed to the recipient only once payment is captured.
- Shoppers redeem a code in the bag or at checkout. The balance is held atomically when the order is placed and put back if the order is cancelled, expires unpaid, or is refunded. A card that covers the whole order needs no payment method.
- Refunding or cancelling an order that *bought* gift cards deactivates those cards.
- **Admin → Gift cards** lists every card with its balance and source order; managers can issue goodwill cards (optionally emailed) and deactivate cards.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Pricing unit tests (vitest) |
| `npm run test:orders` | Order lifecycle checks against the local DB (creates and removes its own data) |
| `npm run typecheck` / `npm run lint` | Type and lint checks |
| `npm run db:studio` | Browse the database |
| `npx prisma db seed` | Re-seed catalog content (safe to re-run; never resets stock or edited homepage blocks) |

## Where things are

- `src/app/(store)`: storefront pages · `src/app/admin`: staff panel · `src/app/api`: auth, webhooks, cron
- `src/server`: data access and business rules (cart, orders, inventory, payments, email)
- `src/actions`: server actions called from the UI
- `src/components/three`: procedural 3D models, smoke and flame shaders (no external assets)
- `src/content/pages.ts`: About, Shipping, Privacy and Terms copy
- `messages/`: English and Arabic UI strings (Arabic switches the layout to right-to-left)
# luxury-incense-e-commerce
