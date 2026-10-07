# Maison Oud

A small-batch fragrance store (incense, dhoop, candles, attars, bakhoor, gift sets) with a 3D storefront, Stripe + Razorpay + COD checkout, loyalty points, and a staff admin.

Next.js 16 (App Router) · React 19 · Prisma 7 + PostgreSQL · Auth.js v5 · Tailwind v4 · three.js / R3F · framer-motion · GSAP · Lenis

## Run it locally

```bash
npm install
cp .env.example .env                # then set AUTH_SECRET: npx auth secret
npx prisma migrate deploy && npx prisma db seed   # needs the database: run `npm run db:ensure` first
npm run dev                         # starts Postgres (:54329, no Docker) in the background if needed, then http://localhost:3000
```

The local database runs as its own background process and keeps running after you stop `npm run dev`; its log is `.tmp/db.log`. Start it on its own with `npm run db:ensure`.

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
- `low-stock` (daily): emails inventory staff what needs reordering

## How orders work

1. Checkout re-prices the bag on the server, creates a `PENDING` order and **reserves** stock atomically, so two shoppers can never buy the last unit.
2. Online payments confirm through the provider webhook (and the Razorpay client callback, verified by signature). Confirmation is idempotent and commits the sale, clears the bag, applies coupon usage, and moves loyalty points.
3. COD orders are confirmed immediately and marked paid on delivery.
4. Unpaid holds are released by the `release` job; a payment that lands after release re-takes stock if it's still available.
5. Staff move orders `PACKED → SHIPPED → DELIVERED`, cancel, or refund from **Admin → Orders**. Refunds go back to the provider, restock, and reverse points.

### Staff, roles & permissions

Admin access is permission-based (`src/lib/permissions.ts`: 23 permissions across orders, catalog, inventory, marketing, people and settings). Every admin page **and** server action checks its own permission.

- **Built-in roles:** Owner (everything), Manager (everything except staff and store settings), Support (customer care and fulfilment, read-only elsewhere).
- **Custom roles** (Admin → Roles): any combination, e.g. a "Warehouse" role that can count and adjust stock and pack orders but can't see revenue or customers. Narrow roles land on the first section they can use.
- **Staff** (Admin → Staff): add people by email (new addresses get an invitation; they sign in with a one-time link), change or revoke access, see when each person was last active. Revoking access signs them out everywhere.
- **Guards:** nobody can change their own access; only owners can create or remove owners; nobody can grant (or define a role with) permissions they don't hold themselves. Every change is in the audit log.

### Inventory & purchasing

- **Stock** (Admin → Stock): on-hand, reserved, available and on-order quantities, stock value at cost, below-reorder and out-of-stock counts, ± adjustments, and per-variant cost price, reorder point/quantity, barcode and preferred supplier. CSV export, and CSV import with a dry-run preview (nothing applies if any row has an error).
- **Movements:** every stock change (sale, reservation, restock, adjustment, return, PO receipt, stocktake) with who/what caused it.
- **Purchase orders:** reorder suggestions grouped by supplier → one-click draft PO → mark ordered → receive in full or in parts (stock and weighted-average cost update automatically) → printable PO for the supplier.
- **Suppliers:** contacts, lead time, products supplied, open POs, total spend.
- **Stocktakes:** count everything or one category/supplier, with large tablet inputs and barcode/SKU scan-to-line; variances in units and value; completing applies only the counted lines and warns if stock moved mid-count.
- **Low-stock email:** `GET /api/cron/low-stock` emails inventory staff once a day with everything at or below its reorder point.

### Customer account extras

- Printable **tax invoice** for every confirmed order (customer: from the order page; staff: Admin → order → Invoice).
- **Cancel before dispatch:** customers can cancel unpacked orders themselves (cash on delivery is cancelled; paid orders are refunded to the original method).
- **Buy again** puts a past order's still-available items back in the bag.
- **Your data:** download everything we hold as JSON, or delete the account (personal data is erased; orders are kept, anonymised, for tax records).
- **Orders CSV** for staff with `orders.export` (Admin → Orders → Export CSV).

### Returns & exchanges

- Customers request a return from a delivered order's page within the window (default 14 days from first delivery), pick pieces and a reason, and can cancel while it's still awaiting review.
- Staff (`returns.manage`, Admin → Returns): approve or decline (reason emailed), receive with per-piece inspection (resellable pieces go back into stock), then refund, issue store credit (a gift card) or send a free replacement order.
- Refunds are the returned lines' paid share minus an optional restocking fee; card/UPI go back through Stripe/Razorpay, COD and trade invoices are flagged for a manual transfer. Loyalty points are clawed back proportionally.
- Policy (window, restocking fee, non-returnable categories) is edited on Admin → Returns.

### Reports & recommendations

- **Admin → Reports** (`reports.view`): net revenue (after refunds and returns), orders, AOV, margin, refund rate and more vs the previous period; revenue chart; top products, variants, categories and customers; retail vs trade; customer segments; CSV export.
- **"Pairs beautifully with"** on product pages and **"You may also like"** in the bag come from products bought together (last 365 days), falling back to category and scent-family best-sellers.

### Photos & video (optional)

Nothing needs media: without it, products use their procedural illustration and 3D model, categories their ambient animation, and the homepage hero its 3D scene.

- **Products:** Admin → Products → a product → *Photos & video*. Drop in JPG/PNG/WebP/AVIF (10MB) or MP4/MOV/WebM (60MB), or paste an https link. The first item is the cover on cards (the second photo appears on hover); the product page shows a gallery with the 3D view as its last slide. Video posters are generated automatically.
- **Categories:** Admin → Categories → banner image and/or video behind the category title.
- **Homepage hero:** Admin → Content → hero block → *Image* / *Video* (a video replaces the 3D scene).
- Videos are muted, load only near the screen, play only while visible, and stay on the poster for visitors with reduced motion or data saver on.
- **Storage:** with `CLOUDINARY_*` keys set, files upload straight from the browser to Cloudinary. Without them they're saved in `public/uploads` on the server, which is fine for development but not for serverless hosting, where the disk is wiped on each deploy.

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
| `npm run test:all` | Every suite below plus the unit tests |
| `npm run test:orders` | Order lifecycle, gift cards, stock holds (against the local DB; cleans up after itself) |
| `npm run test:rbac` | Roles, permissions and escalation guards |
| `npm run test:inventory` | Purchasing, receiving, costs, stocktakes, CSV import |
| `npm run test:customers` | Invoices, self-cancel, account export/deletion, CSV safety |
| `npm run test:visits` | Atelier visit booking, capacity, reminders |
| `npm run test:trade` | Trade accounts, tiers, credit terms, quotes |
| `npm run test:returns` | Return window, over-return races, refunds, restock, permissions |
| `npm run test:reports` | Sales report maths, period comparison, recommendations |
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
